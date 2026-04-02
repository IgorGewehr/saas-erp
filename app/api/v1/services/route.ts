import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';
import type { Query } from 'firebase-admin/firestore';

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
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:services']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();

    // Validate required fields
    const { name, duration, price } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return apiError('Field "name" is required and must be a non-empty string', 400);
    }
    if (duration == null || typeof duration !== 'number' || duration <= 0) {
      return apiError('Field "duration" is required and must be a positive number (minutes)', 400);
    }
    if (price == null || typeof price !== 'number' || price < 0) {
      return apiError('Field "price" is required and must be a non-negative number', 400);
    }

    const now = new Date().toISOString();

    const serviceData: Record<string, unknown> = {
      businessId: auth.businessId,
      name: name.trim(),
      duration,
      price,
      description: body.description?.trim() || '',
      category: body.category?.trim() || '',
      color: body.color?.trim() || '#3B82F6',
      isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
      createdAt: now,
      updatedAt: now,
    };

    // Optional owner fields
    if (body.userId) serviceData.userId = body.userId;
    if (body.userName) serviceData.userName = body.userName;

    const docRef = await adminDb.collection('services').add(serviceData);

    return apiSuccess({ id: docRef.id, ...serviceData }, 201);
  } catch (err) {
    console.error('[API] POST /api/v1/services error:', err);
    return apiError('Failed to create service', 500);
  }
}

// ---------------------------------------------------------------------------
// PUT /api/v1/services — Update an existing service
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:services']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { id, ...fields } = body;

    if (!id || typeof id !== 'string') {
      return apiError('Field "id" is required', 400);
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

    // Build update payload — only allow known fields
    const allowedFields = ['name', 'description', 'duration', 'price', 'category', 'color', 'isActive', 'userId', 'userName'];
    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        if (field === 'name') {
          if (typeof fields.name !== 'string' || fields.name.trim().length === 0) {
            return apiError('"name" must be a non-empty string', 400);
          }
          updateData.name = fields.name.trim();
        } else if (field === 'duration') {
          if (typeof fields.duration !== 'number' || fields.duration <= 0) {
            return apiError('"duration" must be a positive number', 400);
          }
          updateData.duration = fields.duration;
        } else if (field === 'price') {
          if (typeof fields.price !== 'number' || fields.price < 0) {
            return apiError('"price" must be a non-negative number', 400);
          }
          updateData.price = fields.price;
        } else if (field === 'isActive') {
          updateData.isActive = Boolean(fields.isActive);
        } else if (field === 'userId' || field === 'userName') {
          updateData[field] = typeof fields[field] === 'string' ? fields[field].trim() : fields[field];
        } else if (field === 'description' || field === 'category' || field === 'color') {
          updateData[field] = typeof fields[field] === 'string' ? fields[field].trim() : fields[field];
        }
      }
    }

    await docRef.update(updateData);

    const updated = await docRef.get();

    return apiSuccess({ id: updated.id, ...updated.data() });
  } catch (err) {
    console.error('[API] PUT /api/v1/services error:', err);
    return apiError('Failed to update service', 500);
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
