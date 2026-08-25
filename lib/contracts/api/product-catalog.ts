import { z } from 'zod';
import {
  ProductComponentSchema,
  ProductDietarySchema,
  ProductFiscalTaxSchema,
  ProductModifierGroupSchema,
  ProductUnitSchema,
} from '@/lib/contracts/domain/product';
import {
  PRODUCT_COST_METHODS,
  PRODUCT_KINDS,
  ProductImageV2Schema,
  ProductVariantV2Schema,
} from '@/lib/contracts/domain/productV2';

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const ProductCatalogDataSchema = z.object({
  kind: z.enum(PRODUCT_KINDS).optional(),
  name: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  sku: optionalText(80),
  barcode: optionalText(80),
  category: z.string().trim().min(1).max(100),
  unit: ProductUnitSchema,
  purchaseUnit: ProductUnitSchema.optional(),
  purchaseToStockFactor: z.number().positive().optional(),
  costMethod: z.enum(PRODUCT_COST_METHODS).optional(),
  costPrice: z.number().nonnegative(),
  salePrice: z.number().nonnegative(),
  minStock: z.number().nonnegative(),
  maxStock: z.number().nonnegative().optional(),
  ncm: optionalText(20),
  cfop: optionalText(20),
  cest: optionalText(20),
  icmsOrigem: z.enum(['0', '1', '2', '3', '4', '5', '6', '7']).optional(),
  gtin: optionalText(80),
  gtinTrib: optionalText(80),
  unidadeTrib: optionalText(20),
  fiscalTax: ProductFiscalTaxSchema.optional(),
  isActive: z.boolean(),
  images: z.array(ProductImageV2Schema).max(8).optional(),
  variants: z.array(ProductVariantV2Schema).max(100).optional(),
  isDeliverable: z.boolean().optional(),
  menuAvailable: z.boolean().optional(),
  trackStock: z.boolean().optional(),
  menuCategory: optionalText(100),
  menuCategoryId: optionalText(128),
  menuDescription: optionalText(400),
  preparationTime: z.number().int().nonnegative().max(1440).optional(),
  dietary: z.array(ProductDietarySchema).optional(),
  modifierGroups: z.array(ProductModifierGroupSchema).optional(),
  components: z.array(ProductComponentSchema).optional(),
}).strict();

export const ProductCatalogPatchSchema = ProductCatalogDataSchema.partial().strict();

export const CreateProductCatalogRequestSchema = z.object({
  businessId: z.string().min(1),
  data: ProductCatalogDataSchema,
  initialStock: z.number().nonnegative().default(0),
  idempotencyKey: z.string().min(8).max(200),
}).strict();

export const UpdateProductCatalogRequestSchema = z.object({
  businessId: z.string().min(1),
  productId: z.string().min(1),
  data: ProductCatalogPatchSchema,
  targetStock: z.number().nonnegative().optional(),
  idempotencyKey: z.string().min(8).max(200),
}).strict();

export const ArchiveProductCatalogRequestSchema = z.object({
  businessId: z.string().min(1),
  productId: z.string().min(1),
}).strict();

export const ProductImagesMutationSchema = z.object({
  businessId: z.string().min(1),
  productId: z.string().min(1),
  mode: z.enum(['append', 'replace']).default('append'),
}).strict();

export type ProductCatalogData = z.infer<typeof ProductCatalogDataSchema>;
export type ProductCatalogPatch = z.infer<typeof ProductCatalogPatchSchema>;
export type CreateProductCatalogRequest = z.infer<typeof CreateProductCatalogRequestSchema>;
export type UpdateProductCatalogRequest = z.infer<typeof UpdateProductCatalogRequestSchema>;
