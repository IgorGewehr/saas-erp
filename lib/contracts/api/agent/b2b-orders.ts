/**
 * lib/contracts/api/agent/b2b-orders.ts — /api/agent/tools/b2b-orders
 * Actions: create, get, list_by_client
 *
 * Pedido B2B/condicional (M02.6) — domínio SEPARADO do tool `orders`
 * (que é DeliveryOrder). Deliberadamente SEM update_status/cancel: essas
 * transições disparam efeitos reais (dedução de estoque, lançamento de
 * receita) — mesma decisão de segurança do M02.5c (agente não aplica
 * desconto manual): dar ao LLM o poder de faturar/cancelar um pedido B2B
 * via conversa é superfície real de manipulação (prompt injection movendo
 * estoque/dinheiro). Transições ficam só na rota autenticada
 * (/api/v1/orders/{id}/transition) e na futura UI.
 */

import { z } from 'zod';
import { DocIdSchema, MoneySchema } from './_shared';

const OrderItemInputSchema = z.object({
  productId: DocIdSchema.optional(),
  serviceId: DocIdSchema.optional(),
  variantId: DocIdSchema.optional(),
  quantity: z.number().positive(),
  notes: z.string().max(500).optional(),
}).superRefine((item, ctx) => {
  if (Boolean(item.productId) === Boolean(item.serviceId)) {
    ctx.addIssue({ code: 'custom', message: 'Informe productId ou serviceId, exclusivamente.', path: ['productId'] });
  }
});

const OrderShapeSchema = z.object({
  id: DocIdSchema,
  type: z.enum(['pdv', 'b2b', 'condicional']),
  status: z.enum(['pendente', 'confirmado', 'condicional', 'faturado', 'enviado', 'entregue', 'cancelado']),
  clientId: DocIdSchema.optional(),
  clientName: z.string().optional(),
  subtotal: MoneySchema,
  discount: MoneySchema,
  total: MoneySchema,
}).passthrough();

// ---------- create ----------
export const B2bOrdersCreateParamsSchema = z.object({
  type: z.enum(['b2b', 'condicional']),
  clientId: DocIdSchema.optional(),
  clientName: z.string().min(1).max(200).optional(),
  clientCpfCnpj: z.string().min(1).max(20).optional(),
  items: z.array(OrderItemInputSchema).min(1).max(100),
  paymentTerms: z.string().max(200).optional(),
  installments: z.number().int().min(1).max(48).default(1),
  conditionalExpiresAt: z.string().optional(),
  notes: z.string().max(2000).optional(),
  conversationId: DocIdSchema.optional(),
}).superRefine((data, ctx) => {
  if (data.type === 'condicional' && !data.conditionalExpiresAt) {
    ctx.addIssue({ code: 'custom', message: 'type=condicional exige conditionalExpiresAt.', path: ['conditionalExpiresAt'] });
  }
});
export const B2bOrdersCreateDataSchema = z.object({
  id: DocIdSchema,
  status: z.literal('pendente'),
  subtotal: MoneySchema,
  discount: MoneySchema,
  total: MoneySchema,
});

// ---------- get ----------
export const B2bOrdersGetParamsSchema = z.object({ id: DocIdSchema });
export const B2bOrdersGetDataSchema = OrderShapeSchema.nullable();

// ---------- list_by_client ----------
export const B2bOrdersListByClientParamsSchema = z.object({
  clientId: DocIdSchema,
  limit: z.number().int().min(1).max(100).default(10),
});
export const B2bOrdersListByClientDataSchema = z.array(OrderShapeSchema);

export const B2bOrdersToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'),         params: B2bOrdersCreateParamsSchema }),
  z.object({ action: z.literal('get'),            params: B2bOrdersGetParamsSchema }),
  z.object({ action: z.literal('list_by_client'), params: B2bOrdersListByClientParamsSchema }),
]);

export const B2B_ORDERS_DATA_SCHEMAS = {
  create:         B2bOrdersCreateDataSchema,
  get:            B2bOrdersGetDataSchema,
  list_by_client: B2bOrdersListByClientDataSchema,
};
