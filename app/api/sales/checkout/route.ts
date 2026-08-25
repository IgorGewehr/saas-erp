import { NextResponse, type NextRequest } from 'next/server';
import { CreateSaleWithSideEffectsInputSchema } from '@/lib/contracts/api/services/sale-server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { createSaleWithSideEffects } from '@/lib/services/sales-server';
import { IdempotencyConflictError } from '@/lib/contracts/_runtime/idempotency';
import {
  InsufficientStockError,
  StockIdempotencyConflictError,
  StockReferenceError,
} from '@/lib/services/stock-core-admin';

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = CreateSaleWithSideEffectsInputSchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para finalizar vendas.', 403);
  }

  const headerKey = request.headers.get('x-idempotency-key');
  if (headerKey && parsed.data.idempotencyKey && headerKey !== parsed.data.idempotencyKey) {
    return error('A chave de idempotência do header diverge do corpo.', 400);
  }

  try {
    const result = await createSaleWithSideEffects({
      ...parsed.data,
      operatorId: auth.uid,
      operatorName: auth.name,
      idempotencyKey: headerKey ?? parsed.data.idempotencyKey,
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (cause) {
    if (cause instanceof IdempotencyConflictError || cause instanceof StockIdempotencyConflictError) {
      return error(cause.message, 409);
    }
    if (cause instanceof InsufficientStockError) {
      return NextResponse.json(
        { ok: false, error: cause.message, code: cause.code, shortages: cause.shortages },
        { status: 409 },
      );
    }
    if (cause instanceof StockReferenceError) return error(cause.message, 404);
    console.error('[sales/checkout] failed', cause);
    return error('Não foi possível finalizar a venda.', 500);
  }
}
