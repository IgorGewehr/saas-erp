import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTransactionSafeAdmin,
  transitionTransactionSafeAdmin,
  settleReceivableAdmin,
  TransactionNotFoundError,
  TransactionTenantMismatchError,
  TransactionInvalidTransitionError,
  TransactionNotReceivableError,
} from '@/lib/services/transactionTxGuardAdmin';
import { SettleTransactionBodySchema } from '@/contracts/api/transactions/settle';

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

describe('settleReceivableAdmin (Vitrine — registrar recebimento)', () => {
  let db: ReturnType<typeof makeFakeAdminDb>;

  const receivable = (overrides: Record<string, unknown> = {}) => ({
    businessId, type: 'receita', status: 'pendente', amount: 500, description: 'Pedido B2B #ABC123',
    paymentMethod: 'boleto', dueDate: '2026-10-18', clientId: 'cli-1', createdAt: '', updatedAt: '', ...overrides,
  });

  beforeEach(() => {
    db = makeFakeAdminDb({ transactions: [{ id: 'tx-r1', data: receivable() }] });
  });

  it('pendente → pago grava data e forma de pagamento, sem tocar valor/cliente/vencimento', async () => {
    const { transaction, alreadySettled } = await settleReceivableAdmin({
      db: db as never, transactionId: 'tx-r1', businessId, paymentDate: '2026-09-18', paymentMethod: 'pix',
    });
    expect(alreadySettled).toBe(false);
    expect(transaction).toMatchObject({ status: 'pago', paymentDate: '2026-09-18', paymentMethod: 'pix' });

    const stored = db.collections.transactions[0].data;
    expect(stored).toMatchObject({
      status: 'pago', paymentDate: '2026-09-18', paymentMethod: 'pix',
      amount: 500, dueDate: '2026-10-18', clientId: 'cli-1', description: 'Pedido B2B #ABC123',
    });
  });

  it('sem paymentMethod mantém a forma de pagamento que já estava no lançamento', async () => {
    await settleReceivableAdmin({ db: db as never, transactionId: 'tx-r1', businessId, paymentDate: '2026-09-18' });
    expect(db.collections.transactions[0].data.paymentMethod).toBe('boleto');
  });

  it('atrasado → pago também é permitido (FSM)', async () => {
    db.collections.transactions[0].data.status = 'atrasado';
    const { transaction } = await settleReceivableAdmin({
      db: db as never, transactionId: 'tx-r1', businessId, paymentDate: '2026-09-18',
    });
    expect(transaction.status).toBe('pago');
  });

  it('já paga: no-op — NÃO sobrescreve paymentDate/paymentMethod do primeiro recebimento (duplo toque)', async () => {
    await settleReceivableAdmin({ db: db as never, transactionId: 'tx-r1', businessId, paymentDate: '2026-09-18', paymentMethod: 'pix' });
    const second = await settleReceivableAdmin({
      db: db as never, transactionId: 'tx-r1', businessId, paymentDate: '2026-09-25', paymentMethod: 'dinheiro',
    });
    expect(second.alreadySettled).toBe(true);
    expect(db.collections.transactions[0].data).toMatchObject({ paymentDate: '2026-09-18', paymentMethod: 'pix' });
  });

  it('cancelada não pode ser recebida (FSM: terminal)', async () => {
    db.collections.transactions[0].data.status = 'cancelado';
    await expect(
      settleReceivableAdmin({ db: db as never, transactionId: 'tx-r1', businessId, paymentDate: '2026-09-18' }),
    ).rejects.toBeInstanceOf(TransactionInvalidTransitionError);
    expect(db.collections.transactions[0].data.status).toBe('cancelado');
  });

  it('despesa não é "recebível" — recusa e não altera', async () => {
    db.collections.transactions[0].data.type = 'despesa';
    await expect(
      settleReceivableAdmin({ db: db as never, transactionId: 'tx-r1', businessId, paymentDate: '2026-09-18' }),
    ).rejects.toBeInstanceOf(TransactionNotReceivableError);
    expect(db.collections.transactions[0].data.status).toBe('pendente');
  });

  it('id inexistente → TransactionNotFoundError', async () => {
    await expect(
      settleReceivableAdmin({ db: db as never, transactionId: 'ghost', businessId, paymentDate: '2026-09-18' }),
    ).rejects.toBeInstanceOf(TransactionNotFoundError);
  });

  it('lançamento de outro business → TransactionTenantMismatchError e nada é gravado (R1)', async () => {
    await expect(
      settleReceivableAdmin({ db: db as never, transactionId: 'tx-r1', businessId: 'outro-biz', paymentDate: '2026-09-18' }),
    ).rejects.toBeInstanceOf(TransactionTenantMismatchError);
    expect(db.collections.transactions[0].data.status).toBe('pendente');
  });
});

describe('SettleTransactionBodySchema', () => {
  it('aceita só businessId (data/forma opcionais)', () => {
    expect(SettleTransactionBodySchema.safeParse({ businessId: 'b1' }).success).toBe(true);
  });

  it('aceita forma de pagamento de recebimento e data válida', () => {
    const parsed = SettleTransactionBodySchema.safeParse({ businessId: 'b1', paymentMethod: 'pix', paymentDate: '2026-02-28' });
    expect(parsed.success).toBe(true);
  });

  it.each(['creditoLoja', 'pontos', 'gift_card', 'semPagamento', 'cheque'])('rejeita forma de pagamento %s', (paymentMethod) => {
    expect(SettleTransactionBodySchema.safeParse({ businessId: 'b1', paymentMethod }).success).toBe(false);
  });

  it.each(['2026-02-31', '2026-13-01', '18/09/2026', '2026-9-1', ''])('rejeita data %j', (paymentDate) => {
    expect(SettleTransactionBodySchema.safeParse({ businessId: 'b1', paymentDate }).success).toBe(false);
  });

  it('exige businessId', () => {
    expect(SettleTransactionBodySchema.safeParse({ paymentMethod: 'pix' }).success).toBe(false);
  });

  it('descarta campos extras (não vira canal pra reescrever valor)', () => {
    const parsed = SettleTransactionBodySchema.parse({ businessId: 'b1', amount: 1, status: 'cancelado' });
    expect(parsed).toEqual({ businessId: 'b1' });
  });
});
