import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('@/lib/services/structured-operation-log', () => ({ writeStructuredOperationLog: vi.fn() }));

import { ProductV2Schema, type ProductV2 } from '@/contracts/domain/productV2';
import { ServiceSchema, type Service } from '@/contracts/domain/service';
import {
  CreateSaleWithSideEffectsInputSchema,
  type CreateSaleWithSideEffectsInput,
} from '@/contracts/api/services/sale-server';
import {
  CommercialOperationIdempotencyConflictError,
} from '@/lib/services/commercial-operation-admin';
import { CommercialQuoteError } from '@/lib/services/commercial-quote';
import {
  createSaleWithSideEffects,
  salePaymentSemantics,
} from '@/lib/services/sales-server';

interface FakeQuery {
  _coll: string;
  _filters: Array<{ field: string; expected: unknown }>;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
  orderBy: () => FakeQuery;
  limit: () => FakeQuery;
  get: () => Promise<FakeQuerySnapshot>;
}

interface FakeSnapshot {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

interface FakeQuerySnapshot {
  docs: FakeSnapshot[];
  empty: boolean;
  size: number;
}

interface FakeRef {
  id: string;
  _coll: string;
  get: () => Promise<FakeSnapshot>;
  collection: (name: string) => FakeCollection;
}

interface FakeCollection {
  doc: (id: string) => FakeRef;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
}

type PendingWrite =
  | { kind: 'create' | 'set'; ref: FakeRef; data: Record<string, unknown> }
  | { kind: 'update'; ref: FakeRef; data: Record<string, unknown> };

function clone<T>(value: T): T { return structuredClone(value); }

function makeFakeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]));
  let transactionTail: Promise<void> = Promise.resolve();

  const snapshot = (ref: FakeRef): FakeSnapshot => {
    const data = documents.get(`${ref._coll}/${ref.id}`);
    return { id: ref.id, exists: Boolean(data), data: () => data ? clone(data) : undefined };
  };
  const querySnapshot = (query: FakeQuery): FakeQuerySnapshot => {
    const prefix = `${query._coll}/`;
    const docs = [...documents.entries()]
      .filter(([path, data]) => path.startsWith(prefix)
        && !path.slice(prefix.length).includes('/')
        && query._filters.every((filter) => data[filter.field] === filter.expected))
      .map(([path, data]) => ({
        id: path.slice(prefix.length),
        exists: true,
        data: () => clone(data),
      }));
    return { docs, empty: docs.length === 0, size: docs.length };
  };
  const makeQuery = (coll: string, filters: FakeQuery['_filters']): FakeQuery => ({
    _coll: coll,
    _filters: filters,
    where(field: string, operator: string, expected: unknown) {
      if (operator !== '==') throw new Error(`Operador não suportado: ${operator}`);
      return makeQuery(coll, [...filters, { field, expected }]);
    },
    orderBy() { return makeQuery(coll, filters); },
    limit() { return makeQuery(coll, filters); },
    async get() { return querySnapshot(this); },
  });
  const makeCollection = (coll: string): FakeCollection => ({
    doc(id: string): FakeRef {
      const ref: FakeRef = {
        id,
        _coll: coll,
        async get() { return snapshot(ref); },
        collection(name: string) { return makeCollection(`${coll}/${id}/${name}`); },
      };
      return ref;
    },
    where(field: string, operator: string, expected: unknown) {
      return makeQuery(coll, []).where(field, operator, expected);
    },
  });

  const db = {
    collection(coll: string) { return makeCollection(coll); },
    async getAll(...refs: FakeRef[]) { return refs.map(snapshot); },
    async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const writes: PendingWrite[] = [];
      const tx = {
        async get(ref: FakeRef | FakeQuery) {
          return '_filters' in ref ? querySnapshot(ref) : snapshot(ref);
        },
        create(ref: FakeRef, data: Record<string, unknown>) {
          if (documents.has(`${ref._coll}/${ref.id}`) || writes.some((write) => write.ref._coll === ref._coll && write.ref.id === ref.id)) {
            throw new Error(`Documento já existe: ${ref._coll}/${ref.id}`);
          }
          writes.push({ kind: 'create', ref, data: clone(data) });
        },
        set(ref: FakeRef, data: Record<string, unknown>) {
          writes.push({ kind: 'set', ref, data: clone(data) });
        },
        update(ref: FakeRef, data: Record<string, unknown>) {
          writes.push({ kind: 'update', ref, data: clone(data) });
        },
      };
      try {
        const result = await handler(tx);
        for (const write of writes) {
          const path = `${write.ref._coll}/${write.ref.id}`;
          if (write.kind === 'update') {
            const current = documents.get(path);
            if (!current) throw new Error(`Documento ausente: ${path}`);
            documents.set(path, { ...current, ...clone(write.data) });
          } else {
            documents.set(path, clone(write.data));
          }
        }
        return result;
      } finally {
        release();
      }
    },
  };

  return {
    db: db as unknown as Firestore,
    get(path: string) { const data = documents.get(path); return data ? clone(data) : undefined; },
    list(collection: string) {
      const prefix = `${collection}/`;
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: clone(data) }));
    },
  };
}

