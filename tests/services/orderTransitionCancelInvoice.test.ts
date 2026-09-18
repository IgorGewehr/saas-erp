import { describe, it, expect, vi, beforeEach } from 'vitest';

// O núcleo de estoque tem suíte própria; aqui só importa QUAIS linhas o pedido manda pra ele.
vi.mock('@/lib/services/stock-core-admin', () => ({
  applyStockOperationAdmin: vi.fn(async () => ({ adjustments: [] })),
}));

import { applyStockOperationAdmin } from '@/lib/services/stock-core-admin';
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
    async getAll(...refs: Array<{ get: () => Promise<unknown> }>) {
      return Promise.all(refs.map((ref) => ref.get()));
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

  it('confirmado → faturado: recebível leva descrição curta (#últimos 6 do id, igual à tela de Vendas) + cliente + parcela', async () => {
    const orderId = 'order_0123456789abcdef0123456789abcdef01234567';
    const db = makeFakeAdminDb({
      orders: [{ id: orderId, data: baseOrder({ installments: 3, total: 300, clientId: 'c1', clientName: 'Padaria do Zé' }) }],
    });
    const result = await transitionOrderAdmin({
      db, orderId, businessId, targetStatus: 'faturado', actor: { id: 'u1', name: 'U1' },
    });
    const txs = result.transactionIds.map((id) => db.collections.transactions.find((t) => t.id === id)!.data);
    expect(txs.map((t) => t.description)).toEqual([
      'Pedido B2B #234567 — Padaria do Zé (parcela 1/3)',
      'Pedido B2B #234567 — Padaria do Zé (parcela 2/3)',
      'Pedido B2B #234567 — Padaria do Zé (parcela 3/3)',
    ]);
    expect(txs.every((t) => t.clientId === 'c1' && t.clientName === 'Padaria do Zé')).toBe(true);
    expect(txs.every((t) => (t.description as string).length < 60)).toBe(true);
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

describe('estoque do pedido B2B respeita "Não controlar estoque" (trackStock === false)', () => {
  const stockMock = vi.mocked(applyStockOperationAdmin);

  const product = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    data: { businessId, name: `Produto ${id}`, salePrice: 100, currentStock: 0, trackStock: true, ...overrides },
  });
  const item = (productId: string, quantity = 1, extra: Record<string, unknown> = {}) => ({
    productId, productName: `Produto ${productId}`, quantity, unitPrice: 100, total: 100 * quantity, ...extra,
  });
  const actor = { id: 'u1', name: 'U1' };

  beforeEach(() => stockMock.mockClear());

  it('faturar só com item sem controle de estoque (saldo 0): não baixa estoque e ainda gera a receita', async () => {
    const db = makeFakeAdminDb({
      products: [product('spot', { trackStock: false })],
      orders: [{ id: 'o1', data: baseOrder({ items: [item('spot', 2)], total: 200 }) }],
    });
    const result = await transitionOrderAdmin({ db, orderId: 'o1', businessId, targetStatus: 'faturado', actor });

    expect(stockMock).not.toHaveBeenCalled();
    expect(result.stockApplied).toBe(false);
    expect(result.invoiced).toBe(true);
    expect(result.transactionIds).toHaveLength(1);
  });

  it('faturar misto: só a linha COM controle vai pro núcleo de estoque', async () => {
    const db = makeFakeAdminDb({
      products: [product('spot', { trackStock: false }), product('camiseta', { currentStock: 10 })],
      orders: [{ id: 'o1', data: baseOrder({ items: [item('spot', 2), item('camiseta', 3)], total: 500 }) }],
    });
    const result = await transitionOrderAdmin({ db, orderId: 'o1', businessId, targetStatus: 'faturado', actor });

    expect(stockMock).toHaveBeenCalledTimes(1);
    expect(stockMock.mock.calls[0][1]).toMatchObject({ type: 'saida', lines: [{ productId: 'camiseta', quantity: 3 }] });
    expect(result.stockApplied).toBe(true);
  });

  it('trackStock ausente conta como controlado (padrão do sistema)', async () => {
    const legacy = product('legado');
    delete (legacy.data as Record<string, unknown>).trackStock;
    const db = makeFakeAdminDb({
      products: [legacy],
      orders: [{ id: 'o1', data: baseOrder({ items: [item('legado')], total: 100 }) }],
    });
    await transitionOrderAdmin({ db, orderId: 'o1', businessId, targetStatus: 'faturado', actor });
    expect(stockMock.mock.calls[0][1]).toMatchObject({ lines: [{ productId: 'legado', quantity: 1 }] });
  });

  it('linha com variação segue o trackStock DA VARIAÇÃO, não o do produto', async () => {
    const db = makeFakeAdminDb({
      products: [
        product('pacote', {
          trackStock: true,
          variants: [
            { id: 'v15', name: '15s', trackStock: false, isActive: true, salePrice: 100, costPrice: 0, currentStock: 0, minStock: 0, attributes: {} },
            { id: 'v30', name: '30s', trackStock: true, isActive: true, salePrice: 200, costPrice: 0, currentStock: 9, minStock: 0, attributes: {} },
          ],
        }),
      ],
      orders: [{ id: 'o1', data: baseOrder({ items: [item('pacote', 1, { variantId: 'v15' }), item('pacote', 2, { variantId: 'v30' })], total: 500 }) }],
    });
    await transitionOrderAdmin({ db, orderId: 'o1', businessId, targetStatus: 'faturado', actor });

    expect(stockMock.mock.calls[0][1]).toMatchObject({ lines: [{ productId: 'pacote', variantId: 'v30', quantity: 2 }] });
  });

  it('produto inexistente ou de outro negócio NÃO é filtrado — o núcleo de estoque é quem recusa', async () => {
    const db = makeFakeAdminDb({
      products: [product('alheio', { businessId: 'outro-biz', trackStock: false })],
      orders: [{ id: 'o1', data: baseOrder({ items: [item('alheio'), item('fantasma')], total: 200 }) }],
    });
    await transitionOrderAdmin({ db, orderId: 'o1', businessId, targetStatus: 'faturado', actor });

    expect(stockMock.mock.calls[0][1]).toMatchObject({
      lines: [{ productId: 'alheio', quantity: 1 }, { productId: 'fantasma', quantity: 1 }],
    });
  });

  it('cancelar pedido faturado NÃO restaura saldo de item sem controle de estoque', async () => {
    const db = makeFakeAdminDb({
      products: [product('spot', { trackStock: false }), product('camiseta', { currentStock: 7 })],
      orders: [{ id: 'o1', data: baseOrder({ status: 'faturado', items: [item('spot', 2), item('camiseta', 3)], total: 500 }) }],
    });
    await transitionOrderAdmin({ db, orderId: 'o1', businessId, targetStatus: 'cancelado', actor });

    expect(stockMock).toHaveBeenCalledTimes(1);
    expect(stockMock.mock.calls[0][1]).toMatchObject({ type: 'restauracao', lines: [{ productId: 'camiseta', quantity: 3 }] });
  });

  it('cancelar pedido faturado só de itens sem controle: não chama o núcleo de estoque', async () => {
    const db = makeFakeAdminDb({
      products: [product('spot', { trackStock: false })],
      orders: [{ id: 'o1', data: baseOrder({ status: 'faturado', items: [item('spot')], total: 100 }) }],
    });
    const result = await transitionOrderAdmin({ db, orderId: 'o1', businessId, targetStatus: 'cancelado', actor });

    expect(stockMock).not.toHaveBeenCalled();
    expect(result.stockApplied).toBe(false);
    expect(result.order.status).toBe('cancelado');
  });
});
