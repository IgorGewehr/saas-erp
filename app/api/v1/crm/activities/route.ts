import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

const VALID_TYPES = ['ligacao', 'email', 'reuniao', 'whatsapp', 'tarefa', 'nota', 'proposta'];

// =============================================================================
// GET /api/v1/crm/activities — List CRM activities for the authenticated business
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:crm']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);

    const contactId = searchParams.get('contactId');
    const dealId = searchParams.get('dealId');
    const type = searchParams.get('type');
    const completedParam = searchParams.get('completed');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Validate enum filters
    if (type && !VALID_TYPES.includes(type)) {
      return apiError(`Invalid type. Allowed: ${VALID_TYPES.join(', ')}`, 400);
    }

    // Build Firestore query — always filter by businessId
    let query: FirebaseFirestore.Query = adminDb
      .collection('crmActivities')
      .where('businessId', '==', auth.businessId);

    if (contactId) {
      query = query.where('contactId', '==', contactId);
    }
    if (dealId) {
      query = query.where('dealId', '==', dealId);
    }
    if (type) {
      query = query.where('type', '==', type);
    }
    if (completedParam !== null) {
      const isCompleted = completedParam === 'true';
      query = query.where('isCompleted', '==', isCompleted);
    }

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();

    let activities = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const total = activities.length;

    // Apply pagination
    const paginated = activities.slice(offset, offset + limit);

    return apiSuccess({
      activities: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/crm/activities error:', err);
    return apiError('Failed to fetch activities', 500);
  }
}

// =============================================================================
// POST /api/v1/crm/activities — Create a new CRM activity
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:crm']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { type, title } = body;

    // Validate required fields
    if (!type || typeof type !== 'string' || !VALID_TYPES.includes(type)) {
      return apiError(`Field "type" is required. Allowed: ${VALID_TYPES.join(', ')}`, 400);
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return apiError('Field "title" is required and must be a non-empty string', 400);
    }

    const now = new Date().toISOString();

    const activityData: Record<string, unknown> = {
      businessId: auth.businessId,
      type,
      title: title.trim(),
      isCompleted: false,
      createdAt: now,
      updatedAt: now,
    };

    // Optional string fields
    const optionalStrings = [
      'contactId', 'contactName', 'dealId', 'dealTitle',
      'description', 'scheduledAt', 'assignedTo', 'assignedToName',
    ];
    for (const field of optionalStrings) {
      if (body[field] !== undefined && body[field] !== null) {
        activityData[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
      }
    }

    // Optional number: duration (in minutes)
    if (typeof body.duration === 'number') {
      activityData.duration = body.duration;
    }

    const docRef = await adminDb.collection('crmActivities').add(activityData);

    return apiSuccess(
      { id: docRef.id, ...activityData },
      201,
    );
  } catch (err) {
    console.error('[API] POST /api/v1/crm/activities error:', err);
    return apiError('Failed to create activity', 500);
  }
}

// =============================================================================
// PUT /api/v1/crm/activities — Update an existing CRM activity
// Supports ?action=toggle-complete to flip isCompleted and set/clear completedAt
// =============================================================================
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:crm']);
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
    const docRef = adminDb.collection('crmActivities').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Activity not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Activity not found', 404);
    }

    // Check for toggle-complete action
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    if (action === 'toggle-complete') {
      const wasCompleted = existingData?.isCompleted ?? false;
      const now = new Date().toISOString();

      const toggleUpdate: Record<string, unknown> = {
        isCompleted: !wasCompleted,
        updatedAt: now,
      };

      if (!wasCompleted) {
        // Marking as completed
        toggleUpdate.completedAt = now;
      } else {
        // Marking as incomplete — clear completedAt
        toggleUpdate.completedAt = null;
      }

      await docRef.update(toggleUpdate);

      const updatedSnap = await docRef.get();
      return apiSuccess({
        id: updatedSnap.id,
        ...updatedSnap.data(),
      });
    }

    // Standard update flow
    // Remove protected fields from the update payload
    delete updateFields.businessId;
    delete updateFields.id;

    if (Object.keys(updateFields).length === 0) {
      return apiError('No fields to update — provide at least one field besides "id"', 400);
    }

    // Validate type if provided
    if (updateFields.type && !VALID_TYPES.includes(updateFields.type)) {
      return apiError(`Invalid type. Allowed: ${VALID_TYPES.join(', ')}`, 400);
    }

    updateFields.updatedAt = new Date().toISOString();

    await docRef.update(updateFields);

    const updatedSnap = await docRef.get();

    return apiSuccess({
      id: updatedSnap.id,
      ...updatedSnap.data(),
    });
  } catch (err) {
    console.error('[API] PUT /api/v1/crm/activities error:', err);
    return apiError('Failed to update activity', 500);
  }
}

// =============================================================================
// DELETE /api/v1/crm/activities?id=xxx — Delete a CRM activity
// =============================================================================
export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:crm']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError('Query parameter "id" is required', 400);
    }

    // Verify the document exists and belongs to this business
    const docRef = adminDb.collection('crmActivities').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Activity not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Activity not found', 404);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (err) {
    console.error('[API] DELETE /api/v1/crm/activities error:', err);
    return apiError('Failed to delete activity', 500);
  }
}
