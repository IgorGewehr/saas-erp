/**
 * lib/contracts/domain/stockMovement.ts
 *
 * Auditoria de stock. Invariante chave:
 *   type='entrada' ⇒ newStock === previousStock + quantity
 *   type='saida'   ⇒ newStock === previousStock - quantity
 *   type='ajuste'  ⇒ newStock === previousStock + signedDelta (quantity é o |delta|)
 *
 * Cada operação que toca currentStock DEVE criar 1 StockMovement no mesmo batch.
 */

import { z } from 'zod';

export const STOCK_MOVEMENT_TYPES = ['entrada', 'saida', 'ajuste'] as const;
export const StockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPES);
export type StockMovementType = z.infer<typeof StockMovementTypeSchema>;

export const StockMovementSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  productId: z.string().min(1),
  productName: z.string().min(1),
  type: StockMovementTypeSchema,
  quantity: z.number(), // ajuste pode ser negativo, entrada/saida sempre positivo
  previousStock: z.number(),
  newStock: z.number(),
  reason: z.string().min(1).max(500),
  saleId: z.string().optional(),
  purchaseId: z.string().optional(),
  orderId: z.string().optional(),
  deliveryOrderId: z.string().optional(),
  operatorId: z.string().min(1),
  operatorName: z.string().min(1),
  createdAt: z.string().min(1),
}).superRefine((m, ctx) => {
  // INVARIANTE: newStock bate com previousStock + sinal(type) * quantity
  let expected: number;
  if (m.type === 'entrada') {
    if (m.quantity <= 0) {
      ctx.addIssue({ code: 'custom', message: 'entrada exige quantity > 0', path: ['quantity'] });
    }
    expected = m.previousStock + Math.abs(m.quantity);
  } else if (m.type === 'saida') {
    if (m.quantity <= 0) {
      ctx.addIssue({ code: 'custom', message: 'saida exige quantity > 0 (sinal já implícito)', path: ['quantity'] });
    }
    expected = m.previousStock - Math.abs(m.quantity);
  } else {
    // ajuste: quantity é signed delta
    if (m.quantity === 0) {
      ctx.addIssue({ code: 'custom', message: 'ajuste exige quantity != 0', path: ['quantity'] });
    }
    expected = m.previousStock + m.quantity;
  }
  if (Math.abs(m.newStock - expected) > 1e-6) {
    ctx.addIssue({
      code: 'custom',
      message: `newStock (${m.newStock}) inconsistente com previousStock ${m.type} quantity ${m.quantity} (esperado ${expected})`,
      path: ['newStock'],
    });
  }
});

export type StockMovement = z.infer<typeof StockMovementSchema>;
