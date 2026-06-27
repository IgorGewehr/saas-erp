/**
 * lib/contracts/api/orders/payment.ts
 *
 * Contratos pra criar uma COBRANÇA online de um DeliveryOrder já existente.
 * Pagamento online é OPCIONAL — o cliente escolhe pagar online (PIX/Cartão)
 * ou na entrega. Estas rotas só são chamadas no caminho "online".
 *
 * v1: PIX (QR + copia e cola) e Cartão (token via Bricks no front).
 *
 * COMISSÃO DA PLATAFORMA = 0% por decisão de negócio. `applicationFee` existe
 * como ponto de extensão TIPADO (default 0); não cobramos split na v1.
 *
 * Fundação — nenhuma rota implementada ainda.
 */

import { z } from 'zod';
import { ErrorEnvelopeSchema, IdempotencyHeaderSchema, successEnvelope } from '../_envelope';
import { PaymentFsmStatusSchema } from '../../fsm/payment';

/** Ponto de extensão tipado p/ split. Default 0 (plataforma não cobra). */
export const ApplicationFeeSchema = z.number().nonnegative().default(0);

// ─── POST /api/orders/payment/create-pix ────────────────────────────────────
export const CreatePixChargeHeadersSchema = IdempotencyHeaderSchema;
export const CreatePixChargeBodySchema = z.object({
  orderId: z.string().min(1),
  /** Comissão da plataforma (R$). v1 sempre 0. */
  applicationFee: ApplicationFeeSchema.optional(),
});
export const CreatePixChargeResponseSchema = z.union([
  successEnvelope(z.object({
    qrCode: z.string().min(1),
    copiaECola: z.string().min(1),
    qrCodeBase64: z.string().min(1),
    expiresAt: z.string().datetime(),
    externalPaymentId: z.string().min(1),
  })),
  ErrorEnvelopeSchema,
]);
export type CreatePixChargeBody = z.infer<typeof CreatePixChargeBodySchema>;

// ─── POST /api/orders/payment/create-card ───────────────────────────────────
//
// `cardToken` é gerado no front pelo Bricks/SDK JS — o PAN nunca toca o server.
export const CreateCardChargeHeadersSchema = IdempotencyHeaderSchema;
export const CreateCardChargeBodySchema = z.object({
  orderId: z.string().min(1),
  cardToken: z.string().min(1),
  installments: z.number().int().min(1).max(24),
  payerEmail: z.string().email().optional(),
  applicationFee: ApplicationFeeSchema.optional(),
});
export const CreateCardChargeResponseSchema = z.union([
  successEnvelope(z.object({
    status: PaymentFsmStatusSchema,
    externalPaymentId: z.string().min(1),
  })),
  ErrorEnvelopeSchema,
]);
export type CreateCardChargeBody = z.infer<typeof CreateCardChargeBodySchema>;
