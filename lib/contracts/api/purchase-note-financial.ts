import { z } from 'zod';

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Data inválida.');

const PaymentMethodSchema = z.enum(['dinheiro', 'pix', 'credito', 'debito', 'boleto', 'outros']);

export const LinkPurchaseFinancialRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    businessId: z.string().min(1),
    noteId: z.string().min(1),
    mode: z.literal('payable'),
    dueDate: DateOnlySchema,
    paymentMethod: PaymentMethodSchema.optional(),
  }).strict(),
  z.object({
    businessId: z.string().min(1),
    noteId: z.string().min(1),
    mode: z.literal('paid'),
    bankAccountId: z.string().min(1),
    paymentDate: DateOnlySchema.optional(),
    paymentMethod: PaymentMethodSchema.optional(),
  }).strict(),
]);

export type LinkPurchaseFinancialRequest = z.infer<typeof LinkPurchaseFinancialRequestSchema>;
