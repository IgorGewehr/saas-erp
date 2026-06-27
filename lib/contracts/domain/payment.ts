/**
 * lib/contracts/domain/payment.ts
 *
 * Subdomínio "dinheiro" do pagamento online (Mercado Pago, v1: PIX + Cartão).
 *
 * DECISÃO v1: os campos abaixo vivem INLINE no DeliveryOrder (não em coleção
 * separada). Este schema é a fonte da verdade do BLOCO de pagamento que o
 * DeliveryOrder reusa (lib/contracts/domain/deliveryOrder.ts e lib/types).
 *
 * SEPARAÇÃO DE CONCEITOS:
 *   - paymentFsmStatus  → ciclo de vida do DINHEIRO (lib/contracts/fsm/payment.ts)
 *   - DeliveryOrder.status → ciclo de FABRICAÇÃO do pedido (fsm/deliveryOrder.ts)
 *   São FSMs independentes: um pedido pode estar "preparando" e "paid", ou
 *   "entregue" e "pending" (pagamento na entrega).
 */

import { z } from 'zod';
import { PaymentFsmStatusSchema } from '../fsm/payment';

export const PAYMENT_METHOD_KINDS = ['pix', 'card'] as const;
export const PaymentMethodKindSchema = z.enum(PAYMENT_METHOD_KINDS);
export type PaymentMethodKind = z.infer<typeof PaymentMethodKindSchema>;

/**
 * Bloco de pagamento online embutido no pedido. Todos opcionais: um pedido
 * pago na entrega não preenche nenhum destes (paymentFsmStatus fica undefined
 * e o legado DeliveryOrder.paymentStatus continua a fonte pra esses casos).
 */
export const PaymentBlockSchema = z.object({
  paymentProvider: z.literal('mercadopago'),
  /** ID do payment no MP (após criar cobrança). Idempotência de webhook. */
  externalPaymentId: z.string().optional(),
  /** ID da preference (Checkout Pro/Bricks), quando aplicável. */
  preferenceId: z.string().optional(),
  paymentMethodKind: PaymentMethodKindSchema.optional(),

  // ── PIX ──
  /** Conteúdo bruto do QR (EMV). */
  qrCode: z.string().optional(),
  /** PNG do QR em base64 (sem prefixo data:). */
  qrCodeBase64: z.string().optional(),
  /** Alias amigável do "copia e cola" (== qrCode na prática do MP). */
  copiaECola: z.string().optional(),

  /** URL do comprovante/boleto/ticket gerado pelo MP. */
  ticketUrl: z.string().url().optional(),

  /** Valor da cobrança online (R$). Nome casado 1:1 com o DeliveryOrder
   *  (paymentAmount) pra o webhook/UI lerem/escreverem o MESMO campo. */
  paymentAmount: z.number().nonnegative().optional(),
  paidAt: z.string().datetime().optional(),
  refundedAt: z.string().datetime().optional(),
  /** Expiração da cobrança PIX (ISO). Após isso → expired. Nome casado 1:1
   *  com o DeliveryOrder (paymentExpiresAt). */
  paymentExpiresAt: z.string().datetime().optional(),

  paymentFsmStatus: PaymentFsmStatusSchema.optional(),
});
export type PaymentBlock = z.infer<typeof PaymentBlockSchema>;

// ─── external_reference: cola pedido ↔ webhook MP ──────────────────────────
//
// O MP devolve `external_reference` (string opaca) nas notificações. Usamos um
// formato estável `${businessId}:order:${orderId}` pra rotear o webhook ao
// tenant + pedido certos SEM lookup adicional e respeitando R1 (multi-tenant).

const EXTERNAL_REFERENCE_KIND = 'order' as const;

export function buildExternalReference(businessId: string, orderId: string): string {
  return `${businessId}:${EXTERNAL_REFERENCE_KIND}:${orderId}`;
}

const ExternalReferencePartsSchema = z
  .tuple([
    z.string().min(1), // businessId
    z.literal(EXTERNAL_REFERENCE_KIND),
    z.string().min(1), // orderId
  ]);

export const ParsedExternalReferenceSchema = z.object({
  businessId: z.string().min(1),
  orderId: z.string().min(1),
});
export type ParsedExternalReference = z.infer<typeof ParsedExternalReferenceSchema>;

/**
 * Parseia o external_reference do MP. Usa `:` como separador e exige
 * exatamente 3 partes com kind === 'order'. Lança ZodError em formato inválido
 * (boundary R6 — valide entrada externa imediatamente).
 */
export function parseExternalReference(raw: string): ParsedExternalReference {
  const parts = ExternalReferencePartsSchema.parse(raw.split(':'));
  return ParsedExternalReferenceSchema.parse({
    businessId: parts[0],
    orderId: parts[2],
  });
}
