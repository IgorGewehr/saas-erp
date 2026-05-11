import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';
import type { Query } from 'firebase-admin/firestore';
import { CreateServiceBodySchema, UpdateServiceBodySchema } from '@/contracts/api/v1/services';
import { withIdempotency, IdempotencyConflictError } from '@/contracts/_runtime/idempotency';

// ---------------------------------------------------------------------------
// GET /api/v1/services — List services for the authenticated business
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:services']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;

    // Pagination
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Build query — always scoped to the tenant
    let query: Query = adminDb
      .collection('services')
      .where('businessId', '==', auth.businessId);

    // Optional filters
    const active = searchParams.get('active');
    if (active === 'true') {
      query = query.where('isActive', '==', true);
    } else if (active === 'false') {
      query = query.where('isActive', '==', false);
    }

    const category = searchParams.get('category');
    if (category) {
      query = query.where('category', '==', category);
    }

    const userId = searchParams.get('userId');
    if (userId) {
      query = query.where('userId', '==', userId);
    }

    query = query.orderBy('name', 'asc');

    const snapshot = await query.get();

    let services = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Client-side search filter (Firestore doesn't support LIKE)
    const search = searchParams.get('search')?.toLowerCase();
    if (search) {
      services = services.filter((s: Record<string, unknown>) =>
        (s.name as string)?.toLowerCase().includes(search),
      );
    }

    const total = services.length;
    const paginated = services.slice(offset, offset + limit);

    return apiSuccess({ services: paginated, total, limit, offset });
  } catch (err) {
    console.error('[API] GET /api/v1/services error:', err);
    return apiError('Failed to fetch services', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/services — Create a new service
// SDD: validação via CreateServiceBodySchema + idempotency-key.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:services']);
  if (isApiKeyError(auth)) return auth;

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    return apiError('Invalid request body — expected JSON object', 400);
  }
  const parsed = CreateServiceBodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }
  const body = parsed.data;
  const idempotencyKey = req.headers.get('x-idempotency-key');

  try {
    const result = await withIdempotency(
      adminDb,
      { businessId: auth.businessId, key: idempotencyKey, endpoint: 'POST /api/v1/services' },
      async () => {
        const now = new Date().toISOString();
        const serviceData: Record<string, unknown> = {
          businessId: auth.businessId,
          ...body,
          name: body.name.trim(),
          description: body.description?.trim() || '',
          category: body.category?.trim() || '',
          createdAt: now,
          updatedAt: now,
        };
        const docRef = await adminDb.collection('services').add(serviceData);
        return { id: docRef.id, ...serviceData };
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
    console.error('[API] POST /api/v1/services error:', err);
    return apiError(err instanceof Error ? err.message : 'Failed to create service', 500);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/v1/services — Update an existing service
// SDD: validação via UpdateServiceBodySchema (todas keys opcionais).
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:services']);
  if (isApiKeyError(auth)) return auth;

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    return apiError('Invalid request body — expected JSON object', 400);
  }
  const { id, ...patch } = raw as { id?: string; [k: string]: unknown };
  if (!id || typeof id !== 'string') {
    return apiError('Field "id" is required', 400);
  }
  const parsed = UpdateServiceBodySchema.safeParse(patch);
  if (!parsed.success) {
    return apiError(`Validation failed: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  try {
    const docRef = adminDb.collection('services').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists || docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Service not found', 404);
    }
    const updateData: Record<string, unknown> = {
      ...parsed.data,
      updatedAt: new Date().toISOString(),
    };
    // Trim string fields que vêm validados como string
    if (typeof updateData.name === 'string') updateData.name = (updateData.name as string).trim();
    if (typeof updateData.description === 'string') updateData.description = (updateData.description as string).trim();
    if (typeof updateData.category === 'string') updateData.category = (updateData.category as string).trim();
    await docRef.update(updateData);
    const updated = await docRef.get();
    return apiSuccess({ id: updated.id, ...updated.data() });
  } catch (err) {
    console.error('[API] PUT /api/v1/services error:', err);
    return apiError(err instanceof Error ? err.message : 'Failed to update service', 500);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/services?id=xxx — Delete a service
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:services']);
  if (isApiKeyError(auth)) return auth;

  try {
    const id = req.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError('Query parameter "id" is required', 400);
    }

    // Verify service exists and belongs to this business
    const docRef = adminDb.collection('services').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Service not found', 404);
    }

    if (docSnap.data()?.businessId !== auth.businessId) {
      return apiError('Service not found', 404);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (err) {
    console.error('[API] DELETE /api/v1/services error:', err);
    return apiError('Failed to delete service', 500);
  }
}
