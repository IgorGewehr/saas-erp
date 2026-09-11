import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSubscriptionOverdue } from '@/lib/services/platformBilling/overdueRunner';

describe('isSubscriptionOverdue (pura)', () => {
  const NOW = new Date('2026-06-15T12:00:00.000Z');

  it('true quando nextBillingDate já passou', () => {
    expect(isSubscriptionOverdue('2026-06-01T00:00:00.000Z', NOW)).toBe(true);
  });

  it('false quando nextBillingDate ainda não chegou', () => {
    expect(isSubscriptionOverdue('2026-07-01T00:00:00.000Z', NOW)).toBe(false);
  });

  it('false quando nextBillingDate é exatamente agora (limite não é overdue)', () => {
    expect(isSubscriptionOverdue(NOW.toISOString(), NOW)).toBe(false);
  });

  it('false pra data inválida (defensivo, nunca marca overdue por engano)', () => {
    expect(isSubscriptionOverdue('not-a-date', NOW)).toBe(false);
  });
});

// Fake Admin SDK mínimo pro runner: collection().where('status','==','active').get()
// + o que transitionPlatformSubscription (mockado por inteiro aqui — já coberto em
// tests/services/platformSubscriptionAdmin.test.ts) precisa.

type FakeSnapshot = { id: string; exists: boolean; data: () => Record<string, unknown> | undefined };

function makeFakeDb(activeSubscriptions: Record<string, Record<string, unknown>>) {
  return {
    collection(coll: string) {
      if (coll !== 'platformSubscriptions') throw new Error(`unexpected collection: ${coll}`);
      return {
        where(field: string, _op: string, expected: unknown) {
          return {
            async get() {
              const docs: FakeSnapshot[] = Object.entries(activeSubscriptions)
                .filter(([, data]) => data[field] === expected)
                .map(([id, data]) => ({ id, exists: true, data: () => data }));
              return { docs, empty: docs.length === 0, size: docs.length };
            },
          };
        },
      };
    },
  };
}

const fakeDbHolder: { current: ReturnType<typeof makeFakeDb> } = { current: makeFakeDb({}) };
vi.mock('@/lib/config/firebaseAdmin', () => ({
  get adminDb() { return fakeDbHolder.current; },
}));

const transitionMock = vi.fn();
vi.mock('@/lib/services/platformBilling/subscriptionAdmin', () => ({
  transitionPlatformSubscription: (...args: unknown[]) => transitionMock(...args),
}));

import { runOverdueCheck } from '@/lib/services/platformBilling/overdueRunner';

const NOW = new Date('2026-06-15T12:00:00.000Z');

beforeEach(() => {
  transitionMock.mockReset();
  transitionMock.mockResolvedValue(undefined);
});

describe('runOverdueCheck', () => {
  it('marca overdue só as active com nextBillingDate vencido', async () => {
    fakeDbHolder.current = makeFakeDb({
      biz_overdue: { status: 'active', nextBillingDate: '2026-06-01T00:00:00.000Z' },
      biz_em_dia: { status: 'active', nextBillingDate: '2026-07-01T00:00:00.000Z' },
    });

    const summary = await runOverdueCheck(NOW);

    expect(summary.scanned).toBe(2);
    expect(summary.markedOverdue).toBe(1);
    expect(transitionMock).toHaveBeenCalledTimes(1);
    expect(transitionMock).toHaveBeenCalledWith('biz_overdue', 'overdue');
  });

  it('pula assinatura active sem nextBillingDate (não deveria existir por invariante do schema, mas defensivo)', async () => {
    fakeDbHolder.current = makeFakeDb({ biz_sem_data: { status: 'active' } });
    const summary = await runOverdueCheck(NOW);
    expect(summary.markedOverdue).toBe(0);
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it('registra erro isolado sem abortar o scan das demais', async () => {
    fakeDbHolder.current = makeFakeDb({
      biz_falha: { status: 'active', nextBillingDate: '2026-06-01T00:00:00.000Z' },
      biz_ok: { status: 'active', nextBillingDate: '2026-06-02T00:00:00.000Z' },
    });
    transitionMock.mockImplementation(async (businessId: string) => {
      if (businessId === 'biz_falha') throw new Error('boom');
    });

    const summary = await runOverdueCheck(NOW);

    expect(summary.markedOverdue).toBe(1);
    expect(summary.errors).toEqual([{ businessId: 'biz_falha', error: 'boom' }]);
  });

  it('nenhuma assinatura active -> scan zero, sem erro', async () => {
    fakeDbHolder.current = makeFakeDb({});
    const summary = await runOverdueCheck(NOW);
    expect(summary).toEqual({ scanned: 0, markedOverdue: 0, errors: [] });
  });
});