const NOW = new Date('2026-08-29T18:00:00.000Z');

function product(overrides: Record<string, unknown> = {}): ProductV2 {
  return ProductV2Schema.parse({
    schemaVersion: 2,
    id: 'p1',
    businessId: 'biz1',
    kind: 'simple',
    name: 'Produto autoritativo',
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
    ...overrides,
  });
}

function service(overrides: Record<string, unknown> = {}): Service {
  return ServiceSchema.parse({
    id: 's1',
    businessId: 'biz1',
    name: 'Serviço autoritativo',
    duration: 60,
    price: 50,
    color: '#000000',
    isActive: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  });
}

function stored<T extends { id: string }>(item: T) {
  const { id, ...data } = item;
  return data as Record<string, unknown>;
}

function baseInput(overrides: Record<string, unknown> = {}): CreateSaleWithSideEffectsInput {
  return CreateSaleWithSideEffectsInputSchema.parse({
    businessId: 'biz1',
    clientId: 'client-1',
    clientName: 'Nome adulterável',
    items: [{
      productId: 'p1',
      description: 'Nome adulterado',
      quantity: 2,
      unitPrice: 10,
      discount: 0,
      total: 20,
    }],
    payments: [{ method: 'pix', amount: 20 }],
    discount: 0,
    status: 'finalizada',
    operatorId: 'user-1',
    operatorName: 'Operador',
    commissionRate: 99,
    idempotencyKey: 'sale-checkout-1',
    ...overrides,
  });
}

function initialDocuments() {
  return {
    'products/p1': stored(product()),
    'clients/client-1': {
      businessId: 'biz1',
      name: 'Cliente autoritativo',
      totalSpent: 0,
      visitCount: 0,
      lifecycleStage: 'lead',
      status: 'novo',
    },
  };
}

