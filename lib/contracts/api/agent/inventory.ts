/**
 * lib/contracts/api/agent/inventory.ts — /api/agent/tools/inventory
 * Actions: list, get, search, create, update, adjust_stock, list_low_stock,
 *          set_active, set_out_of_stock
 */

import { z } from 'zod';
import { DocIdSchema, MoneySchema } from './_shared';

const ProductShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  name: z.string(),
  category: z.string().optional(),
  unit: z.string().optional(),
  costPrice: MoneySchema.optional(),
  salePrice: MoneySchema,
  currentStock: z.number(),
  minStock: z.number().nonnegative().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  description: z.string().optional(),
  isActive: z.boolean(),
  imageUrl: z.string().url().optional().or(z.literal('')),
  isDeliverable: z.boolean().optional(),
  menuCategory: z.string().optional(),
  menuDescription: z.string().optional(),
  preparationTime: z.number().int().nonnegative().optional(),
}).passthrough();

const StockMovementShape = z.object({
  id: DocIdSchema,
  businessId: z.string(),
  productId: DocIdSchema,
  productName: z.string().optional(),
  type: z.enum(['entrada', 'saida', 'ajuste']),
  quantity: z.number(),
  previousStock: z.number(),
  newStock: z.number(),
  reason: z.string().optional(),
  operatorId: z.string().optional(),
  operatorName: z.string().optional(),
}).passthrough();

const InventoryPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  unit: z.string().max(20).optional(),
  costPrice: MoneySchema.optional(),
  salePrice: MoneySchema.optional(),
  minStock: z.number().nonnegative().optional(),
  maxStock: z.number().nonnegative().optional(),
  sku: z.string().max(80).optional(),
  barcode: z.string().max(80).optional(),
  isActive: z.boolean().optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
  isDeliverable: z.boolean().optional(),
  menuCategory: z.string().optional(),
  menuDescription: z.string().max(400).optional(),
  preparationTime: z.number().int().nonnegative().optional(),
  dietary: z.array(z.string()).optional(),
}).strict();

export const InventoryListParamsSchema = z.object({
  category: z.string().optional(),
  isActive: z.boolean().optional(),
  onlyDeliverable: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export const InventoryListDataSchema = z.array(ProductShape);

export const InventoryGetParamsSchema = z.object({ id: DocIdSchema });
export const InventoryGetDataSchema = ProductShape.nullable();

export const InventorySearchParamsSchema = z.object({
  query: z.string().min(1),
  includeInactive: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export const InventorySearchDataSchema = z.array(ProductShape.extend({ _score: z.number() }));

export const InventoryCreateParamsSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  unit: z.string().max(20).default('UN'),
  costPrice: MoneySchema,
  salePrice: MoneySchema,
  currentStock: z.number().nonnegative().default(0),
  minStock: z.number().nonnegative().default(0),
  sku: z.string().max(80).optional(),
  barcode: z.string().max(80).optional(),
  description: z.string().max(2000).optional(),
  isDeliverable: z.boolean().optional(),
  menuCategory: z.string().optional(),
  menuDescription: z.string().max(400).optional(),
  preparationTime: z.number().int().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
});
export const InventoryCreateDataSchema = ProductShape;

export const InventoryUpdateParamsSchema = z.object({
  id: DocIdSchema,
  patch: InventoryPatch,
});
export const InventoryUpdateDataSchema = ProductShape;

export const InventoryAdjustStockParamsSchema = z.object({
  productId: DocIdSchema,
  delta: z.number().refine((v) => v !== 0, 'delta deve ser != 0'),
  reason: z.string().min(1).max(500),
  operatorId: z.string().default('agent'),
  operatorName: z.string().default('Agente IA'),
});
export const InventoryAdjustStockDataSchema = z.object({
  product: ProductShape,
  movement: StockMovementShape,
});

export const InventoryListLowStockParamsSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
});
export const InventoryListLowStockDataSchema = z.array(ProductShape);

export const InventorySetActiveParamsSchema = z.object({
  id: DocIdSchema,
  isActive: z.boolean(),
});
export const InventorySetActiveDataSchema = ProductShape;

export const InventorySetOutOfStockParamsSchema = z.object({ id: DocIdSchema });
export const InventorySetOutOfStockDataSchema = ProductShape;

export const InventoryToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'),               params: InventoryListParamsSchema }),
  z.object({ action: z.literal('get'),                params: InventoryGetParamsSchema }),
  z.object({ action: z.literal('search'),             params: InventorySearchParamsSchema }),
  z.object({ action: z.literal('create'),             params: InventoryCreateParamsSchema }),
  z.object({ action: z.literal('update'),             params: InventoryUpdateParamsSchema }),
  z.object({ action: z.literal('adjust_stock'),       params: InventoryAdjustStockParamsSchema }),
  z.object({ action: z.literal('list_low_stock'),     params: InventoryListLowStockParamsSchema }),
  z.object({ action: z.literal('set_active'),         params: InventorySetActiveParamsSchema }),
  z.object({ action: z.literal('set_out_of_stock'),   params: InventorySetOutOfStockParamsSchema }),
]);

export const INVENTORY_DATA_SCHEMAS = {
  list:             InventoryListDataSchema,
  get:              InventoryGetDataSchema,
  search:           InventorySearchDataSchema,
  create:           InventoryCreateDataSchema,
  update:           InventoryUpdateDataSchema,
  adjust_stock:     InventoryAdjustStockDataSchema,
  list_low_stock:   InventoryListLowStockDataSchema,
  set_active:       InventorySetActiveDataSchema,
  set_out_of_stock: InventorySetOutOfStockDataSchema,
} as const;
