/**
 * lib/services/mercadopago/refund.ts
 *
 * Estorno (total ou parcial) de um payment no Mercado Pago. SERVER-ONLY.
 *
 * O efeito no DeliveryOrder (FSM paid → refunded, restauro de estoque, etc.)
 * NÃO acontece aqui — chega depois via webhook (settlePaymentNotification),
 * que é a fonte da verdade do dinheiro. Esta função só dispara o refund no MP.
 */

import { randomUUID } from 'node:crypto';
import { getMpAccessToken } from './auth';
import { mpFetch } from './client';

export interface RefundResult {
  refundId: string;
  status: string;
  amount: number;
}

interface MpRefundResponse {
  id: number | string;
  status?: string;
  amount?: number;
}

/**
 * Estorna um payment. `amount` ausente = estorno TOTAL; presente = parcial.
 */
export async function refundPayment(
  businessId: string,
  externalPaymentId: string,
  amount?: number,
): Promise<RefundResult> {
  const accessToken = await getMpAccessToken(businessId);

  const refund = await mpFetch<MpRefundResponse>(
    `/v1/payments/${encodeURIComponent(externalPaymentId)}/refunds`,
    {
      method: 'POST',
      accessToken,
      idempotencyKey: randomUUID(),
      ...(amount !== undefined ? { body: { amount: Math.round(amount * 100) / 100 } } : {}),
    },
  );

  return {
    refundId: String(refund.id),
    status: refund.status ?? 'unknown',
    amount: refund.amount ?? amount ?? 0,
  };
}
