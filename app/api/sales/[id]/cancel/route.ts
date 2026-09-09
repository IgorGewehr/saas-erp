import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { cancelSaleAdmin, SaleCancelError } from '@/lib/services/sale-transition-admin';

/**
 * Cancelamento autenticado de Sale (M02.7) — mirror de
 * app/api/orders/[id]/transition/route.ts. Substitui a sequência de writes
 * diretos que `PDVModule.tsx` fazia pelo SDK cliente (sem trava contra
 * reexecução, sem reverter benefícios) por um serviço server-side único.
 */

const BodySchema = z.object({
  businessId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: saleId } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para cancelar vendas.', 403);
  }

  try {
    const result = await cancelSaleAdmin({
      db: adminDb,
      saleId,
      businessId: parsed.data.businessId,
      reason: parsed.data.reason,
      actor: { id: auth.uid, name: auth.name },
    });
    return NextResponse.json({
      ok: true,
      data: {
        status: result.sale.status,
        stockApplied: result.stockApplied,
        clientStatsReversed: result.clientStatsReversed,
        benefitsReversed: result.benefitsReversed,
        transactionIds: result.transactionIds,
        stockAlerts: result.stockAlerts,
      },
    });
  } catch (cause) {
    if (cause instanceof SaleCancelError) {
      const status = cause.code === 'TENANT_MISMATCH' ? 403
        : cause.code === 'SALE_NOT_FOUND' ? 404
          : cause.code === 'FISCAL_DOCUMENT_ISSUED' ? 409
            : cause.code === 'INVALID_TRANSITION' ? 409
              : 400;
      return error(cause.message, status);
    }
    console.error('[sales/cancel] failed', cause);
    return error('Não foi possível cancelar a venda.', 500);
  }
}
