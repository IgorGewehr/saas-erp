/**
 * lib/contracts/api/agent/clients.ts — /api/agent/tools/clients
 * Actions: lookup_by_phone, create, get, update, update_address, get_full_history
 */

import { z } from 'zod';
import { ChannelTypeSchema, DocIdSchema, LeadStatusSchema, LifecycleStageSchema, MoneySchema, PhoneSchema } from './_shared';

const ClientShapeSchema = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  name: z.string(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  company: z.string().optional(),
  status: LeadStatusSchema.optional(),
  lifecycleStage: LifecycleStageSchema.optional(),
  source: z.string().optional(),
  score: z.number().nonnegative().optional(),
  totalSpent: MoneySchema.optional(),
  visitCount: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
}).passthrough();

const AddressSchema = z.object({
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
}).passthrough();

// ---------- lookup_by_phone ----------
export const ClientsLookupByPhoneParamsSchema = z.object({ phone: PhoneSchema });
export const ClientsLookupByPhoneDataSchema = ClientShapeSchema.nullable();

// ---------- create ----------
export const ClientsCreateParamsSchema = z.object({
  name: z.string().min(1).max(200),
  phone: PhoneSchema.optional(),
  whatsapp: PhoneSchema.optional(),
  email: z.string().email().optional(),
  source: z.string().default('whatsapp'),
  channel: ChannelTypeSchema.optional(),
  externalId: z.string().optional(),
});
export const ClientsCreateDataSchema = ClientShapeSchema;

// ---------- get ----------
export const ClientsGetParamsSchema = z.object({ id: DocIdSchema });
export const ClientsGetDataSchema = ClientShapeSchema.nullable();

// ---------- update ----------
const ClientUpdateAllowedPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: PhoneSchema.optional(),
  whatsapp: PhoneSchema.optional(),
  company: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string()).optional(),
  status: LeadStatusSchema.optional(),
  lifecycleStage: LifecycleStageSchema.optional(),
  source: z.string().optional(),
  preferredChannel: z.string().optional(),
  optInMarketing: z.boolean().optional(),
  birthDate: z.string().optional(),
  gender: z.string().optional(),
  aiSummary: z.string().max(10000).optional(),
}).strict();
export const ClientsUpdateParamsSchema = z.object({
  id: DocIdSchema,
  patch: ClientUpdateAllowedPatch,
});
export const ClientsUpdateDataSchema = ClientShapeSchema;

// ---------- update_address ----------
export const ClientsUpdateAddressParamsSchema = z.object({
  id: DocIdSchema,
  address: AddressSchema,
});
export const ClientsUpdateAddressDataSchema = z.object({
  id: DocIdSchema,
  endereco: AddressSchema,
});

// ---------- get_full_history ----------
export const ClientsGetFullHistoryParamsSchema = z.object({ id: DocIdSchema });
export const ClientsGetFullHistoryDataSchema = z.object({
  client: ClientShapeSchema,
  orders: z.array(z.object({
    id: DocIdSchema,
    number: z.number().int().nonnegative(),
    status: z.string(),
    total: MoneySchema,
    createdAt: z.string(),
    items: z.array(z.string()),
  }).passthrough()),
  appointments: z.array(z.object({
    id: DocIdSchema,
    date: z.string(),
    startTime: z.string(),
    serviceName: z.string().optional(),
    professionalName: z.string().optional(),
    status: z.string(),
    price: MoneySchema.optional(),
  }).passthrough()),
  stats: z.object({
    totalOrders: z.number().int().nonnegative(),
    totalAppointments: z.number().int().nonnegative(),
    totalSpent: MoneySchema,
    visitCount: z.number().int().nonnegative(),
    lastVisit: z.string().nullable(),
  }),
});

export const ClientsToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('lookup_by_phone'),  params: ClientsLookupByPhoneParamsSchema }),
  z.object({ action: z.literal('create'),           params: ClientsCreateParamsSchema }),
  z.object({ action: z.literal('get'),              params: ClientsGetParamsSchema }),
  z.object({ action: z.literal('update'),           params: ClientsUpdateParamsSchema }),
  z.object({ action: z.literal('update_address'),   params: ClientsUpdateAddressParamsSchema }),
  z.object({ action: z.literal('get_full_history'), params: ClientsGetFullHistoryParamsSchema }),
]);

export const CLIENTS_DATA_SCHEMAS = {
  lookup_by_phone:  ClientsLookupByPhoneDataSchema,
  create:           ClientsCreateDataSchema,
  get:              ClientsGetDataSchema,
  update:           ClientsUpdateDataSchema,
  update_address:   ClientsUpdateAddressDataSchema,
  get_full_history: ClientsGetFullHistoryDataSchema,
} as const;
