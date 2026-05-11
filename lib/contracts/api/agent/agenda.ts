/**
 * lib/contracts/api/agent/agenda.ts
 *
 * Contratos para /api/agent/tools/agenda (PILOT da Fase 1 do SDD).
 *
 * 11 actions: list_services, list_professionals, check_availability, get_next_available,
 *             book, list_by_client, list_upcoming, list_today, get, update, cancel
 *
 * Cada action tem ParamsSchema e ResponseDataSchema.
 * O dispatcher exporta `AgendaToolRequestSchema` (union por action) que o handler
 * pode parsear e estreitar via discriminação `params.action`.
 */

import { z } from 'zod';
import {
  AppointmentStatusSchema,
  ChannelTypeSchema,
  DocIdSchema,
  PhoneSchema,
  TimestampsSchema,
  agentToolResponse,
} from './_shared';

// ============================================================================
// Sub-schemas reusados
// ============================================================================

const DateYmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
const TimeHmSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM (24h)');

export const AvailabilitySlotSchema = z.object({
  startTime: TimeHmSchema,
  endTime: TimeHmSchema,
  professionalId: DocIdSchema.optional(),
  professionalName: z.string().optional(),
});

export const AgendaServiceShortSchema = z.object({
  id: DocIdSchema,
  name: z.string(),
  isActive: z.boolean(),
  duration: z.number().int().positive().optional(),
  price: z.number().nonnegative().optional(),
  category: z.string().optional(),
  commissionRate: z.number().min(0).max(100).optional(),
});

export const AgendaProfessionalSchema = z.object({
  id: DocIdSchema,
  name: z.string(),
  role: z.string().optional(),
  serviceIds: z.array(DocIdSchema).default([]),
});

export const AppointmentShortSchema = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  clientId: DocIdSchema.optional(),
  clientName: z.string().optional(),
  clientPhone: z.string().optional(),
  serviceId: DocIdSchema.optional(),
  serviceName: z.string().optional(),
  professionalId: DocIdSchema.optional(),
  professionalName: z.string().optional(),
  date: DateYmdSchema,
  startTime: TimeHmSchema,
  endTime: TimeHmSchema,
  duration: z.number().int().positive(),
  status: AppointmentStatusSchema,
  price: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  channelType: ChannelTypeSchema.optional(),
  conversationId: DocIdSchema.optional(),
}).merge(TimestampsSchema.partial());

// ============================================================================
// Actions — Params + Response data
// ============================================================================

// ---------- list_services ----------
export const ListServicesParamsSchema = z.object({}).strict();
export const ListServicesDataSchema = z.array(AgendaServiceShortSchema);

// ---------- list_professionals ----------
export const ListProfessionalsParamsSchema = z.object({
  serviceId: DocIdSchema.optional(),
}).strict();
export const ListProfessionalsDataSchema = z.array(AgendaProfessionalSchema);

// ---------- check_availability ----------
export const CheckAvailabilityParamsSchema = z.object({
  date: DateYmdSchema,
  professionalId: DocIdSchema.optional(),
  serviceId: DocIdSchema.optional(),
  durationMinutes: z.number().int().positive().max(720).default(60),
}).strict();

export const CheckAvailabilityDataSchema = z.object({
  date: DateYmdSchema,
  slots: z.array(AvailabilitySlotSchema),
});

// ---------- get_next_available ----------
export const GetNextAvailableParamsSchema = z.object({
  serviceId: DocIdSchema.optional(),
  professionalId: DocIdSchema.optional(),
  durationMinutes: z.number().int().positive().max(720).default(60),
  daysAhead: z.number().int().positive().max(60).default(7),
  fromDate: DateYmdSchema.optional(),
}).strict();

export const GetNextAvailableDataSchema = z.object({
  date: DateYmdSchema.nullable(),
  slots: z.array(AvailabilitySlotSchema),
  searchedDays: z.number().int().nonnegative(),
});

// ---------- book ----------
export const BookParamsSchema = z.object({
  clientName: z.string().min(1).max(200),
  clientPhone: PhoneSchema.optional(),
  clientId: DocIdSchema.optional(),
  serviceId: DocIdSchema.optional(),
  serviceName: z.string().optional(),
  professionalId: DocIdSchema.optional(),
  professionalName: z.string().optional(),
  date: DateYmdSchema,
  startTime: TimeHmSchema,
  durationMinutes: z.number().int().positive().max(720),
  price: z.number().nonnegative().optional(),
  notes: z.string().max(2000).optional(),
  channelType: ChannelTypeSchema.optional(),
  conversationId: DocIdSchema.optional(),
}).strict().superRefine((data, ctx) => {
  // Precisa de pelo menos uma forma de identificar o cliente
  if (!data.clientId && !data.clientPhone) {
    ctx.addIssue({
      code: 'custom',
      message: 'clientId ou clientPhone obrigatório',
      path: ['clientPhone'],
    });
  }
});

