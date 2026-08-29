import { describe, expect, it } from 'vitest';
import {
  CommercialOperationRequestSchema,
  CommercialOperationSchema,
} from '@/contracts/domain/commercialOperation';
import { ProductV2Schema } from '@/contracts/domain/productV2';
import { buildCommercialQuote } from '@/lib/services/commercial-quote';
import {
  buildCommercialOperationEffectIds,
  buildCommercialOperationIdentity,
} from '@/lib/services/commercial-operation-admin';

const NOW = new Date('2026-08-29T15:00:00.000Z');

function quote(businessId = 'biz1') {
  const product = ProductV2Schema.parse({
    schemaVersion: 2,
    id: 'p1',
    businessId,
    kind: 'simple',
    name: 'Produto 1',
    category: 'Geral',
    unit: 'UN',
    purchaseUnit: 'UN',
    purchaseToStockFactor: 1,
    costMethod: 'moving_average',
    costPrice: 2,
    salePrice: 10,
    currentStock: 5,
    minStock: 0,
    trackStock: true,
    trackLots: false,
    trackExpiry: false,
    expiryWarningDays: 30,
    isActive: true,
    images: [],
    variants: [],
    menuAvailable: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  return buildCommercialQuote({
    schemaVersion: 2,
    businessId,
    channel: 'pdv',
    lines: [{ lineId: 'line-1', productId: product.id, quantity: 1 }],
    tipCents: 0,
  }, {
    products: new Map([[product.id, product]]),
    services: new Map(),
    canApplyManualDiscount: false,
  }, NOW);
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    businessId: 'biz1',
    idempotencyKey: 'checkout-contract-1',
    sourceType: 'sale',
    channel: 'pdv',
    quote: quote(),
    target: { collection: 'sales' },
    document: { businessId: 'biz1', status: 'finalizada', total: 10 },
    payments: [],
    benefits: [],
    actor: { id: 'user-1', name: 'Operador', type: 'user' },
    ...overrides,
  };
}

describe('M02.2 — contrato de commercialOperations', () => {
  it('valida cotação, tenant, coleção e total como uma única intenção', () => {
    expect(CommercialOperationRequestSchema.safeParse(request()).success).toBe(true);
    expect(CommercialOperationRequestSchema.safeParse(request({ target: { collection: 'orders' } })).success).toBe(false);
    expect(CommercialOperationRequestSchema.safeParse(request({
      document: { businessId: 'other', status: 'finalizada', total: 10 },
    })).success).toBe(false);
    expect(CommercialOperationRequestSchema.safeParse(request({
      document: { businessId: 'biz1', status: 'finalizada', total: 9.99 },
    })).success).toBe(false);
  });

  it('exige que pagamentos fechem exatamente em centavos', () => {
    expect(CommercialOperationRequestSchema.safeParse(request({
      payments: [{ allocationId: 'pix-1', method: 'pix', amountCents: 999, status: 'paid' }],
    })).success).toBe(false);
    expect(CommercialOperationRequestSchema.safeParse(request({
      payments: [{ allocationId: 'pix-1', method: 'pix', amountCents: 1000, status: 'paid' }],
    })).success).toBe(true);
  });

  it('gera IDs determinísticos por operação, pagamento, benefício e fiscal', () => {
    const parsed = CommercialOperationRequestSchema.parse(request({
      payments: [{ allocationId: 'pix-1', method: 'pix', amountCents: 1000, status: 'paid' }],
      benefits: [
        { intentId: 'coupon-1', type: 'coupon', referenceId: 'coupon-a', amountCents: 100 },
        { intentId: 'gift-1', type: 'gift_card', referenceId: 'gift-a', amountCents: 200 },
        { intentId: 'points-1', type: 'loyalty_points', amountCents: 50 },
      ],
      fiscalIntent: { type: 'nfce' },
    }));
    const first = buildCommercialOperationIdentity(parsed);
    const second = buildCommercialOperationIdentity(structuredClone(parsed));
    expect(second).toEqual(first);
    expect(first.effectIds).toEqual(buildCommercialOperationEffectIds(parsed, first.operationId));
    expect(first.effectIds.transactionIds['pix-1']).toMatch(/^transaction_/);
    expect(first.effectIds.couponRedemptionIds['coupon-1']).toMatch(/^couponredemption_/);
    expect(first.effectIds.giftCardRedemptionIds['gift-1']).toMatch(/^giftredemption_/);
    expect(first.effectIds.loyaltyTransactionIds['points-1']).toMatch(/^loyaltytx_/);
    expect(first.effectIds.fiscalDocumentId).toMatch(/^fiscaldoc_/);
  });

  it('isola a identidade determinística por tenant', () => {
    const first = buildCommercialOperationIdentity(request());
    const other = buildCommercialOperationIdentity(request({
      businessId: 'biz2',
      quote: quote('biz2'),
      document: { businessId: 'biz2', status: 'finalizada', total: 10 },
    }));
    expect(other.operationId).not.toBe(first.operationId);
    expect(other.effectIds.documentId).not.toBe(first.effectIds.documentId);
  });

  it('não aceita checkpoint parcial como operação concluída', () => {
    const identity = buildCommercialOperationIdentity(request());
    expect(CommercialOperationSchema.safeParse({
      schemaVersion: 1,
      operationId: identity.operationId,
      businessId: 'biz1',
      idempotencyKey: 'checkout-contract-1',
      requestFingerprint: identity.requestFingerprint,
      sourceType: 'sale',
      channel: 'pdv',
      status: 'completed',
      request: identity.request,
      effectIds: identity.effectIds,
      checkpoints: {},
      currentCheckpoint: null,
      attempts: 1,
      lease: null,
      compensation: { status: 'not_required' },
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }).success).toBe(false);
  });
});
