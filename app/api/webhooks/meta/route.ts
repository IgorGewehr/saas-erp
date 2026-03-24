/**
 * Meta Webhooks Handler
 *
 * Handles incoming webhooks from:
 *  - WhatsApp Business API (Cloud API)
 *  - Facebook Messenger Platform
 *  - Instagram Messaging API
 *
 * Setup no Meta Developer Dashboard:
 *  1. Callback URL: https://seu-dominio.com/api/webhooks/meta
 *  2. Verify Token: valor de META_WHATSAPP_WEBHOOK_VERIFY_TOKEN no .env
 *  3. Assine os campos: messages, messaging_postbacks (WhatsApp + Instagram)
 *     Para Facebook: messages, messaging_postbacks, message_deliveries, message_reads
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  increment,
  limit as firestoreLimit,
} from 'firebase/firestore';

// ─── Firebase init (server-side, client SDK) ─────────────────────────────────

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getDb() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MetaWebhookEntry {
  id: string;
  time: number;
  changes?: MetaWebhookChange[];
  messaging?: MetaMessagingEvent[];
}

interface MetaWebhookChange {
  field: string;
  value: {
    messaging_product?: string;
    metadata?: { display_phone_number: string; phone_number_id: string };
    contacts?: Array<{ profile: { name: string }; wa_id: string }>;
    messages?: MetaWhatsAppMessage[];
    statuses?: MetaWhatsAppStatus[];
  };
}

interface MetaWhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contacts' | 'interactive' | 'reaction' | 'button';
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type?: string; sha256?: string };
  audio?: { id: string; mime_type?: string };
  video?: { id: string; caption?: string; mime_type?: string };
  document?: { id: string; caption?: string; filename?: string; mime_type?: string };
  sticker?: { id: string; mime_type?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }>;
  reaction?: { message_id: string; emoji: string };
  button?: { text: string; payload: string };
  interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  context?: { from: string; id: string };
}

interface MetaWhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string }>;
}

interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{ type: string; payload: { url?: string } }>;
    is_deleted?: boolean;
    is_echo?: boolean;
  };
  delivery?: { mids: string[]; watermark: number };
  read?: { watermark: number };
  postback?: { title: string; payload: string; mid: string };
}

interface ExtractedContent {
  content: string;
  mediaId?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
}

interface InboundMessageParams {
  channel: 'whatsapp' | 'facebook' | 'instagram';
  channelIdentifier: string; // phoneNumberId (whatsapp) or pageId (facebook/instagram)
  externalId: string;
  senderName?: string;
  senderAvatarUrl?: string;
  messageId: string;
  content: string;
  mediaType?: 'image' | 'audio' | 'video' | 'document';
  mediaId?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  replyToMessageId?: string;
  timestamp: string;
}

// ─── GET — Webhook Verification ──────────────────────────────────────────────

/**
 * Meta verifica o webhook enviando um GET com:
 *  hub.mode = "subscribe"
 *  hub.verify_token = <seu token>
 *  hub.challenge = <string aleatória para ecoar de volta>
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.META_FACEBOOK_VERIFY_TOKEN || process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[Meta Webhook] Verification successful');
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn('[Meta Webhook] Verification failed — invalid token or mode');
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ─── Webhook Signature Verification ──────────────────────────────────────────

function verifySignatureFromBuffer(rawBuffer: Buffer, signature: string): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return false;

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(rawBuffer)
    .digest('hex');

  const expected = `sha256=${expectedHash}`;

  // Timing-safe comparison (must be same length)
  if (signature.length !== expected.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expected, 'utf8'),
    );
  } catch {
    return false;
  }
}

// ─── POST — Incoming Events ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    const { allowed } = checkRateLimit(`webhook:${clientIp}`, 200, 60_000);
    if (!allowed) {
      return NextResponse.json({ status: 'ok' }, { status: 200 });
    }

    // Read raw bytes — arrayBuffer preserves exact bytes Meta signed
    const rawBuffer = Buffer.from(await req.arrayBuffer());
    const rawBody = rawBuffer.toString('utf8');

    // Verify HMAC-SHA256 signature
    const signature = req.headers.get('x-hub-signature-256') || '';
    const isValid = verifySignatureFromBuffer(rawBuffer, signature);
    if (!isValid) {
      console.error('[Meta Webhook] Invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const body = JSON.parse(rawBody) as {
      object: string;
      entry: MetaWebhookEntry[];
    };

    const { object, entry } = body;

    if (!entry || !Array.isArray(entry)) {
      return NextResponse.json({ status: 'ok' }, { status: 200 });
    }

    for (const e of entry) {
      if (object === 'whatsapp_business_account') {
        await handleWhatsAppEvent(e);
      } else if (object === 'page') {
        await handleFacebookEvent(e);
      } else if (object === 'instagram') {
        await handleInstagramEvent(e);
      }
    }

    // Always return 200 quickly — Meta retries if you don't
    return NextResponse.json({ status: 'ok' }, { status: 200 });

  } catch (err) {
    console.error('[Meta Webhook] Error processing event:', err);
    // Still return 200 to prevent Meta from retrying indefinitely
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  }
}

// ─── WhatsApp Handler ─────────────────────────────────────────────────────────

async function handleWhatsAppEvent(entry: MetaWebhookEntry) {
  if (!entry.changes) return;

  for (const change of entry.changes) {
    if (change.field !== 'messages') continue;

    const { value } = change;
    const phoneNumberId = value.metadata?.phone_number_id;
    if (!phoneNumberId) continue;

    // Handle inbound messages
    if (value.messages) {
      for (const msg of value.messages) {
        const extracted = extractMessageContent(msg);
        await saveInboundMessage({
          channel: 'whatsapp',
          channelIdentifier: phoneNumberId,
          externalId: msg.from,
          senderName: value.contacts?.find(c => c.wa_id === msg.from)?.profile.name,
          messageId: msg.id,
          content: extracted.content,
          mediaType: msg.type !== 'text' ? msg.type as 'image' | 'audio' | 'video' | 'document' : undefined,
          mediaId: extracted.mediaId,
          mediaUrl: extracted.mediaUrl,
          mediaMimeType: extracted.mediaMimeType,
          replyToMessageId: msg.context?.id,
          timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        });
      }
    }

    // Handle status updates (sent -> delivered -> read)
    if (value.statuses) {
      const businessId = await resolveBusinessId(getDb(), 'whatsapp', phoneNumberId);
      if (businessId) {
        for (const status of value.statuses) {
          await updateMessageStatus({
            businessId,
            channel: 'whatsapp',
            messageId: status.id,
            status: status.status,
            timestamp: new Date(parseInt(status.timestamp) * 1000).toISOString(),
            errors: status.errors,
          });
        }
      }
    }
  }
}

// ─── Facebook Messenger Handler ───────────────────────────────────────────────

async function handleFacebookEvent(entry: MetaWebhookEntry) {
  if (!entry.messaging) return;

  const db = getDb();
  const pageId = entry.id;

  for (const event of entry.messaging) {
    // Skip echoes (messages sent by the page itself)
    if (event.message?.is_echo) continue;

    // Handle delivery receipts
    if (event.delivery) {
      const businessId = await resolveBusinessId(db, 'facebook', String(entry.id));
      if (businessId) {
        for (const mid of event.delivery.mids ?? []) {
          await updateMessageStatus({
            businessId,
            channel: 'facebook',
            messageId: mid,
            status: 'delivered',
            timestamp: new Date(event.delivery.watermark).toISOString(),
          });
        }
      }
      continue;
    }

    // Handle read receipts
    if (event.read) {
      const businessId = await resolveBusinessId(db, 'facebook', String(entry.id));
      if (businessId) {
        const readTimestamp = new Date(event.read.watermark).toISOString();
        // Find conversation for this contact
        const convQuery = query(
          collection(db, 'conversations'),
          where('businessId', '==', businessId),
          where('channel', '==', 'facebook'),
          where('contactExternalId', '==', String(event.sender.id)),
          firestoreLimit(1)
        );
        const convSnap = await getDocs(convQuery);
        if (!convSnap.empty) {
          // Mark all outbound messages before watermark as read
          const msgsQuery = query(
            collection(db, 'conversationMessages'),
            where('businessId', '==', businessId),
            where('conversationId', '==', convSnap.docs[0].id),
            where('direction', '==', 'outbound'),
            where('status', 'in', ['sent', 'delivered'])
          );
          const msgsSnap = await getDocs(msgsQuery);
          const batch: Promise<void>[] = [];
          for (const msgDoc of msgsSnap.docs) {
            const msgData = msgDoc.data();
            if (msgData.sentAt && msgData.sentAt <= readTimestamp) {
              batch.push(
                updateDoc(doc(db, 'conversationMessages', msgDoc.id), {
                  status: 'read',
                  readAt: readTimestamp,
                  ...(!msgData.deliveredAt ? { deliveredAt: readTimestamp } : {}),
                })
              );
            }
          }
          await Promise.all(batch);
        }
      }
      continue;
    }

    // Fetch sender profile (name + avatar) for any message/postback event
    let senderName: string | undefined;
    let senderAvatarUrl: string | undefined;

    if (event.message || event.postback) {
      const businessId = await resolveBusinessId(db, 'facebook', String(pageId));
      if (businessId) {
        const pageToken = await getDecryptedPageToken(db, businessId);
        if (pageToken) {
          const profile = await fetchSenderProfile(String(event.sender.id), pageToken);
          if (profile) {
            senderName = profile.name;
            senderAvatarUrl = profile.profilePic;
          }
        }
      }
      if (!senderName) senderName = 'Usuário do Facebook';
    }

    // Handle postback events
    if (event.postback) {
      await saveInboundMessage({
        channel: 'facebook',
        channelIdentifier: String(entry.id),
        externalId: String(event.sender.id),
        senderName,
        senderAvatarUrl,
        messageId: `postback_${event.timestamp}`,
        content: event.postback.title || event.postback.payload || '[Postback]',
        timestamp: new Date(event.timestamp).toISOString(),
      });
      continue;
    }

    if (event.message?.text) {
      await saveInboundMessage({
        channel: 'facebook',
        channelIdentifier: pageId,
        externalId: event.sender.id,
        senderName,
        senderAvatarUrl,
        messageId: event.message.mid,
        content: event.message.text,
        timestamp: new Date(event.timestamp).toISOString(),
      });
    } else if (event.message?.attachments && event.message.attachments.length > 0) {
      const attachment = event.message.attachments[0];
      const attachmentType = attachment.type;
      const attachmentUrl = attachment.payload?.url;

      const mediaTypeMap: Record<string, string> = {
        image: 'image', video: 'video', audio: 'audio', file: 'document', fallback: 'document'
      };

      await saveInboundMessage({
        channel: 'facebook',
        channelIdentifier: String(entry.id),
        externalId: String(event.sender.id),
        senderName,
        senderAvatarUrl,
        messageId: event.message.mid,
        content: event.message.text || `[${attachmentType === 'file' ? 'Documento' : attachmentType === 'image' ? 'Imagem' : attachmentType === 'video' ? 'Video' : attachmentType === 'audio' ? 'Audio' : 'Anexo'}]`,
        mediaType: (mediaTypeMap[attachmentType] || 'document') as 'image' | 'audio' | 'video' | 'document',
        mediaUrl: attachmentUrl,
        timestamp: new Date(event.timestamp).toISOString(),
      });
    }
  }
}

// ─── Instagram Handler ────────────────────────────────────────────────────────

async function handleInstagramEvent(entry: MetaWebhookEntry) {
  if (!entry.messaging) return;

  const db = getDb();
  const accountId = entry.id;

  for (const event of entry.messaging) {
    if (event.message?.is_echo) continue;

    // Handle delivery receipts
    if (event.delivery) {
      const businessId = await resolveBusinessId(db, 'instagram', String(entry.id));
      if (businessId && event.delivery.mids) {
        for (const mid of event.delivery.mids) {
          await updateMessageStatus({
            businessId,
            channel: 'instagram',
            messageId: mid,
            status: 'delivered',
            timestamp: new Date(event.delivery.watermark || Date.now()).toISOString(),
          });
        }
      }
      continue;
    }

    // Handle read receipts
    if (event.read) {
      const businessId = await resolveBusinessId(db, 'instagram', String(entry.id));
      if (businessId) {
        const readTimestamp = new Date(event.read.watermark).toISOString();
        // Find conversation for this contact
        const convQuery = query(
          collection(db, 'conversations'),
          where('businessId', '==', businessId),
          where('channel', '==', 'instagram'),
          where('contactExternalId', '==', String(event.sender.id)),
          firestoreLimit(1)
        );
        const convSnap = await getDocs(convQuery);
        if (!convSnap.empty) {
          // Mark all outbound messages before watermark as read
          const msgsQuery = query(
            collection(db, 'conversationMessages'),
            where('businessId', '==', businessId),
            where('conversationId', '==', convSnap.docs[0].id),
            where('direction', '==', 'outbound'),
            where('status', 'in', ['sent', 'delivered'])
          );
          const msgsSnap = await getDocs(msgsQuery);
          const batch: Promise<void>[] = [];
          for (const msgDoc of msgsSnap.docs) {
            const msgData = msgDoc.data();
            if (msgData.sentAt && msgData.sentAt <= readTimestamp) {
              batch.push(
                updateDoc(doc(db, 'conversationMessages', msgDoc.id), {
                  status: 'read',
                  readAt: readTimestamp,
                  ...(!msgData.deliveredAt ? { deliveredAt: readTimestamp } : {}),
                })
              );
            }
          }
          await Promise.all(batch);
        }
      }
      continue;
    }

    // Fetch Instagram sender profile (name + avatar) for any message/postback
    let senderName: string | undefined;
    let senderAvatarUrl: string | undefined;

    if (event.message || event.postback) {
      const businessId = await resolveBusinessId(db, 'instagram', String(accountId));
      if (businessId) {
        const pageToken = await getDecryptedPageToken(db, businessId);
        if (pageToken) {
          const profile = await fetchSenderProfile(String(event.sender.id), pageToken);
          if (profile) {
            senderName = profile.name;
            senderAvatarUrl = profile.profilePic;
          }
        }
      }
      if (!senderName) senderName = 'Usuário do Instagram';
    }

    // Handle postback events
    if (event.postback) {
      await saveInboundMessage({
        channel: 'instagram',
        channelIdentifier: String(entry.id),
        externalId: String(event.sender.id),
        senderName,
        senderAvatarUrl,
        messageId: `postback_${event.timestamp}`,
        content: event.postback.title || event.postback.payload || '[Postback]',
        timestamp: new Date(event.timestamp).toISOString(),
      });
      continue;
    }

    if (event.message?.text) {
      await saveInboundMessage({
        channel: 'instagram',
        channelIdentifier: accountId,
        externalId: event.sender.id,
        senderName,
        senderAvatarUrl,
        messageId: event.message.mid,
        content: event.message.text,
        timestamp: new Date(event.timestamp).toISOString(),
      });
    } else if (event.message?.attachments && event.message.attachments.length > 0) {
      const attachment = event.message.attachments[0];
      const attachmentType = attachment.type;
      const attachmentUrl = attachment.payload?.url;

      const mediaTypeMap: Record<string, string> = {
        image: 'image', video: 'video', audio: 'audio', file: 'document', fallback: 'document'
      };

      await saveInboundMessage({
        channel: 'instagram',
        channelIdentifier: String(entry.id),
        externalId: String(event.sender.id),
        senderName,
        senderAvatarUrl,
        messageId: event.message.mid,
        content: event.message.text || `[${attachmentType === 'file' ? 'Documento' : attachmentType === 'image' ? 'Imagem' : attachmentType === 'video' ? 'Video' : attachmentType === 'audio' ? 'Audio' : 'Anexo'}]`,
        mediaType: (mediaTypeMap[attachmentType] || 'document') as 'image' | 'audio' | 'video' | 'document',
        mediaUrl: attachmentUrl,
        timestamp: new Date(event.timestamp).toISOString(),
      });
    }
  }
}

// ─── Business Resolution ─────────────────────────────────────────────────────

/**
 * Resolves the businessId from the channel identifier (phoneNumberId or pageId).
 * Queries the businesses collection for a matching channel configuration.
 */
