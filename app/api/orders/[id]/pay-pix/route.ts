/**
 * app/api/orders/[id]/pay-pix/route.ts — POST
 *
 * Gera (ou reusa) uma cobrança PIX do Mercado Pago para um DeliveryOrder.
 *
 * Defesas:
 *   - R1: o businessId é DERIVADO do doc do pedido (resolvido por id) — nunca
 *     confiado do body; um businessId opcional no body vale só como cross-check.
 *   - R3: idempotência por X-Idempotency-Key (withIdempotency) + lock de "mint".
 *   - R6: o valor da cobrança é DERIVADO server-side de order.total — o client
 *     nunca informa valor.
 *   - Lock de mint (pixMintAt/pixMintBy, stale 60s): dois aparelhos pagando o
 *     mesmo pedido não geram 2 QRs pagáveis. Um PIX ainda válido é reusado.
 *
 * O DeliveryOrder vive na coleção top-level `deliveryOrders` (ver
 * app/api/orders/public/route.ts e webhook-settle.ts).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { withIdempotency, IdempotencyConflictError } from '@/contracts/_runtime/idempotency';
import { CreatePixChargeBodySchema, CreatePixChargeResponseSchema } from '@/contracts/api/orders/payment';
import { createPixPayment } from '@/lib/services/mercadopago/pix';
import { resolvePaymentGateway } from '@/lib/services/mercadopago/gateway';
import { MercadoPagoApiError } from '@/lib/services/mercadopago/client';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/utils/rateLimit';
import { verifyTrackingToken } from '@/lib/utils/trackingToken';
import type { DeliveryOrder } from '@/lib/types';
import type { ErrorCode } from '@/contracts/api/_envelope';

const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;
const MINT_LOCK_STALE_MS = 60_000; // outro mint em andamento há <60s → ocupado
const REUSE_BUFFER_MS = 30_000;    // só reusa PIX com >30s de validade restante

/**
 * orderId vem do path. businessId é DERIVADO do doc (R1); se vier no body,
 * vale só como cross-check opcional. applicationFee (split) no body.
 */
const PixBodySchema = CreatePixChargeBodySchema.omit({ orderId: true }).extend({
  businessId: z.string().min(1).optional(),
  /** Capability token do pedido. Pode vir aqui ou no header X-Tracking-Token.
   *  Cliente anônimo só paga o próprio pedido. */
  trackingToken: z.string().min(1).optional(),
});

type PixSuccess = Extract<z.infer<typeof CreatePixChargeResponseSchema>, { ok: true }>['data'];

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
  const rl = checkRateLimit(`pay-pix:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
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

  const parsed = PixBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Corpo inválido', parsed.error.flatten());
  }
  const { businessId: bodyBusinessId, applicationFee } = parsed.data;
  const trackingToken = parsed.data.trackingToken ?? req.headers.get('x-tracking-token') ?? undefined;

  const orderRef = adminDb.collection('deliveryOrders').doc(orderId);
  const mintBy = `${ip}`;

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
    const { result, replayed } = await withIdempotency<PixSuccess>(
      adminDb,
      { businessId, key: req.headers.get('x-idempotency-key'), endpoint: 'POST /api/orders/[id]/pay-pix' },
      async () => {
        // ── Fase 1: decide reuso × mint dentro de transação (anti-corrida) ──
        const decision = await adminDb.runTransaction(async (tx) => {
          const snap = await tx.get(orderRef);
          if (!snap.exists) throw new PayError(404, 'NOT_FOUND', 'Pedido não encontrado');
          const order = snap.data() as DeliveryOrder;

          // R1: o pedido tem de pertencer ao tenant informado.
          if (order.businessId !== businessId) {
            throw new PayError(404, 'TENANT_MISMATCH', 'Pedido não encontrado');
          }

          const fsm = order.paymentFsmStatus;
          if (order.paymentStatus === 'pago' || (fsm && ALREADY_SETTLED.has(fsm))) {
            throw new PayError(409, 'CONFLICT', 'Pedido já está pago');
          }

          const total = order.total;
          if (!(total > 0)) {
            throw new PayError(409, 'CONFLICT', 'Pedido sem valor a cobrar');
          }

          // Reusa PIX ainda válido (mesmo método, pendente, não expirado).
          const stillValid =
            order.paymentMethodKind === 'pix' &&
            fsm === 'pending' &&
            !!order.externalPaymentId &&
            !!order.qrCode &&
            !!order.qrCodeBase64 &&
            !!order.paymentExpiresAt &&
            new Date(order.paymentExpiresAt).getTime() - Date.now() > REUSE_BUFFER_MS;

          if (stillValid) {
            return {
              kind: 'reuse' as const,
              data: {
                qrCode: order.qrCode!,
                copiaECola: order.copiaECola ?? order.qrCode!,
                qrCodeBase64: order.qrCodeBase64!,
                expiresAt: order.paymentExpiresAt!,
                externalPaymentId: order.externalPaymentId!,
              } satisfies PixSuccess,
            };
          }

          // Lock de mint: outro aparelho gerando agora? (stale 60s)
          if (order.pixMintAt && Date.now() - new Date(order.pixMintAt).getTime() < MINT_LOCK_STALE_MS) {
            throw new PayError(409, 'CONFLICT', 'Geração de PIX em andamento. Aguarde alguns segundos.');
          }

          tx.update(orderRef, { pixMintAt: new Date().toISOString(), pixMintBy: mintBy });
          return { kind: 'mint' as const, total, number: order.number };
        });

        if (decision.kind === 'reuse') return decision.data;

        // ── Fase 2: chama o MP (fora da transação) e persiste o bloco ──
        try {
          const pix = await createPixPayment({
            businessId,
            order: { id: orderId, total: decision.total, description: `Pedido ${decision.number}` },
            applicationFee,
          });

          const nowIso = new Date().toISOString();
          await orderRef.update({
            paymentProvider: 'mercadopago',
            externalPaymentId: pix.externalPaymentId,
            paymentMethodKind: 'pix',
            qrCode: pix.qrCode,
            copiaECola: pix.copiaECola,
            qrCodeBase64: pix.qrCodeBase64,
            paymentExpiresAt: pix.expiresAt,
            paymentAmount: decision.total,
            paymentFsmStatus: 'pending',
            // Libera o lock — o reuso passa a guardar contra nova geração.
            pixMintAt: FieldValue.delete(),
            pixMintBy: FieldValue.delete(),
            updatedAt: nowIso,
          });

          return {
            qrCode: pix.qrCode,
            copiaECola: pix.copiaECola,
            qrCodeBase64: pix.qrCodeBase64,
            expiresAt: pix.expiresAt,
            externalPaymentId: pix.externalPaymentId,
          } satisfies PixSuccess;
        } catch (err) {
          // Falhou a geração → libera o lock pra permitir nova tentativa.
          await orderRef
            .update({ pixMintAt: FieldValue.delete(), pixMintBy: FieldValue.delete() })
            .catch(() => undefined);

          if (err instanceof MercadoPagoApiError) {
            // QR ausente (conta sem chave PIX) ou indisponibilidade do MP.
            const gw = await resolvePaymentGateway(businessId).catch(() => null);
            if (gw && !gw.capabilities.pix) {
              throw new PayError(402, 'PAYMENT_REQUIRED', 'PIX indisponível para este estabelecimento.');
            }
            throw new PayError(502, 'INTERNAL', 'Falha ao gerar cobrança PIX. Tente novamente.');
          }
          throw err;
        }
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
  console.error('[pay-pix] erro inesperado:', err);
  return errorResponse(500, 'INTERNAL', 'Erro interno ao processar pagamento');
}
