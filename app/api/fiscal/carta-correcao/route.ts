import { NextRequest, NextResponse } from 'next/server';
import { cartaCorrecaoNFe } from '@/lib/services/sefaz-gateway';

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

    const result = await cartaCorrecaoNFe({
      chaveAcesso: body.chaveAcesso,
      correcao: body.textoCorrecao.trim(),
      ufEmitente: body.ufEmitente || body.chaveAcesso.substring(0, 2),
      sequencia: body.sequencia || 1,
      certificado: body.certificado,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Fiscal CartaCorrecao] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao processar carta de correcao.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
