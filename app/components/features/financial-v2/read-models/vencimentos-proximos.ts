/**
 * vencimentos-proximos.ts — read-model do bloco ④ do santo-graal ("Próximos 7
 * dias"), financial-v2/§2.3 `VencimentosProximos(7d)`. FUNÇÃO PURA.
 *
 * Mistura pendentes/atrasados avulsos (por dueDate) com recorrências ativas
 * (pelo nextDueDate real, não pelo dueDate estático do template — mesma
 * lógica do clássico) dentro dos próximos 7 dias.
 */

import type { Transaction } from '@/lib/types';
import { isOpenCommitment } from './recurrence-projection';
import { startOfDay, toDateStr, addDays, weekdayDayLabel } from './date-utils';

const HORIZON_DAYS = 7;
const MAX_ITEMS = 5;

export interface VencimentoProximo {
  id: string;
  date: string;
  dayLabel: string;
  /** Assinado: positivo = receita a receber, negativo = despesa a pagar. */
  amountSigned: number;
  label: string;
  tone: 'pos' | 'crit';
}

function toItem(t: Transaction, date: string): VencimentoProximo {
  const amountSigned = t.type === 'despesa' ? -t.amount : t.amount;
  return {
    id: t.id,
    date,
    dayLabel: weekdayDayLabel(date),
    amountSigned,
    label: t.recurrence?.label || t.description,
    tone: amountSigned >= 0 ? 'pos' : 'crit',
  };
}

export function computeVencimentosProximos(transactions: Transaction[], now: Date = new Date()): VencimentoProximo[] {
  const todayStr = toDateStr(startOfDay(now));
  const horizonStr = toDateStr(addDays(startOfDay(now), HORIZON_DAYS));

  const items: VencimentoProximo[] = [];

  for (const t of transactions) {
    if (!isOpenCommitment(t)) continue;

    if (t.recurrence?.isActive && t.recurrence.nextDueDate) {
      const date = t.recurrence.nextDueDate;
      if (date >= todayStr && date <= horizonStr) items.push(toItem(t, date));
      continue;
    }

    if (t.dueDate && t.dueDate >= todayStr && t.dueDate <= horizonStr) items.push(toItem(t, t.dueDate));
  }

  return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_ITEMS);
}
