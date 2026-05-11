/**
 * lib/contracts/domain/deliveryOrder.ts
 *
 * Pedido online vindo do cardápio. Aceita modifiers e tem FSM de 6 estados
 * (ver lib/contracts/fsm/deliveryOrder.ts). É DIFERENTE de Order.
 */

import { z } from 'zod';

export const DELIVERY_ORDER_STATUSES = [
  'recebido', 'preparando', 'pronto', 'saiu_entrega', 'entregue', 'cancelado',
] as const;
export const DeliveryOrderStatusSchema = z.enum(DELIVERY_ORDER_STATUSES);
export type DeliveryOrderStatus = z.infer<typeof DeliveryOrderStatusSchema>;

export const DELIVERY_ORDER_PAYMENT_STATUSES = ['pendente', 'pago', 'estornado'] as const;
export const DeliveryOrderPaymentStatusSchema = z.enum(DELIVERY_ORDER_PAYMENT_STATUSES);

export const DELIVERY_ORDER_CHANNELS = ['whatsapp', 'facebook', 'instagram', 'manual', 'site'] as const;
export const DeliveryOrderChannelSchema = z.enum(DELIVERY_ORDER_CHANNELS);

export const DELIVERY_TYPES = ['entrega', 'retirada'] as const;
export const DeliveryTypeSchema = z.enum(DELIVERY_TYPES);

export const DELIVERY_PAYMENT_METHODS = [
  'dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'voucher', 'outro',
] as const;
export const DeliveryOrderPaymentMethodSchema = z.enum(DELIVERY_PAYMENT_METHODS);

const PRICE_TOLERANCE = 0.011;
function round2(n: number): number { return Math.round(n * 100) / 100; }

export const SelectedModifierOptionSchema = z.object({
  optionId: z.string().min(1),
  optionName: z.string().min(1),
  additionalPrice: z.number().nonnegative(),
  quantity: z.number().int().positive(),
});

export const SelectedModifierSchema = z.object({
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  priceStrategy: z.enum(['sum', 'max', 'avg']),
  selectedOptions: z.array(SelectedModifierOptionSchema).min(1),
});

export const DeliveryOrderItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  total: z.number().nonnegative(),
  notes: z.string().max(500).optional(),
  imageUrl: z.string().url().optional(),
  selectedModifiers: z.array(SelectedModifierSchema).optional(),
  basePrice: z.number().nonnegative().optional(),
}).superRefine((it, ctx) => {
  const expected = round2(it.quantity * it.unitPrice);
  if (Math.abs(it.total - expected) > PRICE_TOLERANCE) {
    ctx.addIssue({ code: 'custom', message: `total (${it.total}) ≠ quantity*unitPrice (${expected})`, path: ['total'] });
  }
});

export const DeliveryOrderAddressSchema = z.object({
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  municipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  reference: z.string().optional(),
});

export const DeliveryOrderSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  number: z.number().int().nonnegative(),
  status: DeliveryOrderStatusSchema,
  clientId: z.string().optional(),
  clientName: z.string().min(1),
  clientPhone: z.string().optional(),
  channel: DeliveryOrderChannelSchema.optional(),
  conversationId: z.string().optional(),
  contactExternalId: z.string().optional(),
  items: z.array(DeliveryOrderItemSchema).min(1),
  subtotal: z.number().nonnegative(),
  deliveryFee: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  total: z.number().nonnegative(),
  deliveryType: DeliveryTypeSchema,
  deliveryAddress: DeliveryOrderAddressSchema.optional(),
  deliveryPersonId: z.string().optional(),
  deliveryPersonName: z.string().optional(),
  estimatedDeliveryAt: z.string().optional(),
  deliveredAt: z.string().optional(),
  paymentMethod: DeliveryOrderPaymentMethodSchema.optional(),
  paymentStatus: DeliveryOrderPaymentStatusSchema,
  changeFor: z.number().nonnegative().optional(),
  customerNotes: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
  stockDeductedAt: z.string().optional(),
  stockMovementIds: z.array(z.string()).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((o, ctx) => {
  // INVARIANTE 1: subtotal ≈ sum(items.total)
  const itemsTotal = round2(o.items.reduce((acc, it) => acc + it.total, 0));
  if (Math.abs(o.subtotal - itemsTotal) > PRICE_TOLERANCE) {
    ctx.addIssue({ code: 'custom', message: `subtotal (${o.subtotal}) ≠ sum(items) (${itemsTotal})`, path: ['subtotal'] });
  }
  // INVARIANTE 2: total ≈ subtotal + deliveryFee - discount
  const expectedTotal = round2(o.subtotal + (o.deliveryFee ?? 0) - (o.discount ?? 0));
  if (Math.abs(o.total - expectedTotal) > PRICE_TOLERANCE) {
    ctx.addIssue({ code: 'custom', message: `total (${o.total}) ≠ subtotal+deliveryFee-discount (${expectedTotal})`, path: ['total'] });
  }
  // INVARIANTE 3: deliveryType=entrega ⇒ deliveryAddress obrigatório
  if (o.deliveryType === 'entrega' && !o.deliveryAddress) {
    ctx.addIssue({ code: 'custom', message: 'deliveryType=entrega exige deliveryAddress', path: ['deliveryAddress'] });
  }
  // INVARIANTE 4: status='entregue' ⇒ deliveredAt set
  if (o.status === 'entregue' && !o.deliveredAt) {
    ctx.addIssue({ code: 'custom', message: 'status=entregue exige deliveredAt', path: ['deliveredAt'] });
  }
});

export type DeliveryOrder = z.infer<typeof DeliveryOrderSchema>;
export type DeliveryOrderItem = z.infer<typeof DeliveryOrderItemSchema>;
