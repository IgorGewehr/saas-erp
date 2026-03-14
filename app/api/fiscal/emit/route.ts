import { NextRequest, NextResponse } from 'next/server';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

interface EmitRequestBody {
  type: 'nfse' | 'nfce' | 'nfe';
  data: Record<string, unknown>;
}

function getSefazEndpoint(type: 'nfse' | 'nfce' | 'nfe'): string {
  const endpoints: Record<string, string> = {
    nfse: '/nfse/emitir',
    nfce: '/nfe/nfce/emitir',
    nfe: '/nfe/emitir',
  };
  return endpoints[type];
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

    const body: EmitRequestBody = await request.json();

    if (!body.type || !['nfse', 'nfce', 'nfe'].includes(body.type)) {
      return NextResponse.json(
        { error: 'Tipo de documento fiscal invalido. Use: nfse, nfce ou nfe.' },
        { status: 400 },
      );
    }

    if (!body.data || typeof body.data !== 'object') {
      return NextResponse.json(
        { error: 'Dados do documento fiscal sao obrigatorios.' },
        { status: 400 },
      );
    }

    const endpoint = getSefazEndpoint(body.type);
    const url = `${SEFAZ_API_URL}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SEFAZ_API_KEY}`,
      },
      body: JSON.stringify(body.data),
    });

    const responseData = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: 'Erro na comunicacao com o SEFAZ.',
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
    console.error('[Fiscal Emit] Erro ao emitir documento:', error);

    return NextResponse.json(
      {
        error: 'Erro interno ao processar emissao do documento fiscal.',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 },
    );
  }
}
