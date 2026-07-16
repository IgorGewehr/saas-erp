/**
 * recurrence-projection.ts — matemática de avanço de recorrência (frequência +
 * ajuste de dia útil brasileiro), usada pela Linha do tempo do caixa (30d) e
 * por Disponível-pra-retirada/Vencimentos-próximos pra projetar a PRÓXIMA
 * ocorrência de compromissos recorrentes (aluguel, assinatura de fornecedor
 * etc.) além do que já está gravado como Transaction pendente avulsa.
 *
 * Réplica intencional da mesma matemática do FinancialModule clássico
 * (`computeNextDueDate`/`advanceRecurrence`/`BR_HOLIDAYS`, linhas ~171-240 e
 * ~4119-4142 de app/components/features/financial/FinancialModule.tsx) — o
 * financial-v2 é aditivo e não edita o módulo antigo (CLAUDE.md R-aditivo),
 * então a extração pra `lib/services/financial/recurrence-math.ts` citada no
 * plano fica pra quando os dois módulos puderem importar a mesma fonte sem
 * risco de regressão no clássico.
 */

import type { RecurrenceFrequency, Transaction } from '@/lib/types';
import { parseYmdLocal, toDateStr } from './date-utils';

/**
 * Data efetiva de vencimento de um compromisso. Pra recorrências ativas é
 * SEMPRE `recurrence.nextDueDate` — o `status`/`dueDate` top-level da
 * Transaction reflete só o ÚLTIMO pagamento (fica em 'pago' até o próximo
 * ciclo ser quitado, ver `handleMarkRecurringPaid` no clássico) e nunca deve
 * ser lido como "ainda não venceu". Pra avulsas é o `dueDate` normal.
 */
export function effectiveDueDate(t: Pick<Transaction, 'dueDate' | 'recurrence'>): string | undefined {
  if (t.recurrence?.isActive && t.recurrence.nextDueDate) return t.recurrence.nextDueDate;
  return t.dueDate;
}

/**
 * true quando o compromisso ainda representa dinheiro em aberto. Recorrências
 * ativas são SEMPRE "em aberto" pro próximo ciclo, independente do `status`
 * top-level (que só registra o pagamento mais recente, nunca "falta pagar de
 * novo"); avulsas seguem o status normal (pendente/atrasado).
 */
export function isOpenCommitment(t: Pick<Transaction, 'status' | 'recurrence'>): boolean {
  if (t.status === 'cancelado') return false;
  if (t.recurrence?.isActive) return true;
  return t.status === 'pendente' || t.status === 'atrasado';
}

function easterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

const BR_HOLIDAYS: Set<string> = (() => {
  const set = new Set<string>();
  const addDaysToSet = (base: Date, n: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    set.add(toDateStr(d));
  };
  for (let year = 2025; year <= 2032; year++) {
    const fix = (m: number, day: number) => new Date(year, m - 1, day);
    set.add(toDateStr(fix(1, 1)));
    set.add(toDateStr(fix(4, 21)));
    set.add(toDateStr(fix(5, 1)));
    set.add(toDateStr(fix(9, 7)));
    set.add(toDateStr(fix(10, 12)));
    set.add(toDateStr(fix(11, 2)));
    set.add(toDateStr(fix(11, 15)));
    set.add(toDateStr(fix(11, 20)));
    set.add(toDateStr(fix(12, 25)));
    const easter = easterDate(year);
    addDaysToSet(easter, -48); // Carnaval (segunda)
    addDaysToSet(easter, -47); // Carnaval (terça)
    addDaysToSet(easter, -2); // Sexta-feira Santa
    addDaysToSet(easter, 0); // Páscoa
    addDaysToSet(easter, 60); // Corpus Christi
  }
  return set;
})();

export function adjustForBusinessDay(dateStr: string, adjust: 'none' | 'before' | 'after' | undefined): string {
  if (!adjust || adjust === 'none') return dateStr;
  const d = parseYmdLocal(dateStr);
  const step = adjust === 'before' ? -1 : 1;
  let guard = 0;
  while ((d.getDay() === 0 || d.getDay() === 6 || BR_HOLIDAYS.has(toDateStr(d))) && guard++ < 10) {
    d.setDate(d.getDate() + step);
  }
  return toDateStr(d);
}

/** Avança `dateStr` uma ocorrência da frequência informada (com ajuste de dia útil opcional). */
export function advanceRecurrence(
  dateStr: string,
  frequency: RecurrenceFrequency,
  dayOfMonth?: number,
  secondDayOfMonth?: number,
  holidayAdjust?: 'none' | 'before' | 'after',
): string {
  const d = parseYmdLocal(dateStr);
  const day = dayOfMonth ? Math.min(dayOfMonth, 28) : undefined;
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      if (day) d.setDate(day);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      if (day) d.setDate(day);
      break;
    case 'semiannual':
      d.setMonth(d.getMonth() + 6);
      if (day) d.setDate(day);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      if (day) d.setDate(day);
      break;
    case 'biweekly_fixed': {
      const d1 = day ?? 1;
      const d2 = secondDayOfMonth ? Math.min(secondDayOfMonth, 28) : 15;
      const first = Math.min(d1, d2);
      const second = Math.max(d1, d2);
      const cur = d.getDate();
      if (cur < first) d.setDate(first);
      else if (cur < second) d.setDate(second);
      else {
        d.setMonth(d.getMonth() + 1);
        d.setDate(first);
      }
      break;
    }
  }
  const next = toDateStr(d);
  // Salvaguarda: frequência desconhecida/sem avanço não trava o walker num loop infinito.
  if (next <= dateStr) {
    const fallback = parseYmdLocal(dateStr);
    fallback.setDate(fallback.getDate() + 30);
    return toDateStr(fallback);
  }
  return adjustForBusinessDay(next, holidayAdjust);
}
