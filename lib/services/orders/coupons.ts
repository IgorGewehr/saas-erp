/**
 * lib/services/orders/coupons.ts
 *
 * Motor de cupom — fonte ÚNICA de elegibilidade + cálculo de desconto. PURO
 * (sem SDK, sem rede, sem Date.now()): recebe o cupom + um contexto de pedido e
 * devolve se aplica e quanto desconta. Projetado para ser reusável por qualquer
 * canal, mas HOJE está ligado apenas em:
 *   - checkout público do cardápio (app/api/orders/public) — autoridade que reserva
 *   - endpoint de preview (app/api/coupons/validate) — mostra o desconto antes de
 *     submeter, com a MESMA regra que o checkout aplica (sem divergência).
 *
 * GAP CONHECIDO (follow-up Cliente-2): PDV e agente ainda NÃO aplicam cupom — o
 * tool do agente recebe `discount` cru por parâmetro, sem lookup/reserva. Um
 * cliente que informe um código via WhatsApp não tem o cupom validado/consumido.
 * Para ligar esses canais, chamar reserveCouponAdmin na criação do pedido (mesma
 * ordem: reservar antes de número/estoque) com channel='agent'/'pdv'.
 *
 * A idempotência/atomicidade do RESGATE (incremento de usedCount por CAS +
 * couponRedemptions/{couponId}_{orderId}) é responsabilidade do chamador que
 * grava; aqui só se decide elegibilidade e valor. `now` e contadores entram por
 * parâmetro justamente para manter a função determinística e testável.
 */

import type { Coupon, CouponStatus } from '@/lib/contracts/domain/coupon';
import type { DeliveryType } from '@/lib/types';
import { round2 } from './pricing';

/** Normaliza o código como gravado/comparado: trim + MAIÚSCULAS. */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Status EFETIVO do cupom dado o instante e o uso — não confia só no campo
 * `status` persistido (que pode estar defasado até um job/checkout marcar
 * expired/exhausted). Ordem de precedência: exhausted > expired > paused > active.
 */
