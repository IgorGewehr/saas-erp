/**
 * Read-models de Entradas & Saídas (financial-v2, Fase 3) — extrato unificado,
 * resumo por categoria, aging de recebíveis, resumo de abertos e a ponte
 * caixa×competência. Funções puras, sem Firestore/React: travam a matemática
 * que `EntradasSaidasTab`/`ExtratoTable`/`BaixaDialog` só formatam e disparam.
 */

import { describe, it, expect } from 'vitest';
import { computeExtratoUnificado, rowPassesFilter } from '@/app/components/features/financial-v2/read-models/extrato-unificado';
import { computeResumoPorCategoria } from '@/app/components/features/financial-v2/read-models/resumo-por-categoria';
import { computeAgingRecebiveis } from '@/app/components/features/financial-v2/read-models/aging-recebiveis';
import { computeResumoAbertos } from '@/app/components/features/financial-v2/read-models/resumo-abertos';
import { computeResultadoDoMes } from '@/app/components/features/financial-v2/read-models/resultado-do-mes';
import { computeFechamentoMes, computeBridgeCaixaCompetencia } from '@/app/components/features/financial-v2/read-models/projecao-mes';
import type { BankAccount, Transaction } from '@/lib/types';

const NOW = new Date(2026, 6, 15, 12, 0, 0); // 15/07/2026, horário local

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1', businessId: 'biz_1', type: 'despesa', description: 'Aluguel',
    amount: 100, status: 'pago', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Transaction;
}

function makeAccount(overrides: Partial<BankAccount> = {}): BankAccount {
  return {
    id: 'acc_1', businessId: 'biz_1', name: 'Itaú PJ', bankName: 'Itaú', accountType: 'corrente',
    balance: 1000, color: '#000', isMain: true, isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeExtratoUnificado', () => {
  it('ignora cancelado, mescla pago (paymentDate) com aberto (dueDate) e marca o divisor de hoje', () => {
    const transactions = [
      makeTransaction({ id: 'cancel', status: 'cancelado', dueDate: '2026-07-10' }),
      makeTransaction({ id: 'paga', status: 'pago', paymentDate: '2026-07-10', bankAccountId: 'acc_1' }),
      makeTransaction({ id: 'futura', status: 'pendente', dueDate: '2026-07-20' }),
      makeTransaction({ id: 'atrasada', type: 'receita', status: 'atrasado', dueDate: '2026-07-01' }),
    ];
    const { rows, todayDividerIndex, atrasadosCount } = computeExtratoUnificado(transactions, [makeAccount()], NOW);

    expect(rows.find(r => r.transactionId === 'cancel')).toBeUndefined();
    expect(rows).toHaveLength(3);
    expect(atrasadosCount).toBe(1);

    // Ordenado desc por data: futura (20/07) > hoje (15/07, divisor) > paga (10/07) > atrasada (01/07)
    expect(rows[0].transactionId).toBe('futura');
    expect(todayDividerIndex).toBe(1);
    expect(rows[todayDividerIndex!].transactionId).toBe('paga');
    expect(rows[todayDividerIndex!].accountLabel).toBe('Itaú PJ');
  });

  it('recorrência ativa gera 1 linha aberta (nextDueDate) + 1 linha por ocorrência do history, nunca duplicadas', () => {
    const transactions = [
      makeTransaction({
        id: 'rec', amount: 300, status: 'pago',
        recurrence: {
          frequency: 'monthly', nextDueDate: '2026-08-01', isActive: true, label: 'Aluguel da loja',
          history: [
            { dueDate: '2026-06-01', paidDate: '2026-06-01', amount: 300 },
            { dueDate: '2026-07-01', paidDate: '2026-07-01', amount: 300 },
          ],
        },
      }),
    ];
    const { rows } = computeExtratoUnificado(transactions, [], NOW);
    expect(rows).toHaveLength(3);
    const open = rows.find(r => r.isRecurringOpenOccurrence);
    expect(open?.date).toBe('2026-08-01');
    expect(open?.status).toBe('previsto');
    expect(rows.filter(r => r.isHistoryEntry)).toHaveLength(2);
  });
});

describe('rowPassesFilter', () => {
  const receita = { direction: 'entrada', category: 'Serviços', status: 'previsto' } as const;
  const despesa = { direction: 'saida', category: 'Aluguel', status: 'atrasado' } as const;

  it('segmento receber/pagar filtra por direção', () => {
    expect(rowPassesFilter(receita as never, 'receber', null)).toBe(true);
    expect(rowPassesFilter(receita as never, 'pagar', null)).toBe(false);
    expect(rowPassesFilter(despesa as never, 'pagar', null)).toBe(true);
    expect(rowPassesFilter(despesa as never, 'receber', null)).toBe(false);
  });

  it('filtro de categoria e de atrasados são exclusivos entre si', () => {
    expect(rowPassesFilter(despesa as never, 'tudo', { type: 'categoria', value: 'Aluguel', label: 'Aluguel' })).toBe(true);
    expect(rowPassesFilter(despesa as never, 'tudo', { type: 'categoria', value: 'Folha', label: 'Folha' })).toBe(false);
    expect(rowPassesFilter(despesa as never, 'tudo', { type: 'atrasados', label: 'Atrasados' })).toBe(true);
    expect(rowPassesFilter(receita as never, 'tudo', { type: 'atrasados', label: 'Atrasados' })).toBe(false);
  });
});

