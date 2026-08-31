import { describe, expect, it } from 'vitest';
import { CouponSchema } from '@/lib/contracts/domain/coupon';
import {
  compensateCommercialBenefitsAdmin,
  confirmCommercialBenefitsAdmin,
  loadCommercialBenefitResourcesAdmin,
  reserveCommercialBenefitsAdmin,
} from '@/lib/services/commercial-benefits-admin';
import type { CommercialOperationHandlerContext } from '@/lib/services/commercial-operation-admin';
import type { GiftCard, LoyaltyConfig } from '@/lib/types';

const NOW = new Date('2026-08-31T10:00:00.000Z');

function mockDb(data: Record<string, Record<string, any>> = {}) {
  const store = new Map<string, Map<string, any>>();
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
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
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
      // Criar mock refs que rastreiam colecao e docId
      const txGet = async (ref: any) => {
        return ref.get();
      };
      return cb({
        get: txGet,
        update: (ref: any, patch: any) => tx.update(ref, patch),
        create: (ref: any, data: any) => tx.create(ref, data),
        set: (ref: any, data: any) => tx.set(ref, data),
      });
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
