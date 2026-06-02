/**
 * lib/contracts/fsm/transaction.ts — máquina de estados de Transaction (financeiro)
 *
 *  pendente ──► pago      (terminal — liquidada)
 *      │   └──► atrasado ──► pago
 *      │   └──► atrasado ──► cancelado
 *      ├──────► cancelado  (terminal)
 *      └ atrasado é derivado (pendente + dueDate < hoje) mas também é gravável.
 *
 * `atrasado` é, na prática, um `pendente` cuja `dueDate` já passou (ver
 * summaryMonth em app/api/agent/tools/financial/route.ts, que o calcula on-the-fly).
 * Modelamos a transição para o caso em que é persistido. `pago` e `cancelado`
 * são terminais.
 *
 * Estados terminais: pago (liquidada), cancelado (estornada/anulada).
 *
 * TODO(auditoria P3.6/R2): promover o status para um contrato de domínio
 * completo em lib/contracts/domain/transaction.ts (Transaction ainda vive como
 * interface em lib/types/index.ts). Por ora o enum canônico mora aqui para
 * destravar o FSM dos write paths (P1.9). Manter sincronizado com
 * lib/types/index.ts:TransactionStatus.
 */

import { z } from 'zod';

export const TRANSACTION_STATUSES = ['pendente', 'pago', 'atrasado', 'cancelado'] as const;
export const TransactionStatusSchema = z.enum(TRANSACTION_STATUSES);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const TRANSACTION_TRANSITIONS: Record<TransactionStatus, ReadonlySet<TransactionStatus>> = {
  pendente:  new Set<TransactionStatus>(['pago', 'atrasado', 'cancelado']),
  atrasado:  new Set<TransactionStatus>(['pago', 'cancelado', 'pendente']), // pode voltar a pendente se a dueDate for empurrada
  pago:      new Set<TransactionStatus>(['cancelado']), // estorno de pagamento
  cancelado: new Set<TransactionStatus>(), // terminal
};

export function canTransitionTransaction(from: TransactionStatus, to: TransactionStatus): boolean {
  return TRANSACTION_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionTransaction(from: TransactionStatus, to: TransactionStatus): void {
  if (!canTransitionTransaction(from, to)) {
    throw new Error(`Transaction FSM: transição inválida ${from} → ${to}`);
  }
}

/** Side-effects esperados por transição. Documentação para emitir eventos cross-módulo. */
export const TRANSACTION_TRANSITION_EFFECTS: Partial<Record<`${TransactionStatus}->${TransactionStatus}`, string[]>> = {
  'pendente->pago':  ['set paymentDate', 'Reconciliação: marcar conciliado se houver match bancário'],
  'atrasado->pago':  ['set paymentDate'],
  'pendente->cancelado': ['Anulação — sem movimento financeiro real'],
  'pago->cancelado': ['Estorno: reverter saldo/reconciliação; se ligada a Sale/Order, espelhar estorno'],
};

export const TRANSACTION_TERMINAL_STATUSES: ReadonlySet<TransactionStatus> = new Set(['cancelado']);
