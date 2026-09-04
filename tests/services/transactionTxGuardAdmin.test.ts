import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTransactionSafeAdmin,
  transitionTransactionSafeAdmin,
  TransactionNotFoundError,
  TransactionTenantMismatchError,
  TransactionInvalidTransitionError,
} from '@/lib/services/transactionTxGuardAdmin';

// Fake Admin SDK — mesmo formato de tests/services/appointmentTxGuardAdmin.test.ts,
// com tx.create() adicionado (lança se o doc já existir — mesma semântica real
// do Firestore, usada como defesa em profundidade pelo guard).

type FakeDoc = { id: string; data: Record<string, unknown> };

function makeFakeAdminDb(initial: Record<string, FakeDoc[]> = {}) {
  const collections: Record<string, FakeDoc[]> = {};
  for (const k of Object.keys(initial)) collections[k] = initial[k].map((d) => ({ ...d, data: { ...d.data } }));

  const fake = {
    collection(name: string) {
      return {
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
          };
        },
      };
    },
    async runTransaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        async get(ref: { id: string; get: () => Promise<unknown> }) { return ref.get(); },
        set(ref: { id: string }, data: Record<string, unknown>) {
          const list = (collections['transactions'] ??= []);
          const idx = list.findIndex((d) => d.id === ref.id);
          if (idx >= 0) list[idx].data = data;
          else list.push({ id: ref.id, data });
        },
        create(ref: { id: string }, data: Record<string, unknown>) {
          const list = (collections['transactions'] ??= []);
          if (list.some((d) => d.id === ref.id)) throw new Error(`ALREADY_EXISTS: transactions/${ref.id}`);
          list.push({ id: ref.id, data });
        },
        update(ref: { id: string }, patch: Record<string, unknown>) {
          const list = (collections['transactions'] ??= []);
          const found = list.find((d) => d.id === ref.id);
          if (!found) throw new Error(`update on non-existing doc transactions/${ref.id}`);
          found.data = { ...found.data, ...patch };
        },
      };
      return cb(tx);
    },
    collections,
  };
  return fake;
}

const businessId = 'biz-1';

describe('createTransactionSafeAdmin', () => {
  let db: ReturnType<typeof makeFakeAdminDb>;

  beforeEach(() => {
    db = makeFakeAdminDb({ transactions: [] });
  });

  it('cria sem nenhuma referência de origem nem idempotencyKey — sem dedup possível, cria direto', async () => {
    const result = await createTransactionSafeAdmin(db as never, {
      businessId, type: 'despesa', status: 'pendente', amount: 50, description: 'Aluguel',
    });
    expect(result.created).toBe(true);
    expect(db.collections.transactions).toHaveLength(1);
  });

  it('rejeita businessId vazio (R1)', async () => {
    await expect(
      createTransactionSafeAdmin(db as never, {
        businessId: '', type: 'despesa', status: 'pendente', amount: 50, description: 'X',
      }),
    ).rejects.toThrow(/businessId obrigatório/);
  });

  it('mesma origem (saleId) + tipo, chamado 2x — segunda chamada é replay idempotente, não duplica', async () => {
    const payload = {
      businessId, type: 'receita' as const, status: 'pendente' as const, amount: 100,
      description: 'Venda', saleId: 'sale-1',
    };
    const first = await createTransactionSafeAdmin(db as never, payload);
    const second = await createTransactionSafeAdmin(db as never, payload);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(db.collections.transactions).toHaveLength(1); // fecha o double-click da AGENDA_COBRANCA.md
  });

  it('mesma origem+tipo mas installmentNumber diferente NÃO colide — parcelas distintas viram docs distintos', async () => {
    const base = { businessId, type: 'receita' as const, status: 'pendente' as const, amount: 50, description: 'Parcela', saleId: 'sale-2' };
    const p1 = await createTransactionSafeAdmin(db as never, { ...base, installmentNumber: 1 });
    const p2 = await createTransactionSafeAdmin(db as never, { ...base, installmentNumber: 2 });

    expect(p1.created).toBe(true);
    expect(p2.created).toBe(true);
    expect(p1.id).not.toBe(p2.id);
    expect(db.collections.transactions).toHaveLength(2);
  });

  it('origens diferentes (appointmentId vs deliveryOrderId) nunca colidem entre si', async () => {
    const a = await createTransactionSafeAdmin(db as never, {
      businessId, type: 'receita', status: 'pendente', amount: 80, description: 'Consulta', appointmentId: 'appt-1',
    });
    const b = await createTransactionSafeAdmin(db as never, {
      businessId, type: 'receita', status: 'pendente', amount: 80, description: 'Entrega', deliveryOrderId: 'ord-1',
    });
    expect(a.id).not.toBe(b.id);
    expect(db.collections.transactions).toHaveLength(2);
  });

  it('idempotencyKey explícito tem prioridade sobre a chave derivada de saleId', async () => {
    // Mesmo saleId, mas idempotencyKey explícito DIFERENTE — não deve colapsar.
    const a = await createTransactionSafeAdmin(db as never, {
      businessId, type: 'despesa', status: 'pendente', amount: 10, description: 'Taxa 1',
      saleId: 'sale-3', idempotencyKey: 'custom-key-1',
    });
    const b = await createTransactionSafeAdmin(db as never, {
      businessId, type: 'despesa', status: 'pendente', amount: 10, description: 'Taxa 2',
      saleId: 'sale-3', idempotencyKey: 'custom-key-2',
    });
    expect(a.id).not.toBe(b.id);
    expect(db.collections.transactions).toHaveLength(2);
  });

  it('grava idempotencyKey no documento pra rastreabilidade', async () => {
    await createTransactionSafeAdmin(db as never, {
      businessId, type: 'receita', status: 'pendente', amount: 30, description: 'X', saleId: 'sale-4',
    });
    expect(db.collections.transactions[0].data.idempotencyKey).toBe('sale:sale-4:receita');
  });
});

