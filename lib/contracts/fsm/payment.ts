/**
 * lib/contracts/fsm/payment.ts — máquina de estados do PAGAMENTO (dinheiro).
 *
 *   pending ──► authorized ──► paid ──► refunded (terminal)
 *      │            │            │
 *      │            └──► failed (terminal)
 *      ├──► paid (PIX: aprova direto, sem authorize)
 *      ├──► failed (terminal)
 *      └──► expired (terminal — QR PIX venceu)
 *
 * IMPORTANTE: esta FSM é SEPARADA da FSM de fabricação do pedido
 * (lib/contracts/fsm/deliveryOrder.ts). O dinheiro tem ciclo de vida próprio:
 *  - PIX aprova direto (pending → paid).
 *  - Cartão pode passar por authorized (pré-autorização) antes de paid.
 *  - refunded só a partir de paid (estorno).
 */

import { z } from 'zod';

export const PAYMENT_FSM_STATUSES = [
  'pending', 'authorized', 'paid', 'failed', 'refunded', 'expired',
] as const;
export const PaymentFsmStatusSchema = z.enum(PAYMENT_FSM_STATUSES);
export type PaymentFsmStatus = z.infer<typeof PaymentFsmStatusSchema>;

export const PAYMENT_TRANSITIONS: Record<PaymentFsmStatus, ReadonlySet<PaymentFsmStatus>> = {
  pending:    new Set<PaymentFsmStatus>(['authorized', 'paid', 'failed', 'expired']),
  authorized: new Set<PaymentFsmStatus>(['paid', 'failed']),
  paid:       new Set<PaymentFsmStatus>(['refunded']),
  failed:     new Set<PaymentFsmStatus>(),
  refunded:   new Set<PaymentFsmStatus>(),
  expired:    new Set<PaymentFsmStatus>(),
};

export function canTransitionPayment(from: PaymentFsmStatus, to: PaymentFsmStatus): boolean {
  return PAYMENT_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionPayment(from: PaymentFsmStatus, to: PaymentFsmStatus): void {
  if (!canTransitionPayment(from, to)) {
    throw new Error(`Payment FSM: transição inválida ${from} → ${to}`);
  }
}

export const PAYMENT_TERMINAL_STATUSES: ReadonlySet<PaymentFsmStatus> = new Set([
  'failed', 'refunded', 'expired',
]);

/** Side-effects esperados por transição (documentação, não execução). */
export const PAYMENT_TRANSITION_EFFECTS: Partial<Record<`${PaymentFsmStatus}->${PaymentFsmStatus}`, string[]>> = {
  'pending->paid': [
    'Emitir evento payment.approved',
    'DeliveryOrder.paymentStatus = pago + set paidAt',
  ],
  'authorized->paid': [
    'Emitir evento payment.approved (captura do cartão)',
  ],
  'pending->expired': ['QR PIX venceu — UI pode reoferecer cobrança'],
  'pending->failed': ['Cartão recusado — UI reoferece método'],
  'paid->refunded': [
    'Emitir evento payment.refunded',
    'Restaura estoque + estorna Transaction',
  ],
};
