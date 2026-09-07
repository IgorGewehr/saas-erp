/**
 * lib/contracts/api/agent/purchase-notes.ts — /api/agent/tools/purchase-notes
 * Actions: list, get, match_products, apply_to_stock, list_unmatched,
 * reverse_stock, link_financial
 */

import { z } from 'zod';
import { DocIdSchema, MoneySchema } from './_shared';
import { PurchaseFinancialIntentSchema } from '@/lib/contracts/api/purchase-note-financial';
// `_shared.PurchaseNoteStatusSchema` só cobre o subconjunto V1 legado
// ('pendente' | 'importada' | 'cancelada'). Documentos reais (V1 e V2 —
// ver `lib/types/index.ts#PurchaseNoteStatus` e `PURCHASE_NOTE_V2_STATUSES`)
// também passam por 'rascunho' | 'processando' | 'parcial' | 'falha' |
// 'revertida' — todos observáveis via `list`/`get`/`apply_to_stock`/
// `reverse_stock`. Usamos o enum canônico V2 (superset) pra não rejeitar
// notas reais na validação de response nem no filtro de `list`.
import { PURCHASE_NOTE_V2_STATUSES } from '@/lib/contracts/domain/purchaseNoteV2';

const PurchaseNoteStatusSchema = z.enum(PURCHASE_NOTE_V2_STATUSES);

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
  // `lib/contracts/domain/purchaseNote.ts#PurchaseNoteItemSchema.unitPrice` é
  // a fonte canônica pra este campo e usa só `nonnegative()` — sem
  // `multipleOf(0.01)`. Preços unitários de NF-e legitimamente carregam mais
  // de 2 casas decimais (ex.: combustível a granel); `MoneySchema` (usada
  // pra valores JÁ arredondados em centavos, como `Transaction.amount`)
  // rejeitaria esses itens reais na validação de response.
  unitPrice: z.number().nonnegative(),
}).passthrough();

const ProductShape = z.object({
  id: DocIdSchema,
  name: z.string(),
}).passthrough();

/** Snapshot reduzido persistido em `PurchaseNote.unmatchedItems` (ver
 *  `lib/types/index.ts#PurchaseNote.unmatchedItems`) — não é um
 *  `PurchaseNoteItem` completo: nunca carrega `unitPrice`/`productId`. */
const UnmatchedItemSummaryShape = z.object({
  productName: z.string(),
  quantity: z.number(),
  cProd: z.string().optional(),
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
  unmatchedItems: z.array(UnmatchedItemSummaryShape),
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

export const PurchaseNotesLinkFinancialParamsSchema = z.discriminatedUnion('mode', [
  PurchaseFinancialIntentSchema.options[0].extend({
    id: DocIdSchema,
    operatorId: z.string().default('agent'),
    operatorName: z.string().default('Agente IA'),
  }),
  PurchaseFinancialIntentSchema.options[1].extend({
    id: DocIdSchema,
    operatorId: z.string().default('agent'),
    operatorName: z.string().default('Agente IA'),
  }),
]);
export const PurchaseNotesLinkFinancialDataSchema = z.object({
  note: PurchaseNoteShape,
  transaction: z.object({
    id: DocIdSchema,
    businessId: z.string(),
    type: z.literal('despesa'),
    amount: MoneySchema,
    status: z.enum(['pendente', 'pago', 'atrasado', 'cancelado']),
    purchaseNoteId: DocIdSchema,
  }).passthrough(),
  replayed: z.boolean(),
});

export const PurchaseNotesToolRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'),            params: PurchaseNotesListParamsSchema }),
  z.object({ action: z.literal('get'),             params: PurchaseNotesGetParamsSchema }),
  z.object({ action: z.literal('match_products'),  params: PurchaseNotesMatchProductsParamsSchema }),
  z.object({ action: z.literal('apply_to_stock'),  params: PurchaseNotesApplyToStockParamsSchema }),
  z.object({ action: z.literal('list_unmatched'),  params: PurchaseNotesListUnmatchedParamsSchema }),
  z.object({ action: z.literal('reverse_stock'),   params: PurchaseNotesReverseStockParamsSchema }),
  z.object({ action: z.literal('link_financial'),  params: PurchaseNotesLinkFinancialParamsSchema }),
]);

export const PURCHASE_NOTES_DATA_SCHEMAS = {
  list:           PurchaseNotesListDataSchema,
  get:            PurchaseNotesGetDataSchema,
  match_products: PurchaseNotesMatchProductsDataSchema,
  apply_to_stock: PurchaseNotesApplyToStockDataSchema,
  list_unmatched: PurchaseNotesListUnmatchedDataSchema,
  reverse_stock:  PurchaseNotesReverseStockDataSchema,
  link_financial: PurchaseNotesLinkFinancialDataSchema,
} as const;
