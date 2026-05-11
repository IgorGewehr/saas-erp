/**
 * lib/contracts/domain/purchaseNote.ts
 *
 * Nota fiscal de fornecedor. Importação aumenta estoque (1 entrada por item
 * matched). Idempotência via `stockImportedAt` — uma vez importada, não pode
 * ser reimportada (status terminal `importada` ou `cancelada`).
 */

import { z } from 'zod';

export const PURCHASE_NOTE_STATUSES = ['pendente', 'importada', 'cancelada'] as const;
export const PurchaseNoteStatusSchema = z.enum(PURCHASE_NOTE_STATUSES);
export type PurchaseNoteStatus = z.infer<typeof PurchaseNoteStatusSchema>;

export const PURCHASE_ITEM_ACTIONS = ['match', 'create', 'skip'] as const;
export const PurchaseNoteItemActionSchema = z.enum(PURCHASE_ITEM_ACTIONS);

const PRICE_TOLERANCE = 0.011;
function round2(n: number): number { return Math.round(n * 100) / 100; }

export const PurchaseNoteItemSchema = z.object({
  productId: z.string().optional(),  // matched product no nosso catálogo
  productName: z.string().min(1),
  cProd: z.string().optional(),
  ncm: z.string().optional(),
  cfop: z.string().optional(),
  unit: z.string().min(1).max(20),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative(),
  icms: z.number().nonnegative().optional(),
  ipi: z.number().nonnegative().optional(),
  pis: z.number().nonnegative().optional(),
  cofins: z.number().nonnegative().optional(),
  importAction: PurchaseNoteItemActionSchema.optional(),
}).superRefine((it, ctx) => {
  const expected = round2(it.quantity * it.unitPrice);
  if (Math.abs(it.total - expected) > PRICE_TOLERANCE) {
    ctx.addIssue({ code: 'custom', message: `total (${it.total}) ≠ quantity*unitPrice (${expected})`, path: ['total'] });
  }
});

const AccessKeySchema = z.string().regex(/^\d{44}$/, 'Chave de acesso = 44 dígitos');

export const PurchaseNoteSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  accessKey: AccessKeySchema,
  numero: z.string().min(1),
  serie: z.string().min(1),
  issueDate: z.string().min(1),
  supplierName: z.string().min(1),
  supplierCnpj: z.string().regex(/^\d{14}$/, 'CNPJ = 14 dígitos'),
  supplierId: z.string().optional(),
  items: z.array(PurchaseNoteItemSchema).min(1),
  subtotal: z.number().nonnegative().optional(),
  total: z.number().nonnegative(),
  status: PurchaseNoteStatusSchema,
  stockImportedAt: z.string().optional(),
  stockMovementIds: z.array(z.string()).optional(),
  unmatchedItems: z.array(z.unknown()).optional(),
  notes: z.string().max(2000).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((n, ctx) => {
  // INVARIANTE 1: status='importada' ⇒ stockImportedAt obrigatório
  if (n.status === 'importada' && !n.stockImportedAt) {
    ctx.addIssue({ code: 'custom', message: 'status=importada exige stockImportedAt (idempotência)', path: ['stockImportedAt'] });
  }
  // INVARIANTE 2: stockImportedAt presente ⇒ status DEVE ser importada (não pode reverter pra pendente)
  if (n.stockImportedAt && n.status === 'pendente') {
    ctx.addIssue({ code: 'custom', message: 'stockImportedAt presente exige status=importada (não voltar para pendente)', path: ['status'] });
  }
  // INVARIANTE 3: stockImportedAt ⇒ pelo menos 1 stockMovementId (auditoria)
  if (n.stockImportedAt && (!n.stockMovementIds || n.stockMovementIds.length === 0)) {
    ctx.addIssue({ code: 'custom', message: 'stockImportedAt exige stockMovementIds (auditoria)', path: ['stockMovementIds'] });
  }
});

export type PurchaseNote = z.infer<typeof PurchaseNoteSchema>;
export type PurchaseNoteItem = z.infer<typeof PurchaseNoteItemSchema>;
