/**
 * lib/contracts/api/v1/sales.ts — POST/GET /api/v1/sales
 * Auth: Bearer SaasApiKey (scopes read:sales, write:sales)
 */

import { z } from 'zod';
import {
  ApiKeyAuthHeaderSchema,
  ErrorEnvelopeSchema,
  IdempotencyHeaderSchema,
  PaginationMetaSchema,
  PaginationQuerySchema,
  successEnvelope,
} from '../_envelope';
import {
  PaymentMethodSchema,
  PaymentSchema,
  SaleSchema,
  SaleStatusSchema,
} from '../../domain/sale';
import { SelectedModifierSchema } from '../../domain/deliveryOrder';

// ─── Request input para criação ─────────────────────────────────────────────
// Mais permissivo que SaleSchema (cliente não envia id, createdAt, totais derivados).
// Server preenche id, businessId, createdAt, updatedAt, operatorId/Name (do auth).

const SaleItemInputSchema = z.object({
  productId: z.string().optional(),
  serviceId: z.string().optional(),
  variantId: z.string().optional(),
  description: z.string().min(1).max(300),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  basePrice: z.number().nonnegative().optional(),
  selectedModifiers: z.array(SelectedModifierSchema).optional(),
  notes: z.string().max(500).optional(),
  total: z.number().nonnegative().optional(), // server pode recomputar
}).superRefine((it, ctx) => {
  if (!it.productId && !it.serviceId) {
    ctx.addIssue({ code: 'custom', message: 'productId ou serviceId obrigatório', path: ['productId'] });
  }
});

export const CreateSaleBodySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().max(200).optional(),
  items: z.array(SaleItemInputSchema).min(1),
  payments: z.array(PaymentSchema).min(1),
  discount: z.number().nonnegative().default(0),
  discountReason: z.string().min(3).max(300).optional(),
  tip: z.number().nonnegative().optional(),
  status: SaleStatusSchema.default('finalizada'),
  notes: z.string().max(2000).optional(),
  channelType: z.enum(['whatsapp', 'facebook', 'instagram']).optional(),
  conversationId: z.string().optional(),
  sectorId: z.string().optional(),
});

export const CreateSaleHeadersSchema = ApiKeyAuthHeaderSchema.merge(IdempotencyHeaderSchema);

export const CreateSaleResponseSchema = z.union([
  successEnvelope(SaleSchema),
  ErrorEnvelopeSchema,
]);

// ─── List query ─────────────────────────────────────────────────────────────

export const ListSalesQuerySchema = PaginationQuerySchema.extend({
  status: SaleStatusSchema.optional(),
  clientId: z.string().optional(),
  operatorId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const ListSalesResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    data: z.array(SaleSchema),
    pagination: PaginationMetaSchema,
  }),
  ErrorEnvelopeSchema,
]);

// ─── Get by id ──────────────────────────────────────────────────────────────

export const GetSaleParamsSchema = z.object({ id: z.string().min(1) });
export const GetSaleResponseSchema = z.union([
  successEnvelope(SaleSchema.nullable()),
  ErrorEnvelopeSchema,
]);

// ─── Cancel ─────────────────────────────────────────────────────────────────

export const CancelSaleParamsSchema = z.object({ id: z.string().min(1) });
export const CancelSaleBodySchema = z.object({
  reason: z.string().max(500).optional(),
});
export const CancelSaleResponseSchema = z.union([
  successEnvelope(SaleSchema),
  ErrorEnvelopeSchema,
]);

export type CreateSaleBody = z.infer<typeof CreateSaleBodySchema>;
export type CreateSaleResponse = z.infer<typeof CreateSaleResponseSchema>;
