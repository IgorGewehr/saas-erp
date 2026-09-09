import { describe, it, expect } from 'vitest';
import { transitionOrderAdmin, OrderTransitionError } from '@/lib/services/order-transition-admin';

// Fake Admin SDK — mesmo formato de tests/services/saleTransitionAdmin.test.ts,
// com tx.create() adicionado (createTransactionSafeAdmin usa tx.create pro CAS
// de idempotência real). Cobre a lógica de transição/efeitos de
// order-transition-admin.ts que tinha zero cobertura além de splitInstallments
// (achado da investigação de abertura do M02.7).

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
        create(ref: { id: string; get: () => Promise<{ exists: boolean }>; set: (d: Record<string, unknown>) => void }, data: Record<string, unknown>) {
          ref.set(data); // fake sem checagem síncrona de existência prévia — cenários de teste não colidem
        },
      };
      return cb(tx);
    },
    collections,
  };
  return fake as unknown as FirebaseFirestore.Firestore & { collections: Record<string, FakeDoc[]> };
}

const businessId = 'biz1';

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    businessId,
    type: 'b2b',
    status: 'confirmado',
    items: [{ serviceId: 'srv1', productName: 'Consultoria', quantity: 1, unitPrice: 300, total: 300 }],
    subtotal: 300,
    discount: 0,
    total: 300,
    installments: 1,
    operatorId: 'u1',
    operatorName: 'Operador',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('transitionOrderAdmin', () => {
  it('pendente → confirmado: só atualiza status, sem efeitos', async () => {
    const db = makeFakeAdminDb({ orders: [{ id: 'o1', data: baseOrder({ status: 'pendente' }) }] });
    const result = await transitionOrderAdmin({
      db, orderId: 'o1', businessId, targetStatus: 'confirmado', actor: { id: 'u1', name: 'U1' },
    });
    expect(result.order.status).toBe('confirmado');
    expect(result.invoiced).toBe(false);
    expect(result.stockApplied).toBe(false);
  });

  it('lança em transição inválida (pendente → entregue)', async () => {
    const db = makeFakeAdminDb({ orders: [{ id: 'o1', data: baseOrder({ status: 'pendente' }) }] });
    await expect(transitionOrderAdmin({
      db, orderId: 'o1', businessId, targetStatus: 'entregue', actor: { id: 'u1', name: 'U1' },
    })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('confirmado → faturado: lança 1 Transaction receita à vista (installments=1)', async () => {
    const db = makeFakeAdminDb({ orders: [{ id: 'o1', data: baseOrder({ installments: 1, total: 300 }) }] });
    const result = await transitionOrderAdmin({
      db, orderId: 'o1', businessId, targetStatus: 'faturado', actor: { id: 'u1', name: 'U1' },
    });
    expect(result.order.status).toBe('faturado');
    expect(result.invoiced).toBe(true);
    expect(result.transactionIds).toHaveLength(1);
    const tx = db.collections.transactions.find((t) => t.id === result.transactionIds[0])!;
    expect(tx.data.amount).toBe(300);
    expect(tx.data.status).toBe('pendente');
    expect(tx.data.orderId).toBe('o1');
  });

  it('confirmado → faturado: parcela em N Transactions com installmentGroupId=orderId', async () => {
    const db = makeFakeAdminDb({ orders: [{ id: 'o1', data: baseOrder({ installments: 3, total: 300 }) }] });
    const result = await transitionOrderAdmin({
      db, orderId: 'o1', businessId, targetStatus: 'faturado', actor: { id: 'u1', name: 'U1' },
    });
    expect(result.transactionIds).toHaveLength(3);
    const txs = result.transactionIds.map((id) => db.collections.transactions.find((t) => t.id === id)!.data);
    expect(txs.every((t) => t.installmentGroupId === 'o1')).toBe(true);
    expect(txs.map((t) => t.installmentNumber)).toEqual([1, 2, 3]);
    const total = txs.reduce((s, t) => s + (t.amount as number), 0);
    expect(Math.round(total * 100) / 100).toBe(300);
  });

  it('confirmado → faturado é bloqueado por reexecução (faturado→faturado é FSM-inválido)', async () => {
    const db = makeFakeAdminDb({ orders: [{ id: 'o1', data: baseOrder({ status: 'faturado' }) }] });
    await expect(transitionOrderAdmin({
      db, orderId: 'o1', businessId, targetStatus: 'faturado', actor: { id: 'u1', name: 'U1' },
    })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('faturado → cancelado: cancela as Transactions vinculadas', async () => {
    const db = makeFakeAdminDb({
      orders: [{ id: 'o1', data: baseOrder({ status: 'faturado', transactionIds: ['tx1'] }) }],
      transactions: [{ id: 'tx1', data: { businessId, type: 'receita', status: 'pendente', amount: 300, description: 'x', orderId: 'o1' } }],
    });
    const result = await transitionOrderAdmin({
      db, orderId: 'o1', businessId, targetStatus: 'cancelado', actor: { id: 'u1', name: 'U1' }, reason: 'cliente desistiu',
    });
    expect(result.order.status).toBe('cancelado');
    const tx = db.collections.transactions.find((t) => t.id === 'tx1')!;
    expect(tx.data.status).toBe('cancelado');
  });

  it('pendente → cancelado: não tenta reverter nada (nunca foi faturado)', async () => {
    const db = makeFakeAdminDb({ orders: [{ id: 'o1', data: baseOrder({ status: 'pendente' }) }] });
    const result = await transitionOrderAdmin({
      db, orderId: 'o1', businessId, targetStatus: 'cancelado', actor: { id: 'u1', name: 'U1' },
    });
    expect(result.order.status).toBe('cancelado');
    expect(result.stockApplied).toBe(false);
  });

  it('lança TENANT_MISMATCH quando o pedido é de outro negócio', async () => {
    const db = makeFakeAdminDb({ orders: [{ id: 'o1', data: baseOrder({ businessId: 'other-biz' }) }] });
    await expect(transitionOrderAdmin({
      db, orderId: 'o1', businessId, targetStatus: 'confirmado', actor: { id: 'u1', name: 'U1' },
    })).rejects.toBeInstanceOf(OrderTransitionError);
  });
});
