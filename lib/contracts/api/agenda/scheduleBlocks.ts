/**
 * lib/contracts/api/agenda/scheduleBlocks.ts
 *
 * Contratos de POST /api/schedule-blocks e PATCH /api/schedule-blocks/[id]/cancel
 * (M06.3a). `businessId` nunca vem do body de criação — sempre de `verifyAuth`.
 * `CreateScheduleBlockBodySchema` estende o input de domínio com
 * `professionalName` (denormalizado, a UI já tem o nome ao selecionar o
 * profissional — evita 1 leitura extra no servidor).
 */

import { z } from 'zod';
import { ErrorEnvelopeSchema, successEnvelope } from '../_envelope';
import { CreateScheduleBlockInputSchema } from '../../domain/scheduleBlock';

// ─── POST /api/schedule-blocks ──────────────────────────────────────────────
export const CreateScheduleBlockBodySchema = CreateScheduleBlockInputSchema.and(
  z.object({ professionalName: z.string().optional() }),
);
export type CreateScheduleBlockBody = z.infer<typeof CreateScheduleBlockBodySchema>;

export const CreateScheduleBlockResponseSchema = z.union([
  successEnvelope(z.object({
    id: z.string().min(1),
    conflictingAppointments: z.array(z.object({
      id: z.string().min(1),
      clientName: z.string(),
      date: z.string(),
      startTime: z.string(),
      endTime: z.string(),
    })),
  })),
  ErrorEnvelopeSchema,
]);

// ─── PATCH /api/schedule-blocks/[id]/cancel ─────────────────────────────────
export const CancelScheduleBlockBodySchema = z.object({
  businessId: z.string().min(1),
});
export type CancelScheduleBlockBody = z.infer<typeof CancelScheduleBlockBodySchema>;
