import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import {
  DeliveryOrderItemSchema, DeliveryOrderAddressSchema, DeliveryTypeSchema,
  DeliveryOrderPaymentMethodSchema, DeliveryOrderPaymentStatusSchema,
} from '@/contracts/domain/deliveryOrder';
import {
  editDeliveryOrderAdmin,
  DeliveryOrderEditBlockedError,
} from '@/lib/services/delivery-order-edit-admin';

/**
 * Edição autenticada de deliveryOrders — mirror de app/api/orders/[id]/transition.
 * Substitui o updateDoc direto que OrdersModule.tsx fazia pelo SDK cliente,
 * fonte única compartilhada com app/api/agent/tools/orders/route.ts (updateItems).
 * Ver docs/paridade/M02_EDICAO_PEDIDO_POS_EFEITO.md.
 */

const PatchSchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().min(1).optional(),
  clientPhone: z.string().optional(),
  items: z.array(DeliveryOrderItemSchema).min(1).optional(),
  deliveryFee: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  deliveryType: DeliveryTypeSchema.optional(),
  deliveryAddress: DeliveryOrderAddressSchema.optional(),
  paymentMethod: DeliveryOrderPaymentMethodSchema.optional(),
  paymentStatus: DeliveryOrderPaymentStatusSchema.optional(),
  changeFor: z.number().nonnegative().optional(),
  customerNotes: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
  estimatedDeliveryAt: z.string().optional(),
});

const BodySchema = z.object({
  businessId: z.string().min(1),
  patch: PatchSchema,
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
    return error('Sem permissão para editar pedidos.', 403);
  }

  try {
    const result = await editDeliveryOrderAdmin({
      db: adminDb,
      orderId,
      businessId: parsed.data.businessId,
      patch: parsed.data.patch,
      actor: { id: auth.uid, name: auth.name, type: 'user' },
    });
    return NextResponse.json({
      ok: true,
      data: { order: result.order, stockReconciled: result.stockReconciled, stockAlerts: result.stockAlerts },
    });
  } catch (cause) {
    if (cause instanceof DeliveryOrderEditBlockedError) {
      const status = cause.code === 'NOT_FOUND' ? 404
        : cause.code === 'TENANT_MISMATCH' ? 403
          : cause.code === 'EDIT_BLOCKED' ? 409
            : 400;
      return error(cause.message, status);
    }
    console.error('[orders/edit] failed', cause);
    return error('Não foi possível editar o pedido.', 500);
  }
}