export const BookDataSchema = z.object({
  id: DocIdSchema,
  status: z.enum(['created', 'exists']),
  date: DateYmdSchema,
  startTime: TimeHmSchema,
  endTime: TimeHmSchema,
  serviceName: z.string(),
  professionalName: z.string().optional(),
});

// ---------- list_by_client ----------
export const ListByClientParamsSchema = z.object({
  clientId: DocIdSchema.optional(),
  phone: PhoneSchema.optional(),
  limit: z.number().int().min(1).max(100).default(10),
}).strict().superRefine((data, ctx) => {
  if (!data.clientId && !data.phone) {
    ctx.addIssue({ code: 'custom', message: 'clientId ou phone obrigatório', path: ['phone'] });
  }
});
export const ListByClientDataSchema = z.array(AppointmentShortSchema);

// ---------- list_upcoming ----------
export const ListUpcomingParamsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  daysAhead: z.number().int().min(1).max(60).default(7),
  professionalId: DocIdSchema.optional(),
}).strict();
export const ListUpcomingDataSchema = z.array(AppointmentShortSchema);

// ---------- list_today ----------
export const ListTodayParamsSchema = z.object({}).strict();
export const ListTodayDataSchema = z.array(AppointmentShortSchema);

// ---------- get ----------
export const GetParamsSchema = z.object({ id: DocIdSchema }).strict();
export const GetDataSchema = AppointmentShortSchema.nullable();

// ---------- update ----------
export const UpdateParamsSchema = z.object({
  id: DocIdSchema,
  patch: z.object({
    date: DateYmdSchema.optional(),
    startTime: TimeHmSchema.optional(),
    endTime: TimeHmSchema.optional(),
    duration: z.number().int().positive().max(720).optional(),
    status: AppointmentStatusSchema.optional(),
    notes: z.string().max(2000).optional(),
  }).strict(),
}).strict();
export const UpdateDataSchema = AppointmentShortSchema;

// ---------- cancel ----------
export const CancelParamsSchema = z.object({ id: DocIdSchema }).strict();
export const CancelDataSchema = z.object({
  id: DocIdSchema,
  status: z.literal('cancelado'),
});

// ============================================================================
// Discriminated union do request body inteiro
// ============================================================================

export const AgendaToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_services'),       params: ListServicesParamsSchema }),
  z.object({ action: z.literal('list_professionals'),  params: ListProfessionalsParamsSchema }),
  z.object({ action: z.literal('check_availability'),  params: CheckAvailabilityParamsSchema }),
  z.object({ action: z.literal('get_next_available'),  params: GetNextAvailableParamsSchema }),
  z.object({ action: z.literal('book'),                params: BookParamsSchema }),
  z.object({ action: z.literal('list_by_client'),      params: ListByClientParamsSchema }),
  z.object({ action: z.literal('list_upcoming'),       params: ListUpcomingParamsSchema }),
  z.object({ action: z.literal('list_today'),          params: ListTodayParamsSchema }),
  z.object({ action: z.literal('get'),                 params: GetParamsSchema }),
  z.object({ action: z.literal('update'),              params: UpdateParamsSchema }),
  z.object({ action: z.literal('cancel'),              params: CancelParamsSchema }),
]);

export type AgendaToolRequest = z.infer<typeof AgendaToolRequestSchema>;
export type AgendaToolAction = AgendaToolRequest['action'];

/** Mapa de action → schema da response data (pra validação no executor Python e no withContract). */
export const AGENDA_DATA_SCHEMAS = {
  list_services:       ListServicesDataSchema,
  list_professionals:  ListProfessionalsDataSchema,
  check_availability:  CheckAvailabilityDataSchema,
  get_next_available:  GetNextAvailableDataSchema,
  book:                BookDataSchema,
  list_by_client:      ListByClientDataSchema,
  list_upcoming:       ListUpcomingDataSchema,
  list_today:          ListTodayDataSchema,
  get:                 GetDataSchema,
  update:              UpdateDataSchema,
  cancel:              CancelDataSchema,
} as const satisfies Record<AgendaToolAction, z.ZodTypeAny>;

/** Response envelope completo (success + error). */
export const AgendaToolResponseSchema = z.union([
  agentToolResponse(ListServicesDataSchema),
  agentToolResponse(ListProfessionalsDataSchema),
  agentToolResponse(CheckAvailabilityDataSchema),
  agentToolResponse(GetNextAvailableDataSchema),
  agentToolResponse(BookDataSchema),
  agentToolResponse(ListByClientDataSchema),
  agentToolResponse(ListUpcomingDataSchema),
  agentToolResponse(ListTodayDataSchema),
  agentToolResponse(GetDataSchema),
  agentToolResponse(UpdateDataSchema),
  agentToolResponse(CancelDataSchema),
]);
