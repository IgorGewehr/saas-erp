import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { inutilizarNFe, resolveAmbiente, SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';
import { InutilizarRequestSchema } from '@/lib/contracts/api/fiscal/inutilizar';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = InutilizarRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Payload inválido para inutilização.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;

    // Auth: admin+ only
    const auth = await verifyAuth(request, body.businessId);
    if (isAuthError(auth)) return auth;
    if (ROLE_HIERARCHY[auth.role as UserRole] < ROLE_HIERARCHY['admin']) {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
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
