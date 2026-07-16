/**
 * app/api/orders/[id]/status/route.ts — GET
 *
 * Acompanhamento público de UM pedido pelo cliente ANÔNIMO, sem abrir leitura
 * pública da coleção `deliveryOrders`.
 *
 * Autorização por capability: o cliente apresenta `?token=` (o trackingToken
 * opaco devolvido na criação do pedido). Validamos com `timingSafeEqual`. Token
 * ausente/errado → 404 (não vaza a existência do pedido).
 *
 * RESPOSTA = PROJEÇÃO MÍNIMA. Nunca expõe dados sensíveis (endereço, telefone,
 * itens, valores de outros campos, IDs internos de pagamento além do mínimo
 * necessário pra renderizar o QR). Os campos de PIX (qrCode/copiaECola/
 * qrCodeBase64) são públicos por natureza — é o que o pagador escaneia.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyTrackingToken } from '@/lib/utils/trackingToken';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/utils/rateLimit';
import type { DeliveryOrder } from '@/lib/types';

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const QuerySchema = z.object({
  token: z.string().min(1),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;

  const ip = getClientIp(req);
  const rl = checkRateLimit(`order-status:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Muitas requisições. Aguarde um instante.' },
      { status: 429, headers: rateLimitHeaders(rl, RATE_LIMIT) },
    );
  }

  const parsed = QuerySchema.safeParse({
    token: req.nextUrl.searchParams.get('token') ?? undefined,
  });
  // Sem token válido na query → trata como não encontrado (não vaza existência).
  if (!parsed.success) {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 });
  }

  const snap = await adminDb.collection('deliveryOrders').doc(orderId).get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 });
  }
  const order = snap.data() as DeliveryOrder;

  // Token inválido → 404 (idêntico ao "não existe": não distingue os casos).
  if (!verifyTrackingToken(order.trackingToken, parsed.data.token)) {
    return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 });
  }

  // ── Projeção mínima ────────────────────────────────────────────────────────
  return NextResponse.json(
    {
      status: order.status,                    // FSM de FABRICAÇÃO
      paymentFsmStatus: order.paymentFsmStatus, // FSM de DINHEIRO
      paymentStatus: order.paymentStatus,       // legado (pago na entrega etc.)
      number: order.number,
      paymentExpiresAt: order.paymentExpiresAt,
      qrCode: order.qrCode,
      copiaECola: order.copiaECola,
      qrCodeBase64: order.qrCodeBase64,
      lastPaymentDeclineReason: order.lastPaymentDeclineReason,
    },
    { status: 200, headers: rateLimitHeaders(rl, RATE_LIMIT) },
  );
}
