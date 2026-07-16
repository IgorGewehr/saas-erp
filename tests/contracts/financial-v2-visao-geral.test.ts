/**
 * Read-models da Visão Geral (financial-v2, Fase 2 — os 5 blocos do
 * santo-graal). Funções puras, sem Firestore/React: travam a matemática que
 * a UI só formata (disponível pra retirada, projeção de caixa 30d, resultado
 * do mês, vencimentos próximos).
 */

import { describe, it, expect } from 'vitest';
import { computeDisponivelRetirada } from '@/app/components/features/financial-v2/read-models/disponivel-retirada';
import { computeProjecaoCaixa } from '@/app/components/features/financial-v2/read-models/projecao-caixa';
import { computeResultadoDoMes } from '@/app/components/features/financial-v2/read-models/resultado-do-mes';
import { computeVencimentosProximos } from '@/app/components/features/financial-v2/read-models/vencimentos-proximos';
import { advanceRecurrence } from '@/app/components/features/financial-v2/read-models/recurrence-projection';
import type { Transaction, BankAccount, DasRecord } from '@/lib/types';

const NOW = new Date(2026, 6, 15, 12, 0, 0); // 15/07/2026, horário local

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1', businessId: 'biz_1', type: 'despesa', description: 'Aluguel',
    amount: 100, status: 'pendente',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Transaction;
}

function makeAccount(overrides: Partial<BankAccount> = {}): BankAccount {
  return {
    id: 'acc1', businessId: 'biz_1', name: 'Conta principal', bankName: 'Banco X',
    accountType: 'corrente', balance: 1000, color: '#000', isMain: true, isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeDisponivelRetirada', () => {
  it('soma saldo bancário incluindo caixa (banco + gaveta)', () => {
    const accounts = [makeAccount({ id: 'a', balance: 1000 }), makeAccount({ id: 'b', balance: 500, accountType: 'caixa' })];
    const overview = computeDisponivelRetirada([], accounts, [], 0, NOW);
    expect(overview.saldoBancario).toBe(1500);
    expect(overview.livre).toBe(1500);
  });

  it('desconta despesas pendentes/atrasadas dentro do horizonte de 15 dias', () => {
    const accounts = [makeAccount({ balance: 1000 })];
    const transactions = [
      makeTransaction({ id: 'a', status: 'pendente', dueDate: '2026-07-20', amount: 200 }), // dentro do horizonte
      makeTransaction({ id: 'b', status: 'pendente', dueDate: '2026-08-20', amount: 900 }), // fora do horizonte
      makeTransaction({ id: 'c', status: 'atrasado', dueDate: '2026-06-01', amount: 100 }), // atrasado sempre conta
      makeTransaction({ id: 'd', status: 'pago', dueDate: '2026-07-20', amount: 999 }), // já pago, não conta
    ];
    const overview = computeDisponivelRetirada(transactions, accounts, [], 0, NOW);
    expect(overview.despesas15d).toBe(300);
    expect(overview.livre).toBe(1000 - 300);
  });

  it('inclui DAS pendente com vencimento no horizonte e ignora DAS pago', () => {
    const accounts = [makeAccount({ balance: 1000 })];
    const das: DasRecord[] = [
      { id: 'd1', businessId: 'biz_1', competencia: '202606', receitaBruta: 0, rbt12: 0, anexo: 'I', aliquotaEfetiva: 6, valorDas: 300, vencimento: '2026-07-20', status: 'pendente', createdAt: '', updatedAt: '' },
      { id: 'd2', businessId: 'biz_1', competencia: '202605', receitaBruta: 0, rbt12: 0, anexo: 'I', aliquotaEfetiva: 6, valorDas: 999, vencimento: '2026-06-20', status: 'pago', createdAt: '', updatedAt: '' },
    ];
    const overview = computeDisponivelRetirada([], accounts, das, 0, NOW);
    expect(overview.impostoReservado).toBe(300);
    expect(overview.compromissos15d).toBe(300);
  });

  it('subtrai o colchão mínimo configurado e pode ficar negativo', () => {
    const accounts = [makeAccount({ balance: 100 })];
    const overview = computeDisponivelRetirada([], accounts, [], 500, NOW);
    expect(overview.livre).toBe(100 - 500);
  });

  it('conta uma recorrência ativa uma única vez dentro do horizonte (sem inflar por atraso)', () => {
    const accounts = [makeAccount({ balance: 1000 })];
    const transactions = [
      makeTransaction({
        id: 'rec', status: 'pendente', amount: 300,
        recurrence: { frequency: 'monthly', nextDueDate: '2026-06-01', isActive: true }, // já atrasada há mais de 1 mês
      }),
    ];
    const overview = computeDisponivelRetirada(transactions, accounts, [], 0, NOW);
    // conta a ocorrência atrasada (jun) + a próxima que cai dentro do horizonte (01/07 <= 30/07)
    expect(overview.despesas15d).toBe(600);
  });
});

