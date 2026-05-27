/**
 * lib/services/contingenciaRunner.ts
 *
 * Worker que transmite automaticamente NFC-e em contingência off-line quando
 * a SEFAZ volta. Invocado pelo cron `GET/POST /api/fiscal/cron/transmit-contingencia`
 * — recomendado rodar a cada 30 minutos (intervalo conservador pra respeitar
 * rate limit do sefaz-api e seu circuit breaker interno).
 *
 * Critérios de seleção (todos precisam bater):
 *   - status === 'contingencia'
 *   - contingencia.dhCont >= 30min atrás (margem pro sefaz-api estabilizar)
 *   - contingencia.dhCont <= 23h atrás (margem antes do limite SEFAZ de 24h
 *     — se passar disso é rejeitado por extemporaneidade)
 *   - lastCronAttemptAt vazio OU mais antigo que 25min (evita corrida quando
 *     dois processos rodam o cron por engano)
 *
 * Idempotência: a primeira coisa que o runner faz por doc é gravar
 * `lastCronAttemptAt = now`. Se outro worker pegar o mesmo doc, sua query
 * inicial vai filtrar por essa data e descartar. Não previne 100% race
 * (Firestore não tem locks), mas reduz drasticamente.
 *
 * Limite: processa no máximo MAX_PER_RUN documentos por execução pra evitar
 * pico de carga no sefaz-api. Os demais ficam pra próxima janela de 30min.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  transmitirNFCeContingencia,
  resolveAmbiente,
  isTransientSefazError,
} from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';

const MAX_PER_RUN = 50;
const DELAY_AFTER_EMISSION_MS = 30 * 60 * 1000;       // 30 min
const SEFAZ_DEADLINE_MS = 23 * 60 * 60 * 1000;        // 23h (margem antes das 24h)
const MIN_INTERVAL_BETWEEN_ATTEMPTS_MS = 25 * 60 * 1000; // 25 min

export interface ContingenciaRunSummary {
  startedAt: string;
  finishedAt: string;
  totalCandidates: number;
  attempted: number;
  autorizadas: number;
  aindaPendentes: number;
  erros: number;
  expiradas: number;
  details: Array<{
    documentId: string;
    businessId: string;
    outcome: 'autorizada' | 'pendente' | 'erro' | 'expirada';
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

export async function runTransmitContingencia(now: Date = new Date()): Promise<ContingenciaRunSummary> {
  const summary: ContingenciaRunSummary = {
    startedAt: now.toISOString(),
    finishedAt: '',
    totalCandidates: 0,
    attempted: 0,
    autorizadas: 0,
    aindaPendentes: 0,
    erros: 0,
    expiradas: 0,
    details: [],
  };

  const nowMs = now.getTime();

  // Query cross-tenant: todos os docs em contingência.
  // Volume baixo (notas em contingência são exceção) — filtragem fina
  // in-memory evita índice composto. Limite implícito grande pra cobrir
  // até cenários de SEFAZ fora por horas.
  const snap = await adminDb
    .collection('fiscalDocuments')
    .where('status', '==', 'contingencia')
    .limit(500)
    .get();

  summary.totalCandidates = snap.size;

  for (const docSnap of snap.docs) {
    if (summary.attempted >= MAX_PER_RUN) break;

    const data = docSnap.data();
    const documentId = docSnap.id;
    const businessId = data.businessId as string;
    if (!businessId) continue;

    const dhCont = parseDate(data.contingencia?.dhCont);
    const lastAttempt = parseDate(data.lastCronAttemptAt);
    const elapsedSinceEmission = dhCont ? nowMs - dhCont.getTime() : 0;
    const elapsedSinceLastAttempt = lastAttempt ? nowMs - lastAttempt.getTime() : Infinity;

    // Janela aberta?
    if (!dhCont) {
      // Sem dhCont não conseguimos garantir os 24h — pula e loga warn.
      console.warn('[contingenciaRunner] doc sem contingencia.dhCont', { documentId, businessId });
      continue;
    }
    if (elapsedSinceEmission < DELAY_AFTER_EMISSION_MS) continue; // muito recente
    if (elapsedSinceLastAttempt < MIN_INTERVAL_BETWEEN_ATTEMPTS_MS) continue; // outro processo pegou

    // Expirou (>= 24h após dhCont): SEFAZ vai rejeitar por extemporaneidade.
    // Marca como 'rejeitada' com motivo e segue. Operador fica sabendo no UI.
    if (elapsedSinceEmission >= SEFAZ_DEADLINE_MS + 60 * 60 * 1000) {
      await docSnap.ref.update({
        status: 'rejeitada',
        statusMessage: 'Contingência expirada (>24h apos dhCont). SEFAZ rejeitaria por extemporaneidade.',
        lastCronAttemptAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      summary.expiradas += 1;
      summary.details.push({ documentId, businessId, outcome: 'expirada' });
      continue;
    }

    summary.attempted += 1;

    // Marca a tentativa imediatamente pra reduzir corrida com outro worker.
    await docSnap.ref.update({ lastCronAttemptAt: now.toISOString() });

    try {
      const certificado = await getCertificadoPayload(businessId);
      const meta = (data.contingencia || {}) as { ufEmitente?: string; ambiente?: string };
      const ufEmitente = meta.ufEmitente || data.ufEmitente;
      if (!ufEmitente) {
        await docSnap.ref.update({
          statusMessage: 'UF do emitente nao encontrada no documento de contingencia',
          updatedAt: now.toISOString(),
        });
        summary.erros += 1;
        summary.details.push({ documentId, businessId, outcome: 'erro', message: 'sem UF' });
        continue;
      }

      const result = await transmitirNFCeContingencia({
        signedXml: data.xml as string,
        ufEmitente,
        certificado,
        ambiente: resolveAmbiente(meta.ambiente),
      });

      const nextStatus =
        result.status === 'autorizado' ? 'autorizada' :
        result.status === 'processando' ? 'processando' :
        result.status;

      await docSnap.ref.update({
        status: nextStatus,
        statusMessage: result.motivoStatus || result.erros?.[0] || null,
        protocol: result.protocolo || data.protocol || null,
        sefazResponse: result,
        updatedAt: now.toISOString(),
      });

      if (nextStatus === 'autorizada') {
        summary.autorizadas += 1;
        summary.details.push({ documentId, businessId, outcome: 'autorizada' });
      } else {
        summary.erros += 1;
        summary.details.push({ documentId, businessId, outcome: 'erro', message: result.motivoStatus });
      }
    } catch (err) {
      if (err instanceof Error && isTransientSefazError(err)) {
        // SEFAZ ainda fora. Mantém status='contingencia' — próxima janela tenta.
        await docSnap.ref.update({
          statusMessage: err.message || 'SEFAZ ainda indisponivel',
          updatedAt: now.toISOString(),
        });
        summary.aindaPendentes += 1;
        summary.details.push({ documentId, businessId, outcome: 'pendente', message: err.message });
      } else {
        // Erro não-transiente (cert, payload, etc) — loga mas mantém em
        // contingência pra operador investigar manualmente no detalhe.
        const msg = err instanceof Error ? err.message : 'erro desconhecido';
        await docSnap.ref.update({
          statusMessage: `Cron retry falhou: ${msg}`,
          updatedAt: now.toISOString(),
        });
        summary.erros += 1;
        summary.details.push({ documentId, businessId, outcome: 'erro', message: msg });
      }
    }
  }

  summary.finishedAt = new Date().toISOString();
  console.log('[contingenciaRunner] run finalizado', {
    totalCandidates: summary.totalCandidates,
    attempted: summary.attempted,
    autorizadas: summary.autorizadas,
    aindaPendentes: summary.aindaPendentes,
    erros: summary.erros,
    expiradas: summary.expiradas,
  });

  return summary;
}
