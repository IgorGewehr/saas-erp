/**
 * resultado-do-mes.ts — read-model do bloco ③ do santo-graal ("Lucro do
 * mês"), financial-v2/§2.3 `ResultadoDoMes`. FUNÇÃO PURA.
 *
 * Regime de competência (dueDate, pago ou não — só exclui cancelado), fiel ao
 * plano. `receitaPendenteTotal` alimenta a frase-ponte "lucro é maior que o
 * disponível porque X ainda está pra receber" (Refinamento D.4).
 */

import type { Transaction } from '@/lib/types';

export interface ResultadoDoMesOverview {
  period: string;
  receitaTotal: number;
  despesaTotal: number;
  lucro: number;
  /** null quando não há receita no período (divisão por zero evitada). */
  margemPct: number | null;
  deltaValue: number;
  /** null quando o mês anterior não teve lucro de referência (evita % absurda). */
  deltaPct: number | null;
  /** Receita do mês ainda pendente/atrasada — "ainda está pra receber". */
  receitaPendenteTotal: number;
}

function inPeriod(dateStr: string | undefined, year: number, month: number): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
  return d.getFullYear() === year && d.getMonth() + 1 === month;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function sumPeriod(transactions: Transaction[], year: number, month: number): { receita: number; despesa: number } {
  let receita = 0;
  let despesa = 0;
  for (const t of transactions) {
    if (t.status === 'cancelado' || !inPeriod(t.dueDate, year, month)) continue;
    if (t.type === 'receita') receita += t.amount;
    else despesa += t.amount;
  }
  return { receita, despesa };
}

export function computeResultadoDoMes(transactions: Transaction[], period: string): ResultadoDoMesOverview {
  const [year, month] = period.split('-').map(Number);
  const atual = sumPeriod(transactions, year, month);
  const anterior = shiftMonth(year, month, -1);
  const mesAnterior = sumPeriod(transactions, anterior.year, anterior.month);

  const lucro = atual.receita - atual.despesa;
  const lucroAnterior = mesAnterior.receita - mesAnterior.despesa;
  const deltaValue = lucro - lucroAnterior;
  const deltaPct = lucroAnterior !== 0 ? (deltaValue / Math.abs(lucroAnterior)) * 100 : null;

  const receitaPendenteTotal = transactions
    .filter(t => t.type === 'receita' && (t.status === 'pendente' || t.status === 'atrasado') && inPeriod(t.dueDate, year, month))
    .reduce((s, t) => s + t.amount, 0);

  return {
    period,
    receitaTotal: atual.receita,
    despesaTotal: atual.despesa,
    lucro,
    margemPct: atual.receita > 0 ? (lucro / atual.receita) * 100 : null,
    deltaValue,
    deltaPct,
    receitaPendenteTotal,
  };
}
