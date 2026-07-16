/**
 * fluxo-caixa-especie.ts — read-model da aba Fluxo de Caixa (financeiro v2).
 * FUNÇÃO PURA. FOCO (plano §1.2, e a diretriz que trouxe esta implementação):
 * dinheiro em espécie na gaveta — abertura/fechamento/troco/sangria, sobra ×
 * falta. NÃO é `projecao-caixa.ts` (isso é a projeção de 30 dias da Visão
 * Geral, outro read-model, outro conceito — não confundir os dois "fluxo de
 * caixa").
 *
 * Fonte "em espécie": Transaction `pago` cujo `bankAccountId` aponta pra uma
 * `BankAccount` `accountType === 'caixa'` — ou, na ausência de conta (dado
 * legado), `paymentMethod === 'dinheiro'` sem conta (plano §1.2: "v1 = extrato
 * das contas tipo caixa + movimentos paymentMethod 'dinheiro'").
 *
 * A ponte pro ritual de sessão (`CashSession`, gap g5 do plano): cada sessão
 * "reivindica" as Transactions em espécie da SUA conta cujo `paymentDate` cai
 * no intervalo [dia de abertura, dia de fechamento ou hoje]. Limitação honesta
 * (documentada, não escondida): `Transaction.paymentDate` só tem granularidade
 * de DIA (sem hora) — se a mesma conta tiver 2 sessões no mesmo dia (2
 * turnos), a atribuição por movimento pode se sobrepor entre elas. Isso NÃO
 * afeta os números congelados no fechamento (`expectedAmount`/`countedAmount`/
 * `difference` são gravados no momento do fechamento, nunca recalculados
 * depois) — só a lista de "movimentos desta sessão" no drill de uma sessão já
 * fechada pode incluir um movimento do turno vizinho no caso raro de 2
 * sessões/dia na mesma conta.
 */

import type { BankAccount, Transaction } from '@/lib/types';
import type { CashSession, CashSessionStatus, CashWithdrawal } from '@/lib/contracts/domain/cashSession';
import { PAYMENT_METHOD_LABEL } from './extrato-unificado';
import { startOfDay, toDateStr, monthKeyOf, shiftMonthKey } from './date-utils';

const SPARK_MONTHS = 6;
const SESSION_HISTORY_CAP = 20;

export interface CashMovimento {
  id: string;
  date: string;
  desc: string;
  forma: string;
  accountId: string;
  accountLabel: string;
  valorSigned: number;
}

export interface CashSessionRow {
  id: string;
  accountId: string;
  accountLabel: string;
  status: CashSessionStatus;
  openedAt: string;
  openedByName: string;
  openingAmount: number;
  closedAt?: string;
  closedByName?: string;
  countedAmount?: number;
  /** Congelado no fechamento — undefined enquanto a sessão está aberta. */
  expectedAmount?: number;
  /** Congelado no fechamento (countedAmount − expectedAmount) — undefined enquanto aberta. */
  difference?: number;
  withdrawals: CashWithdrawal[];
  sangriaTotal: number;
  entrouSession: number;
  saiuSession: number;
  /** "Quanto deveria ter agora": live-computado se aberta, igual a expectedAmount se fechada. */
  expectedNow: number;
  movimentos: CashMovimento[];
}

export interface FluxoCaixaOverview {
  caixaAccounts: BankAccount[];
  saldoTotal: number;
  sparkline: number[];
  entrouMes: number;
  entrouCount: number;
  entrouDeltaPct: number | null;
  saiuMes: number;
  saiuCount: number;
  saiuDeltaPct: number | null;
  deltaMes: number;
  deltaMesPct: number | null;
  openSessions: CashSessionRow[];
  /** Sessões fechadas, mais recente primeiro (por closedAt), capado. */
  sessionHistory: CashSessionRow[];
  lastClosed: CashSessionRow | null;
  movimentosPeriodo: CashMovimento[];
}

function isCashRealized(t: Transaction, caixaIds: ReadonlySet<string>): boolean {
  if (t.status !== 'pago') return false;
  if (t.bankAccountId) return caixaIds.has(t.bankAccountId);
  return t.paymentMethod === 'dinheiro';
}

