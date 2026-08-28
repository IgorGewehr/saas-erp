/**
 * Contrato canônico V2 de produto.
 *
 * É aditivo em relação ao Product legado: preserva os campos planos usados
 * pelo app e formaliza variações, múltiplas imagens, unidade de compra e método
 * de custo. `normalizeProductToV2` permite ler documentos V1 sem migração
 * imediata; novas escritas devem persistir o resultado validado deste schema.
 */

import { z } from 'zod';
import {
  ProductComponentSchema,
  ProductDietarySchema,
  ProductFiscalTaxSchema,
  ProductModifierGroupSchema,
  ProductUnitSchema,
} from './product';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const PRODUCT_V2_VERSION = 2 as const;
export const PRODUCT_KINDS = ['simple', 'variant', 'composite'] as const;
export const PRODUCT_COST_METHODS = ['moving_average', 'last_cost'] as const;

export const ProductImageV2Schema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  alt: z.string().max(300).optional(),
  sortOrder: z.number().int().nonnegative(),
  isPrimary: z.boolean().optional(),
});

export const ProductVariantV2Schema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(160),
  attributes: z.record(z.string(), z.string()).default({}),
  sku: z.string().max(80).optional(),
  barcode: z.string().max(80).optional(),
  salePrice: z.number().nonnegative(),
  costPrice: z.number().nonnegative(),
  currentStock: z.number(),
  minStock: z.number().nonnegative().default(0),
  maxStock: z.number().nonnegative().optional(),
  trackStock: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

const ProductV2CanonicalSchema = z.object({
  schemaVersion: z.literal(PRODUCT_V2_VERSION),
  id: z.string().min(1),
  businessId: z.string().min(1),
  kind: z.enum(PRODUCT_KINDS),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sku: z.string().max(80).optional(),
  barcode: z.string().max(80).optional(),
  category: z.string().min(1).max(100),
  unit: ProductUnitSchema,
  purchaseUnit: ProductUnitSchema,
  purchaseToStockFactor: z.number().positive(),
  costMethod: z.enum(PRODUCT_COST_METHODS),
  costPrice: z.number().nonnegative(),
  salePrice: z.number().nonnegative(),
  currentStock: z.number(),
  minStock: z.number().nonnegative(),
  maxStock: z.number().nonnegative().optional(),
  trackStock: z.boolean(),
  trackLots: z.boolean(),
  trackExpiry: z.boolean(),
  expiryWarningDays: z.number().int().min(1).max(3650),
  ncm: z.string().optional(),
  cfop: z.string().optional(),
  cest: z.string().optional(),
  icmsOrigem: z.enum(['0', '1', '2', '3', '4', '5', '6', '7']).optional(),
  gtin: z.string().optional(),
  gtinTrib: z.string().optional(),
  unidadeTrib: z.string().optional(),
  fiscalTax: ProductFiscalTaxSchema.optional(),
  isActive: z.boolean(),
  archivedAt: z.string().optional(),
  imageUrl: z.string().url().optional(),
  images: z.array(ProductImageV2Schema),
  variants: z.array(ProductVariantV2Schema),
  isDeliverable: z.boolean().optional(),
  menuAvailable: z.boolean(),
  menuCategory: z.string().optional(),
  menuCategoryId: z.string().optional(),
  menuDescription: z.string().max(400).optional(),
  preparationTime: z.number().int().nonnegative().optional(),
  dietary: z.array(ProductDietarySchema).optional(),
  modifierGroups: z.array(ProductModifierGroupSchema).optional(),
  hasModifiers: z.boolean().optional(),
  components: z.array(ProductComponentSchema).optional(),
  migration: z.object({
    sourceVersion: z.literal(1),
    warnings: z.array(z.string()),
  }).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((product, ctx) => {
  const hasComponents = Boolean(product.components?.length);
  const hasVariants = product.variants.length > 0;

  if (product.kind === 'simple' && (hasComponents || hasVariants)) {
    ctx.addIssue({
      code: 'custom',
      message: 'kind=simple não aceita components ou variants',
      path: ['kind'],
    });
  }
  if (product.kind === 'composite' && !hasComponents) {
    ctx.addIssue({
      code: 'custom',
      message: 'kind=composite exige components',
      path: ['components'],
    });
  }
  if (product.kind === 'composite' && hasVariants) {
    ctx.addIssue({
      code: 'custom',
      message: 'produto composto não pode possuir variants no V2',
      path: ['variants'],
    });
  }
  if (product.kind === 'variant' && !hasVariants) {
    ctx.addIssue({
      code: 'custom',
      message: 'kind=variant exige ao menos uma variação',
      path: ['variants'],
    });
  }
  if (product.kind === 'variant' && hasComponents) {
    ctx.addIssue({
      code: 'custom',
      message: 'produto com variações não pode possuir components no V2',
      path: ['components'],
    });
  }
  if (product.kind === 'composite' && product.trackStock) {
    ctx.addIssue({
      code: 'custom',
      message: 'produto composto controla estoque pelos componentes',
      path: ['trackStock'],
    });
  }
  if (product.trackExpiry && !product.trackLots) {
    ctx.addIssue({
      code: 'custom',
      message: 'controle de validade exige controle por lote',
      path: ['trackExpiry'],
    });
  }
  if (product.kind === 'composite' && product.trackLots) {
    ctx.addIssue({
      code: 'custom',
      message: 'produto composto controla lotes pelos componentes',
      path: ['trackLots'],
    });
  }
  if (product.kind === 'simple' && product.trackLots && !product.trackStock) {
    ctx.addIssue({
      code: 'custom',
      message: 'controle por lote exige controle de estoque',
      path: ['trackLots'],
    });
  }
  if (product.components?.some((component) => component.productId === product.id)) {
    ctx.addIssue({
      code: 'custom',
      message: 'BOM não pode referenciar o próprio produto',
      path: ['components'],
    });
  }
  const primaryCount = product.images.filter((image) => image.isPrimary).length;
  if (primaryCount > 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'apenas uma imagem pode ser primária',
      path: ['images'],
    });
  }
});

