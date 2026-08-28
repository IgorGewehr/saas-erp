import { describe, expect, it } from 'vitest';
import {
  buildM01HomologationSnapshot,
  compareM01HomologationSnapshots,
  type M01AuditDocument,
} from '@/lib/services/m01-homologation-audit';

const capturedAt = '2026-08-28T20:00:00.000Z';

function product(
  id: string,
  currentStock: number,
  costPrice: number,
  extra: Record<string, unknown> = {},
): M01AuditDocument {
  return { id, data: { businessId: 'biz-1', currentStock, costPrice, ...extra } };
}

function lot(
  id: string,
  productId: string,
  currentQuantity: number,
  unitCost: number,
  extra: Record<string, unknown> = {},
): M01AuditDocument {
  return { id, data: { businessId: 'biz-1', productId, currentQuantity, unitCost, ...extra } };
}

describe('M01.9 — auditoria read-only de homologação', () => {
  it('captura produto, variações e lotes do tenant em ordem determinística', () => {
    const snapshot = buildM01HomologationSnapshot({
      businessId: 'biz-1',
      capturedAt,
      products: [
        product('p2', 0, 8, {
          trackLots: true,
          variants: [
            { id: 'blue', currentStock: 2, costPrice: 8 },
            { id: 'red', currentStock: 3, costPrice: 9 },
          ],
        }),
        product('p1', 5, 4),
      ],
      stockLots: [
        lot('lot-red', 'p2', 3, 9, { variantId: 'red' }),
        lot('lot-blue', 'p2', 2, 8, { variantId: 'blue' }),
      ],
    });

    expect(snapshot.summary).toEqual({ products: 2, variants: 2, lots: 2, issues: 0 });
    expect(snapshot.entries.map((entry) => entry.key)).toEqual([
      'lot:lot-blue',
      'lot:lot-red',
      'product:p1',
      'product:p2',
      'variant:p2:blue',
      'variant:p2:red',
    ]);
    expect(snapshot.issues).toEqual([]);
  });

  it('compara antes/depois sem falso positivo quando saldo e custo foram preservados', () => {
    const documents = [product('p1', 5, 4), product('p2', 2, 7)];
    const before = buildM01HomologationSnapshot({
      businessId: 'biz-1', capturedAt, products: documents, stockLots: [],
    });
    const after = buildM01HomologationSnapshot({
      businessId: 'biz-1', capturedAt: '2026-08-28T21:00:00.000Z', products: [...documents].reverse(), stockLots: [],
    });

    expect(compareM01HomologationSnapshots(before, after)).toMatchObject({
      businessId: 'biz-1',
      preserved: true,
      comparedEntries: 2,
      unchangedEntries: 2,
      differences: [],
    });
  });

  it('expõe diferenças de saldo, custo, inclusão e remoção', () => {
    const before = buildM01HomologationSnapshot({
      businessId: 'biz-1', capturedAt,
      products: [product('changed', 5, 4), product('removed', 1, 2)], stockLots: [],
    });
    const after = buildM01HomologationSnapshot({
      businessId: 'biz-1', capturedAt: '2026-08-28T21:00:00.000Z',
      products: [product('changed', 3, 4.5), product('added', 9, 1)], stockLots: [],
    });

    const comparison = compareM01HomologationSnapshots(before, after);
    expect(comparison.preserved).toBe(false);
    expect(comparison.differences).toEqual([
      expect.objectContaining({ key: 'product:added', status: 'added', afterStock: 9 }),
      expect.objectContaining({
        key: 'product:changed', status: 'changed', stockDelta: -2, unitCostDelta: 0.5,
      }),
      expect.objectContaining({ key: 'product:removed', status: 'removed', beforeStock: 1 }),
    ]);
  });

  it('denuncia documento de outro tenant e lote órfão sem contaminar os saldos', () => {
    const snapshot = buildM01HomologationSnapshot({
      businessId: 'biz-1',
      capturedAt,
      products: [product('own', 1, 2), { id: 'foreign', data: { businessId: 'biz-2', currentStock: 99, costPrice: 99 } }],
      stockLots: [lot('orphan', 'missing', 1, 2)],
    });

    expect(snapshot.entries.find((entry) => entry.productId === 'foreign')).toBeUndefined();
    expect(snapshot.issues.map((issue) => issue.code)).toEqual(['TENANT_MISMATCH', 'ORPHAN_LOT']);
  });

  it('recusa comparar snapshots de empresas diferentes', () => {
    const before = buildM01HomologationSnapshot({ businessId: 'biz-1', capturedAt, products: [], stockLots: [] });
    const after = buildM01HomologationSnapshot({ businessId: 'biz-2', capturedAt, products: [], stockLots: [] });
    expect(() => compareM01HomologationSnapshots(before, after)).toThrow(/businessId diferentes/);
  });
});
