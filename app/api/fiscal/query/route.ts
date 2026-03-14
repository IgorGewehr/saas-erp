import { NextRequest, NextResponse } from 'next/server';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

interface QueryRequestBody {
  chaveAcesso: string;
  certificado?: {
    pfxBase64: string;
    senha: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    if (!SEFAZ_API_URL) {
      return NextResponse.json(
        { error: 'SEFAZ_API_URL nao configurada no ambiente.' },
        { status: 500 },
      );
    }

    if (!SEFAZ_API_KEY) {
      return NextResponse.json(
        { error: 'SEFAZ_API_KEY nao configurada no ambiente.' },
        { status: 500 },
      );
    }

    const body: QueryRequestBody = await request.json();

    if (!body.chaveAcesso || typeof body.chaveAcesso !== 'string') {
      return NextResponse.json(
        { error: 'Chave de acesso e obrigatoria.' },
        { status: 400 },
      );
    }

    if (body.chaveAcesso.replace(/\D/g, '').length !== 44) {
      return NextResponse.json(
        { error: 'Chave de acesso deve conter 44 digitos.' },
        { status: 400 },
      );
    }

    const url = `${SEFAZ_API_URL}/nfe/consultar`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SEFAZ_API_KEY}`,
      },
      body: JSON.stringify({
        chaveAcesso: body.chaveAcesso,
        certificado: body.certificado,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: 'Erro ao consultar documento no SEFAZ.',
          details: responseData,
          statusCode: response.status,
        },
        { status: response.status },
      );
    }

    return NextResponse.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('[Fiscal Query] Erro ao consultar documento:', error);

    return NextResponse.json(
      {
        error: 'Erro interno ao consultar documento fiscal.',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 },
    );
  }
}
