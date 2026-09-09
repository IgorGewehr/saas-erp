import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/structured-operation-log', () => ({ writeStructuredOperationLog: vi.fn() }));

// M02.10 — createOrderWithSideEffects (lib/services/order-server.ts, M02.6) só
// tinha cobertura do SCHEMA de input (tests/contracts/orderServer.test.ts) —
// zero teste do serviço em si. Achado da investigação M02.10: é o único dos 3
// canais de criação (Sale/DeliveryOrder/Order) sem teste de TENANT_MISMATCH
// pro clientId. Fecha esse gap e cobre o resto do caminho feliz/idempotência
// (mesmo padrão de fake DB de deliveryOrderServerCommercial.test.ts).

import { ProductV2Schema, type ProductV2 } from '@/contracts/domain/productV2';
import { createOrderWithSideEffects, OrderServiceError } from '@/lib/services/order-server';

interface FakeQuery {
  _coll: string;
  _filters: Array<{ field: string; op: string; expected: unknown }>;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
  orderBy: () => FakeQuery;
  limit: () => FakeQuery;
  get: () => Promise<FakeQuerySnapshot>;
}
interface FakeSnapshot { id: string; exists: boolean; data: () => Record<string, unknown> | undefined; }
interface FakeQuerySnapshot { docs: FakeSnapshot[]; empty: boolean; size: number; }
interface FakeRef {
  id: string;
  _coll: string;
  get: () => Promise<FakeSnapshot>;
  create: (data: Record<string, unknown>) => Promise<void>;
}
interface FakeCollection {
  doc: (id?: string) => FakeRef;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
}

function clone<T>(value: T): T { return structuredClone(value); }

let autoIdCounter = 0;

function makeFakeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]));

  const snapshot = (ref: FakeRef): FakeSnapshot => {
    const data = documents.get(`${ref._coll}/${ref.id}`);
    return { id: ref.id, exists: Boolean(data), data: () => (data ? clone(data) : undefined) };
  };
  const matchesFilter = (data: Record<string, unknown>, filter: FakeQuery['_filters'][number]): boolean =>
    data[filter.field] === filter.expected;
  const querySnapshot = (query: FakeQuery): FakeQuerySnapshot => {
    const prefix = `${query._coll}/`;
    const docs = [...documents.entries()]
      .filter(([path, data]) => path.startsWith(prefix)
        && !path.slice(prefix.length).includes('/')
        && query._filters.every((filter) => matchesFilter(data, filter)))
      .map(([path, data]) => ({ id: path.slice(prefix.length), exists: true, data: () => clone(data) }));
    return { docs, empty: docs.length === 0, size: docs.length };
  };
  const makeQuery = (coll: string, filters: FakeQuery['_filters']): FakeQuery => ({
    _coll: coll,
    _filters: filters,
    where(field, operator, expected) { return makeQuery(coll, [...filters, { field, op: operator, expected }]); },
    orderBy() { return makeQuery(coll, filters); },
    limit() { return makeQuery(coll, filters); },
    async get() { return querySnapshot(this); },
  });
  const makeCollection = (coll: string): FakeCollection => ({
    doc(id?: string): FakeRef {
      const docId = id ?? `auto_${++autoIdCounter}`;
      const ref: FakeRef = {
        id: docId,
        _coll: coll,
        async get() { return snapshot(ref); },
        async create(data) {
          const path = `${coll}/${docId}`;
          if (documents.has(path)) throw new Error(`Documento já existe: ${path}`);
          documents.set(path, clone(data));
        },
      };
      return ref;
    },
    where(field, operator, expected) { return makeQuery(coll, []).where(field, operator, expected); },
  });

  const db = {
    collection(coll: string) { return makeCollection(coll); },
    async getAll(...refs: FakeRef[]) { return refs.map(snapshot); },
  };
  return {
    db,
    get(path: string) { const data = documents.get(path); return data ? clone(data) : undefined; },
  };
}

const NOW = new Date('2026-09-09T12:00:00.000Z');

function product(overrides: Record<string, unknown> = {}): ProductV2 {
  return ProductV2Schema.parse({
    schemaVersion: 2,
    id: 'p1',
    businessId: 'biz1',
    kind: 'simple',
    name: 'Caixa de atacado',
    category: 'Geral',
    unit: 'UN',
    purchaseUnit: 'UN',
    purchaseToStockFactor: 1,
    costMethod: 'moving_average',
    costPrice: 50,
    salePrice: 80,
    currentStock: 100,
    minStock: 0,
    trackStock: true,
    trackLots: false,
    trackExpiry: false,
    expiryWarningDays: 30,
    isActive: true,
    isDeliverable: true,
    images: [],
    variants: [],
    menuAvailable: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  });
}

