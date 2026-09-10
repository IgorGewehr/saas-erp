import { describe, it, expect, vi, beforeEach } from 'vitest';

// M02 (10/09/2026) — devolução parcial de venda, greenfield. Mocka por
// inteiro applyStockOperationAdmin/loadProductIndex/createTransactionSafeAdmin
// (mesma decisão de deliveryOrderTransitionAdmin.test.ts/
// m02CommercialBenefits.test.ts): esses núcleos JÁ são exaustivamente
// testados em stockCoreAdmin.test.ts (22 casos) e no núcleo M03.2 — o
// objetivo aqui é provar que sale-return-admin.ts DECIDE certo (CAS de
// quantidade, gate fiscal, idempotência) e DELEGA certo (args corretos pros
// dois núcleos), não reverificar a mecânica interna deles.

const loadProductIndexMock = vi.fn();
vi.mock('@/lib/services/stock-admin', () => ({
  loadProductIndex: (...args: unknown[]) => loadProductIndexMock(...args),
}));

const applyStockOperationAdminMock = vi.fn();
vi.mock('@/lib/services/stock-core-admin', () => ({
  applyStockOperationAdmin: (...args: unknown[]) => applyStockOperationAdminMock(...args),
}));

const createTransactionSafeAdminMock = vi.fn();
vi.mock('@/lib/services/transactionTxGuardAdmin', () => ({
  createTransactionSafeAdmin: (...args: unknown[]) => createTransactionSafeAdminMock(...args),
}));

import { returnSaleItemsAdmin, SaleReturnError } from '@/lib/services/sale-return-admin';

// Fake Admin SDK — mesmo formato de tests/services/orderTransitionCancelInvoice.test.ts
// (tx.create() pro CAS de idempotência do doc saleReturns).

type FakeDoc = { id: string; data: Record<string, unknown> };

