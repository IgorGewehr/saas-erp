import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyApiKey, isApiKeyError, apiError, apiSuccess } from '@/lib/middleware/apiKeyAuth';
import { checkBusinessRateLimit } from '@/lib/utils/rateLimit';

// =============================================================================
// POST /api/v1/conversations/send — Send a message via a conversation channel
// =============================================================================
export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req, ['write:conversations']);
  if (isApiKeyError(auth)) return auth;

  // Rate limit por business (5.13): 300 msgs/hora — mesma janela do internal
  // /api/conversations/send. Aplicado AQUI para evitar Firestore writes antes
  // do internal call quando atacante com API key abusa do volume.
  const bizLimit = checkBusinessRateLimit('v1-conversation-send', auth.businessId, 300, 3_600_000);
  if (!bizLimit.allowed) {
    return apiError('Rate limit exceeded for this business. Slow down.', 429);
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body — expected JSON object', 400);
    }

    const {
      conversationId,
      content,
      type = 'text',
      templateName,
      templateLanguage,
      templateParams,
      mediaUrl,
      mediaType,
      isInternal = false,
      clientMessageId,
    } = body;

    // Validate required fields
    if (!conversationId || typeof conversationId !== 'string') {
      return apiError('Field "conversationId" is required and must be a string', 400);
    }

    if (!content || typeof content !== 'string' || !content.trim()) {
      return apiError('Field "content" is required and must be a non-empty string', 400);
    }

    // Validate type
    const validTypes = ['text', 'template', 'media'];
    if (!validTypes.includes(type)) {
      return apiError(`Invalid type. Allowed: ${validTypes.join(', ')}`, 400);
    }

    // Validate template fields
    if (type === 'template') {
      if (!templateName || typeof templateName !== 'string') {
        return apiError('Field "templateName" is required for template messages', 400);
      }
      if (templateParams && !Array.isArray(templateParams)) {
        return apiError('Field "templateParams" must be an array', 400);
      }
    }

    // Validate media fields
    if (type === 'media') {
      if (!mediaUrl || typeof mediaUrl !== 'string') {
        return apiError('Field "mediaUrl" is required for media messages', 400);
      }
      if (mediaType && !['image', 'video', 'audio', 'document'].includes(mediaType)) {
        return apiError('Invalid mediaType. Allowed: image, video, audio, document', 400);
      }
    }

    // Fetch the conversation to get channel info and verify ownership
    const convRef = adminDb.collection('conversations').doc(conversationId);
    const convSnap = await convRef.get();

    if (!convSnap.exists) {
      return apiError('Conversation not found', 404);
    }

    const convData = convSnap.data()!;
    if (convData.businessId !== auth.businessId) {
      return apiError('Conversation not found', 404);
    }

    // Idempotency: if the caller reuses a clientMessageId within this business,
    // return the previously-created message instead of creating a duplicate.
    if (clientMessageId && typeof clientMessageId === 'string') {
      const existingSnap = await adminDb
        .collection('conversationMessages')
        .where('businessId', '==', auth.businessId)
        .where('clientMessageId', '==', clientMessageId)
        .limit(1)
        .get();
      if (!existingSnap.empty) {
        const existing = existingSnap.docs[0];
        const data = existing.data();
        return apiSuccess({
          messageId: existing.id,
          conversationId: data.conversationId,
          status: data.status ?? 'sent',
          externalMessageId: data.externalMessageId ?? null,
          isInternal: !!data.isInternal,
          idempotent: true,
        }, 200);
      }
    }

    const channel = convData.channel;
    const contactExternalId = convData.contactExternalId;
    const convVia = convData.connectedVia as 'embedded_signup' | 'baileys' | undefined;
    const now = new Date().toISOString();

    // Build the message document
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messageDoc: Record<string, any> = {
      conversationId,
      businessId: auth.businessId,
      channel,
      // Herda o transporte da conversation pra UI distinguir Cloud vs Baileys.
      ...(convVia && channel === 'whatsapp' ? { connectedVia: convVia } : {}),
      direction: 'outbound',
      content: content.trim(),
      status: isInternal ? 'delivered' : 'sending',
      isInternal: isInternal || false,
      sentAt: now,
      createdAt: now,
    };
    if (clientMessageId && typeof clientMessageId === 'string') {
      messageDoc.clientMessageId = clientMessageId;
    }

    // Add optional fields
    if (type === 'media' && mediaUrl) {
      messageDoc.mediaUrl = mediaUrl;
      messageDoc.mediaType = mediaType || 'document';
    }

    // Save the message document to Firestore
    const msgRef = await adminDb.collection('conversationMessages').add(messageDoc);

    // Update conversation's last message metadata
    const convUpdate: Record<string, unknown> = {
      lastMessage: isInternal ? `[Nota interna] ${content.trim().substring(0, 100)}` : content.trim().substring(0, 200),
      lastMessageAt: now,
      lastMessageDirection: 'outbound',
      updatedAt: now,
    };

    if (isInternal) {
      // Increment internal notes counter
      convUpdate.internalNotes = (convData.internalNotes || 0) + 1;
    }

    await convRef.update(convUpdate);

    // For internal notes, we're done — no external delivery needed
    if (isInternal) {
      return apiSuccess({
        messageId: msgRef.id,
        conversationId,
        status: 'delivered',
        isInternal: true,
      }, 201);
    }

    // For external messages: attempt delivery via the internal send API.
    // We call the existing /api/conversations/send endpoint which handles
    // Meta API calls (WhatsApp, Facebook, Instagram) and Baileys sessions.
    try {
      const internalPayload = {
        businessId: auth.businessId,
        conversationId,
        messageDocId: msgRef.id,
        channel,
        recipientId: contactExternalId,
        content: content.trim(),
        type,
        ...(templateName && { templateName }),
        ...(templateLanguage && { templateLanguage }),
        ...(templateParams && { templateParams }),
        ...(mediaUrl && { mediaUrl }),
        ...(mediaType && { mediaType }),
      };

      const internalRes = await fetch(new URL('/api/conversations/send', req.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(internalPayload),
      });

      const internalData = await internalRes.json();

      if (!internalRes.ok) {
        // Mark message as failed in Firestore
        await adminDb.collection('conversationMessages').doc(msgRef.id).update({
          status: 'failed',
        });

        return apiSuccess({
          messageId: msgRef.id,
          conversationId,
          status: 'failed',
          deliveryError: internalData.error || 'Failed to deliver message via channel',
          note: 'Message saved to Firestore but external delivery failed.',
        }, 201);
      }

      // Update message with external ID if returned
      if (internalData.externalMessageId) {
        await adminDb.collection('conversationMessages').doc(msgRef.id).update({
          status: 'sent',
          externalMessageId: internalData.externalMessageId,
        });
      }

      return apiSuccess({
        messageId: msgRef.id,
        conversationId,
        status: 'sent',
        externalMessageId: internalData.externalMessageId || null,
      }, 201);
    } catch (deliveryErr) {
      // If the internal API call fails entirely (network error, etc.),
      // the message is already saved with status 'sending'.
      // The existing send infrastructure or a retry mechanism can pick it up.
      console.error('[API] v1/conversations/send — delivery call failed:', deliveryErr);

      return apiSuccess({
        messageId: msgRef.id,
        conversationId,
        status: 'sending',
        note: 'Message saved to Firestore. External delivery is pending — the existing send infrastructure will handle delivery.',
      }, 201);
    }
  } catch (err) {
    console.error('[API] POST /api/v1/conversations/send error:', err);
    return apiError('Failed to send message', 500);
  }
}
