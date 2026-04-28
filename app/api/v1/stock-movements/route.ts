import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

// ─── GET /api/v1/stock-movements ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:products']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const productId = searchParams.get('productId');
    const type = searchParams.get('type');
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
    const offset = Number(searchParams.get('offset')) || 0;

    let query: FirebaseFirestore.Query = adminDb
      .collection('stockMovements')
      .where('businessId', '==', auth.businessId);

    if (productId) {
      query = query.where('productId', '==', productId);
    }

    if (type && ['entrada', 'saida', 'ajuste'].includes(type)) {
      query = query.where('type', '==', type);
    }

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();
    const movements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const total = movements.length;
    const paginated = movements.slice(offset, offset + limit);

    return apiSuccess({
      movements: paginated,
      total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[API v1/stock-movements GET]', error);
    return apiError(error.message || 'Failed to list stock movements', 500);
  }
}

// ─── POST /api/v1/stock-movements ──────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:products']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { productId, type, quantity, reason, operatorId, operatorName } = body;

    // Validate required fields
    if (!productId || typeof productId !== 'string') {
      return apiError('Field "productId" is required and must be a string', 400);
    }
    if (!type || !['entrada', 'saida', 'ajuste'].includes(type)) {
      return apiError('Field "type" is required and must be "entrada", "saida", or "ajuste"', 400);
    }
    if (quantity === undefined || quantity === null || typeof quantity !== 'number' || quantity < 0) {
      return apiError('Field "quantity" is required and must be a non-negative number', 400);
    }
    if (!reason || typeof reason !== 'string') {
      return apiError('Field "reason" is required and must be a string', 400);
    }

    // Fetch the product and verify ownership
    const productRef = adminDb.collection('products').doc(productId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
      return apiError('Product not found', 404);
    }

    const productData = productSnap.data()!;

    if (productData.businessId !== auth.businessId) {
      return apiError('Product not found', 404);
    }

    const previousStock: number = productData.currentStock ?? 0;
    let newStock: number;

    switch (type) {
      case 'entrada':
        newStock = previousStock + quantity;
        break;
      case 'saida':
        if (quantity > previousStock) {
          return apiError(
            `Insufficient stock. Current: ${previousStock}, requested: ${quantity}`,
            400,
            { currentStock: previousStock, requested: quantity },
          );
        }
        newStock = previousStock - quantity;
        break;
      case 'ajuste':
        newStock = quantity;
        break;
      default:
        return apiError('Invalid movement type', 400);
    }

    const now = new Date().toISOString();

    const movementData: Record<string, any> = {
      businessId: auth.businessId,
      productId,
      productName: productData.name || '',
      type,
      quantity,
      previousStock,
      newStock,
      reason: reason.trim(),
      operatorId: operatorId ?? '',
      operatorName: operatorName ?? '',
      createdAt: now,
    };

    // Use a batch to atomically create movement + update product stock
    const batch = adminDb.batch();

    const movementRef = adminDb.collection('stockMovements').doc();
    batch.set(movementRef, movementData);

    batch.update(productRef, {
      currentStock: newStock,
      updatedAt: now,
    });

    await batch.commit();

    return apiSuccess(
      {
        id: movementRef.id,
        ...movementData,
        product: {
          id: productId,
          name: productData.name,
          previousStock,
          currentStock: newStock,
        },
      },
      201,
    );
  } catch (error: any) {
    console.error('[API v1/stock-movements POST]', error);
    return apiError(error.message || 'Failed to create stock movement', 500);
  }
}