describe('transitionTransactionSafeAdmin', () => {
  let db: ReturnType<typeof makeFakeAdminDb>;

  beforeEach(() => {
    db = makeFakeAdminDb({
      transactions: [
        { id: 'tx-1', data: { businessId, type: 'receita', status: 'pendente', amount: 100, description: 'X', createdAt: '', updatedAt: '' } },
      ],
    });
  });

  it('transição válida (pendente→pago) aplica o patch adicional', async () => {
    const result = await transitionTransactionSafeAdmin({
      db: db as never, transactionId: 'tx-1', businessId, targetStatus: 'pago',
      patch: { paymentDate: '2026-01-15' },
    });
    expect(result.status).toBe('pago');
    expect(result.paymentDate).toBe('2026-01-15');
    expect(db.collections.transactions[0].data.status).toBe('pago');
  });

  it('transição inválida (FSM) lança TransactionInvalidTransitionError — cancelado é terminal', async () => {
    db.collections.transactions[0].data.status = 'cancelado';
    await expect(
      transitionTransactionSafeAdmin({ db: db as never, transactionId: 'tx-1', businessId, targetStatus: 'pago' }),
    ).rejects.toBeInstanceOf(TransactionInvalidTransitionError);
  });

  it('transição pra o MESMO status é no-op permitido (não aciona o FSM)', async () => {
    const result = await transitionTransactionSafeAdmin({
      db: db as never, transactionId: 'tx-1', businessId, targetStatus: 'pendente',
    });
    expect(result.status).toBe('pendente');
  });

  it('targetStatus ausente: não muda status, só aplica patch (evita pré-fetch só pra saber o status atual)', async () => {
    const result = await transitionTransactionSafeAdmin({
      db: db as never, transactionId: 'tx-1', businessId, patch: { description: 'Descrição editada' },
    });
    expect(result.status).toBe('pendente'); // preservado
    expect(result.description).toBe('Descrição editada');
  });

  it('lança TransactionNotFoundError pra id inexistente', async () => {
    await expect(
      transitionTransactionSafeAdmin({ db: db as never, transactionId: 'tx-ghost', businessId, targetStatus: 'pago' }),
    ).rejects.toBeInstanceOf(TransactionNotFoundError);
  });

  it('lança TransactionTenantMismatchError pra transação de outro business', async () => {
    await expect(
      transitionTransactionSafeAdmin({ db: db as never, transactionId: 'tx-1', businessId: 'outro-biz', targetStatus: 'pago' }),
    ).rejects.toBeInstanceOf(TransactionTenantMismatchError);
  });
});
