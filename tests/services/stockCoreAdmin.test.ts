import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  applyStockOperationAdmin,
  InsufficientStockError,
  StockIdempotencyConflictError,
  StockReferenceError,
  type StockOperationInput,
} from '@/lib/services/stock-core-admin';
import { StockMovementV2Schema } from '@/lib/contracts/domain/stockMovementV2';
import type { Product } from '@/lib/types';

interface FakeRef {
  id: string;
  _coll: string;
}

function product(
  id: string,
  currentStock: number,
  extra: Partial<Product> = {},
): Product {
  return {
    id,
    businessId: 'biz1',
    name: `Produto ${id}`,
    category: 'Geral',
    unit: 'UN',
    costPrice: 2,
    salePrice: 5,
    currentStock,
    minStock: 0,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as Product;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function makeFakeDb(initialProducts: Product[], extraDocuments: Record<string, Record<string, unknown>> = {}) {
  const documents = new Map<string, Record<string, unknown>>();
  for (const item of initialProducts) {
    const { id, ...data } = item;
    documents.set(`products/${id}`, clone(data));
  }
  for (const [path, data] of Object.entries(extraDocuments)) documents.set(path, clone(data));

  const db = {
    collection(coll: string) {
      return {
        doc(id: string): FakeRef {
          return { id, _coll: coll };
        },
      };
    },
    async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      const pending: Array<
        | { kind: 'set'; ref: FakeRef; data: Record<string, unknown> }
        | { kind: 'update'; ref: FakeRef; data: Record<string, unknown> }
      > = [];
      const tx = {
        async get(ref: FakeRef) {
          const data = documents.get(`${ref._coll}/${ref.id}`);
          return {
            id: ref.id,
            exists: !!data,
            data: () => (data ? clone(data) : undefined),
          };
        },
        set(ref: FakeRef, data: Record<string, unknown>) {
          pending.push({ kind: 'set', ref, data: clone(data) });
        },
        update(ref: FakeRef, patch: Record<string, unknown>) {
          pending.push({ kind: 'update', ref, data: clone(patch) });
        },
      };

      const result = await handler(tx);
      for (const write of pending) {
        const path = `${write.ref._coll}/${write.ref.id}`;
        if (write.kind === 'set') {
          documents.set(path, clone(write.data));
        } else {
          const current = documents.get(path);
          if (!current) throw new Error(`Documento ausente no update: ${path}`);
          documents.set(path, { ...current, ...clone(write.data) });
        }
      }
      return result;
    },
  };

  return {
    db: db as unknown as Firestore,
    get(path: string) {
      const data = documents.get(path);
      return data ? clone(data) : undefined;
    },
    list(collection: string) {
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(`${collection}/`))
        .map(([path, data]) => ({ id: path.slice(collection.length + 1), data: clone(data) }));
    },
  };
}

function baseInput(overrides: Partial<StockOperationInput> = {}): StockOperationInput {
  return {
    businessId: 'biz1',
    type: 'saida',
    lines: [{ productId: 'p1', quantity: 2, sourceLineId: 'item-1' }],
    operatorId: 'user-1',
    operatorName: 'Operador',
    reason: 'Venda #1',
    sourceType: 'sale',
    sourceId: 'sale-1',
    idempotencyKey: 'sale:sale-1:stock',
    negativeStockPolicy: 'prevent',
    ...overrides,
  };
}

