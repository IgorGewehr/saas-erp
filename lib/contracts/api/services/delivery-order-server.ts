/**
 * lib/contracts/api/services/delivery-order-server.ts
 *
 * Contrato de input do serviço único `createDeliveryOrderWithSideEffects`
 * (lib/services/delivery-order-server.ts), usado por:
 *   - app/api/orders/public/route.ts (cardápio público, anônimo, canal 'site')
 *   - app/api/orders/manual/route.ts (pedido manual autenticado, canal 'manual', M02.5b)
 *
 * Mirror de contracts/api/services/sale-server.ts — não é um `.extend()` de
 * `CreatePublicOrderBodySchema` porque ela é um `ZodEffects` (superRefine),
 * que não expõe `.extend()`. Reaproveita os mesmos sub-schemas de domínio.
 *
 * `operatorId`/`operatorName` seguem o padrão de sale-server.ts: viajam no
 * input, mas a rota autenticada SEMPRE os sobrescreve com a identidade do
 * token verificado — nunca confiar no valor enviado pelo cliente.
 *
 * SDD: tipo derivado via z.infer — não redeclarar interface paralela.
 */

import { z } from 'zod';
import {
  DeliveryOrderAddressSchema,
  DeliveryOrderChannelSchema,
  DeliveryOrderPaymentMethodSchema,
  DeliveryOrderPaymentStatusSchema,
  DeliveryTypeSchema,
} from '@/contracts/domain/deliveryOrder';
import { PublicOrderItemSchema } from '@/contracts/api/orders/public';

export const CreateDeliveryOrderWithSideEffectsInputSchema = z.object({
  businessId: z.string().min(1),
  /** Cliente já resolvido pelo operador (seletor da UI). Tem precedência sobre
   *  clientPhone quando ambos vêm preenchidos (formulário manual sempre manda
   *  os dois juntos ao escolher um cliente existente). */
  clientId: z.string().min(1).optional(),
  clientName: z.string().trim().min(1).max(200),
  clientPhone: z.string().min(8).max(30).optional(),
  items: z.array(PublicOrderItemSchema).min(1).max(50),
  deliveryType: DeliveryTypeSchema,
  deliveryAddress: DeliveryOrderAddressSchema.optional(),
  /** Taxa proposta pelo operador (reais) quando nenhuma zona resolve o
   *  endereço. Só tem efeito com permissão de gerente+ (ver executionContext
   *  de delivery-order-server.ts); ignorada quando uma zona casa. */
  manualDeliveryFee: z.number().nonnegative().optional(),
  /** Desconto manual (reais) — exige permissão de gerente+, mesmo mecanismo
   *  do PDV (CommercialQuoteRequestSchema.manualDiscount). */
  discount: z.number().nonnegative().optional(),
  discountReason: z.string().min(3).max(300).optional(),
  paymentMethod: z.union([
    DeliveryOrderPaymentMethodSchema,
    z.enum(['pix_online', 'cartao_online']),
  ]).optional(),
  /** Ausente ⇒ o serviço mantém 'pendente' (comportamento do canal site). */
  paymentStatus: DeliveryOrderPaymentStatusSchema.optional(),
  changeFor: z.number().nonnegative().optional(),
  customerNotes: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
  /** Minutos estimados até a entrega/retirada — o servidor calcula `estimatedDeliveryAt`. */
  estimatedMinutes: z.number().int().positive().max(600).optional(),
  couponCode: z.string().trim().min(1).max(100).optional(),
  giftCardCode: z.string().trim().min(1).max(100).optional(),
  /** Sempre sobrescritos pela rota autenticada a partir do token verificado. */
  operatorId: z.string().min(1).optional(),
  operatorName: z.string().trim().min(1).max(200).optional(),
  /** Canal de ORIGEM do pedido (document.channel) — distinto do canal do
   *  núcleo comercial (que governa regras de cotação). Default 'site'
   *  preserva o hardcode do canal público; o manual manda 'manual' ou o
   *  canal da conversa de origem (whatsapp/instagram/facebook). */
  originChannel: DeliveryOrderChannelSchema.optional(),
  conversationId: z.string().min(1).optional(),
  contactExternalId: z.string().min(1).optional(),
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
