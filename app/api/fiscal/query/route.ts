import { NextRequest, NextResponse } from 'next/server';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

interface QueryRequestBody {
  type: 'nfse' | 'nfse-dps' | 'nfe' | 'nfce';
  chaveAcesso?: string;
  idDPS?: string;
  certificado?: {
    pfxBase64: string;
    password: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!SEFAZ_API_URL || !SEFAZ_API_KEY) {
      return NextResponse.json(
        { error: 'SEFAZ_API_URL ou SEFAZ_API_KEY nao configurada.' },
        { status: 500 },
      );
    }

    const body: QueryRequestBody = await request.json();
    const type = body.type || 'nfe';

    let endpoint: string;
    let payload: Record<string, unknown>;

    if (type === 'nfse') {
      // NFSe query by access key (50 digits)
      if (!body.chaveAcesso || body.chaveAcesso.replace(/\D/g, '').length !== 50) {
        return NextResponse.json(
          { error: 'Chave de acesso NFSe deve conter 50 digitos.' },
          { status: 400 },
        );
      }
      endpoint = '/nfse/consultar';
      payload = { chaveAcesso: body.chaveAcesso, certificado: body.certificado };
    } else if (type === 'nfse-dps') {
      // NFSe query by DPS ID
      if (!body.idDPS) {
        return NextResponse.json(
          { error: 'ID do DPS e obrigatorio.' },
          { status: 400 },
        );
      }
      endpoint = '/nfse/consultar-dps';
      payload = { idDPS: body.idDPS, certificado: body.certificado };
    } else {
      // NFe/NFCe query (44 digits)
      if (!body.chaveAcesso || body.chaveAcesso.replace(/\D/g, '').length !== 44) {
        return NextResponse.json(
          { error: 'Chave de acesso deve conter 44 digitos.' },
          { status: 400 },
        );
      }
      endpoint = '/nfe/consultar';
      payload = {
        chaveAcesso: body.chaveAcesso,
        ufEmitente: body.chaveAcesso.substring(0, 2),
        certificado: body.certificado,
      };
    }

    const url = `${SEFAZ_API_URL}${endpoint}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SEFAZ_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Erro ao consultar documento.', details: responseData, statusCode: response.status },
        { status: response.status },
      );
    }

    return NextResponse.json({ success: true, data: responseData });
  } catch (error) {
    console.error('[Fiscal Query] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao consultar documento fiscal.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
