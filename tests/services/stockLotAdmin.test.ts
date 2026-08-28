import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { listStockLotsAdmin, stockLotExpiryStatus } from '@/lib/services/stock-lot-admin';

function makeFakeDb(documents: Array<{ id: string; data: Record<string, unknown> }>): Firestore {
  const query = (filters: Array<[string, unknown]> = []): Record<string, unknown> => ({
    where(field: string, operator: string, expected: unknown) {
      if (operator !== '==') throw new Error('unsupported');
      return query([...filters, [field, expected]]);
    },
    async get() {
      return {
        docs: documents
          .filter((document) => filters.every(([field, expected]) => document.data[field] === expected))
          .map((document) => ({ id: document.id, data: () => structuredClone(document.data) })),
      };
    },
  });
  return { collection: () => query() } as unknown as Firestore;
}

function lot(id: string, businessId: string, expiresAt?: string, currentQuantity = 2) {
  return {
    id,
    data: {
      schemaVersion: 1, businessId, productId: 'p1', productName: 'Produto', unit: 'UN',
      code: id, codeNormalized: id.toUpperCase(), status: currentQuantity > 0 ? 'active' : 'depleted',
      ...(expiresAt ? { expiresAt } : {}), initialQuantity: 2, currentQuantity, expiryWarningDays: 30,
      createdBy: 'u1', createdByName: 'Gestor', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

describe('stock lot queries', () => {
  it('classifica vencimento sem depender do fuso horário local', () => {
    expect(stockLotExpiryStatus('2026-08-24', 30, '2026-08-25')).toEqual({ status: 'expired', daysUntilExpiry: -1 });
    expect(stockLotExpiryStatus('2026-08-30', 30, '2026-08-25')).toEqual({ status: 'critical', daysUntilExpiry: 5 });
    expect(stockLotExpiryStatus('2026-08-15', 30, '2026-08-25').status).toBe('expired');
    expect(stockLotExpiryStatus(undefined, 30, '2026-08-25')).toEqual({ status: 'none' });
  });

  it('filtra por tenant, omite esgotados e produz o resumo de alertas', async () => {
    const result = await listStockLotsAdmin({
      db: makeFakeDb([
        lot('expired', 'biz-1', '2026-08-24'),
        lot('critical', 'biz-1', '2026-08-30'),
        lot('warning', 'biz-1', '2026-09-10'),
        lot('depleted', 'biz-1', '2026-08-20', 0),
        lot('foreign', 'biz-2', '2026-08-20'),
      ]),
      businessId: 'biz-1',
      today: '2026-08-25',
    });
    expect(result.lots.map((item) => item.id)).toEqual(['expired', 'critical', 'warning']);
    expect(result.summary).toEqual({ total: 3, active: 3, expired: 1, critical: 1, warning: 1 });
  });
});
