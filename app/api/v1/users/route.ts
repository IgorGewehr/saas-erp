import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:users']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const role = searchParams.get('role');
    const search = searchParams.get('search')?.toLowerCase();

    let query: FirebaseFirestore.Query = adminDb
      .collection('users')
      .where('businessId', '==', auth.businessId);

    if (role) query = query.where('role', '==', role);

    const snapshot = await query.get();
    let users = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        uid: data.uid,
        name: data.name,
        email: data.email,
        role: data.role,
        phone: data.phone || null,
        photoURL: data.photoURL || null,
        isOnline: data.isOnline || false,
        userStatus: data.userStatus || 'offline',
        lastSeenAt: data.lastSeenAt || null,
        lastLoginAt: data.lastLoginAt || null,
        sectorIds: data.sectorIds || [],
        createdAt: data.createdAt,
      };
    });

    if (search) {
      users = users.filter(u =>
        u.name?.toLowerCase().includes(search) ||
        u.email?.toLowerCase().includes(search)
      );
    }

    return apiSuccess({ users });
  } catch (err: unknown) {
    console.error('[API] GET /v1/users error:', err);
    return apiError('Failed to fetch users', 500);
  }
}

export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:users']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { id, ...fields } = body;

    if (!id) return apiError('Field "id" (uid) is required', 400);

    const docRef = adminDb.collection('users').doc(id);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()?.businessId !== auth.businessId) {
      return apiError('User not found', 404);
    }

    const allowed = ['name', 'phone', 'role', 'sectorIds', 'userStatus'];
    const validRoles = ['founder', 'admin', 'manager', 'operator', 'viewer'];
    const validStatuses = ['online', 'busy', 'invisible', 'offline'];

    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        if (key === 'role' && !validRoles.includes(fields[key])) {
          return apiError(`Invalid role. Valid: ${validRoles.join(', ')}`, 400);
        }
        if (key === 'userStatus' && !validStatuses.includes(fields[key])) {
          return apiError(`Invalid userStatus. Valid: ${validStatuses.join(', ')}`, 400);
        }
        update[key] = fields[key];
      }
    }

    await docRef.update(update);
    return apiSuccess({ id, ...update });
  } catch (err: unknown) {
    console.error('[API] PUT /v1/users error:', err);
    return apiError('Failed to update user', 500);
  }
}
