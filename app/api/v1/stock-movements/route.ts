import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';
import { CreateStockMovementBodySchema } from '@/contracts/api/v1/stock-movements';
import { withIdempotency, IdempotencyConflictError } from '@/contracts/_runtime/idempotency';

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
// SDD: validação via CreateStockMovementBodySchema + idempotency-key.
//
// NOTA semântica histórica: nesta route, type='ajuste' interpreta `quantity`
// como NOVO VALOR ABSOLUTO de currentStock (não signed delta). Mantemos pra
// não quebrar callers existentes. Stock movement persistido reflete:
//   - entrada/saida: quantity é a magnitude da movimentação
//   - ajuste: previousStock e newStock contam a história — `quantity` é o
//             novo valor absoluto (não o delta).
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:products']);
  if (isApiKeyError(auth)) return auth;

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    return apiError('Invalid request body — expected JSON object', 400);
  }
  const parsed = CreateStockMovementBodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }
  const body = parsed.data;
  const operatorId = (raw as { operatorId?: string }).operatorId ?? 'api';
  const operatorName = (raw as { operatorName?: string }).operatorName ?? 'API';

  const idempotencyKey = req.headers.get('x-idempotency-key');

  try {
    const result = await withIdempotency(
      adminDb,
      { businessId: auth.businessId, key: idempotencyKey, endpoint: 'POST /api/v1/stock-movements' },
      async () => {
        const productRef = adminDb.collection('products').doc(body.productId);
        const productSnap = await productRef.get();
        if (!productSnap.exists || productSnap.data()?.businessId !== auth.businessId) {
          throw new Error('Product not found');
        }
        const productData = productSnap.data()!;
        const previousStock: number = productData.currentStock ?? 0;
        let newStock: number;
        switch (body.type) {
          case 'entrada':
            newStock = previousStock + body.quantity;
            break;
          case 'saida':
            if (body.quantity > previousStock) {
              throw new Error(`Insufficient stock. Current: ${previousStock}, requested: ${body.quantity}`);
            }
            newStock = previousStock - body.quantity;
            break;
          case 'ajuste':
            // semântica histórica: quantity é o novo valor absoluto
            newStock = body.quantity;
            break;
        }
        const now = new Date().toISOString();
        const movementData: Record<string, any> = {
          businessId: auth.businessId,
          productId: body.productId,
          productName: productData.name || '',
          type: body.type,
          quantity: body.quantity,
          previousStock,
          newStock,
          reason: body.reason.trim(),
          operatorId,
          operatorName,
          createdAt: now,
        };
        const batch = adminDb.batch();
        const movementRef = adminDb.collection('stockMovements').doc();
        batch.set(movementRef, movementData);
        batch.update(productRef, { currentStock: newStock, updatedAt: now });
        await batch.commit();
        return {
          id: movementRef.id,
          ...movementData,
          product: { id: body.productId, name: productData.name, previousStock, currentStock: newStock },
        };
      },
    );
    return apiSuccess(
      { ...result.result, ...(result.replayed ? { _idempotent: true } : {}) },
      201,
    );
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      return apiError('Idempotency key in progress — retry in a moment', 409);
    }
    console.error('[API v1/stock-movements POST]', err);
    return apiError(err instanceof Error ? err.message : 'Failed to create stock movement', 500);
  }
}
