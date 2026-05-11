/**
 * lib/contracts/_template/ROUTE_TEMPLATE.ts
 *
 * Template para uma rota da Public API v1.
 * Copie para lib/contracts/api/v1/{recurso}.ts.
 *
 * Padrões:
 * - Toda POST de criação aceita header X-Idempotency-Key.
 * - Toda lista aceita limit/offset.
 * - Erros usam ErrorEnvelope (lib/contracts/api/_envelope.ts — criar quando primeiro contrato API for adicionado).
 */

import { z } from 'zod';
import { EntitySchema, EntityCreateInputSchema, EntityUpdateInputSchema } from '../domain/ENTITY_TEMPLATE';

// === GET /api/v1/entities ===
export const ListEntitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});
export const ListEntitiesResponseSchema = z.object({
  ok: z.literal(true),
  data: z.array(EntitySchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number().optional(),
  }),
});

// === POST /api/v1/entities ===
export const CreateEntityHeadersSchema = z.object({
  'x-idempotency-key': z.string().uuid().optional(),
  'authorization': z.string().regex(/^Bearer sp_(live|test)_[A-Za-z0-9]+$/),
});
export const CreateEntityBodySchema = EntityCreateInputSchema;
export const CreateEntityResponseSchema = z.object({
  ok: z.literal(true),
  data: EntitySchema,
  idempotent: z.boolean().optional(),  // true se foi replay
});

// === PUT /api/v1/entities/:id ===
export const UpdateEntityBodySchema = EntityUpdateInputSchema;
export const UpdateEntityResponseSchema = z.object({
  ok: z.literal(true),
  data: EntitySchema,
});

// === Errors ===
export const ErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum([
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL',
    ]),
    message: z.string(),
    details: z.unknown().optional(),
    retryable: z.boolean().optional(),
  }),
});

export type ListEntitiesResponse = z.infer<typeof ListEntitiesResponseSchema>;
export type CreateEntityBody = z.infer<typeof CreateEntityBodySchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
