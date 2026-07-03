/**
 * POST /api/coupons/validate — PREVIEW de cupom para o cardápio público.
 *
 * Read-only: NÃO reserva nem consome. Usa a MESMA função pura (`evaluateCoupon`)
 * que o checkout aplica, então o desconto mostrado é o que será cobrado — sem
 * divergência front↔back. A autoridade (limite sob concorrência, idempotência)
 * continua no checkout (reserveCouponAdmin); aqui é só UX otimista.
 *
 * Anônimo + rate-limited por IP (mesma política do /api/orders/public). Não
 * vaza internals sensíveis do cupom: devolve { valid, discount, freeDelivery,
 * message } e, no sucesso, também { code, discountType } (rótulos p/ a UI) —
 * NUNCA limites, contadores (usedCount/usageLimit) ou janelas (startsAt/endsAt).
 *
 * `firstOrderOnly` é avaliado otimista (cliente ainda desconhecido no preview):
 * o checkout reconfirma com o histórico real do telefone.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/utils/rateLimit';
import { loadCouponByCode } from '@/lib/services/orders/couponRedeem';
import { evaluateCoupon, COUPON_REJECT_MESSAGE } from '@/lib/services/orders/coupons';
import type { DeliveryType } from '@/lib/types';

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

interface ValidatePayload {
  businessId: string;
  code: string;
  subtotal: number;
  deliveryFee?: number;
  deliveryType: DeliveryType;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`coupons-validate:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Muitas tentativas. Aguarde um instante.' },
      { status: 429, headers: rateLimitHeaders(rl, RATE_LIMIT) },
    );
  }

  let body: ValidatePayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { businessId, code, deliveryType } = body;
  const subtotal = Number(body.subtotal);
  const deliveryFee = Number(body.deliveryFee ?? 0);
  if (!businessId || !code?.trim() || !deliveryType || !Number.isFinite(subtotal) || subtotal < 0) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 });
  }

  const coupon = await loadCouponByCode(adminDb, businessId, code);
  if (!coupon) {
    return NextResponse.json(
      { valid: false, message: 'Cupom inválido.' },
      { status: 200, headers: rateLimitHeaders(rl, RATE_LIMIT) },
    );
  }

  const evaluation = evaluateCoupon(coupon, {
    subtotal,
    deliveryFee: Number.isFinite(deliveryFee) ? deliveryFee : 0,
    deliveryType,
    now: new Date(),
    // isFirstOrder desconhecido no preview → otimista (checkout reconfirma).
  });

  if (!evaluation.ok) {
    return NextResponse.json(
      { valid: false, message: COUPON_REJECT_MESSAGE[evaluation.reason] },
      { status: 200, headers: rateLimitHeaders(rl, RATE_LIMIT) },
    );
  }

  return NextResponse.json(
    {
      valid: true,
      code: coupon.code,
      discount: evaluation.discount,
      freeDelivery: evaluation.freeDelivery,
      discountType: coupon.discountType,
    },
    { status: 200, headers: rateLimitHeaders(rl, RATE_LIMIT) },
  );
}
