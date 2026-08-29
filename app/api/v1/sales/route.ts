import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';
import { CreateSaleBodySchema } from '@/contracts/api/v1/sales';
import { createSaleWithSideEffects } from '@/lib/services/sales-server';
import { CommercialOperationError } from '@/lib/services/commercial-operation-admin';
import { CommercialQuoteError } from '@/lib/services/commercial-quote';

// =============================================================================
// GET /api/v1/sales — List sales for the authenticated business
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:sales']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;

    const status = searchParams.get('status') as 'aberta' | 'finalizada' | 'cancelada' | null;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const clientId = searchParams.get('clientId');
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

    // Validate status
    if (status && !['aberta', 'finalizada', 'cancelada'].includes(status)) {
      return apiError('Invalid status. Allowed: aberta, finalizada, cancelada', 400);
    }

    // Build Firestore query — always filter by businessId
    let query: FirebaseFirestore.Query = adminDb
      .collection('sales')
      .where('businessId', '==', auth.businessId);

    if (status) {
      query = query.where('status', '==', status);
    }

    if (clientId) {
      query = query.where('clientId', '==', clientId);
    }

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();

    let sales = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Apply date range filter in-memory (createdAt is ISO string)
    if (startDate) {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) {
        return apiError('Invalid startDate — expected ISO date string (YYYY-MM-DD)', 400);
      }
      sales = sales.filter((s: any) => {
        const created = new Date(s.createdAt);
        return created >= start;
      });
    }

    if (endDate) {
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        return apiError('Invalid endDate — expected ISO date string (YYYY-MM-DD)', 400);
      }
      // Include the full end day
      end.setHours(23, 59, 59, 999);
      sales = sales.filter((s: any) => {
        const created = new Date(s.createdAt);
        return created <= end;
      });
    }

    const total = sales.length;
    const paginated = sales.slice(offset, offset + limit);

    return apiSuccess({
      sales: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/sales error:', err);
    return apiError('Failed to fetch sales', 500);
  }
}

// =============================================================================
// POST /api/v1/sales — Create a new sale
// SDD: validação Zod completa via CreateSaleBodySchema.
//      Idempotência via X-Idempotency-Key (header opcional).
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:sales']);
  if (isApiKeyError(auth)) return auth;

  // ── Validate body com Zod ────────────────────────────────────────────────
  const rawBody = await req.json().catch(() => null);
  if (rawBody == null || typeof rawBody !== 'object') {
    return apiError('Invalid request body — expected JSON object', 400);
  }
  const parsed = CreateSaleBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }
  const body = parsed.data;

  // ── Cross-field invariante: sum(payments) ≈ expected total ───────────────
  // (Zod já valida shapes; isso é regra de negócio que cruza items↔payments)
  const expectedItemsTotal = body.items.reduce(
    (sum, it) => sum + (it.total ?? it.quantity * it.unitPrice - it.discount),
    0,
  );
  const subtotalExpected = Math.round(expectedItemsTotal * 100) / 100;
  const totalExpected = Math.round(Math.max(subtotalExpected - body.discount + (body.tip ?? 0), 0) * 100) / 100;
  if (body.status === 'finalizada') {
    const paymentSum = Math.round(body.payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
    if (Math.abs(paymentSum - totalExpected) > 0.011) {
      return apiError(`Sum of payments (${paymentSum.toFixed(2)}) ≠ expected total (${totalExpected.toFixed(2)})`, 400);
    }
  }

  // ── Idempotency key (opcional) ───────────────────────────────────────────
  const idempotencyKey = req.headers.get('x-idempotency-key');

  try {
    // Sale + Transaction de receita + StockMovements + comissão num serviço
    // único idempotente (lib/services/sales-server.ts). subtotalExpected/
    // totalExpected acima permanecem como validação de borda (R6).
    const result = await createSaleWithSideEffects({
      businessId: auth.businessId,
      clientId: body.clientId,
      clientName: body.clientName,
      items: body.items,
      payments: body.payments,
      discount: body.discount,
      discountReason: body.discountReason,
      tip: body.tip,
      status: body.status,
      notes: body.notes,
      channelType: body.channelType,
      conversationId: body.conversationId,
      sectorId: body.sectorId,
      operatorId: 'api',
      operatorName: `API (${auth.businessId.slice(0, 8)})`,
      idempotencyKey: idempotencyKey ?? undefined,
    }, adminDb, {
      channel: 'api_v1',
      actorType: 'api',
      canApplyManualDiscount: true,
      commissionRate: 0,
    });

    return apiSuccess(
      {
        ...result.sale,
        _linked: {
          ...(result.transactionId ? { transactionId: result.transactionId } : {}),
          transactionIds: result.transactionIds,
          operationId: result.operationId,
          ...(result.commissionTransactionId ? { commissionTransactionId: result.commissionTransactionId } : {}),
        },
        ...(result.replayed ? { _idempotent: true } : {}),
      },
      201,
    );
  } catch (err) {
    if (err instanceof CommercialQuoteError) return apiError(err.message, err.status);
    if (err instanceof CommercialOperationError) {
      const status = err.code.includes('IDEMPOTENCY') || err.code.includes('IN_PROGRESS') ? 409 : 400;
      return apiError(err.message, status);
    }
    console.error('[API] POST /api/v1/sales error:', err);
    return apiError(err instanceof Error ? err.message : 'Failed to create sale', 500);
  }
}
