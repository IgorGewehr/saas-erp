import { NextRequest, NextResponse } from 'next/server';
import { statusSefaz } from '@/lib/services/sefaz-gateway';

interface StatusBody {
  ufEmitente: string;
  certificado: {
    pfxBase64: string;
    password: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: StatusBody = await request.json();

    const result = await statusSefaz({
      ufEmitente: body.ufEmitente,
      certificado: body.certificado,
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
