import { z } from 'zod';

export const PurchaseDateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Data inválida.');

export const PurchasePaymentMethodSchema = z.enum(['dinheiro', 'pix', 'credito', 'debito', 'boleto', 'outros']);

export const PurchaseFinancialIntentSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('payable'),
    dueDate: PurchaseDateOnlySchema,
    paymentMethod: PurchasePaymentMethodSchema.optional(),
  }).strict(),
  z.object({
    mode: z.literal('paid'),
    bankAccountId: z.string().min(1),
    paymentDate: PurchaseDateOnlySchema.optional(),
    paymentMethod: PurchasePaymentMethodSchema.optional(),
  }).strict(),
]);

export const LinkPurchaseFinancialRequestSchema = z.discriminatedUnion('mode', [
  PurchaseFinancialIntentSchema.options[0].extend({
    businessId: z.string().min(1),
    noteId: z.string().min(1),
  }).strict(),
  PurchaseFinancialIntentSchema.options[1].extend({
    businessId: z.string().min(1),
    noteId: z.string().min(1),
  }).strict(),
]);

export type PurchaseFinancialIntent = z.infer<typeof PurchaseFinancialIntentSchema>;
export type LinkPurchaseFinancialRequest = z.infer<typeof LinkPurchaseFinancialRequestSchema>;
