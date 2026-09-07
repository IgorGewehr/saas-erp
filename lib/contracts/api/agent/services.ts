/**
 * lib/contracts/api/agent/services.ts — /api/agent/tools/services
 * Actions: list, get, search, create, update, set_active, import_grade
 */

import { z } from 'zod';
import { DocIdSchema, MoneySchema } from './_shared';
import { WeeklySessionSchema, ServiceCapacitySchema } from '../../domain/service';

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
  // Fiscal opcional + turmas (M06.7) — cobertos via passthrough acima, mas
  // declarados aqui pra deixar explícito o shape real gravado pelo handler.
  lc116Code: z.string().optional(),
  codigoMunicipal: z.string().optional(),
  nbs: z.string().optional(),
  aliquotaISS: z.number().min(0).max(100).optional(),
  capacity: ServiceCapacitySchema.optional(),
  sessions: z.array(WeeklySessionSchema).optional(),
  isActive: z.boolean(),
}).passthrough();

// Campos fiscais/turma opcionais compartilhados entre create e update — extraídos
// pra não duplicar a definição (achado: ambos precisam do mesmo shape que o
// handler de fato lê de `CreateParams`/`WRITEABLE` em route.ts).
const ServiceFiscalAndGroupFields = {
  lc116Code: z.string().optional(),
  codigoMunicipal: z.string().optional(),
  nbs: z.string().optional(),
  aliquotaISS: z.number().min(0).max(100).optional(),
  capacity: ServiceCapacitySchema.optional(),
  sessions: z.array(WeeklySessionSchema).max(200).optional(),
};

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
  ...ServiceFiscalAndGroupFields,
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
  // Achado: sem estes campos aqui, `createService` (route.ts) os lê de
  // `CreateParams` normalmente mas o Zod (modo strip, default do z.object)
  // descartava silenciosamente antes de chegar no handler — turmas e campos
  // fiscais informados pelo agente IA nunca eram persistidos.
  ...ServiceFiscalAndGroupFields,
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

export const ServicesImportGradeParamsSchema = z.object({
  /** Texto da grade. Se omitido, o handler usa business.settings.aiAgent.businessDescription. */
  text: z.string().optional(),
  /** false (padrão) = dry-run/preview; true = grava os serviços. */
  apply: z.boolean().optional(),
  defaultCapacity: z.number().int().positive().optional(),
  defaultDuration: z.number().int().positive().optional(),
  matchOnly: z.boolean().optional(),
});
export const ServicesImportGradeDataSchema = z.object({
  applied: z.boolean(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  items: z.array(z.object({
    name: z.string(),
    sessionCount: z.number().int().nonnegative(),
    action: z.enum(['create', 'update', 'skip']),
    matchedServiceId: DocIdSchema.optional(),
  })),
});

export const ServicesToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'),         params: ServicesListParamsSchema }),
  z.object({ action: z.literal('get'),          params: ServicesGetParamsSchema }),
  z.object({ action: z.literal('search'),       params: ServicesSearchParamsSchema }),
  z.object({ action: z.literal('create'),       params: ServicesCreateParamsSchema }),
  z.object({ action: z.literal('update'),       params: ServicesUpdateParamsSchema }),
  z.object({ action: z.literal('set_active'),   params: ServicesSetActiveParamsSchema }),
  z.object({ action: z.literal('import_grade'), params: ServicesImportGradeParamsSchema }),
]);

export const SERVICES_DATA_SCHEMAS = {
  list:         ServicesListDataSchema,
  get:          ServicesGetDataSchema,
  search:       ServicesSearchDataSchema,
  create:       ServicesCreateDataSchema,
  update:       ServicesUpdateDataSchema,
  set_active:   ServicesSetActiveDataSchema,
  import_grade: ServicesImportGradeDataSchema,
} as const;
