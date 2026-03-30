import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';

// =============================================================================
// GET /api/v1/conversations/messages — List messages for a conversation
// =============================================================================
export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req, ['read:conversations']);
  if (isApiKeyError(auth)) return auth;

  try {
    const { searchParams } = req.nextUrl;

    const conversationId = searchParams.get('conversationId');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    if (!conversationId) {
      return apiError('Query parameter "conversationId" is required', 400);
    }

    // Verify the conversation exists and belongs to this business
    const convRef = adminDb.collection('conversations').doc(conversationId);
    const convSnap = await convRef.get();

    if (!convSnap.exists) {
      return apiError('Conversation not found', 404);
    }

    if (convSnap.data()?.businessId !== auth.businessId) {
      return apiError('Conversation not found', 404);
    }

    // Fetch messages for this conversation, filtered by businessId
    const snapshot = await adminDb
      .collection('conversationMessages')
      .where('businessId', '==', auth.businessId)
      .where('conversationId', '==', conversationId)
      .orderBy('sentAt', 'desc')
      .get();

    const total = snapshot.docs.length;

    // Apply pagination
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = snapshot.docs.slice(offset, offset + limit).map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return apiSuccess({
      messages,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('[API] GET /api/v1/conversations/messages error:', err);
    return apiError('Failed to fetch messages', 500);
  }
}
