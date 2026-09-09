import { describe, it, expect, vi, beforeEach } from 'vitest';

// M02.10 — lib/services/mercadopago/webhook-settle.ts (561 linhas) não tinha
// NENHUM teste antes desta fatia (achado da investigação M02.10: maior gap
// dos 10 itens do checklist). Cobre a árvore de decisão inteira: aprovação
// fresca/reentrega/refund-parcial-em-approved, reversão (refund/chargeback/
// cancelled) fresca/reentrega/refund-parcial/impossível/já-terminal-por-outro-
// caminho, authorized, rejected, status intermediário, e os dois guards de
// borda (external_reference divergente, live_mode divergente).
//
// Fake Admin SDK — mesmo formato de tests/services/deliveryOrderTransitionAdmin.test.ts
// (query .where() encadeável + doc().get()/.update()/tx.set()/tx.update() +
// runTransaction serializada por fila).

type FakeQuery = {
  _coll: string;
  _filters: Array<{ field: string; op: string; expected: unknown }>;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
  orderBy: () => FakeQuery;
  limit: () => FakeQuery;
  get: () => Promise<FakeQuerySnapshot>;
};
type FakeSnapshot = { id: string; exists: boolean; data: () => Record<string, unknown> | undefined };
type FakeQuerySnapshot = { docs: FakeSnapshot[]; empty: boolean; size: number };
type FakeRef = {
  id: string;
  _coll: string;
  get: () => Promise<FakeSnapshot>;
  update: (data: Record<string, unknown>) => Promise<void>;
};
type FakeCollection = {
  doc: (id?: string) => FakeRef;
  where: (field: string, operator: string, expected: unknown) => FakeQuery;
  add: (data: Record<string, unknown>) => Promise<FakeRef>;
};
type PendingWrite =
  | { kind: 'create' | 'set'; ref: FakeRef; data: Record<string, unknown> }
  | { kind: 'update'; ref: FakeRef; data: Record<string, unknown> };

function clone<T>(value: T): T { return structuredClone(value); }

let autoIdCounter = 0;

function makeFakeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]));
  let transactionTail: Promise<void> = Promise.resolve();

  const snapshot = (ref: FakeRef): FakeSnapshot => {
    const data = documents.get(`${ref._coll}/${ref.id}`);
    return { id: ref.id, exists: Boolean(data), data: () => (data ? clone(data) : undefined) };
  };
  const matchesFilter = (data: Record<string, unknown>, filter: FakeQuery['_filters'][number]): boolean =>
    data[filter.field] === filter.expected;
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
    where(field, operator, expected) { return makeQuery(coll, [...filters, { field, op: operator, expected }]); },
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
        async update(data) {
          const path = `${coll}/${docId}`;
          const current = documents.get(path);
          if (!current) throw new Error(`Documento ausente: ${path}`);
          documents.set(path, { ...current, ...data });
        },
      };
      return ref;
    },
    where(field, operator, expected) { return makeQuery(coll, []).where(field, operator, expected); },
    async add(data) {
      const ref = this.doc();
      documents.set(`${ref._coll}/${ref.id}`, clone(data));
      return ref;
    },
  });

  const db = {
    collection(coll: string) { return makeCollection(coll); },
    async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const writes: PendingWrite[] = [];
      const tx = {
        async get(ref: FakeRef) { return snapshot(ref); },
        set(ref: FakeRef, data: Record<string, unknown>) { writes.push({ kind: 'set', ref, data: clone(data) }); },
        update(ref: FakeRef, data: Record<string, unknown>) { writes.push({ kind: 'update', ref, data: clone(data) }); },
      };
      try {
        const result = await handler(tx);
        for (const write of writes) {
          const path = `${write.ref._coll}/${write.ref.id}`;
          if (write.kind === 'update') {
            const current = documents.get(path);
            if (!current) throw new Error(`Documento ausente: ${path}`);
            documents.set(path, { ...current, ...clone(write.data) });
          } else {
            documents.set(path, { ...(documents.get(path) ?? {}), ...clone(write.data) });
          }
        }
        return result;
      } finally {
        release();
      }
    },
  };

  return {
    db,
    get(path: string) { const data = documents.get(path); return data ? clone(data) : undefined; },
    list(collection: string) {
      const prefix = `${collection}/`;
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({ id: path.slice(prefix.length), data: clone(data) }));
    },
  };
}

