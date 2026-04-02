import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

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
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:sales']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { items, payments } = body;

    // ── Validate items ────────────────────────────────────────────────────────
    if (!Array.isArray(items) || items.length === 0) {
      return apiError('Field "items" is required and must be a non-empty array', 400);
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.description || typeof item.description !== 'string') {
        return apiError(`items[${i}].description is required and must be a string`, 400);
      }
      if (typeof item.quantity !== 'number' || item.quantity <= 0) {
        return apiError(`items[${i}].quantity is required and must be a positive number`, 400);
      }
      if (typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
        return apiError(`items[${i}].unitPrice is required and must be a non-negative number`, 400);
      }
      if (typeof item.total !== 'number' || item.total < 0) {
        return apiError(`items[${i}].total is required and must be a non-negative number`, 400);
      }
    }

    // ── Validate payments ─────────────────────────────────────────────────────
    if (!Array.isArray(payments) || payments.length === 0) {
      return apiError('Field "payments" is required and must be a non-empty array', 400);
    }

    const validMethods = ['dinheiro', 'pix', 'credito', 'debito', 'boleto', 'outros'];
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      if (!p.method || !validMethods.includes(p.method)) {
        return apiError(
          `payments[${i}].method is required. Allowed: ${validMethods.join(', ')}`,
          400,
        );
      }
      if (typeof p.amount !== 'number' || p.amount <= 0) {
        return apiError(`payments[${i}].amount is required and must be a positive number`, 400);
      }
    }

    // ── Validate optional status ──────────────────────────────────────────────
    const status = body.status || 'finalizada';
    if (!['aberta', 'finalizada', 'cancelada'].includes(status)) {
      return apiError('Field "status" must be "aberta", "finalizada", or "cancelada"', 400);
    }

    // ── Build sale items with IDs ─────────────────────────────────────────────
    const saleItems = items.map((item: any, idx: number) => ({
      id: `item_${idx}`,
      description: item.description.trim(),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount ?? 0,
      total: item.total,
      ...(item.productId && { productId: item.productId }),
      ...(item.serviceId && { serviceId: item.serviceId }),
    }));

    // ── Calculate totals ──────────────────────────────────────────────────────
    const subtotal = saleItems.reduce((sum: number, item: any) => sum + item.total, 0);
    const discount = typeof body.discount === 'number' && body.discount >= 0 ? body.discount : 0;
    const total = Math.max(subtotal - discount, 0);

    // Round to 2 decimal places
    const roundedSubtotal = Math.round(subtotal * 100) / 100;
    const roundedTotal = Math.round(total * 100) / 100;

    const now = new Date().toISOString();

    const saleData: Record<string, any> = {
      businessId: auth.businessId,
      items: saleItems,
      payments: payments.map((p: any) => ({
        method: p.method,
        amount: p.amount,
        ...(p.installments && { installments: p.installments }),
        ...(p.cardBrand && { cardBrand: p.cardBrand }),
      })),
      subtotal: roundedSubtotal,
      discount,
      total: roundedTotal,
      status,
      createdAt: now,
      updatedAt: now,
    };

    // ── Optional fields ───────────────────────────────────────────────────────
    if (body.clientId) saleData.clientId = body.clientId;
    if (body.clientName) saleData.clientName = body.clientName;
    if (body.notes) saleData.notes = body.notes;
    if (body.operatorId) saleData.operatorId = body.operatorId;
    if (body.operatorName) saleData.operatorName = body.operatorName;
    if (body.channelType) saleData.channelType = body.channelType;
    if (body.conversationId) saleData.conversationId = body.conversationId;
    if (body.sectorId) saleData.sectorId = body.sectorId;

    // ── Create the sale document ──────────────────────────────────────────────
    const saleRef = await adminDb.collection('sales').add(saleData);
    const saleId = saleRef.id;

    // ── Update product stock for items with productId ─────────────────────────
    for (const item of saleItems) {
      if (item.productId) {
        const productRef = adminDb.collection('products').doc(item.productId);
        const productSnap = await productRef.get();

        if (productSnap.exists) {
          const productData = productSnap.data()!;
          // Verify product belongs to the same business
          if (productData.businessId === auth.businessId) {
            const previousStock = productData.currentStock ?? 0;
            const newStock = previousStock - item.quantity;

            await productRef.update({
              currentStock: newStock,
              updatedAt: now,
            });

            // Create stock movement record
            await adminDb.collection('stockMovements').add({
              businessId: auth.businessId,
              productId: item.productId,
              productName: item.description,
              type: 'saida',
              quantity: item.quantity,
              previousStock,
              newStock,
              reason: `Venda #${saleId.substring(0, 6)}`,
              saleId,
              operatorId: body.operatorId || 'api',
              operatorName: body.operatorName || 'API',
              createdAt: now,
            });
          }
        }
      }
    }

    // ── Update client stats if clientId provided ──────────────────────────────
    if (body.clientId) {
      const clientRef = adminDb.collection('crmContacts').doc(body.clientId);
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

    // ── Create linked financial transaction ───────────────────────────────────
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
      paymentMethod: payments[0]?.method || 'dinheiro',
      createdAt: now,
      updatedAt: now,
    };

    if (body.clientId) transactionData.clientId = body.clientId;
    if (body.clientName) transactionData.clientName = body.clientName;
    if (body.channelType) transactionData.channelType = body.channelType;
    if (body.conversationId) transactionData.conversationId = body.conversationId;
    if (body.sectorId) transactionData.sectorId = body.sectorId;

    const txRef = await adminDb.collection('transactions').add(transactionData);

    return apiSuccess(
      {
        id: saleId,
        ...saleData,
        _linked: {
          transactionId: txRef.id,
        },
      },
      201,
    );
  } catch (err) {
    console.error('[API] POST /api/v1/sales error:', err);
    return apiError('Failed to create sale', 500);
  }
}
