import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';
import { checkBusinessRateLimit } from '@/lib/utils/rateLimit';
import { TransitionOrderBodySchema } from '@/contracts/api/v1/orders';
import { transitionOrderAdmin, OrderTransitionError } from '@/lib/services/order-transition-admin';

// =============================================================================
// PATCH /api/v1/orders/{id}/transition — advance a B2B/condicional order's FSM
// (pendente→confirmado/condicional→faturado→enviado→entregue, ou →cancelado)
// =============================================================================
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyApiKey(req, ['write:orders']);
  if (isApiKeyError(auth)) return auth;

  const bizLimit = checkBusinessRateLimit('v1-orders-transition', auth.businessId, 300, 3_600_000);
  if (!bizLimit.allowed) {
    return apiError('Rate limit exceeded for this business. Slow down.', 429);
  }

  const { id: orderId } = await params;
  const rawBody = await req.json().catch(() => null);
  if (rawBody == null || typeof rawBody !== 'object') {
    return apiError('Invalid request body — expected JSON object', 400);
  }
  const parsed = TransitionOrderBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  try {
    const result = await transitionOrderAdmin({
      db: adminDb,
      orderId,
      businessId: auth.businessId,
      targetStatus: parsed.data.targetStatus,
      reason: parsed.data.reason,
      actor: { id: 'api', name: `API (${auth.businessId.slice(0, 8)})` },
    });

    return apiSuccess({
      ...result.order,
      _effects: {
        stockApplied: result.stockApplied,
        invoiced: result.invoiced,
        transactionIds: result.transactionIds,
        ...(result.stockAlerts.length ? { stockAlerts: result.stockAlerts } : {}),
      },
    });
  } catch (err) {
    if (err instanceof OrderTransitionError) {
      const status = err.code === 'ORDER_NOT_FOUND' ? 404 : err.code === 'TENANT_MISMATCH' ? 403 : 400;
      return apiError(err.message, status);
    }
    console.error('[API] PATCH /api/v1/orders/[id]/transition error:', err);
    return apiError(err instanceof Error ? err.message : 'Failed to transition order', 500);
  }
}
