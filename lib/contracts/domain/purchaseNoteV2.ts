/**
 * Contrato V2 de nota de compra.
 *
 * Formaliza processamento concorrente, resultado por item, custos acessórios,
 * vínculo financeiro e exceção explícita para documentos legados cuja trilha de
 * movimentos está incompleta.
 */

import { z } from 'zod';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const PURCHASE_NOTE_V2_VERSION = 2 as const;
export const PURCHASE_NOTE_V2_STATUSES = [
  'rascunho',
  'pendente',
  'processando',
  'importada',
  'parcial',
  'falha',
  'cancelada',
  'revertida',
] as const;

export const PurchaseNoteItemV2Schema = z.object({
  lineId: z.string().min(1),
  supplierProductCode: z.string().optional(),
  productName: z.string().min(1),
  gtin: z.string().optional(),
  ncm: z.string().optional(),
  cfop: z.string().optional(),
  purchaseUnit: z.string().min(1).max(20),
  purchaseQuantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  productTotal: z.number().nonnegative(),
  taxes: z.object({
    icms: z.number().nonnegative().optional(),
    ipi: z.number().nonnegative().optional(),
    pis: z.number().nonnegative().optional(),
    cofins: z.number().nonnegative().optional(),
  }).optional(),
  allocatedCosts: z.object({
    freight: z.number().default(0),
    insurance: z.number().default(0),
    discount: z.number().default(0),
    other: z.number().default(0),
    st: z.number().default(0),
    ipi: z.number().default(0),
  }).optional(),
  action: z.enum(['pending', 'match', 'create', 'skip']),
  productId: z.string().optional(),
  stockUnit: z.string().min(1).max(20),
  conversionFactor: z.number().positive(),
  stockQuantity: z.number().positive(),
  landedUnitCost: z.number().nonnegative(),
  importStatus: z.enum(['pending', 'imported', 'skipped', 'error']),
  stockMovementId: z.string().optional(),
  error: z.string().optional(),
  lot: z.object({
    code: z.string().min(1),
    manufacturedAt: z.string().optional(),
    expiresAt: z.string().optional(),
  }).optional(),
}).superRefine((item, ctx) => {
  const expected = Math.round(item.purchaseQuantity * item.unitPrice * 100) / 100;
  if (Math.abs(item.productTotal - expected) > 0.011) {
    ctx.addIssue({
      code: 'custom',
      message: `productTotal (${item.productTotal}) difere de quantidade × preço (${expected})`,
      path: ['productTotal'],
    });
  }
  const expectedStock = item.purchaseQuantity * item.conversionFactor;
  if (Math.abs(item.stockQuantity - expectedStock) > 1e-6) {
    ctx.addIssue({
      code: 'custom',
      message: 'stockQuantity deve refletir purchaseQuantity × conversionFactor',
      path: ['stockQuantity'],
    });
  }
  if (item.action === 'match' && !item.productId) {
    ctx.addIssue({ code: 'custom', message: 'action=match exige productId', path: ['productId'] });
  }
  if (item.importStatus === 'imported' && !item.stockMovementId) {
    ctx.addIssue({
      code: 'custom',
      message: 'item importado exige stockMovementId',
      path: ['stockMovementId'],
    });
  }
});