describe('applyStockOperationAdmin', () => {
  it('grava produto, movimento V2 e saldos exatos na mesma transação', async () => {
    const fake = makeFakeDb([product('p1', 10, { minStock: 3 })]);

    const result = await applyStockOperationAdmin(fake.db, baseInput());

    expect(result.replayed).toBe(false);
    expect(result.adjustments[0]).toMatchObject({
      productId: 'p1',
      delta: -2,
      previousStock: 10,
      newStock: 8,
    });
    expect(fake.get('products/p1')?.currentStock).toBe(8);

    const movements = fake.list('stockMovements');
    expect(movements).toHaveLength(1);
    expect(StockMovementV2Schema.parse({ id: movements[0].id, ...movements[0].data })).toMatchObject({
      schemaVersion: 2,
      sourceType: 'sale',
      sourceId: 'sale-1',
      sourceLineId: 'item-1',
      balanceAccuracy: 'exact',
      previousStock: 10,
      newStock: 8,
    });
  });

  it('reexecuta a mesma chave como replay sem duplicar saldo ou movimento', async () => {
    const fake = makeFakeDb([product('p1', 10)]);
    const input = baseInput();

    const first = await applyStockOperationAdmin(fake.db, input);
    const replay = await applyStockOperationAdmin(fake.db, input);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.operationId).toBe(first.operationId);
    expect(fake.get('products/p1')?.currentStock).toBe(8);
    expect(fake.list('stockMovements')).toHaveLength(1);
  });

  it('mantém o replay quando apenas o rótulo humano da origem muda', async () => {
    const fake = makeFakeDb([product('p1', 10)]);
    const first = await applyStockOperationAdmin(fake.db, baseInput());
    const replay = await applyStockOperationAdmin(fake.db, baseInput({ reason: 'Venda renumerada #2' }));

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(fake.get('products/p1')?.currentStock).toBe(8);
  });

  it('rejeita reutilização da chave com payload diferente', async () => {
    const fake = makeFakeDb([product('p1', 10)]);
    await applyStockOperationAdmin(fake.db, baseInput());

    await expect(
      applyStockOperationAdmin(fake.db, baseInput({
        lines: [{ productId: 'p1', quantity: 3 }],
      })),
    ).rejects.toBeInstanceOf(StockIdempotencyConflictError);
    expect(fake.get('products/p1')?.currentStock).toBe(8);
  });

  it('aborta a operação inteira quando um produto pertence a outro tenant', async () => {
    const fake = makeFakeDb([product('p1', 10, { businessId: 'biz2' })]);

    await expect(applyStockOperationAdmin(fake.db, baseInput())).rejects.toBeInstanceOf(StockReferenceError);
    expect(fake.get('products/p1')?.currentStock).toBe(10);
    expect(fake.list('stockMovements')).toHaveLength(0);
    expect(fake.list('stockOperations')).toHaveLength(0);
  });

  it('expande e agrega BOM usando os saldos autoritativos das folhas', async () => {
    const combo = product('combo', 0, {
      components: [
        { productId: 'farinha', productName: 'Farinha', quantity: 2 },
        { productId: 'queijo', productName: 'Queijo', quantity: 1 },
      ],
    });
    const fake = makeFakeDb([
      combo,
      product('farinha', 10),
      product('queijo', 5),
    ]);

    const result = await applyStockOperationAdmin(fake.db, baseInput({
      lines: [
        { productId: 'combo', quantity: 2 },
        { productId: 'farinha', quantity: 1 },
      ],
      sourceId: 'sale-bom',
      idempotencyKey: 'sale:sale-bom:stock',
    }));

    expect(result.adjustments).toHaveLength(2);
    expect(fake.get('products/combo')?.currentStock).toBe(0);
    expect(fake.get('products/farinha')?.currentStock).toBe(5);
    expect(fake.get('products/queijo')?.currentStock).toBe(3);
  });

  it('bloqueia a última unidade concorrente com política estrita', async () => {
    const fake = makeFakeDb([product('p1', 1)]);
    await applyStockOperationAdmin(fake.db, baseInput({
      lines: [{ productId: 'p1', quantity: 1 }],
      sourceId: 'sale-a',
      idempotencyKey: 'sale:sale-a:stock',
    }));

    await expect(applyStockOperationAdmin(fake.db, baseInput({
      lines: [{ productId: 'p1', quantity: 1 }],
      sourceId: 'sale-b',
      idempotencyKey: 'sale:sale-b:stock',
    }))).rejects.toBeInstanceOf(InsufficientStockError);
    expect(fake.get('products/p1')?.currentStock).toBe(0);
  });

  it('aplica ajuste assinado sem expandir BOM e centraliza o alerta de mínimo', async () => {
    const fake = makeFakeDb([product('p1', 6, { minStock: 5 })]);

    const result = await applyStockOperationAdmin(fake.db, baseInput({
      type: 'ajuste',
      lines: [{ productId: 'p1', quantity: -2 }],
      sourceType: 'manual',
      sourceId: undefined,
      idempotencyKey: 'manual:p1:adjust-1',
      reason: 'Inventário físico',
      expandBom: false,
    }));

    expect(result.adjustments[0]).toMatchObject({
      delta: -2,
      previousStock: 6,
      newStock: 4,
      alert: { severity: 'min', minStock: 5 },
    });
    const movement = fake.list('stockMovements')[0];
    expect(movement.data).toMatchObject({ type: 'ajuste', quantity: -2, newStock: 4 });
  });

  it('converte ajuste absoluto legado em delta exato no ledger V2', async () => {
    const fake = makeFakeDb([product('p1', 6)]);

    const result = await applyStockOperationAdmin(fake.db, baseInput({
      type: 'ajuste',
      lines: [{ productId: 'p1', quantity: 2 }],
      sourceType: 'api',
      sourceId: 'request-1',
      idempotencyKey: 'api:request-1',
      reason: 'Compatibilidade API v1',
      expandBom: false,
      adjustmentMode: 'absolute',
    }));

    expect(result.adjustments[0]).toMatchObject({ previousStock: 6, delta: -4, newStock: 2 });
    expect(fake.list('stockMovements')[0].data).toMatchObject({
      type: 'ajuste',
      quantity: -4,
      previousStock: 6,
      newStock: 2,
    });
  });

  it('valida o tenant do documento de origem quando ele é informado', async () => {
    const fake = makeFakeDb(
      [product('p1', 10)],
      { 'sales/sale-1': { businessId: 'biz2' } },
    );

    await expect(applyStockOperationAdmin(fake.db, baseInput({
      sourceDocument: { collection: 'sales', id: 'sale-1', existence: 'required' },
    }))).rejects.toBeInstanceOf(StockReferenceError);
    expect(fake.get('products/p1')?.currentStock).toBe(10);
  });
});
