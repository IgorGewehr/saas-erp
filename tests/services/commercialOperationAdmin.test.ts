import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('@/lib/services/structured-operation-log', () => ({ writeStructuredOperationLog: vi.fn() }));

import { CommercialOperationSchema } from '@/contracts/domain/commercialOperation';
import { ProductV2Schema, type ProductV2 } from '@/contracts/domain/productV2';
import { buildCommercialQuote } from '@/lib/services/commercial-quote';
import {
  buildCommercialOperationIdentity,
  CommercialOperationDocumentConflictError,
  CommercialOperationIdempotencyConflictError,
  CommercialOperationInProgressError,
  CommercialOperationCompensationRequiredError,
  ensureCommercialEffectDocumentAdmin,
  requestCommercialOperationCompensationAdmin,
  runCommercialOperationAdmin,
} from '@/lib/services/commercial-operation-admin';

interface FakeRef {
  id: string;
  _coll: string;
  get: () => Promise<{ id: string; exists: boolean; data: () => Record<string, unknown> | undefined }>;
}
interface FakeQuery {
  _coll: string;
  _filters: Array<{ field: string; expected: unknown }>;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
  orderBy: () => FakeQuery;
  limit: () => FakeQuery;
}

type PendingWrite =
  | { kind: 'create' | 'set'; ref: FakeRef; data: Record<string, unknown> }
  | { kind: 'update'; ref: FakeRef; data: Record<string, unknown> };

function clone<T>(value: T): T { return structuredClone(value); }

function makeFakeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]));
  let transactionTail: Promise<void> = Promise.resolve();

  const db = {
    collection(coll: string) {
      const makeQuery = (filters: FakeQuery['_filters']): FakeQuery => ({
        _coll: coll,
        _filters: filters,
        where(field: string, operator: string, expected: unknown) {
          if (operator !== '==') throw new Error(`Operador não suportado: ${operator}`);
          return makeQuery([...filters, { field, expected }]);
        },
        orderBy() { return makeQuery(filters); },
        limit() { return makeQuery(filters); },
      });
      return {
        doc(id: string): FakeRef {
          const ref: FakeRef = {
            id,
            _coll: coll,
            async get() {
              const data = documents.get(`${coll}/${id}`);
              return { id, exists: Boolean(data), data: () => data ? clone(data) : undefined };
            },
          };
          return ref;
        },
        where(field: string, operator: string, expected: unknown) {
          return makeQuery([]).where(field, operator, expected);
        },
      };
    },
    async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const writes: PendingWrite[] = [];
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
          return { id: ref.id, exists: Boolean(data), data: () => data ? clone(data) : undefined };
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
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(`${collection}/`))
        .map(([path, data]) => ({ id: path.slice(collection.length + 1), data: clone(data) }));
    },
  };
}

const NOW = new Date('2026-08-29T16:00:00.000Z');

function product(overrides: Record<string, unknown> = {}): ProductV2 {
  return ProductV2Schema.parse({
    schemaVersion: 2,
    id: 'p1',
    businessId: 'biz1',
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
    ...overrides,
  });
}

function seedProduct(item: ProductV2) {
  const { id, ...data } = item;
  return { [`products/${id}`]: data as Record<string, unknown> };
}

function operationRequest(item = product(), overrides: Record<string, unknown> = {}) {
  const quote = buildCommercialQuote({
    schemaVersion: 2,
    businessId: item.businessId,
    channel: 'pdv',
    lines: [{ lineId: 'line-1', productId: item.id, quantity: 2 }],
    tipCents: 0,
  }, {
    products: new Map([[item.id, item]]),
    services: new Map(),
    canApplyManualDiscount: false,
  }, NOW);
  return {
    schemaVersion: 1,
    businessId: item.businessId,
    idempotencyKey: 'checkout-operation-1',
    sourceType: 'sale',
    channel: 'pdv',
    quote,
    target: { collection: 'sales' },
    document: { businessId: item.businessId, status: 'finalizada', total: 20, items: [] },
    payments: [],
    benefits: [],
    actor: { id: 'user-1', name: 'Operador', type: 'user' },
    ...overrides,
  };
}

