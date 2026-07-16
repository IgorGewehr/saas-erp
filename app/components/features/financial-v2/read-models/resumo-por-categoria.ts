/**
 * resumo-por-categoria.ts — read-model do grid2 "Para onde foi o dinheiro ⇄
 * Raio-X do mês" de Entradas & Saídas (financial-v2/§2.3 `ResumoPorCategoria`).
 * FUNÇÃO PURA — zero JSX, zero Firestore.
 *
 * Fonte: `Transaction` tipo despesa, não-cancelada, agrupada por `category`.
 * Cada categoria acumula 6 baldes mensais (o mês corrente + 5 anteriores),
 * por `dueDate` (avulsa) — proxy de competência, gap g3 do plano — ou pelas
 * duas fontes de uma recorrência ativa: `recurrence.history[]` (ocorrências já
 * pagas, por `dueDate` da ocorrência) e `recurrence.nextDueDate` (a ocorrência
 * corrente ainda em aberto, se cair dentro da janela de 6 meses). As duas
 * nunca se sobrepõem: `nextDueDate` sempre aponta pro ciclo seguinte ao do
 * último `history` gravado.
 *
 * `isFixed` por categoria é heurístico (gap g4 do plano, contrato de mapeamento
 * categoria→DRE fica pra Relatórios): categoria vira "fixa" se QUALQUER
 * transação dela tiver `recurrence.isActive === true` — é exatamente o padrão
 * do mockup (Folha/Aluguel/Software fixos; Fornecedores/Impostos/Marketing
 * variáveis, porque nenhum tem template recorrente ativo).
 *
 * `avg5mBefore`/`variacaoPct`/`isAnomalia` replicam a matemática literal do
 * mockup aprovado (`avg5()`/`variacao()`/`isAnomalia()` em
 * scratchpad/mockups/entradas-saidas.html) — média dos 5 meses ANTES do
 * corrente, não 3 (a descrição solta do plano §5 ("categoria-subiu >25% vs
 * média 3m") é sobre a REGRA DO CONSULTOR, que usa limiar próprio e mais
 * conservador; ver `pickEntradasSaidasInsight` em consultor-rules.ts).
 */

import type { Transaction } from '@/lib/types';
import { monthKeyOf, shiftMonthKey, shortMonthLabel } from './date-utils';

const MONTHS_WINDOW = 6;
const ANOMALY_MIN_ABS = 1000;
const ANOMALY_THRESHOLD_PCT = 15;
const SEM_CATEGORIA = 'Sem categoria';

export interface CategoriaResumoRow {
  id: string;
  label: string;
  colorRank: number;
  total: number;
  isFixed: boolean;
  hist6m: number[];
  monthLabels: string[];
  avg5mBefore: number;
  variacaoPct: number;
  isAnomalia: boolean;
  maiorLancamento: { description: string; amount: number } | null;
}

export interface ResumoPorCategoriaOverview {
  period: string;
  rows: CategoriaResumoRow[];
  totalDespesas: number;
  fixoTotal: number;
  fixoPct: number | null;
  varPct: number | null;
  topVariacao: CategoriaResumoRow | null;
}

interface Occurrence {
  category: string;
  monthKey: string;
  amount: number;
  label: string;
  isFixedSource: boolean;
}

function collectOccurrences(transactions: Transaction[]): Occurrence[] {
  const out: Occurrence[] = [];
  for (const t of transactions) {
    if (t.type !== 'despesa' || t.status === 'cancelado') continue;
    const category = t.category?.trim() || SEM_CATEGORIA;
    const isFixedSource = !!t.recurrence?.isActive;

    if (t.recurrence) {
      for (const h of t.recurrence.history ?? []) {
        const mk = monthKeyOf(h.dueDate);
        if (mk) out.push({ category, monthKey: mk, amount: h.amount, label: t.recurrence.label || t.description, isFixedSource });
      }
      if (t.recurrence.isActive && t.recurrence.nextDueDate) {
        const mk = monthKeyOf(t.recurrence.nextDueDate);
        if (mk) out.push({ category, monthKey: mk, amount: t.amount, label: t.recurrence.label || t.description, isFixedSource });
      }
    } else {
      const mk = monthKeyOf(t.dueDate);
      if (mk) out.push({ category, monthKey: mk, amount: t.amount, label: t.description, isFixedSource });
    }
  }
  return out;
}

export function computeResumoPorCategoria(transactions: Transaction[], period: string): ResumoPorCategoriaOverview {
  const monthKeys = Array.from({ length: MONTHS_WINDOW }, (_, i) => shiftMonthKey(period, i - (MONTHS_WINDOW - 1)));
  const monthLabels = monthKeys.map(shortMonthLabel);
  const occurrences = collectOccurrences(transactions);

  const categories = Array.from(new Set(occurrences.map(o => o.category)));
  const rows: CategoriaResumoRow[] = categories.map(category => {
    const own = occurrences.filter(o => o.category === category);
    const hist6m = monthKeys.map(mk => own.filter(o => o.monthKey === mk).reduce((s, o) => s + o.amount, 0));
    const total = hist6m[MONTHS_WINDOW - 1];
    const before = hist6m.slice(0, MONTHS_WINDOW - 1);
    const avg5mBefore = before.reduce((s, v) => s + v, 0) / before.length;
    const variacaoPct = avg5mBefore > 0 ? ((total - avg5mBefore) / avg5mBefore) * 100 : (total > 0 ? 100 : 0);
    const isAnomalia = total >= ANOMALY_MIN_ABS && variacaoPct > ANOMALY_THRESHOLD_PCT;
    const isFixed = own.some(o => o.isFixedSource);

    const thisMonth = own.filter(o => o.monthKey === period);
    const maior = thisMonth.reduce<{ description: string; amount: number } | null>((max, o) => {
      if (!max || o.amount > max.amount) return { description: o.label, amount: o.amount };
      return max;
    }, null);

    return {
      id: category,
      label: category,
      colorRank: 0, // atribuído depois de ordenar por total (rank categórico do BarsIndex)
      total,
      isFixed,
      hist6m,
      monthLabels,
      avg5mBefore,
      variacaoPct,
      isAnomalia,
      maiorLancamento: maior,
    };
  });

  rows.sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => { r.colorRank = i; });

  const totalDespesas = rows.reduce((s, r) => s + r.total, 0);
  const fixoTotal = rows.filter(r => r.isFixed).reduce((s, r) => s + r.total, 0);
  const varTotal = totalDespesas - fixoTotal;

  const topVariacao = rows
    .filter(r => r.total >= ANOMALY_MIN_ABS)
    .reduce<CategoriaResumoRow | null>((leader, r) => (!leader || r.variacaoPct > leader.variacaoPct ? r : leader), null);

  return {
    period,
    rows,
    totalDespesas,
    fixoTotal,
    fixoPct: totalDespesas > 0 ? (fixoTotal / totalDespesas) * 100 : null,
    varPct: totalDespesas > 0 ? (varTotal / totalDespesas) * 100 : null,
    topVariacao,
  };
}
