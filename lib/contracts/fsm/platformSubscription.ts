/**
 * lib/contracts/fsm/platformSubscription.ts — máquina de estados de
 * PlatformSubscription (M12 — cobrança da própria plataforma SaaS aos donos
 * de tenant, via Mercado Pago).
 *
 *  pending_payment ──────────────► active
 *    │                               │ ⇄
 *    └──────────────► cancelled      overdue
 *                          ▲            │
 *                          └────────────┘
 *
 * Regras:
 *  - `pending_payment` → checkout gerado (init_point), aguardando o dono do
 *    tenant completar o pagamento no MP. Pode ser abandonado (→ cancelled).
 *  - `active`   → assinatura em dia. Nenhum enforcement aplicado hoje (M12
 *    v1, decisão do usuário) — só o dashboard reflete o status.
 *  - `overdue`  → passou de nextBillingDate sem pagamento confirmado (cron
 *    diário detecta). Pode voltar a `active` quando um pagamento assentar.
 *  - `cancelled`→ terminal. Assinatura MP cancelada (pelo operador ou pelo
 *    próprio MP).
 *
 * Estados terminais: cancelled.
 */

import { z } from 'zod';

export const PLATFORM_SUBSCRIPTION_STATUSES = ['pending_payment', 'active', 'overdue', 'cancelled'] as const;
export const PlatformSubscriptionStatusSchema = z.enum(PLATFORM_SUBSCRIPTION_STATUSES);
export type PlatformSubscriptionStatus = z.infer<typeof PlatformSubscriptionStatusSchema>;

export const PLATFORM_SUBSCRIPTION_TRANSITIONS: Record<PlatformSubscriptionStatus, ReadonlySet<PlatformSubscriptionStatus>> = {
  pending_payment: new Set<PlatformSubscriptionStatus>(['active', 'cancelled']),
  active:          new Set<PlatformSubscriptionStatus>(['overdue', 'cancelled']),
  overdue:         new Set<PlatformSubscriptionStatus>(['active', 'cancelled']),
  cancelled:       new Set<PlatformSubscriptionStatus>(), // terminal
};

export function canTransitionPlatformSubscription(from: PlatformSubscriptionStatus, to: PlatformSubscriptionStatus): boolean {
  return PLATFORM_SUBSCRIPTION_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionPlatformSubscription(from: PlatformSubscriptionStatus, to: PlatformSubscriptionStatus): void {
  if (!canTransitionPlatformSubscription(from, to)) {
    throw new Error(`PlatformSubscription FSM: transição inválida ${from} → ${to}`);
  }
}

/** Side-effects esperados por transição. Documentação para emitir eventos cross-módulo. */
export const PLATFORM_SUBSCRIPTION_TRANSITION_EFFECTS: Partial<Record<`${PlatformSubscriptionStatus}->${PlatformSubscriptionStatus}`, string[]>> = {
  'pending_payment->active':    ['Webhook confirmou primeiro pagamento — gravar nextBillingDate'],
  'pending_payment->cancelled': ['Checkout abandonado ou cancelado antes de pagar'],
  'active->overdue':            ['Cron diário: passou de nextBillingDate sem pagamento confirmado — só status, sem bloqueio (M12 v1)'],
  'overdue->active':            ['Webhook confirmou pagamento em atraso — volta a ficar em dia'],
  'active->cancelled':          ['Assinatura MP cancelada (operador ou MP)'],
  'overdue->cancelled':         ['Assinatura MP cancelada em atraso (operador ou MP)'],
};

export const PLATFORM_SUBSCRIPTION_TERMINAL_STATUSES: ReadonlySet<PlatformSubscriptionStatus> = new Set(['cancelled']);
