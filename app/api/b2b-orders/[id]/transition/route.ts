import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { OrderStatusSchema } from '@/contracts/domain/order';
import { transitionOrderAdmin, OrderTransitionError } from '@/lib/services/order-transition-admin';
import { InsufficientStockError, StockReferenceError } from '@/lib/services/stock-core-admin';

/**
 * Transição autenticada (sessão de usuário) de Order B2B/condicional —
 * mirror exato de app/api/sales/[id]/cancel/route.ts e
 * app/api/orders/[id]/transition/route.ts (deliveryOrders). Diferente de
 * PATCH /api/v1/orders/{id}/transition (Bearer API key) — esta rota é pra
 * VendasModule.tsx chamar do browser.
 */

const BodySchema = z.object({
  businessId: z.string().min(1),
  status: OrderStatusSchema,
  reason: z.string().max(500).optional(),
});

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para alterar pedidos.', 403);
  }

  try {
    const result = await transitionOrderAdmin({
      db: adminDb,
      orderId,
      businessId: parsed.data.businessId,
      targetStatus: parsed.data.status,
      reason: parsed.data.reason,
      actor: { id: auth.uid, name: auth.name },
    });
    return NextResponse.json({
      ok: true,
      data: {
        status: result.order.status,
        stockApplied: result.stockApplied,
        invoiced: result.invoiced,
        transactionIds: result.transactionIds,
        stockAlerts: result.stockAlerts,
      },
    });
  } catch (cause) {
    if (cause instanceof OrderTransitionError) {
      const status = cause.code === 'TENANT_MISMATCH' ? 403
        : cause.code === 'ORDER_NOT_FOUND' ? 404
          : cause.code === 'INVALID_TRANSITION' ? 409
            : 400;
      return error(cause.message, status);
    }
    // Faturar baixa estoque: sem este mapeamento a falta de saldo virava um 500 genérico.
    if (cause instanceof InsufficientStockError) {
      return NextResponse.json(
        { ok: false, error: cause.message, code: cause.code, shortages: cause.shortages },
        { status: 409 },
      );
    }
    if (cause instanceof StockReferenceError) return error(cause.message, 409);
    console.error('[b2b-orders/transition] failed', cause);
    return error('Não foi possível alterar o pedido.', 500);
  }
}
