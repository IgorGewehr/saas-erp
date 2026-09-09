import { describe, it, expect } from 'vitest';
import { cancelSaleAdmin, SaleCancelError } from '@/lib/services/sale-transition-admin';

// Fake Admin SDK — mesmo formato de tests/services/appointmentTxGuardAdmin.test.ts.
// Cenários usam sale.items=[] e sem transações/commercialOperationId vinculados,
// isolando o teste na lógica NOVA desta fatia (gate fiscal + CAS de stats do
// cliente) sem precisar fakear os internals de stock-core-admin.ts/
// transactionTxGuardAdmin.ts/commercial-benefits-admin.ts (já testados à parte).

type FakeDoc = { id: string; data: Record<string, unknown> };

function makeFakeAdminDb(initial: Record<string, FakeDoc[]> = {}) {
  const collections: Record<string, FakeDoc[]> = {};
  for (const k of Object.keys(initial)) collections[k] = initial[k].map((d) => ({ ...d, data: { ...d.data } }));

  function matchesFilter(actual: unknown, op: string, expected: unknown): boolean {
    if (op === 'in') return Array.isArray(expected) && expected.includes(actual);
    return actual === expected;
  }

  function makeQuery(name: string, filters: Array<[string, string, unknown]>) {
    return {
      where(field: string, op: string, val: unknown) {
        return makeQuery(name, [...filters, [field, op, val]]);
      },
      async get() {
        const docs = (collections[name] ?? []).filter((d) => filters.every(([f, op, v]) => matchesFilter(d.data[f], op, v)));
        return { size: docs.length, empty: docs.length === 0, docs: docs.map((d) => ({ id: d.id, data: () => d.data, ref: fake.collection(name).doc(d.id) })) };
      },
    };
  }

  const fake = {
    collection(name: string) {
      return {
        ...makeQuery(name, []),
        doc(id?: string) {
          const docId = id ?? `auto-${Math.random().toString(36).slice(2, 9)}`;
          return {
            id: docId,
            async get() {
              const found = (collections[name] ?? []).find((d) => d.id === docId);
              return { exists: !!found, id: docId, data: () => found?.data };
            },
            async set(data: Record<string, unknown>) {
              const list = (collections[name] ??= []);
              const idx = list.findIndex((d) => d.id === docId);
              if (idx >= 0) list[idx].data = data;
              else list.push({ id: docId, data });
            },
            async update(patch: Record<string, unknown>) {
              const list = (collections[name] ??= []);
              const idx = list.findIndex((d) => d.id === docId);
              if (idx < 0) throw new Error(`update on non-existing doc ${name}/${docId}`);
              list[idx].data = { ...list[idx].data, ...patch };
            },
          };
        },
      };
    },
    async runTransaction(cb: (tx: unknown) => Promise<unknown>) {
      const tx = {
        async get(refOrQuery: unknown) {
          return (refOrQuery as { get: () => Promise<unknown> }).get();
        },
        set(ref: { set: (d: Record<string, unknown>) => void }, data: Record<string, unknown>) { ref.set(data); },
        update(ref: { update: (p: Record<string, unknown>) => void }, patch: Record<string, unknown>) { ref.update(patch); },
      };
      return cb(tx);
    },
    collections,
  };
  return fake as unknown as FirebaseFirestore.Firestore & { collections: Record<string, FakeDoc[]> };
}

const businessId = 'biz1';

