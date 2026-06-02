/**
 * lib/contracts/domain/appointment.ts
 *
 * Espelha lib/types/index.ts:Appointment. Foco desta fase (turmas):
 *  - `sessionKey?` → chave canônica que agrupa os Appointments de uma turma.
 *    Cada aluno é UM Appointment com o MESMO sessionKey. Vagas da turma =
 *    capacity - count(appointments não-cancelados com aquele sessionKey).
 *  - `isGroupSession?` / `capacitySnapshot?` → flags/auditoria da turma.
 *
 * RETROCOMPAT (inegociável): agendamentos exclusivos (Service capacity
 * ausente/1) NÃO recebem sessionKey; o conflito permanece BIT-A-BIT o atual.
 *
 * Os status canônicos são os de lib/types/index.ts:AppointmentStatus
 * ('agendado','confirmado','em_andamento','concluido','cancelado',
 * 'nao_compareceu') — NÃO confundir com os apelidos do agente em
 * lib/contracts/api/agent/_shared.ts.
 */

import { z } from 'zod';

export const APPOINTMENT_STATUSES = [
  'agendado',
  'confirmado',
  'em_andamento',
  'concluido',
  'cancelado',
  'nao_compareceu',
] as const;
export const AppointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

const DateYmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
const TimeHmSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM (24h)');

/**
 * Formato canônico do sessionKey (espelha lib/utils/sessionKey.ts):
 *   `${serviceId}_${date}_${startTime}_${professionalId|'any'}`
 * Validação propositalmente frouxa (4 partes não-vazias separadas por '_');
 * a montagem canônica fica no helper, não no schema.
 */
export const SessionKeySchema = z
  .string()
  .regex(/^[^_]+_[^_]+_[^_]+_[^_]+$/, 'sessionKey deve ter 4 partes: serviceId_date_startTime_professionalId|any');

/**
 * Resultado de uma aula experimental (trial) — funil de aquisição (P2.8).
 * `pendente` enquanto o trial não foi concluído/decidido; ao concluir vira
 * `converteu` (cliente fechou plano) ou `nao_converteu`.
 */
export const TRIAL_OUTCOMES = ['converteu', 'nao_converteu', 'pendente'] as const;
export const TrialOutcomeSchema = z.enum(TRIAL_OUTCOMES);
export type TrialOutcome = z.infer<typeof TrialOutcomeSchema>;

export const AppointmentSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  clientId: z.string(),
  clientName: z.string().min(1),
  clientPhone: z.string().optional(),
  serviceId: z.string().optional(),
  serviceName: z.string(),
  professionalId: z.string().optional(),
  professionalName: z.string().optional(),
  professionalIds: z.array(z.string()).optional(),
  professionalNames: z.array(z.string()).optional(),
  date: DateYmdSchema,
  startTime: TimeHmSchema,
  endTime: TimeHmSchema,
  duration: z.number().int().positive().max(720),
  status: AppointmentStatusSchema,
  price: z.number().nonnegative(),
  notes: z.string().optional(),
  color: z.string().optional(),
  recurrenceId: z.string().optional(),
  channelType: z.enum(['whatsapp', 'whatsapp_baileys', 'facebook', 'instagram', 'web', 'manual']).optional(),
  conversationId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  // ── Turmas / sessões compartilhadas (feature desta fase) ──────────────────
  sessionKey: SessionKeySchema.optional(),
  isGroupSession: z.boolean().optional(),
  capacitySnapshot: z.number().int().min(1).optional(),
  // ── Aula experimental / funil de aquisição (P2.8) ─────────────────────────
  isTrial: z.boolean().optional(),
  trialOutcome: TrialOutcomeSchema.optional(),
  // ── Automação / comissão / sync ───────────────────────────────────────────
  reminderSentAt: z.string().optional(),
  confirmationRequestedAt: z.string().optional(),
  followUpSentAt: z.string().optional(),
  commissionTransactionId: z.string().optional(),
  googleCalendarEventId: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  cancelledAt: z.string().optional(),
  cancelledBy: z.string().optional(),
  cancelledByName: z.string().optional(),
}).superRefine((a, ctx) => {
  // INVARIANTE: turma é coerente — se isGroupSession então precisa de sessionKey.
  if (a.isGroupSession && !a.sessionKey) {
    ctx.addIssue({ code: 'custom', message: 'isGroupSession=true exige sessionKey', path: ['sessionKey'] });
  }
});
export type Appointment = z.infer<typeof AppointmentSchema>;