describe('M02.3 — checkout comercial do PDV', () => {
  it('classifica meios imediatos, diferidos, benefícios e sem pagamento', () => {
    expect(salePaymentSemantics('pix')).toMatchObject({ allocationStatus: 'paid', createsFinancialTransaction: true });
    expect(salePaymentSemantics('boleto')).toMatchObject({ allocationStatus: 'pending', createsFinancialTransaction: true });
    expect(salePaymentSemantics('creditoLoja')).toMatchObject({ allocationStatus: 'pending', createsFinancialTransaction: true });
    expect(salePaymentSemantics('pontos')).toMatchObject({ allocationStatus: 'pending', createsFinancialTransaction: false });
    expect(salePaymentSemantics('semPagamento')).toMatchObject({ legacyStatus: 'unpaid', createsFinancialTransaction: false });
  });

  it('rejeita preço adulterado antes de criar venda, estoque ou dinheiro', async () => {
    const fake = makeFakeDb(initialDocuments());
    await expect(createSaleWithSideEffects(baseInput({
      items: [{ productId: 'p1', description: 'Barato', quantity: 2, unitPrice: 1, discount: 0, total: 2 }],
      payments: [{ method: 'pix', amount: 2 }],
    }), fake.db, { channel: 'pdv', actorType: 'user', now: () => NOW }))
      .rejects.toBeInstanceOf(CommercialQuoteError);
    expect(fake.list('sales')).toHaveLength(0);
    expect(fake.list('transactions')).toHaveLength(0);
    expect(fake.list('stockMovements')).toHaveLength(0);
  });

  it('revalida variação e modificador por ID e baixa os insumos cotados', async () => {
    const ingredient = product({
      id: 'ingredient-1', name: 'Insumo real', salePrice: 0, currentStock: 5, isDeliverable: false,
    });
    const configurable = product({
      kind: 'variant',
      name: 'Produto configurável',
      variants: [{
        id: 'variant-1', name: 'Variação real', attributes: { tamanho: 'M' }, sku: 'VAR-M',
        salePrice: 12, costPrice: 3, currentStock: 2, minStock: 0, trackStock: true, isActive: true,
      }],
      modifierGroups: [{
        id: 'extras', name: 'Extras reais', required: false, minSelections: 0, maxSelections: 2,
        selectionType: 'quantity', priceStrategy: 'sum', sortOrder: 0,
        options: [{
          id: 'extra-1', name: 'Extra real', additionalPrice: 4, available: true,
          maxQuantity: 1, sortOrder: 0, linkedProductId: ingredient.id, consumeQty: 0.5,
        }],
      }],
    });
    const fake = makeFakeDb({
      ...initialDocuments(),
      'products/p1': stored(configurable),
      'products/ingredient-1': stored(ingredient),
    });
    const result = await createSaleWithSideEffects(baseInput({
      items: [{
        productId: 'p1', variantId: 'variant-1', description: 'Nome falso', quantity: 1,
        unitPrice: 16, discount: 0, total: 16,
        selectedModifiers: [{
          groupId: 'extras', groupName: 'Grupo falso', priceStrategy: 'sum',
          selectedOptions: [{ optionId: 'extra-1', optionName: 'Extra falso', additionalPrice: 0, quantity: 1 }],
        }],
      }],
      payments: [{ method: 'pix', amount: 16 }],
      idempotencyKey: 'variant-modifier-1',
    }), fake.db, { channel: 'pdv', actorType: 'user', now: () => NOW });

    expect(result.sale.items[0]).toMatchObject({
      variantId: 'variant-1', description: 'Produto configurável — Variação real', unitPrice: 16,
      selectedModifiers: [{
        groupName: 'Extras reais', selectedOptions: [{ optionName: 'Extra real', additionalPrice: 4 }],
      }],
    });
    expect((fake.get('products/p1')?.variants as Array<{ id: string; currentStock: number }>)[0]).toMatchObject({
      id: 'variant-1', currentStock: 1,
    });
    expect(fake.get('products/ingredient-1')?.currentStock).toBe(4.5);
    expect(fake.list('stockMovements')).toHaveLength(2);
  });

  it('finaliza split, comissão e cliente com um efeito por alocação', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createSaleWithSideEffects(baseInput({
      payments: [
        { method: 'pix', amount: 5 },
        { method: 'boleto', amount: 15, dueDate: '2026-09-30' },
      ],
    }), fake.db, {
      channel: 'pdv',
      actorType: 'user',
      commissionRate: 10,
      now: () => NOW,
    });

    expect(result.sale).toMatchObject({
      clientName: 'Cliente autoritativo',
      paymentStatus: 'partial',
      financialStatus: 'partial',
      stockStatus: 'applied',
      total: 20,
    });
    expect(result.transactionIds).toHaveLength(3);
    expect(result.transactionId).toBe(result.sale.transactionId);
    expect(result.commissionTransactionId).toBe(`${result.sale.id}_commission`);
    const transactions = fake.list('transactions').map((item) => item.data);
    expect(transactions.filter((item) => item.type === 'receita')).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: 5, status: 'pago', paymentMethod: 'pix' }),
      expect.objectContaining({ amount: 15, status: 'pendente', paymentMethod: 'boleto', dueDate: '2026-09-30' }),
    ]));
    expect(transactions).toContainEqual(expect.objectContaining({
      type: 'despesa', category: 'Comissoes', amount: 2, status: 'pendente',
    }));
    expect(fake.get('products/p1')?.currentStock).toBe(3);
    expect(fake.get('clients/client-1')).toMatchObject({
      totalSpent: 20, visitCount: 1, lifecycleStage: 'customer', status: 'ganho',
    });
  });

  it('finaliza venda apenas de serviço sem forçar movimento de estoque', async () => {
    const fake = makeFakeDb({
      'services/s1': stored(service()),
      'clients/client-1': initialDocuments()['clients/client-1'],
    });
    const result = await createSaleWithSideEffects(baseInput({
      items: [{ serviceId: 's1', description: 'Preço cliente', quantity: 1, unitPrice: 50, discount: 0, total: 50 }],
      payments: [{ method: 'dinheiro', amount: 50 }],
      idempotencyKey: 'service-checkout-1',
    }), fake.db, { channel: 'pdv', actorType: 'user', now: () => NOW });

    expect(result.sale).toMatchObject({ total: 50, stockStatus: 'not_required', paymentStatus: 'paid' });
    expect(result.stockMovements).toBe(0);
    expect(fake.list('stockMovements')).toHaveLength(0);
    expect(fake.list('transactions')).toHaveLength(1);
  });

  it('não cria receita para sem pagamento e deixa o estado explícito', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createSaleWithSideEffects(baseInput({
      payments: [{ method: 'semPagamento', amount: 20 }],
      idempotencyKey: 'unpaid-checkout-1',
    }), fake.db, { channel: 'pdv', actorType: 'user', now: () => NOW });

    expect(result.sale).toMatchObject({ paymentStatus: 'unpaid', financialStatus: 'not_applicable' });
    expect(result.transactionIds).toEqual([]);
    expect(fake.list('transactions')).toHaveLength(0);
  });

  it('replay posterior usa a intenção persistida e não repete efeitos', async () => {
    const fake = makeFakeDb(initialDocuments());
    const input = baseInput();
    const first = await createSaleWithSideEffects(input, fake.db, {
      channel: 'pdv', actorType: 'user', now: () => NOW,
    });
    const replay = await createSaleWithSideEffects(input, fake.db, {
      channel: 'pdv',
      actorType: 'user',
      now: () => new Date('2026-08-30T18:00:00.000Z'),
    });

    expect(replay).toMatchObject({ operationId: first.operationId, replayed: true });
    expect(fake.list('sales')).toHaveLength(1);
    expect(fake.list('transactions')).toHaveLength(1);
    expect(fake.list('stockMovements')).toHaveLength(1);
    expect(fake.get('products/p1')?.currentStock).toBe(3);
    expect(fake.get('clients/client-1')).toMatchObject({ totalSpent: 20, visitCount: 1 });
  });

  it('serializa tentativas concorrentes sem duplicar venda ou efeitos', async () => {
    const fake = makeFakeDb(initialDocuments());
    const input = baseInput({ idempotencyKey: 'concurrent-checkout-1' });
    const attempts = await Promise.allSettled([
      createSaleWithSideEffects(input, fake.db, {
        channel: 'pdv', actorType: 'user', now: () => NOW,
      }),
      createSaleWithSideEffects(input, fake.db, {
        channel: 'pdv', actorType: 'user', now: () => NOW,
      }),
    ]);

    expect(attempts.some((attempt) => attempt.status === 'fulfilled')).toBe(true);
    expect(fake.list('commercialOperations')).toHaveLength(1);
    expect(fake.list('sales')).toHaveLength(1);
    expect(fake.list('transactions')).toHaveLength(1);
    expect(fake.list('stockMovements')).toHaveLength(1);
    expect(fake.get('products/p1')?.currentStock).toBe(3);
    expect(fake.get('clients/client-1')).toMatchObject({ totalSpent: 20, visitCount: 1 });
  });

  it('rejeita desconto sem permissão e a mesma chave com payload diferente', async () => {
    const discountInput = baseInput({
      discount: 2,
      payments: [{ method: 'pix', amount: 18 }],
      idempotencyKey: 'discount-checkout-1',
    });
    const denied = makeFakeDb(initialDocuments());
    await expect(createSaleWithSideEffects(discountInput, denied.db, {
      channel: 'pdv', actorType: 'user', canApplyManualDiscount: false, now: () => NOW,
    })).rejects.toBeInstanceOf(CommercialQuoteError);

    const fake = makeFakeDb(initialDocuments());
    await createSaleWithSideEffects(discountInput, fake.db, {
      channel: 'pdv', actorType: 'user', canApplyManualDiscount: true, now: () => NOW,
    });
    await expect(createSaleWithSideEffects({
      ...discountInput,
      notes: 'payload divergente',
    }, fake.db, {
      channel: 'pdv', actorType: 'user', canApplyManualDiscount: true, now: () => NOW,
    })).rejects.toBeInstanceOf(CommercialOperationIdempotencyConflictError);
  });

  it('barra cliente de outro tenant antes de qualquer efeito', async () => {
    const initial = initialDocuments();
    initial['clients/client-1'] = { ...initial['clients/client-1'], businessId: 'biz2' };
    const fake = makeFakeDb(initial);
    await expect(createSaleWithSideEffects(baseInput(), fake.db, {
      channel: 'pdv', actorType: 'user', now: () => NOW,
    })).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
    expect(fake.list('commercialOperations')).toHaveLength(0);
  });
});