function baseSale(overrides: Record<string, unknown> = {}) {
  return {
    businessId,
    clientId: 'client1',
    status: 'finalizada',
    items: [],
    total: 100,
    operatorId: 'u1',
    operatorName: 'Operador',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function baseClient(overrides: Record<string, unknown> = {}) {
  return {
    businessId,
    name: 'Cliente X',
    totalSpent: 500,
    visitCount: 5,
    lastVisit: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('cancelSaleAdmin', () => {
  it('lança SALE_NOT_FOUND quando a venda não existe', async () => {
    const db = makeFakeAdminDb();
    await expect(cancelSaleAdmin({
      db, saleId: 'missing', businessId, actor: { id: 'u1', name: 'U1' },
    })).rejects.toThrow(SaleCancelError);
  });

  it('lança TENANT_MISMATCH quando a venda é de outro negócio', async () => {
    const db = makeFakeAdminDb({ sales: [{ id: 's1', data: baseSale({ businessId: 'other-biz' }) }] });
    await expect(cancelSaleAdmin({
      db, saleId: 's1', businessId, actor: { id: 'u1', name: 'U1' },
    })).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
  });

  it('bloqueia cancelamento quando a nota fiscal já está autorizada', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale({ fiscalDocId: 'fd1' }) }],
      fiscalDocuments: [{ id: 'fd1', data: { businessId, status: 'autorizada' } }],
    });
    await expect(cancelSaleAdmin({
      db, saleId: 's1', businessId, actor: { id: 'u1', name: 'U1' },
    })).rejects.toMatchObject({ code: 'FISCAL_DOCUMENT_ISSUED' });
  });

  it('permite cancelamento quando a nota fiscal NÃO está autorizada (pendente/rejeitada/etc)', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale({ fiscalDocId: 'fd1' }) }],
      fiscalDocuments: [{ id: 'fd1', data: { businessId, status: 'rejeitada' } }],
      clients: [{ id: 'client1', data: baseClient() }],
    });
    const result = await cancelSaleAdmin({ db, saleId: 's1', businessId, actor: { id: 'u1', name: 'U1' } });
    expect(result.sale.status).toBe('cancelada');
  });

  it('reverte totalSpent/visitCount/lastVisit do cliente exatamente uma vez', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale({ total: 100 }) }],
      clients: [{ id: 'client1', data: baseClient({ totalSpent: 500, visitCount: 5 }) }],
    });
    const result = await cancelSaleAdmin({ db, saleId: 's1', businessId, actor: { id: 'u1', name: 'U1' } });
    expect(result.clientStatsReversed).toBe(true);
    const client = db.collections.clients.find((c) => c.id === 'client1')!;
    expect(client.data.totalSpent).toBe(400);
    expect(client.data.visitCount).toBe(4);
  });

  it('CAS: reexecutar o cancelamento NÃO decrementa as stats do cliente de novo (fecha o bug do duplo-clique)', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale({ total: 100 }) }],
      clients: [{ id: 'client1', data: baseClient({ totalSpent: 500, visitCount: 5 }) }],
    });
    await cancelSaleAdmin({ db, saleId: 's1', businessId, actor: { id: 'u1', name: 'U1' } });
    const second = await cancelSaleAdmin({ db, saleId: 's1', businessId, actor: { id: 'u1', name: 'U1' } });
    expect(second.clientStatsReversed).toBe(false);
    const client = db.collections.clients.find((c) => c.id === 'client1')!;
    // Continua 400/4 — NÃO 300/3 (que seria o bug de duplo-decremento).
    expect(client.data.totalSpent).toBe(400);
    expect(client.data.visitCount).toBe(4);
  });

  it('não decrementa abaixo de zero mesmo com total maior que o saldo', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale({ total: 9999 }) }],
      clients: [{ id: 'client1', data: baseClient({ totalSpent: 50, visitCount: 1 }) }],
    });
    const result = await cancelSaleAdmin({ db, saleId: 's1', businessId, actor: { id: 'u1', name: 'U1' } });
    expect(result.sale.status).toBe('cancelada');
    const client = db.collections.clients.find((c) => c.id === 'client1')!;
    expect(client.data.totalSpent).toBe(0);
    expect(client.data.visitCount).toBe(0);
  });

  it('venda sem clientId não tenta reverter stats (sem erro)', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale({ clientId: undefined }) }],
    });
    const result = await cancelSaleAdmin({ db, saleId: 's1', businessId, actor: { id: 'u1', name: 'U1' } });
    expect(result.clientStatsReversed).toBe(false);
    expect(result.sale.status).toBe('cancelada');
  });

  it('reexecutar sobre uma venda já cancelada continua idempotente (não lança)', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale({ status: 'cancelada', clientStatsReversedAt: '2026-09-01T00:00:00.000Z' }) }],
      clients: [{ id: 'client1', data: baseClient() }],
    });
    const result = await cancelSaleAdmin({ db, saleId: 's1', businessId, actor: { id: 'u1', name: 'U1' } });
    expect(result.sale.status).toBe('cancelada');
    expect(result.clientStatsReversed).toBe(false);
  });
});
