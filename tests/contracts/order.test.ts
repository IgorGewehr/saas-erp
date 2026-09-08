import { describe, it, expect } from 'vitest';
import { OrderSchema, OrderItemSchema } from '@/lib/contracts/domain/order';
import { canTransitionOrder, assertTransitionOrder } from '@/lib/contracts/fsm/order';

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    productId: 'p1',
    productName: 'Produto X',
    quantity: 2,
    unitPrice: 50,
    total: 100,
    ...overrides,
  };
}

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order1',
    businessId: 'biz1',
    type: 'b2b',
    status: 'pendente',
    items: [baseItem()],
    subtotal: 100,
    discount: 0,
    total: 100,
    operatorId: 'u1',
    operatorName: 'Operador',
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('OrderItemSchema', () => {
  it('aceita item de produto simples', () => {
    expect(OrderItemSchema.safeParse(baseItem()).success).toBe(true);
  });

  it('aceita variantId/serviceId (M02.6)', () => {
    expect(OrderItemSchema.safeParse(baseItem({ variantId: 'v1' })).success).toBe(true);
    expect(OrderItemSchema.safeParse({ ...baseItem({ productId: undefined }), serviceId: 's1' }).success).toBe(true);
  });

  it('rejeita total que não fecha com quantity*unitPrice-discount', () => {
    expect(OrderItemSchema.safeParse(baseItem({ total: 999 })).success).toBe(false);
  });
});

describe('OrderSchema', () => {
  it('aceita um pedido B2B válido', () => {
    expect(OrderSchema.safeParse(baseOrder()).success).toBe(true);
  });

  it('rejeita subtotal que não fecha com sum(items)', () => {
    expect(OrderSchema.safeParse(baseOrder({ subtotal: 999 })).success).toBe(false);
  });

  it('rejeita total que não fecha com subtotal-discount', () => {
    expect(OrderSchema.safeParse(baseOrder({ total: 999 })).success).toBe(false);
  });

  it('type=condicional exige conditionalExpiresAt', () => {
    expect(OrderSchema.safeParse(baseOrder({ type: 'condicional' })).success).toBe(false);
    expect(OrderSchema.safeParse(baseOrder({ type: 'condicional', conditionalExpiresAt: '2026-10-01' })).success).toBe(true);
  });

  it('aceita installments e campos de efeito de transição (M02.6)', () => {
    const parsed = OrderSchema.safeParse(baseOrder({
      installments: 3,
      invoicedAt: '2026-09-09T00:00:00.000Z',
      stockDeductedAt: '2026-09-09T00:00:00.000Z',
      transactionIds: ['tx1', 'tx2', 'tx3'],
    }));
    expect(parsed.success).toBe(true);
  });
});

describe('Order FSM', () => {
  it('pendente pode ir pra confirmado, condicional ou cancelado', () => {
    expect(canTransitionOrder('pendente', 'confirmado')).toBe(true);
    expect(canTransitionOrder('pendente', 'condicional')).toBe(true);
    expect(canTransitionOrder('pendente', 'cancelado')).toBe(true);
  });

  it('confirmado só pode ir pra faturado ou cancelado', () => {
    expect(canTransitionOrder('confirmado', 'faturado')).toBe(true);
    expect(canTransitionOrder('confirmado', 'cancelado')).toBe(true);
    expect(canTransitionOrder('confirmado', 'enviado')).toBe(false);
  });

  it('entregue e cancelado são terminais', () => {
    expect(canTransitionOrder('entregue', 'cancelado')).toBe(false);
    expect(canTransitionOrder('cancelado', 'pendente')).toBe(false);
  });

  it('assertTransitionOrder lança em transição inválida', () => {
    expect(() => assertTransitionOrder('pendente', 'entregue')).toThrow();
  });

  it('condicional pode confirmar ou cancelar, não pula pra faturado direto', () => {
    expect(canTransitionOrder('condicional', 'confirmado')).toBe(true);
    expect(canTransitionOrder('condicional', 'cancelado')).toBe(true);
    expect(canTransitionOrder('condicional', 'faturado')).toBe(false);
  });
});
