import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

const VALID_STATUSES = new Set(['draft', 'scheduled', 'sending', 'sent', 'paused', 'failed']);
const VALID_CHANNELS = new Set(['whatsapp', 'facebook', 'instagram']);

// =============================================================================
// GET /api/v1/broadcasts — List broadcasts
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:broadcasts']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const status = searchParams.get('status');
    const channel = searchParams.get('channel');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Validate status if provided
    if (status && !VALID_STATUSES.has(status)) {
      return apiError(`Invalid status "${status}". Valid values: ${[...VALID_STATUSES].join(', ')}`, 400);
    }

    // Validate channel if provided
    if (channel && !VALID_CHANNELS.has(channel)) {
      return apiError(`Invalid channel "${channel}". Valid values: ${[...VALID_CHANNELS].join(', ')}`, 400);
    }

    // Build Firestore query — always filter by businessId
    let query: FirebaseFirestore.Query = adminDb
      .collection('broadcasts')
      .where('businessId', '==', auth.businessId);

    if (status) {
      query = query.where('status', '==', status);
    }

    if (channel) {
      query = query.where('channel', '==', channel);
    }

    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();
    const broadcasts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    const total = broadcasts.length;
    const paginated = broadcasts.slice(offset, offset + limit);

    return apiSuccess({
      broadcasts: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/broadcasts error:', err);
    return apiError('Failed to fetch broadcasts', 500);
  }
}

// =============================================================================
// POST /api/v1/broadcasts — Create a new broadcast
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:broadcasts']);
  if (isApiKeyError(auth)) return auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const { name, channel } = body;

    // Validate required fields
    if (!name || typeof name !== 'string' || !name.trim()) {
      return apiError('Field "name" is required and must be a non-empty string', 400);
    }

    if (!channel || !VALID_CHANNELS.has(channel)) {
      return apiError(`Field "channel" is required. Valid values: ${[...VALID_CHANNELS].join(', ')}`, 400);
    }

    // Validate optional audienceType
    const validAudienceTypes = ['all_contacts', 'segment', 'tags', 'manual'];
    if (body.audienceType && !validAudienceTypes.includes(body.audienceType)) {
      return apiError(`Invalid audienceType. Valid values: ${validAudienceTypes.join(', ')}`, 400);
    }

    // Validate optional messageType
    const validMessageTypes = ['text', 'template', 'image', 'document'];
    if (body.messageType && !validMessageTypes.includes(body.messageType)) {
      return apiError(`Invalid messageType. Valid values: ${validMessageTypes.join(', ')}`, 400);
    }

    const now = new Date().toISOString();

    const broadcastData: Record<string, unknown> = {
      businessId: auth.businessId,
      name: name.trim(),
      channel,
      audienceType: body.audienceType || 'all_contacts',
      messageType: body.messageType || 'text',
      status: 'draft',
      stats: {
        total: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        replied: 0,
      },
      createdBy: 'api',
      createdByName: 'API',
      createdAt: now,
      updatedAt: now,
    };

    // Optional fields
    if (body.audienceSegmentId) broadcastData.audienceSegmentId = body.audienceSegmentId;
    if (Array.isArray(body.audienceTags)) broadcastData.audienceTags = body.audienceTags;
    if (Array.isArray(body.audienceContactIds)) broadcastData.audienceContactIds = body.audienceContactIds;
    if (body.templateName) broadcastData.templateName = body.templateName;
    if (body.templateLanguage) broadcastData.templateLanguage = body.templateLanguage;
    if (Array.isArray(body.templateParams)) broadcastData.templateParams = body.templateParams;
    if (body.messageContent) broadcastData.messageContent = body.messageContent;
    if (body.scheduledAt) broadcastData.scheduledAt = body.scheduledAt;
    if (body.sendRate !== undefined) broadcastData.sendRate = body.sendRate;

    const docRef = await adminDb.collection('broadcasts').add(broadcastData);

    return apiSuccess({ id: docRef.id, ...broadcastData }, 201);
  } catch (err) {
    console.error('[API] POST /api/v1/broadcasts error:', err);
    return apiError('Failed to create broadcast', 500);
  }
}

// =============================================================================
// PUT /api/v1/broadcasts — Update an existing broadcast (only if draft)
// =============================================================================
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:broadcasts']);
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
    const docRef = adminDb.collection('broadcasts').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Broadcast not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Broadcast not found', 404);
    }

    // Only allow editing drafts
    if (existingData?.status !== 'draft') {
      return apiError('Only broadcasts with status "draft" can be updated', 400);
    }

    // Remove protected fields
    delete updateFields.businessId;
    delete updateFields.id;
    delete updateFields.createdAt;
    delete updateFields.createdBy;
    delete updateFields.createdByName;

    if (Object.keys(updateFields).length === 0) {
      return apiError('No fields to update — provide at least one field besides "id"', 400);
    }

    // Validate channel if provided
    if (updateFields.channel && !VALID_CHANNELS.has(updateFields.channel)) {
      return apiError(`Invalid channel. Valid values: ${[...VALID_CHANNELS].join(', ')}`, 400);
    }

    updateFields.updatedAt = new Date().toISOString();

    await docRef.update(updateFields);

    const updatedSnap = await docRef.get();

    return apiSuccess({ id: updatedSnap.id, ...updatedSnap.data() });
  } catch (err) {
    console.error('[API] PUT /api/v1/broadcasts error:', err);
    return apiError('Failed to update broadcast', 500);
  }
}

// =============================================================================
// DELETE /api/v1/broadcasts?id=xxx — Delete a broadcast (only if draft)
// =============================================================================
export async function DELETE(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:broadcasts']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return apiError('Query parameter "id" is required', 400);
    }

    // Verify the document exists and belongs to this business
    const docRef = adminDb.collection('broadcasts').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Broadcast not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Broadcast not found', 404);
    }

    // Only allow deleting drafts
    if (existingData?.status !== 'draft') {
      return apiError('Only broadcasts with status "draft" can be deleted', 400);
    }

    await docRef.delete();

    return apiSuccess({ id, deleted: true });
  } catch (err) {
    console.error('[API] DELETE /api/v1/broadcasts error:', err);
    return apiError('Failed to delete broadcast', 500);
  }
}
