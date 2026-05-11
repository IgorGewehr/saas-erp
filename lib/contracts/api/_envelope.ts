/**
 * lib/contracts/api/_envelope.ts
 *
 * Wrappers compartilhados pra todas as routes contratadas.
 * - SuccessEnvelope / ErrorEnvelope: response shape padrão `{ ok, data, error }`
 * - ErrorCode: enum fechado de códigos
 * - IdempotencyHeaderSchema: header padrão para POST que cria recursos
 * - AuthHeaderSchema: header pra Public API (Bearer SaasApiKey)
 */

import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYMENT_REQUIRED',
  'TENANT_MISMATCH',
  'IDEMPOTENCY_REPLAY',
  'CIRCUIT_OPEN',
  'INTERNAL',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    retryable: z.boolean().optional(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export function successEnvelope<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
    idempotent: z.boolean().optional(),
  });
}

/** Header padrão para POSTs idempotentes. UUID v4 recomendado. */
export const IdempotencyHeaderSchema = z.object({
  'x-idempotency-key': z
    .string()
    .min(8)
    .max(128)
    .optional(),
});

/** Header padrão para Public API v1. */
export const ApiKeyAuthHeaderSchema = z.object({
  authorization: z
    .string()
    .regex(/^Bearer sp_(live|test)_[A-Za-z0-9_-]+$/, 'Bearer SaasApiKey inválida'),
});

/** Pagination padrão para listagens. */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const PaginationMetaSchema = z.object({
  limit: z.number().int(),
  offset: z.number().int(),
  total: z.number().int().optional(),
  hasMore: z.boolean().optional(),
});
