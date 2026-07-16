import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { consultarNFe, resolveAmbiente, SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';
import { resolveUfEmitente } from '@/lib/fiscal/uf';
import { QueryFiscalRequestSchema } from '@/lib/contracts/api/fiscal/query';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = QueryFiscalRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Payload inválido para consulta fiscal.', details: parsed.error.flatten() },
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

    // Posse da chave (R1): a consulta usa o certificado do tenant — sem este
    // check, um admin de qualquer tenant consultaria QUALQUER chave de acesso
    // da SEFAZ via nosso gateway. Exigimos que o documento exista no tenant.
    // (nfse-dps consulta por idDPS — identificador gerado pelo próprio emit,
    // sem chave; fica fora deste guard.)
    if (body.chaveAcesso && type !== 'nfse-dps') {
      const ownSnap = await adminDb
        .collection('fiscalDocuments')
        .where('businessId', '==', body.businessId)
        .where('accessKey', '==', body.chaveAcesso)
        .limit(1)
        .get();
      if (ownSnap.empty) {
        return NextResponse.json(
          { error: 'Documento fiscal não encontrado para este negócio.' },
          { status: 404 },
        );
      }
    }

    // Resolve certificate, ambiente e UF from Firestore
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

      return await safeNFSeFetch(`${SEFAZ_API_URL}/nfse/consultar`, SEFAZ_API_KEY, { chaveAcesso: body.chaveAcesso, ambiente, certificado });
    }

    if (type === 'nfse-dps') {
      if (!body.idDPS) {
        return NextResponse.json(
          { error: 'ID do DPS e obrigatorio.' },
          { status: 400 },
        );
      }

      if (!SEFAZ_API_URL || !SEFAZ_API_KEY) {
        return NextResponse.json(
          { error: 'SEFAZ_API_URL ou SEFAZ_API_KEY nao configurada.' },
          { status: 500 },
        );
      }

      return await safeNFSeFetch(`${SEFAZ_API_URL}/nfse/consultar-dps`, SEFAZ_API_KEY, { idDPS: body.idDPS, ambiente, certificado });
    }

    // NFe/NFCe query (44-digit key)
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

    const result = await consultarNFe({
      chaveAcesso: body.chaveAcesso,
      ufEmitente,
      ambiente,
      certificado,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Fiscal Query] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao consultar documento fiscal.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}

// ── Helper: NFSe fetch com timeout, JSON-safe e mensagem de erro estruturada ──
async function safeNFSeFetch(url: string, apiKey: string, payload: Record<string, unknown>): Promise<NextResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = (err as Error).name === 'AbortError';
    return NextResponse.json(
      { error: isAbort ? 'Timeout (60s) ao consultar NFSe.' : 'Falha de rede ao consultar NFSe.', details: String(err) },
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
      { error: `Erro ao consultar documento (${response.status}): ${bodyError ?? response.statusText}`, details: responseData, statusCode: response.status },
      { status: response.status },
    );
  }

  return NextResponse.json({ success: true, data: responseData });
}
