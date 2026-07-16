/**
 * membership-axis.ts — eixo padrão do read-model de Assinaturas: grupo por
 * `Membership` (plano/serviço). Vertical academia/salão/clube — fonte:
 * `ClientMembership` + `Membership`. Gap g1 (`cancelledAt` pode faltar em docs
 * legados cancelados) mitigado com fallback pra `updatedAt` — ver
 * lib/contracts/domain/membership.ts.
 */

import type { ClientMembership, Membership, Transaction } from '@/lib/types';
import { parseYmd, parsePeriod, endOfMonth, startOfMonth, shiftMonth, monthsBetween, todayYmd } from './date-utils';
import { CYCLE_TO_MONTHLY, CYCLE_LABEL, SHORT_MONTH_LABELS, type AssinaturasOverview, type SubscriptionGroup, type SubscriptionMonthPoint, type SubscriptionTableRow, type SubscriptionRowStatus } from './types';

function effectiveEndDate(cm: ClientMembership): Date | null {
  if (cm.status !== 'cancelled' && cm.status !== 'expired') return null;
  return parseYmd(cm.cancelledAt) ?? parseYmd(cm.updatedAt.slice(0, 10));
}

function wasActiveAt(cm: ClientMembership, atDate: Date): boolean {
  const start = parseYmd(cm.startDate);
  if (!start || start > atDate) return false;
  const ended = effectiveEndDate(cm);
  if (ended && ended <= atDate) return false;
  return true;
}

function monthlyValueOf(cm: ClientMembership, plansById: Map<string, Membership>): number {
  const plan = plansById.get(cm.membershipId);
  if (!plan) return 0;
  return plan.price * (CYCLE_TO_MONTHLY[plan.billingCycle] ?? 1);
}

function mrrAt(clientMemberships: ClientMembership[], plansById: Map<string, Membership>, atDate: Date): number {
  let total = 0;
  for (const cm of clientMemberships) {
    if (wasActiveAt(cm, atDate)) total += monthlyValueOf(cm, plansById);
  }
  return total;
}