const PurchaseNoteV2CanonicalSchema = z.object({
  schemaVersion: z.literal(PURCHASE_NOTE_V2_VERSION),
  id: z.string().min(1),
  businessId: z.string().min(1),
  accessKey: z.string().regex(/^\d{44}$/, 'Chave de acesso = 44 dígitos'),
  numero: z.string().min(1),
  serie: z.string().min(1),
  issueDate: z.string().min(1),
  source: z.enum(['manual_upload', 'sefaz_sync', 'migration']),
  supplier: z.object({
    id: z.string().optional(),
    document: z.string().regex(/^(\d{11}|\d{14})$/),
    name: z.string().min(1),
  }),
  items: z.array(PurchaseNoteItemV2Schema).min(1),
  totals: z.object({
    products: z.number().nonnegative(),
    freight: z.number().nonnegative().default(0),
    insurance: z.number().nonnegative().default(0),
    discount: z.number().nonnegative().default(0),
    other: z.number().nonnegative().default(0),
    st: z.number().nonnegative().default(0),
    ipi: z.number().nonnegative().default(0),
    invoice: z.number().nonnegative(),
  }),
  status: z.enum(PURCHASE_NOTE_V2_STATUSES),
  importClaim: z.object({
    token: z.string().min(1),
    claimedBy: z.string().min(1),
    claimedAt: z.string().min(1),
    expiresAt: z.string().min(1),
  }).optional(),
  stockImportedAt: z.string().optional(),
  stockMovementIds: z.array(z.string()),
  importedAt: z.string().optional(),
  revertedAt: z.string().optional(),
  importError: z.string().optional(),
  xmlStoragePath: z.string().optional(),
  financial: z.object({
    transactionId: z.string().optional(),
    bankAccountId: z.string().optional(),
    status: z.enum(['not_requested', 'payable_created', 'paid', 'reversed']),
  }).optional(),
  migration: z.object({
    sourceVersion: z.literal(1),
    auditIncomplete: z.boolean(),
    warnings: z.array(z.string()),
  }).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((note, ctx) => {
  if (note.status === 'processando' && !note.importClaim) {
    ctx.addIssue({
      code: 'custom',
      message: 'status=processando exige importClaim',
      path: ['importClaim'],
    });
  }
  if (['importada', 'parcial'].includes(note.status) && !note.stockImportedAt) {
    ctx.addIssue({
      code: 'custom',
      message: `${note.status} exige stockImportedAt`,
      path: ['stockImportedAt'],
    });
  }
  const legacyAuditException = note.migration?.sourceVersion === 1 && note.migration.auditIncomplete;
  if (
    ['importada', 'parcial'].includes(note.status) &&
    note.stockMovementIds.length === 0 &&
    !legacyAuditException
  ) {
    ctx.addIssue({
      code: 'custom',
      message: `${note.status} exige stockMovementIds`,
      path: ['stockMovementIds'],
    });
  }
  if (note.status === 'falha' && !note.importError) {
    ctx.addIssue({ code: 'custom', message: 'status=falha exige importError', path: ['importError'] });
  }
  if (note.status === 'revertida' && !note.revertedAt) {
    ctx.addIssue({ code: 'custom', message: 'status=revertida exige revertedAt', path: ['revertedAt'] });
  }
});

function normalizeLegacyItem(item: unknown, index: number, imported: boolean): unknown {
  if (!isRecord(item)) return item;
  const purchaseQuantity = Number(item.purchaseQuantity ?? item.quantity ?? 0);
  const unitPrice = Number(item.unitPrice ?? 0);
  const conversionFactor = Number(item.conversionFactor ?? 1);
  const productId = typeof item.productId === 'string' ? item.productId : undefined;
  const movementId = typeof item.stockMovementId === 'string' ? item.stockMovementId : undefined;
  return {
    ...item,
    lineId: item.lineId ?? String(index + 1),
    supplierProductCode: item.supplierProductCode ?? item.cProd ?? item.productCode,
    purchaseUnit: item.purchaseUnit ?? item.unit,
    purchaseQuantity,
    productTotal: Number(item.productTotal ?? item.total ?? purchaseQuantity * unitPrice),
    action: item.action ?? item.importAction ?? (productId ? 'match' : 'pending'),
    stockUnit: item.stockUnit ?? item.unit,
    conversionFactor,
    stockQuantity: Number(item.stockQuantity ?? purchaseQuantity * conversionFactor),
    landedUnitCost: Number(item.landedUnitCost ?? unitPrice),
    importStatus: item.importStatus ?? (imported && productId && movementId ? 'imported' : 'pending'),
  };
}

export function normalizePurchaseNoteToV2(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const source = { ...input };
  const legacyStatus = source.status;
  const status = legacyStatus === 'importada'
    ? (Array.isArray(source.unmatchedItems) && source.unmatchedItems.length > 0 ? 'parcial' : 'importada')
    : legacyStatus === 'cancelada'
      ? 'cancelada'
      : legacyStatus ?? 'pendente';
  const imported = status === 'importada' || status === 'parcial';
  const movementIds = Array.isArray(source.stockMovementIds)
    ? source.stockMovementIds.filter((id): id is string => typeof id === 'string')
    : [];
  const isLegacy = source.schemaVersion !== PURCHASE_NOTE_V2_VERSION;
  const warnings: string[] = [];
  if (imported && movementIds.length === 0) {
    warnings.push('nota legada importada sem stockMovementIds');
  }

  return {
    ...source,
    schemaVersion: PURCHASE_NOTE_V2_VERSION,
    source: source.source ?? (source.xmlSource === 'sefaz_sync' ? 'sefaz_sync' : 'manual_upload'),
    supplier: source.supplier ?? {
      id: source.supplierId,
      document: String(source.supplierCnpj ?? '').replace(/\D/g, ''),
      name: source.supplierName,
    },
    items: Array.isArray(source.items)
      ? source.items.map((item, index) => normalizeLegacyItem(item, index, imported))
      : source.items,
    totals: source.totals ?? {
      products: Number(source.totalProducts ?? source.subtotal ?? source.total ?? source.totalValue ?? 0),
      freight: 0,
      insurance: 0,
      discount: 0,
      other: 0,
      st: 0,
      ipi: 0,
      invoice: Number(source.totalValue ?? source.total ?? 0),
    },
    status,
    stockMovementIds: movementIds,
    ...(isLegacy
      ? {
          migration: {
            sourceVersion: 1,
            auditIncomplete: imported && movementIds.length === 0,
            warnings,
          },
        }
      : {}),
  };
}

export const PurchaseNoteV2Schema = z.preprocess(
  normalizePurchaseNoteToV2,
  PurchaseNoteV2CanonicalSchema,
);

export type PurchaseNoteV2 = z.infer<typeof PurchaseNoteV2Schema>;
export type PurchaseNoteItemV2 = z.infer<typeof PurchaseNoteItemV2Schema>;
