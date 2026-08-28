import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { listStockMovementsAdmin } from '@/lib/services/stock-query-admin';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get('businessId') ?? '';
  if (!businessId) return error('businessId é obrigatório.', 400);
  const auth = await verifyAuth(request, businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para consultar movimentações.', 403);
  }

  try {
    const page = await listStockMovementsAdmin({
      db: adminDb,
      businessId: auth.businessId,
      cursor: request.nextUrl.searchParams.get('cursor'),
      limit: Number(request.nextUrl.searchParams.get('limit')) || 100,
    });
    return NextResponse.json({ ok: true, data: page });
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('Cursor')) return error(cause.message, 400);
    console.error('[stock/movements] list failed', cause);
    return error('Não foi possível carregar as movimentações.', 500);
  }
}
