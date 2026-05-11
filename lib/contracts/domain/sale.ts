/**
 * lib/contracts/domain/sale.ts
 *
 * Sale (PDV/balcão). Invariante chave:
 *   total === round2(subtotal - discount + (tip||0))
 *   sum(payments.amount) ≈ total (tolerância 1 cent)
 *   items[].total ≈ items[].quantity * items[].unitPrice - items[].discount
 */

import { z } from 'zod';

export const SALE_STATUSES = ['aberta', 'finalizada', 'cancelada'] as const;
export const SaleStatusSchema = z.enum(SALE_STATUSES);
export type SaleStatus = z.infer<typeof SaleStatusSchema>;

export const PAYMENT_METHODS = [
  'dinheiro', 'pix', 'credito', 'debito', 'boleto',
  'creditoLoja', 'semPagamento', 'pontos', 'gift_card', 'outros',
] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

const PRICE_TOLERANCE = 0.011; // 1 cent + epsilon de ponto flutuante

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const SaleItemSchema = z.object({
  id: z.string().min(1),
  productId: z.string().optional(),
  serviceId: z.string().optional(),
  description: z.string().min(1).max(300),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  total: z.number().nonnegative(),
}).superRefine((it, ctx) => {
  if (!it.productId && !it.serviceId) {
    ctx.addIssue({ code: 'custom', message: 'productId ou serviceId obrigatório', path: ['productId'] });
  }
  const expected = round2(it.quantity * it.unitPrice - it.discount);
  if (Math.abs(it.total - expected) > PRICE_TOLERANCE) {
    ctx.addIssue({
      code: 'custom',
      message: `total do item (${it.total}) ≠ quantity*unitPrice-discount (${expected})`,
      path: ['total'],
    });
  }
});

export const PaymentSchema = z.object({
  method: PaymentMethodSchema,
  amount: z.number().positive(),
  installments: z.number().int().min(1).max(48).optional(),
  cardBrand: z.string().max(50).optional(),
});

export const SaleSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  clientId: z.string().optional(),
  clientName: z.string().max(200).optional(),
  items: z.array(SaleItemSchema).min(1, 'Sale precisa ao menos 1 item'),
  payments: z.array(PaymentSchema).min(1, 'Sale precisa ao menos 1 pagamento'),
  subtotal: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  tip: z.number().nonnegative().optional(),
  total: z.number().nonnegative(),
  status: SaleStatusSchema,
  fiscalDocId: z.string().optional(),
  notes: z.string().max(2000).optional(),
  operatorId: z.string().min(1),
  operatorName: z.string().min(1),
  channelType: z.enum(['whatsapp', 'facebook', 'instagram']).optional(),
  conversationId: z.string().optional(),
  sectorId: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((s, ctx) => {
  // INVARIANTE 1: subtotal ≈ sum(items.total)
  const itemsTotal = round2(s.items.reduce((acc, it) => acc + it.total, 0));
  if (Math.abs(s.subtotal - itemsTotal) > PRICE_TOLERANCE) {
    ctx.addIssue({
      code: 'custom',
      message: `subtotal (${s.subtotal}) ≠ sum(items.total) (${itemsTotal})`,
      path: ['subtotal'],
    });
  }
  // INVARIANTE 2: total ≈ subtotal - discount + tip
  const expectedTotal = round2(s.subtotal - s.discount + (s.tip ?? 0));
  if (Math.abs(s.total - expectedTotal) > PRICE_TOLERANCE) {
    ctx.addIssue({
      code: 'custom',
      message: `total (${s.total}) ≠ subtotal-discount+tip (${expectedTotal})`,
      path: ['total'],
    });
  }
  // INVARIANTE 3: sum(payments) ≈ total (apenas pra status finalizada — aberta pode estar parcial)
  if (s.status === 'finalizada') {
    const paidTotal = round2(s.payments.reduce((acc, p) => acc + p.amount, 0));
    if (Math.abs(paidTotal - s.total) > PRICE_TOLERANCE) {
      ctx.addIssue({
        code: 'custom',
        message: `sum(payments) (${paidTotal}) ≠ total (${s.total}) numa sale finalizada`,
        path: ['payments'],
      });
    }
  }
});

export type Sale = z.infer<typeof SaleSchema>;
export type SaleItem = z.infer<typeof SaleItemSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
