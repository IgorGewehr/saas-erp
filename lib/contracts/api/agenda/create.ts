/**
 * lib/contracts/api/agenda/create.ts
 *
 * Contrato de POST /api/appointments (M06.1) — criação autoritativa
 * server-side, substituindo os `addDoc` diretos de
 * `ScheduleActionDialog.tsx` (CRM) e `PDVModule.tsx` (retorno/pré-agendamento).
 * Nenhum dos dois canais coleta profissional na UI hoje — `professionalId`
 * fica opcional aqui, não é regressão: sem ele, `createAppointmentSafeAdmin`
 * já pula o re-check de conflito (mesmo comportamento de hoje, documentado
 * em `docs/agenda/AGENDA_NUCLEO_UNIFICADO.md`).
 *
 * `businessId` NUNCA vem do body — a rota sempre usa o resolvido por
 * `verifyAuth` (mesmo princípio de `/api/events/dispatch`).
 */

import { z } from 'zod';
import { ErrorEnvelopeSchema, successEnvelope } from '../_envelope';

const DateYmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
const TimeHmSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM (24h)');

// ─── POST /api/appointments ─────────────────────────────────────────────────
export const CreateAppointmentBodySchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(1),
  clientPhone: z.string().optional(),
  serviceId: z.string().optional(),
  serviceName: z.string().min(1),
  professionalId: z.string().optional(),
  date: DateYmdSchema,
  startTime: TimeHmSchema,
  endTime: TimeHmSchema,
  duration: z.number().int().positive().max(720),
  price: z.number().nonnegative(),
  notes: z.string().max(2000).optional(),
});
export type CreateAppointmentBody = z.infer<typeof CreateAppointmentBodySchema>;

export const CreateAppointmentResponseSchema = z.union([
  successEnvelope(z.object({ id: z.string().min(1) })),
  ErrorEnvelopeSchema,
]);
