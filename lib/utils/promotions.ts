/**
 * lib/utils/promotions.ts
 *
 * Vitrine: reaproveita `BusinessPromotion` (business.settings.promotions, antes
 * só lido pelo agente de IA) como "desconto pré-configurado" que o vendedor
 * aplica na proposta. NÃO é preço promocional por produto — o motor de cotação
 * continua usando `salePrice`; a promoção vira o desconto manual do pedido
 * (que já existe, manager+). Preço promo real por produto = fase 2.
 */

import type { BusinessPromotion } from '@/lib/types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `validUntil` só com data (YYYY-MM-DD) vale até o fim daquele dia (fuso local). */
function expiresAtMs(validUntil: string): number | null {
  const value = DATE_ONLY.test(validUntil) ? `${validUntil}T23:59:59.999` : validUntil;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isPromotionExpired(promotion: BusinessPromotion, now: Date): boolean {
  if (!promotion.validUntil) return false;
  const expires = expiresAtMs(promotion.validUntil);
  // Data inválida: trata como expirada (não oferece promoção de validade duvidosa).
  return expires === null || expires < now.getTime();
}

/** Ativas, não vencidas, com valor positivo. `free_shipping` não faz sentido
 *  numa venda de serviço/B2B — descartada. */
export function getActivePromotions(promotions: BusinessPromotion[] | undefined, now: Date): BusinessPromotion[] {
  return (promotions ?? []).filter((p) =>
    p.isActive
    && p.type !== 'free_shipping'
    && Number.isFinite(p.value)
    && p.value > 0
    && !isPromotionExpired(p, now),
  );
}

export interface PromotionApplication {
  discountCents: number;
  /** Vai em `discountReason` do pedido (mín. 3 / máx. 300 chars no contrato). */
  reason: string;
}

const MAX_REASON_LENGTH = 300;

/** Calcula o desconto da promoção sobre o subtotal, ou `null` se não se aplica
 *  (abaixo do pedido mínimo, ou desconto zero). */
export function applyPromotion(promotion: BusinessPromotion, subtotalCents: number): PromotionApplication | null {
  if (promotion.type === 'free_shipping') return null;
  if (subtotalCents <= 0) return null;
  if (promotion.minOrderValue && subtotalCents < Math.round(promotion.minOrderValue * 100)) return null;

  const raw = promotion.type === 'percentage'
    ? Math.round(subtotalCents * (Math.min(100, Math.max(0, promotion.value)) / 100))
    : Math.round(promotion.value * 100);
  const discountCents = Math.min(subtotalCents, raw);
  if (discountCents <= 0) return null;

  return {
    discountCents,
    reason: `Promoção: ${promotion.name}`.slice(0, MAX_REASON_LENGTH),
  };
}
