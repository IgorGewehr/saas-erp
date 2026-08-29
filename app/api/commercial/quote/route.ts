import { NextResponse, type NextRequest } from 'next/server';
import { CreateCommercialQuoteBodySchema } from '@/contracts/api/commercial/quote';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { CommercialQuoteError, quoteCommercialCartAdmin } from '@/lib/services/commercial-quote';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { isAuthError, verifyAuth } from '@/lib/utils/verifyAuth';

function error(
  code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'TENANT_MISMATCH' | 'INTERNAL',
  message: string,
  status: number,
  details?: unknown,
) {
  return NextResponse.json({ ok: false, error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  const parsed = CreateCommercialQuoteBodySchema.safeParse(raw);
  if (!parsed.success) {
    return error('VALIDATION_ERROR', 'Dados de cotação inválidos.', 400, parsed.error.flatten());
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  const roleLevel = ROLE_HIERARCHY[auth.role as UserRole] ?? 0;
  if (roleLevel < ROLE_HIERARCHY.operator) {
    return error('FORBIDDEN', 'Sem permissão para consultar preços comerciais.', 403);
  }

  try {
    const quote = await quoteCommercialCartAdmin({
      db: adminDb,
      input: parsed.data,
      operatorId: auth.uid,
      canApplyManualDiscount: roleLevel >= ROLE_HIERARCHY.manager,
    });
    return NextResponse.json({ ok: true, data: quote });
  } catch (cause) {
    if (cause instanceof CommercialQuoteError) {
      const code = cause.code === 'TENANT_MISMATCH' ? 'TENANT_MISMATCH'
        : cause.code === 'CATALOG_ITEM_NOT_FOUND' ? 'NOT_FOUND'
          : cause.code === 'STALE_QUOTE' ? 'CONFLICT'
            : cause.code === 'DISCOUNT_FORBIDDEN' ? 'FORBIDDEN'
              : 'VALIDATION_ERROR';
      return error(code, cause.message, cause.status, { commercialCode: cause.code });
    }
    console.error('[commercial/quote] failed', cause);
    return error('INTERNAL', 'Não foi possível calcular a cotação.', 500);
  }
}