export function normalizeProductToV2(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const source = { ...input };
  const warnings: string[] = [];
  const components = Array.isArray(source.components) ? source.components : [];
  const variants = Array.isArray(source.variants) ? source.variants : [];
  const inferredKind = variants.length > 0
    ? 'variant'
    : components.length > 0
      ? 'composite'
      : 'simple';

  if (source.maxStock === null) {
    delete source.maxStock;
    warnings.push('maxStock:null normalizado para ausência');
  }

  const legacyImageUrl = typeof source.imageUrl === 'string' && source.imageUrl.trim()
    ? source.imageUrl.trim()
    : undefined;
  const images = Array.isArray(source.images) ? [...source.images] : [];
  if (images.length === 0 && legacyImageUrl) {
    images.push({
      id: 'legacy-primary',
      url: legacyImageUrl,
      sortOrder: 0,
      isPrimary: true,
    });
    warnings.push('imageUrl legado promovido para images[]');
  }

  const isLegacy = source.schemaVersion !== PRODUCT_V2_VERSION;
  return {
    ...source,
    schemaVersion: PRODUCT_V2_VERSION,
    kind: source.kind ?? inferredKind,
    purchaseUnit: source.purchaseUnit ?? source.unit,
    purchaseToStockFactor: source.purchaseToStockFactor ?? 1,
    costMethod: source.costMethod ?? 'moving_average',
    trackStock: inferredKind === 'composite' ? false : (source.trackStock ?? true),
    trackLots: inferredKind === 'composite' ? false : (source.trackLots ?? false),
    trackExpiry: inferredKind === 'composite' ? false : (source.trackExpiry ?? false),
    expiryWarningDays: source.expiryWarningDays ?? 30,
    menuAvailable: source.menuAvailable ?? true,
    imageUrl: legacyImageUrl ?? (isRecord(images[0]) ? images[0].url : undefined),
    images,
    variants,
    ...(isLegacy
      ? {
          migration: {
            sourceVersion: 1,
            warnings,
          },
        }
      : {}),
  };
}

export const ProductV2Schema = z.preprocess(normalizeProductToV2, ProductV2CanonicalSchema);

export type ProductV2 = z.infer<typeof ProductV2Schema>;
export type ProductImageV2 = z.infer<typeof ProductImageV2Schema>;
export type ProductVariantV2 = z.infer<typeof ProductVariantV2Schema>;
