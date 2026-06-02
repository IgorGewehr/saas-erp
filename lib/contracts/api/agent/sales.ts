/**
 * lib/contracts/api/agent/sales.ts — /api/agent/tools/sales
 * Actions: list, get, list_by_client, create, cancel, summary_today
 */

import { z } from 'zod';
import { ChannelTypeSchema, DocIdSchema, MoneySchema, PaymentMethodSchema, SaleStatusSchema } from './_shared';

const SaleItemInputSchema = z.object({
  productId: DocIdSchema.optional(),
  serviceId: DocIdSchema.optional(),
  description: z.string().min(1).max(200),
  quantity: z.number().positive(),
  unitPrice: MoneySchema,
  discount: MoneySchema.optional(),
  total: MoneySchema.optional(),
}).superRefine((it, ctx) => {
  if (!it.productId && !it.serviceId) {
    ctx.addIssue({ code: 'custom', message: 'productId ou serviceId obrigatório', path: ['productId'] });
  }
});

const PaymentSchema = z.object({
  method: PaymentMethodSchema,
  amount: MoneySchema,
}).passthrough();

const SaleShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  status: SaleStatusSchema,
  subtotal: MoneySchema,
  total: MoneySchema,
  discount: MoneySchema.optional(),
  tip: MoneySchema.optional(),
  items: z.array(z.unknown()),
  payments: z.array(z.unknown()),
}).passthrough();

const DateYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SalesListParamsSchema = z.object({
  status: SaleStatusSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export const SalesListDataSchema = z.array(SaleShape);

export const SalesGetParamsSchema = z.object({ id: DocIdSchema });
export const SalesGetDataSchema = SaleShape.nullable();

export const SalesListByClientParamsSchema = z.object({
  clientId: DocIdSchema,
  limit: z.number().int().min(1).max(100).default(20),
});
export const SalesListByClientDataSchema = z.array(SaleShape);

export const SalesCreateParamsSchema = z.object({
  clientId: DocIdSchema.optional(),
  // Aliases aceitos no boundary (P2.10) — normalizados pra clientId via resolveClientId.
  contactId: DocIdSchema.optional(),
  crmContactId: DocIdSchema.optional(),
  clientName: z.string().max(200).optional(),
  items: z.array(SaleItemInputSchema).min(1),
  payments: z.array(PaymentSchema).min(1),
  subtotal: MoneySchema.optional(),
  discount: MoneySchema.default(0),
  tip: MoneySchema.default(0),
  total: MoneySchema.optional(),
  status: SaleStatusSchema.default('finalizada'),
  notes: z.string().max(500).optional(),
  operatorId: z.string().default('agent'),
  operatorName: z.string().default('Agente IA'),
  channelType: ChannelTypeSchema.optional(),
  conversationId: DocIdSchema.optional(),
  // FKs de resultado (P2.10) — origem conhecida que esta venda concretizou.
  dealId: DocIdSchema.optional(),
  appointmentId: DocIdSchema.optional(),
});
export const SalesCreateDataSchema = SaleShape;

export const SalesCancelParamsSchema = z.object({
  id: DocIdSchema,
  reason: z.string().max(500).optional(),
});
export const SalesCancelDataSchema = SaleShape;

export const SalesSummaryTodayParamsSchema = z.object({});
export const SalesSummaryTodayDataSchema = z.object({
  date: DateYmd,
  revenue: MoneySchema,
  totalDiscount: MoneySchema,
  avgTicket: MoneySchema,
  saleCount: z.number().int().nonnegative(),
  cancelledCount: z.number().int().nonnegative(),
  byPaymentMethod: z.array(z.object({
    method: PaymentMethodSchema,
    amount: MoneySchema,
  })),
});

export const SalesToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'),           params: SalesListParamsSchema }),
  z.object({ action: z.literal('get'),            params: SalesGetParamsSchema }),
  z.object({ action: z.literal('list_by_client'), params: SalesListByClientParamsSchema }),
  z.object({ action: z.literal('create'),         params: SalesCreateParamsSchema }),
  z.object({ action: z.literal('cancel'),         params: SalesCancelParamsSchema }),
  z.object({ action: z.literal('summary_today'),  params: SalesSummaryTodayParamsSchema }),
]);

export const SALES_DATA_SCHEMAS = {
  list:           SalesListDataSchema,
  get:            SalesGetDataSchema,
  list_by_client: SalesListByClientDataSchema,
  create:         SalesCreateDataSchema,
  cancel:         SalesCancelDataSchema,
  summary_today:  SalesSummaryTodayDataSchema,
} as const;
