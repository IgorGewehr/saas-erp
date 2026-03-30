import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

const VALID_STAGES = ['prospeccao', 'qualificacao', 'proposta', 'negociacao', 'fechamento'];

// =============================================================================
// GET /api/v1/crm/deals — List CRM deals for the authenticated business
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:crm']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);

    const contactId = searchParams.get('contactId');
    const stage = searchParams.get('stage');
    const assignedTo = searchParams.get('assignedTo');
    const search = searchParams.get('search')?.toLowerCase().trim() || '';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Validate enum filters
    if (stage && !VALID_STAGES.includes(stage)) {
      return apiError(`Invalid stage. Allowed: ${VALID_STAGES.join(', ')}`, 400);
    }

    // Build Firestore query — always filter by businessId
    let query: FirebaseFirestore.Query = adminDb
      .collection('crmDeals')
      .where('businessId', '==', auth.businessId);

    if (contactId) {
      query = query.where('contactId', '==', contactId);
    }
    if (stage) {
      query = query.where('stage', '==', stage);
    }
    if (assignedTo) {
      query = query.where('assignedTo', '==', assignedTo);
    }

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();

    let deals = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Apply text search filter in-memory (case-insensitive contains)
    if (search) {
      deals = deals.filter((deal) => {
        const d = deal as Record<string, unknown>;
        const title = (d.title as string || '').toLowerCase();
        const contactName = (d.contactName as string || '').toLowerCase();
        return (
          title.includes(search) ||
          contactName.includes(search)
        );
      });
    }

    const total = deals.length;

    // Apply pagination
    const paginated = deals.slice(offset, offset + limit);

    return apiSuccess({
      deals: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/crm/deals error:', err);
    return apiError('Failed to fetch deals', 500);
  }
}

// =============================================================================
// POST /api/v1/crm/deals — Create a new CRM deal
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:crm']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { contactId, contactName, title } = body;

    // Validate required fields
    if (!contactId || typeof contactId !== 'string' || !contactId.trim()) {
      return apiError('Field "contactId" is required and must be a non-empty string', 400);
    }
    if (!contactName || typeof contactName !== 'string' || !contactName.trim()) {
      return apiError('Field "contactName" is required and must be a non-empty string', 400);
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return apiError('Field "title" is required and must be a non-empty string', 400);
    }

    // Validate enum fields if provided
    if (body.stage && !VALID_STAGES.includes(body.stage)) {
      return apiError(`Invalid stage. Allowed: ${VALID_STAGES.join(', ')}`, 400);
    }

    const now = new Date().toISOString();

    const dealData: Record<string, unknown> = {
      businessId: auth.businessId,
      contactId: contactId.trim(),
      contactName: contactName.trim(),
      title: title.trim(),
      value: typeof body.value === 'number' ? body.value : 0,
      stage: body.stage || 'prospeccao',
      probability: typeof body.probability === 'number' ? body.probability : 10,
      createdAt: now,
      updatedAt: now,
    };

    // Optional string fields
    const optionalStrings = [
      'expectedCloseDate', 'assignedTo', 'assignedToName', 'notes',
    ];
    for (const field of optionalStrings) {
      if (body[field] !== undefined && body[field] !== null) {
        dealData[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
      }
    }

    // Optional array: tags
    if (Array.isArray(body.tags)) {
      dealData.tags = body.tags.filter((t: unknown) => typeof t === 'string' && (t as string).trim());
    }

    const docRef = await adminDb.collection('crmDeals').add(dealData);

    return apiSuccess(
      { id: docRef.id, ...dealData },
      201,
    );
  } catch (err) {
    console.error('[API] POST /api/v1/crm/deals error:', err);
    return apiError('Failed to create deal', 500);
  }
}

// =============================================================================
// PUT /api/v1/crm/deals — Update an existing CRM deal
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
    const docRef = adminDb.collection('crmDeals').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Deal not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Deal not found', 404);
    }

    // Remove protected fields from the update payload
    delete updateFields.businessId;
    delete updateFields.id;

    if (Object.keys(updateFields).length === 0) {
      return apiError('No fields to update — provide at least one field besides "id"', 400);
    }

    // Validate stage if provided
    if (updateFields.stage && !VALID_STAGES.includes(updateFields.stage)) {
      return apiError(`Invalid stage. Allowed: ${VALID_STAGES.join(', ')}`, 400);
    }

    updateFields.updatedAt = new Date().toISOString();

    await docRef.update(updateFields);

    const updatedSnap = await docRef.get();

    return apiSuccess({
      id: updatedSnap.id,
      ...updatedSnap.data(),
    });
  } catch (err) {
    console.error('[API] PUT /api/v1/crm/deals error:', err);
    return apiError('Failed to update deal', 500);
  }
}

// =============================================================================
// DELETE /api/v1/crm/deals?id=xxx — Delete a CRM deal
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
    const docRef = adminDb.collection('crmDeals').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Deal not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Deal not found', 404);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (err) {
    console.error('[API] DELETE /api/v1/crm/deals error:', err);
    return apiError('Failed to delete deal', 500);
  }
}
