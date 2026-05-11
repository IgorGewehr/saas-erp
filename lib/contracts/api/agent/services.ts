/**
 * lib/contracts/api/agent/services.ts — /api/agent/tools/services
 * Actions: list, get, search, create, update, set_active
 */

import { z } from 'zod';
import { DocIdSchema, MoneySchema } from './_shared';

const ServiceShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  userId: DocIdSchema.optional(),
  userName: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  duration: z.number().int().positive(),
  price: MoneySchema,
  category: z.string().optional(),
  color: z.string().optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  isActive: z.boolean(),
}).passthrough();

const ServicePatch = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  duration: z.number().int().positive().max(720).optional(),
  price: MoneySchema.optional(),
  category: z.string().max(100).optional(),
  color: z.string().max(20).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  userId: DocIdSchema.optional(),
  userName: z.string().optional(),
}).strict();

export const ServicesListParamsSchema = z.object({
  includeInactive: z.boolean().optional(),
  category: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export const ServicesListDataSchema = z.array(ServiceShape);

export const ServicesGetParamsSchema = z.object({ id: DocIdSchema });
export const ServicesGetDataSchema = ServiceShape.nullable();

export const ServicesSearchParamsSchema = z.object({
  query: z.string().min(1),
  includeInactive: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export const ServicesSearchDataSchema = z.array(ServiceShape.extend({ _score: z.number() }));

export const ServicesCreateParamsSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  duration: z.number().int().positive().max(720),
  price: MoneySchema,
  category: z.string().max(100).optional(),
  color: z.string().max(20).default('#ef4444'),
  commissionRate: z.number().min(0).max(100).optional(),
  userId: DocIdSchema.optional(),
  userName: z.string().optional(),
});
export const ServicesCreateDataSchema = ServiceShape;

export const ServicesUpdateParamsSchema = z.object({
  id: DocIdSchema,
  patch: ServicePatch,
});
export const ServicesUpdateDataSchema = ServiceShape;

export const ServicesSetActiveParamsSchema = z.object({
  id: DocIdSchema,
  isActive: z.boolean(),
});
export const ServicesSetActiveDataSchema = ServiceShape;

export const ServicesToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'),       params: ServicesListParamsSchema }),
  z.object({ action: z.literal('get'),        params: ServicesGetParamsSchema }),
  z.object({ action: z.literal('search'),     params: ServicesSearchParamsSchema }),
  z.object({ action: z.literal('create'),     params: ServicesCreateParamsSchema }),
  z.object({ action: z.literal('update'),     params: ServicesUpdateParamsSchema }),
  z.object({ action: z.literal('set_active'), params: ServicesSetActiveParamsSchema }),
]);

export const SERVICES_DATA_SCHEMAS = {
  list:       ServicesListDataSchema,
  get:        ServicesGetDataSchema,
  search:     ServicesSearchDataSchema,
  create:     ServicesCreateDataSchema,
  update:     ServicesUpdateDataSchema,
  set_active: ServicesSetActiveDataSchema,
} as const;
