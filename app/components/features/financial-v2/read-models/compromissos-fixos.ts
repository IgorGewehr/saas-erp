/**
 * compromissos-fixos.ts — read-model da lente "Contas fixas" de Recorrentes
 * (financial-v2/§2.3 `CompromissosFixosMensal` + `HistoricoValorRecorrencia` +
 * `PesoFixoSobreReceita`). FUNÇÃO PURA — zero JSX, zero Firestore, só arrays já
 * carregados pelos hooks de `useFinancialData`.
 *
 * Fonte: `Transaction` com `recurrence.isActive === true` e `type === 'despesa'`
 * (a transação-template já carrega `recurrence.history[]` — o drill de 12 meses
 * está gravado desde sempre, nenhum dado novo precisa existir pra isso funcionar).
 */

import type { Transaction, TransactionRecurrenceEntry } from '@/lib/types';
import { monthKeyOf } from './date-utils';

/** Normaliza qualquer frequência de recorrência pra um fator mensal. */
export const RECURRENCE_FREQ_TO_MONTHLY: Record<string, number> = {
  daily: 30,
  weekly: 4.33,
  biweekly: 2.17,
  biweekly_fixed: 2.17,
  monthly: 1,
  quarterly: 1 / 3,
  semiannual: 1 / 6,
  yearly: 1 / 12,
};

const DEGRAU_THRESHOLD_PCT = 15;

export interface FixedCommitmentRow {
  id: string;
  label: string;
  category?: string;
  frequency: string;
  monthlyAmount: number;
  nextDueDate?: string;
  /** Últimas ocorrências pagas (mais recente por último) — a fonte do drill 12m. */
  history: TransactionRecurrenceEntry[];
  avg12m: number;
  lastPaidAmount: number | null;
  /** true quando a última ocorrência paga superou a média 12m em mais de 15%. */
  isDegrau: boolean;
  degrauPct: number;
}

export interface CompromissosFixosOverview {
  custoDeExistir: number;
  count: number;
  perDiaUtil: number;
  rows: FixedCommitmentRow[];
  maiorCompromisso: FixedCommitmentRow | null;
  /** % das contas fixas sobre a receita média dos últimos 3 meses (null = sem receita paga suficiente pra calcular). */
  pesoSobreReceitaPct: number | null;
  degrauRows: FixedCommitmentRow[];
}

const DIAS_UTEIS_MES = 21;

function monthsAgoKey(date: Date, monthsBack: number): string {
  const d = new Date(date.getFullYear(), date.getMonth() - monthsBack, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function computeRow(t: Transaction): FixedCommitmentRow {
  const frequency = t.recurrence?.frequency ?? 'monthly';
  const monthlyAmount = t.amount * (RECURRENCE_FREQ_TO_MONTHLY[frequency] ?? 1);
  const history = (t.recurrence?.history ?? []).slice(-12);
  const avg12m = history.length > 0 ? history.reduce((s, h) => s + h.amount, 0) / history.length : t.amount;
  const lastPaidAmount = history.length > 0 ? history[history.length - 1].amount : null;
  const degrauPct = lastPaidAmount !== null && avg12m > 0 ? ((lastPaidAmount - avg12m) / avg12m) * 100 : 0;
  const isDegrau = lastPaidAmount !== null && degrauPct > DEGRAU_THRESHOLD_PCT;

  return {
    id: t.id,
    label: t.recurrence?.label || t.description,
    category: t.category,
    frequency,
    monthlyAmount,
    nextDueDate: t.recurrence?.nextDueDate,
    history,
    avg12m,
    lastPaidAmount,
    isDegrau,
    degrauPct,
  };
}

/**
 * Receita média (paga) dos últimos 3 meses fechados — denominador de
 * `PesoFixoSobreReceita`. Usa `paymentDate` (regime caixa, dado real recebido).
 */
function receitaMedia3m(transactions: Transaction[], now: Date): number | null {
  const buckets = new Map<string, number>();
  for (let i = 1; i <= 3; i++) buckets.set(monthsAgoKey(now, i), 0);

  for (const t of transactions) {
    if (t.type !== 'receita' || t.status !== 'pago' || !t.paymentDate) continue;
    const key = monthKeyOf(t.paymentDate);
    if (key && buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + t.amount);
  }

  const values = Array.from(buckets.values());
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  return total / values.length;
}

export function computeCompromissosFixos(transactions: Transaction[], now: Date = new Date()): CompromissosFixosOverview {
  const fixas = transactions.filter(t => t.type === 'despesa' && t.recurrence?.isActive === true);
  const rows = fixas.map(computeRow).sort((a, b) => b.monthlyAmount - a.monthlyAmount);

  const custoDeExistir = rows.reduce((s, r) => s + r.monthlyAmount, 0);
  const receitaMedia = receitaMedia3m(transactions, now);

  return {
    custoDeExistir,
    count: rows.length,
    perDiaUtil: custoDeExistir / DIAS_UTEIS_MES,
    rows,
    maiorCompromisso: rows[0] ?? null,
    pesoSobreReceitaPct: receitaMedia ? (custoDeExistir / receitaMedia) * 100 : null,
    degrauRows: rows.filter(r => r.isDegrau),
  };
}
