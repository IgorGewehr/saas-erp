import { NextRequest, NextResponse } from 'next/server';
import { cancelarNFe } from '@/lib/services/sefaz-gateway';

const SEFAZ_API_URL = process.env.SEFAZ_API_URL;
const SEFAZ_API_KEY = process.env.SEFAZ_API_KEY;

interface CancelRequestBody {
  type: 'nfse' | 'nfe' | 'nfce';
  chaveAcesso: string;
  protocolo?: string;
  justificativa: string;
  ufEmitente?: string;
  certificado?: {
    pfxBase64: string;
    password: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: CancelRequestBody = await request.json();
    const type = body.type || 'nfe';

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

    if (type === 'nfse') {
      // NFSe cancel (50-digit key) — no gateway function, use raw fetch
      if (!body.chaveAcesso || body.chaveAcesso.replace(/\D/g, '').length !== 50) {
        return NextResponse.json(
          { error: 'Chave de acesso NFSe deve conter 50 digitos.' },
          { status: 400 },
        );
      }

      if (!SEFAZ_API_URL || !SEFAZ_API_KEY) {
        return NextResponse.json(
          { error: 'SEFAZ_API_URL ou SEFAZ_API_KEY nao configurada.' },
          { status: 500 },
        );
      }

      const url = `${SEFAZ_API_URL}/nfse/cancelar`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SEFAZ_API_KEY}`,
        },
        body: JSON.stringify({
          chaveAcesso: body.chaveAcesso,
          justificativa: body.justificativa.trim(),
          certificado: body.certificado,
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          { error: 'Erro ao cancelar documento.', details: responseData, statusCode: response.status },
          { status: response.status },
        );
      }

      return NextResponse.json({ success: true, data: responseData });
    }

    // NFe/NFCe cancel (44-digit key) — use centralized gateway
    if (!body.chaveAcesso || body.chaveAcesso.replace(/\D/g, '').length !== 44) {
      return NextResponse.json(
        { error: 'Chave de acesso deve conter 44 digitos.' },
        { status: 400 },
      );
    }

    const result = await cancelarNFe({
      chaveAcesso: body.chaveAcesso,
      protocolo: body.protocolo || '',
      justificativa: body.justificativa.trim(),
      ufEmitente: body.ufEmitente || body.chaveAcesso.substring(0, 2),
      certificado: body.certificado!,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Fiscal Cancel] Erro:', error);
    return NextResponse.json(
      { error: 'Erro interno ao cancelar documento fiscal.', details: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}
