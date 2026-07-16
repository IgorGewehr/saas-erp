/**
 * Read-models de Recorrentes (financial-v2) — Contas fixas + Assinaturas (a
 * joia do plano). Funções puras, sem Firestore/React: travam a matemática de
 * MRR/churn/degrau que a UI só formata.
 */

import { describe, it, expect } from 'vitest';
import { computeCompromissosFixos } from '@/app/components/features/financial-v2/read-models/compromissos-fixos';
import { computeAssinaturasOverview, resolveSubscriptionAxis } from '@/app/components/features/financial-v2/read-models/assinaturas-overview';
import { pickContasFixasInsight, pickAssinaturasInsight } from '@/app/components/features/financial-v2/read-models/consultor-rules';
import type { Transaction, ClientMembership, Membership } from '@/lib/types';

const NOW = new Date('2026-07-15T12:00:00.000Z');

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1', businessId: 'biz_1', type: 'despesa', description: 'Aluguel',
    amount: 100, status: 'pago', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Transaction;
}

function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: 'plan_1', businessId: 'biz_1', name: 'Plano Mensal', serviceIds: [], price: 100,
    billingCycle: 'monthly', isActive: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeClientMembership(overrides: Partial<ClientMembership> = {}): ClientMembership {
  return {
    id: 'cm_1', businessId: 'biz_1', clientId: 'cli_1', clientName: 'Cliente 1',
    membershipId: 'plan_1', membershipName: 'Plano Mensal', status: 'active',
    startDate: '2026-01-10', usesThisCycle: 0,
    createdAt: '2026-01-10T00:00:00.000Z', updatedAt: '2026-01-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeCompromissosFixos', () => {
  it('mensaliza recorrências ativas de despesa e ignora receita/inativas', () => {
    const transactions = [
      makeTransaction({ id: 'a', amount: 300, recurrence: { frequency: 'monthly', nextDueDate: '2026-08-01', isActive: true } }),
      makeTransaction({ id: 'b', type: 'receita', amount: 999, recurrence: { frequency: 'monthly', nextDueDate: '2026-08-01', isActive: true } }),
      makeTransaction({ id: 'c', amount: 500, recurrence: { frequency: 'monthly', nextDueDate: '2026-08-01', isActive: false } }),
      makeTransaction({ id: 'd', amount: 90, recurrence: { frequency: 'quarterly', nextDueDate: '2026-08-01', isActive: true } }),
    ];
    const overview = computeCompromissosFixos(transactions, NOW);
    expect(overview.count).toBe(2);
    expect(overview.custoDeExistir).toBeCloseTo(300 + 90 / 3, 5);
  });

  it('detecta degrau quando a última ocorrência paga supera a média 12m em >15%', () => {
    const transactions = [
      makeTransaction({
        id: 'a', amount: 300,
        recurrence: {
          frequency: 'monthly', nextDueDate: '2026-08-01', isActive: true, label: 'Luz',
          history: [
            { dueDate: '2026-05-01', paidDate: '2026-05-01', amount: 100 },
            { dueDate: '2026-06-01', paidDate: '2026-06-01', amount: 100 },
            { dueDate: '2026-07-01', paidDate: '2026-07-01', amount: 160 },
          ],
        },
      }),
    ];
    const overview = computeCompromissosFixos(transactions, NOW);
    expect(overview.rows[0].isDegrau).toBe(true);
    expect(overview.degrauRows).toHaveLength(1);
  });

  it('não marca degrau quando a variação fica dentro do limite de 15%', () => {
    const transactions = [
      makeTransaction({
        id: 'a', amount: 105,
        recurrence: {
          frequency: 'monthly', nextDueDate: '2026-08-01', isActive: true, label: 'Internet',
          history: [
            { dueDate: '2026-06-01', paidDate: '2026-06-01', amount: 100 },
            { dueDate: '2026-07-01', paidDate: '2026-07-01', amount: 105 },
          ],
        },
      }),
    ];
    const overview = computeCompromissosFixos(transactions, NOW);
    expect(overview.rows[0].isDegrau).toBe(false);
  });
});

describe('resolveSubscriptionAxis', () => {
  it('escolhe membership quando há ClientMembership', () => {
    expect(resolveSubscriptionAxis([makeClientMembership()], [], false)).toBe('membership');
  });

  it('escolhe project só quando projectsEnabled e há projetos, sem ClientMembership', () => {
    expect(resolveSubscriptionAxis([], [{ id: 'p1', businessId: 'biz_1', name: 'X', color: '#000', status: 'ativo', createdAt: '', updatedAt: '' }], true)).toBe('project');
    expect(resolveSubscriptionAxis([], [], true)).toBeNull();
  });

  it('retorna null sem ClientMembership nem projeto', () => {
    expect(resolveSubscriptionAxis([], [], false)).toBeNull();
  });
});

describe('computeAssinaturasOverview (eixo membership — a joia)', () => {
  it('calcula MRR só das assinaturas ativas na data de referência', () => {
    const memberships = [makeMembership({ id: 'plan_1', price: 100, billingCycle: 'monthly' })];
    const clientMemberships = [
      makeClientMembership({ id: 'cm_1', startDate: '2026-01-10', status: 'active' }),
      makeClientMembership({ id: 'cm_2', clientName: 'Cliente 2', startDate: '2026-08-01', status: 'active' }), // começa depois do período
    ];
    const overview = computeAssinaturasOverview({
      clientMemberships, memberships, transactions: [], projects: [], projectsEnabled: false, period: '2026-07', now: NOW,
    });
    expect(overview?.axis).toBe('membership');
    expect(overview?.mrr).toBe(100); // só cm_1 está ativa em julho
    expect(overview?.activeCount).toBe(1);
  });

  it('conta churn do mês via cancelledAt e cai pra updatedAt quando cancelledAt falta (gap g1)', () => {
    const memberships = [makeMembership()];
    const clientMemberships = [
      makeClientMembership({ id: 'cm_1', status: 'cancelled', cancelledAt: '2026-07-10' }),
      makeClientMembership({ id: 'cm_2', clientName: 'Cliente 2', status: 'cancelled', cancelledAt: undefined, updatedAt: '2026-07-12T00:00:00.000Z' }),
    ];
    const overview = computeAssinaturasOverview({
      clientMemberships, memberships, transactions: [], projects: [], projectsEnabled: false, period: '2026-07', now: NOW,
    });
    expect(overview?.churnMonthCount).toBe(2);
    expect(overview?.mrr).toBe(0); // ambas já canceladas antes do fim do período
  });

  it('marca assinatura em risco/atraso a partir de Transaction vinculada por clientMembershipId', () => {
    const memberships = [makeMembership()];
    const clientMemberships = [makeClientMembership({ id: 'cm_1' })];
    const transactions = [
      makeTransaction({ id: 't1', type: 'receita', status: 'atrasado', dueDate: '2026-06-01', clientMembershipId: 'cm_1' }),
    ];
    const overview = computeAssinaturasOverview({
      clientMemberships, memberships, transactions, projects: [], projectsEnabled: false, period: '2026-07', now: NOW,
    });
    expect(overview?.rows[0].status).toBe('atraso');
    expect(overview?.rows[0].overdueDays).toBeGreaterThan(0);
  });

  it('retorna null sem ClientMembership nem Project habilitado', () => {
    const overview = computeAssinaturasOverview({
      clientMemberships: [], memberships: [], transactions: [], projects: [], projectsEnabled: false, period: '2026-07', now: NOW,
    });
    expect(overview).toBeNull();
  });
});

describe('pickContasFixasInsight', () => {
  it('prioriza fixo-degrau sobre peso-fixo-alto', () => {
    const overview = computeCompromissosFixos([
      makeTransaction({
        id: 'a', amount: 300,
        recurrence: {
          frequency: 'monthly', nextDueDate: '2026-08-01', isActive: true, label: 'Aluguel',
          history: [
            { dueDate: '2026-06-01', paidDate: '2026-06-01', amount: 100 },
            { dueDate: '2026-07-01', paidDate: '2026-07-01', amount: 200 },
          ],
        },
      }),
    ], NOW);
    expect(pickContasFixasInsight(overview).ruleId).toBe('fixo-degrau');
  });

  it('cai pra frase neutra sem degrau nem peso alto', () => {
    const overview = computeCompromissosFixos([], NOW);
    expect(pickContasFixasInsight(overview).ruleId).toBe('fixas-estaveis');
  });
});

describe('pickAssinaturasInsight', () => {
  it('prioriza churn-concentrado (2+ no mesmo plano) sobre concentração de MRR', () => {
    const memberships = [makeMembership({ id: 'plan_1' })];
    const clientMemberships = [
      makeClientMembership({ id: 'cm_1', status: 'cancelled', cancelledAt: '2026-07-05' }),
      makeClientMembership({ id: 'cm_2', clientName: 'Cliente 2', status: 'cancelled', cancelledAt: '2026-07-06' }),
    ];
    const overview = computeAssinaturasOverview({
      clientMemberships, memberships, transactions: [], projects: [], projectsEnabled: false, period: '2026-07', now: NOW,
    })!;
    expect(pickAssinaturasInsight(overview).ruleId).toBe('churn-concentrado');
  });
});
