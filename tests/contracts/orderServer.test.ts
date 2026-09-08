import { describe, it, expect } from 'vitest';
import { CreateOrderWithSideEffectsInputSchema } from '@/lib/contracts/api/services/order-server';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    businessId: 'biz1',
    type: 'b2b',
    items: [{ productId: 'p1', quantity: 2 }],
    ...overrides,
  };
}

describe('CreateOrderWithSideEffectsInputSchema', () => {
  it('aceita um input mínimo válido', () => {
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(baseInput()).success).toBe(true);
  });

  it('default installments = 1', () => {
    const parsed = CreateOrderWithSideEffectsInputSchema.parse(baseInput());
    expect(parsed.installments).toBe(1);
  });

  it('rejeita items vazio', () => {
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(baseInput({ items: [] })).success).toBe(false);
  });

  it('rejeita item sem productId nem serviceId', () => {
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(baseInput({ items: [{ quantity: 1 }] })).success).toBe(false);
  });

  it('rejeita item com productId E serviceId ao mesmo tempo', () => {
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(
      baseInput({ items: [{ productId: 'p1', serviceId: 's1', quantity: 1 }] }),
    ).success).toBe(false);
  });

  it('type=condicional exige conditionalExpiresAt', () => {
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(baseInput({ type: 'condicional' })).success).toBe(false);
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(
      baseInput({ type: 'condicional', conditionalExpiresAt: '2026-10-01' }),
    ).success).toBe(true);
  });

  it('rejeita installments fora de 1-48', () => {
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(baseInput({ installments: 0 })).success).toBe(false);
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(baseInput({ installments: 49 })).success).toBe(false);
  });

  it('aceita variantId no item (M02.5e/M02.6)', () => {
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(
      baseInput({ items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }] }),
    ).success).toBe(true);
  });
});
