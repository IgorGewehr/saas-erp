/** Contrato V2 do ledger de estoque, com origem e idempotência explícitas. */

import { z } from 'zod';
import { StockLotAllocationSchema } from './stockLot';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const STOCK_MOVEMENT_V2_VERSION = 2 as const;
export const STOCK_SOURCE_TYPES = [
  'manual',
  'sale',
  'order',
  'purchase',
  'service',
  'refund',
  'agent',
  'api',
  'migration',
] as const;

const StockMovementV2CanonicalSchema = z.object({
  schemaVersion: z.literal(STOCK_MOVEMENT_V2_VERSION),
  id: z.string().min(1),
  businessId: z.string().min(1),
  productId: z.string().min(1),
  variantId: z.string().optional(),
  productName: z.string().min(1),
  type: z.enum(['entrada', 'saida', 'ajuste']),
  quantity: z.number(),
  previousStock: z.number(),
  newStock: z.number(),
  unitCost: z.number().nonnegative().optional(),
  costTotal: z.number().nonnegative().optional(),
  previousCost: z.number().nonnegative().optional(),
  newCost: z.number().nonnegative().optional(),
  costMethod: z.literal('moving_average').optional(),
  costRestored: z.boolean().optional(),
  reversalOfMovementId: z.string().min(1).optional(),
  lotAllocations: z.array(StockLotAllocationSchema).max(450).optional(),
  reason: z.string().min(1).max(500),
  sourceType: z.enum(STOCK_SOURCE_TYPES),
  sourceId: z.string().optional(),
  sourceLineId: z.string().optional(),
  idempotencyKey: z.string().min(1).max(300),
  balanceAccuracy: z.enum(['exact', 'legacy_best_effort']),
  operatorId: z.string().min(1),
  operatorName: z.string().min(1),
  createdAt: z.string().min(1),
}).superRefine((movement, ctx) => {
  let expected: number;
  if (movement.type === 'entrada') {
    if (movement.quantity <= 0) {
      ctx.addIssue({ code: 'custom', message: 'entrada exige quantity > 0', path: ['quantity'] });
    }
    expected = movement.previousStock + Math.abs(movement.quantity);
  } else if (movement.type === 'saida') {
    if (movement.quantity <= 0) {
      ctx.addIssue({ code: 'custom', message: 'saida exige quantity > 0', path: ['quantity'] });
    }
    expected = movement.previousStock - Math.abs(movement.quantity);
  } else {
    if (movement.quantity === 0) {
      ctx.addIssue({ code: 'custom', message: 'ajuste exige delta diferente de zero', path: ['quantity'] });
    }
    expected = movement.previousStock + movement.quantity;
  }
  if (Math.abs(movement.newStock - expected) > 1e-6) {
    ctx.addIssue({
      code: 'custom',
      message: `saldo inconsistente; esperado ${expected}`,
      path: ['newStock'],
    });
  }
  if (movement.unitCost !== undefined && movement.costTotal !== undefined) {
    const expectedCost = Math.abs(movement.quantity) * movement.unitCost;
    if (Math.abs(movement.costTotal - expectedCost) > 0.011) {
      ctx.addIssue({ code: 'custom', message: 'costTotal inconsistente', path: ['costTotal'] });
    }
  }
  if (movement.sourceType !== 'manual' && movement.sourceType !== 'migration' && !movement.sourceId) {
    ctx.addIssue({
      code: 'custom',
      message: `${movement.sourceType} exige sourceId`,
      path: ['sourceId'],
    });
  }
  if (movement.costRestored && (
    movement.type !== 'saida' || !movement.reversalOfMovementId ||
    movement.previousCost === undefined || movement.newCost === undefined
  )) {
    ctx.addIssue({
      code: 'custom',
      message: 'costRestored exige saída compensatória com memória de custo',
      path: ['costRestored'],
    });
  }
  if (movement.lotAllocations?.length) {
    const allocated = movement.lotAllocations.reduce((total, lot) => total + lot.quantity, 0);
    if (Math.abs(allocated - Math.abs(movement.quantity)) > 1e-6) {
      ctx.addIssue({
        code: 'custom',
        message: 'a soma das alocações de lote deve corresponder à quantidade movimentada',
        path: ['lotAllocations'],
      });
    }
  }
});

function inferSource(source: Record<string, unknown>): { sourceType: string; sourceId?: string } {
  if (typeof source.sourceType === 'string') {
    return {
      sourceType: source.sourceType,
      ...(typeof source.sourceId === 'string' ? { sourceId: source.sourceId } : {}),
    };
  }
  if (typeof source.purchaseId === 'string') return { sourceType: 'purchase', sourceId: source.purchaseId };
  if (typeof source.orderId === 'string') return { sourceType: 'order', sourceId: source.orderId };
  if (typeof source.deliveryOrderId === 'string') return { sourceType: 'order', sourceId: source.deliveryOrderId };
  if (typeof source.saleId === 'string') return { sourceType: 'sale', sourceId: source.saleId };
  return { sourceType: 'manual' };
}

export function normalizeStockMovementToV2(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const source = { ...input };
  const isLegacy = source.schemaVersion !== STOCK_MOVEMENT_V2_VERSION;
  const previousStock = Number(source.previousStock ?? 0);
  const newStock = Number(source.newStock ?? previousStock);
  const type = source.type;
  const quantity = type === 'ajuste' && isLegacy
    ? newStock - previousStock
    : Number(source.quantity ?? 0);
  const inferredSource = inferSource(source);
  const id = String(source.id ?? 'unknown');

  return {
    ...source,
    schemaVersion: STOCK_MOVEMENT_V2_VERSION,
    quantity,
    ...inferredSource,
    idempotencyKey: source.idempotencyKey ?? `legacy:${id}`,
    balanceAccuracy: source.balanceAccuracy ?? (isLegacy ? 'legacy_best_effort' : 'exact'),
  };
}

export const StockMovementV2Schema = z.preprocess(
  normalizeStockMovementToV2,
  StockMovementV2CanonicalSchema,
);

export type StockMovementV2 = z.infer<typeof StockMovementV2Schema>;