function makeFakeAdminDb(initial: Record<string, FakeDoc[]> = {}) {
  const collections: Record<string, FakeDoc[]> = {};
  for (const k of Object.keys(initial)) collections[k] = initial[k].map((d) => ({ ...d, data: { ...d.data } }));

  function makeQuery(name: string, filters: Array<[string, string, unknown]>) {
    return {
      where(field: string, op: string, val: unknown) {
        return makeQuery(name, [...filters, [field, op, val]]);
      },
      async get() {
        const docs = (collections[name] ?? []).filter((d) => filters.every(([f, , v]) => d.data[f] === v));
        return { size: docs.length, empty: docs.length === 0, docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
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
        create(ref: { set: (d: Record<string, unknown>) => void }, data: Record<string, unknown>) { ref.set(data); },
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
    clientName: 'Cliente X',
    status: 'finalizada',
    items: [
      { id: 'item1', serviceId: 'srv1', description: 'Consultoria', quantity: 3, unitPrice: 50, discount: 0, total: 150 },
    ],
    total: 150,
    operatorId: 'u1',
    operatorName: 'Operador',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  loadProductIndexMock.mockReset().mockResolvedValue(new Map());
  applyStockOperationAdminMock.mockReset().mockResolvedValue({ adjustments: [] });
  createTransactionSafeAdminMock.mockReset().mockResolvedValue({ id: 'tx-refund-1', created: true });
});

const actor = { id: 'u1', name: 'Operador' };

describe('returnSaleItemsAdmin', () => {
  it('lança SALE_NOT_FOUND quando a venda não existe', async () => {
    const db = makeFakeAdminDb();
    await expect(returnSaleItemsAdmin({
      db, saleId: 'missing', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor,
    })).rejects.toMatchObject({ code: 'SALE_NOT_FOUND' });
  });

  it('lança TENANT_MISMATCH quando a venda é de outro negócio', async () => {
    const db = makeFakeAdminDb({ sales: [{ id: 's1', data: baseSale({ businessId: 'other-biz' }) }] });
    await expect(returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor,
    })).rejects.toMatchObject({ code: 'TENANT_MISMATCH' });
  });

  it('lança INVALID_SALE_STATUS quando a venda não está finalizada', async () => {
    const db = makeFakeAdminDb({ sales: [{ id: 's1', data: baseSale({ status: 'aberta' }) }] });
    await expect(returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor,
    })).rejects.toMatchObject({ code: 'INVALID_SALE_STATUS' });
  });

  it('bloqueia devolução quando a nota fiscal já está autorizada (mesmo gate do cancelamento total)', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale({ fiscalDocumentId: 'fd1' }) }],
      fiscalDocuments: [{ id: 'fd1', data: { businessId, status: 'autorizada' } }],
    });
    await expect(returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor,
    })).rejects.toMatchObject({ code: 'FISCAL_DOCUMENT_ISSUED' });
    expect(applyStockOperationAdminMock).not.toHaveBeenCalled();
    expect(createTransactionSafeAdminMock).not.toHaveBeenCalled();
  });

  it('permite devolução quando a nota fiscal NÃO está autorizada', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale({ fiscalDocumentId: 'fd1' }) }],
      fiscalDocuments: [{ id: 'fd1', data: { businessId, status: 'rejeitada' } }],
      clients: [{ id: 'client1', data: { businessId, totalSpent: 500 } }],
    });
    const result = await returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor,
    });
    expect(result.replayed).toBe(false);
  });

  it('lança ITEM_NOT_FOUND pra itemId inexistente', async () => {
    const db = makeFakeAdminDb({ sales: [{ id: 's1', data: baseSale() }] });
    await expect(returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'ghost', quantity: 1 }], actor,
    })).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
  });

  it('lança EMPTY_RETURN sem nenhuma linha', async () => {
    const db = makeFakeAdminDb({ sales: [{ id: 's1', data: baseSale() }] });
    await expect(returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [], actor,
    })).rejects.toMatchObject({ code: 'EMPTY_RETURN' });
  });

  it('devolução parcial: incrementa returnedQuantity, cria ledger, ajusta totalSpent e não altera sale.status', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale() }],
      clients: [{ id: 'client1', data: { businessId, totalSpent: 500 } }],
    });
    const result = await returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor, reason: 'Cliente não gostou',
    });

    expect(result.replayed).toBe(false);
    expect(result.saleReturn.totalAmount).toBe(50);
    expect(result.saleReturn.lines).toEqual([{ itemId: 'item1', quantity: 1, unitPrice: 50 }]);
    expect(result.refundTransactionId).toBe('tx-refund-1');

    const sale = db.collections.sales.find((s) => s.id === 's1')!;
    expect((sale.data.items as Array<Record<string, unknown>>)[0].returnedQuantity).toBe(1);
    expect(sale.data.status).toBe('finalizada'); // NUNCA muda — diferente do cancelamento total

    const client = db.collections.clients.find((c) => c.id === 'client1')!;
    expect(client.data.totalSpent).toBe(450);

    expect(createTransactionSafeAdminMock).toHaveBeenCalledWith(db, expect.objectContaining({
      type: 'despesa', category: 'Estornos', amount: 50, saleId: 's1',
      idempotencyKey: expect.stringContaining(':refund'),
    }));
  });

  it('CAS: rejeita devolver mais do que resta (QUANTITY_EXCEEDS_REMAINING)', async () => {
    const db = makeFakeAdminDb({ sales: [{ id: 's1', data: baseSale() }] });
    await expect(returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 4 }], actor,
    })).rejects.toMatchObject({ code: 'QUANTITY_EXCEEDS_REMAINING' });
    // Nenhum efeito parcial aplicado — a rejeição acontece DENTRO da tx, antes de qualquer write.
    const sale = db.collections.sales.find((s) => s.id === 's1')!;
    expect((sale.data.items as Array<Record<string, unknown>>)[0].returnedQuantity).toBeUndefined();
  });

  it('CAS: duas devoluções parciais sequenciais são cumulativas; a terceira que excede o restante falha', async () => {
    const db = makeFakeAdminDb({ sales: [{ id: 's1', data: baseSale() }] }); // quantity=3

    const first = await returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor, idempotencyKey: 'ret-1',
    });
    expect(first.replayed).toBe(false);
    let sale = db.collections.sales.find((s) => s.id === 's1')!;
    expect((sale.data.items as Array<Record<string, unknown>>)[0].returnedQuantity).toBe(1);

    const second = await returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 2 }], actor, idempotencyKey: 'ret-2',
    });
    expect(second.replayed).toBe(false);
    sale = db.collections.sales.find((s) => s.id === 's1')!;
    expect((sale.data.items as Array<Record<string, unknown>>)[0].returnedQuantity).toBe(3);

    // Restam 0 — qualquer devolução adicional deve falhar.
    await expect(returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor, idempotencyKey: 'ret-3',
    })).rejects.toMatchObject({ code: 'QUANTITY_EXCEEDS_REMAINING' });
  });

  it('idempotência: reexecutar com a MESMA idempotencyKey não duplica efeitos', async () => {
    const db = makeFakeAdminDb({
      sales: [{ id: 's1', data: baseSale() }],
      clients: [{ id: 'client1', data: { businessId, totalSpent: 500 } }],
    });
    const first = await returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor, idempotencyKey: 'ret-fixed',
    });
    const second = await returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor, idempotencyKey: 'ret-fixed',
    });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.saleReturn.id).toBe(first.saleReturn.id);

    const sale = db.collections.sales.find((s) => s.id === 's1')!;
    expect((sale.data.items as Array<Record<string, unknown>>)[0].returnedQuantity).toBe(1); // não 2

    const client = db.collections.clients.find((c) => c.id === 'client1')!;
    expect(client.data.totalSpent).toBe(450); // decrementado só uma vez

    expect(createTransactionSafeAdminMock).toHaveBeenCalledTimes(1);
    expect(applyStockOperationAdminMock).not.toHaveBeenCalled(); // item é serviceId, sem estoque
  });

  it('múltiplas linhas na mesma devolução somam o totalAmount corretamente', async () => {
    const db = makeFakeAdminDb({
      sales: [{
        id: 's1',
        data: baseSale({
          items: [
            { id: 'item1', productId: 'p1', description: 'Produto A', quantity: 2, unitPrice: 20, discount: 0, total: 40 },
            { id: 'item2', productId: 'p2', description: 'Produto B', quantity: 1, unitPrice: 30, discount: 0, total: 30 },
          ],
          total: 70,
        }),
      }],
    });
    const result = await returnSaleItemsAdmin({
      db, saleId: 's1', businessId,
      lines: [{ itemId: 'item1', quantity: 1 }, { itemId: 'item2', quantity: 1 }],
      actor,
    });
    expect(result.saleReturn.totalAmount).toBe(50); // 1*20 + 1*30
    expect(applyStockOperationAdminMock).toHaveBeenCalledTimes(1);
    const call = applyStockOperationAdminMock.mock.calls[0][1] as { sourceId: string; idempotencyKey: string; lines: unknown[] };
    expect(call.sourceId).toBe('s1');
    expect(call.idempotencyKey).toContain(':stock');
    expect(call.lines).toHaveLength(2);
  });

  it('item sem productId (serviço) não aciona restauração de estoque', async () => {
    const db = makeFakeAdminDb({ sales: [{ id: 's1', data: baseSale() }] }); // item1 é serviceId
    await returnSaleItemsAdmin({
      db, saleId: 's1', businessId, lines: [{ itemId: 'item1', quantity: 1 }], actor,
    });
    expect(applyStockOperationAdminMock).not.toHaveBeenCalled();
  });
});
