import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake Admin SDK mínimo pro que subscriptionAdmin.ts realmente usa: doc().get()/
// set()/update(), collection().get() (lista sem filtro), collection().where().limit().get()
// (findBusinessIdByPreapprovalId) e runTransaction com tx.get()/tx.update(). Mesmo
// espírito do harness de tests/services/mercadopagoWebhookSettle.test.ts, mas mais
// enxuto — este serviço não usa tx.set().

type FakeSnapshot = { id: string; exists: boolean; data: () => Record<string, unknown> | undefined };
type FakeRef = {
  id: string;
  get: () => Promise<FakeSnapshot>;
  set: (data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<void>;
  update: (data: Record<string, unknown>) => Promise<void>;
};

function clone<T>(value: T): T { return structuredClone(value); }

function makeFakeDb(initial: Record<string, Record<string, unknown>> = {}) {
  const documents = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)]));

  const makeRef = (coll: string, id: string): FakeRef => ({
    id,
    async get() {
      const data = documents.get(`${coll}/${id}`);
      return { id, exists: Boolean(data), data: () => (data ? clone(data) : undefined) };
    },
    async set(data, opts) {
      const path = `${coll}/${id}`;
      const current = opts?.merge ? documents.get(path) : undefined;
      documents.set(path, { ...(current ?? {}), ...clone(data) });
    },
    async update(data) {
      const path = `${coll}/${id}`;
      const current = documents.get(path);
      if (!current) throw new Error(`Documento ausente: ${path}`);
      documents.set(path, { ...current, ...clone(data) });
    },
  });

  const listDocs = (coll: string) => {
    const prefix = `${coll}/`;
    return [...documents.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => ({ id: path.slice(prefix.length), data }));
  };

  const db = {
    collection(coll: string) {
      return {
        doc(id: string) { return makeRef(coll, id); },
        async get() {
          const docs = listDocs(coll).map(({ id, data }) => ({ id, exists: true, data: () => clone(data) }));
          return { docs, empty: docs.length === 0, size: docs.length };
        },
        where(field: string, _op: string, expected: unknown) {
          const filtered = listDocs(coll).filter(({ data }) => data[field] === expected);
          return {
            limit(n: number) {
              const limited = filtered.slice(0, n);
              return {
                async get() {
                  const docs = limited.map(({ id, data }) => ({ id, exists: true, data: () => clone(data) }));
                  return { docs, empty: docs.length === 0, size: docs.length };
                },
              };
            },
          };
        },
      };
    },
    async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      const writes: Array<{ ref: FakeRef; data: Record<string, unknown> }> = [];
      const tx = {
        async get(ref: FakeRef) { return ref.get(); },
        update(ref: FakeRef, data: Record<string, unknown>) { writes.push({ ref, data: clone(data) }); },
      };
      const result = await handler(tx);
      for (const w of writes) await w.ref.update(w.data);
      return result;
    },
  };

  return { db, get(path: string) { const d = documents.get(path); return d ? clone(d) : undefined; } };
}

const fakeDbHolder: { current: ReturnType<typeof makeFakeDb> } = { current: makeFakeDb() };
vi.mock('@/lib/config/firebaseAdmin', () => ({
  get adminDb() { return fakeDbHolder.current.db; },
}));

const mpFetchMock = vi.fn();
vi.mock('@/lib/services/mercadopago/client', async () => {
  const actual = await vi.importActual('@/lib/services/mercadopago/client');
  return { ...actual, mpFetch: (...args: unknown[]) => mpFetchMock(...args) };
});

import { createSubscriptionCheckout, transitionPlatformSubscription, settlePlatformWebhookEvent } from '@/lib/services/platformBilling/subscriptionAdmin';

const BUSINESS_ID = 'biz_1';
const BACK_URL = 'https://app.example.com/platform-admin/billing';

beforeEach(() => {
  process.env.MP_PLATFORM_ACCESS_TOKEN = 'test-platform-token';
  mpFetchMock.mockReset();
});

