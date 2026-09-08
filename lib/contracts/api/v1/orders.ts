/**
 * lib/contracts/api/v1/orders.ts — POST/GET /api/v1/orders, PATCH /api/v1/orders/{id}/transition
 * Auth: Bearer SaasApiKey (scopes read:orders, write:orders)
 *
 * Order (B2B/condicional) — ver lib/contracts/domain/order.ts. Client manda
 * só INTENÇÃO de item (productId/serviceId/variantId/quantity); preço é
 * sempre resolvido/revalidado no servidor pela cotação comercial (R6).
 */

import { z } from 'zod';
import { CommercialQuoteLineRequestSchema } from '../../domain/commercialV2';
import { OrderTypeSchema, OrderStatusSchema } from '../../domain/order';
import { PaymentMethodSchema } from '../../domain/sale';

export const CreateOrderBodySchema = z.object({
  type: OrderTypeSchema,
  clientId: z.string().min(1).optional(),
  clientName: z.string().trim().min(1).max(200).optional(),
  clientCpfCnpj: z.string().min(1).max(20).optional(),
  items: z.array(CommercialQuoteLineRequestSchema).min(1).max(100),
  discount: z.number().nonnegative().optional(),
  discountReason: z.string().min(3).max(300).optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  paymentTerms: z.string().max(200).optional(),
  installments: z.number().int().min(1).max(48).default(1),
  deliveryDate: z.string().optional(),
  deliveryAddress: z.object({
    logradouro: z.string().optional(),
    numero: z.string().optional(),
    complemento: z.string().optional(),
    bairro: z.string().optional(),
    municipio: z.string().optional(),
    uf: z.string().length(2).optional(),
    cep: z.string().optional(),
  }).passthrough().optional(),
  conditionalExpiresAt: z.string().optional(),
  notes: z.string().max(5000).optional(),
  internalNotes: z.string().max(5000).optional(),
  sectorId: z.string().optional(),
}).superRefine((body, ctx) => {
  if (body.type === 'condicional' && !body.conditionalExpiresAt) {
    ctx.addIssue({ code: 'custom', message: 'type=condicional exige conditionalExpiresAt.', path: ['conditionalExpiresAt'] });
  }
});
export type CreateOrderBody = z.infer<typeof CreateOrderBodySchema>;

export const TransitionOrderBodySchema = z.object({
  targetStatus: OrderStatusSchema,
  reason: z.string().max(500).optional(),
});
export type TransitionOrderBody = z.infer<typeof TransitionOrderBodySchema>;
