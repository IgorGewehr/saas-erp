import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { cancelarNFe, resolveAmbiente, SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';
import { resolveUfEmitente } from '@/lib/fiscal/uf';
import { CancelFiscalRequestSchema } from '@/lib/contracts/api/fiscal/cancel';
import {
  canTransitionFiscalDocument,
  normalizeFiscalDocumentStatus,
} from '@/lib/contracts/fsm/fiscalDocument';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = CancelFiscalRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Payload inválido para cancelamento fiscal.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const type = body.type || 'nfe';

    // Auth: admin+ only
    const auth = await verifyAuth(request, body.businessId);
    if (isAuthError(auth)) return auth;
    if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['admin']) {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }

    // FSM (R4): só 'autorizada' (e legados que normalizam pra ela) pode virar
    // 'cancelada'. Checa ANTES de chamar a SEFAZ — evita evento de cancelamento
    // pra doc já cancelado/rejeitado. Doc inexistente no Firestore segue o
    // fluxo legado (cancelamento de nota emitida fora do sistema).
    if (body.chaveAcesso) {
      const fsmSnap = await adminDb
        .collection('fiscalDocuments')
        .where('businessId', '==', body.businessId)
        .where('accessKey', '==', body.chaveAcesso)
        .limit(1)
        .get();
      if (!fsmSnap.empty) {
        const currentRaw = fsmSnap.docs[0].data().status;
        const current = normalizeFiscalDocumentStatus(currentRaw);
        if (!current || !canTransitionFiscalDocument(current, 'cancelada')) {
          return NextResponse.json(
            {
              error: `Documento com status '${currentRaw}' não pode ser cancelado (transição inválida ${current ?? currentRaw} → cancelada).`,
              currentStatus: currentRaw,
            },
            { status: 409 },
          );
        }
      }
    }

    // Resolve certificate, ambiente e UF from Firestore when businessId provided
    let certificado = body.certificado;
    let ambiente: SefazAmbiente = 'homologacao';
    let ufFromBusiness: string | undefined;

    if (body.businessId) {
      const businessDoc = await adminDb.collection('businesses').doc(body.businessId).get();
      if (businessDoc.exists) {
        const data = businessDoc.data();
        const fiscal = data?.fiscal;
        const rawEnv =
          type === 'nfce'
            ? (fiscal?.nfceConfig?.environment ?? fiscal?.nfeConfig?.environment ?? fiscal?.environment)
            : (fiscal?.nfeConfig?.environment ?? fiscal?.environment);
        ambiente = resolveAmbiente(rawEnv);
        ufFromBusiness = data?.endereco?.uf?.toUpperCase();
      }

      if (!certificado) {
        try {
          certificado = await getCertificadoPayload(body.businessId);
        } catch {
          return NextResponse.json(
            { error: 'Certificado digital nao disponivel.' },
            { status: 400 },
          );
        }
      }
    }

    if (!certificado) {
      return NextResponse.json(
        { error: 'certificado e obrigatorio quando businessId nao e fornecido.' },
        { status: 400 },
      );
    }

    if (type === 'nfse') {
      // NFSe accessKey varia por município:
      //   - Betha/Nacional: chave de 50 dígitos (chaveNFSe)
      //   - São Paulo: código de verificação alfanumérico (~8 chars)
      // Aceitamos qualquer string não vazia; o provider na sefaz-api valida o formato.
      if (!body.chaveAcesso || !body.chaveAcesso.trim()) {
        return NextResponse.json(
          { error: 'Chave/código de verificação da NFSe ausente.' },
          { status: 400 },
        );
      }

      if (!SEFAZ_API_URL || !SEFAZ_API_KEY) {
        return NextResponse.json(
          { error: 'SEFAZ_API_URL ou SEFAZ_API_KEY nao configurada.' },
          { status: 500 },
        );
      }

      // Lookup do fiscalDocument para obter número da NFSe (necessário para sefaz-api).
      const fiscalSnap = await adminDb
        .collection('fiscalDocuments')
        .where('businessId', '==', body.businessId)
        .where('accessKey', '==', body.chaveAcesso)
        .where('type', '==', 'nfse')
        .limit(1)
        .get();

      if (fiscalSnap.empty) {
        return NextResponse.json(
          { error: 'NFSe não encontrada para cancelamento. Reemita ou cancele direto no portal da prefeitura.' },
          { status: 404 },
        );
      }

      const fiscalDoc = fiscalSnap.docs[0].data();
      const numeroNfse = Number(fiscalDoc.number);
      if (!numeroNfse || Number.isNaN(numeroNfse)) {
        return NextResponse.json(
          { error: 'Número da NFSe não registrado neste documento.' },
          { status: 400 },
        );
      }

      // Resolver dados do prestador necessários para o payload de cancelamento.
      const businessDoc = await adminDb.collection('businesses').doc(body.businessId).get();
      const businessData = businessDoc.exists ? businessDoc.data() : null;
      const fiscalCfg = businessData?.fiscal;
      const prestadorCnpj = String(businessData?.cnpj || '').replace(/\D/g, '');
      const inscricaoMunicipal = String(
        fiscalCfg?.inscricaoMunicipal || businessData?.inscricaoMunicipal || ''
      ).replace(/\D/g, '');
      const codigoMunicipio = String(
        fiscalCfg?.ibgeCodigoMunicipio || businessData?.endereco?.codigoMunicipio || ''
      ).replace(/\D/g, '');

      if (!prestadorCnpj || !inscricaoMunicipal || codigoMunicipio.length !== 7) {
        return NextResponse.json(
          { error: 'Dados do prestador incompletos (CNPJ, Inscrição Municipal ou Código IBGE). Configure em Configurações → Empresa/Fiscal.' },
          { status: 400 },
        );
      }

      const url = `${SEFAZ_API_URL}/nfse/cancelar`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SEFAZ_API_KEY}`,
          },
          body: JSON.stringify({
            prestador: { cnpj: prestadorCnpj, inscricaoMunicipal },
            numero: numeroNfse,
            chaveNFSe: body.chaveAcesso,
            codigoMunicipio,
            // Códigos legais: 1=Erro emissão, 2=Serviço não prestado, 3=Duplicidade, 4=Erro processamento.
            // Default '1' (mais comum dentro do prazo de 24h).
            codigoCancelamento: ['1', '2', '3', '4'].includes(body.codigoCancelamento as string)
              ? body.codigoCancelamento
              : '1',
            motivo: body.justificativa.trim(),
            ambiente,
            certificado,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const isAbort = (err as Error).name === 'AbortError';
        return NextResponse.json(
          { error: isAbort ? 'Timeout (60s) ao cancelar NFSe.' : 'Falha de rede ao cancelar NFSe.', details: String(err) },
          { status: 504 },
        );
      }
      clearTimeout(timer);

      const rawText = await response.text();
      let responseData: unknown = null;
      try { responseData = rawText ? JSON.parse(rawText) : null; } catch { /* not JSON */ }

      if (!response.ok) {
        const bodyError = (responseData && typeof responseData === 'object'
          ? (responseData as Record<string, unknown>).error || (responseData as Record<string, unknown>).message
          : null) || rawText.slice(0, 200);
        return NextResponse.json(
          { error: `Erro ao cancelar documento (${response.status}): ${bodyError ?? response.statusText}`, details: responseData, statusCode: response.status },
          { status: response.status },
        );
      }

      // Mesmo com HTTP 200, sefaz-api pode retornar status='rejeitado' ou
      // success=false dentro do body. Não confiamos só no status HTTP.
      const respBody = (responseData && typeof responseData === 'object')
        ? (responseData as Record<string, unknown>)
        : {};
      const respStatus = String(respBody.status || '').toLowerCase();
      const isCancelled = respStatus === 'cancelado' || respBody.success === true;

      if (!isCancelled) {
        return NextResponse.json(
          {
            success: false,
            error: respBody.motivoStatus || respBody.error || 'Cancelamento de NFSe rejeitado pela SEFAZ.',
            data: responseData,
          },
          { status: 422 },
        );
      }

      // Confirmed cancellation: reverse linked financial transactions.
      if (body.businessId) {
        await reverseLinkedTransactions(body.businessId, body.chaveAcesso, body.justificativa.trim());
      }

      return NextResponse.json({ success: true, data: responseData });
    }

    // NFe/NFCe cancel (44-digit key)
    if (!body.chaveAcesso || body.chaveAcesso.replace(/\D/g, '').length !== 44) {
      return NextResponse.json(
        { error: 'Chave de acesso deve conter 44 digitos.' },
        { status: 400 },
      );
    }

    const ufEmitente = resolveUfEmitente({
      ufFromBody: body.ufEmitente,
      ufFromBusiness,
      chaveAcesso: body.chaveAcesso,
    });

    const result = await cancelarNFe({
      chaveAcesso: body.chaveAcesso,
      protocolo: body.protocolo || '',
      justificativa: body.justificativa.trim(),
      ufEmitente,
      ambiente,
      certificado,
    });

    // SEFAZ retorna 422 com status='rejeitado' quando recusa o cancelamento.
    // Só aceitamos como cancelado se status='cancelado' OR success=true.
    const isCancelled = result.status === 'cancelado' || result.success === true;

    if (!isCancelled) {
      return NextResponse.json(
        {
          success: false,
          error: result.motivoStatus
            || result.erros?.[0]
            || 'Cancelamento rejeitado pela SEFAZ. Verifique o motivo.',
          data: result,
        },
        { status: 422 },
      );
    }

    // Confirmed cancellation: update fiscal doc + reverse linked transactions.
    if (body.businessId) {
      await reverseLinkedTransactions(body.businessId, body.chaveAcesso, body.justificativa.trim());
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Fiscal Cancel] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao cancelar documento fiscal.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Atomic financial reversal on cancellation
// ---------------------------------------------------------------------------

async function reverseLinkedTransactions(
  businessId: string,
  chaveAcesso: string,
  justificativa: string,
): Promise<void> {
  const now = new Date().toISOString();

  try {
    const batch = adminDb.batch();
    let hasUpdates = false;

    // 1. Find and update the fiscal document
    const fiscalSnap = await adminDb
      .collection('fiscalDocuments')
      .where('businessId', '==', businessId)
      .where('accessKey', '==', chaveAcesso)
      .limit(1)
      .get();

    for (const doc of fiscalSnap.docs) {
      // FSM (R4): defesa contra corrida entre o pré-check da rota e este
      // update (ex: doc já marcado 'cancelada' por outra via). SEFAZ já
      // aceitou o cancelamento — aqui só evitamos sobrescrever estado
      // terminal; warn pro operador investigar.
      const current = normalizeFiscalDocumentStatus(doc.data().status);
      if (!current || !canTransitionFiscalDocument(current, 'cancelada')) {
        console.warn(
          `[Fiscal Cancel] FSM: pulando update ${doc.data().status} → cancelada (doc ${doc.id})`,
        );
        continue;
      }
      batch.update(doc.ref, {
        status: 'cancelada',
        canceledAt: now,
        cancelReason: justificativa,
        updatedAt: now,
      });
      hasUpdates = true;

      // 2. Find and reverse linked financial transactions
      //    Transactions may be linked by saleId (from PDV) or by fiscal doc reference
      const saleId = doc.data().saleId;
      if (saleId) {
        const txSnap = await adminDb
          .collection('transactions')
          .where('businessId', '==', businessId)
          .where('saleId', '==', saleId)
          .where('status', '==', 'pago')
          .get();

        for (const txDoc of txSnap.docs) {
          batch.update(txDoc.ref, {
            status: 'cancelado',
            canceledAt: now,
            cancelReason: `Cancelamento fiscal: ${justificativa}`,
            updatedAt: now,
          });
        }
      }
    }

    if (hasUpdates) {
      await batch.commit();
      console.log(`[Fiscal Cancel] Reversed financial transactions for ${chaveAcesso}`);
    }
  } catch (err) {
    // Non-fatal — the SEFAZ cancellation already succeeded
    console.warn('[Fiscal Cancel] Failed to reverse financial transactions (non-fatal):', err);
  }
}