function netAmount(t: Transaction): number {
  return t.type === 'receita' ? t.amount : -t.amount;
}

function pctDelta(curr: number, prev: number): number | null {
  return prev > 0 ? ((curr - prev) / prev) * 100 : null;
}

function toLocalDay(dateTimeStr: string): string {
  return dateTimeStr.length <= 10 ? dateTimeStr : dateTimeStr.slice(0, 10);
}

function toCashMovimento(t: Transaction, accountLabelById: ReadonlyMap<string, string>): CashMovimento {
  const accountId = t.bankAccountId ?? '';
  return {
    id: t.id,
    date: t.paymentDate ?? '',
    desc: t.description,
    forma: t.paymentMethod ? (PAYMENT_METHOD_LABEL[t.paymentMethod] ?? t.paymentMethod) : 'Dinheiro',
    accountId,
    accountLabel: accountId ? (accountLabelById.get(accountId) ?? '—') : 'Dinheiro (sem conta)',
    valorSigned: netAmount(t),
  };
}

/**
 * Movimentos em espécie que caem dentro da janela de uma sessão (mesma conta,
 * `paymentDate` entre o dia de abertura e o dia de fechamento — ou hoje, se
 * ainda aberta). Exportado à parte pra `FecharCaixaDialog` pré-calcular o
 * esperado ANTES de confirmar a contagem, com a mesma matemática usada aqui.
 */
export function computeSessionLive(
  session: CashSession,
  transactions: Transaction[],
  accountLabelById: ReadonlyMap<string, string>,
  now: Date = new Date(),
): { entrou: number; saiu: number; sangriaTotal: number; expected: number; movimentos: CashMovimento[] } {
  const openedDay = toLocalDay(session.openedAt);
  const endDay = session.status === 'fechada' && session.closedAt ? toLocalDay(session.closedAt) : toDateStr(startOfDay(now));

  const movimentos = transactions
    .filter(t => t.status === 'pago' && t.bankAccountId === session.bankAccountId && !!t.paymentDate)
    .filter(t => t.paymentDate! >= openedDay && t.paymentDate! <= endDay)
    .map(t => toCashMovimento(t, accountLabelById))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const entrou = movimentos.filter(m => m.valorSigned > 0).reduce((s, m) => s + m.valorSigned, 0);
  const saiu = movimentos.filter(m => m.valorSigned < 0).reduce((s, m) => s - m.valorSigned, 0);
  // `?? []` defensivo: sessões gravadas fora do fluxo padrão (ex: seed manual)
  // podem não trazer o array — nunca deve estourar o read-model.
  const sangriaTotal = (session.withdrawals ?? []).reduce((s, w) => s + w.amount, 0);
  const expected = session.openingAmount + entrou - saiu - sangriaTotal;

  return { entrou, saiu, sangriaTotal, expected, movimentos };
}

function computeSessionRow(
  session: CashSession,
  transactions: Transaction[],
  accountLabelById: ReadonlyMap<string, string>,
  now: Date,
): CashSessionRow {
  const live = computeSessionLive(session, transactions, accountLabelById, now);
  return {
    id: session.id ?? '',
    accountId: session.bankAccountId,
    accountLabel: accountLabelById.get(session.bankAccountId) ?? 'Conta removida',
    status: session.status,
    openedAt: session.openedAt,
    openedByName: session.openedByName,
    openingAmount: session.openingAmount,
    closedAt: session.closedAt,
    closedByName: session.closedByName,
    countedAmount: session.countedAmount,
    expectedAmount: session.status === 'fechada' ? session.expectedAmount : undefined,
    difference: session.status === 'fechada' ? session.difference : undefined,
    withdrawals: session.withdrawals ?? [],
    sangriaTotal: live.sangriaTotal,
    entrouSession: live.entrou,
    saiuSession: live.saiu,
    expectedNow: session.status === 'fechada' ? (session.expectedAmount ?? live.expected) : live.expected,
    movimentos: live.movimentos,
  };
}

