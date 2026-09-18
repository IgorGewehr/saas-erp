/**
 * lib/contracts/api/services/order-server.ts
 *
 * Contrato de input do serviço `createOrderWithSideEffects`
 * (lib/services/order-server.ts) — pedido B2B/condicional (M02.6).
 *
 * Reusa `CommercialQuoteLineRequestSchema` (mesma forma de item que PDV/
 * DeliveryOrder já usam) — sem lista paralela. O item aqui é só INTENÇÃO
 * (productId/serviceId/variantId/quantity); preço/nome/estoque são
 * resolvidos e revalidados no servidor pela cotação comercial (R6), nunca
 * confiados no que o cliente manda.
 *
 * `operatorId`/`operatorName` seguem o padrão de sale-server.ts/
 * delivery-order-server.ts: viajam no input, mas a rota autenticada SEMPRE
 * os sobrescreve com a identidade do token verificado.
 */

import { z } from 'zod';
import { CommercialQuoteLineRequestSchema, MoneyCentsSchema } from '@/contracts/domain/commercialV2';
import { OrderTypeSchema } from '@/contracts/domain/order';
import { PaymentMethodSchema } from '@/contracts/domain/sale';

const OrderAddressSchema = z.object({
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
}).passthrough();

export const CreateOrderWithSideEffectsInputSchema = z.object({
  businessId: z.string().min(1),
  type: OrderTypeSchema,
  clientId: z.string().min(1).optional(),
  clientName: z.string().trim().min(1).max(200).optional(),
  clientCpfCnpj: z.string().min(1).max(20).optional(),
  items: z.array(CommercialQuoteLineRequestSchema).min(1).max(100),
  /** Desconto manual (reais) — exige permissão de gerente+, mesmo mecanismo
   *  do PDV/delivery (CommercialQuoteRequestSchema.manualDiscount). */
  discount: z.number().nonnegative().optional(),
  discountReason: z.string().min(3).max(300).optional(),
  /** Total (centavos, já com o desconto manual) que o cliente viu ao negociar.
   *  Divergência da cotação autoritativa ⇒ 409 STALE_QUOTE ANTES de gravar o
   *  pedido — mesmo contrato de CommercialQuoteRequestSchema.expectedTotalCents. */
  expectedTotalCents: MoneyCentsSchema.optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  paymentTerms: z.string().max(200).optional(),
  /** 1 = à vista; >1 gera N Transactions receita com installmentGroupId/
   *  installmentNumber, vencendo em ciclos mensais a partir da data de
   *  faturamento (simplificação — paymentTerms não é parseado num
   *  cronograma; ver docs/paridade/M02_PLANO_IMPLEMENTACAO.md §M02.6). */
  installments: z.number().int().min(1).max(48).default(1),
  deliveryDate: z.string().optional(),
  deliveryAddress: OrderAddressSchema.optional(),
  conditionalExpiresAt: z.string().optional(),
  notes: z.string().max(5000).optional(),
  internalNotes: z.string().max(5000).optional(),
  sectorId: z.string().optional(),
  /** Sempre sobrescritos pela rota autenticada a partir do token verificado. */
  operatorId: z.string().min(1).optional(),
  operatorName: z.string().trim().min(1).max(200).optional(),
  /**
   * Ausente ⇒ o serviço deriva uma chave determinística do carrinho (mesmo
   * padrão de sale-server.ts/delivery-order-server.ts).
   */
  idempotencyKey: z.string().min(1).max(200).optional(),
}).superRefine((body, ctx) => {
  if (body.type === 'condicional' && !body.conditionalExpiresAt) {
    ctx.addIssue({ code: 'custom', message: 'type=condicional exige conditionalExpiresAt.', path: ['conditionalExpiresAt'] });
  }
});

export type CreateOrderWithSideEffectsInput = z.infer<typeof CreateOrderWithSideEffectsInputSchema>;
