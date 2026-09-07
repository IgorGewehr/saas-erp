/**
 * lib/contracts/api/agent/memory.ts — /api/agent/tools/memory
 * Actions: recall, remember, forget, clear
 */

import { z } from 'zod';
import { DocIdSchema } from './_shared';

// Achado real: `validUntil` guarda datas simples (ex.: "2026-12-31", ver
// exemplo no docstring de lib/rag/memory.ts) — `z.string().datetime()` puro
// exige formato RFC3339 completo (com "T"/offset) e rejeitaria isso. Mesmo
// padrão de `TimestampsSchema` em ./_shared.ts (aceita datetime OU string
// não-vazia).
const FlexibleDateSchema = z.string().datetime().or(z.string().min(1));

const FactSchema = z.object({
  id: DocIdSchema,
  contactId: DocIdSchema,
  text: z.string().min(1).max(2000),
  evidence: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  validUntil: FlexibleDateSchema.optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  // Achado real: `MemoryFact` (lib/rag/memory.ts) sempre grava `updatedAt` —
  // ausente aqui, `remember`/`recall` descartariam o campo em silêncio ao
  // validar a response (schema sem `.passthrough()`).
  updatedAt: z.string().optional(),
});

export const MemoryRecallParamsSchema = z.object({ contactId: DocIdSchema });
export const MemoryRecallDataSchema = z.object({
  contactId: DocIdSchema,
  facts: z.array(FactSchema),
});

export const MemoryRememberParamsSchema = z.object({
  contactId: DocIdSchema,
  text: z.string().min(1).max(2000),
  evidence: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  validUntil: FlexibleDateSchema.optional(),
  tags: z.array(z.string()).optional(),
});
export const MemoryRememberDataSchema = FactSchema;

export const MemoryForgetParamsSchema = z.object({
  contactId: DocIdSchema,
  factId: DocIdSchema,
});
export const MemoryForgetDataSchema = z.object({ removed: z.boolean() });

export const MemoryClearParamsSchema = z.object({ contactId: DocIdSchema });
export const MemoryClearDataSchema = z.object({ cleared: z.boolean() });

export const MemoryToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('recall'),   params: MemoryRecallParamsSchema }),
  z.object({ action: z.literal('remember'), params: MemoryRememberParamsSchema }),
  z.object({ action: z.literal('forget'),   params: MemoryForgetParamsSchema }),
  z.object({ action: z.literal('clear'),    params: MemoryClearParamsSchema }),
]);

export const MEMORY_DATA_SCHEMAS = {
  recall:   MemoryRecallDataSchema,
  remember: MemoryRememberDataSchema,
  forget:   MemoryForgetDataSchema,
  clear:    MemoryClearDataSchema,
} as const;
