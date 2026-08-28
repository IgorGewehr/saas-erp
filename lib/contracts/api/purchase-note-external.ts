import { z } from 'zod';
import { PURCHASE_NOTE_V2_STATUSES } from '@/lib/contracts/domain/purchaseNoteV2';
import { PurchaseFinancialIntentSchema } from '@/lib/contracts/api/purchase-note-financial';

export const PurchaseNoteExternalListQuerySchema = z.object({
  id: z.string().min(1).optional(),
  status: z.enum(PURCHASE_NOTE_V2_STATUSES).optional(),
  supplierId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
  cursor: z.string().min(1).max(500).optional(),
}).strict();

export const PurchaseNoteExternalActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('confirm'),
    noteId: z.string().min(1),
    retryFailed: z.boolean().optional(),
  }).strict(),
  z.object({
    action: z.literal('link_financial'),
    noteId: z.string().min(1),
    intent: PurchaseFinancialIntentSchema,
  }).strict(),
  z.object({
    action: z.literal('reverse'),
    noteId: z.string().min(1),
    reason: z.string().trim().min(5).max(500),
  }).strict(),
]);

export type PurchaseNoteExternalListQuery = z.infer<typeof PurchaseNoteExternalListQuerySchema>;
export type PurchaseNoteExternalAction = z.infer<typeof PurchaseNoteExternalActionSchema>;
