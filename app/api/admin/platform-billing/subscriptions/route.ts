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
    return NextResponse.json({ ok: true, subscriptions });
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
