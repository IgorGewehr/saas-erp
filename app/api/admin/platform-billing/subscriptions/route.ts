/**
 * GET  /api/admin/platform-billing/subscriptions — lista todas as businesses
 *      com status de assinatura (M12, painel do operador da plataforma).
 * POST /api/admin/platform-billing/subscriptions — gera (ou reaproveita) o
 *      link de checkout de uma business.
 *
 * Ambas gated por verifyPlatformOperator (allowlist de e-mail), não
 * verifyAuth — isto é cross-tenant, não uma ação de um tenant sobre si
 * mesmo. Ver lib/utils/verifyPlatformOperator.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyPlatformOperator, isPlatformOperatorError } from '@/lib/utils/verifyPlatformOperator';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { createSubscriptionCheckout, listAllSubscriptions } from '@/lib/services/platformBilling/subscriptionAdmin';

export async function GET(req: NextRequest) {
  const auth = await verifyPlatformOperator(req);
  if (isPlatformOperatorError(auth)) return auth;

  try {
    const subscriptions = await listAllSubscriptions();
    // mpConfigured: a listagem em si nunca depende da conta MP da plataforma
    // (só lê Firestore) — mas a UI usa esta flag pra decidir se mostra ou
    // esconde a ação "Gerar link de cobrança" (dormente até a env var
    // existir, ver lib/services/platformBilling/subscriptionAdmin.ts).
    return NextResponse.json({ ok: true, subscriptions, mpConfigured: !!process.env.MP_PLATFORM_ACCESS_TOKEN });
  } catch (err) {
    console.error('[admin/platform-billing/subscriptions] GET error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`platform-billing-checkout:${clientIp}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Aguarde antes de tentar novamente.' }, { status: 429 });
  }

  const auth = await verifyPlatformOperator(req);
  if (isPlatformOperatorError(auth)) return auth;

  // Dormente até a conta MP da plataforma ser configurada — erro claro em
  // vez de deixar a exceção genérica de dentro de createSubscriptionCheckout
  // borbulhar. A UI já esconde o botão quando mpConfigured=false (GET
  // acima), isto aqui é a segunda linha de defesa (chamada direta à API).
  if (!process.env.MP_PLATFORM_ACCESS_TOKEN) {
    return NextResponse.json({ error: 'Cobrança via Mercado Pago ainda não configurada (MP_PLATFORM_ACCESS_TOKEN ausente)' }, { status: 503 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const businessId = body.businessId as string | undefined;
    if (!businessId) {
      return NextResponse.json({ error: 'businessId obrigatório' }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const result = await createSubscriptionCheckout(businessId, `${baseUrl}/platform-admin/billing`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[admin/platform-billing/subscriptions] POST error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
