/**
 * app/api/orders/[id]/pay-card/route.ts — POST
 *
 * Cobra um DeliveryOrder no cartão (Mercado Pago). O PAN nunca toca o server:
 * `cardToken` é gerado no front (Bricks/SDK JS).
 *
 * Cartão é SÍNCRONO: o MP devolve approved/rejected na hora; refletimos o
 * resultado no pedido. Ainda assim o WEBHOOK é a fonte final da verdade
 * (settlePaymentNotification) — esta rota só adianta o estado p/ a UI.
 *
 * Defesas:
 *   - R1: businessId é DERIVADO do doc do pedido (nunca confiado do body); um
 *     businessId opcional no body vale só como cross-check.
 *   - R3: idempotência por X-Idempotency-Key (a key do MP já inclui o cardToken).
 *   - R4: FSM do pagamento via assertTransitionPayment. Recusa do MP NÃO
 *     terminaliza — o pedido segue 'pending' (permite retry com novo cardToken)
 *     e o motivo da recusa volta pro front. Consistente com o webhook.
 *   - R6: body validado com Zod; o valor é DERIVADO de order.total (nunca client).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { withIdempotency, IdempotencyConflictError } from '@/contracts/_runtime/idempotency';
import { CreateCardChargeBodySchema, CreateCardChargeResponseSchema } from '@/contracts/api/orders/payment';
import { assertTransitionPayment, type PaymentFsmStatus } from '@/contracts/fsm/payment';
import { createCardPayment } from '@/lib/services/mercadopago/card';
import { MercadoPagoApiError } from '@/lib/services/mercadopago/client';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/utils/rateLimit';
import { verifyTrackingToken } from '@/lib/utils/trackingToken';
import type { DeliveryOrder } from '@/lib/types';
import type { ErrorCode } from '@/contracts/api/_envelope';

const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;

/**
 * orderId vem do path. businessId é DERIVADO do doc (R1); se vier no body,
 * vale só como cross-check opcional. token/parcelas no body.
 */
const CardBodySchema = CreateCardChargeBodySchema.omit({ orderId: true }).extend({
  businessId: z.string().min(1).optional(),
  /** Capability token do pedido. Pode vir aqui ou no header X-Tracking-Token.
   *  Cliente anônimo só paga o próprio pedido. */
  trackingToken: z.string().min(1).optional(),
});

const CARD_DECLINED_MESSAGE =
  'Pagamento recusado pela operadora do cartão. Confira os dados e tente novamente.';

type CardSuccess = Extract<z.infer<typeof CreateCardChargeResponseSchema>, { ok: true }>['data'];

class PayError extends Error {
  constructor(public status: number, public code: ErrorCode, message: string) {
    super(message);
    this.name = 'PayError';
  }
}

