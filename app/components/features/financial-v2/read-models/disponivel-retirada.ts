/**
 * disponivel-retirada.ts — read-model do bloco ① do santo-graal ("Você pode
 * tirar até"), financial-v2/§2.3 `DisponivelParaRetirada`. FUNÇÃO PURA.
 *
 * Fórmula (plano §1.2): saldo em banco+gaveta − despesas com dono nos
 * próximos 15 dias (inclui recorrências projetadas e o que já está atrasado)
 * − imposto (DAS) pendente no mesmo horizonte − colchão mínimo configurado.
 */

import type { Transaction, BankAccount, DasRecord } from '@/lib/types';
import { advanceRecurrence, isOpenCommitment } from './recurrence-projection';
import { startOfDay, toDateStr, addDays } from './date-utils';

const HORIZON_DAYS = 15;

export interface DisponivelRetiradaOverview {
  saldoBancario: number;
  /** Despesas pendentes/atrasadas com dono nos próximos 15 dias (sem o imposto — ver `impostoReservado`). */
  despesas15d: number;
  /** DAS pendente com vencimento nos próximos 15 dias — já embutido em `compromissos15d`. */
  impostoReservado: number;
  /** despesas15d + impostoReservado — o "já tem dono" da decomposição. */
  compromissos15d: number;
  colchao: number;
  /** saldoBancario − compromissos15d − colchao. Pode ficar negativo (sinal de alerta real). */
  livre: number;
}

export function computeDisponivelRetirada(
  transactions: Transaction[],
  bankAccounts: BankAccount[],
  dasRecords: DasRecord[],
  cushionAmount: number,
  now: Date = new Date(),
): DisponivelRetiradaOverview {
  const horizonStr = toDateStr(addDays(startOfDay(now), HORIZON_DAYS));

  const saldoBancario = bankAccounts.filter(a => a.isActive).reduce((s, a) => s + a.balance, 0);

  let despesas15d = 0;
  for (const t of transactions) {
    if (t.type !== 'despesa' || !isOpenCommitment(t)) continue;

    if (t.recurrence?.isActive && t.recurrence.nextDueDate) {
      let next = t.recurrence.nextDueDate;
      let guard = 0;
      // Conta toda ocorrência (já vencida ou dentro do horizonte) até o limite —
      // uma recorrência já atrasada tem só 1 nextDueDate "preso" no passado, então
      // isso nunca infla o valor com múltiplas ocorrências fantasmas.
      while (next <= horizonStr && guard++ < 30) {
        despesas15d += t.amount;
        next = advanceRecurrence(next, t.recurrence.frequency, t.recurrence.dayOfMonth, t.recurrence.secondDayOfMonth, t.recurrence.holidayAdjust);
      }
      continue;
    }

    if (!t.dueDate) continue;
    // Atrasado (dueDate no passado) sempre conta cheio; pendente só se cair no horizonte.
    if (t.dueDate <= horizonStr) despesas15d += t.amount;
  }

  const impostoReservado = dasRecords
    .filter(d => d.status !== 'pago' && d.vencimento && d.vencimento <= horizonStr)
    .reduce((s, d) => s + d.valorDas, 0);

  const compromissos15d = despesas15d + impostoReservado;
  const livre = saldoBancario - compromissos15d - cushionAmount;

  return { saldoBancario, despesas15d, impostoReservado, compromissos15d, colchao: cushionAmount, livre };
}
