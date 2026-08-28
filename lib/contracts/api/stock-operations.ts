import { z } from 'zod';
import { StockLotEntrySchema } from '@/lib/contracts/domain/stockLot';

const StockOperationLineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  quantity: z.number().finite(),
  sourceLineId: z.string().min(1).optional(),
  lotId: z.string().min(1).optional(),
  lot: StockLotEntrySchema.optional(),
});

const StockSourceDocumentSchema = z.object({
  collection: z.enum(['sales', 'deliveryOrders', 'purchaseNotes', 'appointments', 'services']),
  id: z.string().min(1),
  existence: z.enum(['required', 'if-present']).optional(),
});

export const StockOperationRequestSchema = z.object({
  businessId: z.string().min(1),
  type: z.enum(['entrada', 'saida', 'ajuste', 'restauracao']),
  lines: z.array(StockOperationLineSchema).min(1).max(200),
  operatorName: z.string().min(1).max(200),
  reason: z.string().min(1).max(500),
  sourceType: z.enum([
    'manual',
    'sale',
    'order',
    'purchase',
    'service',
    'refund',
    'agent',
    'api',
    'migration',
  ]),
  sourceId: z.string().min(1).optional(),
  sourceDocument: StockSourceDocumentSchema.optional(),
  idempotencyKey: z.string().min(1).max(300),
  expandBom: z.boolean().optional(),
  adjustmentMode: z.enum(['delta', 'absolute']).optional(),
  negativeStockPolicy: z.enum(['allow', 'prevent']).optional(),
  strictProductIds: z.array(z.string().min(1)).max(200).optional(),
}).superRefine((operation, ctx) => {
  if (operation.type === 'ajuste' && operation.expandBom !== false) {
    ctx.addIssue({ code: 'custom', path: ['expandBom'], message: 'ajuste exige expandBom=false' });
  }
  if (!['manual', 'migration'].includes(operation.sourceType) && !operation.sourceId) {
    ctx.addIssue({ code: 'custom', path: ['sourceId'], message: `${operation.sourceType} exige sourceId` });
  }
  for (const [index, line] of operation.lines.entries()) {
    const absoluteAdjustment = operation.type === 'ajuste' && operation.adjustmentMode === 'absolute';
    if (!absoluteAdjustment && line.quantity === 0) {
      ctx.addIssue({ code: 'custom', path: ['lines', index, 'quantity'], message: 'quantity não pode ser zero' });
    }
    if (operation.type !== 'ajuste' && line.quantity <= 0) {
      ctx.addIssue({ code: 'custom', path: ['lines', index, 'quantity'], message: 'quantity deve ser positiva' });
    }
    if (line.lot && operation.type !== 'entrada') {
      ctx.addIssue({ code: 'custom', path: ['lines', index, 'lot'], message: 'dados de lote só podem ser informados em entradas' });
    }
    if (line.lotId && operation.type === 'entrada') {
      ctx.addIssue({ code: 'custom', path: ['lines', index, 'lotId'], message: 'entradas identificam o lote pelo código' });
    }
    if (line.lot && line.lotId) {
      ctx.addIssue({ code: 'custom', path: ['lines', index], message: 'informe lot ou lotId, não ambos' });
    }
  }
});

export type StockOperationRequest = z.infer<typeof StockOperationRequestSchema>;
