/**
 * lib/contracts/api/agent/catalog.ts — /api/agent/tools/catalog
 * Actions: list_menu, search, get, list_categories
 */

import { z } from 'zod';
import { DocIdSchema, MoneySchema } from './_shared';

const MenuItemSchema = z.object({
  id: DocIdSchema,
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  price: MoneySchema,
  preparationTime: z.number().int().nonnegative().optional(),
  imageUrl: z.string().url().optional(),
  outOfStock: z.boolean().optional(),
  isKit: z.boolean().optional(),
  dietary: z.array(z.string()).optional(),
}).passthrough();

export const CatalogListMenuParamsSchema = z.object({
  category: z.string().optional(),
  dietary: z.array(z.string()).optional(),
});
export const CatalogListMenuDataSchema = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(MenuItemSchema),
});

export const CatalogSearchParamsSchema = z.object({
  query: z.string().min(1).max(200),
  dietary: z.array(z.string()).optional(),
});
export const CatalogSearchDataSchema = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(MenuItemSchema.extend({ _score: z.number() })),
});

export const CatalogGetParamsSchema = z.object({ id: DocIdSchema });
export const CatalogGetDataSchema = MenuItemSchema.nullable();

export const CatalogListCategoriesParamsSchema = z.object({});
export const CatalogListCategoriesDataSchema = z.object({
  categories: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() })),
});

export const CatalogToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_menu'),       params: CatalogListMenuParamsSchema }),
  z.object({ action: z.literal('search'),          params: CatalogSearchParamsSchema }),
  z.object({ action: z.literal('get'),             params: CatalogGetParamsSchema }),
  z.object({ action: z.literal('list_categories'), params: CatalogListCategoriesParamsSchema }),
]);

export const CATALOG_DATA_SCHEMAS = {
  list_menu:       CatalogListMenuDataSchema,
  search:          CatalogSearchDataSchema,
  get:             CatalogGetDataSchema,
  list_categories: CatalogListCategoriesDataSchema,
} as const;
