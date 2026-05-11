/**
 * lib/contracts/api/agent/memory.ts — /api/agent/tools/memory
 * Actions: recall, remember, forget, clear
 */

import { z } from 'zod';
import { DocIdSchema } from './_shared';

const FactSchema = z.object({
  id: DocIdSchema,
  contactId: DocIdSchema,
  text: z.string().min(1).max(2000),
  evidence: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  validUntil: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
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
  validUntil: z.string().datetime().optional(),
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
