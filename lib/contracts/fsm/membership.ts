/**
 * lib/contracts/fsm/membership.ts — máquina de estados de ClientMembership (P2.9)
 *
 *  active ⇄ paused
 *    │  └────────────► cancelled (terminal)
 *    │  └────────────► expired   (terminal)
 *    ├──────────────► cancelled (terminal — cliente cancelou)
 *    └──────────────► expired   (terminal — não renovou / cobrança falhou N vezes)
 *
 * Regras:
 *  - `active`   → cliente pode reservar (até maxUsesPerCycle) e é cobrado pelo runner.
 *  - `paused`   → não cobra, não consome usos; pode voltar a `active`.
 *  - `cancelled`→ encerrada por ação do cliente/operador. Terminal.
 *  - `expired`  → ciclo venceu sem renovação (ou cobrança falhou). Terminal.
 *
 * Estados terminais: cancelled, expired.
 */

import { z } from 'zod';

export const MEMBERSHIP_STATUSES = ['active', 'paused', 'cancelled', 'expired'] as const;
export const MembershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>;

export const MEMBERSHIP_TRANSITIONS: Record<MembershipStatus, ReadonlySet<MembershipStatus>> = {
  active:    new Set<MembershipStatus>(['paused', 'cancelled', 'expired']),
  paused:    new Set<MembershipStatus>(['active', 'cancelled', 'expired']),
  cancelled: new Set<MembershipStatus>(), // terminal
  expired:   new Set<MembershipStatus>(), // terminal
};

export function canTransitionMembership(from: MembershipStatus, to: MembershipStatus): boolean {
  return MEMBERSHIP_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionMembership(from: MembershipStatus, to: MembershipStatus): void {
  if (!canTransitionMembership(from, to)) {
    throw new Error(`ClientMembership FSM: transição inválida ${from} → ${to}`);
  }
}

/** Side-effects esperados por transição. Documentação para emitir eventos cross-módulo. */
export const MEMBERSHIP_TRANSITION_EFFECTS: Partial<Record<`${MembershipStatus}->${MembershipStatus}`, string[]>> = {
  'active->paused':    ['Suspender cobrança no runner (nextBillingDate ignorado enquanto paused)'],
  'paused->active':    ['Retomar cobrança — recalcular nextBillingDate a partir de hoje'],
  'active->cancelled': ['Encerrar cobrança recorrente', 'Liberar reservas futuras do plano se aplicável'],
  'active->expired':   ['Cobrança recorrente falhou / não renovou — encerra plano'],
};

export const MEMBERSHIP_TERMINAL_STATUSES: ReadonlySet<MembershipStatus> = new Set(['cancelled', 'expired']);