function storedOperation(fake: ReturnType<typeof makeFakeDb>, request: ReturnType<typeof operationRequest>) {
  const identity = buildCommercialOperationIdentity(request);
  return CommercialOperationSchema.parse({
    ...fake.get(`commercialOperations/${identity.operationId}`),
    operationId: identity.operationId,
  });
}

describe('M02.2 — coordenador comercial recuperável', () => {
  it('conclui checkpoints, estoque, documento e evento com referências exatas', async () => {
    const item = product();
    const fake = makeFakeDb(seedProduct(item));
    const request = operationRequest(item);
    const identity = buildCommercialOperationIdentity(request);

    const result = await runCommercialOperationAdmin({ db: fake.db, request, now: () => NOW });

    expect(result).toMatchObject({
      operationId: identity.operationId,
      documentCollection: 'sales',
      documentId: identity.effectIds.documentId,
      replayed: false,
    });
    expect(fake.get('products/p1')?.currentStock).toBe(3);
    expect(fake.list('stockMovements')).toHaveLength(1);
    expect(fake.list('domainEvents')).toHaveLength(1);
    expect(fake.get(`sales/${identity.effectIds.documentId}`)).toMatchObject({
      businessId: 'biz1',
      commercialOperationId: identity.operationId,
      commercialOperationStatus: 'completed',
      stockMovementIds: result.effects.stockMovementIds,
      commercialEventId: result.domainEventId,
    });
    const operation = storedOperation(fake, request);
    expect(operation.status).toBe('completed');
    expect(operation.lease).toBeNull();
    expect(Object.values(operation.checkpoints).every((checkpoint) =>
      checkpoint.status === 'completed' || checkpoint.status === 'skipped')).toBe(true);
  });

  it('replay completo não duplica documento, evento, movimento ou saldo', async () => {
    const item = product();
    const fake = makeFakeDb(seedProduct(item));
    const request = operationRequest(item);
    const first = await runCommercialOperationAdmin({ db: fake.db, request, now: () => NOW });
    const replay = await runCommercialOperationAdmin({ db: fake.db, request, now: () => NOW });

    expect(replay).toMatchObject({ operationId: first.operationId, documentId: first.documentId, replayed: true });
    expect(fake.get('products/p1')?.currentStock).toBe(3);
    expect(fake.list('sales')).toHaveLength(1);
    expect(fake.list('stockMovements')).toHaveLength(1);
    expect(fake.list('domainEvents')).toHaveLength(1);
  });

  it('replay usa a intenção persistida quando a própria baixa torna a nova cotação indisponível', async () => {
    const item = product({ currentStock: 2 });
    const fake = makeFakeDb(seedProduct(item));
    const request = operationRequest(item);
    const first = await runCommercialOperationAdmin({ db: fake.db, request, now: () => NOW });
    const unavailableReplay = structuredClone(request);
    unavailableReplay.quote.quotedAt = '2026-08-30T10:00:00.000Z';
    unavailableReplay.quote.lines[0].stockRequirements[0].available = 0;
    unavailableReplay.quote.availability = {
      available: false,
      shortages: [structuredClone(unavailableReplay.quote.lines[0].stockRequirements[0])],
    };

    const replay = await runCommercialOperationAdmin({ db: fake.db, request: unavailableReplay, now: () => NOW });

    expect(replay).toMatchObject({ operationId: first.operationId, replayed: true });
    expect(fake.get('products/p1')?.currentStock).toBe(0);
    expect(fake.list('stockMovements')).toHaveLength(1);
    expect(fake.list('sales')).toHaveLength(1);
  });

  it('retoma queda após o estoque usando o replay do núcleo M01', async () => {
    const item = product();
    const fake = makeFakeDb(seedProduct(item));
    const request = operationRequest(item);
    let crash = true;

    await expect(runCommercialOperationAdmin({
      db: fake.db,
      request,
      now: () => NOW,
      faults: {
        afterCheckpointEffect(checkpoint) {
          if (checkpoint === 'stock_applied' && crash) {
            crash = false;
            throw new Error('queda após estoque');
          }
        },
      },
    })).rejects.toThrow(/queda após estoque/);

    expect(fake.get('products/p1')?.currentStock).toBe(3);
    expect(storedOperation(fake, request)).toMatchObject({
      status: 'failed',
      checkpoints: { stock_applied: { status: 'failed' } },
    });

    await runCommercialOperationAdmin({ db: fake.db, request, now: () => NOW });
    const operation = storedOperation(fake, request);
    expect(operation.status).toBe('completed');
    expect((operation.checkpoints.stock_applied.result as { replayed: boolean }).replayed).toBe(true);
    expect(fake.get('products/p1')?.currentStock).toBe(3);
    expect(fake.list('stockMovements')).toHaveLength(1);
  });

  it('retoma queda após persistir o documento sem criar uma segunda venda', async () => {
    const item = product({ trackStock: false });
    const fake = makeFakeDb(seedProduct(item));
    const request = operationRequest(item);
    let crash = true;

    await expect(runCommercialOperationAdmin({
      db: fake.db,
      request,
      now: () => NOW,
      faults: {
        afterCheckpointEffect(checkpoint) {
          if (checkpoint === 'document_persisted' && crash) {
            crash = false;
            throw new Error('queda após documento');
          }
        },
      },
    })).rejects.toThrow(/queda após documento/);
    expect(fake.list('sales')).toHaveLength(1);

    await runCommercialOperationAdmin({ db: fake.db, request, now: () => NOW });
    expect(fake.list('sales')).toHaveLength(1);
    expect(storedOperation(fake, request).status).toBe('completed');
  });

  it('retoma queda após gravar o evento sem duplicar a auditoria', async () => {
    const item = product({ trackStock: false });
    const fake = makeFakeDb(seedProduct(item));
    const request = operationRequest(item);
    let crash = true;

    await expect(runCommercialOperationAdmin({
      db: fake.db,
      request,
      now: () => NOW,
      faults: {
        afterCheckpointEffect(checkpoint) {
          if (checkpoint === 'event_enqueued' && crash) {
            crash = false;
            throw new Error('queda após evento');
          }
        },
      },
    })).rejects.toThrow(/queda após evento/);
    expect(fake.list('domainEvents')).toHaveLength(1);

    await runCommercialOperationAdmin({ db: fake.db, request, now: () => NOW });
    expect(fake.list('domainEvents')).toHaveLength(1);
    expect(storedOperation(fake, request).status).toBe('completed');
  });

  it('retoma efeito downstream determinístico sem duplicar transação', async () => {
    const item = product({ trackStock: false });
    const fake = makeFakeDb(seedProduct(item));
    const request = operationRequest(item, {
      payments: [{ allocationId: 'pix-1', method: 'pix', amountCents: 2000, status: 'paid' }],
    });
    let crash = true;
    const handlers = {
      async reconcileDownstream(context: Parameters<NonNullable<import('@/lib/services/commercial-operation-admin').CommercialOperationHandlers['reconcileDownstream']>>[0]) {
        const transactionId = context.effectIds.transactionIds['pix-1'];
        await ensureCommercialEffectDocumentAdmin({
          db: context.db,
          collection: 'transactions',
          documentId: transactionId,
          businessId: context.request.businessId,
          operationId: context.operationId,
          data: { type: 'receita', status: 'pago', amount: 20 },
          now: NOW,
        });
        return { transactionIds: [transactionId] };
      },
    };

    await expect(runCommercialOperationAdmin({
      db: fake.db,
      request,
      handlers,
      now: () => NOW,
      faults: {
        afterCheckpointEffect(checkpoint) {
          if (checkpoint === 'downstream_reconciled' && crash) {
            crash = false;
            throw new Error('queda após financeiro');
          }
        },
      },
    })).rejects.toThrow(/queda após financeiro/);
    expect(fake.list('transactions')).toHaveLength(1);

    const result = await runCommercialOperationAdmin({ db: fake.db, request, handlers, now: () => NOW });
    expect(fake.list('transactions')).toHaveLength(1);
    expect(result.effects.transactionIds).toEqual([buildCommercialOperationIdentity(request).effectIds.transactionIds['pix-1']]);
  });

  it('lease impede duas execuções simultâneas da mesma operação', async () => {
    const item = product({ trackStock: false });
    const fake = makeFakeDb(seedProduct(item));
    const request = operationRequest(item, {
      benefits: [{ intentId: 'coupon-1', type: 'coupon', action: 'redeem', referenceId: 'coupon-a', code: 'CUPOM10', amountCents: 100 }],
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const handlers = {
      async reserveBenefits() {
        entered();
        await blocked;
        return { couponRedemptionIds: [buildCommercialOperationIdentity(request).effectIds.couponRedemptionIds['coupon-1']] };
      },
    };

    const first = runCommercialOperationAdmin({ db: fake.db, request, handlers, now: () => NOW });
    await enteredPromise;
    await expect(runCommercialOperationAdmin({ db: fake.db, request, handlers, now: () => NOW }))
      .rejects.toBeInstanceOf(CommercialOperationInProgressError);
    release();
    await first;
    expect(fake.list('sales')).toHaveLength(1);
  });

  it('rejeita a mesma chave com payload diferente e conflito do documento antes do estoque', async () => {
    const item = product();
    const fake = makeFakeDb(seedProduct(item));
    const request = operationRequest(item);
    await runCommercialOperationAdmin({ db: fake.db, request, now: () => NOW });
    await expect(runCommercialOperationAdmin({
      db: fake.db,
      request: { ...request, document: { ...request.document, notes: 'payload diferente' } },
      now: () => NOW,
    })).rejects.toBeInstanceOf(CommercialOperationIdempotencyConflictError);

    const secondRequest = operationRequest(item, { idempotencyKey: 'checkout-operation-2' });
    const identity = buildCommercialOperationIdentity(secondRequest);
    const conflictFake = makeFakeDb({
      ...seedProduct(item),
      [`sales/${identity.effectIds.documentId}`]: { businessId: 'other', commercialOperationId: 'foreign' },
    });
    await expect(runCommercialOperationAdmin({ db: conflictFake.db, request: secondRequest, now: () => NOW }))
      .rejects.toBeInstanceOf(CommercialOperationDocumentConflictError);
    expect(conflictFake.get('products/p1')?.currentStock).toBe(5);
    expect(conflictFake.list('stockMovements')).toHaveLength(0);
  });

  it('protege um efeito determinístico contra replay com payload divergente', async () => {
    const fake = makeFakeDb();
    const base = {
      db: fake.db,
      collection: 'transactions' as const,
      documentId: 'transaction-1',
      businessId: 'biz1',
      operationId: 'operation-1',
      data: { type: 'receita', amount: 20 },
      now: NOW,
    };

    await expect(ensureCommercialEffectDocumentAdmin(base)).resolves.toMatchObject({ replayed: false });
    await expect(ensureCommercialEffectDocumentAdmin(base)).resolves.toMatchObject({ replayed: true });
    await expect(ensureCommercialEffectDocumentAdmin({
      ...base,
      data: { type: 'receita', amount: 21 },
    })).rejects.toBeInstanceOf(CommercialOperationIdempotencyConflictError);
    expect(fake.list('transactions')).toHaveLength(1);
  });

  it('registra pedido de compensação idempotente e bloqueia novo checkout', async () => {
    const item = product({ trackStock: false });
    const fake = makeFakeDb(seedProduct(item));
    const request = operationRequest(item);
    const completed = await runCommercialOperationAdmin({ db: fake.db, request, now: () => NOW });
    const actor = { id: 'manager-1', name: 'Gerente', type: 'user' as const };

    const first = await requestCommercialOperationCompensationAdmin({
      db: fake.db,
      businessId: 'biz1',
      operationId: completed.operationId,
      reason: 'Cancelamento solicitado pelo cliente',
      actor,
      now: new Date('2026-08-29T17:00:00.000Z'),
    });
    const replay = await requestCommercialOperationCompensationAdmin({
      db: fake.db,
      businessId: 'biz1',
      operationId: completed.operationId,
      reason: 'Cancelamento solicitado pelo cliente',
      actor,
      now: new Date('2026-08-29T17:01:00.000Z'),
    });
    expect(first.replayed).toBe(false);
    expect(first.operation).toMatchObject({ status: 'compensation_pending', compensation: { status: 'pending' } });
    expect(replay.replayed).toBe(true);
    await expect(runCommercialOperationAdmin({ db: fake.db, request, now: () => NOW }))
      .rejects.toBeInstanceOf(CommercialOperationCompensationRequiredError);
  });
});