const ALREADY_SETTLED = new Set(['paid', 'authorized', 'refunded']);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;

  const ip = getClientIp(req);
  const rl = checkRateLimit(`pay-card:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde um instante.', retryable: true } },
      { status: 429, headers: rateLimitHeaders(rl, RATE_LIMIT) },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'JSON inválido');
  }

  const parsed = CardBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Corpo inválido', parsed.error.flatten());
  }
  const { businessId: bodyBusinessId, cardToken, installments, payerEmail, applicationFee } = parsed.data;
  const trackingToken = parsed.data.trackingToken ?? req.headers.get('x-tracking-token') ?? undefined;

  const orderRef = adminDb.collection('deliveryOrders').doc(orderId);

  // R1: o tenant é resolvido a partir do doc do pedido — nunca confiado do body.
  const headSnap = await orderRef.get();
  if (!headSnap.exists) return errorResponse(404, 'NOT_FOUND', 'Pedido não encontrado');
  const headOrder = headSnap.data() as DeliveryOrder;
  const businessId = headOrder.businessId;
  if (bodyBusinessId && bodyBusinessId !== businessId) {
    return errorResponse(404, 'NOT_FOUND', 'Pedido não encontrado');
  }

  // Autorização por capability: cliente anônimo só paga o PRÓPRIO pedido. Token
  // ausente/errado → 404 (não vaza existência nem valor do pedido).
  if (!verifyTrackingToken(headOrder.trackingToken, trackingToken)) {
    return errorResponse(404, 'NOT_FOUND', 'Pedido não encontrado');
  }

  try {
    const { result, replayed } = await withIdempotency<CardSuccess>(
      adminDb,
      { businessId, key: req.headers.get('x-idempotency-key'), endpoint: 'POST /api/orders/[id]/pay-card' },
      async () => {
        // Lê + valida estado + DERIVA o valor server-side (R6).
        const snap = await orderRef.get();
        if (!snap.exists) throw new PayError(404, 'NOT_FOUND', 'Pedido não encontrado');
        const order = snap.data() as DeliveryOrder;

        if (order.businessId !== businessId) {
          throw new PayError(404, 'TENANT_MISMATCH', 'Pedido não encontrado');
        }
        if (order.paymentStatus === 'pago' || (order.paymentFsmStatus && ALREADY_SETTLED.has(order.paymentFsmStatus))) {
          throw new PayError(409, 'CONFLICT', 'Pedido já está pago');
        }
        const total = order.total;
        if (!(total > 0)) throw new PayError(409, 'CONFLICT', 'Pedido sem valor a cobrar');

        const card = await createCardPayment({
          businessId,
          order: { id: orderId, total, description: `Pedido ${order.number}` },
          cardToken,
          installments,
          payerEmail,
          applicationFee,
        });

        // Persiste com guard de corrida + FSM (R4). O webhook é a fonte final:
        // se já liquidou, não rebaixa. assertTransitionPayment é o guard de
        // transição E a idempotência (reaplicar o mesmo status é no-op).
        const persisted = await adminDb.runTransaction<CardSuccess>(async (tx) => {
          const cur = await tx.get(orderRef);
          const curOrder = cur.data() as DeliveryOrder | undefined;
          if (!curOrder || curOrder.businessId !== businessId) {
            throw new PayError(404, 'NOT_FOUND', 'Pedido não encontrado');
          }

          const from: PaymentFsmStatus = curOrder.paymentFsmStatus ?? 'pending';

          // Webhook já liquidou (paid/authorized/refunded) → não rebaixa.
          if (ALREADY_SETTLED.has(from)) {
            return { status: from, externalPaymentId: curOrder.externalPaymentId ?? card.externalPaymentId };
          }

          // Recusa do MP (rejected/cancelled → 'failed'): decisão unificada —
          // NÃO terminaliza. O pedido segue 'pending' (permite retry com novo
          // cardToken) e o motivo da recusa volta pro front. Doc fica intacto.
          if (card.status === 'failed') {
            throw new PayError(402, 'PAYMENT_REQUIRED', CARD_DECLINED_MESSAGE);
          }

          const nowIso = new Date().toISOString();
          const target = card.status; // 'paid' | 'authorized' | 'pending'

          // Só transiciona quando o alvo difere; reaplicar o mesmo é no-op
          // idempotente (ex: in_process reentregue mantém 'pending').
          if (target !== from) {
            assertTransitionPayment(from, target);
          }

          tx.update(orderRef, {
            paymentProvider: 'mercadopago',
            externalPaymentId: card.externalPaymentId,
            paymentMethodKind: 'card',
            paymentAmount: total,
            paymentFsmStatus: target,
            ...(target === 'paid' ? { paymentStatus: 'pago', paidAt: nowIso } : {}),
            updatedAt: nowIso,
          });
          return { status: target, externalPaymentId: card.externalPaymentId };
        });

        return persisted;
      },
    );

    return NextResponse.json({ ok: true, data: result, idempotent: replayed }, { status: 200 });
  } catch (err) {
    return mapError(err);
  }
}

function errorResponse(status: number, code: ErrorCode, message: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, ...(details ? { details } : {}) } }, { status });
}

function mapError(err: unknown) {
  if (err instanceof PayError) return errorResponse(err.status, err.code, err.message);
  if (err instanceof IdempotencyConflictError) {
    return errorResponse(409, 'CONFLICT', 'Requisição idêntica em processamento. Tente novamente.');
  }
  if (err instanceof MercadoPagoApiError) {
    // Recusa/erro do MP. status_detail já foi logado no client; resposta genérica.
    return errorResponse(502, 'INTERNAL', 'Falha ao processar o cartão. Verifique os dados e tente novamente.');
  }
  console.error('[pay-card] erro inesperado:', err);
  return errorResponse(500, 'INTERNAL', 'Erro interno ao processar pagamento');
}