async function resolveBusinessId(
  db: ReturnType<typeof getFirestore>,
  channel: 'whatsapp' | 'facebook' | 'instagram',
  channelIdentifier: string,
): Promise<string | null> {
  try {
    let fieldPath: string;

    switch (channel) {
      case 'whatsapp':
        fieldPath = 'channels.whatsapp.phoneNumberId';
        break;
      case 'facebook':
        fieldPath = 'channels.facebook.pageId';
        break;
      case 'instagram':
        // Instagram uses the accountId stored in channels.instagram.accountId
        fieldPath = 'channels.instagram.accountId';
        break;
      default:
        return null;
    }

    const q = query(
      collection(db, 'businesses'),
      where(fieldPath, '==', channelIdentifier),
      firestoreLimit(1),
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      return null;
    }

    return snap.docs[0].id;
  } catch (err) {
    console.error('[Meta Webhook] Error resolving businessId:', err);
    return null;
  }
}

// ─── Profile Fetching ─────────────────────────────────────────────────────────

/**
 * Fetches sender profile (name + avatar) from Facebook/Instagram Graph API.
 * Instagram DMs use the same endpoint as Facebook — /{PSID}?fields=name,profile_pic
 */
async function fetchSenderProfile(
  senderId: string,
  pageAccessToken: string,
): Promise<{ name: string; profilePic?: string } | null> {
  try {
    const url = `https://graph.facebook.com/v21.0/${senderId}?fields=name,profile_pic&access_token=${pageAccessToken}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) {
      console.warn('[Meta Webhook] Profile fetch failed:', res.status, await res.text().catch(() => ''));
      return null;
    }

    const data = await res.json();
    return {
      name: data.name || data.first_name || senderId,
      profilePic: data.profile_pic || undefined,
    };
  } catch (err) {
    console.error('[Meta Webhook] Error fetching sender profile:', err);
    return null;
  }
}

/**
 * Gets the decrypted Facebook page access token for a business.
 * Instagram uses the same token as Facebook Messenger.
 */
async function getDecryptedPageToken(
  db: ReturnType<typeof getFirestore>,
  businessId: string,
): Promise<string | null> {
  try {
    const bizQuery = query(
      collection(db, 'businesses'),
      where('__name__', '==', businessId),
      firestoreLimit(1),
    );
    const bizSnap = await getDocs(bizQuery);
    if (bizSnap.empty) return null;

    const bizData = bizSnap.docs[0].data();
    const encryptedToken = bizData?.channels?.facebook?.pageAccessToken;
    if (!encryptedToken) return null;

    return decryptToken(encryptedToken);
  } catch (err) {
    console.error('[Meta Webhook] Error getting page token:', err);
    return null;
  }
}

// ─── Firestore Helpers ────────────────────────────────────────────────────────

/**
 * Saves an inbound message to Firestore.
 *
 * 1. Resolves the businessId from the channel identifier
 * 2. Checks for duplicate message (by externalMessageId + businessId)
 * 3. Finds or creates a Conversation document
 * 4. Adds a ConversationMessage document
 */
async function saveInboundMessage(params: InboundMessageParams) {
  console.log('[Meta Webhook] Inbound message received:', {
    channel: params.channel,
    from: params.externalId,
    content: params.content.slice(0, 50),
    timestamp: params.timestamp,
  });

  const db = getDb();

  // 1. Resolve businessId from channel identifier
  const businessId = await resolveBusinessId(db, params.channel, params.channelIdentifier);

  if (!businessId) {
    console.error('[Meta Webhook] Could not resolve businessId for', params.channel, 'identifier:', params.channelIdentifier);
    try {
      await addDoc(collection(db, 'webhookFailures'), {
        reason: 'business_not_found',
        channel: params.channel,
        channelIdentifier: params.channelIdentifier,
        externalId: params.externalId,
        messageId: params.messageId,
        content: params.content?.substring(0, 100),
        timestamp: params.timestamp,
        createdAt: new Date().toISOString(),
      });
    } catch (dlqErr) {
      console.error('[Meta Webhook] Failed to save to dead-letter queue:', dlqErr);
    }
    return;
  }

  // 2. Check for duplicate message (before touching conversation)
  try {
    const dupQuery = query(
      collection(db, 'conversationMessages'),
      where('externalMessageId', '==', params.messageId),
      where('businessId', '==', businessId),
      firestoreLimit(1)
    );
    const dupSnap = await getDocs(dupQuery);
    if (!dupSnap.empty) {
      console.log('[Meta Webhook] Duplicate message skipped:', params.messageId);
      return;
    }
  } catch (dupErr) {
    console.error('[Meta Webhook] Error checking for duplicate:', dupErr);
    // Continue processing — better to risk a duplicate than to lose a message
  }

  const now = new Date().toISOString();

  try {
    // 3. Find or create conversation
    const convQuery = query(
      collection(db, 'conversations'),
      where('businessId', '==', businessId),
      where('channel', '==', params.channel),
      where('contactExternalId', '==', params.externalId),
      firestoreLimit(1),
    );

    const convSnap = await getDocs(convQuery);
    let conversationId: string;

    if (convSnap.empty) {
      // Create new conversation
      const newConvRef = await addDoc(collection(db, 'conversations'), {
        businessId,
        channel: params.channel,
        contactName: params.senderName ?? params.externalId,
        contactExternalId: params.externalId,
        ...(params.senderAvatarUrl ? { contactAvatarUrl: params.senderAvatarUrl } : {}),
        status: 'open',
        lastMessage: params.content,
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      conversationId = newConvRef.id;

      // Auto-link to CRM contact if one exists with matching channel identity
      try {
        const channelField = params.channel === 'whatsapp'
          ? 'channelIdentities.whatsapp'
          : params.channel === 'facebook'
          ? 'channelIdentities.facebook'
          : 'channelIdentities.instagram';

        const contactQuery = query(
          collection(db, 'crmContacts'),
          where('businessId', '==', businessId),
          where(channelField, '==', params.externalId),
          firestoreLimit(1),
        );
        const contactSnap = await getDocs(contactQuery);

        if (!contactSnap.empty) {
          const contact = contactSnap.docs[0];
          const contactData = contact.data();
          // Update conversation with CRM contact reference
          await updateDoc(doc(db, 'conversations', conversationId), {
            crmContactId: contact.id,
            contactName: contactData.name || params.senderName || params.externalId,
            contactPhone: contactData.phone || (params.channel === 'whatsapp' ? params.externalId : null),
          });
          // Update CRM contact with last conversation reference
          await updateDoc(doc(db, 'crmContacts', contact.id), {
            lastConversationId: conversationId,
            lastConversationAt: now,
            updatedAt: now,
          });
          console.log('[Meta Webhook] Linked conversation to CRM contact:', contact.id);
        } else {
          // Also try matching by phone for WhatsApp
          if (params.channel === 'whatsapp') {
            const phoneQuery = query(
              collection(db, 'crmContacts'),
              where('businessId', '==', businessId),
              where('phone', '==', params.externalId),
              firestoreLimit(1),
            );
            const phoneSnap = await getDocs(phoneQuery);
            if (!phoneSnap.empty) {
              const contact = phoneSnap.docs[0];
              const contactData = contact.data();
              await updateDoc(doc(db, 'conversations', conversationId), {
                crmContactId: contact.id,
                contactName: contactData.name || params.senderName || params.externalId,
                contactPhone: params.externalId,
              });
              await updateDoc(doc(db, 'crmContacts', contact.id), {
                lastConversationId: conversationId,
                lastConversationAt: now,
                'channelIdentities.whatsapp': params.externalId,
                updatedAt: now,
              });
              console.log('[Meta Webhook] Linked conversation to CRM contact by phone:', contact.id);
            }
          }
        }
      } catch (linkErr) {
        // Non-fatal — don't break message processing if CRM link fails
        console.warn('[Meta Webhook] Failed to auto-link CRM contact:', linkErr);
      }

      console.log('[Meta Webhook] Created new conversation:', conversationId);
    } else {
      // Update existing conversation
      conversationId = convSnap.docs[0].id;
      const convRef = doc(db, 'conversations', conversationId);

      const existingData = convSnap.docs[0].data();
      const enrichUpdate: Record<string, unknown> = {
        lastMessage: params.content,
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: increment(1),
        updatedAt: now,
      };
      // Enrich name if current is just the numeric ID
      if (params.senderName && (!existingData.contactName || /^\d+$/.test(existingData.contactName))) {
        enrichUpdate.contactName = params.senderName;
      }
      // Enrich avatar if missing
      if (params.senderAvatarUrl && !existingData.contactAvatarUrl) {
        enrichUpdate.contactAvatarUrl = params.senderAvatarUrl;
      }
      await updateDoc(convRef, enrichUpdate);

      console.log('[Meta Webhook] Updated conversation:', conversationId);

      // Auto-link to CRM if not already linked
      const existingConvData = convSnap.docs[0].data();
      if (!existingConvData.crmContactId) {
        try {
          const channelField = params.channel === 'whatsapp'
            ? 'channelIdentities.whatsapp'
            : params.channel === 'facebook'
            ? 'channelIdentities.facebook'
            : 'channelIdentities.instagram';

          const contactQuery = query(
            collection(db, 'crmContacts'),
            where('businessId', '==', businessId),
            where(channelField, '==', params.externalId),
            firestoreLimit(1),
          );
          const contactSnap = await getDocs(contactQuery);

          if (!contactSnap.empty) {
            const contact = contactSnap.docs[0];
            await updateDoc(doc(db, 'conversations', conversationId), {
              crmContactId: contact.id,
            });
            await updateDoc(doc(db, 'crmContacts', contact.id), {
              lastConversationId: conversationId,
              lastConversationAt: now,
              updatedAt: now,
            });
          }
        } catch {
          // Non-fatal
        }
      }
    }

    // 4. Save message document (Firestore rejects undefined values)
    const msgDoc: Record<string, unknown> = {
      conversationId,
      businessId,
      channel: params.channel,
      direction: 'inbound',
      content: params.content,
      status: 'delivered',
      externalMessageId: params.messageId,
      senderName: params.senderName || params.externalId,
      sentAt: params.timestamp,
      createdAt: now,
    };
    if (params.mediaType) msgDoc.mediaType = params.mediaType;
    if (params.mediaId) msgDoc.mediaId = params.mediaId;
    if (params.mediaUrl) msgDoc.mediaUrl = params.mediaUrl;
    if (params.mediaMimeType) msgDoc.mediaMimeType = params.mediaMimeType;
    if (params.replyToMessageId) msgDoc.replyToMessageId = params.replyToMessageId;
    if (params.senderAvatarUrl) msgDoc.senderAvatarUrl = params.senderAvatarUrl;
    await addDoc(collection(db, 'conversationMessages'), msgDoc);

    console.log('[Meta Webhook] Saved inbound message for conversation:', conversationId);
  } catch (err) {
    console.error('[Meta Webhook] Error saving inbound message:', err);
  }
}

/**
 * Updates an outbound message's status in Firestore.
 * Status flow: sending -> sent -> delivered -> read
 */
const STATUS_ORDER: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };

async function updateMessageStatus(params: {
  businessId: string;
  channel: 'whatsapp' | 'facebook' | 'instagram';
  messageId: string;
  status: string;
  timestamp: string;
  errors?: Array<{ code: number; title: string }>;
}) {
  console.log('[Meta Webhook] Status update:', params);

  const db = getDb();

  try {
    const msgQuery = query(
      collection(db, 'conversationMessages'),
      where('externalMessageId', '==', params.messageId),
      where('businessId', '==', params.businessId),
      firestoreLimit(1),
    );

    const msgSnap = await getDocs(msgQuery);

    if (msgSnap.empty) {
      // Not an error — could be a status update for a message we didn't send through our system
      console.log('[Meta Webhook] No message found for externalMessageId:', params.messageId);
      return;
    }

    const msgDoc = msgSnap.docs[0];
    const currentData = msgDoc.data();
    const msgRef = doc(db, 'conversationMessages', msgDoc.id);

    // Status regression guard — don't go backwards (except 'failed' which always applies)
    const currentStatus = currentData.status;
    const currentOrder = STATUS_ORDER[currentStatus] ?? -1;
    const newOrder = STATUS_ORDER[params.status] ?? -1;

    if (params.status !== 'failed' && newOrder <= currentOrder) {
      return; // Skip — current status is already at or beyond new status
    }

    const updateData: Record<string, string | number> = {
      status: params.status,
    };

    // Add timestamp fields for specific statuses
    if (params.status === 'delivered') {
      updateData.deliveredAt = params.timestamp;
    }
    if (params.status === 'read') {
      updateData.readAt = params.timestamp;
      // Also set deliveredAt if not already set (read implies delivered)
      if (!currentData.deliveredAt) {
        updateData.deliveredAt = params.timestamp;
      }
    }

    // Save error details when status is 'failed'
    if (params.status === 'failed' && params.errors?.length) {
      updateData.failedReason = params.errors[0].title;
      updateData.failedCode = params.errors[0].code;
    }

    await updateDoc(msgRef, updateData);

    console.log('[Meta Webhook] Updated message status:', msgDoc.id, '->', params.status);

    // If the message was read, also update the conversation timestamp
    if (params.status === 'read') {
      if (currentData.conversationId) {
        try {
          const convRef = doc(db, 'conversations', currentData.conversationId);
          await updateDoc(convRef, {
            updatedAt: new Date().toISOString(),
          });
        } catch {
          // Non-critical
        }
      }
    }
  } catch (err) {
    console.error('[Meta Webhook] Error updating message status:', err);
  }
}

// ─── Content Extraction ──────────────────────────────────────────────────────

function extractMessageContent(msg: MetaWhatsAppMessage): ExtractedContent {
  switch (msg.type) {
    case 'text':
      return { content: msg.text?.body ?? '' };
    case 'image':
      return {
        content: msg.image?.caption ?? '[Imagem]',
        mediaId: msg.image?.id,
        mediaMimeType: msg.image?.mime_type,
      };
    case 'audio':
      return {
        content: '[Audio]',
        mediaId: msg.audio?.id,
        mediaMimeType: msg.audio?.mime_type,
      };
    case 'video':
      return {
        content: msg.video?.caption ?? '[Video]',
        mediaId: msg.video?.id,
        mediaMimeType: msg.video?.mime_type,
      };
    case 'document':
      return {
        content: msg.document?.caption ?? msg.document?.filename ?? '[Documento]',
        mediaId: msg.document?.id,
        mediaMimeType: msg.document?.mime_type,
        mediaUrl: undefined,
      };
    case 'sticker':
      return { content: '[Sticker]', mediaId: msg.sticker?.id };
    case 'location':
      return { content: `[Localizacao: ${msg.location?.latitude}, ${msg.location?.longitude}]` };
    case 'contacts':
      return { content: '[Contato]' };
    case 'reaction':
      return { content: msg.reaction?.emoji ?? '[Reacao]' };
    case 'button':
      return { content: msg.button?.text ?? '[Botao]' };
    case 'interactive':
      return { content: msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[Interativo]' };
    default:
      return { content: `[${msg.type || 'unknown'}]` };
  }
}
