/**
 * lib/contracts/api/v1/stock-movements.ts — /api/v1/stock-movements
 *
 * GET: lista movimentos com filtros
 * POST: cria ajuste manual de estoque (uso administrativo)
 *   → Vendas/Pedidos não devem usar este endpoint — eles passam pelo helper
 *     `lib/contracts/_runtime/bom.ts` + stock.ts/stock-admin.ts.
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
import { StockMovementSchema, StockMovementTypeSchema } from '../../domain/stockMovement';

export const CreateStockMovementBodySchema = z.object({
  productId: z.string().min(1),
  type: StockMovementTypeSchema,
  quantity: z.number().refine((v) => v !== 0, 'quantity != 0'),
  reason: z.string().min(1).max(500),
}).superRefine((b, ctx) => {
  // Ajuste pode ser negativo. Entrada/saida exigem quantity > 0.
  if (b.type !== 'ajuste' && b.quantity < 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'entrada/saida exigem quantity > 0 (sinal já implícito)',
      path: ['quantity'],
    });
  }
});

export const CreateStockMovementHeadersSchema = ApiKeyAuthHeaderSchema.merge(IdempotencyHeaderSchema);

export const CreateStockMovementResponseSchema = z.union([
  successEnvelope(StockMovementSchema),
  ErrorEnvelopeSchema,
]);

export const ListStockMovementsQuerySchema = PaginationQuerySchema.extend({
  productId: z.string().optional(),
  type: StockMovementTypeSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const ListStockMovementsResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    data: z.array(StockMovementSchema),
    pagination: PaginationMetaSchema,
  }),
  ErrorEnvelopeSchema,
]);
