import { NextResponse, type NextRequest } from 'next/server';
import { StockOperationRequestSchema } from '@/lib/contracts/api/stock-operations';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import {
  applyStockOperationAdmin,
  InsufficientStockError,
  InvalidStockOperationError,
  StockIdempotencyConflictError,
  StockReferenceError,
} from '@/lib/services/stock-core-admin';

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = StockOperationRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }
  const headerKey = request.headers.get('x-idempotency-key');
  if (headerKey && headerKey !== parsed.data.idempotencyKey) {
    return error('A chave de idempotência do header diverge do corpo.', 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para movimentar estoque.', 403);
  }

  try {
    const { strictProductIds, ...input } = parsed.data;
    const result = await applyStockOperationAdmin(adminDb, {
      ...input,
      operatorId: auth.uid,
      ...(strictProductIds ? { strictProductIds: new Set(strictProductIds) } : {}),
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (cause) {
    if (cause instanceof StockIdempotencyConflictError) return error(cause.message, 409);
    if (cause instanceof InsufficientStockError) {
      return NextResponse.json(
        { ok: false, error: cause.message, code: cause.code, shortages: cause.shortages },
        { status: 409 },
      );
    }
    if (cause instanceof StockReferenceError) return error(cause.message, 404);
    if (cause instanceof InvalidStockOperationError) return error(cause.message, 400);
    console.error('[stock/operations] failed', cause);
    return error('Não foi possível concluir a movimentação de estoque.', 500);
  }
}
