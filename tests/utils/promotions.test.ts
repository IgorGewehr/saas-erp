import { describe, it, expect } from 'vitest';
import { getActivePromotions, applyPromotion, isPromotionExpired } from '@/lib/utils/promotions';
import type { BusinessPromotion } from '@/lib/types';

const NOW = new Date('2026-09-18T15:00:00');

function makePromo(overrides: Partial<BusinessPromotion> = {}): BusinessPromotion {
  return { id: 'p1', name: 'Lançamento', type: 'percentage', value: 10, isActive: true, ...overrides };
}

describe('getActivePromotions', () => {
  it('mantém só as ativas', () => {
    const result = getActivePromotions([makePromo({ id: 'a' }), makePromo({ id: 'b', isActive: false })], NOW);
    expect(result.map((p) => p.id)).toEqual(['a']);
  });

  it('descarta free_shipping (sem sentido pra serviço/B2B)', () => {
    expect(getActivePromotions([makePromo({ type: 'free_shipping' })], NOW)).toEqual([]);
  });

  it('descarta valor zero ou negativo', () => {
    expect(getActivePromotions([makePromo({ value: 0 }), makePromo({ value: -5 })], NOW)).toEqual([]);
  });

  it('descarta vencidas e mantém as com validade futura ou sem validade', () => {
    const result = getActivePromotions([
      makePromo({ id: 'vencida', validUntil: '2026-09-01' }),
      makePromo({ id: 'futura', validUntil: '2026-12-31' }),
      makePromo({ id: 'sem-validade' }),
    ], NOW);
    expect(result.map((p) => p.id)).toEqual(['futura', 'sem-validade']);
  });

  it('undefined vira lista vazia', () => {
    expect(getActivePromotions(undefined, NOW)).toEqual([]);
  });
});

describe('isPromotionExpired', () => {
  it('validade só com data vale até o fim do dia', () => {
    expect(isPromotionExpired(makePromo({ validUntil: '2026-09-18' }), NOW)).toBe(false);
    expect(isPromotionExpired(makePromo({ validUntil: '2026-09-17' }), NOW)).toBe(true);
  });

  it('data inválida é tratada como expirada', () => {
    expect(isPromotionExpired(makePromo({ validUntil: 'não-é-data' }), NOW)).toBe(true);
  });

  it('ISO completo compara no instante', () => {
    expect(isPromotionExpired(makePromo({ validUntil: '2026-09-18T14:00:00' }), NOW)).toBe(true);
    expect(isPromotionExpired(makePromo({ validUntil: '2026-09-18T16:00:00' }), NOW)).toBe(false);
  });
});

describe('applyPromotion', () => {
  it('percentual sobre o subtotal, em centavos', () => {
    const result = applyPromotion(makePromo({ value: 15 }), 200_000);
    expect(result).toEqual({ discountCents: 30_000, reason: 'Promoção: Lançamento' });
  });

  it('valor fixo em reais vira centavos', () => {
    const result = applyPromotion(makePromo({ type: 'fixed', value: 250.5 }), 200_000);
    expect(result?.discountCents).toBe(25_050);
  });

  it('desconto fixo maior que o subtotal fica preso ao subtotal', () => {
    expect(applyPromotion(makePromo({ type: 'fixed', value: 5000 }), 100_000)?.discountCents).toBe(100_000);
  });

  it('percentual acima de 100 fica preso em 100%', () => {
    expect(applyPromotion(makePromo({ value: 250 }), 100_000)?.discountCents).toBe(100_000);
  });

  it('respeita o pedido mínimo (em reais)', () => {
    const promo = makePromo({ minOrderValue: 1500 });
    expect(applyPromotion(promo, 149_999)).toBeNull();
    expect(applyPromotion(promo, 150_000)).not.toBeNull();
  });

  it('subtotal zero ou negativo não aplica', () => {
    expect(applyPromotion(makePromo(), 0)).toBeNull();
    expect(applyPromotion(makePromo(), -100)).toBeNull();
  });

  it('free_shipping nunca aplica', () => {
    expect(applyPromotion(makePromo({ type: 'free_shipping' }), 100_000)).toBeNull();
  });

  it('motivo respeita o limite de 300 chars do contrato', () => {
    const result = applyPromotion(makePromo({ name: 'x'.repeat(500) }), 100_000);
    expect(result?.reason.length).toBe(300);
  });
});
