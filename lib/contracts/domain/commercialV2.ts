/**
 * Contratos canônicos da M02 para cotação e leitura comercial.
 *
 * Valores monetários são inteiros em centavos dentro do núcleo. Os adapters
 * continuam expondo/persistindo os campos legados em reais até cada canal ser
 * migrado nas etapas M02.3, M02.5 e M02.6.
 */

import { z } from 'zod';
import { DeliveryTypeSchema } from './deliveryOrder';

export const COMMERCIAL_V2_VERSION = 2 as const;

export const MoneyCentsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const SignedMoneyCentsSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const CommercialQuantitySchema = z.number().positive().max(100_000);

export const COMMERCIAL_CHANNELS = ['pdv', 'site', 'manual', 'agent', 'b2b', 'api_v1'] as const;
export const CommercialChannelSchema = z.enum(COMMERCIAL_CHANNELS);

export const COMMERCIAL_SOURCE_TYPES = ['sale', 'deliveryOrder', 'order'] as const;
export const CommercialSourceTypeSchema = z.enum(COMMERCIAL_SOURCE_TYPES);

export const CommercialModifierOptionRequestSchema = z.object({
  optionId: z.string().min(1),
  quantity: z.number().int().positive().max(99).default(1),
});

export const CommercialModifierRequestSchema = z.object({
  groupId: z.string().min(1),
  selectedOptions: z.array(CommercialModifierOptionRequestSchema).min(1).max(50),
});

export const CommercialQuoteLineRequestSchema = z.object({
  lineId: z.string().min(1).max(100).optional(),
  productId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
  quantity: CommercialQuantitySchema,
  selectedModifiers: z.array(CommercialModifierRequestSchema).max(20).optional(),
  notes: z.string().max(500).optional(),
}).superRefine((line, ctx) => {
  if (Boolean(line.productId) === Boolean(line.serviceId)) {
    ctx.addIssue({ code: 'custom', message: 'Informe productId ou serviceId, exclusivamente.', path: ['productId'] });
  }
  if (line.serviceId && line.variantId) {
    ctx.addIssue({ code: 'custom', message: 'Serviço não aceita variantId.', path: ['variantId'] });
  }
  if (line.serviceId && line.selectedModifiers?.length) {
    ctx.addIssue({ code: 'custom', message: 'Serviço não aceita modificadores de produto.', path: ['selectedModifiers'] });
  }
});

export const CommercialDeliveryQuoteSchema = z.object({
  type: DeliveryTypeSchema,
  cep: z.string().max(12).optional(),
  bairro: z.string().max(160).optional(),
  /** Taxa proposta pelo operador quando nenhuma zona resolve o endereço (M02.5b,
   *  canal manual). Só tem efeito se a zona não casar; permissão é responsabilidade
   *  do chamador (ver QuoteCommercialCartAdminInput.canOverrideDeliveryFee). */
  manualFeeCents: MoneyCentsSchema.optional(),
});

export const CommercialManualDiscountSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fixed'),
    amountCents: MoneyCentsSchema,
    reason: z.string().min(3).max(300),
  }),
  z.object({
    kind: z.literal('percent'),
    basisPoints: z.number().int().min(1).max(10_000),
    reason: z.string().min(3).max(300),
  }),
]);

export const CommercialQuoteRequestSchema = z.object({
  schemaVersion: z.literal(COMMERCIAL_V2_VERSION).default(COMMERCIAL_V2_VERSION),
  businessId: z.string().min(1),
  channel: CommercialChannelSchema,
  lines: z.array(CommercialQuoteLineRequestSchema).min(1).max(100),
  delivery: CommercialDeliveryQuoteSchema.optional(),
  manualDiscount: CommercialManualDiscountSchema.optional(),
  tipCents: MoneyCentsSchema.default(0),
  expectedTotalCents: MoneyCentsSchema.optional(),
});

export const QuotedCommercialModifierOptionSchema = z.object({
  optionId: z.string().min(1),
  optionName: z.string().min(1),
  quantity: z.number().int().positive(),
  additionalPriceCents: MoneyCentsSchema,
  linkedProductId: z.string().optional(),
  consumeQuantity: z.number().positive().optional(),
});

export const QuotedCommercialModifierSchema = z.object({
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  priceStrategy: z.enum(['sum', 'max', 'avg']),
  selectedOptions: z.array(QuotedCommercialModifierOptionSchema).min(1),
});

export const CommercialStockRequirementSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  variantId: z.string().min(1).optional(),
  quantity: z.number().positive(),
  available: z.number(),
  tracked: z.boolean(),
});

