/**
 * lib/contracts/api/agent/send-interactive.ts — /api/agent/tools/send-interactive
 *
 * NOTA: este endpoint NÃO usa o padrão `{ action, params }`. Recebe direto
 * o payload de uma interactive list (WhatsApp Baileys) ou fallback texto.
 */

import { z } from 'zod';
import { DocIdSchema } from './_shared';

const SectionRowSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(60),
  description: z.string().max(200).optional(),
});

const SectionSchema = z.object({
  title: z.string().min(1).max(60),
  rows: z.array(SectionRowSchema).min(1).max(10),
});

export const SendInteractiveBodySchema = z.object({
  action: z.literal('send').optional(),
  params: z.object({
    conversation_id: DocIdSchema,
    title: z.string().min(1).max(60),
    body: z.string().min(1).max(1024),
    footer: z.string().max(60).optional(),
    button_text: z.string().min(1).max(20),
    sections: z.array(SectionSchema).min(1).max(10),
  }),
});

export const SendInteractiveDataSchema = z.object({
  externalMessageId: z.string().min(1),
});