const fakeDbHolder: { current: ReturnType<typeof makeFakeDb> } = { current: makeFakeDb() };
vi.mock('@/lib/config/firebaseAdmin', () => ({
  get adminDb() { return fakeDbHolder.current.db; },
}));

const mpFetchMock = vi.fn();
vi.mock('@/lib/services/mercadopago/client', () => ({
  mpFetch: (...args: unknown[]) => mpFetchMock(...args),
}));

const getMpAccessTokenMock = vi.fn();
vi.mock('@/lib/services/mercadopago/auth', () => ({
  getMpAccessToken: (...args: unknown[]) => getMpAccessTokenMock(...args),
}));

// Efeitos cross-módulo mockados por inteiro (mesma decisão de
// deliveryOrderTransitionAdmin.test.ts): o objetivo aqui é provar que
// webhook-settle DECIDE certo (FSM, mismatch, idempotência) e DELEGA os
// efeitos corretos, não reverificar a mecânica interna deles.
const restoreOrderStockRecoverableMock = vi.fn();
vi.mock('@/lib/services/order-stock-restore', () => ({
  restoreOrderStockRecoverable: (...args: unknown[]) => restoreOrderStockRecoverableMock(...args),
}));

const reverseDeliveryOrderRevenueMock = vi.fn();
vi.mock('@/lib/services/transaction-reversal', () => ({
  reverseDeliveryOrderRevenue: (...args: unknown[]) => reverseDeliveryOrderRevenueMock(...args),
}));

const dispatchDomainEventMock = vi.fn();
vi.mock('@/contracts/_runtime/dispatch', () => ({
  dispatchDomainEvent: (...args: unknown[]) => dispatchDomainEventMock(...args),
}));

import { settlePaymentNotification } from '@/lib/services/mercadopago/webhook-settle';
import { buildExternalReference } from '@/contracts/domain/payment';

const businessId = 'biz-mp-1';
const orderId = 'order-mp-1';
const dataId = 'pay-1';

function seed(initial: Record<string, Record<string, unknown>>): void {
  fakeDbHolder.current = makeFakeDb(initial);
}

function baseOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: orderId,
    businessId,
    number: 42,
    total: 100,
    paymentFsmStatus: 'pending',
    externalPaymentId: dataId,
    ...overrides,
  };
}

function baseBusiness(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { mpLiveMode: true, ...overrides };
}

function mpPayment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: dataId,
    status: 'approved',
    external_reference: buildExternalReference(businessId, orderId),
    transaction_amount: 100,
    transaction_details: { total_paid_amount: 100, net_received_amount: 97 },
    payment_method_id: 'pix',
    live_mode: true,
    ...overrides,
  };
}

beforeEach(() => {
  mpFetchMock.mockReset();
  getMpAccessTokenMock.mockReset().mockResolvedValue('fake-mp-token');
  restoreOrderStockRecoverableMock.mockReset().mockResolvedValue(true);
  reverseDeliveryOrderRevenueMock.mockReset().mockResolvedValue(undefined);
  dispatchDomainEventMock.mockReset().mockResolvedValue(undefined);
  fakeDbHolder.current = makeFakeDb();
});

