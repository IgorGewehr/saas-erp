/**
 * Contrato do motor de cupom — trava o comportamento do serviço PURO
 * (lib/services/orders/coupons.ts) e das invariantes do schema
 * (lib/contracts/domain/coupon.ts).
 *
 * O motor é a fonte ÚNICA de elegibilidade + cálculo, compartilhada por
 * checkout público, PDV, agente e endpoint de preview. Se o cálculo, a ordem
 * de rejeição ou uma invariante do schema mudar sem intenção, estes testes
 * falham cedo. Datas são FIXAS (determinismo) — nunca Date.now().
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateCoupon,
  normalizeCouponCode,
  deriveCouponStatus,
  type CouponContext,
} from '@/lib/services/orders/coupons';
import { CouponSchema, type Coupon } from '@/lib/contracts/domain/coupon';

const NOW = new Date('2026-06-01T12:00:00.000Z');

/** Cupom válido mínimo (tipado) — overrides trocam só o que o caso testa. */
function makeCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    businessId: 'biz_1',
    code: 'SAVE10',
    discountType: 'percent',
    discountValue: 10,
    appliesTo: 'all',
    usedCount: 0,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Contexto de pedido base (entrega, subtotal 100, sem frete). */
function makeCtx(overrides: Partial<CouponContext> = {}): CouponContext {
  return {
    subtotal: 100,
    deliveryFee: 0,
    deliveryType: 'entrega',
    now: NOW,
    ...overrides,
  };
}

