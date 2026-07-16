import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { cartaCorrecaoNFe, resolveAmbiente, SefazAmbiente } from '@/lib/services/sefaz-gateway';
import { getCertificadoPayload } from '@/lib/fiscal/certificate-manager';
import { resolveUfEmitente } from '@/lib/fiscal/uf';
import { CartaCorrecaoRequestSchema } from '@/lib/contracts/api/fiscal/carta-correcao';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parsed = CartaCorrecaoRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Payload inválido para carta de correção.', details: parsed.error.flatten() },
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

    // Resolve certificate, ambiente e UF from Firestore
    let certificado = body.certificado;
    let ambiente: SefazAmbiente = 'homologacao';
    let ufFromBusiness: string | undefined;

    if (body.businessId) {
      const businessDoc = await adminDb.collection('businesses').doc(body.businessId).get();
      if (businessDoc.exists) {
        const data = businessDoc.data();
        const rawEnv = data?.fiscal?.nfeConfig?.environment ?? data?.fiscal?.environment;
        ambiente = resolveAmbiente(rawEnv);
        ufFromBusiness = data?.endereco?.uf?.toUpperCase();
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

    const ufEmitente = resolveUfEmitente({
      ufFromBody: body.ufEmitente,
      ufFromBusiness,
      chaveAcesso: body.chaveAcesso,
    });

    const result = await cartaCorrecaoNFe({
      chaveAcesso: body.chaveAcesso,
      correcao: body.textoCorrecao.trim(),
      ufEmitente,
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