export function deriveCouponStatus(coupon: Coupon, now: Date): CouponStatus {
  if (coupon.status === 'paused') return 'paused';
  if (coupon.usageLimit !== undefined && coupon.usedCount >= coupon.usageLimit) {
    return 'exhausted';
  }
  if (coupon.endsAt && new Date(coupon.endsAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  return coupon.status === 'exhausted' || coupon.status === 'expired'
    ? coupon.status
    : 'active';
}

export type CouponRejectReason =
  | 'inactive'      // pausado
  | 'not_started'   // antes de startsAt
  | 'expired'       // depois de endsAt
  | 'exhausted'     // limite total atingido
  | 'client_limit'  // limite por cliente atingido
  | 'wrong_channel' // appliesTo não bate com o deliveryType
  | 'min_order'     // subtotal abaixo do mínimo
  | 'first_order_only' // cupom de 1ª compra, cliente já comprou
  | 'identity_required'; // cupom por-cliente/1ª-compra sem identidade (telefone)

export interface CouponContext {
  /** Subtotal da MERCADORIA (soma dos itens, sem frete). Base do desconto. */
  subtotal: number;
  /** Taxa de entrega resolvida server-side (para free_delivery). */
  deliveryFee: number;
  deliveryType: DeliveryType;
  now: Date;
  /** True se é o primeiro pedido do cliente (para firstOrderOnly). */
  isFirstOrder?: boolean;
  /** Quantos resgates este cliente já fez deste cupom (para usageLimitPerClient). */
  clientRedemptionCount?: number;
  /**
   * Há identidade de cliente resolvida (ex.: telefone → clientId)? Cupons
   * `firstOrderOnly`/`usageLimitPerClient` só são fiscalizáveis com identidade —
   * sem ela, `isFirstOrder`/`clientRedemptionCount` seriam chutados como
   * "primeiro pedido"/"zero resgates" e o limite viraria burlável (basta omitir
   * o telefone no checkout anônimo). `false` ⇒ rejeita esses cupons.
   * `undefined` ⇒ desconhecido (preview otimista); o checkout passa o valor real.
   */
  hasIdentity?: boolean;
}

export type CouponEvaluation =
  | {
      ok: true;
      /** Desconto sobre a mercadoria (BRL, ≥ 0). Para free_delivery é 0. */
      discount: number;
      /** True quando o cupom zera o frete (type=free_delivery). */
      freeDelivery: boolean;
      /** Frete resultante após o cupom (0 se freeDelivery, senão o original). */
      finalFee: number;
    }
  | { ok: false; reason: CouponRejectReason };

/** Frete grátis só faz sentido em entrega; retirada não tem frete a zerar. */
function appliesToMatches(appliesTo: Coupon['appliesTo'], deliveryType: DeliveryType): boolean {
  if (appliesTo === 'all') return true;
  return appliesTo === deliveryType;
}

/**
 * Avalia um cupom contra um contexto de pedido. Determinística: mesmas entradas,
 * mesma saída. Não muta o cupom nem grava nada.
 *
 * Regras de valor:
 *   - percent: subtotal × value/100, limitado por maxDiscountAmount (se houver) e
 *     nunca acima do subtotal.
 *   - fixed: value, nunca acima do subtotal (não gera crédito/negativo).
 *   - free_delivery: desconto 0 sobre mercadoria, mas zera o frete (finalFee 0).
 */
export function evaluateCoupon(coupon: Coupon, ctx: CouponContext): CouponEvaluation {
  const status = deriveCouponStatus(coupon, ctx.now);
  if (status === 'paused') return { ok: false, reason: 'inactive' };
  if (status === 'exhausted') return { ok: false, reason: 'exhausted' };
  if (status === 'expired') return { ok: false, reason: 'expired' };

  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > ctx.now.getTime()) {
    return { ok: false, reason: 'not_started' };
  }
  if (!appliesToMatches(coupon.appliesTo, ctx.deliveryType)) {
    return { ok: false, reason: 'wrong_channel' };
  }
  if (coupon.minOrderValue !== undefined && ctx.subtotal < coupon.minOrderValue) {
    return { ok: false, reason: 'min_order' };
  }
  // Cupom que depende de identidade (1ª compra / limite por cliente) SEM
  // identidade resolvida ⇒ rejeita. Não trate "sem telefone" como "primeiro
  // pedido/zero resgates" — isso é o bypass trivial do checkout anônimo.
  const identityGated = coupon.firstOrderOnly || coupon.usageLimitPerClient !== undefined;
  if (identityGated && ctx.hasIdentity === false) {
    return { ok: false, reason: 'identity_required' };
  }
  if (coupon.firstOrderOnly && ctx.isFirstOrder === false) {
    return { ok: false, reason: 'first_order_only' };
  }
  if (
    coupon.usageLimitPerClient !== undefined &&
    (ctx.clientRedemptionCount ?? 0) >= coupon.usageLimitPerClient
  ) {
    return { ok: false, reason: 'client_limit' };
  }

  if (coupon.discountType === 'free_delivery') {
    // Frete grátis num pedido sem frete (retirada / fee 0) é elegível mas inócuo.
    return { ok: true, discount: 0, freeDelivery: true, finalFee: 0 };
  }

  let raw: number;
  if (coupon.discountType === 'percent') {
    raw = (ctx.subtotal * coupon.discountValue) / 100;
    if (coupon.maxDiscountAmount !== undefined) raw = Math.min(raw, coupon.maxDiscountAmount);
  } else {
    raw = coupon.discountValue; // fixed
  }
  // Nunca desconta mais que a mercadoria (evita total negativo / crédito).
  const discount = round2(Math.min(raw, ctx.subtotal));

  return { ok: true, discount, freeDelivery: false, finalFee: round2(ctx.deliveryFee) };
}

/** Mensagem PT-BR curta por motivo — usada no checkout e no preview. */
export const COUPON_REJECT_MESSAGE: Record<CouponRejectReason, string> = {
  inactive: 'Cupom indisponível no momento.',
  not_started: 'Este cupom ainda não está válido.',
  expired: 'Este cupom expirou.',
  exhausted: 'Este cupom atingiu o limite de usos.',
  client_limit: 'Você já usou este cupom o número máximo de vezes.',
  wrong_channel: 'Este cupom não vale para este tipo de pedido.',
  min_order: 'Seu pedido não atingiu o valor mínimo para este cupom.',
  first_order_only: 'Este cupom é válido apenas no primeiro pedido.',
  identity_required: 'Informe seu telefone para usar este cupom.',
};
