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

interface FakeDbOptions {
  /** Simula a corrida: na PRIMEIRA leitura de um doc inexistente dessa coleção, outro
   *  "pod" grava o doc logo depois — o `create()` do caller então bate em ALREADY_EXISTS. */
  race?: { collection: string; data: Record<string, unknown> };
  /** Força o `create()` a falhar com esse erro (ex.: indisponibilidade do Firestore). */
  createError?: unknown;
}

/** Mesmo formato do erro real do Admin SDK: gRPC code 6. */
function alreadyExistsError(path: string): Error {
  return Object.assign(new Error(`6 ALREADY_EXISTS: Document already exists: ${path}`), { code: 6 });
}

function makeFakeDb(initial: Record<string, Record<string, unknown>> = {}, options: FakeDbOptions = {}) {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]));
  let raceFired = false;

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
        async get() {
          const current = snapshot(ref);
          if (options.race && !raceFired && coll === options.race.collection && !current.exists) {
            raceFired = true;
            documents.set(`${coll}/${docId}`, clone(options.race.data));
          }
          return current;
        },
        async create(data) {
          const path = `${coll}/${docId}`;
          if (options.createError) throw options.createError;
          if (documents.has(path)) throw alreadyExistsError(path);
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

describe('Vitrine — expectedTotalCents, idempotência explícita e corrida de criação', () => {
  async function stale(input: Record<string, unknown>, context: Record<string, unknown> = {}) {
    const fake = makeFakeDb(initialDocuments());
    let caught: unknown;
    try {
      await createOrderWithSideEffects({ db: fake.db as never, input, context });
    } catch (err) {
      caught = err;
    }
    return { fake, caught };
  }

  it('expectedTotalCents igual à cotação cria o pedido normalmente', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createOrderWithSideEffects({
      db: fake.db as never,
      input: baseInput({ expectedTotalCents: 16_000 }),
      context: {},
    });
    expect(result.created).toBe(true);
    expect(result.order.total).toBe(160);
  });

  it('expectedTotalCents já considera o desconto manual (total negociado)', async () => {
    const fake = makeFakeDb(initialDocuments());
    const result = await createOrderWithSideEffects({
      db: fake.db as never,
      input: baseInput({ discount: 10, discountReason: 'Negociação comercial', expectedTotalCents: 15_000 }),
      context: { canApplyManualDiscount: true },
    });
    expect(result.order).toMatchObject({ discount: 10, total: 150 });
  });

  it('total esperado ≠ cotação do servidor → STALE_QUOTE (409)', async () => {
    const { caught } = await stale(baseInput({ expectedTotalCents: 15_000 }));
    expect(caught).toBeInstanceOf(OrderServiceError);
    expect((caught as OrderServiceError).code).toBe('STALE_QUOTE');
    expect((caught as OrderServiceError).status).toBe(409);
  });

  it('preço do catálogo mudou desde a negociação → STALE_QUOTE e nenhum pedido órfão fica gravado', async () => {
    // O vendedor negociou com salePrice 80 (2 × 80 = 16000); o catálogo já está em 90.
    const repriced = makeFakeDb({ ...initialDocuments(), 'products/p1': stored(product({ salePrice: 90 })) });
    await expect(createOrderWithSideEffects({
      db: repriced.db as never, input: baseInput({ expectedTotalCents: 16_000 }), context: {},
    })).rejects.toMatchObject({ code: 'STALE_QUOTE', status: 409 });

    // Mesma chave, agora com o total revisado: se a tentativa recusada tivesse gravado o pedido,
    // isto seria um replay (created:false). O 409 vem ANTES do create, então cria de verdade.
    const retry = await createOrderWithSideEffects({
      db: repriced.db as never, input: baseInput({ expectedTotalCents: 18_000 }), context: {},
    });
    expect(retry.created).toBe(true);
    expect(retry.order.total).toBe(180);
  });

  it('replay com a mesma chave devolve o pedido existente mesmo com expectedTotalCents defasado', async () => {
    const fake = makeFakeDb(initialDocuments());
    const first = await createOrderWithSideEffects({
      db: fake.db as never, input: baseInput({ expectedTotalCents: 16_000 }), context: {},
    });
    const replay = await createOrderWithSideEffects({
      db: fake.db as never, input: baseInput({ expectedTotalCents: 999 }), context: {},
    });
    expect(replay.created).toBe(false);
    expect(replay.order.id).toBe(first.order.id);
  });

  it('propostas idênticas com chaves diferentes viram pedidos distintos (uma chave por proposta)', async () => {
    const fake = makeFakeDb(initialDocuments());
    const a = await createOrderWithSideEffects({
      db: fake.db as never, input: baseInput({ clientId: 'c1', idempotencyKey: 'proposta-aaaaaaaa' }), context: {},
    });
    const b = await createOrderWithSideEffects({
      db: fake.db as never, input: baseInput({ clientId: 'c1', idempotencyKey: 'proposta-bbbbbbbb' }), context: {},
    });
    expect(a.created && b.created).toBe(true);
    expect(a.order.id).not.toBe(b.order.id);
  });

  it('mesma chave em negócios diferentes não colide (ID deriva de businessId + chave)', async () => {
    const fake = makeFakeDb({
      ...initialDocuments(),
      'products/p9': stored(product({ id: 'p9', businessId: 'biz2' })),
    });
    const mine = await createOrderWithSideEffects({ db: fake.db as never, input: baseInput(), context: {} });
    const theirs = await createOrderWithSideEffects({
      db: fake.db as never,
      input: baseInput({ businessId: 'biz2', items: [{ productId: 'p9', quantity: 1 }] }),
      context: {},
    });
    expect(theirs.created).toBe(true);
    expect(theirs.order.id).not.toBe(mine.order.id);
  });

  it('corrida: create() bate em ALREADY_EXISTS → devolve o pedido vencedor como replay (não 500)', async () => {
    const winner = {
      businessId: 'biz1', type: 'b2b', status: 'pendente', items: [], subtotal: 160, discount: 0, total: 160,
      installments: 1, operatorId: 'op-2', operatorName: 'Outro pod', statusHistory: [], createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    const fake = makeFakeDb(initialDocuments(), { race: { collection: 'orders', data: winner } });

    const result = await createOrderWithSideEffects({ db: fake.db as never, input: baseInput(), context: {} });

    expect(result.created).toBe(false);
    expect(result.order.id).toMatch(/^order_/);
    expect(result.order.operatorName).toBe('Outro pod');
  });

  it('erro de create() que NÃO é ALREADY_EXISTS continua propagando', async () => {
    const unavailable = Object.assign(new Error('14 UNAVAILABLE: Firestore fora do ar'), { code: 14 });
    const fake = makeFakeDb(initialDocuments(), { createError: unavailable });
    await expect(createOrderWithSideEffects({ db: fake.db as never, input: baseInput(), context: {} }))
      .rejects.toBe(unavailable);
  });

  it('desconto manual sem permissão de gerente segue recusado (403) mesmo com expectedTotalCents', async () => {
    const { caught } = await stale(baseInput({ discount: 10, discountReason: 'Negociação comercial', expectedTotalCents: 15_000 }));
    expect(caught).toBeInstanceOf(OrderServiceError);
    expect((caught as OrderServiceError).code).toBe('DISCOUNT_FORBIDDEN');
    expect((caught as OrderServiceError).status).toBe(403);
  });
});
