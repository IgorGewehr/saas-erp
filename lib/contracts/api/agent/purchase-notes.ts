/**
 * lib/contracts/api/agent/purchase-notes.ts — /api/agent/tools/purchase-notes
 * Actions: list, get, match_products, apply_to_stock, list_unmatched
 */

import { z } from 'zod';
import { DocIdSchema, MoneySchema, PurchaseNoteStatusSchema } from './_shared';

const PurchaseNoteShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  status: PurchaseNoteStatusSchema,
  numero: z.string().optional(),
  serie: z.string().optional(),
  supplierId: DocIdSchema.optional(),
  supplierName: z.string().optional(),
  issueDate: z.string().optional(),
  stockImportedAt: z.string().optional(),
  stockMovementIds: z.array(DocIdSchema).optional(),
}).passthrough();

const PurchaseItemShape = z.object({
  productId: DocIdSchema.optional(),
  productName: z.string(),
  quantity: z.number(),
  unitPrice: MoneySchema,
}).passthrough();

const ProductShape = z.object({
  id: DocIdSchema,
  name: z.string(),
}).passthrough();

export const PurchaseNotesListParamsSchema = z.object({
  status: PurchaseNoteStatusSchema.optional(),
  supplierId: DocIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export const PurchaseNotesListDataSchema = z.array(PurchaseNoteShape);

export const PurchaseNotesGetParamsSchema = z.object({ id: DocIdSchema });
export const PurchaseNotesGetDataSchema = PurchaseNoteShape.nullable();

export const PurchaseNotesMatchProductsParamsSchema = z.object({ id: DocIdSchema });
export const PurchaseNotesMatchProductsDataSchema = z.object({
  note: PurchaseNoteShape,
  matched: z.array(z.object({
    item: PurchaseItemShape,
    product: ProductShape,
    confidence: z.number().min(0).max(1),
  })),
  unmatched: z.array(PurchaseItemShape),
});

export const PurchaseNotesApplyToStockParamsSchema = z.object({
  id: DocIdSchema,
  operatorId: z.string().default('agent'),
  operatorName: z.string().default('Agente IA'),
});
export const PurchaseNotesApplyToStockDataSchema = z.object({
  note: PurchaseNoteShape,
  movementsCreated: z.number().int().nonnegative(),
  unmatchedCount: z.number().int().nonnegative(),
});

export const PurchaseNotesListUnmatchedParamsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});
export const PurchaseNotesListUnmatchedDataSchema = z.array(z.object({
  id: DocIdSchema,
  numero: z.string().optional(),
  supplierName: z.string().optional(),
  issueDate: z.string().optional(),
  unmatchedItems: z.array(PurchaseItemShape),
}));

export const PurchaseNotesReverseStockParamsSchema = z.object({
  id: DocIdSchema,
  reason: z.string().trim().min(5).max(500),
  operatorId: z.string().default('agent'),
  operatorName: z.string().default('Agente IA'),
});
export const PurchaseNotesReverseStockDataSchema = z.object({
  note: PurchaseNoteShape,
  movementsReversed: z.number().int().nonnegative(),
});

export const PurchaseNotesToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'),            params: PurchaseNotesListParamsSchema }),
  z.object({ action: z.literal('get'),             params: PurchaseNotesGetParamsSchema }),
  z.object({ action: z.literal('match_products'),  params: PurchaseNotesMatchProductsParamsSchema }),
  z.object({ action: z.literal('apply_to_stock'),  params: PurchaseNotesApplyToStockParamsSchema }),
  z.object({ action: z.literal('list_unmatched'),  params: PurchaseNotesListUnmatchedParamsSchema }),
  z.object({ action: z.literal('reverse_stock'),   params: PurchaseNotesReverseStockParamsSchema }),
]);

export const PURCHASE_NOTES_DATA_SCHEMAS = {
  list:           PurchaseNotesListDataSchema,
  get:            PurchaseNotesGetDataSchema,
  match_products: PurchaseNotesMatchProductsDataSchema,
  apply_to_stock: PurchaseNotesApplyToStockDataSchema,
  list_unmatched: PurchaseNotesListUnmatchedDataSchema,
  reverse_stock:  PurchaseNotesReverseStockDataSchema,
} as const;
