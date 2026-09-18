/**
 * lib/utils/installments.ts
 *
 * Parcelamento de recebíveis de pedido B2B — puro (sem firebase-admin), pra ser
 * usado tanto pelo servidor (lib/services/order-transition-admin.ts, que gera
 * as Transactions ao faturar) quanto pela prévia de cronograma da Vitrine no
 * client. Extraído de order-transition-admin.ts pra que a prévia mostre
 * EXATAMENTE o que o servidor vai gravar (mesmo split, mesmos vencimentos).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Intervalo fixo entre parcelas — `paymentTerms` é texto livre, não um
 *  cronograma parseável (simplificação deliberada do M02.6). */
export const INSTALLMENT_INTERVAL_DAYS = 30;

/** Divide `total` em `n` parcelas (reais), a última absorve o resto do arredondamento. */
export function splitInstallments(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 100) / 100;
  const amounts = Array.from({ length: n }, () => base);
  const roundedSum = Math.round(base * n * 100) / 100;
  amounts[n - 1] = Math.round((amounts[n - 1] + (total - roundedSum)) * 100) / 100;
  return amounts;
}

/** Vencimento (YYYY-MM-DD, UTC) da parcela de índice `index` (0-based): agora + index*30 dias. */
export function installmentDueDate(now: Date, index: number): string {
  return new Date(now.getTime() + index * INSTALLMENT_INTERVAL_DAYS * DAY_MS).toISOString().split('T')[0];
}

export interface InstallmentScheduleEntry {
  /** 1-based. */
  number: number;
  amount: number;
  dueDate: string;
}

export function buildInstallmentSchedule(total: number, installments: number, now: Date): InstallmentScheduleEntry[] {
  const n = Math.max(1, Math.floor(installments));
  return splitInstallments(total, n).map((amount, index) => ({
    number: index + 1,
    amount,
    dueDate: installmentDueDate(now, index),
  }));
}
