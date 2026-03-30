import { NextRequest, NextResponse } from 'next/server';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

interface StatusBody {
  ufEmitente: string;
  certificado: {
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

    const body: StatusBody = await request.json();

    const url = `${SEFAZ_API_URL}/nfe/status`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SEFAZ_API_KEY}`,
      },
      body: JSON.stringify({
        ufEmitente: body.ufEmitente,
        certificado: body.certificado,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Erro ao consultar status SEFAZ.', details: responseData, statusCode: response.status },
        { status: response.status },
      );
    }

    return NextResponse.json({ success: true, data: responseData });
  } catch (error) {
    console.error('[Fiscal Status] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao consultar status SEFAZ.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
