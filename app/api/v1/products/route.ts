import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

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
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:products']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { name, salePrice } = body;

    if (!name || typeof name !== 'string') {
      return apiError('Field "name" is required and must be a string', 400);
    }
    if (salePrice === undefined || salePrice === null || typeof salePrice !== 'number') {
      return apiError('Field "salePrice" is required and must be a number', 400);
    }

    const now = new Date().toISOString();

    const productData: Record<string, any> = {
      businessId: auth.businessId,
      name: name.trim(),
      salePrice,
      description: body.description ?? '',
      sku: body.sku ?? '',
      barcode: body.barcode ?? '',
      category: body.category ?? '',
      unit: body.unit ?? 'UN',
      costPrice: body.costPrice ?? 0,
      currentStock: body.currentStock ?? 0,
      minStock: body.minStock ?? 0,
      isActive: body.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };

    // Optional fields — only include if provided
    if (body.maxStock !== undefined) productData.maxStock = body.maxStock;
    if (body.ncm !== undefined) productData.ncm = body.ncm;
    if (body.cfop !== undefined) productData.cfop = body.cfop;
    if (body.cest !== undefined) productData.cest = body.cest;
    if (body.icmsOrigem !== undefined) productData.icmsOrigem = body.icmsOrigem;
    if (body.gtin !== undefined) productData.gtin = body.gtin;
    if (body.gtinTrib !== undefined) productData.gtinTrib = body.gtinTrib;
    if (body.unidadeTrib !== undefined) productData.unidadeTrib = body.unidadeTrib;
    if (body.fiscalTax !== undefined) productData.fiscalTax = body.fiscalTax;
    if (body.imageUrl !== undefined) productData.imageUrl = body.imageUrl;

    const docRef = await adminDb.collection('products').add(productData);

    return apiSuccess({ id: docRef.id, ...productData }, 201);
  } catch (error: any) {
    console.error('[API v1/products POST]', error);
    return apiError(error.message || 'Failed to create product', 500);
  }
}

// ─── PUT /api/v1/products ───────────────────────────────────────────────────
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:products']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id || typeof id !== 'string') {
      return apiError('Field "id" is required and must be a string', 400);
    }

    // Verify the product exists and belongs to this business
    const docRef = adminDb.collection('products').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Product not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Product not found', 404);
    }

    // Prevent overwriting system fields
    delete updates.businessId;
    delete updates.createdAt;
    delete updates.id;

    updates.updatedAt = new Date().toISOString();

    await docRef.update(updates);

    const updated = await docRef.get();

    return apiSuccess({ id: updated.id, ...updated.data() });
  } catch (error: any) {
    console.error('[API v1/products PUT]', error);
    return apiError(error.message || 'Failed to update product', 500);
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

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (error: any) {
    console.error('[API v1/products DELETE]', error);
    return apiError(error.message || 'Failed to delete product', 500);
  }
}
