/**
 * saldo-por-conta.ts — read-model do bloco "Saldo por conta" da aba Bancário
 * (financial-v2/§2.3 `SaldoPorConta`). FUNÇÃO PURA.
 *
 * FOCO desta aba (plano §1.2): só o que é REALIZADO e passou pelo banco —
 * `Transaction` `pago` com `bankAccountId` de uma conta `accountType !== 'caixa'`
 * (PIX/cartão/TED/boleto; espécie é a aba Fluxo de Caixa, fora de escopo aqui).
 *
 * O saldo em si ainda É o `balance` armazenado (gap g2 do plano) — mas desde a
 * Fase 3 o `BaixaDialog` incrementa esse saldo atomicamente a cada baixa por
 * conta, então o número já reflete o realizado bancário do tenant a partir
 * daquele ponto em diante (não é mais "nunca atualizado").
 *
 * O sparkline do hero não tem histórico de saldo diário gravado — é
 * reconstruído "de trás pra frente", terminando EXATAMENTE no saldo de hoje
 * (a âncora real, nunca inventa números fora do fluxo realizado): saldo de
 * cada um dos últimos 6 meses = saldo de hoje − soma do fluxo líquido
 * realizado dos meses entre aquele ponto e hoje.
 */

import type { BankAccount, Transaction } from '@/lib/types';
import { startOfDay, toDateStr, monthKeyOf, shiftMonthKey } from './date-utils';

const SPARK_MONTHS = 6;

export interface SaldoContaRow {
  id: string;
  name: string;
  bankName: string;
  balance: number;
}

export interface SaldoPorContaOverview {
  rows: SaldoContaRow[];
  total: number;
  entrouMes: number;
  entrouCount: number;
  saiuMes: number;
  saiuCount: number;
  entrouDeltaPct: number | null;
  saiuDeltaPct: number | null;
  /** Fluxo líquido realizado no mês selecionado (entrouMes − saiuMes) — aproxima a variação de saldo. */
  deltaMes: number;
  deltaMesPct: number | null;
  /** Últimos 6 meses (incluindo o atual), terminando em `total` — trend, não KPI. */
  sparkline: number[];
}

function isBankRealized(t: Transaction, nonCaixaIds: ReadonlySet<string>): boolean {
  return t.status === 'pago' && !!t.bankAccountId && nonCaixaIds.has(t.bankAccountId);
}

function netAmount(t: Transaction): number {
  return t.type === 'receita' ? t.amount : -t.amount;
}

function pctDelta(curr: number, prev: number): number | null {
  return prev > 0 ? ((curr - prev) / prev) * 100 : null;
}

export function computeSaldoPorConta(
  bankAccounts: BankAccount[],
  transactions: Transaction[],
  period: string,
  now: Date = new Date(),
): SaldoPorContaOverview {
  const contas = bankAccounts.filter(a => a.isActive && a.accountType !== 'caixa');
  const nonCaixaIds = new Set(contas.map(a => a.id));
  const total = contas.reduce((s, a) => s + a.balance, 0);

  const rows: SaldoContaRow[] = contas
    .slice()
    .sort((a, b) => b.balance - a.balance)
    .map(a => ({ id: a.id, name: a.name, bankName: a.bankName, balance: a.balance }));

  const realizedInPeriod = transactions.filter(t => isBankRealized(t, nonCaixaIds) && monthKeyOf(t.paymentDate) === period);
  const entrou = realizedInPeriod.filter(t => t.type === 'receita');
  const saiu = realizedInPeriod.filter(t => t.type === 'despesa');
  const entrouMes = entrou.reduce((s, t) => s + t.amount, 0);
  const saiuMes = saiu.reduce((s, t) => s + t.amount, 0);

  const prevPeriod = shiftMonthKey(period, -1);
  const realizedPrev = transactions.filter(t => isBankRealized(t, nonCaixaIds) && monthKeyOf(t.paymentDate) === prevPeriod);
  const entrouPrev = realizedPrev.filter(t => t.type === 'receita').reduce((s, t) => s + t.amount, 0);
  const saiuPrev = realizedPrev.filter(t => t.type === 'despesa').reduce((s, t) => s + t.amount, 0);

  const deltaMes = entrouMes - saiuMes;
  const baseAnterior = total - deltaMes;

  // Sparkline: 6 saldos de fim-de-mês reconstruídos a partir de `total` (hoje),
  // sempre ancorados em "agora" — independe do mês selecionado no PeriodSwitcher
  // (é uma tendência decorativa, não um KPI de período).
  const nowMonthKey = monthKeyOf(toDateStr(startOfDay(now)))!;
  const months6 = Array.from({ length: SPARK_MONTHS }, (_, i) => shiftMonthKey(nowMonthKey, -(SPARK_MONTHS - 1 - i)));
  const netByMonth = new Map<string, number>();
  for (const t of transactions) {
    if (!isBankRealized(t, nonCaixaIds)) continue;
    const mk = monthKeyOf(t.paymentDate);
    if (!mk || !months6.includes(mk)) continue;
    netByMonth.set(mk, (netByMonth.get(mk) ?? 0) + netAmount(t));
  }
  const endBalances: number[] = new Array(SPARK_MONTHS);
  endBalances[SPARK_MONTHS - 1] = total;
  let running = total;
  for (let i = SPARK_MONTHS - 1; i >= 1; i--) {
    running -= netByMonth.get(months6[i]) ?? 0;
    endBalances[i - 1] = running;
  }

  return {
    rows,
    total,
    entrouMes,
    entrouCount: entrou.length,
    saiuMes,
    saiuCount: saiu.length,
    entrouDeltaPct: pctDelta(entrouMes, entrouPrev),
    saiuDeltaPct: pctDelta(saiuMes, saiuPrev),
    deltaMes,
    deltaMesPct: baseAnterior > 0 ? (deltaMes / baseAnterior) * 100 : null,
    sparkline: endBalances,
  };
}
