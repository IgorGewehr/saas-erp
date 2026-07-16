/**
 * types.ts — formas de saída do read-model de Assinaturas (financial-v2/§2.3,
 * `AssinaturasOverview`). Views derivadas puras — nunca coleção gravada.
 */

import type { MembershipBillingCycle } from '@/lib/types';

export type SubscriptionAxis = 'membership' | 'project';
export type SubscriptionRowStatus = 'ativa' | 'risco' | 'atraso' | 'cancelada';

export const CYCLE_TO_MONTHLY: Record<MembershipBillingCycle, number> = {
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

export const CYCLE_LABEL: Record<MembershipBillingCycle, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  yearly: 'Anual',
};

export const SHORT_MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export interface SubscriptionMonthPoint {
  label: string;
  novos: number;
  churn: number;
}

export interface SubscriptionGroup {
  id: string;
  name: string;
  mrr: number;
  pctOfMrr: number;
  activeCount: number;
  churnedThisMonthCount: number;
  colorRank: number;
  monthly6m: SubscriptionMonthPoint[];
  tempoMedioMeses: number;
  ltv: number;
  /** null = sem cohort com 12 meses de casa ainda pra medir. */
  retencao12mPct: number | null;
}

export interface SubscriptionTableRow {
  id: string;
  serviceName: string;
  colorRank: number;
  clientLabel: string;
  monthlyValue: number;
  cycleLabel: string;
  nextBillingLabel?: string;
  status: SubscriptionRowStatus;
  overdueDays?: number;
}

export interface AssinaturasOverview {
  axis: SubscriptionAxis;
  mrr: number;
  mrrSparkline6m: number[];
  mrrDeltaValue: number;
  mrrDeltaPct: number;
  churnMonthValue: number;
  churnMonthCount: number;
  churnMonthNames: string[];
  newMonthValue: number;
  newMonthCount: number;
  newMonthNames: string[];
  arr: number;
  activeCount: number;
  avgTicket: number;
  groups: SubscriptionGroup[];
  portfolio: { tempoMedioMeses: number; ltv: number; retencao12mPct: number | null };
  rows: SubscriptionTableRow[];
  cancelledThisMonthCount: number;
}
