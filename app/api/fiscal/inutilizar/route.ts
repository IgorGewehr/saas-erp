import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { inutilizarNFe, resolveAmbiente, SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';

interface InutilizarBody {
  businessId: string;
  ano: number;
  serie: string;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  ufEmitente: string;
  cnpj: string;
  modelo: '55' | '65'; // 55=NFe, 65=NFCe
  certificado?: {
    pfxBase64: string;
    password: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: InutilizarBody = await request.json();

    if (!body.justificativa || body.justificativa.trim().length < 15) {
      return NextResponse.json(
        { error: 'Justificativa deve ter no minimo 15 caracteres.' },
        { status: 400 },
      );
    }

    if (body.justificativa.trim().length > 255) {
      return NextResponse.json(
        { error: 'Justificativa deve ter no maximo 255 caracteres.' },
        { status: 400 },
      );
    }

    if (body.numeroInicial > body.numeroFinal) {
      return NextResponse.json(
        { error: 'Numero inicial deve ser menor ou igual ao numero final.' },
        { status: 400 },
      );
    }

    // Resolve certificate & ambiente from Firestore
    let certificado = body.certificado;
    let ambiente: SefazAmbiente = 'homologacao';

    if (body.businessId) {
      const businessDoc = await adminDb.collection('businesses').doc(body.businessId).get();
      if (businessDoc.exists) {
        const fiscal = businessDoc.data()?.fiscal;
        const rawEnv =
          body.modelo === '65'
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

    const result = await inutilizarNFe({
      cnpj: body.cnpj.replace(/\D/g, ''),
      serie: body.serie,
      numeroInicial: body.numeroInicial,
      numeroFinal: body.numeroFinal,
      justificativa: body.justificativa.trim(),
      modelo: body.modelo || '55',
      ano: body.ano?.toString().slice(-2) || new Date().getFullYear().toString().slice(-2),
      ufEmitente: body.ufEmitente,
      ambiente,
      certificado,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Fiscal Inutilizar] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao inutilizar numeracao.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
