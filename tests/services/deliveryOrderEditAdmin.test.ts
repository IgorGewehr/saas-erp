import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';

vi.mock('@/lib/services/structured-operation-log', () => ({ writeStructuredOperationLog: vi.fn() }));

// Permite forçar UMA falha em deductStockAdmin (simula corrida real entre a
// pré-checagem e a dedução) mantendo o resto do módulo real — prova que a
// compensação (devolver os itens antigos) roda quando a redução falha.
let forceDeductFailureOnce = false;
vi.mock('@/lib/services/stock-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/stock-admin')>();
  return {
    ...actual,
    deductStockAdmin: async (...args: Parameters<typeof actual.deductStockAdmin>) => {
      if (forceDeductFailureOnce) {
        forceDeductFailureOnce = false;
        throw new Error('estoque insuficiente (corrida simulada)');
      }
      return actual.deductStockAdmin(...args);
    },
  };
});

import { ProductV2Schema, type ProductV2 } from '@/contracts/domain/productV2';
import {
  editDeliveryOrderAdmin,
  DeliveryOrderEditBlockedError,
} from '@/lib/services/delivery-order-edit-admin';

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
    'products/p1': stored(product({ currentStock: 5 })),
    'products/p2': stored(product({ id: 'p2', name: 'Refrigerante', currentStock: 10 })),
    ...overrides,
  };
}

beforeEach(() => {
  forceDeductFailureOnce = false;
});

describe('editDeliveryOrderAdmin — reconciliação/bloqueio de edição pós-efeito', () => {
  it('reconcilia estoque ao trocar itens com pedido em recebido (restaura antigo + deduz novo)', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order() }));

    const result = await editDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', actor, now: NOW,
      patch: { items: [{ productId: 'p1', productName: 'Pizza', quantity: 3, unitPrice: 40, total: 120 }] },
    });

    expect(result.stockReconciled).toBe(true);
    expect(result.order.items).toHaveLength(1);
    expect(result.order.items[0]).toMatchObject({ quantity: 3 });
    expect(result.order.subtotal).toBe(120);
    expect(result.order.total).toBe(120);
    // Estoque: 5 (fixture) + 1 (restaura item antigo, qty 1) - 3 (deduz item novo, qty 3) = 3.
    expect(fake.get('products/p1')?.currentStock).toBe(3);
  });

  it('reconcilia trocando de produto (item antigo devolvido, item novo debitado)', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order() }));

    await editDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', actor, now: NOW,
      patch: { items: [{ productId: 'p2', productName: 'Refrigerante', quantity: 2, unitPrice: 10, total: 20 }] },
    });

    expect(fake.get('products/p1')?.currentStock).toBe(6); // 5 (fixture) + 1 restaurado (item antigo saiu do pedido)
    expect(fake.get('products/p2')?.currentStock).toBe(8); // 10 - 2
  });

  it('rejeita alterar itens/valores com pedido fora de recebido', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order({ status: 'preparando' }) }));

    await expect(editDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', actor, now: NOW,
      patch: { items: [{ productId: 'p1', productName: 'Pizza', quantity: 5, unitPrice: 40, total: 200 }] },
    })).rejects.toBeInstanceOf(DeliveryOrderEditBlockedError);

    expect(fake.get('products/p1')?.currentStock).toBe(5); // nada tocado
    expect(fake.get('deliveryOrders/order-1')?.items).toHaveLength(1); // pedido inalterado
  });

  it('permite editar campos livres (notas) em qualquer status, sem tocar estoque', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order({ status: 'entregue' }) }));

    const result = await editDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', actor, now: NOW,
      patch: { internalNotes: 'Cliente pediu sem cebola' },
    });

    expect(result.stockReconciled).toBe(false);
    expect(result.order.internalNotes).toBe('Cliente pediu sem cebola');
    expect(fake.get('products/p1')?.currentStock).toBe(5);
  });

  it('rejeita quando os itens novos não cabem no estoque projetado (pré-checagem, nada é tocado)', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order() }));

    await expect(editDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', actor, now: NOW,
      patch: { items: [{ productId: 'p1', productName: 'Pizza', quantity: 999, unitPrice: 40, total: 39960 }] },
    })).rejects.toBeInstanceOf(DeliveryOrderEditBlockedError);

    expect(fake.get('products/p1')?.currentStock).toBe(5); // pré-checagem barrou antes de restaurar/deduzir
    expect(fake.get('deliveryOrders/order-1')?.items).toHaveLength(1);
  });

  it('compensa (devolve itens antigos) quando a dedução falha após a pré-checagem passar', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order() }));
    forceDeductFailureOnce = true;

    await expect(editDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', actor, now: NOW,
      patch: { items: [{ productId: 'p1', productName: 'Pizza', quantity: 2, unitPrice: 40, total: 80 }] },
    })).rejects.toThrow('corrida simulada');

    // Restaurou o item antigo (5→6) e depois compensou deduzindo-o de volta (6→5) — estoque líquido intacto.
    expect(fake.get('products/p1')?.currentStock).toBe(5);
    expect(fake.get('deliveryOrders/order-1')?.items).toHaveLength(1); // pedido não foi atualizado (erro propagado antes do update)
  });

  it('isola pedido de outro tenant', async () => {
    const fake = makeFakeDb(initialDocuments({ 'deliveryOrders/order-1': order({ businessId: 'biz2' }) }));

    await expect(editDeliveryOrderAdmin({
      db: fake.db, orderId: 'order-1', businessId: 'biz1', actor, now: NOW,
      patch: { internalNotes: 'x' },
    })).rejects.toBeInstanceOf(DeliveryOrderEditBlockedError);
  });
});
