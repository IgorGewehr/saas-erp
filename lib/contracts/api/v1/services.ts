/**
 * lib/contracts/api/v1/services.ts — /api/v1/services
 *
 * NOTA: Service ainda não tem schema completo em lib/contracts/domain/.
 * Adicionar quando Fase 5 (Agenda + Services) entrar.
 * Por ora, schema mínimo aqui mesmo (vai migrar para domain/service.ts depois).
 */

import { z } from 'zod';
import {
  ApiKeyAuthHeaderSchema,
  ErrorEnvelopeSchema,
  IdempotencyHeaderSchema,
  PaginationMetaSchema,
  PaginationQuerySchema,
  successEnvelope,
} from '../_envelope';

export const ServiceShape = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  userId: z.string().optional(),
  userName: z.string().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  duration: z.number().int().positive().max(720),
  price: z.number().nonnegative(),
  category: z.string().max(100).optional(),
  color: z.string().max(20).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  isActive: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).passthrough();

const ServiceInputBase = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  duration: z.number().int().positive().max(720),
  price: z.number().nonnegative(),
  category: z.string().max(100).optional(),
  color: z.string().max(20).default('#ef4444'),
  commissionRate: z.number().min(0).max(100).optional(),
  isActive: z.boolean().default(true),
  userId: z.string().optional(),
  userName: z.string().optional(),
});

export const CreateServiceBodySchema = ServiceInputBase;
export const CreateServiceHeadersSchema = ApiKeyAuthHeaderSchema.merge(IdempotencyHeaderSchema);
export const CreateServiceResponseSchema = z.union([
  successEnvelope(ServiceShape),
  ErrorEnvelopeSchema,
]);

export const UpdateServiceParamsSchema = z.object({ id: z.string().min(1) });
export const UpdateServiceBodySchema = ServiceInputBase.partial();
export const UpdateServiceResponseSchema = z.union([
  successEnvelope(ServiceShape),
  ErrorEnvelopeSchema,
]);

export const ListServicesQuerySchema = PaginationQuerySchema.extend({
  isActive: z.coerce.boolean().optional(),
  category: z.string().optional(),
  userId: z.string().optional(),
  search: z.string().optional(),
});

export const ListServicesResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    data: z.array(ServiceShape),
    pagination: PaginationMetaSchema,
  }),
  ErrorEnvelopeSchema,
]);
