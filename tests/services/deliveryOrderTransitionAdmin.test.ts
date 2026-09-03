import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('@/lib/services/structured-operation-log', () => ({ writeStructuredOperationLog: vi.fn() }));

// restoreOrderStockRecoverable (lib/services/order-stock-restore.ts) usa o
// singleton global `adminDb`, não o `db` injetado — inalcançável pelo fake
// local. Mockamos a função inteira: o objetivo aqui é provar que o novo
// serviço DELEGA corretamente pra ela (orderId/businessId/contexto certos) e
// aplica seu próprio patch de cancelamento, não reverificar a mecânica de
// restauro em si (já coberta em produção pelo agente/Mercado Pago, que já a
// usam sem alteração nesta fatia).
const restoreOrderStockRecoverableMock = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/services/order-stock-restore', () => ({
  restoreOrderStockRecoverable: (...args: unknown[]) => restoreOrderStockRecoverableMock(...args),
}));

import { ProductV2Schema, type ProductV2 } from '@/contracts/domain/productV2';
import {
  transitionDeliveryOrderAdmin,
  DeliveryOrderTransitionError,
} from '@/lib/services/delivery-order-transition-admin';

interface FakeQuery {
  _coll: string;
  _filters: Array<{ field: string; op: string; expected: unknown }>;
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
  update: (data: Record<string, unknown>) => Promise<void>;
}

interface FakeCollection {
  doc: (id?: string) => FakeRef;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
  add: (data: Record<string, unknown>) => Promise<FakeRef>;
}

type PendingWrite =
  | { kind: 'create' | 'set'; ref: FakeRef; data: Record<string, unknown> }
  | { kind: 'update'; ref: FakeRef; data: Record<string, unknown> };

function clone<T>(value: T): T { return structuredClone(value); }

function mergeWithIncrement(current: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && '__increment' in (value as Record<string, unknown>)) {
      merged[key] = Number(current[key] ?? 0) + Number((value as { __increment: number }).__increment);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function fieldValue(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), data);
}

let autoIdCounter = 0;

function makeFakeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]));
  let transactionTail: Promise<void> = Promise.resolve();

  const snapshot = (ref: FakeRef): FakeSnapshot => {
    const data = documents.get(`${ref._coll}/${ref.id}`);
    return { id: ref.id, exists: Boolean(data), data: () => data ? clone(data) : undefined };
  };
  const matchesFilter = (data: Record<string, unknown>, filter: FakeQuery['_filters'][number]): boolean => {
    const value = fieldValue(data, filter.field);
    if (filter.op === 'in') return Array.isArray(filter.expected) && (filter.expected as unknown[]).includes(value);
    return value === filter.expected;
  };
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
    where(field: string, operator: string, expected: unknown) {
      return makeQuery(coll, [...filters, { field, op: operator, expected }]);
    },
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
        collection(name: string) { return makeCollection(`${coll}/${docId}/${name}`); },
        async update(data: Record<string, unknown>) {
          const path = `${coll}/${docId}`;
          const current = documents.get(path);
          if (!current) throw new Error(`Documento ausente: ${path}`);
          documents.set(path, mergeWithIncrement(current, data));
        },
      };
      return ref;
    },
    where(field: string, operator: string, expected: unknown) {
      return makeQuery(coll, []).where(field, operator, expected);
    },
    async add(data: Record<string, unknown>) {
      const ref = this.doc();
      documents.set(`${ref._coll}/${ref.id}`, clone(data));
      return ref;
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
            documents.set(path, mergeWithIncrement(current, clone(write.data)));
          } else {
            documents.set(path, clone(write.data));
          }
        }
        return result;
      } finally {
        release();
      }
    },
    async update(ref: FakeRef, data: Record<string, unknown>) {
      const path = `${ref._coll}/${ref.id}`;
      const current = documents.get(path);
      if (!current) throw new Error(`Documento ausente: ${path}`);
      documents.set(path, mergeWithIncrement(current, data));
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

const NOW = new Date('2026-09-01T18:00:00.000Z');
const actor = { id: 'user-1', name: 'Atendente Teste', type: 'user' as const };

function product(overrides: Record<string, unknown> = {}): ProductV2 {
  return ProductV2Schema.parse({
    schemaVersion: 2,
    id: 'p1',
    businessId: 'biz1',
    kind: 'simple',
    name: 'Pizza',
    category: 'Geral',
    unit: 'UN',
    purchaseUnit: 'UN',
    purchaseToStockFactor: 1,
    costMethod: 'moving_average',
    costPrice: 10,
    salePrice: 40,
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

function stored<T extends { id: string }>(item: T) {
  const { id, ...data } = item;
  return data as Record<string, unknown>;
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    businessId: 'biz1',
    number: 101,
    status: 'recebido',
    clientId: 'client-1',
    clientName: 'Cliente Teste',
    channel: 'manual',
    items: [{ productId: 'p1', productName: 'Pizza', quantity: 1, unitPrice: 40, total: 40 }],
    subtotal: 40,
    deliveryFee: 0,
    total: 40,
    deliveryType: 'retirada',
    paymentMethod: 'dinheiro',
    paymentStatus: 'pendente',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function initialDocuments(overrides: Record<string, Record<string, unknown>> = {}) {
  return {
    'products/p1': stored(product()),
    'clients/client-1': { businessId: 'biz1', name: 'Cliente Teste', visitCount: 1, loyaltyPoints: 0 },
    'businesses/biz1': { id: 'biz1', businessId: 'biz1' },
    ...overrides,
  };
}

describe('M02.5d — transição de status centralizada de deliveryOrders', () => {
  it('entrega pedido dinheiro-na-entrega: lança receita determinística e regista a compra do cliente', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order({ status: 'saiu_entrega' }) }));
    const result = await transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'entregue', actor, now: NOW,
    });

    expect(result.order).toMatchObject({ status: 'entregue', deliveredAt: NOW.toISOString(), transactionId: 'order-1_revenue' });
    expect(result.revenueBooked).toBe(true);
    expect(fake.get('transactions/order-1_revenue')).toMatchObject({ type: 'receita', amount: 40, status: 'pago' });
    expect(fake.get('clients/client-1/purchases/order-1')).toBeTruthy();
  });

  it('acumula fidelidade só na execução que lança a receita (não no replay)', async () => {
    const fake = makeFakeDb(initialDocuments({
      'deliveryOrders/order-1': order({ status: 'saiu_entrega' }),
      'businesses/biz1': { id: 'biz1', businessId: 'biz1', settings: { loyalty: { isEnabled: true, pointsPerReal: 1, pointValueInCentavos: 10, minPointsToRedeem: 10 } } },
    }));
    const first = await transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'entregue', actor, now: NOW,
    });
    expect(first.revenueBooked).toBe(true);
    expect(fake.get('clients/client-1')?.loyaltyPoints).toBe(40);

    const replay = await transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'entregue', actor, now: NOW,
    });
    expect(replay.revenueBooked).toBe(false);
    expect(fake.get('clients/client-1')?.loyaltyPoints).toBe(40); // não duplicou
    expect(fake.list('transactions')).toHaveLength(1); // não duplicou a receita
  });

  it('rejeita entrega de pedido online não pago', async () => {
    const fake = makeFakeDb(initialDocuments({
      'deliveryOrders/order-1': order({ status: 'saiu_entrega', paymentProvider: 'mercadopago', paymentFsmStatus: 'pending' }),
    }));
    await expect(transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'entregue', actor, now: NOW,
    })).rejects.toBeInstanceOf(DeliveryOrderTransitionError);
    expect(fake.list('transactions')).toHaveLength(0);
    expect(fake.get('deliveryOrders/order-1')?.status).toBe('saiu_entrega');
  });

  it('cancela delegando o restauro de estoque à função admin única e grava cancelledBy/cancelledByName', async () => {
    restoreOrderStockRecoverableMock.mockClear();
    const fake = makeFakeDb(initialDocuments({
      'products/p1': stored(product({ currentStock: 4 })), // já debitado 1 na criação
      'deliveryOrders/order-1': order({ status: 'preparando', stockDeductedAt: NOW.toISOString() }),
    }));
    const result = await transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'cancelado', actor, reason: 'Cliente desistiu', now: NOW,
    });

    expect(restoreOrderStockRecoverableMock).toHaveBeenCalledWith(
      'order-1', 'biz1', expect.objectContaining({ operatorName: 'Atendente Teste' }),
    );
    expect(result.order).toMatchObject({ status: 'cancelado', cancelledBy: 'user-1', cancelledByName: 'Atendente Teste' });
    expect(result.order.internalNotes).toContain('Cliente desistiu');
  });

  it('rejeita cancelar um pedido já entregue (fecha o gap do handleDelete legado)', async () => {
    const fake = makeFakeDb(initialDocuments({
      'deliveryOrders/order-1': order({ status: 'entregue', deliveredAt: NOW.toISOString(), transactionId: 'order-1_revenue' }),
    }));
    await expect(transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'cancelado', actor, now: NOW,
    })).rejects.toThrow(/FSM/);
    expect(fake.get('deliveryOrders/order-1')?.status).toBe('entregue');
  });

  it('rejeita pulo de estado inválido (recebido→entregue direto)', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order({ status: 'recebido' }) }));
    await expect(transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'entregue', actor, now: NOW,
    })).rejects.toThrow(/FSM/);
  });

  it('deduz estoque ao entrar em preparando para pedido legado sem stockDeductedAt', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order({ status: 'recebido' }) }));
    const result = await transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'preparando', actor, now: NOW,
    });

    expect(result.stockApplied).toBe(true);
    expect(result.order.stockDeductedAt).toBeTruthy();
    expect(fake.get('products/p1')?.currentStock).toBe(4);
  });

  it('não deduz de novo estoque já debitado ao entrar em preparando', async () => {
    const fake = makeFakeDb(initialDocuments({
      'deliveryOrders/order-1': order({ status: 'recebido', stockDeductedAt: NOW.toISOString() }),
    }));
    const result = await transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'preparando', actor, now: NOW,
    });

    expect(result.stockApplied).toBe(false);
    expect(fake.get('products/p1')?.currentStock).toBe(5); // inalterado
  });

  it('isola pedido de outro tenant', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order({ status: 'recebido', businessId: 'biz2' }) }));
    await expect(transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'preparando', actor, now: NOW,
    })).rejects.toBeInstanceOf(DeliveryOrderTransitionError);
  });

  // ── Comanda de mesa: entrega SEM receita própria (settleViaSaleId) ─────────
  it('entrega pedido de mesa com settleViaSaleId sem lançar receita própria', async () => {
    const fake = makeFakeDb(initialDocuments({
      'deliveryOrders/order-1': order({ status: 'pronto', deliveryType: 'mesa', tableNumber: '12', tableSessionId: 'sess-1' }),
    }));
    const result = await transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'entregue',
      actor, now: NOW, settleViaSaleId: 'sale-9',
    });

    expect(result.order).toMatchObject({ status: 'entregue', deliveredAt: NOW.toISOString(), settledViaSaleId: 'sale-9' });
    expect(result.order.transactionId).toBeUndefined();
    expect(result.revenueBooked).toBe(false);
    expect(fake.get('transactions/order-1_revenue')).toBeUndefined();
    expect(fake.get('clients/client-1/purchases/order-1')).toBeFalsy();
  });

  it('rejeita settleViaSaleId em pedido SEM tableSessionId', async () => {
    const fake = makeFakeDb(initialDocuments({
      'deliveryOrders/order-1': order({ status: 'pronto', deliveryType: 'mesa', tableNumber: '12' }),
    }));
    await expect(transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'entregue',
      actor, now: NOW, settleViaSaleId: 'sale-9',
    })).rejects.toMatchObject({ code: 'SETTLE_WITHOUT_TABLE_SESSION' });
  });

  it('sem settleViaSaleId, pedido de mesa ainda lança receita normal (mesa "solta")', async () => {
    const fake = makeFakeDb(initialDocuments({
      'deliveryOrders/order-1': order({ status: 'pronto', deliveryType: 'mesa', tableNumber: '12' }),
    }));
    const result = await transitionDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', targetStatus: 'entregue', actor, now: NOW,
    });
    expect(result.revenueBooked).toBe(true);
    expect(fake.get('transactions/order-1_revenue')).toMatchObject({ type: 'receita', amount: 40 });
  });
});
