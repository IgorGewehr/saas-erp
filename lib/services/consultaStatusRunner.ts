/**
 * lib/services/consultaStatusRunner.ts
 *
 * Worker que consulta a SEFAZ pra atualizar documentos fiscais que ficaram
 * com status='processando' (cenário raro mas possível: resposta assíncrona
 * SEFAZ, parse parcial, etc). Invocado pelo cron
 * `GET/POST /api/fiscal/cron/consultar-processando` — intervalo recomendado:
 * 1 hora.
 *
 * Critérios de seleção (todos precisam bater):
 *   - status === 'processando'
 *   - accessKey preenchida (sem chave não há o que consultar)
 *   - createdAt >= 5min atrás (margem antes da SEFAZ ter processado)
 *   - lastConsultaAt vazio OU mais antigo que 55min (evita corrida com
 *     próxima execução do mesmo cron de 1h)
 *
 * Estados pós-consulta:
 *   - SEFAZ retorna cStat 100/150 → muda pra 'autorizada' + protocolo
 *   - cStat 101/151/155 → muda pra 'cancelada'
 *   - cStat de rejeição (>200) → 'rejeitada' + motivo
 *   - cStat 105 ou ainda processando → mantém 'processando' pra próxima janela
 */

import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { consultarNFe, resolveAmbiente, isTransientSefazError } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';

const MAX_PER_RUN = 50;
const MIN_AGE_BEFORE_CONSULT_MS = 5 * 60 * 1000;       // 5 min
const MIN_INTERVAL_BETWEEN_ATTEMPTS_MS = 55 * 60 * 1000; // 55 min (cron roda a cada 1h)

