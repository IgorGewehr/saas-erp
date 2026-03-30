import { NextRequest, NextResponse } from 'next/server';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

interface CartaCorrecaoBody {
  chaveAcesso: string;
  sequencia: number;
  textoCorrecao: string;
  ufEmitente?: string;
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

    const body: CartaCorrecaoBody = await request.json();

    if (!body.chaveAcesso || body.chaveAcesso.replace(/\D/g, '').length !== 44) {
      return NextResponse.json(
        { error: 'Chave de acesso deve conter 44 digitos.' },
        { status: 400 },
      );
    }

    if (!body.textoCorrecao || body.textoCorrecao.trim().length < 15) {
      return NextResponse.json(
        { error: 'Texto da correcao deve ter no minimo 15 caracteres.' },
        { status: 400 },
      );
    }

    if (body.textoCorrecao.trim().length > 1000) {
      return NextResponse.json(
        { error: 'Texto da correcao deve ter no maximo 1000 caracteres.' },
        { status: 400 },
      );
    }

    const url = `${SEFAZ_API_URL}/nfe/carta-correcao`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SEFAZ_API_KEY}`,
      },
      body: JSON.stringify({
        chaveAcesso: body.chaveAcesso,
        sequencia: body.sequencia || 1,
        textoCorrecao: body.textoCorrecao.trim(),
        ufEmitente: body.ufEmitente || body.chaveAcesso.substring(0, 2),
        certificado: body.certificado,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Erro ao enviar carta de correcao.', details: responseData, statusCode: response.status },
        { status: response.status },
      );
    }

    return NextResponse.json({ success: true, data: responseData });
  } catch (error) {
    console.error('[Fiscal CartaCorrecao] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao processar carta de correcao.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
