import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { DeliveryOrderStatusSchema } from '@/contracts/domain/deliveryOrder';
import {
  transitionDeliveryOrderAdmin,
  DeliveryOrderTransitionError,
} from '@/lib/services/delivery-order-transition-admin';

/**
 * Transição de status autenticada de deliveryOrders (M02.5d) — mirror de
 * app/api/orders/manual/route.ts. Substitui os writes diretos de status que
 * OrdersModule.tsx fazia pelo SDK cliente. Não é a mesma rota de
 * app/api/orders/[id]/status (GET, pública, tracking anônimo por token).
 */

const BodySchema = z.object({
  businessId: z.string().min(1),
  status: DeliveryOrderStatusSchema,
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
    const result = await transitionDeliveryOrderAdmin({
      db: adminDb,
      orderId,
      businessId: parsed.data.businessId,
      targetStatus: parsed.data.status,
      reason: parsed.data.reason,
      actor: { id: auth.uid, name: auth.name, type: 'user' },
    });
    return NextResponse.json({
      ok: true,
      data: { status: result.order.status, stockAlerts: result.stockAlerts },
    });
  } catch (cause) {
    if (cause instanceof DeliveryOrderTransitionError) {
      const status = cause.code === 'TENANT_MISMATCH' ? 403
        : cause.code === 'ORDER_NOT_FOUND' ? 404
          : cause.code === 'ONLINE_UNPAID' ? 409
            : 400;
      return error(cause.message, status);
    }
    if (cause instanceof Error && cause.message.startsWith('DeliveryOrder FSM:')) {
      return error(cause.message, 409);
    }
    console.error('[orders/transition] failed', cause);
    return error('Não foi possível alterar o pedido.', 500);
  }
}
