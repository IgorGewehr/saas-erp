import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';
import { checkBusinessRateLimit } from '@/lib/utils/rateLimit';
import { CreateOrderBodySchema } from '@/contracts/api/v1/orders';
import { createOrderWithSideEffects, OrderServiceError } from '@/lib/services/order-server';
import { CommercialQuoteError } from '@/lib/services/commercial-quote';

// =============================================================================
// GET /api/v1/orders — List B2B/condicional orders for the authenticated business
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:orders']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const clientId = searchParams.get('clientId');
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

    let query: FirebaseFirestore.Query = adminDb
      .collection('orders')
      .where('businessId', '==', auth.businessId);

    if (status) query = query.where('status', '==', status);
    if (type) query = query.where('type', '==', type);
    if (clientId) query = query.where('clientId', '==', clientId);

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();
    const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const total = orders.length;
    const paginated = orders.slice(offset, offset + limit);

    return apiSuccess({
      orders: paginated,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/orders error:', err);
    return apiError('Failed to fetch orders', 500);
  }
}

// =============================================================================
// POST /api/v1/orders — Create a new B2B/condicional order
// SDD: validação Zod completa via CreateOrderBodySchema.
//      Idempotência via X-Idempotency-Key (header opcional; sem ele, deriva
//      do próprio conteúdo do carrinho — ver order-server.ts).
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:orders']);
  if (isApiKeyError(auth)) return auth;

  const bizLimit = checkBusinessRateLimit('v1-orders-write', auth.businessId, 300, 3_600_000);
  if (!bizLimit.allowed) {
    return apiError('Rate limit exceeded for this business. Slow down.', 429);
  }

  const rawBody = await req.json().catch(() => null);
  if (rawBody == null || typeof rawBody !== 'object') {
    return apiError('Invalid request body — expected JSON object', 400);
  }
  const parsed = CreateOrderBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }
  const body = parsed.data;
  const idempotencyKey = req.headers.get('x-idempotency-key');

  try {
    const result = await createOrderWithSideEffects({
      db: adminDb,
      input: {
        businessId: auth.businessId,
        ...body,
        operatorId: 'api',
        operatorName: `API (${auth.businessId.slice(0, 8)})`,
        idempotencyKey: idempotencyKey ?? undefined,
      },
      context: { canApplyManualDiscount: true },
    });

    return apiSuccess(
      { ...result.order, ...(result.created ? {} : { _idempotent: true }) },
      201,
    );
  } catch (err) {
    if (err instanceof CommercialQuoteError) return apiError(err.message, err.status);
    if (err instanceof OrderServiceError) return apiError(err.message, err.status);
    console.error('[API] POST /api/v1/orders error:', err);
    return apiError(err instanceof Error ? err.message : 'Failed to create order', 500);
  }
}
