/**
 * lib/contracts/domain/aiAgentSegment.ts
 *
 * Contrato do campo `segment` (ramo/vertical) de AiAgentSettings.
 * Selecionado em Settings → Agente IA; ajusta vocabulário, exemplos e persona
 * do /agent sem violar a constituição. Espelha lib/types/index.ts:
 * BusinessSegment + SEGMENT_LABELS + SEGMENT_VOCAB.
 *
 * O agente Python recebe `segment` e `segment_vocab` no business_context para
 * humanizar respostas independente do ramo (remover viés salão dos few-shots).
 */

import { z } from 'zod';

export const BUSINESS_SEGMENTS = [
  'academia',
  'salao',
  'clinica',
  'consultoria',
  'generico',
] as const;

export const BusinessSegmentSchema = z.enum(BUSINESS_SEGMENTS);
export type BusinessSegment = z.infer<typeof BusinessSegmentSchema>;

/** Vocabulário pt-BR por ramo. Espelha SEGMENT_VOCAB em lib/types/index.ts. */
export const SegmentVocabularySchema = z.object({
  cliente: z.string().min(1),
  servico: z.string().min(1),
  profissional: z.string().min(1),
  agendar: z.string().min(1),
});
export type SegmentVocabulary = z.infer<typeof SegmentVocabularySchema>;

/**
 * Campo opcional para extensão (merge) no schema de AiAgentSettings quando
 * este for migrado para domain/. Ausente → o agente trata como 'generico'.
 */
export const AiAgentSegmentFieldSchema = z.object({
  segment: BusinessSegmentSchema.optional(),
});
export type AiAgentSegmentField = z.infer<typeof AiAgentSegmentFieldSchema>;
