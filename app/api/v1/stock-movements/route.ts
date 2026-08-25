import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';
import { CreateStockMovementBodySchema } from '@/contracts/api/v1/stock-movements';
import {
  applyStockOperationAdmin,
  InsufficientStockError,
  InvalidStockOperationError,
  StockIdempotencyConflictError,
  StockReferenceError,
} from '@/lib/services/stock-core-admin';

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
    const coreKey = idempotencyKey ?? `api:${randomUUID()}`;
    const result = await applyStockOperationAdmin(adminDb, {
      businessId: auth.businessId,
      type: body.type,
      lines: [{ productId: body.productId, quantity: body.quantity }],
      operatorId,
      operatorName,
      reason: body.reason.trim(),
      sourceType: 'api',
      sourceId: coreKey,
      idempotencyKey: coreKey,
      expandBom: false,
      adjustmentMode: body.type === 'ajuste' ? 'absolute' : 'delta',
      negativeStockPolicy: 'prevent',
    });
    const adjustment = result.adjustments[0];
    const movementData = {
      id: adjustment.movementId,
      businessId: auth.businessId,
      productId: adjustment.productId,
      productName: adjustment.productName,
      type: body.type,
      // Mantém o contrato histórico da resposta v1: ajuste devolve o alvo absoluto.
      quantity: body.quantity,
      previousStock: adjustment.previousStock,
      newStock: adjustment.newStock,
      reason: body.reason.trim(),
      operatorId,
      operatorName,
      product: {
        id: adjustment.productId,
        name: adjustment.productName,
        previousStock: adjustment.previousStock,
        currentStock: adjustment.newStock,
      },
    };
    return apiSuccess(
      { ...movementData, ...(result.replayed ? { _idempotent: true } : {}) },
      201,
    );
  } catch (err) {
    if (err instanceof StockIdempotencyConflictError) return apiError(err.message, 409);
    if (err instanceof InsufficientStockError) return apiError(err.message, 409);
    if (err instanceof StockReferenceError) return apiError(err.message, 404);
    if (err instanceof InvalidStockOperationError) return apiError(err.message, 400);
    console.error('[API v1/stock-movements POST]', err);
    return apiError(err instanceof Error ? err.message : 'Failed to create stock movement', 500);
  }
}
