import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).optional();
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD.').optional();

export const PurchaseNoteReviewItemSchema = z.object({
  lineId: z.string().min(1).max(100),
  action: z.enum(['match', 'create', 'skip']),
  productId: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
  conversionFactor: z.number().positive(),
  landedUnitCost: z.number().nonnegative(),
  newProduct: z.object({
    name: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(100),
    unit: z.string().trim().min(1).max(20),
    sku: optionalText(80),
    barcode: optionalText(80),
  }).optional(),
  lot: z.object({
    code: z.string().trim().min(1).max(100),
    manufacturedAt: optionalDate,
    expiresAt: optionalDate,
  }).superRefine((lot, ctx) => {
    if (lot.manufacturedAt && lot.expiresAt && lot.expiresAt < lot.manufacturedAt) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'A validade não pode anteceder a fabricação.' });
    }
  }).optional(),
}).superRefine((item, ctx) => {
  if (item.action === 'match' && !item.productId) {
    ctx.addIssue({ code: 'custom', path: ['productId'], message: 'Vincular exige um produto.' });
  }
  if (item.variantId && !item.productId) {
    ctx.addIssue({ code: 'custom', path: ['variantId'], message: 'A variação exige um produto.' });
  }
  if (item.action === 'match' && item.newProduct) {
    ctx.addIssue({ code: 'custom', path: ['newProduct'], message: 'Vincular não aceita um novo produto.' });
  }
  if (item.action === 'create' && !item.newProduct) {
    ctx.addIssue({ code: 'custom', path: ['newProduct'], message: 'Criar exige os dados do novo produto.' });
  }
  if (item.action === 'create' && (item.productId || item.variantId)) {
    ctx.addIssue({ code: 'custom', message: 'Criar não aceita produto vinculado.' });
  }
  if (item.action === 'skip' && (item.productId || item.variantId || item.newProduct || item.lot)) {
    ctx.addIssue({ code: 'custom', message: 'Ignorar não aceita produto ou lote.' });
  }
});

export const ReviewPurchaseNoteRequestSchema = z.object({
  businessId: z.string().min(1),
  noteId: z.string().min(1),
  items: z.array(PurchaseNoteReviewItemSchema).min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
}).strict().superRefine((request, ctx) => {
  const ids = new Set<string>();
  request.items.forEach((item, index) => {
    if (ids.has(item.lineId)) ctx.addIssue({ code: 'custom', path: ['items', index, 'lineId'], message: 'Linha duplicada.' });
    ids.add(item.lineId);
  });
});

export type PurchaseNoteReviewItem = z.infer<typeof PurchaseNoteReviewItemSchema>;
export type ReviewPurchaseNoteRequest = z.infer<typeof ReviewPurchaseNoteRequestSchema>;