export const QuotedCommercialLineSchema = z.object({
  lineId: z.string().min(1),
  kind: z.enum(['product', 'service']),
  productId: z.string().optional(),
  serviceId: z.string().optional(),
  variantId: z.string().optional(),
  nameSnapshot: z.string().min(1),
  variantNameSnapshot: z.string().optional(),
  skuSnapshot: z.string().optional(),
  quantity: CommercialQuantitySchema,
  baseUnitAmountCents: MoneyCentsSchema,
  modifierUnitAmountCents: MoneyCentsSchema,
  unitAmountCents: MoneyCentsSchema,
  subtotalCents: MoneyCentsSchema,
  discountCents: MoneyCentsSchema,
  totalCents: MoneyCentsSchema,
  selectedModifiers: z.array(QuotedCommercialModifierSchema).optional(),
  stockRequirements: z.array(CommercialStockRequirementSchema),
  notes: z.string().max(500).optional(),
}).superRefine((line, ctx) => {
  if (Boolean(line.productId) === Boolean(line.serviceId)) {
    ctx.addIssue({ code: 'custom', message: 'Linha cotada precisa de produto ou serviço.', path: ['productId'] });
  }
  if (line.kind === 'product' && !line.productId) {
    ctx.addIssue({ code: 'custom', message: 'Linha kind=product exige productId.', path: ['productId'] });
  }
  if (line.kind === 'service' && !line.serviceId) {
    ctx.addIssue({ code: 'custom', message: 'Linha kind=service exige serviceId.', path: ['serviceId'] });
  }
  if (line.kind === 'service' && (line.variantId || line.selectedModifiers?.length)) {
    ctx.addIssue({ code: 'custom', message: 'Serviço não aceita variação ou modificadores.', path: ['kind'] });
  }
  if (line.unitAmountCents !== line.baseUnitAmountCents + line.modifierUnitAmountCents) {
    ctx.addIssue({ code: 'custom', message: 'Preço unitário não fecha com base + modificadores.', path: ['unitAmountCents'] });
  }
  const expectedSubtotal = Math.round(line.unitAmountCents * line.quantity);
  if (line.subtotalCents !== expectedSubtotal || line.totalCents !== line.subtotalCents - line.discountCents) {
    ctx.addIssue({ code: 'custom', message: 'Totais da linha não fecham.', path: ['totalCents'] });
  }
});

export const CommercialDiscountBreakdownSchema = z.object({
  source: z.enum(['manual', 'coupon', 'campaign', 'points', 'other']),
  amountCents: MoneyCentsSchema,
  referenceId: z.string().optional(),
  reason: z.string().max(300).optional(),
});

export const CommercialPriceBreakdownSchema = z.object({
  subtotalCents: MoneyCentsSchema,
  discountCents: MoneyCentsSchema,
  deliveryFeeCents: MoneyCentsSchema,
  tipCents: MoneyCentsSchema,
  totalCents: MoneyCentsSchema,
  discounts: z.array(CommercialDiscountBreakdownSchema),
}).superRefine((price, ctx) => {
  const expected = Math.max(0, price.subtotalCents + price.deliveryFeeCents + price.tipCents - price.discountCents);
  if (price.totalCents !== expected) {
    ctx.addIssue({ code: 'custom', message: 'Total não fecha com o detalhamento de preço.', path: ['totalCents'] });
  }
});

export const CommercialPaymentMethodSchema = z.enum([
  'cash', 'pix', 'credit_card', 'debit_card', 'boleto', 'bank_transfer',
  'store_credit', 'unpaid', 'loyalty_points', 'gift_card', 'voucher', 'other',
]);

export const CommercialPaymentAllocationSchema = z.object({
  allocationId: z.string().min(1),
  method: CommercialPaymentMethodSchema,
  amountCents: MoneyCentsSchema,
  status: z.enum(['pending', 'authorized', 'paid', 'failed', 'refunded', 'expired']),
  installments: z.number().int().min(1).max(48).optional(),
  dueDate: z.string().optional(),
  provider: z.string().optional(),
  externalPaymentId: z.string().optional(),
});

export const CommercialEffectReferencesSchema = z.object({
  operationId: z.string().optional(),
  transactionIds: z.array(z.string()),
  stockMovementIds: z.array(z.string()),
  couponRedemptionIds: z.array(z.string()),
  giftCardRedemptionIds: z.array(z.string()),
  loyaltyTransactionIds: z.array(z.string()),
  fiscalDocumentIds: z.array(z.string()),
});

export const CommercialQuoteSchema = z.object({
  schemaVersion: z.literal(COMMERCIAL_V2_VERSION),
  businessId: z.string().min(1),
  channel: CommercialChannelSchema,
  quotedAt: z.string().datetime(),
  currency: z.literal('BRL'),
  lines: z.array(QuotedCommercialLineSchema).min(1),
  pricing: CommercialPriceBreakdownSchema,
  availability: z.object({
    available: z.boolean(),
    shortages: z.array(CommercialStockRequirementSchema),
  }),
  delivery: z.object({
    type: DeliveryTypeSchema,
    feeCents: MoneyCentsSchema,
    resolution: z.enum(['matched', 'flat', 'none', 'manual']),
    zoneName: z.string().optional(),
    estimatedMinutes: z.number().int().nonnegative().optional(),
  }).optional(),
});

export const CommercialDocumentV2Schema = z.object({
  schemaVersion: z.literal(COMMERCIAL_V2_VERSION),
  sourceType: CommercialSourceTypeSchema,
  sourceId: z.string().min(1),
  businessId: z.string().min(1),
  channel: CommercialChannelSchema,
  status: z.string().min(1),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  lines: z.array(QuotedCommercialLineSchema).min(1),
  pricing: CommercialPriceBreakdownSchema,
  payments: z.array(CommercialPaymentAllocationSchema),
  effects: CommercialEffectReferencesSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type CommercialQuoteRequest = z.infer<typeof CommercialQuoteRequestSchema>;
export type CommercialQuoteLineRequest = z.infer<typeof CommercialQuoteLineRequestSchema>;
export type QuotedCommercialLine = z.infer<typeof QuotedCommercialLineSchema>;
export type CommercialStockRequirement = z.infer<typeof CommercialStockRequirementSchema>;
export type CommercialPriceBreakdown = z.infer<typeof CommercialPriceBreakdownSchema>;
export type CommercialPaymentAllocation = z.infer<typeof CommercialPaymentAllocationSchema>;
export type CommercialEffectReferences = z.infer<typeof CommercialEffectReferencesSchema>;
export type CommercialQuote = z.infer<typeof CommercialQuoteSchema>;
export type CommercialDocumentV2 = z.infer<typeof CommercialDocumentV2Schema>;
