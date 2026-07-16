/**
 * resumo-abertos.ts — KPIs ① "A receber em aberto" e ② "A pagar em aberto" de
 * Entradas & Saídas (mockup entradas-saidas.html). FUNÇÃO PURA.
 *
 * "Em aberto" usa o MESMO critério do extrato unificado e da Visão Geral —
 * `isOpenCommitment`/`effectiveDueDate` (avulsa pendente/atrasada, ou a
 * ocorrência corrente de uma recorrência ativa) — nunca duplica a lógica.
 * `maior` alimenta o texto "maior: Folha · 30/07" do KPI de "a pagar".
 */

import type { Transaction } from '@/lib/types';
import { effectiveDueDate, isOpenCommitment } from './recurrence-projection';

export interface MaiorAberto {
  label: string;
  date: string;
  amount: number;
}

export interface AbertoDirectionSummary {
  total: number;
  count: number;
  maior: MaiorAberto | null;
}

export interface ResumoAbertosOverview {
  receber: AbertoDirectionSummary;
  pagar: AbertoDirectionSummary;
}

function summarize(transactions: Transaction[], type: 'receita' | 'despesa'): AbertoDirectionSummary {
  let total = 0;
  let count = 0;
  let maior: MaiorAberto | null = null;

  for (const t of transactions) {
    if (t.type !== type || !isOpenCommitment(t)) continue;
    const date = effectiveDueDate(t);
    if (!date) continue;

    total += t.amount;
    count += 1;
    if (!maior || t.amount > maior.amount) {
      maior = { label: t.recurrence?.label || t.description, date, amount: t.amount };
    }
  }

  return { total, count, maior };
}

export function computeResumoAbertos(transactions: Transaction[]): ResumoAbertosOverview {
  return {
    receber: summarize(transactions, 'receita'),
    pagar: summarize(transactions, 'despesa'),
  };
}
