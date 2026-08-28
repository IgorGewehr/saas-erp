import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  applyStockOperationAdmin,
  InsufficientStockError,
  StockDependencyConflictError,
  StockIdempotencyConflictError,
  StockLotConflictError,
  StockReferenceError,
  type StockOperationInput,
} from '@/lib/services/stock-core-admin';
import { StockMovementV2Schema } from '@/lib/contracts/domain/stockMovementV2';
import type { Product } from '@/lib/types';

interface FakeRef {
  id: string;
  _coll: string;
}

interface FakeQuery {
  _coll: string;
  _filters: Array<{ field: string; expected: unknown }>;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
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
  let transactionTail: Promise<void> = Promise.resolve();
  for (const item of initialProducts) {
    const { id, ...data } = item;
    documents.set(`products/${id}`, clone(data));
  }
  for (const [path, data] of Object.entries(extraDocuments)) documents.set(path, clone(data));

  const db = {
    collection(coll: string) {
      const makeQuery = (filters: FakeQuery['_filters']): FakeQuery => ({
        _coll: coll,
        _filters: filters,
        where(field: string, operator: string, expected: unknown) {
          if (operator !== '==') throw new Error(`Operador não suportado: ${operator}`);
          return makeQuery([...filters, { field, expected }]);
        },
      });
      return {
        doc(id: string): FakeRef {
          return { id, _coll: coll };
        },
        where(field: string, operator: string, expected: unknown) {
          return makeQuery([]).where(field, operator, expected);
        },
      };
    },
    async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      const previousTransaction = transactionTail;
      let releaseTransaction!: () => void;
      transactionTail = new Promise<void>((resolve) => { releaseTransaction = resolve; });
      await previousTransaction;
      const pending: Array<
        | { kind: 'set'; ref: FakeRef; data: Record<string, unknown> }
        | { kind: 'update'; ref: FakeRef; data: Record<string, unknown> }
      > = [];
      const tx = {
        async get(ref: FakeRef | FakeQuery) {
          if ('_filters' in ref) {
            const docs = [...documents.entries()]
              .filter(([path, data]) => path.startsWith(`${ref._coll}/`)
                && ref._filters.every((filter) => data[filter.field] === filter.expected))
              .map(([path, data]) => ({
                id: path.slice(ref._coll.length + 1),
                exists: true,
                data: () => clone(data),
              }));
            return { docs, empty: docs.length === 0 };
          }
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

      try {
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
      } finally {
        releaseTransaction();
      }
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

  it('atualiza saldo e custo médio da entrada na mesma transação e preserva o replay', async () => {
    const fake = makeFakeDb([product('p1', 10, { costPrice: 2 })]);
    const input = baseInput({
      type: 'entrada',
      lines: [{ productId: 'p1', quantity: 5, sourceLineId: 'line-1', unitCost: 8 }],
      sourceType: 'purchase',
      sourceId: 'purchase-1',
      sourceDocument: undefined,
      idempotencyKey: 'purchase:purchase-1:line:line-1:entry',
      reason: 'NF-e 1/1',
      expandBom: false,
      requireActiveProducts: true,
    });

    const first = await applyStockOperationAdmin(fake.db, input);
    const replay = await applyStockOperationAdmin(fake.db, input);

    expect(first.adjustments[0]).toMatchObject({
      previousStock: 10, newStock: 15, unitCost: 8, previousCost: 2, newCost: 4,
    });
    expect(replay.replayed).toBe(true);
    expect(fake.get('products/p1')).toMatchObject({ currentStock: 15, costPrice: 4 });
    expect(fake.list('stockMovements')).toHaveLength(1);
    expect(fake.list('stockMovements')[0].data).toMatchObject({
      unitCost: 8, costTotal: 40, previousCost: 2, newCost: 4, costMethod: 'moving_average',
    });
  });

  it('restaura saldo e custo por saída compensatória com pré-condições exatas', async () => {
    const fake = makeFakeDb([product('p1', 15, { costPrice: 4 })]);

    const result = await applyStockOperationAdmin(fake.db, baseInput({
      type: 'saida',
      lines: [{
        productId: 'p1', quantity: 5, sourceLineId: 'line-1', expectedCurrentStock: 15,
        costRestoration: { expectedCurrentCost: 4, targetCost: 2 },
        reversalOfMovementId: 'stockmv-original',
      }],
      sourceType: 'purchase',
      sourceId: 'purchase-1',
      idempotencyKey: 'purchase:purchase-1:line:line-1:reversal',
      reason: 'Reversão NF-e 1/1',
      expandBom: false,
    }));

    expect(result.adjustments[0]).toMatchObject({ previousStock: 15, newStock: 10, previousCost: 4, newCost: 2 });
    expect(fake.get('products/p1')).toMatchObject({ currentStock: 10, costPrice: 2 });
    expect(fake.list('stockMovements')[0].data).toMatchObject({
      type: 'saida', costRestored: true, reversalOfMovementId: 'stockmv-original', previousCost: 4, newCost: 2,
    });
  });

  it('bloqueia compensação quando saldo ou custo já mudou', async () => {
    const fake = makeFakeDb([product('p1', 15, { costPrice: 4 })]);

    await expect(applyStockOperationAdmin(fake.db, baseInput({
      type: 'saida',
      lines: [{
        productId: 'p1', quantity: 5, expectedCurrentStock: 14,
        costRestoration: { expectedCurrentCost: 4, targetCost: 2 },
        reversalOfMovementId: 'stockmv-original',
      }],
      sourceType: 'purchase',
      sourceId: 'purchase-1',
      idempotencyKey: 'purchase:purchase-1:line:line-1:reversal-conflict',
      reason: 'Reversão NF-e 1/1',
      expandBom: false,
    }))).rejects.toBeInstanceOf(StockDependencyConflictError);

    expect(fake.get('products/p1')).toMatchObject({ currentStock: 15, costPrice: 4 });
    expect(fake.list('stockMovements')).toHaveLength(0);
    expect(fake.list('stockOperations')).toHaveLength(0);
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
    const attempts = await Promise.allSettled([
      applyStockOperationAdmin(fake.db, baseInput({
        lines: [{ productId: 'p1', quantity: 1 }],
        sourceId: 'sale-a',
        idempotencyKey: 'sale:sale-a:stock',
      })),
      applyStockOperationAdmin(fake.db, baseInput({
        lines: [{ productId: 'p1', quantity: 1 }],
        sourceId: 'sale-b',
        idempotencyKey: 'sale:sale-b:stock',
      })),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected' });
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientStockError);
    expect(fake.get('products/p1')?.currentStock).toBe(0);
    expect(fake.list('stockMovements')).toHaveLength(1);
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

  it('movimenta múltiplas variações do mesmo produto sem sobrescrever saldos', async () => {
    const fake = makeFakeDb([product('camiseta', 0, {
      kind: 'variant',
      variants: [
        { id: 'azul-p', name: 'Azul P', attributes: { cor: 'Azul', tamanho: 'P' }, salePrice: 50, costPrice: 20, currentStock: 3, minStock: 1, trackStock: true, isActive: true },
        { id: 'preta-m', name: 'Preta M', attributes: { cor: 'Preta', tamanho: 'M' }, salePrice: 55, costPrice: 22, currentStock: 5, minStock: 2, trackStock: true, isActive: true },
      ],
    })]);

    const result = await applyStockOperationAdmin(fake.db, baseInput({
      type: 'ajuste',
      lines: [
        { productId: 'camiseta', variantId: 'azul-p', quantity: 7 },
        { productId: 'camiseta', variantId: 'preta-m', quantity: 2 },
      ],
      sourceType: 'manual',
      sourceId: undefined,
      idempotencyKey: 'manual:camiseta:variants',
      reason: 'Contagem por grade',
      expandBom: false,
      adjustmentMode: 'absolute',
    }));

    expect(result.adjustments).toEqual(expect.arrayContaining([
      expect.objectContaining({ variantId: 'azul-p', previousStock: 3, newStock: 7 }),
      expect.objectContaining({ variantId: 'preta-m', previousStock: 5, newStock: 2 }),
    ]));
    const stored = fake.get('products/camiseta') as unknown as Product;
    expect(stored.currentStock).toBe(0);
    expect(stored.variants?.find((variant) => variant.id === 'azul-p')?.currentStock).toBe(7);
    expect(stored.variants?.find((variant) => variant.id === 'preta-m')?.currentStock).toBe(2);
    expect(fake.list('stockMovements').map((movement) => movement.data.variantId).sort()).toEqual(['azul-p', 'preta-m']);
  });

  it('calcula custo médio da variação sem alterar custo ou saldo do produto principal', async () => {
    const fake = makeFakeDb([product('camiseta', 0, {
      costPrice: 9,
      kind: 'variant',
      variants: [
        { id: 'azul-p', name: 'Azul P', attributes: { cor: 'Azul', tamanho: 'P' }, salePrice: 50, costPrice: 20, currentStock: 3, minStock: 1, trackStock: true, isActive: true },
      ],
    })]);

    const result = await applyStockOperationAdmin(fake.db, baseInput({
      type: 'entrada',
      lines: [{ productId: 'camiseta', variantId: 'azul-p', quantity: 2, unitCost: 50 }],
      sourceType: 'purchase',
      sourceId: 'purchase-variant',
      idempotencyKey: 'purchase:variant:entry',
      reason: 'Compra por variação',
      expandBom: false,
      requireActiveProducts: true,
    }));

    expect(result.adjustments[0]).toMatchObject({ variantId: 'azul-p', previousCost: 20, newCost: 32 });
    const stored = fake.get('products/camiseta') as unknown as Product;
    expect(stored.currentStock).toBe(0);
    expect(stored.costPrice).toBe(9);
    expect(stored.variants?.[0]).toMatchObject({ currentStock: 5, costPrice: 32 });
  });

  it('impede saldo negativo em uma variação sem alterar as demais', async () => {
    const fake = makeFakeDb([product('tenis', 0, {
      kind: 'variant',
      variants: [
        { id: 'tam-40', name: '40', attributes: { tamanho: '40' }, salePrice: 100, costPrice: 50, currentStock: 1, minStock: 0, trackStock: true, isActive: true },
        { id: 'tam-41', name: '41', attributes: { tamanho: '41' }, salePrice: 100, costPrice: 50, currentStock: 4, minStock: 0, trackStock: true, isActive: true },
      ],
    })]);

    await expect(applyStockOperationAdmin(fake.db, baseInput({
      lines: [{ productId: 'tenis', variantId: 'tam-40', quantity: 2 }],
      sourceId: 'sale-variant',
      idempotencyKey: 'sale:variant:stock',
      expandBom: false,
    }))).rejects.toBeInstanceOf(InsufficientStockError);
    const stored = fake.get('products/tenis') as unknown as Product;
    expect(stored.variants?.map((variant) => variant.currentStock)).toEqual([1, 4]);
  });

  it('cria lote na entrada, grava a alocação no ledger e preserva idempotência', async () => {
    const fake = makeFakeDb([product('p1', 0, { trackLots: true, trackExpiry: true, expiryWarningDays: 45 })]);
    const input = baseInput({
      type: 'entrada',
      lines: [{
        productId: 'p1',
        quantity: 5,
        unitCost: 8,
        sourceLineId: 'line-1',
        lot: { code: ' lote-a ', manufacturedAt: '2026-08-01', expiresAt: '2026-12-01', supplierName: 'Fornecedor A' },
      }],
      sourceType: 'purchase',
      sourceId: 'purchase-lot-1',
      idempotencyKey: 'purchase:lot-1:entry',
      reason: 'Entrada rastreada',
      expandBom: false,
    });

    const first = await applyStockOperationAdmin(fake.db, input);
    const replay = await applyStockOperationAdmin(fake.db, input);

    expect(replay.replayed).toBe(true);
    expect(fake.get('products/p1')?.currentStock).toBe(5);
    expect(fake.list('stockLots')).toHaveLength(1);
    expect(fake.list('stockLots')[0].data).toMatchObject({
      businessId: 'biz1', productId: 'p1', codeNormalized: 'LOTE-A', initialQuantity: 5,
      currentQuantity: 5, unitCost: 8, expiresAt: '2026-12-01', expiryWarningDays: 45,
    });
    expect(first.adjustments[0].lotAllocations).toEqual([
      expect.objectContaining({ lotCode: 'lote-a', quantity: 5, expiresAt: '2026-12-01' }),
    ]);
    expect(fake.list('stockMovements')[0].data.lotAllocations).toEqual(first.adjustments[0].lotAllocations);
  });

  it('baixa automaticamente por FEFO e distribui a saída entre lotes', async () => {
    const lot = (id: string, code: string, expiresAt: string, quantity: number) => ({
      id, schemaVersion: 1, businessId: 'biz1', productId: 'p1', productName: 'Produto p1', unit: 'UN',
      code, codeNormalized: code, status: 'active', expiresAt, initialQuantity: quantity,
      currentQuantity: quantity, expiryWarningDays: 30, createdBy: 'user-1', createdByName: 'Operador',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const fake = makeFakeDb(
      [product('p1', 8, { trackLots: true })],
      {
        'stockLots/lot-old': lot('lot-old', 'ANTIGO', '2027-01-01', 3),
        'stockLots/lot-new': lot('lot-new', 'NOVO', '2027-06-01', 5),
      },
    );

    const result = await applyStockOperationAdmin(fake.db, baseInput({
      lines: [{ productId: 'p1', quantity: 4 }],
      sourceId: 'sale-fefo',
      idempotencyKey: 'sale:fefo:stock',
    }));

    expect(result.adjustments[0].lotAllocations).toEqual([
      expect.objectContaining({ lotId: 'lot-old', quantity: 3 }),
      expect.objectContaining({ lotId: 'lot-new', quantity: 1 }),
    ]);
    expect(fake.get('stockLots/lot-old')).toMatchObject({ currentQuantity: 0, status: 'depleted' });
    expect(fake.get('stockLots/lot-new')).toMatchObject({ currentQuantity: 4, status: 'active' });
    expect(fake.get('products/p1')?.currentStock).toBe(4);
  });

  it('restaura exatamente os lotes consumidos quando a venda é cancelada', async () => {
    const baseLot = (id: string, code: string, expiresAt: string, quantity: number) => ({
      id, schemaVersion: 1, businessId: 'biz1', productId: 'p1', productName: 'Produto p1', unit: 'UN',
      code, codeNormalized: code, status: 'active', expiresAt, initialQuantity: quantity,
      currentQuantity: quantity, expiryWarningDays: 30, createdBy: 'user-1', createdByName: 'Operador',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const fake = makeFakeDb([product('p1', 8, { trackLots: true })], {
      'stockLots/lot-a': baseLot('lot-a', 'A', '2027-01-01', 3),
      'stockLots/lot-b': baseLot('lot-b', 'B', '2027-06-01', 5),
    });
    await applyStockOperationAdmin(fake.db, baseInput({
      lines: [{ productId: 'p1', quantity: 4 }],
      sourceId: 'sale-restore',
      idempotencyKey: 'sale:restore:deduct',
    }));

    const restored = await applyStockOperationAdmin(fake.db, baseInput({
      type: 'restauracao',
      lines: [{ productId: 'p1', quantity: 4 }],
      sourceType: 'refund',
      sourceId: 'sale-restore',
      idempotencyKey: 'sale:restore:return',
      reason: 'Cancelamento da venda',
    }));

    expect(restored.adjustments[0].lotAllocations).toEqual([
      expect.objectContaining({ lotId: 'lot-a', quantity: 3 }),
      expect.objectContaining({ lotId: 'lot-b', quantity: 1 }),
    ]);
    expect(fake.get('stockLots/lot-a')).toMatchObject({ currentQuantity: 3, status: 'active' });
    expect(fake.get('stockLots/lot-b')).toMatchObject({ currentQuantity: 5, status: 'active' });
    expect(fake.get('products/p1')?.currentStock).toBe(8);
  });

  it('não usa lote vencido automaticamente, mas permite baixa manual explícita para descarte', async () => {
    const expired = {
      id: 'lot-expired', schemaVersion: 1, businessId: 'biz1', productId: 'p1', productName: 'Produto p1', unit: 'UN',
      code: 'VENCIDO', codeNormalized: 'VENCIDO', status: 'active', expiresAt: '2020-01-01', initialQuantity: 2,
      currentQuantity: 2, expiryWarningDays: 30, createdBy: 'user-1', createdByName: 'Operador',
      createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
    };
    const fake = makeFakeDb([product('p1', 2, { trackLots: true, trackExpiry: true })], {
      'stockLots/lot-expired': expired,
    });

    await expect(applyStockOperationAdmin(fake.db, baseInput({
      lines: [{ productId: 'p1', quantity: 1 }],
      sourceId: 'sale-expired',
      idempotencyKey: 'sale:expired:stock',
    }))).rejects.toBeInstanceOf(StockLotConflictError);
    expect(fake.get('products/p1')?.currentStock).toBe(2);

    const disposal = await applyStockOperationAdmin(fake.db, baseInput({
      lines: [{ productId: 'p1', quantity: 1, lotId: 'lot-expired' }],
      sourceType: 'manual',
      sourceId: undefined,
      reason: 'Descarte de vencido',
      idempotencyKey: 'manual:expired:disposal',
      expandBom: false,
    }));
    expect(disposal.adjustments[0].lotAllocations).toEqual([
      expect.objectContaining({ lotId: 'lot-expired', quantity: 1 }),
    ]);
    expect(fake.get('stockLots/lot-expired')?.currentQuantity).toBe(1);
    expect(fake.get('products/p1')?.currentStock).toBe(1);
  });

  it('não considera lotes pertencentes a outro tenant durante a alocação', async () => {
    const fake = makeFakeDb([product('p1', 1, { trackLots: true })], {
      'stockLots/foreign': {
        id: 'foreign', schemaVersion: 1, businessId: 'biz2', productId: 'p1', productName: 'Produto externo', unit: 'UN',
        code: 'EXTERNO', codeNormalized: 'EXTERNO', status: 'active', initialQuantity: 10, currentQuantity: 10,
        expiryWarningDays: 30, createdBy: 'other', createdByName: 'Outro', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    await expect(applyStockOperationAdmin(fake.db, baseInput({
      lines: [{ productId: 'p1', quantity: 1 }],
      sourceId: 'sale-tenant-lot',
      idempotencyKey: 'sale:tenant-lot:stock',
    }))).rejects.toBeInstanceOf(StockLotConflictError);
    expect(fake.get('stockLots/foreign')?.currentQuantity).toBe(10);
    expect(fake.get('products/p1')?.currentStock).toBe(1);
  });
});
