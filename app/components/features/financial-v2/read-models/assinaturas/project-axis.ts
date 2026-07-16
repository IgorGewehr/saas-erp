/**
 * project-axis.ts — eixo secundário do read-model de Assinaturas: grupo por
 * `Project` (vertical software house). Sem ciclo de vida de cliente dedicado
 * — usa a transação-template de receita recorrente como "a assinatura" (id,
 * `createdAt` ≈ início, `cancelledAt`/`recurrence.isActive === false` ≈ fim
 * — campos que já existem em `Transaction`, nenhum dado novo precisa existir).
 */

import type { Transaction, Project } from '@/lib/types';
import { RECURRENCE_FREQ_TO_MONTHLY } from '../compromissos-fixos';
import { parseYmd, parsePeriod, endOfMonth, startOfMonth, shiftMonth, monthsBetween } from './date-utils';
import { SHORT_MONTH_LABELS, type AssinaturasOverview, type SubscriptionGroup, type SubscriptionMonthPoint, type SubscriptionTableRow, type SubscriptionRowStatus } from './types';

function monthlyOf(t: Transaction): number {
  return t.amount * (RECURRENCE_FREQ_TO_MONTHLY[t.recurrence?.frequency ?? 'monthly'] ?? 1);
}

function startOf(t: Transaction): Date | null {
  return parseYmd(t.createdAt.slice(0, 10));
}

function endOf(t: Transaction): Date | null {
  if (t.status === 'cancelado') return parseYmd(t.cancelledAt?.slice(0, 10));
  if (t.recurrence?.isActive === false) return parseYmd(t.updatedAt.slice(0, 10));
  return null;
}

function activeAt(t: Transaction, atDate: Date): boolean {
  const s = startOf(t);
  if (!s || s > atDate) return false;
  const e = endOf(t);
  return !(e && e <= atDate);
}

