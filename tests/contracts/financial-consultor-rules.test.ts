/**
 * Motor de regras do Super Consultor (financial-v2/read-models/consultor-rules.ts)
 * — função pura, sem Firestore/React. Trava a prioridade determinística:
 * atrasado > próximo (7d) > neutro, e a ausência de PII nos facts emitidos.
 */

import { describe, it, expect } from 'vitest';
import { pickVisaoGeralInsight, pickBancarioInsight, hashFacts } from '@/app/components/features/financial-v2/read-models/consultor-rules';
import type { ProjecaoCaixaOverview } from '@/app/components/features/financial-v2/read-models/projecao-caixa';
import type { ConciliacaoBaldesOverview } from '@/app/components/features/financial-v2/read-models/conciliacao-3-baldes';
import type { Transaction, BankAccount } from '@/lib/types';

const NO_PENDING_BALDES: ConciliacaoBaldesOverview = {
  bateuCount: 0,
  bateuAmostra: [],
  sobrouBanco: [],
  sobrouSistema: [],
  itensPendentes: 0,
  valorEmDuvida: 0,
};

const NOW = new Date('2026-07-15T12:00:00.000Z');

// Sem cruzamento de zero — isola as regras de fallback (atrasados/próximos/neutro)
// das regras de severidade maior (caixa-cruza-zero/pagar-antes-de-receber/recebível-parado).
const NO_CROSS_ZERO: ProjecaoCaixaOverview = {
  points: [],
  todayIndex: 0,
  crossZeroIndex: null,
  crossZeroDate: null,
  crossZeroBalance: null,
};

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    businessId: 'biz_1',
    type: 'despesa',
    description: 'Aluguel',
    amount: 100,
    status: 'pendente',
    ...overrides,
  } as Transaction;
}

describe('pickVisaoGeralInsight', () => {
  it('prioriza atrasados sobre próximos a vencer', () => {
    const transactions = [
      makeTransaction({ id: 'a', status: 'atrasado', dueDate: '2026-07-10', amount: 200 }),
      makeTransaction({ id: 'b', status: 'pendente', dueDate: '2026-07-18', amount: 50 }),
    ];
    const insight = pickVisaoGeralInsight({ transactions, projecao: NO_CROSS_ZERO, now: NOW });
    expect(insight.ruleId).toBe('vencimentos-atrasados');
    expect(insight.facts.count).toBe(1);
  });

  it('cai pra "vencimentos-proximos" sem atrasados', () => {
    const transactions = [makeTransaction({ id: 'b', status: 'pendente', dueDate: '2026-07-18', amount: 50 })];
    const insight = pickVisaoGeralInsight({ transactions, projecao: NO_CROSS_ZERO, now: NOW });
    expect(insight.ruleId).toBe('vencimentos-proximos');
  });

  it('cai pra frase neutra sem nenhum vencimento nos próximos 7 dias', () => {
    const transactions = [makeTransaction({ id: 'c', status: 'pendente', dueDate: '2026-09-01', amount: 999 })];
    const insight = pickVisaoGeralInsight({ transactions, projecao: NO_CROSS_ZERO, now: NOW });
    expect(insight.ruleId).toBe('sem-alerta');
  });

  it('facts nunca contêm chaves de identidade do cliente', () => {
    const transactions = [makeTransaction({ id: 'a', status: 'atrasado', dueDate: '2026-07-10', clientName: 'Fulano' })];
    const insight = pickVisaoGeralInsight({ transactions, projecao: NO_CROSS_ZERO, now: NOW });
    expect(Object.keys(insight.facts)).not.toContain('clientName');
  });

  it('prioriza caixa-cruza-zero sobre qualquer outra regra', () => {
    const transactions = [makeTransaction({ id: 'a', status: 'atrasado', dueDate: '2026-07-10', amount: 200 })];
    const projecao: ProjecaoCaixaOverview = {
      points: [],
      todayIndex: 5,
      crossZeroIndex: 8,
      crossZeroDate: '2026-07-18',
      crossZeroBalance: -500,
    };
    const insight = pickVisaoGeralInsight({ transactions, projecao, now: NOW });
    expect(insight.ruleId).toBe('caixa-cruza-zero');
    expect(insight.facts.saldo).toContain('500');
  });

  it('pagar-antes-de-receber quando despesa grande próxima cruza com receita atrasada', () => {
    const transactions = [
      makeTransaction({ id: 'aluguel', type: 'despesa', status: 'pendente', dueDate: '2026-07-20', amount: 2100 }),
      makeTransaction({ id: 'recv', type: 'receita', status: 'atrasado', dueDate: '2026-07-01', amount: 3200 }),
    ];
    const insight = pickVisaoGeralInsight({ transactions, projecao: NO_CROSS_ZERO, now: NOW });
    expect(insight.ruleId).toBe('pagar-antes-de-receber');
  });
});

describe('pickBancarioInsight', () => {
  function makeAccount(overrides: Partial<BankAccount> = {}): BankAccount {
    return {
      id: 'acc1', businessId: 'biz_1', name: 'Conta principal', bankName: 'Banco X',
      accountType: 'corrente', balance: 1000, color: '#000', isMain: true, isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('soma só contas ativas e não-caixa', () => {
    const accounts = [
      makeAccount({ id: 'a', balance: 1000 }),
      makeAccount({ id: 'b', balance: 500, accountType: 'caixa' }),
      makeAccount({ id: 'c', balance: 200, isActive: false }),
    ];
    const insight = pickBancarioInsight(accounts, NO_PENDING_BALDES);
    expect(insight.ruleId).toBe('saldo-total');
    expect(insight.facts.count).toBe(1);
  });

  it('regra dedicada quando não há contas', () => {
    expect(pickBancarioInsight([], NO_PENDING_BALDES).ruleId).toBe('sem-contas');
  });

  it('prioriza conciliacao-pendente quando 3+ itens não batem', () => {
    const accounts = [makeAccount({ id: 'a', balance: 1000 })];
    const baldes: ConciliacaoBaldesOverview = {
      bateuCount: 10,
      bateuAmostra: [],
      sobrouBanco: [
        { id: 'b1', date: '2026-07-10', desc: 'PIX recebido', valor: 335 },
        { id: 'b2', date: '2026-07-08', desc: 'Tarifa bancária', valor: -38 },
      ],
      sobrouSistema: [{ id: 's1', date: '2026-07-14', desc: 'Venda PDV', valor: 412 }],
      itensPendentes: 3,
      valorEmDuvida: 785,
    };
    const insight = pickBancarioInsight(accounts, baldes);
    expect(insight.ruleId).toBe('conciliacao-pendente');
    expect(insight.facts.itens).toBe(3);
  });
});

describe('hashFacts', () => {
  it('é determinística e insensível à ordem das chaves', () => {
    expect(hashFacts({ a: 1, b: 2 })).toBe(hashFacts({ b: 2, a: 1 }));
  });

  it('muda quando um valor muda', () => {
    expect(hashFacts({ a: 1 })).not.toBe(hashFacts({ a: 2 }));
  });
});
