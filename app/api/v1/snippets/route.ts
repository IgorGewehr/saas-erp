import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:snippets']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const category = searchParams.get('category');
    const sectorId = searchParams.get('sectorId');
    const search = searchParams.get('search')?.toLowerCase();
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
    const offset = Number(searchParams.get('offset')) || 0;

    let query: FirebaseFirestore.Query = adminDb
      .collection('snippets')
      .where('businessId', '==', auth.businessId);

    if (category) query = query.where('category', '==', category);
    if (sectorId) query = query.where('sectorId', '==', sectorId);

    const snapshot = await query.get();
    let snippets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (search) {
      snippets = snippets.filter((s: Record<string, unknown>) =>
        (s.shortcode as string)?.toLowerCase().includes(search) ||
        (s.content as string)?.toLowerCase().includes(search)
      );
    }

    const total = snippets.length;
    const paginated = snippets.slice(offset, offset + limit);

    return apiSuccess({
      snippets: paginated,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    });
  } catch (err: unknown) {
    console.error('[API] GET /v1/snippets error:', err);
    return apiError('Failed to fetch snippets', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:snippets']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { shortcode, content } = body;

    if (!shortcode?.trim()) return apiError('Field "shortcode" is required', 400);
    if (!content?.trim()) return apiError('Field "content" is required', 400);

    const now = new Date().toISOString();
    const data: Record<string, unknown> = {
      businessId: auth.businessId,
      shortcode: shortcode.trim(),
      content: content.trim(),
      createdBy: 'api',
      createdAt: now,
      updatedAt: now,
    };

    if (body.category) data.category = body.category;
    if (body.sectorId) data.sectorId = body.sectorId;

    const docRef = await adminDb.collection('snippets').add(data);
    return apiSuccess({ id: docRef.id, ...data }, 201);
  } catch (err: unknown) {
    console.error('[API] POST /v1/snippets error:', err);
    return apiError('Failed to create snippet', 500);
  }
}

export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:snippets']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json();
    const { id, ...fields } = body;

    if (!id) return apiError('Field "id" is required', 400);

    const docRef = adminDb.collection('snippets').doc(id);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()?.businessId !== auth.businessId) {
      return apiError('Snippet not found', 404);
    }

    const allowed = ['shortcode', 'content', 'category', 'sectorId'];
    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    for (const key of allowed) {
      if (fields[key] !== undefined) update[key] = fields[key];
    }

    await docRef.update(update);
    return apiSuccess({ id, ...doc.data(), ...update });
  } catch (err: unknown) {
    console.error('[API] PUT /v1/snippets error:', err);
    return apiError('Failed to update snippet', 500);
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:snippets']);
  if (isApiKeyError(auth)) return auth;

  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return apiError('Query param "id" is required', 400);

    const docRef = adminDb.collection('snippets').doc(id);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()?.businessId !== auth.businessId) {
      return apiError('Snippet not found', 404);
    }

    await docRef.delete();
    return apiSuccess({ id, deleted: true });
  } catch (err: unknown) {
    console.error('[API] DELETE /v1/snippets error:', err);
    return apiError('Failed to delete snippet', 500);
  }
}
