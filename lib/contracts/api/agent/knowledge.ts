/**
 * lib/contracts/api/agent/knowledge.ts — /api/agent/tools/knowledge
 * Actions: search (RAG)
 */

import { z } from 'zod';
import { KnowledgeSourceSchema } from './_shared';

export const KnowledgeSearchParamsSchema = z.object({
  query: z.string().min(1).max(1000),
  k: z.number().int().min(1).max(50).optional(),
  sources: z.array(KnowledgeSourceSchema).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

export const KnowledgeSearchDataSchema = z.object({
  query: z.string(),
  count: z.number().int().nonnegative(),
  results: z.array(z.object({
    source: KnowledgeSourceSchema,
    sourceId: z.string(),
    text: z.string(),
    metadata: z.object({}).passthrough(),
    score: z.number().min(0).max(1),
  })),
});

export const KnowledgeToolRequestSchema = z.object({
  action: z.literal('search'),
  params: KnowledgeSearchParamsSchema,
});

export const KNOWLEDGE_DATA_SCHEMAS = {
  search: KnowledgeSearchDataSchema,
} as const;
