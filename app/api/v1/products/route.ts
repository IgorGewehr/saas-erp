import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';
import {
  CreateProductBodySchema,
  UpdateProductBodySchema,
} from '@/contracts/api/v1/products';
import { withIdempotency, IdempotencyConflictError } from '@/contracts/_runtime/idempotency';
import type { ProductCatalogData, ProductCatalogPatch } from '@/lib/contracts/api/product-catalog';
import {
  archiveProductCatalogAdmin,
  createProductCatalogAdmin,
  ProductCatalogDuplicateIdentifierError,
  updateProductCatalogAdmin,
} from '@/lib/services/product-catalog-admin';
import { applyStockOperationAdmin } from '@/lib/services/stock-core-admin';

function toCatalogCreateData(body: ReturnType<typeof CreateProductBodySchema.parse>): ProductCatalogData {
  return {
    name: body.name.trim(),
    description: body.description,
    sku: body.sku,
    barcode: body.barcode,
    category: body.category,
    unit: body.unit,
    purchaseUnit: body.unit,
    purchaseToStockFactor: 1,
    costMethod: 'moving_average',
    costPrice: body.costPrice,
    salePrice: body.salePrice,
    minStock: body.minStock,
    maxStock: body.maxStock,
    ncm: body.ncm,
    cfop: body.cfop,
    isActive: body.isActive,
    images: body.imageUrl
      ? [{ id: 'api-primary', url: body.imageUrl, sortOrder: 0, isPrimary: true }]
      : [],
    variants: [],
    isDeliverable: body.isDeliverable,
    menuAvailable: true,
    trackStock: !body.components?.length,
    menuCategory: body.menuCategory,
    menuDescription: body.menuDescription,
    preparationTime: body.preparationTime,
    components: body.components ?? [],
    modifierGroups: body.modifierGroups ?? [],
  };
}

// ─── GET /api/v1/products ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:products']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const search = searchParams.get('search')?.toLowerCase();
    const category = searchParams.get('category');
    const active = searchParams.get('active');
    const stockStatus = searchParams.get('stockStatus');
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
    const offset = Number(searchParams.get('offset')) || 0;

    let query: FirebaseFirestore.Query = adminDb
      .collection('products')
      .where('businessId', '==', auth.businessId);

    // Server-side filters (Firestore-level)
    if (category) {
      query = query.where('category', '==', category);
    }

    if (active !== null && active !== undefined && active !== '') {
      query = query.where('isActive', '==', active === 'true');
    }

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();
    let products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Client-side filters (not natively composable in Firestore with the above)
    if (search) {
      products = products.filter((p: any) => {
        const name = (p.name || '').toLowerCase();
        const sku = (p.sku || '').toLowerCase();
        const barcode = (p.barcode || '').toLowerCase();
        return name.includes(search) || sku.includes(search) || barcode.includes(search);
      });
    }

    if (stockStatus) {
      products = products.filter((p: any) => {
        const current = p.currentStock ?? 0;
        const min = p.minStock ?? 0;
        switch (stockStatus) {
          case 'empty':
            return current <= 0;
          case 'low':
            return current > 0 && current <= min;
          case 'ok':
            return current > min;
          default:
            return true;
        }
      });
    }

    const total = products.length;
    const paginated = products.slice(offset, offset + limit);

    return apiSuccess({
      products: paginated,
      total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[API v1/products GET]', error);
    return apiError(error.message || 'Failed to list products', 500);
  }
}

