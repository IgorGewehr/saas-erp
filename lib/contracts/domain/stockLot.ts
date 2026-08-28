import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data deve usar AAAA-MM-DD');

export const StockLotAllocationSchema = z.object({
  lotId: z.string().min(1),
  lotCode: z.string().min(1).max(120),
  quantity: z.number().positive(),
  expiresAt: dateOnly.optional(),
});

export const StockLotEntrySchema = z.object({
  code: z.string().trim().min(1).max(120),
  manufacturedAt: dateOnly.optional(),
  expiresAt: dateOnly.optional(),
  supplierId: z.string().trim().min(1).max(160).optional(),
  supplierName: z.string().trim().min(1).max(240).optional(),
  supplierDocument: z.string().trim().min(1).max(40).optional(),
  purchaseNoteNumber: z.string().trim().min(1).max(80).optional(),
}).superRefine((lot, ctx) => {
  if (lot.manufacturedAt && lot.expiresAt && lot.expiresAt < lot.manufacturedAt) {
    ctx.addIssue({
      code: 'custom',
      message: 'validade não pode ser anterior à fabricação',
      path: ['expiresAt'],
    });
  }
});

export const StockLotSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  businessId: z.string().min(1),
  productId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  productName: z.string().min(1),
  unit: z.string().min(1),
  code: z.string().min(1).max(120),
  codeNormalized: z.string().min(1).max(120),
  status: z.enum(['active', 'depleted']),
  manufacturedAt: dateOnly.optional(),
  expiresAt: dateOnly.optional(),
  initialQuantity: z.number().nonnegative(),
  currentQuantity: z.number().nonnegative(),
  unitCost: z.number().nonnegative().optional(),
  expiryWarningDays: z.number().int().min(1).max(3650),
  supplierId: z.string().optional(),
  supplierName: z.string().optional(),
  supplierDocument: z.string().optional(),
  purchaseNoteIds: z.array(z.string().min(1)).max(200).optional(),
  purchaseNoteNumber: z.string().optional(),
  sourceLineId: z.string().optional(),
  createdBy: z.string().min(1),
  createdByName: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type StockLotEntry = z.infer<typeof StockLotEntrySchema>;
export type StockLotAllocation = z.infer<typeof StockLotAllocationSchema>;
export type StockLotDocument = z.infer<typeof StockLotSchema>;
