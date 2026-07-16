/**
 * projecao-caixa.ts — read-model do bloco ② do santo-graal ("O caixa nos
 * próximos 30 dias"), financial-v2/§2.3 `ProjecaoCaixaDiaria`. FUNÇÃO PURA.
 *
 * Reconstrói 15 dias de PASSADO real (o que de fato entrou/saiu, via
 * Transaction `pago`/`recurrence.history[]`) terminando no saldo bancário
 * real de hoje, e projeta 14 dias de FUTURO (pendentes/atrasados por dueDate
 * + recorrências ativas caminhadas por `advanceRecurrence`) — 30 pontos no
 * total, com o índice de hoje marcado. `crossZeroIndex` aponta o primeiro dia
 * (a partir de hoje) em que o saldo projetado fica negativo.
 */

import type { Transaction, BankAccount } from '@/lib/types';
import { advanceRecurrence } from './recurrence-projection';
import { startOfDay, toDateStr, addDays, shortDayLabel } from './date-utils';

const DAYS_BACK = 15;
const DAYS_FORWARD = 14;

export interface CashTimelineEvent {
  label: string;
  /** Assinado: positivo = entrada, negativo = saída. */
  delta: number;
  tone: 'pos' | 'crit';
}

export interface CashTimelinePoint {
  date: string;
  dayLabel: string;
  balance: number;
  isToday: boolean;
  /** true para os dias já "fechados" (hoje incluso) — realizado, linha sólida. */
  isPast: boolean;
  /** Maior movimento do dia (por módulo), pra tooltip — null se não houve nada relevante. */
  event: CashTimelineEvent | null;
}

export interface ProjecaoCaixaOverview {
  points: CashTimelinePoint[];
  todayIndex: number;
  crossZeroIndex: number | null;
  crossZeroDate: string | null;
  crossZeroBalance: number | null;
}

function addEvent(map: Map<string, CashTimelineEvent>, dateStr: string, delta: number, label: string) {
  const existing = map.get(dateStr);
  if (!existing || Math.abs(delta) > Math.abs(existing.delta)) {
    map.set(dateStr, { label, delta, tone: delta >= 0 ? 'pos' : 'crit' });
  }
}

function addNet(map: Map<string, number>, dateStr: string, delta: number) {
  map.set(dateStr, (map.get(dateStr) ?? 0) + delta);
}

export function computeProjecaoCaixa(
  transactions: Transaction[],
  bankAccounts: BankAccount[],
  now: Date = new Date(),
): ProjecaoCaixaOverview {
  const today = startOfDay(now);
  const todayStr = toDateStr(today);
  const dates = Array.from({ length: DAYS_BACK + 1 + DAYS_FORWARD }, (_, i) => addDays(today, i - DAYS_BACK));
  const dateStrs = dates.map(toDateStr);
  const todayIndex = DAYS_BACK;
  const minDate = dateStrs[0];
  const maxDate = dateStrs[dateStrs.length - 1];
  const tomorrowStr = dateStrs[Math.min(todayIndex + 1, dateStrs.length - 1)];

  const pastNet = new Map<string, number>();
  const futureNet = new Map<string, number>();
  const events = new Map<string, CashTimelineEvent>();

  for (const t of transactions) {
    if (t.status === 'cancelado') continue;
    const label = t.recurrence?.label || t.description;

    if (t.recurrence?.isActive) {
      // Passado real: cada ocorrência já paga fica arquivada em history[].
      for (const h of t.recurrence.history ?? []) {
        if (h.paidDate && h.paidDate >= minDate && h.paidDate <= todayStr) {
          const delta = t.type === 'despesa' ? -h.amount : h.amount;
          addNet(pastNet, h.paidDate, delta);
          addEvent(events, h.paidDate, delta, label);
        }
      }
      // Futuro projetado: caminha a partir de nextDueDate. Se já estiver
      // atrasada (nextDueDate no passado), a ocorrência presa vira "amanhã"
      // (o saldo de hoje é o snapshot real e não pode ser reescrito por ela).
      if (t.recurrence.nextDueDate) {
        let next = t.recurrence.nextDueDate;
        let guard = 0;
        while (next <= maxDate && guard++ < 60) {
          const bucketDate = next > todayStr ? next : tomorrowStr;
          if (bucketDate <= maxDate) {
            const delta = t.type === 'despesa' ? -t.amount : t.amount;
            addNet(futureNet, bucketDate, delta);
            addEvent(events, bucketDate, delta, label);
          }
          next = advanceRecurrence(next, t.recurrence.frequency, t.recurrence.dayOfMonth, t.recurrence.secondDayOfMonth, t.recurrence.holidayAdjust);
        }
      }
      continue;
    }

    if (t.status === 'pago' && t.paymentDate && t.paymentDate >= minDate && t.paymentDate <= todayStr) {
      const delta = t.type === 'despesa' ? -t.amount : t.amount;
      addNet(pastNet, t.paymentDate, delta);
      addEvent(events, t.paymentDate, delta, label);
    } else if ((t.status === 'pendente' || t.status === 'atrasado') && t.dueDate && t.dueDate <= maxDate) {
      // Atrasado (dueDate <= hoje) é tratado como resolução assumida amanhã —
      // o saldo de hoje é o real e não recua por uma dívida ainda em aberto.
      const bucketDate = t.dueDate > todayStr ? t.dueDate : tomorrowStr;
      const delta = t.type === 'despesa' ? -t.amount : t.amount;
      addNet(futureNet, bucketDate, delta);
      addEvent(events, bucketDate, delta, label);
    }
  }

  const todayBalance = bankAccounts.filter(a => a.isActive).reduce((s, a) => s + a.balance, 0);
  const balances = new Array<number>(dateStrs.length);
  balances[todayIndex] = todayBalance;
  for (let i = todayIndex - 1; i >= 0; i--) {
    balances[i] = balances[i + 1] - (pastNet.get(dateStrs[i + 1]) ?? 0);
  }
  for (let i = todayIndex + 1; i < dateStrs.length; i++) {
    balances[i] = balances[i - 1] + (futureNet.get(dateStrs[i]) ?? 0);
  }

  let crossZeroIndex: number | null = null;
  if (balances[todayIndex] < 0) {
    crossZeroIndex = todayIndex;
  } else {
    for (let i = todayIndex; i < balances.length - 1; i++) {
      if (balances[i] >= 0 && balances[i + 1] < 0) {
        crossZeroIndex = i + 1;
        break;
      }
    }
  }

  const points: CashTimelinePoint[] = dateStrs.map((date, i) => ({
    date,
    dayLabel: shortDayLabel(date),
    balance: balances[i],
    isToday: i === todayIndex,
    isPast: i <= todayIndex,
    event: events.get(date) ?? null,
  }));

  return {
    points,
    todayIndex,
    crossZeroIndex,
    crossZeroDate: crossZeroIndex !== null ? dateStrs[crossZeroIndex] : null,
    crossZeroBalance: crossZeroIndex !== null ? balances[crossZeroIndex] : null,
  };
}
