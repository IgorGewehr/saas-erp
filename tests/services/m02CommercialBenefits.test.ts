import { describe, expect, it } from 'vitest';
import { CouponSchema } from '@/lib/contracts/domain/coupon';
import { ProductV2Schema } from '@/contracts/domain/productV2';
import {
  compensateCommercialBenefitsAdmin,
  confirmCommercialBenefitsAdmin,
  loadCommercialBenefitResourcesAdmin,
  reserveCommercialBenefitsAdmin,
} from '@/lib/services/commercial-benefits-admin';
import { buildCommercialOperationIdentity } from '@/lib/services/commercial-operation-admin';
import { buildCommercialQuote } from '@/lib/services/commercial-quote';
import type { GiftCard, LoyaltyConfig } from '@/lib/types';

const NOW = new Date('2026-08-31T10:00:00.000Z');

function mockDb(data: Record<string, Record<string, any>> = {}) {
  const store = new Map<string, Map<string, any>>();
  let transactionTail: Promise<void> = Promise.resolve();
  Object.entries(data).forEach(([col, docs]) => {
    const colMap = new Map<string, any>();
    Object.entries(docs).forEach(([id, docData]) => colMap.set(id, docData));
    store.set(col, colMap);
  });

  const getCol = (colName: string) => {
    if (!store.has(colName)) store.set(colName, new Map());
    return store.get(colName)!;
  };

  return {
    collection: (colName: string) => {
      return {
        doc: (docId: string) => ({
          _colName: colName,
          _docId: docId,
          get: async () => {
            const col = getCol(colName);
            const exists = col.has(docId);
            return {
              exists,
              id: docId,
              data: () => col.get(docId),
            };
          },
        }),
        where: (field: string, op: string, val: any) => {
          const createWhere = (conditions: Array<[string, string, any]>) => ({
            where: (fNext: string, opNext: string, vNext: any) => createWhere([...conditions, [fNext, opNext, vNext]]),
            limit: (n: number) => ({
              get: async () => {
                const col = getCol(colName);
                const docs = [...col.entries()]
                  .filter(([, d]) => conditions.every(([f, , v]) => d[f] === v))
                  .slice(0, n)
                  .map(([id, d]) => ({ id, data: () => d }));
                return { docs };
              },
            }),
            get: async () => {
              const col = getCol(colName);
              const docs = [...col.entries()]
                .filter(([, d]) => conditions.every(([f, , v]) => d[f] === v))
                .map(([id, d]) => ({ id, data: () => d }));
              return { docs };
            },
          });
          return createWhere([[field, op, val]]);
        },
      };
    },
    // M02.10: serializa transações numa fila (mesmo padrão de
    // stockCoreAdmin.test.ts/commercialOperationAdmin.test.ts) — SEM isso,
    // dois `runTransaction` concorrentes rodam callbacks entrelaçados sem
    // nenhum isolamento real, e um teste de corrida daria falso-positivo
    // (passaria mesmo se o código não tivesse guard nenhum). Cada transação
    // só lê o estado depois que a anterior já commitou.
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        const tx = {
          get: async (ref: any) => ref.get(),
          update: (ref: any, patch: any) => {
            const colName = ref._colName;
            const docId = ref._docId;
            const col = getCol(colName);
            const current = col.get(docId) || {};
            col.set(docId, { ...current, ...patch });
          },
          create: (ref: any, data: any) => {
            const colName = ref._colName;
            const docId = ref._docId;
            const col = getCol(colName);
            col.set(docId, data);
          },
          set: (ref: any, data: any) => {
            const colName = ref._colName;
            const docId = ref._docId;
            const col = getCol(colName);
            col.set(docId, data);
          },
        };
        return await cb(tx);
      } finally {
        release();
      }
    },
    _store: store,
  };
}