describe('computeResumoAbertos', () => {
  it('soma total/contagem por direção e aponta o maior lançamento em aberto', () => {
    const transactions = [
      makeTransaction({ id: 'a', type: 'despesa', status: 'pendente', amount: 4900, dueDate: '2026-07-30', description: 'Folha de julho' }),
      makeTransaction({ id: 'b', type: 'despesa', status: 'atrasado', amount: 2100, dueDate: '2026-07-01', description: 'Aluguel' }),
      makeTransaction({ id: 'c', type: 'receita', status: 'pendente', amount: 650, dueDate: '2026-08-30', description: 'Consultoria' }),
      makeTransaction({ id: 'd', status: 'pago', type: 'despesa', amount: 999 }), // pago não conta como aberto
    ];
    const overview = computeResumoAbertos(transactions);
    expect(overview.pagar.total).toBe(7000);
    expect(overview.pagar.count).toBe(2);
    expect(overview.pagar.maior?.label).toBe('Folha de julho');
    expect(overview.receber.total).toBe(650);
    expect(overview.receber.count).toBe(1);
  });
});

describe('computeAgingRecebiveis', () => {
  it('separa receitas atrasadas em buckets de 0-15/15-30/30+ dias', () => {
    const transactions = [
      makeTransaction({ id: 'a', type: 'receita', status: 'atrasado', amount: 100, dueDate: '2026-07-10', clientId: 'c1' }), // 5 dias
      makeTransaction({ id: 'b', type: 'receita', status: 'atrasado', amount: 200, dueDate: '2026-06-20', clientId: 'c2' }), // 25 dias
      makeTransaction({ id: 'c', type: 'receita', status: 'atrasado', amount: 300, dueDate: '2026-05-01', clientId: 'c3' }), // 75 dias
    ];
    const overview = computeAgingRecebiveis(transactions, NOW);
    expect(overview.buckets['0-15'].total).toBe(100);
    expect(overview.buckets['15-30'].total).toBe(200);
    expect(overview.buckets['30+'].total).toBe(300);
    expect(overview.over30Total).toBe(300);
    expect(overview.over30ClientCount).toBe(1);
    expect(overview.totalAtrasado).toBe(600);
  });
});

describe('computeResumoPorCategoria', () => {
  it('classifica categoria como fixa quando qualquer transação dela tem recorrência ativa', () => {
    const transactions = [
      makeTransaction({ id: 'a', category: 'Aluguel', amount: 2100, dueDate: '2026-07-05', recurrence: { frequency: 'monthly', nextDueDate: '2026-08-05', isActive: true } }),
      makeTransaction({ id: 'b', category: 'Fornecedores', amount: 1630, dueDate: '2026-07-05' }),
    ];
    const overview = computeResumoPorCategoria(transactions, '2026-07');
    const aluguel = overview.rows.find(r => r.id === 'Aluguel');
    const fornecedores = overview.rows.find(r => r.id === 'Fornecedores');
    expect(aluguel?.isFixed).toBe(true);
    expect(fornecedores?.isFixed).toBe(false);
  });

  it('marca anomalia quando o total do mês supera a média dos 5 meses anteriores em >15% e ≥ R$1000', () => {
    const transactions = [1, 2, 3, 4, 5].map((offset) =>
      makeTransaction({ id: `hist-${offset}`, category: 'Fornecedores', amount: 2000, dueDate: `2026-0${7 - offset}-05` }),
    );
    transactions.push(makeTransaction({ id: 'atual', category: 'Fornecedores', amount: 3100, dueDate: '2026-07-05' }));
    const overview = computeResumoPorCategoria(transactions, '2026-07');
    const row = overview.rows.find(r => r.id === 'Fornecedores');
    expect(row?.isAnomalia).toBe(true);
    expect(overview.topVariacao?.id).toBe('Fornecedores');
  });
});

describe('computeFechamentoMes + computeBridgeCaixaCompetencia', () => {
  it('saldoProjetado soma o saldo atual ao que ainda está em aberto no período', () => {
    const transactions = [
      makeTransaction({ id: 'a', type: 'receita', status: 'pendente', amount: 500, dueDate: '2026-07-20' }),
      makeTransaction({ id: 'b', type: 'despesa', status: 'atrasado', amount: 200, dueDate: '2026-07-01' }),
      makeTransaction({ id: 'c', type: 'despesa', status: 'pendente', amount: 999, dueDate: '2026-08-05' }), // fora do período
    ];
    const fechamento = computeFechamentoMes(transactions, [makeAccount({ balance: 1000 })], '2026-07');
    expect(fechamento.saldoAtual).toBe(1000);
    expect(fechamento.deltaAberto).toBe(300); // +500 -200
    expect(fechamento.saldoProjetado).toBe(1300);
  });

  it('a nota-ponte só aparece quando a diferença competência×caixa é relevante', () => {
    const resultado = computeResultadoDoMes(
      [
        makeTransaction({ id: 'r', type: 'receita', status: 'pendente', amount: 4230, dueDate: '2026-07-10' }),
      ],
      '2026-07',
    );
    const fechamento = computeFechamentoMes(
      [makeTransaction({ id: 'r', type: 'receita', status: 'pendente', amount: 3580, dueDate: '2026-07-10' })],
      [],
      '2026-07',
    );
    const note = computeBridgeCaixaCompetencia(resultado, fechamento);
    expect(note.show).toBe(true);
    expect(note.diffValue).toBeCloseTo(4230 - 3580, 5);
  });
});
