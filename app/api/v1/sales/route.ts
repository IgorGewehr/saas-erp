import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';
import { deductStockAdmin, loadProductIndex } from '@/lib/services/stock-admin';
import { CreateSaleBodySchema } from '@/contracts/api/v1/sales';
import { withIdempotency, IdempotencyConflictError } from '@/contracts/_runtime/idempotency';

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
    const result = await withIdempotency(
      adminDb,
      { businessId: auth.businessId, key: idempotencyKey, endpoint: 'POST /api/v1/sales' },
      async () => {
        // ── Build sale items com totals consistentes ───────────────────────
        const saleItems = body.items.map((item, idx) => ({
          id: `item_${idx}`,
          description: item.description.trim(),
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          total: Math.round((item.total ?? item.quantity * item.unitPrice - item.discount) * 100) / 100,
          ...(item.productId && { productId: item.productId }),
          ...(item.serviceId && { serviceId: item.serviceId }),
        }));

        const roundedSubtotal = subtotalExpected;
        const roundedTotal = totalExpected;
        const now = new Date().toISOString();

        const saleData: Record<string, any> = {
          businessId: auth.businessId,
          items: saleItems,
          payments: body.payments.map((p) => ({
            method: p.method,
            amount: p.amount,
            ...(p.installments && { installments: p.installments }),
            ...(p.cardBrand && { cardBrand: p.cardBrand }),
          })),
          subtotal: roundedSubtotal,
          discount: body.discount,
          ...(body.tip !== undefined && { tip: body.tip }),
          total: roundedTotal,
          status: body.status,
          createdAt: now,
          updatedAt: now,
          operatorId: 'api',
          operatorName: `API (${auth.businessId.slice(0, 8)})`,
        };

        if (body.clientId) saleData.clientId = body.clientId;
        if (body.clientName) saleData.clientName = body.clientName;
        if (body.notes) saleData.notes = body.notes;
        if (body.channelType) saleData.channelType = body.channelType;
        if (body.conversationId) saleData.conversationId = body.conversationId;
        if (body.sectorId) saleData.sectorId = body.sectorId;

        const productLines = saleItems
          .filter((item) => !!item.productId)
          .map((item) => ({ productId: item.productId as string, quantity: item.quantity }));

        const productIndex = await loadProductIndex(
          adminDb,
          productLines.map((l) => l.productId),
          auth.businessId,
        );

        const saleRef = await adminDb.collection('sales').add(saleData);
        const saleId = saleRef.id;

        if (productLines.length > 0) {
          try {
            await deductStockAdmin(adminDb, productLines, {
              businessId: auth.businessId,
              operatorId: 'api',
              operatorName: 'API',
              sourceId: saleId,
              reason: `Venda #${saleId.substring(0, 6)}`,
              productIndex,
            });
          } catch (stockErr) {
            console.error('[API] sale stock deduction failed:', stockErr);
            throw new Error('Sale created but stock deduction failed');
          }
        }

        if (body.clientId) {
          const clientRef = adminDb.collection('clients').doc(body.clientId);
          const clientSnap = await clientRef.get();
          if (clientSnap.exists && clientSnap.data()?.businessId === auth.businessId) {
            const clientData = clientSnap.data()!;
            await clientRef.update({
              totalSpent: (clientData.totalSpent || 0) + roundedTotal,
              visitCount: (clientData.visitCount || 0) + 1,
              lastVisit: now,
              updatedAt: now,
            });
          }
        }

        const transactionData: Record<string, any> = {
          businessId: auth.businessId,
          type: 'receita',
          category: 'Vendas',
          description: `Venda ${body.clientName ? `- ${body.clientName}` : ''}`.trim(),
          amount: roundedTotal,
          dueDate: now.split('T')[0],
          paymentDate: now.split('T')[0],
          status: 'pago',
          saleId,
          paymentMethod: body.payments[0]?.method || 'dinheiro',
          createdAt: now,
          updatedAt: now,
        };
        if (body.clientId) transactionData.clientId = body.clientId;
        if (body.clientName) transactionData.clientName = body.clientName;
        if (body.channelType) transactionData.channelType = body.channelType;
        if (body.conversationId) transactionData.conversationId = body.conversationId;
        if (body.sectorId) transactionData.sectorId = body.sectorId;

        const txRef = await adminDb.collection('transactions').add(transactionData);

        return {
          id: saleId,
          ...saleData,
          _linked: { transactionId: txRef.id },
        };
      },
    );

    return apiSuccess(
      { ...result.result, ...(result.replayed ? { _idempotent: true } : {}) },
      201,
    );
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      return apiError(`Idempotency key in progress — retry in a moment`, 409);
    }
    console.error('[API] POST /api/v1/sales error:', err);
    return apiError(err instanceof Error ? err.message : 'Failed to create sale', 500);
  }
}
