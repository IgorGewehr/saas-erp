import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { consultarNFe, resolveAmbiente, SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

interface QueryRequestBody {
  type: 'nfse' | 'nfse-dps' | 'nfe' | 'nfce';
  businessId: string;
  chaveAcesso?: string;
  idDPS?: string;
  ufEmitente?: string;
  certificado?: {
    pfxBase64: string;
    password: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: QueryRequestBody = await request.json();
    const type = body.type || 'nfe';

    // Resolve certificate & ambiente from Firestore
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

      const url = `${SEFAZ_API_URL}/nfse/consultar`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SEFAZ_API_KEY}`,
        },
        body: JSON.stringify({ chaveAcesso: body.chaveAcesso, ambiente, certificado }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          { error: 'Erro ao consultar documento.', details: responseData, statusCode: response.status },
          { status: response.status },
        );
      }

      return NextResponse.json({ success: true, data: responseData });
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

      const url = `${SEFAZ_API_URL}/nfse/consultar-dps`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SEFAZ_API_KEY}`,
        },
        body: JSON.stringify({ idDPS: body.idDPS, ambiente, certificado }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          { error: 'Erro ao consultar documento.', details: responseData, statusCode: response.status },
          { status: response.status },
        );
      }

      return NextResponse.json({ success: true, data: responseData });
    }

    // NFe/NFCe query (44-digit key)
    if (!body.chaveAcesso || body.chaveAcesso.replace(/\D/g, '').length !== 44) {
      return NextResponse.json(
        { error: 'Chave de acesso deve conter 44 digitos.' },
        { status: 400 },
      );
    }

    const result = await consultarNFe({
      chaveAcesso: body.chaveAcesso,
      ufEmitente: body.ufEmitente || body.chaveAcesso.substring(0, 2),
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
