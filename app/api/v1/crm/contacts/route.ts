import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

const VALID_STATUSES = ['novo', 'contatado', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido'];
const VALID_SOURCES = ['site', 'indicacao', 'whatsapp', 'instagram', 'facebook', 'google_ads', 'linkedin', 'evento', 'email', 'telefone', 'outro'];

// =============================================================================
// GET /api/v1/crm/contacts — List CRM contacts for the authenticated business
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:crm']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = new URL(req.url);

    const status = searchParams.get('status');
    const source = searchParams.get('source');
    const search = searchParams.get('search')?.toLowerCase().trim() || '';
    const tagsParam = searchParams.get('tags');
    const assignedTo = searchParams.get('assignedTo');
    const lifecycleStage = searchParams.get('lifecycleStage');
    const sectorId = searchParams.get('sectorId');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Validate enum filters
    if (status && !VALID_STATUSES.includes(status)) {
      return apiError(`Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`, 400);
    }
    if (source && !VALID_SOURCES.includes(source)) {
      return apiError(`Invalid source. Allowed: ${VALID_SOURCES.join(', ')}`, 400);
    }

    // Build Firestore query — always filter by businessId
    let query: FirebaseFirestore.Query = adminDb
      .collection('crmContacts')
      .where('businessId', '==', auth.businessId);

    if (status) {
      query = query.where('status', '==', status);
    }
    if (source) {
      query = query.where('source', '==', source);
    }
    if (assignedTo) {
      query = query.where('assignedTo', '==', assignedTo);
    }
    if (lifecycleStage) {
      query = query.where('lifecycleStage', '==', lifecycleStage);
    }
    if (sectorId) {
      query = query.where('sectorId', '==', sectorId);
    }

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();

    let contacts = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Apply text search filter in-memory (case-insensitive contains)
    if (search) {
      contacts = contacts.filter((contact) => {
        const c = contact as Record<string, unknown>;
        const name = (c.name as string || '').toLowerCase();
        const email = (c.email as string || '').toLowerCase();
        const phone = (c.phone as string || '').toLowerCase();
        const company = (c.company as string || '').toLowerCase();
        return (
          name.includes(search) ||
          email.includes(search) ||
          phone.includes(search) ||
          company.includes(search)
        );
      });
    }

    // Apply tags filter in-memory (contact must have ALL specified tags)
    if (tagsParam) {
      const filterTags = tagsParam.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      if (filterTags.length > 0) {
        contacts = contacts.filter((contact) => {
          const c = contact as Record<string, unknown>;
          const contactTags = (Array.isArray(c.tags) ? c.tags : []).map((t: unknown) => String(t).toLowerCase());
          return filterTags.every(tag => contactTags.includes(tag));
        });
      }
    }

    const total = contacts.length;

    // Apply pagination
    const paginated = contacts.slice(offset, offset + limit);

    return apiSuccess({
      contacts: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/crm/contacts error:', err);
    return apiError('Failed to fetch contacts', 500);
  }
}

// =============================================================================
// POST /api/v1/crm/contacts — Create a new CRM contact
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:crm']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { name } = body;

    // Validate required fields
    if (!name || typeof name !== 'string' || !name.trim()) {
      return apiError('Field "name" is required and must be a non-empty string', 400);
    }

    // Validate enum fields if provided
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return apiError(`Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`, 400);
    }
    if (body.source && !VALID_SOURCES.includes(body.source)) {
      return apiError(`Invalid source. Allowed: ${VALID_SOURCES.join(', ')}`, 400);
    }

    const now = new Date().toISOString();

    const contactData: Record<string, unknown> = {
      businessId: auth.businessId,
      name: name.trim(),
      source: body.source || 'outro',
      status: body.status || 'novo',
      score: typeof body.score === 'number' ? body.score : 0,
      createdAt: now,
      updatedAt: now,
    };

    // Optional string fields
    const optionalStrings = [
      'email', 'phone', 'whatsapp', 'company', 'role',
      'assignedTo', 'assignedToName', 'notes', 'clientId',
      'lifecycleStage', 'preferredChannel', 'sectorId',
    ];
    for (const field of optionalStrings) {
      if (body[field] !== undefined && body[field] !== null) {
        contactData[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
      }
    }

    // Optional array: tags
    if (Array.isArray(body.tags)) {
      contactData.tags = body.tags.filter((t: unknown) => typeof t === 'string' && (t as string).trim());
    }

    // Optional object: socialMedia
    if (body.socialMedia && typeof body.socialMedia === 'object') {
      contactData.socialMedia = body.socialMedia;
    }

    // Optional object: channelIdentities
    if (body.channelIdentities && typeof body.channelIdentities === 'object') {
      contactData.channelIdentities = body.channelIdentities;
    }

    // Optional object: customFields
    if (body.customFields && typeof body.customFields === 'object') {
      contactData.customFields = body.customFields;
    }

    // Optional boolean: optInMarketing
    if (typeof body.optInMarketing === 'boolean') {
      contactData.optInMarketing = body.optInMarketing;
      if (body.optInMarketing) {
        contactData.optInAt = now;
      }
    }

    const docRef = await adminDb.collection('crmContacts').add(contactData);

    return apiSuccess(
      { id: docRef.id, ...contactData },
      201,
    );
  } catch (err) {
    console.error('[API] POST /api/v1/crm/contacts error:', err);
    return apiError('Failed to create contact', 500);
  }
}

// =============================================================================
// PUT /api/v1/crm/contacts — Update an existing CRM contact
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
    const docRef = adminDb.collection('crmContacts').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Contact not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Contact not found', 404);
    }

    // Remove protected fields from the update payload
    delete updateFields.businessId;
    delete updateFields.id;

    if (Object.keys(updateFields).length === 0) {
      return apiError('No fields to update — provide at least one field besides "id"', 400);
    }

    // Validate enum fields if provided
    if (updateFields.status && !VALID_STATUSES.includes(updateFields.status)) {
      return apiError(`Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`, 400);
    }
    if (updateFields.source && !VALID_SOURCES.includes(updateFields.source)) {
      return apiError(`Invalid source. Allowed: ${VALID_SOURCES.join(', ')}`, 400);
    }

    updateFields.updatedAt = new Date().toISOString();

    await docRef.update(updateFields);

    const updatedSnap = await docRef.get();

    return apiSuccess({
      id: updatedSnap.id,
      ...updatedSnap.data(),
    });
  } catch (err) {
    console.error('[API] PUT /api/v1/crm/contacts error:', err);
    return apiError('Failed to update contact', 500);
  }
}

// =============================================================================
// DELETE /api/v1/crm/contacts?id=xxx — Delete a CRM contact
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
    const docRef = adminDb.collection('crmContacts').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Contact not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Contact not found', 404);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (err) {
    console.error('[API] DELETE /api/v1/crm/contacts error:', err);
    return apiError('Failed to delete contact', 500);
  }
}
