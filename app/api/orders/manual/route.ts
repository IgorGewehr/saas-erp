import { NextResponse, type NextRequest } from 'next/server';
import { CreateDeliveryOrderWithSideEffectsInputSchema } from '@/lib/contracts/api/services/delivery-order-server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { createDeliveryOrderWithSideEffects } from '@/lib/services/delivery-order-server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  CommercialOperationError,
  CommercialOperationIdempotencyConflictError,
  CommercialOperationInProgressError,
} from '@/lib/services/commercial-operation-admin';
import { CommercialQuoteError } from '@/lib/services/commercial-quote';
import {
  InsufficientStockError,
  StockIdempotencyConflictError,
  StockReferenceError,
} from '@/lib/services/stock-core-admin';

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Pedido manual (balcão/telefone) — M02.5b. Mirror de app/api/sales/checkout/route.ts:
 * mesmo padrão de autenticação e mapeamento de erros do núcleo comercial.
 * Sem `assertOrdersAcceptedNow` (deliberado — pedido manual não depende do
 * horário/pausa do cardápio online) e sem rate-limit (rota autenticada).
 */
export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = CreateDeliveryOrderWithSideEffectsInputSchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para criar pedidos.', 403);
  }

  const headerKey = request.headers.get('x-idempotency-key');
  if (headerKey && parsed.data.idempotencyKey && headerKey !== parsed.data.idempotencyKey) {
    return error('A chave de idempotência do header diverge do corpo.', 400);
  }

  const isManagerOrAbove = (ROLE_HIERARCHY[auth.role as UserRole] ?? 0) >= ROLE_HIERARCHY.manager;

  try {
    const result = await createDeliveryOrderWithSideEffects({
      ...parsed.data,
      operatorId: auth.uid,
      operatorName: auth.name,
      originChannel: parsed.data.originChannel ?? 'manual',
      idempotencyKey: headerKey ?? parsed.data.idempotencyKey,
    }, adminDb, {
      channel: 'manual',
      actorType: 'user',
      canApplyManualDiscount: isManagerOrAbove,
      canOverrideDeliveryFee: isManagerOrAbove,
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (cause) {
    if (
      cause instanceof CommercialOperationIdempotencyConflictError
      || cause instanceof CommercialOperationInProgressError
      || cause instanceof StockIdempotencyConflictError
    ) {
      return error(cause.message, 409);
    }
    if (cause instanceof CommercialQuoteError) return error(cause.message, cause.status);
    if (cause instanceof CommercialOperationError) {
      const status = cause.code === 'TENANT_MISMATCH' ? 403
        : cause.code === 'CLIENT_NOT_FOUND' || cause.code === 'DELIVERY_ORDER_RESULT_NOT_FOUND' ? 404
          : 400;
      return error(cause.message, status);
    }
    if (cause instanceof InsufficientStockError) {
      return NextResponse.json(
        { ok: false, error: cause.message, code: cause.code, shortages: cause.shortages },
        { status: 409 },
      );
    }
    if (cause instanceof StockReferenceError) return error(cause.message, 404);
    console.error('[orders/manual] failed', cause);
    return error('Não foi possível criar o pedido.', 500);
  }
}