describe('createSubscriptionCheckout', () => {
  it('cria um preapproval novo quando não existe assinatura pra esta business', async () => {
    fakeDbHolder.current = makeFakeDb({
      [`businesses/${BUSINESS_ID}`]: { email: 'dono@negocio.com', nomeFantasia: 'Negócio Teste' },
    });
    mpFetchMock.mockResolvedValue({ id: 'preapproval_abc', status: 'pending', init_point: 'https://mp.example.com/checkout/abc' });

    const result = await createSubscriptionCheckout(BUSINESS_ID, BACK_URL);

    expect(result).toEqual({ checkoutUrl: 'https://mp.example.com/checkout/abc', status: 'pending_payment', alreadyExisted: false });
    expect(mpFetchMock).toHaveBeenCalledTimes(1);
    const [path, opts] = mpFetchMock.mock.calls[0];
    expect(path).toBe('/preapproval');
    expect(opts.method).toBe('POST');
    expect(opts.accessToken).toBe('test-platform-token');
    expect(opts.body.payer_email).toBe('dono@negocio.com');
    expect(opts.body.external_reference).toBe(BUSINESS_ID);

    const saved = fakeDbHolder.current.get(`platformSubscriptions/${BUSINESS_ID}`);
    expect(saved?.status).toBe('pending_payment');
    expect(saved?.mpPreapprovalId).toBe('preapproval_abc');
  });

  it('NÃO cria um preapproval duplicado quando já existe pending_payment com checkoutUrl', async () => {
    fakeDbHolder.current = makeFakeDb({
      [`businesses/${BUSINESS_ID}`]: { email: 'dono@negocio.com' },
      [`platformSubscriptions/${BUSINESS_ID}`]: {
        businessId: BUSINESS_ID, status: 'pending_payment', payerEmail: 'dono@negocio.com',
        checkoutUrl: 'https://mp.example.com/checkout/ja-existe', amount: 199, currency: 'BRL',
        frequency: 1, frequencyType: 'months', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const result = await createSubscriptionCheckout(BUSINESS_ID, BACK_URL);

    expect(result).toEqual({ checkoutUrl: 'https://mp.example.com/checkout/ja-existe', status: 'pending_payment', alreadyExisted: true });
    expect(mpFetchMock).not.toHaveBeenCalled();
  });

  it('NÃO cria um preapproval duplicado quando já existe active com checkoutUrl', async () => {
    fakeDbHolder.current = makeFakeDb({
      [`businesses/${BUSINESS_ID}`]: { email: 'dono@negocio.com' },
      [`platformSubscriptions/${BUSINESS_ID}`]: {
        businessId: BUSINESS_ID, status: 'active', payerEmail: 'dono@negocio.com',
        checkoutUrl: 'https://mp.example.com/checkout/ativo', mpPreapprovalId: 'preapproval_xyz',
        nextBillingDate: '2026-03-01T00:00:00.000Z', amount: 199, currency: 'BRL',
        frequency: 1, frequencyType: 'months', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const result = await createSubscriptionCheckout(BUSINESS_ID, BACK_URL);

    expect(result.alreadyExisted).toBe(true);
    expect(mpFetchMock).not.toHaveBeenCalled();
  });

  it('CRIA um preapproval novo quando a assinatura existente está cancelled', async () => {
    fakeDbHolder.current = makeFakeDb({
      [`businesses/${BUSINESS_ID}`]: { email: 'dono@negocio.com' },
      [`platformSubscriptions/${BUSINESS_ID}`]: {
        businessId: BUSINESS_ID, status: 'cancelled', payerEmail: 'dono@negocio.com',
        mpPreapprovalId: 'preapproval_old', amount: 199, currency: 'BRL',
        frequency: 1, frequencyType: 'months', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    mpFetchMock.mockResolvedValue({ id: 'preapproval_new', status: 'pending', init_point: 'https://mp.example.com/checkout/new' });

    const result = await createSubscriptionCheckout(BUSINESS_ID, BACK_URL);

    expect(result.alreadyExisted).toBe(false);
    expect(mpFetchMock).toHaveBeenCalledTimes(1);
  });

  it('lança erro quando a business não tem e-mail cadastrado', async () => {
    fakeDbHolder.current = makeFakeDb({ [`businesses/${BUSINESS_ID}`]: {} });
    await expect(createSubscriptionCheckout(BUSINESS_ID, BACK_URL)).rejects.toThrow(/e-mail/);
    expect(mpFetchMock).not.toHaveBeenCalled();
  });
});

describe('transitionPlatformSubscription', () => {
  function existingSub(status: string, extra: Record<string, unknown> = {}) {
    return {
      businessId: BUSINESS_ID, status, payerEmail: 'dono@negocio.com', mpPreapprovalId: 'preapproval_1',
      amount: 199, currency: 'BRL', frequency: 1, frequencyType: 'months',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
    };
  }

  it('aplica uma transição válida (pending_payment -> active) e grava o patch', async () => {
    fakeDbHolder.current = makeFakeDb({ [`platformSubscriptions/${BUSINESS_ID}`]: existingSub('pending_payment') });
    await transitionPlatformSubscription(BUSINESS_ID, 'active', { nextBillingDate: '2026-02-01T00:00:00.000Z', lastPaymentAt: '2026-01-01T00:00:00.000Z' });
    const saved = fakeDbHolder.current.get(`platformSubscriptions/${BUSINESS_ID}`);
    expect(saved?.status).toBe('active');
    expect(saved?.nextBillingDate).toBe('2026-02-01T00:00:00.000Z');
  });

  it('reaplicar o MESMO status é no-op (reentrega de webhook/cron)', async () => {
    fakeDbHolder.current = makeFakeDb({ [`platformSubscriptions/${BUSINESS_ID}`]: existingSub('active', { nextBillingDate: '2026-02-01T00:00:00.000Z' }) });
    await expect(transitionPlatformSubscription(BUSINESS_ID, 'active')).resolves.not.toThrow();
    const saved = fakeDbHolder.current.get(`platformSubscriptions/${BUSINESS_ID}`);
    expect(saved?.status).toBe('active');
  });

  it('rejeita uma transição inválida (cancelled -> active, terminal)', async () => {
    fakeDbHolder.current = makeFakeDb({ [`platformSubscriptions/${BUSINESS_ID}`]: existingSub('cancelled') });
    await expect(transitionPlatformSubscription(BUSINESS_ID, 'active')).rejects.toThrow(/transição inválida/);
  });

  it('lança quando a assinatura não existe (checkout nunca foi criado)', async () => {
    fakeDbHolder.current = makeFakeDb({});
    await expect(transitionPlatformSubscription(BUSINESS_ID, 'active')).rejects.toThrow(/não existe/);
  });
});

describe('settlePlatformWebhookEvent', () => {
  function pendingSub(extra: Record<string, unknown> = {}) {
    return {
      businessId: BUSINESS_ID, status: 'pending_payment', payerEmail: 'dono@negocio.com',
      checkoutUrl: 'https://mp.example.com/checkout/abc', amount: 199, currency: 'BRL',
      frequency: 1, frequencyType: 'months', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
    };
  }

  it('preapproval authorized -> transiciona pending_payment para active com nextBillingDate', async () => {
    fakeDbHolder.current = makeFakeDb({ [`platformSubscriptions/${BUSINESS_ID}`]: pendingSub() });
    mpFetchMock.mockResolvedValue({ id: 'preapproval_abc', status: 'authorized', external_reference: BUSINESS_ID });

    const result = await settlePlatformWebhookEvent({ type: 'subscription_preapproval', dataId: 'preapproval_abc' });

    expect(result).toEqual({ ignored: false, businessId: BUSINESS_ID });
    expect(mpFetchMock).toHaveBeenCalledWith('/preapproval/preapproval_abc', { accessToken: 'test-platform-token' });
    const saved = fakeDbHolder.current.get(`platformSubscriptions/${BUSINESS_ID}`);
    expect(saved?.status).toBe('active');
    expect(saved?.mpPreapprovalId).toBe('preapproval_abc');
    expect(saved?.nextBillingDate).toBeTruthy();
  });

  it('preapproval cancelled -> transiciona para cancelled', async () => {
    fakeDbHolder.current = makeFakeDb({
      [`platformSubscriptions/${BUSINESS_ID}`]: pendingSub({ status: 'active', mpPreapprovalId: 'preapproval_abc', nextBillingDate: '2026-02-01T00:00:00.000Z' }),
    });
    mpFetchMock.mockResolvedValue({ id: 'preapproval_abc', status: 'cancelled', external_reference: BUSINESS_ID });

    const result = await settlePlatformWebhookEvent({ type: 'subscription_preapproval', dataId: 'preapproval_abc' });

    expect(result).toEqual({ ignored: false, businessId: BUSINESS_ID });
    expect(fakeDbHolder.current.get(`platformSubscriptions/${BUSINESS_ID}`)?.status).toBe('cancelled');
  });

  it('preapproval pending (ainda não autorizado) -> ignorado, sem transição', async () => {
    fakeDbHolder.current = makeFakeDb({ [`platformSubscriptions/${BUSINESS_ID}`]: pendingSub() });
    mpFetchMock.mockResolvedValue({ id: 'preapproval_abc', status: 'pending', external_reference: BUSINESS_ID });

    const result = await settlePlatformWebhookEvent({ type: 'subscription_preapproval', dataId: 'preapproval_abc' });

    expect(result.ignored).toBe(true);
    expect(fakeDbHolder.current.get(`platformSubscriptions/${BUSINESS_ID}`)?.status).toBe('pending_payment');
  });

  it('preapproval sem external_reference -> ignorado (não crasha)', async () => {
    fakeDbHolder.current = makeFakeDb({});
    mpFetchMock.mockResolvedValue({ id: 'preapproval_abc', status: 'authorized' });
    const result = await settlePlatformWebhookEvent({ type: 'subscription_preapproval', dataId: 'preapproval_abc' });
    expect(result.ignored).toBe(true);
  });

  it('payment approved com external_reference -> mantém/leva a active e atualiza lastPaymentAt', async () => {
    fakeDbHolder.current = makeFakeDb({
      [`platformSubscriptions/${BUSINESS_ID}`]: pendingSub({ status: 'overdue', mpPreapprovalId: 'preapproval_abc', nextBillingDate: '2026-01-15T00:00:00.000Z' }),
    });
    mpFetchMock.mockResolvedValue({ id: 999, status: 'approved', external_reference: BUSINESS_ID });

    const result = await settlePlatformWebhookEvent({ type: 'payment', dataId: '999' });

    expect(result).toEqual({ ignored: false, businessId: BUSINESS_ID });
    const saved = fakeDbHolder.current.get(`platformSubscriptions/${BUSINESS_ID}`);
    expect(saved?.status).toBe('active');
    expect(saved?.lastPaymentStatus).toBe('approved');
  });

  it('payment approved resolvido via metadata.preapproval_id quando external_reference ausente', async () => {
    fakeDbHolder.current = makeFakeDb({
      [`platformSubscriptions/${BUSINESS_ID}`]: pendingSub({ status: 'active', mpPreapprovalId: 'preapproval_xyz', nextBillingDate: '2026-01-15T00:00:00.000Z' }),
    });
    mpFetchMock.mockResolvedValue({ id: 999, status: 'approved', metadata: { preapproval_id: 'preapproval_xyz' } });

    const result = await settlePlatformWebhookEvent({ type: 'payment', dataId: '999' });

    expect(result).toEqual({ ignored: false, businessId: BUSINESS_ID });
  });

  it('payment rejected -> ignorado, sem transição (cron de overdue cobre isso)', async () => {
    fakeDbHolder.current = makeFakeDb({
      [`platformSubscriptions/${BUSINESS_ID}`]: pendingSub({ status: 'active', mpPreapprovalId: 'preapproval_abc', nextBillingDate: '2026-01-15T00:00:00.000Z' }),
    });
    mpFetchMock.mockResolvedValue({ id: 999, status: 'rejected', external_reference: BUSINESS_ID });

    const result = await settlePlatformWebhookEvent({ type: 'payment', dataId: '999' });

    expect(result.ignored).toBe(true);
    expect(fakeDbHolder.current.get(`platformSubscriptions/${BUSINESS_ID}`)?.status).toBe('active');
  });

  it('tipo de evento desconhecido -> ignorado', async () => {
    fakeDbHolder.current = makeFakeDb({});
    const result = await settlePlatformWebhookEvent({ type: 'merchant_order', dataId: '123' });
    expect(result.ignored).toBe(true);
  });
});
