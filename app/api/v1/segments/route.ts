import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

// =============================================================================
// GET /api/v1/segments — List segments
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:segments']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    const query: FirebaseFirestore.Query = adminDb
      .collection('segments')
      .where('businessId', '==', auth.businessId)
      .orderBy('createdAt', 'desc');

    const snapshot = await query.get();
    const segments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const total = segments.length;
    const paginated = segments.slice(offset, offset + limit);

    return apiSuccess({
      segments: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/segments error:', err);
    return apiError('Failed to fetch segments', 500);
  }
}

// =============================================================================
// POST /api/v1/segments — Create a new segment
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:segments']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { name, filters } = body;

    // Validate required fields
    if (!name || typeof name !== 'string' || !name.trim()) {
      return apiError('Field "name" is required and must be a non-empty string', 400);
    }

    if (!Array.isArray(filters) || filters.length === 0) {
      return apiError('Field "filters" is required and must be a non-empty array', 400);
    }

    // Validate each filter has field, operator, value
    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      if (!filter || typeof filter !== 'object') {
        return apiError(`Filter at index ${i} must be an object`, 400);
      }
      if (!filter.field || typeof filter.field !== 'string') {
        return apiError(`Filter at index ${i} must have a "field" string`, 400);
      }
      if (!filter.operator || typeof filter.operator !== 'string') {
        return apiError(`Filter at index ${i} must have an "operator" string`, 400);
      }
      if (filter.value === undefined || filter.value === null) {
        return apiError(`Filter at index ${i} must have a "value"`, 400);
      }
    }

    const now = new Date().toISOString();

    const segmentData: Record<string, unknown> = {
      businessId: auth.businessId,
      name: name.trim(),
      filters,
      createdBy: 'api',
      createdAt: now,
      updatedAt: now,
    };

    // Optional fields
    if (body.description) segmentData.description = body.description;

    const docRef = await adminDb.collection('segments').add(segmentData);

    return apiSuccess({ id: docRef.id, ...segmentData }, 201);
  } catch (err) {
    console.error('[API] POST /api/v1/segments error:', err);
    return apiError('Failed to create segment', 500);
  }
}

// =============================================================================
// PUT /api/v1/segments — Update an existing segment
// =============================================================================
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:segments']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { id, ...updateFields } = body;

    if (!id || typeof id !== 'string') {
      return apiError('Field "id" is required and must be a string', 400);
    }

    // Verify the document exists and belongs to this business
    const docRef = adminDb.collection('segments').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Segment not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Segment not found', 404);
    }

    // Remove protected fields
    delete updateFields.businessId;
    delete updateFields.id;
    delete updateFields.createdAt;
    delete updateFields.createdBy;

    if (Object.keys(updateFields).length === 0) {
      return apiError('No fields to update — provide at least one field besides "id"', 400);
    }

    // Validate filters if provided
    if (updateFields.filters !== undefined) {
      if (!Array.isArray(updateFields.filters) || updateFields.filters.length === 0) {
        return apiError('Field "filters" must be a non-empty array', 400);
      }
      for (let i = 0; i < updateFields.filters.length; i++) {
        const filter = updateFields.filters[i];
        if (!filter || typeof filter !== 'object') {
          return apiError(`Filter at index ${i} must be an object`, 400);
        }
        if (!filter.field || typeof filter.field !== 'string') {
          return apiError(`Filter at index ${i} must have a "field" string`, 400);
        }
        if (!filter.operator || typeof filter.operator !== 'string') {
          return apiError(`Filter at index ${i} must have an "operator" string`, 400);
        }
        if (filter.value === undefined || filter.value === null) {
          return apiError(`Filter at index ${i} must have a "value"`, 400);
        }
      }
    }

    updateFields.updatedAt = new Date().toISOString();

    await docRef.update(updateFields);

    const updatedSnap = await docRef.get();

    return apiSuccess({ id: updatedSnap.id, ...updatedSnap.data() });
  } catch (err) {
    console.error('[API] PUT /api/v1/segments error:', err);
    return apiError('Failed to update segment', 500);
  }
}

// =============================================================================
// DELETE /api/v1/segments?id=xxx — Delete a segment
// =============================================================================
export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:segments']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return apiError('Query parameter "id" is required', 400);
    }

    // Verify the document exists and belongs to this business
    const docRef = adminDb.collection('segments').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Segment not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Segment not found', 404);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (err) {
    console.error('[API] DELETE /api/v1/segments error:', err);
    return apiError('Failed to delete segment', 500);
  }
}
