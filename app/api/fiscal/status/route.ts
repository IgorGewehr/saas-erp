import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { statusSefaz, resolveAmbiente, SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';

interface StatusBody {
  businessId?: string;
  ufEmitente: string;
  certificado?: {
    pfxBase64: string;
    password: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: StatusBody = await request.json();

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

    const result = await statusSefaz({
      ufEmitente: body.ufEmitente,
      ambiente,
      certificado,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Fiscal Status] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao consultar status SEFAZ.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
