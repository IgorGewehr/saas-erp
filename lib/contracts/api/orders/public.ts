/**
 * lib/contracts/api/orders/public.ts — POST /api/orders/public
 *
 * Endpoint anônimo (rate-limited por IP, sem auth) que recebe pedido do
 * cardápio online. Server re-computa preços (tolerância 0.01) e valida modifiers
 * contra ProductModifierGroup do produto.
 *
 * SDD invariant: cliente NÃO pode forçar preço final — server sempre recomputa.
 *                modifiers selecionados precisam existir em Product.modifierGroups.
 */

import { z } from 'zod';
import { ErrorEnvelopeSchema, successEnvelope } from '../_envelope';
import { DeliveryOrderAddressSchema, DeliveryOrderSchema, DeliveryTypeSchema, SelectedModifierSchema } from '../../domain/deliveryOrder';

const PublicOrderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(99),
  notes: z.string().max(500).optional(),
  selectedModifiers: z.array(SelectedModifierSchema).optional(),
});

export const CreatePublicOrderBodySchema = z.object({
  businessSlug: z.string().min(1).max(100),
  clientName: z.string().min(1).max(200),
  clientPhone: z.string().min(8).max(20),
  items: z.array(PublicOrderItemSchema).min(1).max(50),
  deliveryType: DeliveryTypeSchema,
  deliveryAddress: DeliveryOrderAddressSchema.optional(),
  paymentMethod: z.enum(['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'voucher', 'outro']).optional(),
  changeFor: z.number().nonnegative().optional(),
  customerNotes: z.string().max(2000).optional(),
  /**
   * Cliente PODE enviar preço esperado (informativo). Server re-computa e
   * REJEITA se delta > R$0.01 — evita confusão se preço mudou no servidor
   * desde o load da página.
   */
  clientExpectedTotal: z.number().nonnegative().optional(),
}).superRefine((b, ctx) => {
  if (b.deliveryType === 'entrega' && !b.deliveryAddress) {
    ctx.addIssue({ code: 'custom', message: 'deliveryType=entrega exige deliveryAddress', path: ['deliveryAddress'] });
  }
});

export const CreatePublicOrderResponseSchema = z.union([
  successEnvelope(z.object({
    orderId: z.string(),
    orderNumber: z.number().int().nonnegative(),
    status: DeliveryOrderSchema.shape.status,
    estimatedDeliveryAt: z.string().optional(),
    total: z.number().nonnegative(),
  })),
  ErrorEnvelopeSchema,
]);

export type CreatePublicOrderBody = z.infer<typeof CreatePublicOrderBodySchema>;