/** Objeto CRU (pré-parse) pro schema — só campos obrigatórios sem default. */
function rawCoupon(overrides: Record<string, unknown> = {}) {
  return {
    businessId: 'biz_1',
    code: 'SAVE10',
    discountType: 'percent',
    discountValue: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('evaluateCoupon — desconto percentual', () => {
  it('desconta subtotal × value/100', () => {
    const r = evaluateCoupon(makeCoupon({ discountValue: 10 }), makeCtx({ subtotal: 100 }));
    expect(r).toEqual({ ok: true, discount: 10, freeDelivery: false, finalFee: 0 });
  });

  it('arredonda a 2 casas (33.33 × 10% = 3.333 → 3.33)', () => {
    const r = evaluateCoupon(makeCoupon({ discountValue: 10 }), makeCtx({ subtotal: 33.33 }));
    expect(r.ok && r.discount).toBe(3.33);
  });

  it('arredonda pra cima quando passa da metade (12.38 × 10% = 1.238 → 1.24)', () => {
    const r = evaluateCoupon(makeCoupon({ discountValue: 10 }), makeCtx({ subtotal: 12.38 }));
    expect(r.ok && r.discount).toBe(1.24);
  });

  it('respeita maxDiscountAmount como teto', () => {
    const r = evaluateCoupon(
      makeCoupon({ discountValue: 50, maxDiscountAmount: 30 }),
      makeCtx({ subtotal: 200 }),
    );
    expect(r.ok && r.discount).toBe(30);
  });

  it('nunca excede o subtotal (value 100% = subtotal, não mais)', () => {
    const r = evaluateCoupon(makeCoupon({ discountValue: 100 }), makeCtx({ subtotal: 40 }));
    expect(r.ok && r.discount).toBe(40);
  });

  it('preserva o frete original em finalFee (não zera)', () => {
    const r = evaluateCoupon(makeCoupon({ discountValue: 10 }), makeCtx({ subtotal: 100, deliveryFee: 8.5 }));
    expect(r).toEqual({ ok: true, discount: 10, freeDelivery: false, finalFee: 8.5 });
  });
});

describe('evaluateCoupon — desconto fixo', () => {
  it('desconta exatamente o value', () => {
    const r = evaluateCoupon(
      makeCoupon({ discountType: 'fixed', discountValue: 15 }),
      makeCtx({ subtotal: 100 }),
    );
    expect(r.ok && r.discount).toBe(15);
  });

  it('limita ao subtotal (não gera crédito/negativo)', () => {
    const r = evaluateCoupon(
      makeCoupon({ discountType: 'fixed', discountValue: 50 }),
      makeCtx({ subtotal: 30 }),
    );
    expect(r.ok && r.discount).toBe(30);
  });
});

describe('evaluateCoupon — frete grátis', () => {
  it('zera o frete: discount 0, freeDelivery true, finalFee 0', () => {
    const r = evaluateCoupon(
      makeCoupon({ discountType: 'free_delivery', discountValue: 0 }),
      makeCtx({ subtotal: 100, deliveryFee: 12 }),
    );
    expect(r).toEqual({ ok: true, discount: 0, freeDelivery: true, finalFee: 0 });
  });
});

describe('evaluateCoupon — rejeições', () => {
  it('min_order: subtotal abaixo do mínimo', () => {
    const r = evaluateCoupon(makeCoupon({ minOrderValue: 50 }), makeCtx({ subtotal: 40 }));
    expect(r).toEqual({ ok: false, reason: 'min_order' });
  });

  it('wrong_channel: appliesTo=entrega com deliveryType=retirada', () => {
    const r = evaluateCoupon(
      makeCoupon({ appliesTo: 'entrega' }),
      makeCtx({ deliveryType: 'retirada' }),
    );
    expect(r).toEqual({ ok: false, reason: 'wrong_channel' });
  });

  it('expired: endsAt no passado', () => {
    const r = evaluateCoupon(
      makeCoupon({ endsAt: '2026-01-01T00:00:00.000Z' }),
      makeCtx(),
    );
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  it('not_started: startsAt no futuro', () => {
    const r = evaluateCoupon(
      makeCoupon({ startsAt: '2026-12-01T00:00:00.000Z' }),
      makeCtx(),
    );
    expect(r).toEqual({ ok: false, reason: 'not_started' });
  });

  it('exhausted: usedCount >= usageLimit', () => {
    const r = evaluateCoupon(makeCoupon({ usageLimit: 5, usedCount: 5 }), makeCtx());
    expect(r).toEqual({ ok: false, reason: 'exhausted' });
  });

  it('client_limit: clientRedemptionCount >= usageLimitPerClient', () => {
    const r = evaluateCoupon(
      makeCoupon({ usageLimitPerClient: 2 }),
      makeCtx({ clientRedemptionCount: 2 }),
    );
    expect(r).toEqual({ ok: false, reason: 'client_limit' });
  });

  it('first_order_only: cupom de 1ª compra e isFirstOrder=false', () => {
    const r = evaluateCoupon(
      makeCoupon({ firstOrderOnly: true }),
      makeCtx({ isFirstOrder: false }),
    );
    expect(r).toEqual({ ok: false, reason: 'first_order_only' });
  });

  it('inactive: status=paused', () => {
    const r = evaluateCoupon(makeCoupon({ status: 'paused' }), makeCtx());
    expect(r).toEqual({ ok: false, reason: 'inactive' });
  });
});

describe('deriveCouponStatus', () => {
  it('exhausted quando usedCount >= usageLimit', () => {
    expect(deriveCouponStatus(makeCoupon({ usageLimit: 3, usedCount: 3 }), NOW)).toBe('exhausted');
    expect(deriveCouponStatus(makeCoupon({ usageLimit: 3, usedCount: 4 }), NOW)).toBe('exhausted');
  });

  it('expired quando endsAt <= now (borda inclusiva)', () => {
    expect(deriveCouponStatus(makeCoupon({ endsAt: '2026-06-01T12:00:00.000Z' }), NOW)).toBe('expired');
    expect(deriveCouponStatus(makeCoupon({ endsAt: '2026-01-01T00:00:00.000Z' }), NOW)).toBe('expired');
  });

  it('paused tem precedência (preserva mesmo com endsAt no passado)', () => {
    expect(
      deriveCouponStatus(makeCoupon({ status: 'paused', endsAt: '2026-01-01T00:00:00.000Z' }), NOW),
    ).toBe('paused');
  });

  it('exhausted tem precedência sobre expired', () => {
    expect(
      deriveCouponStatus(
        makeCoupon({ usageLimit: 2, usedCount: 2, endsAt: '2026-01-01T00:00:00.000Z' }),
        NOW,
      ),
    ).toBe('exhausted');
  });

  it('active quando sem limites e dentro da janela', () => {
    expect(deriveCouponStatus(makeCoupon({ endsAt: '2026-12-31T00:00:00.000Z' }), NOW)).toBe('active');
    expect(deriveCouponStatus(makeCoupon(), NOW)).toBe('active');
  });

  it('preserva status terminal persistido (expired) sem endsAt', () => {
    expect(deriveCouponStatus(makeCoupon({ status: 'expired' }), NOW)).toBe('expired');
  });
});

describe('normalizeCouponCode', () => {
  it('faz trim e uppercase', () => {
    expect(normalizeCouponCode('  save10 ')).toBe('SAVE10');
    expect(normalizeCouponCode('Promo_Verao')).toBe('PROMO_VERAO');
  });
});

describe('CouponSchema — invariantes (superRefine)', () => {
  it('percent com discountValue fora de [1,100] falha', () => {
    expect(CouponSchema.safeParse(rawCoupon({ discountType: 'percent', discountValue: 0 })).success).toBe(false);
    expect(CouponSchema.safeParse(rawCoupon({ discountType: 'percent', discountValue: 101 })).success).toBe(false);
  });

  it('fixed com discountValue <= 0 falha', () => {
    expect(CouponSchema.safeParse(rawCoupon({ discountType: 'fixed', discountValue: 0 })).success).toBe(false);
  });

  it('endsAt <= startsAt falha', () => {
    expect(
      CouponSchema.safeParse(
        rawCoupon({ startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-06-01T00:00:00.000Z' }),
      ).success,
    ).toBe(false);
    expect(
      CouponSchema.safeParse(
        rawCoupon({ startsAt: '2026-06-02T00:00:00.000Z', endsAt: '2026-06-01T00:00:00.000Z' }),
      ).success,
    ).toBe(false);
  });

  it('usedCount > usageLimit falha', () => {
    expect(CouponSchema.safeParse(rawCoupon({ usageLimit: 5, usedCount: 6 })).success).toBe(false);
  });

  it('code fora do COUPON_CODE_REGEX falha', () => {
    expect(CouponSchema.safeParse(rawCoupon({ code: 'ab' })).success).toBe(false);
    expect(CouponSchema.safeParse(rawCoupon({ code: 'tem espaco' })).success).toBe(false);
  });

  it('cupom válido passa (percent, defaults aplicados)', () => {
    const parsed = CouponSchema.safeParse(rawCoupon());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.appliesTo).toBe('all');
      expect(parsed.data.usedCount).toBe(0);
      expect(parsed.data.status).toBe('active');
    }
  });
});
