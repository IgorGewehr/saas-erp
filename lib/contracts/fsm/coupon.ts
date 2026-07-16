/**
 * lib/contracts/fsm/coupon.ts — máquina de estados de Coupon
 *
 *   active ⇄ paused
 *     │        │
 *     └────────┴──────► expired   (terminal — passou de endsAt)
 *     └────────┴──────► exhausted (terminal — usedCount atingiu usageLimit)
 *
 * `active ⇄ paused` é o controle manual do lojista (ligar/desligar sem apagar).
 * `expired`/`exhausted` são estados terminais atingidos por regra (tempo/uso) —
 * um cupom exausto/expirado não volta a valer; para reusar, cria-se outro código.
 *
 * A DERIVAÇÃO do status corrente (dado agora + usedCount) vive no serviço
 * (`deriveCouponStatus`); esta FSM apenas valida transições explícitas gravadas
 * (ex.: lojista pausa/reativa; job/checkout marca exhausted ao bater o limite).
 */

import { COUPON_STATUSES, type CouponStatus } from '../domain/coupon';

export const COUPON_TRANSITIONS: Record<CouponStatus, ReadonlySet<CouponStatus>> = {
  active:    new Set<CouponStatus>(['paused', 'expired', 'exhausted']),
  paused:    new Set<CouponStatus>(['active', 'expired', 'exhausted']),
  expired:   new Set<CouponStatus>(), // terminal
  exhausted: new Set<CouponStatus>(), // terminal
};

export function canTransitionCoupon(from: CouponStatus, to: CouponStatus): boolean {
  if (from === to) return true; // no-op idempotente
  return COUPON_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionCoupon(from: CouponStatus, to: CouponStatus): void {
  if (!canTransitionCoupon(from, to)) {
    throw new Error(`Coupon FSM: transição inválida ${from} → ${to}`);
  }
}

export const COUPON_TERMINAL_STATUSES: ReadonlySet<CouponStatus> = new Set([
  'expired', 'exhausted',
]);

void COUPON_STATUSES;
