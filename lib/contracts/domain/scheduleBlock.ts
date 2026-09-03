/**
 * lib/contracts/domain/scheduleBlock.ts
 *
 * Bloqueio de agenda (M06.3a) — indisponibilidade explícita, por intervalo de
 * datas, de um profissional (férias, conferência) ou do negócio inteiro
 * (feriado, fechamento). Ausência de `professionalId` = bloqueio do negócio
 * inteiro, cobre TODOS os profissionais nesse intervalo.
 *
 * Ausência de `startTime`/`endTime` = dia inteiro bloqueado, em cada dia do
 * intervalo `startDate`..`endDate`; presença de ambos restringe o bloqueio a
 * essa janela diária (ex.: bloquear só a tarde de uma conferência).
 *
 * Consumido por `checkAppointmentConflict` (lib/services/appointmentConflicts.ts)
 * via o parâmetro opcional `blocks` — não é um algoritmo de conflito próprio;
 * é mais um tipo de indisponibilidade que o núcleo único já existente passa a
 * considerar, na mesma linha de "um lugar decide, não quatro".
 */

import { z } from 'zod';

export const SCHEDULE_BLOCK_STATUSES = ['ativo', 'cancelado'] as const;
export const ScheduleBlockStatusSchema = z.enum(SCHEDULE_BLOCK_STATUSES);
export type ScheduleBlockStatus = z.infer<typeof ScheduleBlockStatusSchema>;

const DateYmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
const TimeHmSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM (24h)');

export const ScheduleBlockSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  // Ausente = bloqueio do NEGÓCIO INTEIRO. Presente = só esse profissional.
  professionalId: z.string().optional(),
  professionalName: z.string().optional(),
  startDate: DateYmdSchema,
  endDate: DateYmdSchema, // inclusive; igual a startDate = 1 dia só
  // Ausentes = dia INTEIRO bloqueado. Presentes = só essa janela, todo dia do intervalo.
  startTime: TimeHmSchema.optional(),
  endTime: TimeHmSchema.optional(),
  reason: z.string().max(200).optional(),
  status: ScheduleBlockStatusSchema,
  createdBy: z.string().min(1),
  createdByName: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  cancelledAt: z.string().optional(),
  cancelledBy: z.string().optional(),
  cancelledByName: z.string().optional(),
}).superRefine((b, ctx) => {
  if (b.endDate < b.startDate) {
    ctx.addIssue({ code: 'custom', message: 'endDate deve ser >= startDate', path: ['endDate'] });
  }
  if (Boolean(b.startTime) !== Boolean(b.endTime)) {
    ctx.addIssue({ code: 'custom', message: 'startTime e endTime devem vir juntos ou nenhum dos dois', path: ['endTime'] });
  }
  if (b.startTime && b.endTime && b.startTime >= b.endTime) {
    ctx.addIssue({ code: 'custom', message: 'endTime deve ser depois de startTime', path: ['endTime'] });
  }
});
export type ScheduleBlock = z.infer<typeof ScheduleBlockSchema>;

/** Input aceito por `createScheduleBlockAdmin` — sem id/status/timestamps/audit (resolvidos no servidor). */
export const CreateScheduleBlockInputSchema = z.object({
  professionalId: z.string().optional(),
  startDate: DateYmdSchema,
  endDate: DateYmdSchema,
  startTime: TimeHmSchema.optional(),
  endTime: TimeHmSchema.optional(),
  reason: z.string().max(200).optional(),
}).superRefine((b, ctx) => {
  if (b.endDate < b.startDate) {
    ctx.addIssue({ code: 'custom', message: 'endDate deve ser >= startDate', path: ['endDate'] });
  }
  if (Boolean(b.startTime) !== Boolean(b.endTime)) {
    ctx.addIssue({ code: 'custom', message: 'startTime e endTime devem vir juntos ou nenhum dos dois', path: ['endTime'] });
  }
  if (b.startTime && b.endTime && b.startTime >= b.endTime) {
    ctx.addIssue({ code: 'custom', message: 'endTime deve ser depois de startTime', path: ['endTime'] });
  }
});
export type CreateScheduleBlockInput = z.infer<typeof CreateScheduleBlockInputSchema>;
