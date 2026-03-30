import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

// =============================================================================
// GET /api/v1/conversations — List conversations for the authenticated business
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:conversations']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;

    const channel = searchParams.get('channel');
    const status = searchParams.get('status');
    const search = searchParams.get('search')?.toLowerCase().trim() || '';
    const assignedTo = searchParams.get('assignedTo');
    const priority = searchParams.get('priority');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    // Validate channel
    if (channel && !['whatsapp', 'facebook', 'instagram'].includes(channel)) {
      return apiError('Invalid channel. Allowed: whatsapp, facebook, instagram', 400);
    }

    // Validate status
    if (status && !['open', 'waiting', 'resolved'].includes(status)) {
      return apiError('Invalid status. Allowed: open, waiting, resolved', 400);
    }

    // Validate priority
    if (priority && !['low', 'medium', 'high', 'urgent'].includes(priority)) {
      return apiError('Invalid priority. Allowed: low, medium, high, urgent', 400);
    }

    // Build Firestore query — always filter by businessId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = adminDb
      .collection('conversations')
      .where('businessId', '==', auth.businessId);

    // Apply Firestore-level filters
    if (channel) {
      query = query.where('channel', '==', channel);
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    if (assignedTo) {
      query = query.where('assignedTo', '==', assignedTo);
    }

    if (priority) {
      query = query.where('priority', '==', priority);
    }

    query = query.orderBy('lastMessageAt', 'desc');

    const snapshot = await query.get();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let conversations = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Apply text search filter in-memory (case-insensitive contains on contactName)
    if (search) {
      conversations = conversations.filter((conv: Record<string, unknown>) => {
        const contactName = ((conv.contactName as string) || '').toLowerCase();
        const contactPhone = ((conv.contactPhone as string) || '').toLowerCase();
        return contactName.includes(search) || contactPhone.includes(search);
      });
    }

    const total = conversations.length;

    // Apply pagination
    const paginated = conversations.slice(offset, offset + limit);

    return apiSuccess({
      conversations: paginated,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/conversations error:', err);
    return apiError('Failed to fetch conversations', 500);
  }
}

// =============================================================================
// PUT /api/v1/conversations — Update an existing conversation
// =============================================================================
export async function PUT(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:conversations']);
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
    const docRef = adminDb.collection('conversations').doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return apiError('Conversation not found', 404);
    }

    const existingData = docSnap.data();
    if (existingData?.businessId !== auth.businessId) {
      return apiError('Conversation not found', 404);
    }

    // Only allow specific fields to be updated
    const allowedFields = [
      'status', 'assignedTo', 'assignedToName', 'assignedToSectorId',
      'priority', 'labels', 'tags', 'isPrivate',
    ];

    const sanitized: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (updateFields[field] !== undefined) {
        sanitized[field] = updateFields[field];
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return apiError(
        `No valid fields to update. Allowed: ${allowedFields.join(', ')}`,
        400,
      );
    }

    // Validate status if provided
    if (sanitized.status && !['open', 'waiting', 'resolved'].includes(sanitized.status as string)) {
      return apiError('Invalid status. Allowed: open, waiting, resolved', 400);
    }

    // Validate priority if provided
    if (sanitized.priority && !['low', 'medium', 'high', 'urgent'].includes(sanitized.priority as string)) {
      return apiError('Invalid priority. Allowed: low, medium, high, urgent', 400);
    }

    // Validate labels if provided
    if (sanitized.labels !== undefined && !Array.isArray(sanitized.labels)) {
      return apiError('Field "labels" must be an array of strings', 400);
    }

    // Validate tags if provided
    if (sanitized.tags !== undefined && !Array.isArray(sanitized.tags)) {
      return apiError('Field "tags" must be an array of strings', 400);
    }

    // Validate isPrivate if provided
    if (sanitized.isPrivate !== undefined && typeof sanitized.isPrivate !== 'boolean') {
      return apiError('Field "isPrivate" must be a boolean', 400);
    }

    sanitized.updatedAt = new Date().toISOString();

    await docRef.update(sanitized);

    const updatedSnap = await docRef.get();

    return apiSuccess({
      id: updatedSnap.id,
      ...updatedSnap.data(),
    });
  } catch (err) {
    console.error('[API] PUT /api/v1/conversations error:', err);
    return apiError('Failed to update conversation', 500);
  }
}
