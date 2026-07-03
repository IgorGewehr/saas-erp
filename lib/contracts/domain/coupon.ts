/**
 * lib/contracts/domain/coupon.ts
 *
 * Coupon — código promocional aplicável no checkout de DeliveryOrder (cardápio
 * digital). É o motor de conversão da trilha Cliente: desconto percentual, fixo
 * ou frete grátis, com janela de validade, limite de uso (total e por cliente),
 * valor mínimo de pedido e escopo por tipo de entrega. Hoje ligado só ao checkout
 * público + preview; PDV/agente são gap conhecido (ver coupons.ts).
 *
 * ⚠ Segurança dos limites: `firstOrderOnly`/`usageLimitPerClient` são tão fortes
 * quanto a IDENTIDADE do cliente (telefone não-verificado). Sem clientId o motor
 * rejeita esses cupons; ainda assim recomenda-se SEMPRE definir `usageLimit`
 * global como teto de segurança de um código público.
 *
 * ─── Invariantes (superRefine) ──────────────────────────────────────────────
 *   - `code` não-vazio (a normalização p/ MAIÚSCULAS é do serviço, não do schema).
 *   - percent  → discountValue ∈ [1, 100].
 *   - fixed    → discountValue > 0.
 *   - free_delivery → discountValue ignorado (pode ser 0).
 *   - endsAt > startsAt quando ambos presentes.
 *   - usageLimit ≥ usedCount quando ambos presentes.
 *
 * ─── O que NÃO vive aqui ─────────────────────────────────────────────────────
 *   - Cálculo do desconto e checagem de elegibilidade → `lib/services/orders/coupons.ts`
 *     (função PURA `evaluateCoupon`, chamada pelo checkout público e pelo preview).
 *   - Transições de status → `lib/contracts/fsm/coupon.ts`.
 *   - Idempotência do resgate (couponRedemptions/{couponId}_{orderId}) → checkout.
 */

import { z } from 'zod';

export const COUPON_DISCOUNT_TYPES = ['percent', 'fixed', 'free_delivery'] as const;
export const CouponDiscountTypeSchema = z.enum(COUPON_DISCOUNT_TYPES);
export type CouponDiscountType = z.infer<typeof CouponDiscountTypeSchema>;

export const COUPON_STATUSES = ['active', 'paused', 'expired', 'exhausted'] as const;
export const CouponStatusSchema = z.enum(COUPON_STATUSES);
export type CouponStatus = z.infer<typeof CouponStatusSchema>;

/** Escopo do cupom por tipo de pedido. 'all' vale para entrega e retirada. */
export const COUPON_APPLIES_TO = ['all', 'entrega', 'retirada'] as const;
export const CouponAppliesToSchema = z.enum(COUPON_APPLIES_TO);
export type CouponAppliesTo = z.infer<typeof CouponAppliesToSchema>;

/**
 * Regex do código: 3–32 caracteres, alfanumérico + `-` `_`. Validado como
 * enviado; o serviço normaliza p/ MAIÚSCULAS antes de comparar/gravar (o índice
 * de unicidade por businessId assume o code já normalizado).
 */
export const COUPON_CODE_REGEX = /^[A-Za-z0-9_-]{3,32}$/;

export const CouponSchema = z.object({
  id: z.string().optional(),
  businessId: z.string().min(1),
  code: z.string().regex(COUPON_CODE_REGEX, 'Código inválido (3–32, letras/números/-/_)'),
  description: z.string().max(200).optional(),

  discountType: CouponDiscountTypeSchema,
  /** percent: 1–100 · fixed: BRL > 0 · free_delivery: ignorado. */
  discountValue: z.number().nonnegative(),
  /** Teto do desconto para type=percent (BRL). Ausente = sem teto. */
  maxDiscountAmount: z.number().positive().optional(),
  /** Piso de subtotal (mercadoria) para o cupom valer (BRL). */
  minOrderValue: z.number().nonnegative().optional(),

  appliesTo: CouponAppliesToSchema.default('all'),
  /** Só vale no PRIMEIRO pedido do cliente (visitCount/histórico == 0). */
  firstOrderOnly: z.boolean().optional(),

  /** Limite TOTAL de resgates (todos os clientes). Ausente = ilimitado. */
  usageLimit: z.number().int().positive().optional(),
  /** Limite de resgates POR cliente. Ausente = ilimitado. */
  usageLimitPerClient: z.number().int().positive().optional(),
  /** Contador de resgates efetivados — incrementado por CAS na transação. */
  usedCount: z.number().int().nonnegative().default(0),

  /** Janela de validade (ISO). Ausentes = sem limite naquela borda. */
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),

  status: CouponStatusSchema.default('active'),

  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
}).superRefine((c, ctx) => {
  if (c.discountType === 'percent' && (c.discountValue < 1 || c.discountValue > 100)) {
    ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Percentual deve estar entre 1 e 100' });
  }
  if (c.discountType === 'fixed' && c.discountValue <= 0) {
    ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Valor fixo deve ser maior que 0' });
  }
  if (c.startsAt && c.endsAt && c.endsAt <= c.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Fim deve ser depois do início' });
  }
  if (c.usageLimit !== undefined && c.usedCount > c.usageLimit) {
    ctx.addIssue({ code: 'custom', path: ['usedCount'], message: 'usedCount não pode exceder usageLimit' });
  }
});

export type Coupon = z.infer<typeof CouponSchema>;

/**
 * couponRedemptions/{couponId}_{orderId} — registro idempotente de resgate.
 * O id determinístico ancora a dedup: um retry do MESMO pedido não re-incrementa
 * o usedCount. `clientId` alimenta a checagem de limite por cliente.
 */
export const CouponRedemptionSchema = z.object({
  id: z.string().optional(),
  businessId: z.string().min(1),
  couponId: z.string().min(1),
  code: z.string().min(1),
  orderId: z.string().min(1),
  clientId: z.string().optional(),
  /** Desconto efetivamente concedido neste resgate (BRL). */
  discount: z.number().nonnegative(),
  channel: z.enum(['site', 'pdv', 'agent', 'manual']).default('site'),
  createdAt: z.string(),
});

export type CouponRedemption = z.infer<typeof CouponRedemptionSchema>;