export interface ConsultaStatusSummary {
  startedAt: string;
  finishedAt: string;
  totalCandidates: number;
  attempted: number;
  autorizadas: number;
  rejeitadas: number;
  canceladas: number;
  aindaProcessando: number;
  erros: number;
  details: Array<{
    documentId: string;
    businessId: string;
    outcome: 'autorizada' | 'rejeitada' | 'cancelada' | 'processando' | 'erro';
    message?: string;
  }>;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object' && value && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Interpreta o cStat retornado pela SEFAZ no retorno de consulta:
 *   100, 150       → autorizada (autorizada + autorizada fora prazo)
 *   101, 151, 155  → cancelada (cancelada + cancelada extemporânea)
 *   105            → ainda em processamento
 *   135, 136       → evento de carta de correção registrado (mantém autorizada)
 *   >= 200         → rejeição definitiva
 *   default        → tratar como processando (não conhecido = não força mudança)
 */
function mapCStatToStatus(cStat: string): 'autorizada' | 'cancelada' | 'rejeitada' | 'processando' {
  const code = String(cStat || '').trim();
  if (code === '100' || code === '150') return 'autorizada';
  if (code === '101' || code === '151' || code === '155') return 'cancelada';
  if (code === '105') return 'processando';
  // Códigos de rejeição definitiva ficam entre 200 e 700 (200=rejeição genérica).
  const num = Number(code);
  if (!Number.isNaN(num) && num >= 200) return 'rejeitada';
  return 'processando';
}

export async function runConsultaProcessando(now: Date = new Date()): Promise<ConsultaStatusSummary> {
  const summary: ConsultaStatusSummary = {
    startedAt: now.toISOString(),
    finishedAt: '',
    totalCandidates: 0,
    attempted: 0,
    autorizadas: 0,
    rejeitadas: 0,
    canceladas: 0,
    aindaProcessando: 0,
    erros: 0,
    details: [],
  };

  const nowMs = now.getTime();

  const snap = await adminDb
    .collection('fiscalDocuments')
    .where('status', '==', 'processando')
    .limit(500)
    .get();

  summary.totalCandidates = snap.size;

  for (const docSnap of snap.docs) {
    if (summary.attempted >= MAX_PER_RUN) break;

    const data = docSnap.data();
    const documentId = docSnap.id;
    const businessId = data.businessId as string;
    if (!businessId) continue;

    const accessKey = String(data.accessKey || '').replace(/\D/g, '');
    if (accessKey.length !== 44) {
      // Sem chave válida não há como consultar — caso anômalo, operador
      // reemite manualmente. Apenas loga warn.
      console.warn('[consultaStatusRunner] doc processando sem accessKey valida', { documentId, businessId, accessKey });
      continue;
    }

    const createdAt = parseDate(data.createdAt);
    const lastConsulta = parseDate(data.lastConsultaAt);
    const ageSinceCreation = createdAt ? nowMs - createdAt.getTime() : Infinity;
    const elapsedSinceLastAttempt = lastConsulta ? nowMs - lastConsulta.getTime() : Infinity;

    if (ageSinceCreation < MIN_AGE_BEFORE_CONSULT_MS) continue; // muito recente
    if (elapsedSinceLastAttempt < MIN_INTERVAL_BETWEEN_ATTEMPTS_MS) continue; // outro cron pegou

    // Inferir UF do emitente: prefer dados explícitos, fallback à chave (posições 0-1 = cUF IBGE).
    // Como a chave guarda cUF e não a sigla, usamos campo explícito do doc quando existir.
    const ufEmitente = String(data.ufEmitente || data.contingencia?.ufEmitente || '').toUpperCase();
    if (!ufEmitente || ufEmitente.length !== 2) {
      console.warn('[consultaStatusRunner] doc processando sem ufEmitente', { documentId, businessId });
      continue;
    }

    summary.attempted += 1;
    await docSnap.ref.update({ lastConsultaAt: now.toISOString() });

    try {
      const certificado = await getCertificadoPayload(businessId);
      const ambienteCanonical = data.ambiente || data.sefazResponse?.ambiente || data.contingencia?.ambiente;

      const result = await consultarNFe({
        chaveAcesso: accessKey,
        ufEmitente,
        ambiente: resolveAmbiente(ambienteCanonical),
        certificado,
      });

      const nextStatus = mapCStatToStatus(result.codigoStatus || '');

      // Se nada mudou (continua processando), só atualiza lastConsultaAt
      // (que já fizemos acima). Sem update redundante.
      if (nextStatus === 'processando') {
        summary.aindaProcessando += 1;
        summary.details.push({ documentId, businessId, outcome: 'processando', message: result.motivoStatus });
        continue;
      }

      await docSnap.ref.update({
        status: nextStatus,
        statusMessage: result.motivoStatus || null,
        protocol: result.protocolo || data.protocol || null,
        sefazResponse: result,
        updatedAt: now.toISOString(),
      });

      if (nextStatus === 'autorizada') {
        summary.autorizadas += 1;
        summary.details.push({ documentId, businessId, outcome: 'autorizada' });
      } else if (nextStatus === 'cancelada') {
        summary.canceladas += 1;
        summary.details.push({ documentId, businessId, outcome: 'cancelada' });
      } else {
        summary.rejeitadas += 1;
        summary.details.push({ documentId, businessId, outcome: 'rejeitada', message: result.motivoStatus });
      }
    } catch (err) {
      // SEFAZ pode estar fora — não muda status, próximo ciclo tenta.
      const msg = err instanceof Error ? err.message : 'erro desconhecido';
      if (err instanceof Error && isTransientSefazError(err)) {
        console.log('[consultaStatusRunner] SEFAZ transiente — proximo ciclo', { documentId, businessId, msg });
      } else {
        await docSnap.ref.update({
          statusMessage: `Cron consulta falhou: ${msg}`,
          updatedAt: now.toISOString(),
        });
      }
      summary.erros += 1;
      summary.details.push({ documentId, businessId, outcome: 'erro', message: msg });
    }
  }

  summary.finishedAt = new Date().toISOString();
  console.log('[consultaStatusRunner] run finalizado', {
    totalCandidates: summary.totalCandidates,
    attempted: summary.attempted,
    autorizadas: summary.autorizadas,
    rejeitadas: summary.rejeitadas,
    canceladas: summary.canceladas,
    aindaProcessando: summary.aindaProcessando,
    erros: summary.erros,
  });

  return summary;
}