function mockDocRef(db: any, colName: string, docId: string) {
  return {
    _colName: colName,
    _docId: docId,
    get: async () => {
      const col = db._store.get(colName) || new Map();
      const exists = col.has(docId);
      return {
        exists,
        id: docId,
        data: () => col.get(docId),
      };
    },
  };
}

describe('M02.4 — Ledgers e serviços de benefícios comerciais', () => {
  it('carrega recursos autoritativos de cupom, gift card, fidelidade e cliente por tenant', async () => {
    const coupon = {
      id: 'cp-1',
      businessId: 'biz-1',
      code: 'PROMO10',
      discountType: 'fixed',
      discountValue: 10,
      appliesTo: 'all',
      status: 'active',
      usedCount: 0,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const giftCard: GiftCard = {
      id: 'gf-1',
      businessId: 'biz-1',
      code: 'GIFT50',
      originalValue: 50,
      remainingValue: 50,
      status: 'active',
      purchasedAt: NOW.toISOString(),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const loyalty: LoyaltyConfig = {
      isEnabled: true,
      pointsPerReal: 1,
      pointValueInCentavos: 10,
      minPointsToRedeem: 10,
    };
    const client = {
      id: 'cli-1',
      businessId: 'biz-1',
      name: 'Cliente Teste',
      loyaltyPoints: 100,
      visitCount: 2,
    };

    const db = mockDb({
      coupons: { 'cp-1': coupon },
      giftCards: { 'gf-1': giftCard },
      businesses: { 'biz-1': { id: 'biz-1', settings: { loyalty } } },
      clients: { 'cli-1': client },
    });

    const resources = await loadCommercialBenefitResourcesAdmin({
      db: db as any,
      businessId: 'biz-1',
      clientId: 'cli-1',
      couponCode: 'promo10',
      giftCardCodes: ['gift50'],
    });

    expect(resources.coupon?.id).toBe('cp-1');
    expect(resources.giftCards.get('GIFT50')?.id).toBe('gf-1');
    expect(resources.loyalty?.pointsPerReal).toBe(1);
    expect(resources.client?.loyaltyPoints).toBe(100);
  });
});

describe('M02.5a — reserva de cupom respeita o frete/tipo de entrega real da cotação', () => {
  function deliveryQuote() {
    const product = ProductV2Schema.parse({
      schemaVersion: 2,
      id: 'p1',
      businessId: 'biz-1',
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
      businessId: 'biz-1',
      channel: 'site',
      lines: [{ lineId: 'line-1', productId: product.id, quantity: 1 }],
      delivery: { type: 'entrega' },
      tipCents: 0,
    }, {
      products: new Map([[product.id, product]]),
      services: new Map(),
      canApplyManualDiscount: false,
      delivery: { feeCents: 500, resolution: 'flat' },
    }, NOW);
  }

  function deliveryRequest(benefits: Record<string, unknown>[]) {
    const quote = deliveryQuote();
    return {
      schemaVersion: 1,
      businessId: 'biz-1',
      idempotencyKey: 'delivery-checkout-1',
      sourceType: 'deliveryOrder',
      channel: 'site',
      quote,
      target: { collection: 'deliveryOrders' },
      document: { businessId: 'biz-1', status: 'recebido', total: quote.pricing.totalCents / 100 },
      payments: [],
      benefits,
      actor: { id: 'public', name: 'Cardápio online', type: 'system' },
    };
  }

  it('aplica cupom appliesTo=entrega num pedido de entrega (antes da correção, era sempre wrong_channel)', async () => {
    const coupon = CouponSchema.parse({
      id: 'cp-entrega',
      businessId: 'biz-1',
      code: 'FRETE-OK',
      discountType: 'fixed',
      discountValue: 5,
      appliesTo: 'entrega',
      status: 'active',
      usedCount: 0,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const rawRequest = deliveryRequest([{
      intentId: 'coupon-1',
      type: 'coupon',
      action: 'redeem',
      referenceId: coupon.id,
      code: coupon.code,
      amountCents: 500,
    }]);
    const { request, operationId, requestFingerprint, effectIds } = buildCommercialOperationIdentity(rawRequest);
    const db = mockDb({ coupons: { 'cp-entrega': coupon } });

    const effects = await reserveCommercialBenefitsAdmin({
      db: db as any,
      operationId,
      requestFingerprint,
      request,
      effectIds,
      documentId: effectIds.documentId,
    });

    expect(effects.couponRedemptionIds).toHaveLength(1);
    const ledgerId = effectIds.couponRedemptionIds['coupon-1'];
    expect(db._store.get('couponRedemptions')?.get(ledgerId)?.status).toBe('reserved');
  });

  it('reserva cupom de frete grátis pelo valor do frete autoritativo da cotação, não por evaluation.discount', async () => {
    const coupon = CouponSchema.parse({
      id: 'cp-free',
      businessId: 'biz-1',
      code: 'FRETEGRATIS',
      discountType: 'free_delivery',
      discountValue: 0,
      appliesTo: 'all',
      status: 'active',
      usedCount: 0,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    const rawRequest = deliveryRequest([{
      intentId: 'coupon-1',
      type: 'coupon',
      action: 'redeem',
      referenceId: coupon.id,
      code: coupon.code,
      amountCents: 500, // == quote.delivery.feeCents, não evaluation.discount (que é 0)
    }]);
    const { request, operationId, requestFingerprint, effectIds } = buildCommercialOperationIdentity(rawRequest);
    const db = mockDb({ coupons: { 'cp-free': coupon } });

    const effects = await reserveCommercialBenefitsAdmin({
      db: db as any,
      operationId,
      requestFingerprint,
      request,
      effectIds,
      documentId: effectIds.documentId,
    });

    expect(effects.couponRedemptionIds).toHaveLength(1);
  });
});

// M02.10 — achado da investigação: este era o único arquivo de teste do
// núcleo de benefícios (M02.4) e não tinha NENHUM caso de concorrência nem de
// TENANT_MISMATCH, apesar de `commercial-benefits-admin.ts` ter 6 pontos de
// `fail('TENANT_MISMATCH', ...)`. O mock ganhou serialização de transação
// (topo do arquivo) especificamente pra estes testes não darem falso-positivo.
describe('M02.10 — concorrência e isolamento multi-tenant no núcleo de benefícios', () => {
  function quote() {
    const product = ProductV2Schema.parse({
      schemaVersion: 2,
      id: 'p1',
      businessId: 'biz-1',
      kind: 'simple',
      name: 'Produto 1',
      category: 'Geral',
      unit: 'UN',
      purchaseUnit: 'UN',
      purchaseToStockFactor: 1,
      costMethod: 'moving_average',
      costPrice: 2,
      salePrice: 100,
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
      businessId: 'biz-1',
      channel: 'pdv',
      lines: [{ lineId: 'line-1', productId: product.id, quantity: 1 }],
      tipCents: 0,
    }, {
      products: new Map([[product.id, product]]),
      services: new Map(),
      canApplyManualDiscount: false,
    }, NOW);
  }

  function saleRequest(idempotencyKey: string, benefits: Record<string, unknown>[]) {
    return {
      schemaVersion: 1,
      businessId: 'biz-1',
      idempotencyKey,
      sourceType: 'sale',
      channel: 'pdv',
      quote: quote(),
      target: { collection: 'sales' },
      document: { businessId: 'biz-1', status: 'finalizada', total: 100 },
      payments: [],
      benefits,
      actor: { id: 'user-1', name: 'Operador', type: 'user' },
    };
  }

  function reserveFor(db: any, idempotencyKey: string, benefits: Record<string, unknown>[]) {
    const { request, operationId, requestFingerprint, effectIds } =
      buildCommercialOperationIdentity(saleRequest(idempotencyKey, benefits));
    return reserveCommercialBenefitsAdmin({
      db, operationId, requestFingerprint, request, effectIds, documentId: effectIds.documentId,
    });
  }

  it('duas vendas concorrentes disputando o último uso de um cupom — só uma resgata', async () => {
    const coupon = {
      id: 'cp-limit1', businessId: 'biz-1', code: 'UNICO', discountType: 'fixed', discountValue: 10,
      appliesTo: 'all', status: 'active', usageLimit: 1, usedCount: 0,
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    const db = mockDb({ coupons: { 'cp-limit1': coupon } });

    const benefit = (intentId: string) => [{
      intentId, type: 'coupon', action: 'redeem', referenceId: 'cp-limit1', code: 'UNICO', amountCents: 1000,
    }];

    const attempts = await Promise.allSettled([
      reserveFor(db, 'sale-a-001', benefit('coupon-a')),
      reserveFor(db, 'sale-b-001', benefit('coupon-b')),
    ]);

    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((a) => a.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason?.code).toBe('COUPON_EXHAUSTED');
    expect(db._store.get('coupons')?.get('cp-limit1')?.usedCount).toBe(1);
    expect(db._store.get('coupons')?.get('cp-limit1')?.status).toBe('exhausted');
    expect([...(db._store.get('couponRedemptions')?.values() ?? [])]).toHaveLength(1);
  });

  it('duas vendas concorrentes disputando o saldo do mesmo gift card — só uma cabe', async () => {
    const giftCard: GiftCard = {
      id: 'gf-limit', businessId: 'biz-1', code: 'SALDO30', originalValue: 30, remainingValue: 30,
      status: 'active', purchasedAt: NOW.toISOString(), createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    const db = mockDb({ giftCards: { 'gf-limit': giftCard } });

    const benefit = (intentId: string) => [{
      intentId, type: 'gift_card', action: 'redeem', referenceId: 'gf-limit', code: 'SALDO30', amountCents: 2000,
    }];

    const attempts = await Promise.allSettled([
      reserveFor(db, 'sale-a-001', benefit('gift-a')),
      reserveFor(db, 'sale-b-001', benefit('gift-b')),
    ]);

    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((a) => a.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason?.code).toBe('GIFT_CARD_INSUFFICIENT');
    expect(db._store.get('giftCards')?.get('gf-limit')?.remainingValue).toBe(10);
    expect([...(db._store.get('giftCardRedemptions')?.values() ?? [])]).toHaveLength(1);
  });

  it('rejeita cupom de outro negócio (TENANT_MISMATCH)', async () => {
    const coupon = {
      id: 'cp-other', businessId: 'biz-2', code: 'ALHEIO', discountType: 'fixed', discountValue: 10,
      appliesTo: 'all', status: 'active', usedCount: 0,
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    const db = mockDb({ coupons: { 'cp-other': coupon } });

    let caught: unknown;
    try {
      await reserveFor(db, 'sale-a-001', [{
        intentId: 'coupon-a', type: 'coupon', action: 'redeem', referenceId: 'cp-other', code: 'ALHEIO', amountCents: 1000,
      }]);
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string })?.code).toBe('TENANT_MISMATCH');
  });

  it('rejeita gift card de outro negócio (TENANT_MISMATCH)', async () => {
    const giftCard: GiftCard = {
      id: 'gf-other', businessId: 'biz-2', code: 'ALHEIO50', originalValue: 50, remainingValue: 50,
      status: 'active', purchasedAt: NOW.toISOString(), createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    const db = mockDb({ giftCards: { 'gf-other': giftCard } });

    let caught: unknown;
    try {
      await reserveFor(db, 'sale-a-001', [{
        intentId: 'gift-a', type: 'gift_card', action: 'redeem', referenceId: 'gf-other', code: 'ALHEIO50', amountCents: 1000,
      }]);
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string })?.code).toBe('TENANT_MISMATCH');
  });
});
