import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({}));

import {
  deductStockAdmin,
  InsufficientStockError,
  type StockDeductionLine,
} from '@/lib/services/stock-admin';
import type { Product } from '@/lib/types';

function product(id: string, currentStock: number, extra: Partial<Product> = {}): Product {
  return {
    id,
    businessId: 'biz1',
    name: `Produto ${id}`,
    category: 'cat',
    unit: 'un',
    costPrice: 0,
    salePrice: 10,
    currentStock,
    minStock: 0,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as Product;
}

/** Fake admin Firestore: só o necessário pra deductStockAdmin (runTransaction + tx.get/update/set). */
function makeFakeDb(stock: Record<string, number>) {
  const writes: Array<{ coll: string; id: string; data: Record<string, unknown> }> = [];
  const documents = new Map<string, Record<string, unknown>>();
  const db = {
    collection(coll: string) {
      return { doc(id: string) { return { id, _coll: coll }; } };
    },
    async runTransaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        async get(ref: { id: string; _coll: string }) {
          if (ref._coll === 'products' && ref.id in stock) {
            return {
              id: ref.id,
              exists: true,
              data: () => ({
                businessId: 'biz1',
                name: `Produto ${ref.id}`,
                currentStock: stock[ref.id],
                minStock: 0,
              }),
            };
          }
          const stored = documents.get(`${ref._coll}/${ref.id}`);
          return { id: ref.id, exists: !!stored, data: () => stored };
        },
        update(ref: { id: string; _coll: string }, patch: Record<string, unknown>) {
          if (ref._coll === 'products' && typeof patch.currentStock === 'number') {
            stock[ref.id] = patch.currentStock;
          }
        },
        set(ref: { id: string; _coll: string }, data: Record<string, unknown>) {
          writes.push({ coll: ref._coll, id: ref.id, data });
          documents.set(`${ref._coll}/${ref.id}`, data);
        },
      };
      return cb(tx);
    },
  };
  return { db: db as unknown as Parameters<typeof deductStockAdmin>[0], writes };
}

const lines = (l: StockDeductionLine[]) => l;

describe('deductStockAdmin — guard de oversell (failOnInsufficientFor)', () => {
  it('lança InsufficientStockError quando um produto GUARDADO ficaria negativo', async () => {
    const { db, writes } = makeFakeDb({ p1: 2 });
    const index = new Map([['p1', product('p1', 2)]]);

    await expect(
      deductStockAdmin(db, lines([{ productId: 'p1', quantity: 3 }]), {
        businessId: 'biz1',
        operatorId: 'public',
        operatorName: 'Cardápio online',
        reason: 'Pedido #1',
        productIndex: index,
        failOnInsufficientFor: new Set(['p1']),
      }),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    // Nenhuma escrita (movimento de estoque) deve ter ocorrido — abortou na leitura.
    expect(writes).toHaveLength(0);
  });

  it('deduz normalmente quando o produto guardado TEM estoque suficiente', async () => {
    const { db, writes } = makeFakeDb({ p1: 5 });
    const index = new Map([['p1', product('p1', 5)]]);

    const adj = await deductStockAdmin(db, lines([{ productId: 'p1', quantity: 3 }]), {
      businessId: 'biz1',
      operatorId: 'public',
      operatorName: 'Cardápio online',
      reason: 'Pedido #2',
      productIndex: index,
      failOnInsufficientFor: new Set(['p1']),
    });

    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ productId: 'p1', previousStock: 5, newStock: 2 });
    expect(writes.filter((write) => write.coll === 'stockMovements')).toHaveLength(1);
  });

  it('serializa corrida: a 2ª dedução da última unidade aborta lendo o saldo já debitado', async () => {
    // Estoque inicial = 1. A 1ª "venda" leva a última unidade (commit zera o
    // estoque mutável); a 2ª, executada DEPOIS, relê o saldo já debitado (0)
    // dentro da tx e aborta — sem oversell. Modela execução SERIALIZADA (não o
    // retry/contenção real do Firestore): prova a propriedade que importa — o
    // guard decide sobre o saldo depletado lido na tx, não sobre o productIndex
    // (que passa currentStock=1, usado só p/ BOM/nome).
    const { db } = makeFakeDb({ p1: 1 });
    const index = new Map([['p1', product('p1', 1)]]);
    const ctx = {
      businessId: 'biz1',
      operatorId: 'public',
      operatorName: 'Cardápio online',
      productIndex: index,
      failOnInsufficientFor: new Set(['p1']),
    };

    const first = await deductStockAdmin(db, lines([{ productId: 'p1', quantity: 1 }]), { ...ctx, reason: 'Pedido #A' });
    expect(first[0]).toMatchObject({ previousStock: 1, newStock: 0 });

    await expect(
      deductStockAdmin(db, lines([{ productId: 'p1', quantity: 1 }]), { ...ctx, reason: 'Pedido #B' }),
    ).rejects.toBeInstanceOf(InsufficientStockError);
  });

  it('NÃO bloqueia produto fora do conjunto guardado (combos/insumos seguem legado, podem ir negativo)', async () => {
    const { db } = makeFakeDb({ insumo: 0 });
    const index = new Map([['insumo', product('insumo', 0)]]);

    const adj = await deductStockAdmin(db, lines([{ productId: 'insumo', quantity: 4 }]), {
      businessId: 'biz1',
      operatorId: 'public',
      operatorName: 'Cardápio online',
      reason: 'Pedido #3',
      productIndex: index,
      failOnInsufficientFor: new Set(['outro']), // 'insumo' não está guardado
    });

    expect(adj[0]).toMatchObject({ productId: 'insumo', previousStock: 0, newStock: -4 });
  });

  it('sem failOnInsufficientFor mantém comportamento legado (debita indo negativo)', async () => {
    const { db } = makeFakeDb({ p1: 1 });
    const index = new Map([['p1', product('p1', 1)]]);

    const adj = await deductStockAdmin(db, lines([{ productId: 'p1', quantity: 5 }]), {
      businessId: 'biz1',
      operatorId: 'public',
      operatorName: 'Cardápio online',
      reason: 'Pedido #4',
      productIndex: index,
    });

    expect(adj[0]).toMatchObject({ newStock: -4 });
  });
});
