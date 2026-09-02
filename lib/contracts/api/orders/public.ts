/**
 * Contrato real de POST /api/orders/public.
 *
 * Esta fronteira permanece compatível com o cardápio atual. Os preços enviados
 * pelo navegador são apenas valores esperados: a rota relê catálogo,
 * modificadores, zona e benefícios antes de persistir o pedido.
 */

import { z } from 'zod';
import {
  DeliveryOrderAddressSchema,
  DeliveryOrderPaymentMethodSchema,
  DeliveryTypeSchema,
  SelectedModifierSchema,
} from '../../domain/deliveryOrder';

export const PublicOrderItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1).max(200),
  quantity: z.number().int().positive().max(99),
  unitPrice: z.number().nonnegative(),
  basePrice: z.number().nonnegative().optional(),
  total: z.number().nonnegative(),
  notes: z.string().max(500).optional(),
  imageUrl: z.string().url().optional(),
  selectedModifiers: z.array(SelectedModifierSchema).max(20).optional(),
});

export const CreatePublicOrderBodySchema = z.object({
  businessId: z.string().min(1),
  clientName: z.string().trim().min(1).max(200),
  clientPhone: z.string().min(8).max(30).optional(),
  items: z.array(PublicOrderItemSchema).min(1).max(50),
  deliveryType: DeliveryTypeSchema,
  deliveryAddress: DeliveryOrderAddressSchema.optional(),
  /** Número/identificador da mesa no salão — só relevante pra deliveryType='mesa'. */
  tableNumber: z.string().min(1).max(20).optional(),
  /** Valor informativo do cliente; é ignorado e recalculado pela rota. */
  deliveryFee: z.number().nonnegative().optional(),
  paymentMethod: z.union([
    DeliveryOrderPaymentMethodSchema,
    z.enum(['pix_online', 'cartao_online']),
  ]).optional(),
  changeFor: z.number().nonnegative().optional(),
  customerNotes: z.string().max(2000).optional(),
  couponCode: z.string().trim().min(1).max(100).optional(),
  giftCardCode: z.string().trim().min(1).max(100).optional(),
}).superRefine((body, ctx) => {
  if (body.deliveryType !== 'entrega') return;
  const address = body.deliveryAddress;
  if (!address) {
    ctx.addIssue({ code: 'custom', message: 'Entrega exige endereço.', path: ['deliveryAddress'] });
    return;
  }
  for (const field of ['logradouro', 'numero', 'bairro', 'municipio', 'uf'] as const) {
    if (!address[field]?.trim()) {
      ctx.addIssue({ code: 'custom', message: `Endereço exige ${field}.`, path: ['deliveryAddress', field] });
    }
  }
});

export const CreatePublicOrderSuccessSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.number().int().nonnegative(),
  trackingToken: z.string().min(1),
  total: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  giftCardAmount: z.number().nonnegative(),
});

export const CreatePublicOrderResponseSchema = z.union([
  CreatePublicOrderSuccessSchema,
  z.object({ error: z.string().min(1) }),
]);

export type CreatePublicOrderBody = z.infer<typeof CreatePublicOrderBodySchema>;
export type CreatePublicOrderResponse = z.infer<typeof CreatePublicOrderResponseSchema>;
