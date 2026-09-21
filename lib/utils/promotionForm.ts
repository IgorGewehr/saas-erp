/**
 * lib/utils/promotionForm.ts
 *
 * Cadastro de promoções pela Vitrine (admin+): validação do formulário, texto de
 * exibição e operações puras sobre a lista `business.settings.promotions`.
 * A leitura/aplicação vive em `promotions.ts`; aqui só a escrita.
 */

import type { BusinessPromotion } from '@/lib/types';
import { formatCurrency } from '@/lib/utils/format';
import { formatDateOnly } from '@/lib/utils/localDate';
import { isPromotionExpired } from '@/lib/utils/promotions';
import { centsToMoney, parseMoneyToCents } from '@/lib/utils/vitrineProposal';

export interface PromotionFormInput {
  name: string;
  type: 'percentage' | 'fixed';
  /** Texto digitado: "10" (%) ou "1.500,00" (R$). */
  valueText: string;
  /** Pedido mínimo em R$ (opcional). */
  minOrderText: string;
  /** AAAA-MM-DD, ou vazio = sem validade. */
  validUntil: string;
}

export type PromotionFormErrors = Partial<Record<keyof PromotionFormInput, string>>;

export type PromotionFormResult =
  | { ok: true; value: Pick<BusinessPromotion, 'name' | 'type' | 'value' | 'minOrderValue' | 'validUntil'> }
  | { ok: false; errors: PromotionFormErrors };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parsePercent(text: string): number | null {
  const normalized = text.replace('%', '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Math.round(Number(normalized) * 100) / 100;
  return Number.isFinite(value) ? value : null;
}

/** `today` = AAAA-MM-DD local; validade anterior a hoje é recusada (a promoção nasceria vencida). */
export function parsePromotionForm(input: PromotionFormInput, today: string): PromotionFormResult {
  const errors: PromotionFormErrors = {};
  const name = input.name.trim();
  if (name.length < 2) errors.name = 'Dê um nome à promoção.';
  if (name.length > 80) errors.name = 'Nome muito longo (máx. 80 letras).';

  let value = 0;
  if (input.type === 'percentage') {
    const percent = parsePercent(input.valueText);
    if (percent === null || percent <= 0 || percent > 100) errors.valueText = 'Informe um percentual entre 0,01 e 100.';
    else value = percent;
  } else {
    const cents = parseMoneyToCents(input.valueText);
    if (cents === null || cents <= 0) errors.valueText = 'Informe um valor maior que zero.';
    else value = centsToMoney(cents);
  }

  let minOrderValue: number | undefined;
  if (input.minOrderText.trim() !== '') {
    const cents = parseMoneyToCents(input.minOrderText);
    if (cents === null) errors.minOrderText = 'Valor mínimo inválido.';
    else if (cents > 0) minOrderValue = centsToMoney(cents);
  }

  let validUntil: string | undefined;
  if (input.validUntil.trim() !== '') {
    if (!DATE_ONLY.test(input.validUntil)) errors.validUntil = 'Data inválida.';
    else if (input.validUntil < today) errors.validUntil = 'Esta data já passou.';
    else validUntil = input.validUntil;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      type: input.type,
      value,
      ...(minOrderValue !== undefined ? { minOrderValue } : {}),
      ...(validUntil ? { validUntil } : {}),
    },
  };
}

export type PromotionStatus = 'active' | 'inactive' | 'expired';

export function promotionStatus(promotion: BusinessPromotion, now: Date): PromotionStatus {
  if (!promotion.isActive) return 'inactive';
  return isPromotionExpired(promotion, now) ? 'expired' : 'active';
}

/** "10% de desconto" / "R$ 200,00 de desconto". */
export function describePromotionValue(promotion: Pick<BusinessPromotion, 'type' | 'value'>): string {
  return promotion.type === 'percentage'
    ? `${promotion.value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% de desconto`
    : `${formatCurrency(promotion.value)} de desconto`;
}

/** Condições em uma linha: "pedido mínimo R$ 1.500,00 · até 30/09/2026". */
export function describePromotionTerms(promotion: Pick<BusinessPromotion, 'minOrderValue' | 'validUntil'>): string {
  const parts: string[] = [];
  if (promotion.minOrderValue) parts.push(`pedido mínimo ${formatCurrency(promotion.minOrderValue)}`);
  if (promotion.validUntil) parts.push(`até ${formatDateOnly(promotion.validUntil)}`);
  return parts.join(' · ');
}

export function upsertPromotion(list: BusinessPromotion[], promotion: BusinessPromotion): BusinessPromotion[] {
  return list.some((item) => item.id === promotion.id)
    ? list.map((item) => (item.id === promotion.id ? promotion : item))
    : [...list, promotion];
}

export function removePromotion(list: BusinessPromotion[], id: string): BusinessPromotion[] {
  return list.filter((item) => item.id !== id);
}

export function setPromotionActive(list: BusinessPromotion[], id: string, isActive: boolean): BusinessPromotion[] {
  return list.map((item) => (item.id === id ? { ...item, isActive } : item));
}
