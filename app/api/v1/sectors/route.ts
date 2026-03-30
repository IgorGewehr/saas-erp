import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:sectors']);
  if (isApiKeyError(auth)) return auth;

  try {
    const active = req.nextUrl.searchParams.get('active');

    let query: FirebaseFirestore.Query = adminDb
      .collection('sectors')
      .where('businessId', '==', auth.businessId);

    if (active !== null) {
      query = query.where('isActive', '==', active === 'true');
    }

    query = query.orderBy('name', 'asc');

    const snapshot = await query.get();
    const sectors = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return apiSuccess({ sectors });
  } catch (err: unknown) {
    console.error('[API] GET /v1/sectors error:', err);
    return apiError('Failed to fetch sectors', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:sectors']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { name, color } = body;

    if (!name?.trim()) return apiError('Field "name" is required', 400);
    if (!color?.trim()) return apiError('Field "color" is required', 400);

    const now = new Date().toISOString();
    const data: Record<string, unknown> = {
      businessId: auth.businessId,
      name: name.trim(),
      color: color.trim(),
      description: body.description || '',
      icon: body.icon || '',
      leaderId: body.leaderId || '',
      leaderName: body.leaderName || '',
      memberIds: Array.isArray(body.memberIds) ? body.memberIds : [],
      isActive: body.isActive !== false,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await adminDb.collection('sectors').add(data);
    return apiSuccess({ id: docRef.id, ...data }, 201);
  } catch (err: unknown) {
    console.error('[API] POST /v1/sectors error:', err);
    return apiError('Failed to create sector', 500);
  }
}

export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:sectors']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { id, ...fields } = body;

    if (!id) return apiError('Field "id" is required', 400);

    const docRef = adminDb.collection('sectors').doc(id);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()?.businessId !== auth.businessId) {
      return apiError('Sector not found', 404);
    }

    const allowed = ['name', 'description', 'color', 'icon', 'leaderId', 'leaderName', 'memberIds', 'isActive'];
    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    for (const key of allowed) {
      if (fields[key] !== undefined) update[key] = fields[key];
    }

    await docRef.update(update);
    return apiSuccess({ id, ...doc.data(), ...update });
  } catch (err: unknown) {
    console.error('[API] PUT /v1/sectors error:', err);
    return apiError('Failed to update sector', 500);
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:sectors']);
  if (isApiKeyError(auth)) return auth;

  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return apiError('Query param "id" is required', 400);

    const docRef = adminDb.collection('sectors').doc(id);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()?.businessId !== auth.businessId) {
      return apiError('Sector not found', 404);
    }

    await docRef.delete();
    return apiSuccess({ id, deleted: true });
  } catch (err: unknown) {
    console.error('[API] DELETE /v1/sectors error:', err);
    return apiError('Failed to delete sector', 500);
  }
}
