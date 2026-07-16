/**
 * lib/services/mercadopago/pix.ts
 *
 * Cria uma cobrança PIX no Mercado Pago para um DeliveryOrder. SERVER-ONLY.
 *
 * INVARIANTES:
 *   - transaction_amount é DERIVADO server-side do pedido (nunca do client).
 *   - X-Idempotency-Key fresco por mint (cada tentativa de cobrança é única).
 *   - Se o MP não devolver point_of_interaction.transaction_data.qr_code (conta
 *     sem chave PIX), tratamos como FALHA — não persistimos QR impagável.
 *   - application_fee é OMITIDO quando 0 (o MP rejeita fee=0).
 */

import { randomUUID } from 'node:crypto';
import { buildExternalReference } from '@/contracts/domain/payment';
import { getMpAccessToken } from './auth';
import { mpFetch, MercadoPagoApiError } from './client';

/** Dados mínimos do pedido necessários pra cobrança. `total` é a fonte do valor. */
export interface PixOrderInput {
  id: string;
  total: number;
  payerEmail?: string;
  description?: string;
}

export interface CreatePixPaymentParams {
  businessId: string;
  order: PixOrderInput;
  /** Comissão da plataforma (R$). Default 0 → omitido no payload. */
  applicationFee?: number;
  /** Minutos até o QR expirar. Default 30. */
  expiresInMinutes?: number;
}

export interface CreatePixPaymentResult {
  externalPaymentId: string;
  qrCode: string;
  copiaECola: string;
  qrCodeBase64: string;
  expiresAt: string;
}

interface MpPaymentResponse {
  id: number | string;
  status?: string;
  date_of_expiration?: string;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
}

function getWebhookUrl(): string {
  const redirect = process.env.MP_REDIRECT_URI;
  if (!redirect) throw new Error('[MercadoPago] MP_REDIRECT_URI é obrigatório');
  return `${new URL(redirect).origin}/api/webhooks/mercadopago`;
}

/** ISO com offset explícito (+00:00) — o MP rejeita o sufixo 'Z'. */
function toMpDateTime(date: Date): string {
  return date.toISOString().replace('Z', '+00:00');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function createPixPayment(
  params: CreatePixPaymentParams,
): Promise<CreatePixPaymentResult> {
  const { businessId, order } = params;
  const accessToken = await getMpAccessToken(businessId);

  const amount = round2(order.total);
  if (!(amount > 0)) {
    throw new Error(`[MercadoPago] valor inválido para cobrança PIX do pedido ${order.id}`);
  }

  const expiresAt = new Date(Date.now() + (params.expiresInMinutes ?? 30) * 60 * 1000);
  const applicationFee = params.applicationFee ?? 0;

  const body: Record<string, unknown> = {
    transaction_amount: amount,
    payment_method_id: 'pix',
    description: order.description ?? `Pedido ${order.id}`,
    external_reference: buildExternalReference(businessId, order.id),
    notification_url: getWebhookUrl(),
    date_of_expiration: toMpDateTime(expiresAt),
    payer: { email: order.payerEmail || `pedido-${order.id}@servicepro.app` },
  };
  // Omite application_fee quando 0 — o MP rejeita fee=0.
  if (applicationFee > 0) body.application_fee = applicationFee;

  const payment = await mpFetch<MpPaymentResponse>('/v1/payments', {
    method: 'POST',
    accessToken,
    idempotencyKey: randomUUID(),
    body,
  });

  const txData = payment.point_of_interaction?.transaction_data;
  const qrCode = txData?.qr_code;
  const qrCodeBase64 = txData?.qr_code_base64;

  if (!qrCode || !qrCodeBase64) {
    // Conta sem chave PIX → QR impagável. Não persistir.
    throw new MercadoPagoApiError(
      `[MercadoPago] payment ${payment.id} sem qr_code — conta do vendedor provavelmente sem chave PIX`,
      502,
      payment,
    );
  }

  return {
    externalPaymentId: String(payment.id),
    qrCode,
    copiaECola: qrCode,
    qrCodeBase64,
    expiresAt: payment.date_of_expiration
      ? new Date(payment.date_of_expiration).toISOString()
      : expiresAt.toISOString(),
  };
}