describe('computeProjecaoCaixa', () => {
  it('reconstrói o passado a partir de pagamentos reais e ancora hoje no saldo bancário real', () => {
    const accounts = [makeAccount({ balance: 1000 })];
    const transactions = [
      makeTransaction({ id: 'a', type: 'receita', status: 'pago', paymentDate: '2026-07-14', amount: 200 }),
      makeTransaction({ id: 'b', type: 'despesa', status: 'pago', paymentDate: '2026-07-10', amount: 50 }),
    ];
    const overview = computeProjecaoCaixa(transactions, accounts, NOW);
    const byDate = new Map(overview.points.map(p => [p.date, p.balance]));

    expect(byDate.get('2026-07-15')).toBe(1000); // hoje — ancorado no saldo bancário real
    expect(byDate.get('2026-07-14')).toBe(1000); // nada mudou entre 14 e 15
    expect(byDate.get('2026-07-13')).toBe(800); // antes da receita de +200 recebida em 14/07
    expect(byDate.get('2026-07-10')).toBe(800); // já reflete a despesa de -50 paga em 10/07
    expect(byDate.get('2026-07-09')).toBe(850); // antes dessa despesa
  });

  it('projeta pendentes futuros e detecta o dia em que o caixa cruza zero', () => {
    const accounts = [makeAccount({ balance: 100 })];
    const transactions = [
      makeTransaction({ id: 'a', type: 'despesa', status: 'pendente', dueDate: '2026-07-17', amount: 500 }),
    ];
    const overview = computeProjecaoCaixa(transactions, accounts, NOW);
    expect(overview.crossZeroIndex).not.toBeNull();
    expect(overview.crossZeroDate).toBe('2026-07-17');
    expect(overview.crossZeroBalance).toBe(-400);
  });

  it('sem nenhum evento futuro que derrube o saldo, não cruza zero', () => {
    const accounts = [makeAccount({ balance: 1000 })];
    const overview = computeProjecaoCaixa([], accounts, NOW);
    expect(overview.crossZeroIndex).toBeNull();
    expect(overview.points).toHaveLength(30);
    expect(overview.points.every(p => p.balance === 1000)).toBe(true);
  });

  it('marca hoje como negativo quando o saldo bancário real já está negativo', () => {
    const accounts = [makeAccount({ balance: -50 })];
    const overview = computeProjecaoCaixa([], accounts, NOW);
    expect(overview.crossZeroIndex).toBe(overview.todayIndex);
  });
});

describe('computeResultadoDoMes', () => {
  it('soma receita menos despesa por competência (dueDate), ignorando cancelados', () => {
    const transactions = [
      makeTransaction({ id: 'a', type: 'receita', status: 'pago', dueDate: '2026-07-05', amount: 1000 }),
      makeTransaction({ id: 'b', type: 'despesa', status: 'pendente', dueDate: '2026-07-10', amount: 400 }),
      makeTransaction({ id: 'c', type: 'despesa', status: 'cancelado', dueDate: '2026-07-12', amount: 9999 }),
      makeTransaction({ id: 'd', type: 'receita', status: 'pendente', dueDate: '2026-08-01', amount: 500 }), // outro mês
    ];
    const overview = computeResultadoDoMes(transactions, '2026-07');
    expect(overview.receitaTotal).toBe(1000);
    expect(overview.despesaTotal).toBe(400);
    expect(overview.lucro).toBe(600);
    expect(overview.margemPct).toBeCloseTo(60, 5);
  });

  it('calcula delta vs mês anterior e a receita pendente do mês (frase-ponte)', () => {
    const transactions = [
      makeTransaction({ id: 'a', type: 'receita', status: 'pendente', dueDate: '2026-07-05', amount: 800 }),
      makeTransaction({ id: 'b', type: 'receita', status: 'pago', dueDate: '2026-06-05', amount: 500 }),
    ];
    const overview = computeResultadoDoMes(transactions, '2026-07');
    expect(overview.receitaPendenteTotal).toBe(800);
    expect(overview.deltaValue).toBe(800 - 500);
    expect(overview.deltaPct).toBeCloseTo(60, 5);
  });
});

describe('computeVencimentosProximos', () => {
  it('lista pendentes/atrasados dentro de 7 dias, ordenados por data', () => {
    const transactions = [
      makeTransaction({ id: 'a', type: 'despesa', status: 'pendente', dueDate: '2026-07-20', amount: 400, description: 'Fornecedor' }),
      makeTransaction({ id: 'b', type: 'receita', status: 'pendente', dueDate: '2026-07-18', amount: 890, description: 'Cliente X' }),
      makeTransaction({ id: 'c', type: 'despesa', status: 'pendente', dueDate: '2026-08-01', amount: 999 }), // fora do horizonte
      makeTransaction({ id: 'd', type: 'despesa', status: 'pago', dueDate: '2026-07-16', amount: 111 }), // já pago
    ];
    const items = computeVencimentosProximos(transactions, NOW);
    expect(items.map(i => i.id)).toEqual(['b', 'a']);
    expect(items[0].tone).toBe('pos');
    expect(items[1].tone).toBe('crit');
  });

  it('usa o nextDueDate real de recorrências ativas, não o dueDate estático do template', () => {
    const transactions = [
      makeTransaction({
        id: 'rec', status: 'pago', dueDate: '2026-01-01', amount: 300,
        recurrence: { frequency: 'monthly', nextDueDate: '2026-07-19', isActive: true, label: 'Aluguel' },
      }),
    ];
    const items = computeVencimentosProximos(transactions, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].date).toBe('2026-07-19');
    expect(items[0].label).toBe('Aluguel');
  });
});

describe('advanceRecurrence', () => {
  it('avança mensalmente respeitando o dia do mês', () => {
    expect(advanceRecurrence('2026-01-05', 'monthly', 5)).toBe('2026-02-05');
  });

  it('nunca trava em loop: qualquer chamada avança estritamente a data', () => {
    const next = advanceRecurrence('2026-07-15', 'weekly');
    expect(next > '2026-07-15').toBe(true);
  });
});
