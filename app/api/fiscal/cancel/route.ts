import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { cancelarNFe, resolveAmbiente, SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

interface CancelRequestBody {
  type: 'nfse' | 'nfe' | 'nfce';
  businessId: string;
  chaveAcesso: string;
  protocolo?: string;
  justificativa: string;
  ufEmitente?: string;
  certificado?: {
    pfxBase64: string;
    password: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: CancelRequestBody = await request.json();
    const type = body.type || 'nfe';

    // Auth: admin+ only
    if (!body.businessId) {
      return NextResponse.json({ error: 'businessId e obrigatorio.' }, { status: 400 });
    }
    const auth = await verifyAuth(request, body.businessId);
    if (isAuthError(auth)) return auth;
    if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['admin']) {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }

    if (!body.justificativa || body.justificativa.trim().length < 15) {
      return NextResponse.json(
        { error: 'Justificativa deve ter no minimo 15 caracteres.' },
        { status: 400 },
      );
    }
    if (body.justificativa.trim().length > 255) {
      return NextResponse.json(
        { error: 'Justificativa deve ter no maximo 255 caracteres.' },
        { status: 400 },
      );
    }

    // Resolve certificate & ambiente from Firestore when businessId provided
    let certificado = body.certificado;
    let ambiente: SefazAmbiente = 'homologacao';

    if (body.businessId) {
      const businessDoc = await adminDb.collection('businesses').doc(body.businessId).get();
      if (businessDoc.exists) {
        const fiscal = businessDoc.data()?.fiscal;
        const rawEnv =
          type === 'nfce'
            ? (fiscal?.nfceConfig?.environment ?? fiscal?.nfeConfig?.environment)
            : fiscal?.nfeConfig?.environment;
        ambiente = resolveAmbiente(rawEnv);
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
      if (!body.chaveAcesso || body.chaveAcesso.replace(/\D/g, '').length !== 50) {
        return NextResponse.json(
          { error: 'Chave de acesso NFSe deve conter 50 digitos.' },
          { status: 400 },
        );
      }

      if (!SEFAZ_API_URL || !SEFAZ_API_KEY) {
        return NextResponse.json(
          { error: 'SEFAZ_API_URL ou SEFAZ_API_KEY nao configurada.' },
          { status: 500 },
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
            chaveAcesso: body.chaveAcesso,
            justificativa: body.justificativa.trim(),
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

      // Reverse linked financial transactions atomically
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

    const result = await cancelarNFe({
      chaveAcesso: body.chaveAcesso,
      protocolo: body.protocolo || '',
      justificativa: body.justificativa.trim(),
      ufEmitente: body.ufEmitente || body.chaveAcesso.substring(0, 2),
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
