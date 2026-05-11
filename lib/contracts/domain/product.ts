/**
 * lib/contracts/domain/product.ts
 *
 * Espelha lib/types/index.ts:Product. Inclui:
 * - BOM (`components[]`) — invariante: 1 nível, sem ciclo (productId ≠ pai)
 * - Modifiers (`modifierGroups[]`) — strategy: sum | max | avg
 * - Fiscal overrides per-produto
 *
 * Use `ProductSchema` ao validar produtos vindos de qualquer rota/source.
 */

import { z } from 'zod';

export const ProductUnitSchema = z.string().min(1).max(20);
export const NcmSchema = z.string().regex(/^\d{8}$/, 'NCM = 8 dígitos').optional();
export const CfopSchema = z.string().regex(/^\d{4}$/, 'CFOP = 4 dígitos').optional();

export const PRODUCT_DIETARY = ['vegan', 'vegetarian', 'glutenfree', 'lactosefree', 'organic', 'picante', 'alcool', 'kids'] as const;
export const ProductDietarySchema = z.enum(PRODUCT_DIETARY);

export const MODIFIER_SELECTION_TYPES = ['single', 'multiple', 'quantity'] as const;
export const MODIFIER_PRICE_STRATEGIES = ['sum', 'max', 'avg'] as const;

export const ProductComponentSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().positive(),
});

export const ProductModifierOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  additionalPrice: z.number().nonnegative(),
  imageUrl: z.string().url().optional(),
  isDefault: z.boolean().optional(),
  maxQuantity: z.number().int().positive().optional(),
  available: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
});

export const ProductModifierGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  required: z.boolean(),
  minSelections: z.number().int().nonnegative(),
  maxSelections: z.number().int().positive(),
  selectionType: z.enum(MODIFIER_SELECTION_TYPES),
  priceStrategy: z.enum(MODIFIER_PRICE_STRATEGIES),
  options: z.array(ProductModifierOptionSchema).min(1),
  sortOrder: z.number().int().nonnegative(),
}).superRefine((g, ctx) => {
  if (g.minSelections > g.maxSelections) {
    ctx.addIssue({ code: 'custom', message: 'minSelections não pode > maxSelections', path: ['minSelections'] });
  }
  if (g.selectionType === 'single' && g.maxSelections !== 1) {
    ctx.addIssue({ code: 'custom', message: 'selectionType=single exige maxSelections=1', path: ['maxSelections'] });
  }
  if (g.required && g.minSelections < 1) {
    ctx.addIssue({ code: 'custom', message: 'required=true exige minSelections>=1', path: ['minSelections'] });
  }
});

export const ProductFiscalTaxSchema = z.object({
  icms: z.object({ cst: z.string().optional(), csosn: z.string().optional(), rate: z.number().min(0).max(100).optional() }).optional(),
  pis: z.object({ cst: z.string().optional(), rate: z.number().min(0).max(100).optional() }).optional(),
  cofins: z.object({ cst: z.string().optional(), rate: z.number().min(0).max(100).optional() }).optional(),
  ipi: z.object({ cst: z.string().optional(), rate: z.number().min(0).max(100).optional(), cEnq: z.string().optional() }).optional(),
});

export const ProductSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sku: z.string().max(80).optional(),
  barcode: z.string().max(80).optional(),
  category: z.string().min(1).max(100),
  unit: ProductUnitSchema,
  costPrice: z.number().nonnegative(),
  salePrice: z.number().nonnegative(),
  currentStock: z.number(),
  minStock: z.number().nonnegative(),
  maxStock: z.number().nonnegative().optional(),
  ncm: z.string().optional(),
  cfop: z.string().optional(),
  cest: z.string().optional(),
  icmsOrigem: z.enum(['0','1','2','3','4','5','6','7']).optional(),
  gtin: z.string().optional(),
  gtinTrib: z.string().optional(),
  unidadeTrib: z.string().optional(),
  fiscalTax: ProductFiscalTaxSchema.optional(),
  isActive: z.boolean(),
  imageUrl: z.string().url().optional().or(z.literal('')),
  isDeliverable: z.boolean().optional(),
  menuCategory: z.string().optional(),
  menuCategoryId: z.string().optional(),
  menuDescription: z.string().max(400).optional(),
  preparationTime: z.number().int().nonnegative().optional(),
  dietary: z.array(ProductDietarySchema).optional(),
  modifierGroups: z.array(ProductModifierGroupSchema).optional(),
  hasModifiers: z.boolean().optional(),
  components: z.array(ProductComponentSchema).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((p, ctx) => {
  // INVARIANTE 1: BOM sem auto-referência (não pode ter componente apontando pra si)
  if (p.components?.some((c) => c.productId === p.id)) {
    ctx.addIssue({ code: 'custom', message: 'BOM ciclo: components não pode referenciar o próprio produto', path: ['components'] });
  }
  // INVARIANTE 2: BOM e maxStock são mutuamente exclusivos no MVP (BOM não tem stock próprio)
  if (p.components?.length && p.maxStock !== undefined && p.maxStock > 0) {
    ctx.addIssue({ code: 'custom', message: 'Produto com BOM (components) não deve ter maxStock — stock é dos componentes', path: ['maxStock'] });
  }
  // INVARIANTE 3: salePrice >= 0 já garantido pelo schema; sem ICMS/PIS/COFINS rate > 100
});

export type Product = z.infer<typeof ProductSchema>;
export type ProductComponent = z.infer<typeof ProductComponentSchema>;
export type ProductModifierGroup = z.infer<typeof ProductModifierGroupSchema>;
