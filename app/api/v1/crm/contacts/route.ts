import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

const VALID_STATUSES = ['novo', 'contatado', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido'];
const VALID_SOURCES = ['site', 'indicacao', 'whatsapp', 'instagram', 'facebook', 'google_ads', 'linkedin', 'evento', 'email', 'telefone', 'outro'];
const VALID_PROFILES = ['vip', 'regular', 'sporadic', 'new', 'at_risk', 'churned'];
const VALID_TONES = ['satisfied', 'neutral', 'irritated'];
const VALID_SENSITIVITIES = ['low', 'medium', 'high'];
const VALID_TIPOS = ['pf', 'pj'];
const VALID_GENDERS = ['M', 'F', 'O'];
const VALID_INDICADOR_IE = ['1', '2', '9'];
const VALID_SORT_FIELDS = ['name', 'createdAt', 'totalSpent'];

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
    const profile = searchParams.get('profile');
    const tipo = searchParams.get('tipo');
    const active = searchParams.get('active');
    const search = searchParams.get('search')?.toLowerCase().trim() || '';
    const tagsParam = searchParams.get('tags');
    const assignedTo = searchParams.get('assignedTo');
    const lifecycleStage = searchParams.get('lifecycleStage');
    const sectorId = searchParams.get('sectorId');
    const minChurnRisk = searchParams.get('minChurnRisk');
    const sort = searchParams.get('sort') || 'createdAt';
    const order = searchParams.get('order') || 'desc';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Validate enum filters
    if (status && !VALID_STATUSES.includes(status)) {
      return apiError(`Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`, 400);
    }
    if (source && !VALID_SOURCES.includes(source)) {
      return apiError(`Invalid source. Allowed: ${VALID_SOURCES.join(', ')}`, 400);
    }
    if (profile && !VALID_PROFILES.includes(profile)) {
      return apiError(`Invalid profile. Allowed: ${VALID_PROFILES.join(', ')}`, 400);
    }
    if (tipo && !VALID_TIPOS.includes(tipo)) {
      return apiError(`Invalid tipo. Allowed: ${VALID_TIPOS.join(', ')}`, 400);
    }
    if (active && !['true', 'false'].includes(active)) {
      return apiError('Invalid active filter. Allowed: true, false', 400);
    }
    if (!VALID_SORT_FIELDS.includes(sort)) {
      return apiError(`Invalid sort field. Allowed: ${VALID_SORT_FIELDS.join(', ')}`, 400);
    }
    if (!['asc', 'desc'].includes(order)) {
      return apiError('Invalid order. Allowed: asc, desc', 400);
    }

    // Build Firestore query — always filter by businessId
    let query: FirebaseFirestore.Query = adminDb
      .collection('clients')
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
    if (profile) {
      query = query.where('profile', '==', profile);
    }
    if (tipo) {
      query = query.where('tipo', '==', tipo);
    }
    if (active) {
      query = query.where('isActive', '==', active === 'true');
    }

    query = query.orderBy(sort, order as FirebaseFirestore.OrderByDirection);

    const snapshot = await query.get();

    let contacts = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Filter by minimum churn risk in-memory (nested field)
    if (minChurnRisk) {
      const minRisk = parseInt(minChurnRisk, 10);
      if (!isNaN(minRisk)) {
        contacts = contacts.filter((c) => {
          const scores = (c as Record<string, unknown>).scores as Record<string, unknown> | undefined;
          return scores && typeof scores.churnRisk === 'number' && scores.churnRisk >= minRisk;
        });
      }
    }

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
    if (body.tipo && !VALID_TIPOS.includes(body.tipo)) {
      return apiError(`Invalid tipo. Allowed: ${VALID_TIPOS.join(', ')}`, 400);
    }
    if (body.gender && !VALID_GENDERS.includes(body.gender)) {
      return apiError(`Invalid gender. Allowed: ${VALID_GENDERS.join(', ')}`, 400);
    }
    if (body.indicadorIE && !VALID_INDICADOR_IE.includes(body.indicadorIE)) {
      return apiError(`Invalid indicadorIE. Allowed: ${VALID_INDICADOR_IE.join(', ')}`, 400);
    }

    const now = new Date().toISOString();

    const contactData: Record<string, unknown> = {
      businessId: auth.businessId,
      name: name.trim(),
      source: body.source || 'outro',
      status: body.status || 'novo',
      score: typeof body.score === 'number' ? body.score : 0,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
      totalSpent: typeof body.totalSpent === 'number' ? body.totalSpent : 0,
      visitCount: typeof body.visitCount === 'number' ? body.visitCount : 0,
      createdAt: now,
      updatedAt: now,
    };

    // Optional string fields
    const optionalStrings = [
      'email', 'phone', 'whatsapp', 'company', 'role',
      'assignedTo', 'assignedToName', 'notes', 'clientId',
      'lifecycleStage', 'preferredChannel', 'sectorId',
      'suggestedAction', 'aiSummary',
      'tipo', 'cpfCnpj', 'phone2', 'birthDate', 'gender', 'nomeFantasia',
      'inscricaoEstadual', 'indicadorIE', 'inscricaoMunicipal', 'suframa',
    ];
    for (const field of optionalStrings) {
      if (body[field] !== undefined && body[field] !== null) {
        contactData[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
      }
    }

    // Optional enum: profile
    if (body.profile) {
      if (!VALID_PROFILES.includes(body.profile)) {
        return apiError(`Invalid profile. Allowed: ${VALID_PROFILES.join(', ')}`, 400);
      }
      contactData.profile = body.profile;
    }

    // Optional array: tags
    if (Array.isArray(body.tags)) {
      contactData.tags = body.tags.filter((t: unknown) => typeof t === 'string' && (t as string).trim());
    }

    // Optional object: socialMedia
    if (body.socialMedia && typeof body.socialMedia === 'object') {
      contactData.socialMedia = body.socialMedia;
    }

    // Optional object: endereco (address)
    if (body.endereco && typeof body.endereco === 'object') {
      contactData.endereco = body.endereco;
    }

    // Optional object: channelIdentities
    if (body.channelIdentities && typeof body.channelIdentities === 'object') {
      contactData.channelIdentities = body.channelIdentities;
    }

    // Optional object: customFields
    if (body.customFields && typeof body.customFields === 'object') {
      contactData.customFields = body.customFields;
    }

    // Optional object: scores (loyalty, value, churnRisk, engagement, overall — 0-100)
    if (body.scores && typeof body.scores === 'object') {
      const s = body.scores;
      contactData.scores = {
        loyalty: typeof s.loyalty === 'number' ? Math.min(100, Math.max(0, s.loyalty)) : 0,
        value: typeof s.value === 'number' ? Math.min(100, Math.max(0, s.value)) : 0,
        churnRisk: typeof s.churnRisk === 'number' ? Math.min(100, Math.max(0, s.churnRisk)) : 0,
        engagement: typeof s.engagement === 'number' ? Math.min(100, Math.max(0, s.engagement)) : 0,
        overall: typeof s.overall === 'number' ? Math.min(100, Math.max(0, s.overall)) : 0,
        lastCalculatedAt: now,
      };
    }

    // Optional object: relationshipHistory
    if (body.relationshipHistory && typeof body.relationshipHistory === 'object') {
      contactData.relationshipHistory = body.relationshipHistory;
    }

    // Optional object: behavioralInsights
    if (body.behavioralInsights && typeof body.behavioralInsights === 'object') {
      const bi = body.behavioralInsights;
      if (bi.conversationTone && !VALID_TONES.includes(bi.conversationTone)) {
        return apiError(`Invalid conversationTone. Allowed: ${VALID_TONES.join(', ')}`, 400);
      }
      if (bi.priceSensitivity && !VALID_SENSITIVITIES.includes(bi.priceSensitivity)) {
        return apiError(`Invalid priceSensitivity. Allowed: ${VALID_SENSITIVITIES.join(', ')}`, 400);
      }
      contactData.behavioralInsights = bi;
    }

    // Optional boolean: optInMarketing
    if (typeof body.optInMarketing === 'boolean') {
      contactData.optInMarketing = body.optInMarketing;
      if (body.optInMarketing) {
        contactData.optInAt = now;
      }
    }

    const docRef = await adminDb.collection('clients').add(contactData);

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
    const docRef = adminDb.collection('clients').doc(id);
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
    const docRef = adminDb.collection('clients').doc(id);
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
