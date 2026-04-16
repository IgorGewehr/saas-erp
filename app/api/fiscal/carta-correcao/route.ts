import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { cartaCorrecaoNFe, resolveAmbiente, SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';

interface CartaCorrecaoBody {
  businessId: string;
  chaveAcesso: string;
  sequencia: number;
  textoCorrecao: string;
  ufEmitente?: string;
  certificado?: {
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

    // Resolve certificate & ambiente from Firestore
    let certificado = body.certificado;
    let ambiente: SefazAmbiente = 'homologacao';

    if (body.businessId) {
      const businessDoc = await adminDb.collection('businesses').doc(body.businessId).get();
      if (businessDoc.exists) {
        const rawEnv = businessDoc.data()?.fiscal?.nfeConfig?.environment;
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

    const result = await cartaCorrecaoNFe({
      chaveAcesso: body.chaveAcesso,
      correcao: body.textoCorrecao.trim(),
      ufEmitente: body.ufEmitente || body.chaveAcesso.substring(0, 2),
      sequencia: body.sequencia || 1,
      ambiente,
      certificado,
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