export function computeFluxoCaixaOverview(
  bankAccounts: BankAccount[],
  transactions: Transaction[],
  cashSessions: CashSession[],
  period: string,
  now: Date = new Date(),
): FluxoCaixaOverview {
  const caixaAccounts = bankAccounts.filter(a => a.isActive && a.accountType === 'caixa');
  const caixaIds = new Set(caixaAccounts.map(a => a.id));
  const accountLabelById = new Map(bankAccounts.map(a => [a.id, a.name]));
  const saldoTotal = caixaAccounts.reduce((s, a) => s + a.balance, 0);

  const realizedInPeriod = transactions.filter(t => isCashRealized(t, caixaIds) && monthKeyOf(t.paymentDate) === period);
  const entrou = realizedInPeriod.filter(t => t.type === 'receita');
  const saiu = realizedInPeriod.filter(t => t.type === 'despesa');
  const entrouMes = entrou.reduce((s, t) => s + t.amount, 0);
  const saiuMes = saiu.reduce((s, t) => s + t.amount, 0);

  const prevPeriod = shiftMonthKey(period, -1);
  const realizedPrev = transactions.filter(t => isCashRealized(t, caixaIds) && monthKeyOf(t.paymentDate) === prevPeriod);
  const entrouPrev = realizedPrev.filter(t => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
  const saiuPrev = realizedPrev.filter(t => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);

  const deltaMes = entrouMes - saiuMes;
  const baseAnterior = saldoTotal - deltaMes;

  // Sparkline: mesma reconstrução "de trás pra frente" de saldo-por-conta.ts,
  // ancorada em saldoTotal de hoje — nunca inventa histórico fora do realizado.
  const nowMonthKey = monthKeyOf(toDateStr(startOfDay(now)))!;
  const months6 = Array.from({ length: SPARK_MONTHS }, (_, i) => shiftMonthKey(nowMonthKey, -(SPARK_MONTHS - 1 - i)));
  const netByMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!isCashRealized(t, caixaIds)) continue;
    const mk = monthKeyOf(t.paymentDate);
    if (!mk || !months6.includes(mk)) continue;
    netByMonth.set(mk, (netByMonth.get(mk) ?? 0) + netAmount(t));
  }
  const sparkline: number[] = new Array(SPARK_MONTHS);
  sparkline[SPARK_MONTHS - 1] = saldoTotal;
  let running = saldoTotal;
  for (let i = SPARK_MONTHS - 1; i >= 1; i--) {
    running -= netByMonth.get(months6[i]) ?? 0;
    sparkline[i - 1] = running;
  }

  const movimentosPeriodo = realizedInPeriod
    .map(t => toCashMovimento(t, accountLabelById))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const sessionRows = cashSessions.map(s => computeSessionRow(s, transactions, accountLabelById, now));
  const openSessions = sessionRows
    .filter(s => s.status === 'aberta')
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : a.openedAt > b.openedAt ? -1 : 0));
  const sessionHistory = sessionRows
    .filter(s => s.status === 'fechada')
    .sort((a, b) => ((a.closedAt ?? '') < (b.closedAt ?? '') ? 1 : (a.closedAt ?? '') > (b.closedAt ?? '') ? -1 : 0))
    .slice(0, SESSION_HISTORY_CAP);

  return {
    caixaAccounts,
    saldoTotal,
    sparkline,
    entrouMes,
    entrouCount: entrou.length,
    entrouDeltaPct: pctDelta(entrouMes, entrouPrev),
    saiuMes,
    saiuCount: saiu.length,
    saiuDeltaPct: pctDelta(saiuMes, saiuPrev),
    deltaMes,
    deltaMesPct: baseAnterior > 0 ? (deltaMes / baseAnterior) * 100 : null,
    openSessions,
    sessionHistory,
    lastClosed: sessionHistory[0] ?? null,
    movimentosPeriodo,
  };
}

/** "3h20min" / "2d 4h" / "12min" — usado no card "caixa agora" (aberta há...). */
export function formatOpenDuration(openedAt: string, now: Date = new Date()): string {
  const opened = new Date(openedAt.length <= 10 ? `${openedAt}T00:00:00` : openedAt);
  const ms = Math.max(0, now.getTime() - opened.getTime());
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}min` : ''}`;
  return `${minutes}min`;
}

/** Timestamp local (sem 'Z' — evita o deslocamento de dia do UTC perto da meia-noite, ver date-utils.ts). */
export function nowLocalDateTimeIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
