/**
 * lib/services/mercadopago/card.ts
 *
 * Cria um pagamento com cartão no Mercado Pago. SERVER-ONLY.
 *
 * O PAN nunca toca o server: `cardToken` é gerado no front (Bricks/SDK JS).
 *
 * INVARIANTES:
 *   - transaction_amount é DERIVADO server-side do pedido (nunca do client).
 *   - A X-Idempotency-Key inclui o cardToken: uma key fixa demais (só orderId)
 *     bloquearia o retry legítimo após uma recusa, quando o cliente reenvia um
 *     NOVO token. Tokens diferentes ⇒ keys diferentes ⇒ retry permitido.
 *   - application_fee é OMITIDO quando 0 (o MP rejeita fee=0).
 */

import { createHash } from 'node:crypto';
import { buildExternalReference } from '@/contracts/domain/payment';
import type { PaymentFsmStatus } from '@/contracts/fsm/payment';
import { getMpAccessToken } from './auth';
import { mpFetch, mapMpStatusToFsm } from './client';

export interface CardOrderInput {
  id: string;
  total: number;
  description?: string;
}

export interface CreateCardPaymentParams {
  businessId: string;
  order: CardOrderInput;
  cardToken: string;
  installments: number;
  payerEmail?: string;
  /** Comissão da plataforma (R$). Default 0 → omitido no payload. */
  applicationFee?: number;
}

export interface CreateCardPaymentResult {
  externalPaymentId: string;
  status: PaymentFsmStatus;
  /** status_detail do MP em recusa síncrona — pro pedido persistir o motivo real
   *  (a UI mostra em vez da mensagem genérica). */
  declineReason?: string;
}

interface MpPaymentResponse {
  id: number | string;
  status?: string;
  status_detail?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function createCardPayment(
  params: CreateCardPaymentParams,
): Promise<CreateCardPaymentResult> {
  const { businessId, order, cardToken, installments } = params;
  const accessToken = await getMpAccessToken(businessId);

  const amount = round2(order.total);
  if (!(amount > 0)) {
    throw new Error(`[MercadoPago] valor inválido para cobrança de cartão do pedido ${order.id}`);
  }

  const applicationFee = params.applicationFee ?? 0;

  const body: Record<string, unknown> = {
    transaction_amount: amount,
    token: cardToken,
    installments,
    description: order.description ?? `Pedido ${order.id}`,
    external_reference: buildExternalReference(businessId, order.id),
    ...(params.payerEmail ? { payer: { email: params.payerEmail } } : {}),
  };
  if (applicationFee > 0) body.application_fee = applicationFee;

  // Idempotency atrelada ao token: retry com o MESMO token dedupe; token novo
  // (após recusa) gera key nova e libera nova tentativa.
  const idemKey = createHash('sha256')
    .update(`${businessId}:${order.id}:${cardToken}`)
    .digest('hex');

  const payment = await mpFetch<MpPaymentResponse>('/v1/payments', {
    method: 'POST',
    accessToken,
    idempotencyKey: idemKey,
    body,
  });

  return {
    externalPaymentId: String(payment.id),
    status: mapMpStatusToFsm(payment.status ?? 'pending'),
    declineReason: payment.status_detail,
  };
}
