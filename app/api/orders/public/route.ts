import { NextResponse, type NextRequest } from 'next/server';
import { CreatePublicOrderBodySchema, type CreatePublicOrderBody } from '@/contracts/api/orders/public';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/utils/rateLimit';
import { withIdempotency, IdempotencyConflictError } from '@/contracts/_runtime/idempotency';
import { assertOrdersAcceptedNow, OrdersClosedError } from '@/lib/services/orders/acceptance';
import { CommercialQuoteError } from '@/lib/services/commercial-quote';
import { InsufficientStockError } from '@/lib/services/stock-core-admin';
import {
  CommercialOperationError,
  CommercialOperationIdempotencyConflictError,
  CommercialOperationInProgressError,
  CommercialOperationUnavailableError,
} from '@/lib/services/commercial-operation-admin';
import { createDeliveryOrderWithSideEffects } from '@/lib/services/delivery-order-server';
import { formatCurrency } from '@/lib/utils/format';
import type { Business, DeliveryOrderItem, DeliveryType } from '@/lib/types';

const RATE_LIMIT = 10;        // 10 requests
const RATE_WINDOW_MS = 60_000; // per minute

/**
 * Erro de borda (existência do negócio) com status HTTP. Regras comerciais
 * (preço, estoque, cupom, gift card) vivem em delivery-order-server.ts e
 * chegam aqui como CommercialQuoteError/CommercialOperationError/InsufficientStockError.
 */
class PublicOrderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'PublicOrderError';
  }
}

export async function POST(req: NextRequest) {
  // ── Rate limit by IP ────────────────────────────────────────────────────────
  const ip = getClientIp(req);
  const rl = checkRateLimit(`orders-public:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Muitos pedidos. Aguarde um instante e tente novamente.' },
      { status: 429, headers: rateLimitHeaders(rl, RATE_LIMIT) },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsedBody = CreatePublicOrderBodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Dados do pedido inválidos', details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }
  const body: CreatePublicOrderBody = parsedBody.data;
  const { businessId } = body;

  // ── Idempotência (R3/P2.17) ─────────────────────────────────────────────────
  // Retry/double-tap em rede móvel reentregaria o mesmo carrinho → pedido
  // duplicado. O front envia um uuid por carrinho no header X-Idempotency-Key;
  // withIdempotency serializa double-taps quase simultâneos (lease de curto
  // prazo); o núcleo comercial (delivery-order-server.ts) cobre o replay
  // definitivo por conteúdo/chave, inclusive sem o header.
  const idempotencyKey = req.headers.get('x-idempotency-key');

  try {
    const { result } = await withIdempotency(
      adminDb,
      { businessId, key: idempotencyKey, endpoint: 'POST /api/orders/public' },
      async (): Promise<{ orderId: string; orderNumber: number; trackingToken: string; total: number; discount: number; giftCardAmount: number }> => {
        const now = new Date();

        // ── Negócio + guard de horário (COER-01) ─────────────────────────────
        // Imposto ANTES do núcleo comercial: cardápio fechado não deve nem
        // cotar preço, muito menos queimar número sequencial ou tocar estoque.
        const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
        if (!bizSnap.exists) throw new PublicOrderError(404, 'Negócio não encontrado');
        const biz = bizSnap.data() as Business;
        assertOrdersAcceptedNow(biz, now);

        const result = await createDeliveryOrderWithSideEffects(
          { ...body, idempotencyKey: idempotencyKey ?? undefined },
          adminDb,
          { now: () => now },
        );

        // ── Notificação WhatsApp ao negócio (best-effort) ────────────────────
        notifyBusiness(
          businessId,
          result.orderNumber,
          result.order.clientName,
          result.total,
          result.order.deliveryType,
          result.order.items,
          result.order.tableNumber,
        ).catch(() => {});

        return {
          orderId: result.order.id,
          orderNumber: result.orderNumber,
          trackingToken: result.trackingToken,
          total: result.total,
          discount: result.discount,
          giftCardAmount: result.giftCardAmount,
        };
      },
    );

    return NextResponse.json(
      result,
      { status: 201, headers: rateLimitHeaders(rl, RATE_LIMIT) },
    );

  } catch (err) {
    if (err instanceof PublicOrderError || err instanceof OrdersClosedError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof CommercialQuoteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof InsufficientStockError) {
      const names = [...new Set(err.shortages.map((s) => s.productName))].join(', ');
      return NextResponse.json(
        { error: `Sem estoque para: ${names}. Atualize o carrinho e tente novamente.` },
        { status: 409 },
      );
    }
    if (
      err instanceof CommercialOperationIdempotencyConflictError
      || err instanceof CommercialOperationInProgressError
      || err instanceof CommercialOperationUnavailableError
    ) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof CommercialOperationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof IdempotencyConflictError) {
      // Mesmo carrinho ainda sendo processado (double-tap quase simultâneo).
      return NextResponse.json(
        { error: 'Pedido em processamento. Aguarde um instante.' },
        { status: 409 },
      );
    }
    console.error('[PublicOrder] Error:', err);
    return NextResponse.json({ error: 'Erro interno ao processar pedido' }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function notifyBusiness(
  businessId: string,
  orderNumber: number,
  clientName: string,
  total: number,
  deliveryType: DeliveryType,
  items: DeliveryOrderItem[],
  tableNumber?: string,
) {
  try {
    const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
    const biz = bizSnap.data();
    if (!biz) return;

    const totalStr = formatCurrency(total);
    const modeStr = deliveryType === 'entrega' ? '🛵 Entrega'
      : deliveryType === 'mesa' ? `🍽️ Mesa ${tableNumber || '?'}`
        : '🏠 Retirada';

    const itemLines = items.slice(0, 8).map(i => {
      let line = `• ${i.quantity}× ${i.productName}`;
      if (i.selectedModifiers?.length) {
        const mods = i.selectedModifiers.map(m =>
          `${m.groupName}: ${m.selectedOptions.map(o => o.quantity > 1 ? `${o.quantity}× ${o.optionName}` : o.optionName).join(', ')}`
        ).join(' | ');
        line += `\n   _${mods}_`;
      }
      if (i.notes) line += `\n   📝 ${i.notes}`;
      return line;
    });
    if (items.length > 8) itemLines.push(`_...e mais ${items.length - 8} itens_`);

    const msg = `🛒 *Novo Pedido #${String(orderNumber).padStart(4, '0')}*\n👤 ${clientName}\n${modeStr}\n\n${itemLines.join('\n')}\n\n💰 *Total:* ${totalStr}\n\nPedido recebido pelo cardápio online.`;

    const baileysPhone: string | undefined = biz.channels?.baileys?.phoneNumber || biz.phone;
    if (baileysPhone) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      await fetch(`${baseUrl}/api/conversations/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          channel: 'whatsapp',
          recipientPhone: baileysPhone,
          content: msg,
          isInternal: true,
        }),
      });
    }
  } catch {
    // non-critical
  }
}
