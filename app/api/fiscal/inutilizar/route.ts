import { NextRequest, NextResponse } from 'next/server';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

interface InutilizarBody {
  ano: number;
  serie: string;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  ufEmitente: string;
  cnpj: string;
  modelo: '55' | '65'; // 55=NFe, 65=NFCe
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

    const url = `${SEFAZ_API_URL}/nfe/inutilizar`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SEFAZ_API_KEY}`,
      },
      body: JSON.stringify({
        ano: body.ano,
        serie: body.serie,
        numeroInicial: body.numeroInicial,
        numeroFinal: body.numeroFinal,
        justificativa: body.justificativa.trim(),
        ufEmitente: body.ufEmitente,
        cnpj: body.cnpj.replace(/\D/g, ''),
        modelo: body.modelo || '55',
        certificado: body.certificado,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Erro ao inutilizar numeracao.', details: responseData, statusCode: response.status },
        { status: response.status },
      );
    }

    return NextResponse.json({ success: true, data: responseData });
  } catch (error) {
    console.error('[Fiscal Inutilizar] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao inutilizar numeracao.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