export function computeProjectAxis(transactions: Transaction[], projects: Project[], period: string, now: Date): AssinaturasOverview {
  const projectsById = new Map(projects.map(p => [p.id, p]));
  const { year, month } = parsePeriod(period);
  const periodEnd = endOfMonth(year, month);
  const periodStart = startOfMonth(year, month);
  const prev = shiftMonth(year, month, -1);
  const prevPeriodEnd = endOfMonth(prev.year, prev.month);

  const templates = transactions.filter(t => t.type === 'receita' && t.projectId && (t.recurrence || t.recurrenceId));

  const mrrAtDate = (atDate: Date) => templates.filter(t => activeAt(t, atDate)).reduce((s, t) => s + monthlyOf(t), 0);
  const mrr = mrrAtDate(periodEnd);
  const prevMrr = mrrAtDate(prevPeriodEnd);
  const mrrSparkline6m: number[] = [];
  for (let i = 5; i >= 0; i--) {
    const p = shiftMonth(year, month, -i);
    mrrSparkline6m.push(mrrAtDate(endOfMonth(p.year, p.month)));
  }

  const churned = templates.filter(t => { const e = endOf(t); return e !== null && e >= periodStart && e <= periodEnd; });
  const novos = templates.filter(t => { const s = startOf(t); return s !== null && s >= periodStart && s <= periodEnd; });
  const activeSet = templates.filter(t => activeAt(t, periodEnd));

  const byProject = new Map<string, Transaction[]>();
  for (const t of templates) {
    const arr = byProject.get(t.projectId!) ?? [];
    arr.push(t);
    byProject.set(t.projectId!, arr);
  }

  const groupsRaw = Array.from(byProject.entries()).map(([projectId, txs]) => {
    const name = projectsById.get(projectId)?.name || txs[0]?.projectName || 'Projeto';
    const activeTxs = txs.filter(t => activeAt(t, periodEnd));
    const groupMrr = activeTxs.reduce((s, t) => s + monthlyOf(t), 0);
    const churnedThisMonthCount = txs.filter(t => { const e = endOf(t); return e !== null && e >= periodStart && e <= periodEnd; }).length;

    const monthly6m: SubscriptionMonthPoint[] = [];
    for (let i = 5; i >= 0; i--) {
      const p = shiftMonth(year, month, -i);
      const mStart = startOfMonth(p.year, p.month);
      const mEnd = endOfMonth(p.year, p.month);
      let novosVal = 0, churnVal = 0;
      for (const t of txs) {
        const s = startOf(t);
        if (s && s >= mStart && s <= mEnd) novosVal += monthlyOf(t);
        const e = endOf(t);
        if (e && e >= mStart && e <= mEnd) churnVal += monthlyOf(t);
      }
      monthly6m.push({ label: SHORT_MONTH_LABELS[p.month - 1], novos: novosVal, churn: churnVal });
    }

    const tenure = txs.map(t => { const s = startOf(t); return s ? monthsBetween(s, endOf(t) ?? periodEnd) : null; }).filter((v): v is number => v !== null);
    const tempoMedioMeses = tenure.length > 0 ? Math.round(tenure.reduce((s, v) => s + v, 0) / tenure.length) : 0;
    const ticketMedio = activeTxs.length > 0 ? groupMrr / activeTxs.length : 0;

    return { id: projectId, name, mrr: groupMrr, activeCount: activeTxs.length, churnedThisMonthCount, monthly6m, tempoMedioMeses, ltv: tempoMedioMeses * ticketMedio, retencao12mPct: null as number | null };
  }).sort((a, b) => b.mrr - a.mrr);

  const groups: SubscriptionGroup[] = groupsRaw.map((g, i) => ({ ...g, pctOfMrr: mrr > 0 ? (g.mrr / mrr) * 100 : 0, colorRank: i }));
  const colorRankById = new Map(groups.map(g => [g.id, g.colorRank]));
  const activeCount = activeSet.length;
  const avgTicket = activeCount > 0 ? mrr / activeCount : 0;

  const rows: SubscriptionTableRow[] = templates.map((t): SubscriptionTableRow => {
    const isCancelled = t.status === 'cancelado' || t.recurrence?.isActive === false;
    const status: SubscriptionRowStatus = isCancelled ? 'cancelada' : (t.status === 'atrasado' ? 'atraso' : 'ativa');
    return {
      id: t.id,
      serviceName: projectsById.get(t.projectId!)?.name || t.projectName || 'Projeto',
      colorRank: colorRankById.get(t.projectId!) ?? groups.length,
      clientLabel: t.clientName || t.description,
      monthlyValue: monthlyOf(t),
      cycleLabel: t.recurrence ? (RECURRENCE_FREQ_TO_MONTHLY[t.recurrence.frequency] === 1 ? 'Mensal' : 'Recorrente') : '—',
      nextBillingLabel: t.recurrence?.nextDueDate,
      status,
      overdueDays: t.status === 'atrasado' && t.dueDate ? Math.max(0, Math.round((now.getTime() - new Date(`${t.dueDate}T00:00:00`).getTime()) / 86_400_000)) : undefined,
    };
  }).sort((a, b) => (a.status === 'cancelada' ? 1 : 0) - (b.status === 'cancelada' ? 1 : 0) || b.monthlyValue - a.monthlyValue);

  return {
    axis: 'project',
    mrr,
    mrrSparkline6m,
    mrrDeltaValue: mrr - prevMrr,
    mrrDeltaPct: prevMrr > 0 ? ((mrr - prevMrr) / prevMrr) * 100 : 0,
    churnMonthValue: churned.reduce((s, t) => s + monthlyOf(t), 0),
    churnMonthCount: churned.length,
    churnMonthNames: churned.map(t => t.clientName || t.projectName || t.description).filter((v): v is string => !!v).slice(0, 3),
    newMonthValue: novos.reduce((s, t) => s + monthlyOf(t), 0),
    newMonthCount: novos.length,
    newMonthNames: novos.map(t => t.clientName || t.projectName || t.description).filter((v): v is string => !!v).slice(0, 3),
    arr: mrr * 12,
    activeCount,
    avgTicket,
    groups,
    portfolio: { tempoMedioMeses: 0, ltv: 0, retencao12mPct: null },
    rows,
    cancelledThisMonthCount: churned.length,
  };
}