function stored<T extends { id: string }>(item: T): Record<string, unknown> {
  const { id, ...data } = item;
  return data as Record<string, unknown>;
}

function initialDocuments() {
  return {
    'products/p1': stored(product()),
    'clients/c1': { id: 'c1', businessId: 'biz1', name: 'Distribuidora Cliente' },
  };
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    businessId: 'biz1',
    type: 'b2b',
    items: [{ productId: 'p1', quantity: 2 }],
    operatorId: 'op-1',
    operatorName: 'Atendente Teste',
    idempotencyKey: 'order-checkout-1',
    ...overrides,
  };
}

describe('M02.10 — createOrderWithSideEffects (núcleo B2B/condicional, M02.6)', () => {
  it('cria pedido B2B com preço/total resolvidos pela cotação autoritativa', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createOrderWithSideEffects({
      db: fake.db as never,
      input: baseInput(),
      context: {},
    });

    expect(result.created).toBe(true);
    expect(result.order).toMatchObject({
      businessId: 'biz1', type: 'b2b', status: 'pendente', total: 160,
    });
    expect(result.order.items[0]).toMatchObject({ productId: 'p1', quantity: 2, unitPrice: 80 });
  });

  it('rejeita quando operatorId/operatorName estão ausentes', async () => {
    const fake = makeFakeDb(initialDocuments());
    let caught: unknown;
    try {
      await createOrderWithSideEffects({
        db: fake.db as never,
        input: baseInput({ operatorId: undefined, operatorName: undefined }),
        context: {},
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OrderServiceError);
    expect((caught as OrderServiceError).code).toBe('OPERATOR_REQUIRED');
  });

  it('rejeita clientId inexistente (CLIENT_NOT_FOUND)', async () => {
    const fake = makeFakeDb(initialDocuments());
    await expect(createOrderWithSideEffects({
      db: fake.db as never,
      input: baseInput({ clientId: 'ghost' }),
      context: {},
    })).rejects.toThrow(/Cliente não encontrado/);
  });

  it('rejeita clientId de outro negócio (TENANT_MISMATCH) — gap da investigação M02.10', async () => {
    const fake = makeFakeDb({
      ...initialDocuments(),
      'clients/c-other-biz': { id: 'c-other-biz', businessId: 'biz2', name: 'Cliente de outro tenant' },
    });
    let caught: unknown;
    try {
      await createOrderWithSideEffects({
        db: fake.db as never,
        input: baseInput({ clientId: 'c-other-biz' }),
        context: {},
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OrderServiceError);
    expect((caught as OrderServiceError).code).toBe('TENANT_MISMATCH');
    expect((caught as OrderServiceError).status).toBe(403);
  });

  it('aceita clientId do mesmo tenant sem lançar', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createOrderWithSideEffects({
      db: fake.db as never,
      input: baseInput({ clientId: 'c1' }),
      context: {},
    });
    expect(result.order.clientId).toBe('c1');
  });

  it('replay com a mesma idempotencyKey retorna o pedido existente sem recriar', async () => {
    const fake = makeFakeDb(initialDocuments());
    const input = baseInput();
    const first = await createOrderWithSideEffects({ db: fake.db as never, input, context: {} });
    const second = await createOrderWithSideEffects({ db: fake.db as never, input, context: {} });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.order.id).toBe(first.order.id);
  });

  it('carrinho diferente com idempotencyKey ausente deriva IDs diferentes (não colide)', async () => {
    const fake = makeFakeDb(initialDocuments());
    const first = await createOrderWithSideEffects({
      db: fake.db as never,
      input: baseInput({ idempotencyKey: undefined, items: [{ productId: 'p1', quantity: 1 }] }),
      context: {},
    });
    const second = await createOrderWithSideEffects({
      db: fake.db as never,
      input: baseInput({ idempotencyKey: undefined, items: [{ productId: 'p1', quantity: 2 }] }),
      context: {},
    });
    expect(first.order.id).not.toBe(second.order.id);
  });

  it('type=condicional propaga conditionalExpiresAt pro documento', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createOrderWithSideEffects({
      db: fake.db as never,
      input: baseInput({ type: 'condicional', conditionalExpiresAt: '2026-10-01' }),
      context: {},
    });
    expect(result.order.type).toBe('condicional');
    expect(result.order.conditionalExpiresAt).toBe('2026-10-01');
  });
});
