import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { listStockLotsAdmin } from '@/lib/services/stock-lot-admin';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get('businessId')?.trim() ?? '';
  const productId = request.nextUrl.searchParams.get('productId')?.trim() || undefined;
  const includeDepleted = request.nextUrl.searchParams.get('includeDepleted') === 'true';
  if (!businessId) return error('businessId é obrigatório.', 400);
  const auth = await verifyAuth(request, businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para consultar lotes.', 403);
  }
  try {
    const result = await listStockLotsAdmin({
      db: adminDb,
      businessId: auth.businessId,
      ...(productId ? { productId } : {}),
      includeDepleted,
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (cause) {
    console.error('[stock/lots] list failed', cause);
    return error('Não foi possível carregar os lotes.', 500);
  }
}
