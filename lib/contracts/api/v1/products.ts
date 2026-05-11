/**
 * lib/contracts/api/v1/products.ts — /api/v1/products
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
import { ProductSchema, ProductComponentSchema, ProductModifierGroupSchema } from '../../domain/product';

const ProductCreateBase = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sku: z.string().max(80).optional(),
  barcode: z.string().max(80).optional(),
  category: z.string().min(1).max(100),
  unit: z.string().min(1).max(20),
  costPrice: z.number().nonnegative(),
  salePrice: z.number().nonnegative(),
  currentStock: z.number().default(0),
  minStock: z.number().nonnegative().default(0),
  maxStock: z.number().nonnegative().optional(),
  ncm: z.string().optional(),
  cfop: z.string().optional(),
  isActive: z.boolean().default(true),
  imageUrl: z.string().url().optional(),
  isDeliverable: z.boolean().optional(),
  menuCategory: z.string().optional(),
  menuDescription: z.string().max(400).optional(),
  preparationTime: z.number().int().nonnegative().optional(),
  components: z.array(ProductComponentSchema).optional(),
  modifierGroups: z.array(ProductModifierGroupSchema).optional(),
});

export const CreateProductBodySchema = ProductCreateBase;
export const CreateProductHeadersSchema = ApiKeyAuthHeaderSchema.merge(IdempotencyHeaderSchema);
export const CreateProductResponseSchema = z.union([
  successEnvelope(ProductSchema),
  ErrorEnvelopeSchema,
]);

export const UpdateProductBodySchema = ProductCreateBase.partial();
export const UpdateProductParamsSchema = z.object({ id: z.string().min(1) });
export const UpdateProductResponseSchema = z.union([
  successEnvelope(ProductSchema),
  ErrorEnvelopeSchema,
]);

export const ListProductsQuerySchema = PaginationQuerySchema.extend({
  category: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  isDeliverable: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export const ListProductsResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    data: z.array(ProductSchema),
    pagination: PaginationMetaSchema,
  }),
  ErrorEnvelopeSchema,
]);

export const GetProductParamsSchema = z.object({ id: z.string().min(1) });
export const GetProductResponseSchema = z.union([
  successEnvelope(ProductSchema.nullable()),
  ErrorEnvelopeSchema,
]);
