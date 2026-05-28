/**
 * lib/contracts/domain/service.ts
 *
 * Espelha lib/types/index.ts:Service. Foco desta fase (capacidade/turmas):
 *  - `capacity?` → ausente/1 = exclusivo (comportamento atual); >1 = turma.
 *  - `sessions?: WeeklySession[]` → grade semanal fixa de turmas.
 *
 * O Zod schema é a fonte da verdade; o tipo TS é derivado com z.infer.
 * NÃO redeclarar interface paralela — `lib/types/index.ts` mantém a interface
 * legada por retrocompat, mas validação no boundary usa estes schemas.
 */

import { z } from 'zod';

const TimeHmSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM (24h)');
const WeekdaySchema = z.number().int().min(0).max(6); // 0=Domingo .. 6=Sábado

/** Capacidade: inteiro >= 1. Ausente é tratado como 1 (exclusivo) no domínio. */
export const ServiceCapacitySchema = z.number().int().min(1);

/** Uma sessão fixa da grade semanal (turma). */
export const WeeklySessionSchema = z.object({
  weekday: WeekdaySchema,
  startTime: TimeHmSchema,
  duration: z.number().int().positive().max(720).optional(),
  capacity: ServiceCapacitySchema.optional(),
  professionalId: z.string().min(1).optional(),
  professionalName: z.string().optional(),
});
export type WeeklySession = z.infer<typeof WeeklySessionSchema>;

export const ServiceSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  userId: z.string().optional(),
  userName: z.string().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  duration: z.number().int().positive().max(720),
  price: z.number().nonnegative(),
  category: z.string().max(100).optional(),
  color: z.string().min(1),
  // ── Capacidade / turmas (feature desta fase) ──────────────────────────────
  capacity: ServiceCapacitySchema.optional(),
  sessions: z.array(WeeklySessionSchema).optional(),
  // ── Demais campos existentes ──────────────────────────────────────────────
  commissionRate: z.number().min(0).max(100).optional(),
  formTemplateId: z.string().optional(),
  operatorIds: z.array(z.string()).optional(),
  sectorId: z.string().optional(),
  lc116Code: z.string().optional(),
  codigoMunicipal: z.string().optional(),
  nbs: z.string().optional(),
  aliquotaISS: z.number().min(0).max(100).optional(),
  deletedAt: z.string().optional(),
  isActive: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((s, ctx) => {
  // INVARIANTE 1: sessões precisam de capacity coerente. Se uma sessão não
  // declara capacity e o serviço também não, herda 1 (exclusivo) — válido,
  // sem erro. Aqui só barramos capacity explícita <1 (já coberto pelo schema).

  // INVARIANTE 2: turma (capacity>1) faz sentido só com sessions OU com a
  // disponibilidade contínua — ambas são válidas. Não há erro a barrar; a
  // regra é informativa para os implementadores de availability.

  // INVARIANTE 3: cada sessão com professionalId deve ter o par professionalName
  // OU nenhum (denormalização consistente). Barrar nome sem id é ruído; barramos
  // apenas o caso de capacity de sessão explicitamente inválida — já no schema.
  if (s.sessions?.some((w) => w.capacity !== undefined && w.capacity < 1)) {
    ctx.addIssue({ code: 'custom', message: 'WeeklySession.capacity deve ser >= 1', path: ['sessions'] });
  }
});
export type Service = z.infer<typeof ServiceSchema>;

/**
 * Helper de domínio: capacidade efetiva de um serviço (default 1 = exclusivo).
 * Mantém em UM lugar a regra "ausente ou 1 = exclusivo".
 */
export function effectiveServiceCapacity(capacity?: number): number {
  return capacity && capacity > 1 ? capacity : 1;
}

/** true quando o serviço opera em modo turma (capacity>1). */
export function isGroupService(capacity?: number): boolean {
  return effectiveServiceCapacity(capacity) > 1;
}
