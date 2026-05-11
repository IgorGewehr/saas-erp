/**
 * lib/contracts/domain/order.ts
 *
 * Order (B2B/condicional/PDV-orçamento) — NÃO é o mesmo que DeliveryOrder.
 * Veja `deliveryOrder.ts` para pedidos online vindos do cardápio.
 */

import { z } from 'zod';
import { PaymentMethodSchema, PaymentSchema } from './sale';

export const ORDER_STATUSES = [
  'pendente', 'confirmado', 'condicional', 'faturado', 'enviado', 'entregue', 'cancelado',
] as const;
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const ORDER_TYPES = ['pdv', 'b2b', 'condicional'] as const;
export const OrderTypeSchema = z.enum(ORDER_TYPES);
export type OrderType = z.infer<typeof OrderTypeSchema>;

const PRICE_TOLERANCE = 0.011;
function round2(n: number): number { return Math.round(n * 100) / 100; }

export const OrderItemSchema = z.object({
  productId: z.string().optional(),
  productName: z.string().min(1),
  sku: z.string().optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().optional(),
  total: z.number().nonnegative(),
  unit: z.string().optional(),
  ncm: z.string().optional(),
  cfop: z.string().optional(),
}).superRefine((it, ctx) => {
  const expected = round2(it.quantity * it.unitPrice - (it.discount ?? 0));
  if (Math.abs(it.total - expected) > PRICE_TOLERANCE) {
    ctx.addIssue({ code: 'custom', message: `total do item (${it.total}) ≠ quantity*unitPrice-discount (${expected})`, path: ['total'] });
  }
});

const AddressSchema = z.object({
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  cep: z.string().optional(),
}).passthrough();

export const OrderStatusHistorySchema = z.object({
  status: OrderStatusSchema,
  timestamp: z.string().min(1),
  note: z.string().optional(),
  userId: z.string().min(1),
  userName: z.string().min(1),
});

export const OrderSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  type: OrderTypeSchema,
  status: OrderStatusSchema,
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  clientCpfCnpj: z.string().optional(),
  items: z.array(OrderItemSchema).min(1),
  subtotal: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  total: z.number().nonnegative(),
  payments: z.array(PaymentSchema).optional(),
  paymentTerms: z.string().optional(),
  paymentMethod: PaymentMethodSchema.optional(),
  deliveryDate: z.string().optional(),
  deliveryAddress: AddressSchema.optional(),
  fiscalDocId: z.string().optional(),
  naturezaOperacao: z.string().optional(),
  conditionalExpiresAt: z.string().optional(),
  conditionalReturnDate: z.string().optional(),
  notes: z.string().max(5000).optional(),
  internalNotes: z.string().max(5000).optional(),
  statusHistory: z.array(OrderStatusHistorySchema).optional(),
  operatorId: z.string().min(1),
  operatorName: z.string().min(1),
  sectorId: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((o, ctx) => {
  // INVARIANTE 1: subtotal ≈ sum(items.total)
  const itemsTotal = round2(o.items.reduce((acc, it) => acc + it.total, 0));
  if (Math.abs(o.subtotal - itemsTotal) > PRICE_TOLERANCE) {
    ctx.addIssue({ code: 'custom', message: `subtotal (${o.subtotal}) ≠ sum(items) (${itemsTotal})`, path: ['subtotal'] });
  }
  // INVARIANTE 2: total ≈ subtotal - discount
  const expectedTotal = round2(o.subtotal - o.discount);
  if (Math.abs(o.total - expectedTotal) > PRICE_TOLERANCE) {
    ctx.addIssue({ code: 'custom', message: `total (${o.total}) ≠ subtotal-discount (${expectedTotal})`, path: ['total'] });
  }
  // INVARIANTE 3: type=condicional precisa de conditionalExpiresAt
  if (o.type === 'condicional' && !o.conditionalExpiresAt) {
    ctx.addIssue({ code: 'custom', message: 'Order type=condicional exige conditionalExpiresAt', path: ['conditionalExpiresAt'] });
  }
});

export type Order = z.infer<typeof OrderSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
