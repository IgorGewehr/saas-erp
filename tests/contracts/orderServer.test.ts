import { describe, it, expect } from 'vitest';
import { CreateOrderWithSideEffectsInputSchema } from '@/lib/contracts/api/services/order-server';
import { CreateOrderBodySchema } from '@/lib/contracts/api/v1/orders';
import { buildCreateOrderBody } from '@/lib/utils/vitrineProposal';

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

describe('expectedTotalCents / idempotencyKey (Vitrine)', () => {
  it('serviço aceita expectedTotalCents inteiro ≥ 0', () => {
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(baseInput({ expectedTotalCents: 15_000 })).success).toBe(true);
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(baseInput({ expectedTotalCents: 0 })).success).toBe(true);
  });

  it.each([-1, 10.5, '15000'])('serviço rejeita expectedTotalCents %j', (expectedTotalCents) => {
    expect(CreateOrderWithSideEffectsInputSchema.safeParse(baseInput({ expectedTotalCents })).success).toBe(false);
  });
});

describe('CreateOrderBodySchema (corpo de POST /api/b2b-orders e /api/v1/orders)', () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    type: 'b2b',
    items: [{ productId: 'p1', quantity: 1 }],
    ...overrides,
  });

  it('campos novos são opcionais — corpo antigo continua válido', () => {
    const parsed = CreateOrderBodySchema.safeParse(body());
    expect(parsed.success).toBe(true);
  });

  it('aceita idempotencyKey (UUID) e expectedTotalCents', () => {
    const parsed = CreateOrderBodySchema.parse(body({
      idempotencyKey: '5b3c0c9e-0000-4000-8000-000000000001', expectedTotalCents: 270_000,
    }));
    expect(parsed.idempotencyKey).toBe('5b3c0c9e-0000-4000-8000-000000000001');
    expect(parsed.expectedTotalCents).toBe(270_000);
  });

  it.each(['', 'curta', 'x'.repeat(101)])('rejeita idempotencyKey %j (8–100 chars)', (idempotencyKey) => {
    expect(CreateOrderBodySchema.safeParse(body({ idempotencyKey })).success).toBe(false);
  });

  it('rejeita expectedTotalCents negativo ou fracionário', () => {
    expect(CreateOrderBodySchema.safeParse(body({ expectedTotalCents: -5 })).success).toBe(false);
    expect(CreateOrderBodySchema.safeParse(body({ expectedTotalCents: 99.9 })).success).toBe(false);
  });

  it('o corpo que a Vitrine monta (buildCreateOrderBody) passa neste contrato sem perder campo', () => {
    const built = buildCreateOrderBody({
      businessId: 'biz_1',
      lines: [{ productId: 'p1', name: 'Pacote Spot 30s', unitPriceCents: 150_000, quantity: 2 }],
      clientId: 'cli_1',
      clientName: 'Padaria do Zé',
      discountCents: 30_000,
      discountReason: 'Promoção: Lançamento',
      installments: 3,
      idempotencyKey: '5b3c0c9e-0000-4000-8000-000000000001',
    });
    const parsed = CreateOrderBodySchema.parse(built);
    expect(parsed).toMatchObject({
      type: 'b2b',
      clientId: 'cli_1',
      clientName: 'Padaria do Zé',
      items: [{ productId: 'p1', quantity: 2 }],
      discount: 300,
      discountReason: 'Promoção: Lançamento',
      installments: 3,
      paymentTerms: '3x a cada 30 dias',
      idempotencyKey: '5b3c0c9e-0000-4000-8000-000000000001',
      expectedTotalCents: 270_000,
    });
  });
});