// ─── POST /api/v1/products ──────────────────────────────────────────────────
// SDD: validação via CreateProductBodySchema. Idempotência via X-Idempotency-Key.
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:products']);
  if (isApiKeyError(auth)) return auth;

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    return apiError('Invalid request body — expected JSON object', 400);
  }
  const parsed = CreateProductBodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }
  const body = parsed.data;

  const idempotencyKey = req.headers.get('x-idempotency-key');

  try {
    const result = await withIdempotency(
      adminDb,
      { businessId: auth.businessId, key: idempotencyKey, endpoint: 'POST /api/v1/products' },
      async () => {
        let product = await createProductCatalogAdmin({
          db: adminDb,
          businessId: auth.businessId,
          data: toCatalogCreateData(body),
        });
        if (body.currentStock > 0) {
          const stock = await applyStockOperationAdmin(adminDb, {
            businessId: auth.businessId,
            type: 'entrada',
            lines: [{ productId: product.id, quantity: body.currentStock }],
            operatorId: `api-key:${auth.keyId}`,
            operatorName: 'API v1',
            reason: 'Estoque inicial via API v1',
            sourceType: 'api',
            sourceId: product.id,
            idempotencyKey: idempotencyKey
              ? `api:v1:product:${idempotencyKey}:initial-stock`
              : `api:v1:product:${product.id}:initial-stock`,
            expandBom: false,
            negativeStockPolicy: 'prevent',
          });
          product = { ...product, currentStock: stock.adjustments[0]?.newStock ?? 0 };
        }
        return product;
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
    if (err instanceof ProductCatalogDuplicateIdentifierError) {
      return apiError(err.message, 409);
    }
    console.error('[API v1/products POST]', err);
    return apiError(err instanceof Error ? err.message : 'Failed to create product', 500);
  }
}

// ─── PUT /api/v1/products ───────────────────────────────────────────────────
// SDD: validação via UpdateProductBodySchema (todas as keys opcionais).
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:products']);
  if (isApiKeyError(auth)) return auth;

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    return apiError('Invalid request body — expected JSON object', 400);
  }
  const { id, ...patch } = raw as { id?: string; [k: string]: unknown };
  if (!id || typeof id !== 'string') {
    return apiError('Field "id" is required and must be a string', 400);
  }
  const parsed = UpdateProductBodySchema.safeParse(patch);
  if (!parsed.success) {
    return apiError(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  try {
    const { currentStock, imageUrl, ...metadata } = parsed.data;
    const patch: ProductCatalogPatch = {
      ...metadata,
      ...(imageUrl !== undefined
        ? {
            images: imageUrl
              ? [{ id: 'api-primary', url: imageUrl, sortOrder: 0, isPrimary: true }]
              : [],
          }
        : {}),
    };
    let product = await updateProductCatalogAdmin({
      db: adminDb,
      businessId: auth.businessId,
      productId: id,
      patch,
    });
    if (currentStock !== undefined && currentStock !== product.currentStock) {
      const idempotencyKey = req.headers.get('x-idempotency-key') ?? randomUUID();
      const stock = await applyStockOperationAdmin(adminDb, {
        businessId: auth.businessId,
        type: 'ajuste',
        lines: [{ productId: id, quantity: currentStock }],
        adjustmentMode: 'absolute',
        operatorId: `api-key:${auth.keyId}`,
        operatorName: 'API v1',
        reason: 'Ajuste de estoque via API v1',
        sourceType: 'api',
        sourceId: id,
        idempotencyKey: `api:v1:product:${id}:update:${idempotencyKey}`,
        expandBom: false,
        negativeStockPolicy: 'prevent',
      });
      product = { ...product, currentStock: stock.adjustments[0]?.newStock ?? product.currentStock };
    }
    return apiSuccess(product);
  } catch (err) {
    if (err instanceof ProductCatalogDuplicateIdentifierError) return apiError(err.message, 409);
    console.error('[API v1/products PUT]', err);
    return apiError(err instanceof Error ? err.message : 'Failed to update product', 500);
  }
}

// ─── DELETE /api/v1/products ────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:products']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return apiError('Query parameter "id" is required', 400);
    }

    const docRef = adminDb.collection('products').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Product not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Product not found', 404);
    }

    const product = await archiveProductCatalogAdmin({
      db: adminDb,
      businessId: auth.businessId,
      productId: id,
      actor: { uid: `api-key:${auth.keyId}`, name: 'API v1' },
    });

    return apiSuccess({ id, archived: true, product });
  } catch (error: any) {
    console.error('[API v1/products DELETE]', error);
    return apiError(error.message || 'Failed to delete product', 500);
  }
}