export function computeMembershipAxis(
  clientMemberships: ClientMembership[],
  memberships: Membership[],
  transactions: Transaction[],
  period: string,
  now: Date,
): AssinaturasOverview {
  const plansById = new Map(memberships.map(m => [m.id, m]));
  const { year, month } = parsePeriod(period);
  const periodEnd = endOfMonth(year, month);
  const periodStart = startOfMonth(year, month);
  const prev = shiftMonth(year, month, -1);
  const prevPeriodEnd = endOfMonth(prev.year, prev.month);

  const mrr = mrrAt(clientMemberships, plansById, periodEnd);
  const prevMrr = mrrAt(clientMemberships, plansById, prevPeriodEnd);
  const mrrDeltaValue = mrr - prevMrr;
  const mrrDeltaPct = prevMrr > 0 ? (mrrDeltaValue / prevMrr) * 100 : 0;

  const mrrSparkline6m: number[] = [];
  for (let i = 5; i >= 0; i--) {
    const p = shiftMonth(year, month, -i);
    mrrSparkline6m.push(mrrAt(clientMemberships, plansById, endOfMonth(p.year, p.month)));
  }

  const churned = clientMemberships.filter(cm => {
    const ended = effectiveEndDate(cm);
    return ended !== null && ended >= periodStart && ended <= periodEnd;
  });
  const novos = clientMemberships.filter(cm => {
    const start = parseYmd(cm.startDate);
    return start !== null && start >= periodStart && start <= periodEnd;
  });

  const activeSet = clientMemberships.filter(cm => wasActiveAt(cm, periodEnd));
  const activeCount = activeSet.length;
  const avgTicket = activeCount > 0 ? mrr / activeCount : 0;

  const byPlan = new Map<string, ClientMembership[]>();
  for (const cm of clientMemberships) {
    const arr = byPlan.get(cm.membershipId) ?? [];
    arr.push(cm);
    byPlan.set(cm.membershipId, arr);
  }

  const groupsRaw = Array.from(byPlan.entries()).map(([membershipId, cms]) => {
    const plan = plansById.get(membershipId);
    const name = plan?.name || cms[0]?.membershipName || 'Plano';
    const activeCms = cms.filter(cm => wasActiveAt(cm, periodEnd));
    const groupMrr = activeCms.reduce((s, cm) => s + monthlyValueOf(cm, plansById), 0);
    const churnedThisMonthCount = cms.filter(cm => {
      const ended = effectiveEndDate(cm);
      return ended !== null && ended >= periodStart && ended <= periodEnd;
    }).length;

    const monthly6m: SubscriptionMonthPoint[] = [];
    for (let i = 5; i >= 0; i--) {
      const p = shiftMonth(year, month, -i);
      const mStart = startOfMonth(p.year, p.month);
      const mEnd = endOfMonth(p.year, p.month);
      let novosVal = 0;
      let churnVal = 0;
      for (const cm of cms) {
        const start = parseYmd(cm.startDate);
        if (start && start >= mStart && start <= mEnd) novosVal += monthlyValueOf(cm, plansById);
        const ended = effectiveEndDate(cm);
        if (ended && ended >= mStart && ended <= mEnd) churnVal += monthlyValueOf(cm, plansById);
      }
      monthly6m.push({ label: SHORT_MONTH_LABELS[p.month - 1], novos: novosVal, churn: churnVal });
    }

    const tenureMonths = cms.map(cm => {
      const start = parseYmd(cm.startDate);
      if (!start) return null;
      const end = effectiveEndDate(cm) ?? periodEnd;
      return monthsBetween(start, end);
    }).filter((v): v is number => v !== null);
    const tempoMedioMeses = tenureMonths.length > 0
      ? Math.round(tenureMonths.reduce((s, v) => s + v, 0) / tenureMonths.length)
      : 0;

    const ticketMedioGrupo = activeCms.length > 0 ? groupMrr / activeCms.length : (plan?.price ?? 0);
    const ltv = tempoMedioMeses * ticketMedioGrupo;

    const cohort12m = cms.filter(cm => {
      const start = parseYmd(cm.startDate);
      return start !== null && monthsBetween(start, periodEnd) >= 12;
    });
    const retencao12mPct = cohort12m.length > 0
      ? (cohort12m.filter(cm => wasActiveAt(cm, periodEnd)).length / cohort12m.length) * 100
      : null;

    return { id: membershipId, name, mrr: groupMrr, activeCount: activeCms.length, churnedThisMonthCount, monthly6m, tempoMedioMeses, ltv, retencao12mPct };
  }).sort((a, b) => b.mrr - a.mrr);

  const groups: SubscriptionGroup[] = groupsRaw.map((g, i) => ({
    ...g,
    pctOfMrr: mrr > 0 ? (g.mrr / mrr) * 100 : 0,
    colorRank: i,
  }));
  const colorRankById = new Map(groups.map(g => [g.id, g.colorRank]));

  const tenureAll = clientMemberships.map(cm => {
    const start = parseYmd(cm.startDate);
    if (!start) return null;
    const end = effectiveEndDate(cm) ?? periodEnd;
    return monthsBetween(start, end);
  }).filter((v): v is number => v !== null);
  const portfolioTempo = tenureAll.length > 0 ? Math.round(tenureAll.reduce((s, v) => s + v, 0) / tenureAll.length) : 0;
  const portfolioCohort = clientMemberships.filter(cm => {
    const start = parseYmd(cm.startDate);
    return start !== null && monthsBetween(start, periodEnd) >= 12;
  });
  const portfolioRetencao = portfolioCohort.length > 0
    ? (portfolioCohort.filter(cm => wasActiveAt(cm, periodEnd)).length / portfolioCohort.length) * 100
    : null;

  const rows: SubscriptionTableRow[] = clientMemberships.map(cm => {
    const plan = plansById.get(cm.membershipId);
    const linked = transactions.filter(t => t.clientMembershipId === cm.id);
    const overdueTx = linked.find(t => t.status === 'atrasado');
    const riskTx = !overdueTx ? linked.find(t => t.status === 'pendente' && t.dueDate && t.dueDate < todayYmd(now)) : undefined;

    let status: SubscriptionRowStatus = 'ativa';
    let overdueDays: number | undefined;
    if (cm.status === 'cancelled' || cm.status === 'expired') {
      status = 'cancelada';
    } else if (overdueTx?.dueDate) {
      status = 'atraso';
      overdueDays = Math.max(0, Math.round((now.getTime() - new Date(`${overdueTx.dueDate}T00:00:00`).getTime()) / 86_400_000));
    } else if (riskTx) {
      status = 'risco';
    }

    return {
      id: cm.id,
      serviceName: plan?.name || cm.membershipName,
      colorRank: colorRankById.get(cm.membershipId) ?? groups.length,
      clientLabel: cm.clientName,
      monthlyValue: monthlyValueOf(cm, plansById),
      cycleLabel: plan ? CYCLE_LABEL[plan.billingCycle] : '—',
      nextBillingLabel: cm.nextBillingDate,
      status,
      overdueDays,
    };
  }).sort((a, b) => {
    if (a.status === 'cancelada' && b.status !== 'cancelada') return 1;
    if (b.status === 'cancelada' && a.status !== 'cancelada') return -1;
    return b.monthlyValue - a.monthlyValue;
  });

  return {
    axis: 'membership',
    mrr,
    mrrSparkline6m,
    mrrDeltaValue,
    mrrDeltaPct,
    churnMonthValue: churned.reduce((s, cm) => s + monthlyValueOf(cm, plansById), 0),
    churnMonthCount: churned.length,
    churnMonthNames: churned.map(cm => cm.clientName).slice(0, 3),
    newMonthValue: novos.reduce((s, cm) => s + monthlyValueOf(cm, plansById), 0),
    newMonthCount: novos.length,
    newMonthNames: novos.map(cm => cm.clientName).slice(0, 3),
    arr: mrr * 12,
    activeCount,
    avgTicket,
    groups,
    portfolio: { tempoMedioMeses: portfolioTempo, ltv: portfolioTempo * avgTicket, retencao12mPct: portfolioRetencao },
    rows,
    cancelledThisMonthCount: churned.length,
  };
}
