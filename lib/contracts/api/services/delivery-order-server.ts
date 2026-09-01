/**
 * lib/contracts/api/services/delivery-order-server.ts
 *
 * Contrato de input do serviço único `createDeliveryOrderWithSideEffects`
 * (lib/services/delivery-order-server.ts), usado por:
 *   - app/api/orders/public/route.ts (cardápio público, anônimo)
 *
 * Mirror de contracts/api/services/sale-server.ts — não é um `.extend()` de
 * `CreatePublicOrderBodySchema` porque ela é um `ZodEffects` (superRefine),
 * que não expõe `.extend()`. Reaproveita os mesmos sub-schemas de domínio.
 *
 * SDD: tipo derivado via z.infer — não redeclarar interface paralela.
 */

import { z } from 'zod';
import {
  DeliveryOrderAddressSchema,
  DeliveryOrderPaymentMethodSchema,
  DeliveryTypeSchema,
} from '@/contracts/domain/deliveryOrder';
import { PublicOrderItemSchema } from '@/contracts/api/orders/public';

export const CreateDeliveryOrderWithSideEffectsInputSchema = z.object({
  businessId: z.string().min(1),
  clientName: z.string().trim().min(1).max(200),
  clientPhone: z.string().min(8).max(30).optional(),
  items: z.array(PublicOrderItemSchema).min(1).max(50),
  deliveryType: DeliveryTypeSchema,
  deliveryAddress: DeliveryOrderAddressSchema.optional(),
  paymentMethod: z.union([
    DeliveryOrderPaymentMethodSchema,
    z.enum(['pix_online', 'cartao_online']),
  ]).optional(),
  changeFor: z.number().nonnegative().optional(),
  customerNotes: z.string().max(2000).optional(),
  couponCode: z.string().trim().min(1).max(100).optional(),
  giftCardCode: z.string().trim().min(1).max(100).optional(),
  /**
   * Ausente ⇒ o serviço deriva uma chave determinística do carrinho (mesmo
   * padrão de sale-server.ts). Preferir o header X-Idempotency-Key do cliente
   * quando disponível — retries sem ele ainda deduplicam pelo conteúdo, mas
   * não sobrevivem a uma alteração real do carrinho entre tentativas.
   */
  idempotencyKey: z.string().min(1).max(200).optional(),
}).superRefine((body, ctx) => {
  if (body.deliveryType !== 'entrega') return;
  const address = body.deliveryAddress;
  if (!address) {
    ctx.addIssue({ code: 'custom', message: 'Entrega exige endereço.', path: ['deliveryAddress'] });
    return;
  }
  for (const field of ['logradouro', 'numero', 'bairro', 'municipio', 'uf'] as const) {
    if (!address[field]?.trim()) {
      ctx.addIssue({ code: 'custom', message: `Endereço exige ${field}.`, path: ['deliveryAddress', field] });
    }
  }
});

export type CreateDeliveryOrderWithSideEffectsInput = z.infer<typeof CreateDeliveryOrderWithSideEffectsInputSchema>;
