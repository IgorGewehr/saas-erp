/**
 * lib/contracts/api/agent/orders.ts — contratos /api/agent/tools/orders
 * Actions: create, get, list_by_client, update_status, update_items, cancel, list_recent
 */

import { z } from 'zod';
import {
  ChannelTypeSchema,
  DeliveryOrderStatusSchema,
  DocIdSchema,
  MoneySchema,
  PaymentMethodSchema,
  PhoneSchema,
} from './_shared';

const OrderItemInputSchema = z.object({
  productId: DocIdSchema,
  quantity: z.number().int().positive(),
  notes: z.string().max(500).optional(),
});

const AddressSchema = z.object({
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
  pontoReferencia: z.string().optional(),
}).passthrough();

const DeliveryOrderShapeSchema = z.object({
  id: DocIdSchema,
  number: z.number().int().nonnegative(),
  status: DeliveryOrderStatusSchema,
  total: MoneySchema,
  subtotal: MoneySchema,
}).passthrough();

// ---------- create ----------
export const OrdersCreateParamsSchema = z.object({
  clientName: z.string().min(1).max(200),
  clientPhone: PhoneSchema.optional(),
  clientId: DocIdSchema.optional(),
  items: z.array(OrderItemInputSchema).min(1),
  deliveryType: z.enum(['entrega', 'retirada']),
  deliveryAddress: AddressSchema.optional(),
  deliveryFee: MoneySchema.optional(),
  discount: MoneySchema.optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  paymentStatus: z.string().default('pendente'),
  changeFor: MoneySchema.optional(),
  customerNotes: z.string().max(1000).optional(),
  estimatedMinutes: z.number().int().positive().max(720).default(45),
  channel: ChannelTypeSchema.optional(),
  conversationId: DocIdSchema.optional(),
  contactExternalId: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.deliveryType === 'entrega' && !data.deliveryAddress) {
    ctx.addIssue({ code: 'custom', message: 'deliveryAddress obrigatório quando deliveryType=entrega', path: ['deliveryAddress'] });
  }
});
export const OrdersCreateDataSchema = z.object({
  id: DocIdSchema,
  number: z.number().int().nonnegative(),
  total: MoneySchema,
  subtotal: MoneySchema,
  estimatedDeliveryAt: z.string().datetime(),
});

// ---------- get ----------
export const OrdersGetParamsSchema = z.object({ id: DocIdSchema });
export const OrdersGetDataSchema = DeliveryOrderShapeSchema.nullable();

// ---------- list_by_client ----------
export const OrdersListByClientParamsSchema = z.object({
  clientId: DocIdSchema.optional(),
  phone: PhoneSchema.optional(),
  limit: z.number().int().min(1).max(100).default(10),
}).superRefine((d, ctx) => {
  if (!d.clientId && !d.phone) ctx.addIssue({ code: 'custom', message: 'clientId ou phone obrigatório', path: ['clientId'] });
});
export const OrdersListByClientDataSchema = z.array(DeliveryOrderShapeSchema);

// ---------- update_status ----------
export const OrdersUpdateStatusParamsSchema = z.object({
  id: DocIdSchema,
  status: DeliveryOrderStatusSchema,
});
export const OrdersUpdateStatusDataSchema = z.object({
  id: DocIdSchema,
  status: DeliveryOrderStatusSchema,
  deliveredAt: z.string().datetime().optional(),
});

// ---------- update_items ----------
export const OrdersUpdateItemsParamsSchema = z.object({
  id: DocIdSchema,
  items: z.array(OrderItemInputSchema).min(1),
});
export const OrdersUpdateItemsDataSchema = z.object({
  id: DocIdSchema,
  itemsCount: z.number().int().nonnegative(),
  subtotal: MoneySchema,
  total: MoneySchema,
});

// ---------- cancel ----------
export const OrdersCancelParamsSchema = z.object({
  id: DocIdSchema,
  reason: z.string().max(500).optional(),
});
export const OrdersCancelDataSchema = z.object({
  id: DocIdSchema,
  status: z.literal('cancelado'),
});

// ---------- list_recent ----------
export const OrdersListRecentParamsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});
export const OrdersListRecentDataSchema = z.array(DeliveryOrderShapeSchema);

export const OrdersToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'),         params: OrdersCreateParamsSchema }),
  z.object({ action: z.literal('get'),            params: OrdersGetParamsSchema }),
  z.object({ action: z.literal('list_by_client'), params: OrdersListByClientParamsSchema }),
  z.object({ action: z.literal('update_status'),  params: OrdersUpdateStatusParamsSchema }),
  z.object({ action: z.literal('update_items'),   params: OrdersUpdateItemsParamsSchema }),
  z.object({ action: z.literal('cancel'),         params: OrdersCancelParamsSchema }),
  z.object({ action: z.literal('list_recent'),    params: OrdersListRecentParamsSchema }),
]);

export const ORDERS_DATA_SCHEMAS = {
  create:         OrdersCreateDataSchema,
  get:            OrdersGetDataSchema,
  list_by_client: OrdersListByClientDataSchema,
  update_status:  OrdersUpdateStatusDataSchema,
  update_items:   OrdersUpdateItemsDataSchema,
  cancel:         OrdersCancelDataSchema,
  list_recent:    OrdersListRecentDataSchema,
} as const;