describe('mercadopago/webhook-settle — settlePaymentNotification', () => {
  it('ignora notificação que não é de payment', async () => {
    const result = await settlePaymentNotification({ type: 'merchant_order', dataId: 'x' });
    expect(result).toEqual({ ignored: true });
    expect(mpFetchMock).not.toHaveBeenCalled();
  });

  it('marca unmatched quando não encontra pedido pelo externalPaymentId', async () => {
    const result = await settlePaymentNotification({ type: 'payment', dataId: 'pay-ghost' });
    expect(result).toEqual({ unmatched: true, externalPaymentId: 'pay-ghost' });
    expect(fakeDbHolder.current.list('unmatchedPayments')).toHaveLength(1);
    expect(mpFetchMock).not.toHaveBeenCalled();
  });

  it('marca unmatched quando external_reference diverge do pedido resolvido', async () => {
    seed({ [`deliveryOrders/${orderId}`]: baseOrder() });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ external_reference: buildExternalReference('outro-biz', 'outro-pedido') }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toEqual({ unmatched: true, businessId, orderId, externalPaymentId: dataId });
  });

  it('ignora quando live_mode do pagamento diverge do tenant', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder(),
      [`businesses/${businessId}`]: baseBusiness({ mpLiveMode: true }),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ live_mode: false }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toEqual({ liveModeMismatch: true, businessId, orderId, externalPaymentId: dataId });
  });

  it('aprova pagamento pix, grava taxa MP como despesa e dispara payment.approved', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'pending', total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment());
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result.paymentFsmStatus).toBe('paid');
    const order = fakeDbHolder.current.get(`deliveryOrders/${orderId}`)!;
    expect(order.paymentFsmStatus).toBe('paid');
    expect(order.paymentMethodKind).toBe('pix');
    expect(order.mpFee).toBeCloseTo(3);
    expect(order.feeTransactionId).toBe(`${orderId}_mpfee`);
    const feeTx = fakeDbHolder.current.get(`transactions/${orderId}_mpfee`)!;
    expect(feeTx.type).toBe('despesa');
    expect(feeTx.amount).toBeCloseTo(3);
    expect(dispatchDomainEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'payment.approved', orderId, businessId }),
    );
  });

  it('reentrega de aprovação em pedido já pago é no-op, sem duplicar taxa nem evento', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'paid', paymentAmount: 100, total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment());
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ noop: true, paymentFsmStatus: 'paid' });
    expect(dispatchDomainEventMock).not.toHaveBeenCalled();
    expect(fakeDbHolder.current.list('transactions')).toHaveLength(0);
  });

  it('detecta refund parcial em pedido pago e sinaliza revisão manual sem reverter tudo', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'paid', paymentAmount: 100, total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ transaction_amount_refunded: 40 }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ mismatch: true, needsManualReview: true, paymentFsmStatus: 'paid' });
    const order = fakeDbHolder.current.get(`deliveryOrders/${orderId}`)!;
    expect(order.needsManualReview).toBe(true);
    expect(order.paymentFsmStatus).toBe('paid');
    expect(fakeDbHolder.current.list('settleMismatch')).toHaveLength(1);
    expect(restoreOrderStockRecoverableMock).not.toHaveBeenCalled();
  });

  it('recusa aprovação com valor pago divergente do total esperado', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'pending', total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({
      transaction_amount: 55,
      transaction_details: { total_paid_amount: 55, net_received_amount: 53 },
    }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ mismatch: true, needsManualReview: true });
    const order = fakeDbHolder.current.get(`deliveryOrders/${orderId}`)!;
    expect(order.paymentFsmStatus).toBe('pending');
  });

  it('aprovação tardia após estorno já concluído é no-op silencioso (stale)', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'refunded', total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment());
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ noop: true, paymentFsmStatus: 'refunded' });
    expect(fakeDbHolder.current.list('settleMismatch')).toHaveLength(0);
  });

  it('aprovação em pedido já failed sinaliza revisão manual (dinheiro pode ter sido recebido)', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'failed', total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment());
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ mismatch: true, needsManualReview: true });
    expect(fakeDbHolder.current.list('settleMismatch')).toHaveLength(1);
  });

  it('refund cheio a partir de paid restaura estoque, estorna receita e dispara payment.refunded', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'paid', paymentAmount: 100, total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ status: 'refunded', transaction_amount_refunded: 100 }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ paymentFsmStatus: 'refunded' });
    const order = fakeDbHolder.current.get(`deliveryOrders/${orderId}`)!;
    expect(order.paymentStatus).toBe('estornado');
    expect(order.refundedAt).toBeDefined();
    expect(restoreOrderStockRecoverableMock).toHaveBeenCalledWith(orderId, businessId, expect.anything());
    expect(reverseDeliveryOrderRevenueMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orderId, businessId }));
    expect(dispatchDomainEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'payment.refunded', orderId, businessId }),
    );
  });

  it('reentrega de refund já concluído reaplica efeitos recuperáveis mas não duplica o evento', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'refunded', paymentAmount: 100, total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ status: 'refunded', transaction_amount_refunded: 100 }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ noop: true, paymentFsmStatus: 'refunded' });
    // Guards CAS (stockRestoredAt/transactionReversedAt) vivem DENTRO dessas
    // funções mockadas — webhook-settle reaplica por estado-desejado de
    // propósito (recupera webhook perdido), então elas SÃO chamadas de novo.
    expect(restoreOrderStockRecoverableMock).toHaveBeenCalled();
    expect(reverseDeliveryOrderRevenueMock).toHaveBeenCalled();
    expect(dispatchDomainEventMock).not.toHaveBeenCalled();
  });

  it('refund parcial na reversão não transiciona nem reverte estoque/receita — só sinaliza revisão manual', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'paid', paymentAmount: 100, total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ status: 'refunded', transaction_amount_refunded: 30 }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ mismatch: true, needsManualReview: true });
    const order = fakeDbHolder.current.get(`deliveryOrders/${orderId}`)!;
    expect(order.paymentFsmStatus).toBe('paid');
    expect(restoreOrderStockRecoverableMock).not.toHaveBeenCalled();
    expect(reverseDeliveryOrderRevenueMock).not.toHaveBeenCalled();
  });

  it('cancelled antes de pagar vira failed — restaura estoque sem reverter receita (não havia)', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'pending', total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ status: 'cancelled' }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ paymentFsmStatus: 'failed' });
    expect(restoreOrderStockRecoverableMock).toHaveBeenCalled();
    expect(reverseDeliveryOrderRevenueMock).not.toHaveBeenCalled();
  });

  it('estorno de pagamento nunca marcado como pago localmente é divergência real', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'pending', total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ status: 'refunded', transaction_amount_refunded: 100 }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ mismatch: true, needsManualReview: true });
    expect(restoreOrderStockRecoverableMock).not.toHaveBeenCalled();
  });

  it('reversão tardia sobre pedido já expirado por outro caminho é no-op silencioso', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'expired', total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ status: 'refunded', transaction_amount_refunded: 100 }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ noop: true, paymentFsmStatus: 'expired' });
    expect(fakeDbHolder.current.list('settleMismatch')).toHaveLength(0);
  });

  it('autoriza cartão pré-autorizado a partir de pending', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'pending', total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ status: 'authorized' }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ paymentFsmStatus: 'authorized' });
    const order = fakeDbHolder.current.get(`deliveryOrders/${orderId}`)!;
    expect(order.paymentFsmStatus).toBe('authorized');
  });

  it('cartão recusado fica pending com motivo registrado, sem terminalizar', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'pending', total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ status: 'rejected', status_detail: 'cc_rejected_insufficient_amount' }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ noop: true, declineReason: 'cc_rejected_insufficient_amount' });
    const order = fakeDbHolder.current.get(`deliveryOrders/${orderId}`)!;
    expect(order.paymentFsmStatus).toBe('pending');
    expect(order.lastPaymentDeclineReason).toBe('cc_rejected_insufficient_amount');
  });

  it('status intermediário (in_process) ainda não decide dinheiro', async () => {
    seed({
      [`deliveryOrders/${orderId}`]: baseOrder({ paymentFsmStatus: 'pending', total: 100 }),
      [`businesses/${businessId}`]: baseBusiness(),
    });
    mpFetchMock.mockResolvedValueOnce(mpPayment({ status: 'in_process' }));
    const result = await settlePaymentNotification({ type: 'payment', dataId });
    expect(result).toMatchObject({ noop: true });
    const order = fakeDbHolder.current.get(`deliveryOrders/${orderId}`)!;
    expect(order.paymentFsmStatus).toBe('pending');
  });
});
