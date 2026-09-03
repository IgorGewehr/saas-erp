/**
 * Núcleo de comanda de mesa (lib/services/table-session-admin.ts).
 *
 * Prova: abertura idempotente; fechamento congela o subtotal a partir dos
 * pedidos vinculados; a liquidação delega a `transitionDeliveryOrderAdmin` com
 * `settleViaSaleId` (RECEITA ÚNICA) e é no-op num segundo settle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/contracts/_runtime/dispatch', () => ({ dispatchDomainEvent: vi.fn().mockResolvedValue(undefined) }));

const transitionMock = vi.fn().mockResolvedValue({ order: {}, stockApplied: false, revenueBooked: false, stockAlerts: [] });
vi.mock('@/lib/services/delivery-order-transition-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/delivery-order-transition-admin')>();
  return { ...actual, transitionDeliveryOrderAdmin: (...args: unknown[]) => transitionMock(...args) };
});

import {
  openTableSessionAdmin,
  closeTableSessionAdmin,
  settleTableSessionAdmin,
  TableSessionError,
} from '@/lib/services/table-session-admin';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const actor = { id: 'u1', name: 'Garçom', type: 'user' as const };

// ── Fake Firestore mínimo ───────────────────────────────────────────────────
function clone<T>(v: T): T { return structuredClone(v); }

function makeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, clone(v)]));
  let auto = 0;

  const snap = (path: string) => ({
    id: path.split('/').pop()!,
    get exists() { return docs.has(path); },
    data: () => (docs.has(path) ? clone(docs.get(path)) : undefined),
  });

  const applyMerge = (path: string, patch: Record<string, unknown>) => {
    const cur = docs.get(path) ?? {};
    docs.set(path, { ...cur, ...patch });
  };

  const coll = (name: string) => {
    const makeQuery = (filters: Array<[string, unknown]>) => ({
      _q: true as const,
      where(f: string, _op: string, v: unknown) { return makeQuery([...filters, [f, v]]); },
      limit() { return this; },
      get: async () => queryRun(filters),
    });
    const queryRun = (filters: Array<[string, unknown]>) => {
      const prefix = `${name}/`;
      const matched = [...docs.entries()].filter(([p, d]) =>
        p.startsWith(prefix) && !p.slice(prefix.length).includes('/')
        && filters.every(([f, v]) => (d as Record<string, unknown>)[f] === v));
      return { empty: matched.length === 0, docs: matched.map(([p]) => snap(p)) };
    };
    return {
      doc: (id?: string) => {
        const docId = id ?? `auto${++auto}`;
        const path = `${name}/${docId}`;
        return {
          id: docId, _path: path,
          get: async () => snap(path),
          update: async (patch: Record<string, unknown>) => applyMerge(path, patch),
          set: async (data: Record<string, unknown>) => docs.set(path, clone(data)),
        };
      },
      where: (f: string, op: string, v: unknown) => makeQuery([]).where(f, op, v),
    };
  };

  return {
    db: {
      collection: coll,
      getAll: async (...refs: Array<{ _path: string }>) => refs.map(r => snap(r._path)),
      runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
        const tx = {
          get: async (refOrQuery: { _q?: true; get: () => Promise<unknown>; _path?: string }) =>
            refOrQuery._q ? refOrQuery.get() : snap(refOrQuery._path!),
          set: (ref: { _path: string }, data: Record<string, unknown>) => docs.set(ref._path, clone(data)),
          update: (ref: { _path: string }, data: Record<string, unknown>) => applyMerge(ref._path, data),
        };
        return fn(tx);
      },
    } as never,
    get: (path: string) => docs.get(path),
  };
}

beforeEach(() => {
  transitionMock.mockClear();
});

const openSession = (over: Record<string, unknown> = {}) => ({
  businessId: 'biz1', tableLabel: 'Mesa 12', status: 'aberta',
  openedAt: NOW.toISOString(), openedByUid: 'u1', openedByName: 'Garçom',
  orderIds: [] as string[], createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over,
});
const ord = (over: Record<string, unknown> = {}) => ({
  businessId: 'biz1', status: 'pronto', total: 30, tableSessionId: 'sess-1', ...over,
});

describe('openTableSessionAdmin', () => {
  it('reusa a sessão aberta da mesma mesa (idempotente)', async () => {
    const fake = makeDb({ 'tableSessions/sess-1': openSession() });
    const r = await openTableSessionAdmin({ db: fake.db, businessId: 'biz1', tableLabel: 'Mesa 12', actor, now: NOW });
    expect(r.created).toBe(false);
    expect(r.session.id).toBe('sess-1');
  });

  it('cria nova sessão quando não há aberta', async () => {
    const fake = makeDb();
    const r = await openTableSessionAdmin({ db: fake.db, businessId: 'biz1', tableLabel: 'Mesa 5', actor, now: NOW });
    expect(r.created).toBe(true);
    expect(r.session.status).toBe('aberta');
  });
});

describe('closeTableSessionAdmin', () => {
  it('congela o subtotal a partir dos pedidos não-cancelados', async () => {
    const fake = makeDb({
      'tableSessions/sess-1': openSession({ orderIds: ['o1', 'o2', 'o3'] }),
      'deliveryOrders/o1': ord({ total: 30 }),
      'deliveryOrders/o2': ord({ total: 45.5 }),
      'deliveryOrders/o3': ord({ total: 100, status: 'cancelado' }),
    });
    const s = await closeTableSessionAdmin({ db: fake.db, sessionId: 'sess-1', businessId: 'biz1', actor, now: NOW });
    expect(s.status).toBe('fechada');
    expect(s.subtotalSnapshot).toBe(75.5);
    expect(fake.get('tableSessions/sess-1')?.subtotalSnapshot).toBe(75.5);
  });

  it('rejeita comanda de outro negócio', async () => {
    const fake = makeDb({ 'tableSessions/sess-1': openSession({ businessId: 'biz2' }) });
    await expect(closeTableSessionAdmin({ db: fake.db, sessionId: 'sess-1', businessId: 'biz1', actor, now: NOW }))
      .rejects.toBeInstanceOf(TableSessionError);
  });
});

describe('settleTableSessionAdmin', () => {
  it('marca cada pedido não-terminal como entregue via settleViaSaleId e fecha a comanda', async () => {
    const fake = makeDb({
      'tableSessions/sess-1': openSession({ status: 'fechada', closedAt: NOW.toISOString(), closedByUid: 'u1', subtotalSnapshot: 60, orderIds: ['o1', 'o2'] }),
      'deliveryOrders/o1': ord({ total: 30 }),
      'deliveryOrders/o2': ord({ total: 30, status: 'entregue' }),
    });
    const r = await settleTableSessionAdmin({ db: fake.db, sessionId: 'sess-1', businessId: 'biz1', saleId: 'sale-7', actor, now: NOW });

    expect(r.alreadySettled).toBe(false);
    expect(r.ordersDelivered).toEqual(['o1']); // o2 já terminal
    expect(transitionMock).toHaveBeenCalledTimes(1);
    expect(transitionMock).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', targetStatus: 'entregue', settleViaSaleId: 'sale-7' }));
    expect(fake.get('tableSessions/sess-1')).toMatchObject({ status: 'paga', saleId: 'sale-7' });
  });

  it('é no-op num segundo settle com a mesma Sale', async () => {
    const fake = makeDb({
      'tableSessions/sess-1': openSession({ status: 'paga', closedAt: NOW.toISOString(), closedByUid: 'u1', subtotalSnapshot: 30, saleId: 'sale-7', paidAt: NOW.toISOString(), orderIds: ['o1'] }),
      'deliveryOrders/o1': ord({ status: 'entregue' }),
    });
    const r = await settleTableSessionAdmin({ db: fake.db, sessionId: 'sess-1', businessId: 'biz1', saleId: 'sale-7', actor, now: NOW });
    expect(r.alreadySettled).toBe(true);
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it('rejeita settle com Sale diferente da já registrada', async () => {
    const fake = makeDb({
      'tableSessions/sess-1': openSession({ status: 'paga', closedAt: NOW.toISOString(), closedByUid: 'u1', subtotalSnapshot: 30, saleId: 'sale-7', paidAt: NOW.toISOString() }),
    });
    await expect(settleTableSessionAdmin({ db: fake.db, sessionId: 'sess-1', businessId: 'biz1', saleId: 'sale-OTHER', actor, now: NOW }))
      .rejects.toMatchObject({ code: 'ALREADY_SETTLED' });
  });
});
