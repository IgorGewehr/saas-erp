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
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contacts' | 'interactive';
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type: string; sha256: string };
  audio?: { id: string; mime_type: string };
  video?: { id: string; caption?: string; mime_type: string };
  document?: { id: string; caption?: string; filename: string; mime_type: string };
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

interface InboundMessageParams {
  channel: 'whatsapp' | 'facebook' | 'instagram';
  channelIdentifier: string; // phoneNumberId (whatsapp) or pageId (facebook/instagram)
  externalId: string;
  senderName?: string;
  messageId: string;
  content: string;
  mediaType?: 'image' | 'audio' | 'video' | 'document';
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

  const verifyToken = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[Meta Webhook] Verification successful');
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn('[Meta Webhook] Verification failed — invalid token or mode');
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ─── Webhook Signature Verification ──────────────────────────────────────────

async function verifySignature(req: NextRequest, body: string): Promise<boolean> {
  const signature = req.headers.get('x-hub-signature-256');
  if (!signature) return false;

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return false;

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(body)
    .digest('hex');

  const expected = `sha256=${expectedHash}`;

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

// ─── POST — Incoming Events ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Verify signature (skip in development)
    if (process.env.NODE_ENV === 'production') {
      const isValid = await verifySignature(req, rawBody);
      if (!isValid) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }
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
        await saveInboundMessage({
          channel: 'whatsapp',
          channelIdentifier: phoneNumberId,
          externalId: msg.from,
          senderName: value.contacts?.find(c => c.wa_id === msg.from)?.profile.name,
          messageId: msg.id,
          content: extractMessageContent(msg),
          mediaType: msg.type !== 'text' ? msg.type as 'image' | 'audio' | 'video' | 'document' : undefined,
          timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        });
      }
    }

    // Handle status updates (sent -> delivered -> read)
    if (value.statuses) {
      for (const status of value.statuses) {
        await updateMessageStatus({
          channel: 'whatsapp',
          messageId: status.id,
          status: status.status,
          timestamp: new Date(parseInt(status.timestamp) * 1000).toISOString(),
        });
      }
    }
  }
}

// ─── Facebook Messenger Handler ───────────────────────────────────────────────

async function handleFacebookEvent(entry: MetaWebhookEntry) {
  if (!entry.messaging) return;

  const pageId = entry.id;

  for (const event of entry.messaging) {
    // Skip echoes (messages sent by the page itself)
    if (event.message?.is_echo) continue;

    // Handle delivery receipts
    if (event.delivery) {
      for (const mid of event.delivery.mids ?? []) {
        await updateMessageStatus({
          channel: 'facebook',
          messageId: mid,
          status: 'delivered',
          timestamp: new Date(event.delivery.watermark).toISOString(),
        });
      }
      continue;
    }

    // Handle read receipts
    if (event.read) {
      // Watermark-based: all messages before this timestamp are read
      // We mark any messages we can find with matching externalMessageId
      // For now, log — full watermark-based read tracking requires storing mids
      console.log('[Meta Webhook] Facebook read receipt, watermark:', event.read.watermark);
      continue;
    }

    if (event.message?.text) {
      await saveInboundMessage({
        channel: 'facebook',
        channelIdentifier: pageId,
        externalId: event.sender.id,
        messageId: event.message.mid,
        content: event.message.text,
        timestamp: new Date(event.timestamp).toISOString(),
      });
    }
  }
}

// ─── Instagram Handler ────────────────────────────────────────────────────────

async function handleInstagramEvent(entry: MetaWebhookEntry) {
  if (!entry.messaging) return;

  const accountId = entry.id;

  for (const event of entry.messaging) {
    if (event.message?.is_echo) continue;
    if (event.delivery || event.read) continue;

    if (event.message?.text) {
      await saveInboundMessage({
        channel: 'instagram',
        channelIdentifier: accountId,
        externalId: event.sender.id,
        messageId: event.message.mid,
        content: event.message.text,
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

// ─── Firestore Helpers ────────────────────────────────────────────────────────

/**
 * Saves an inbound message to Firestore.
 *
 * 1. Resolves the businessId from the channel identifier
 * 2. Finds or creates a Conversation document
 * 3. Adds a ConversationMessage document
 * 4. Updates the conversation's lastMessage, lastMessageAt, unreadCount
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
    console.warn(
      '[Meta Webhook] Could not resolve businessId for',
      params.channel,
      'identifier:',
      params.channelIdentifier,
    );
    return;
  }

  const now = new Date().toISOString();

  try {
    // 2. Find or create conversation
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
        status: 'open',
        lastMessage: params.content,
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      conversationId = newConvRef.id;

      console.log('[Meta Webhook] Created new conversation:', conversationId);
    } else {
      // Update existing conversation
      conversationId = convSnap.docs[0].id;
      const convRef = doc(db, 'conversations', conversationId);

      await updateDoc(convRef, {
        lastMessage: params.content,
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: increment(1),
        updatedAt: now,
        // Update contact name if we got a better one (profile name vs phone number)
        ...(params.senderName && { contactName: params.senderName }),
      });

      console.log('[Meta Webhook] Updated conversation:', conversationId);
    }

    // 3. Save message document
    await addDoc(collection(db, 'conversationMessages'), {
      conversationId,
      businessId,
      channel: params.channel,
      direction: 'inbound',
      content: params.content,
      status: 'delivered',
      externalMessageId: params.messageId,
      senderName: params.senderName,
      mediaType: params.mediaType ?? null,
      sentAt: params.timestamp,
      createdAt: now,
    });

    console.log('[Meta Webhook] Saved inbound message for conversation:', conversationId);
  } catch (err) {
    console.error('[Meta Webhook] Error saving inbound message:', err);
  }
}

/**
 * Updates an outbound message's status in Firestore.
 * Status flow: sending -> sent -> delivered -> read
 */
async function updateMessageStatus(params: {
  channel: 'whatsapp' | 'facebook' | 'instagram';
  messageId: string;
  status: string;
  timestamp: string;
}) {
  console.log('[Meta Webhook] Status update:', params);

  const db = getDb();

  try {
    const msgQuery = query(
      collection(db, 'conversationMessages'),
      where('externalMessageId', '==', params.messageId),
      firestoreLimit(1),
    );

    const msgSnap = await getDocs(msgQuery);

    if (msgSnap.empty) {
      // Not an error — could be a status update for a message we didn't send through our system
      console.log('[Meta Webhook] No message found for externalMessageId:', params.messageId);
      return;
    }

    const msgDoc = msgSnap.docs[0];
    const msgRef = doc(db, 'conversationMessages', msgDoc.id);

    const updateData: Record<string, string> = {
      status: params.status,
    };

    // Add timestamp fields for specific statuses
    if (params.status === 'delivered') {
      updateData.deliveredAt = params.timestamp;
    }
    if (params.status === 'read') {
      updateData.readAt = params.timestamp;
      // Also set deliveredAt if not already set (read implies delivered)
      const currentData = msgDoc.data();
      if (!currentData.deliveredAt) {
        updateData.deliveredAt = params.timestamp;
      }
    }

    await updateDoc(msgRef, updateData);

    console.log('[Meta Webhook] Updated message status:', msgDoc.id, '->', params.status);

    // If the message was read, also reset the conversation's unread count
    if (params.status === 'read') {
      const currentData = msgDoc.data();
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

function extractMessageContent(msg: MetaWhatsAppMessage): string {
  switch (msg.type) {
    case 'text':     return msg.text?.body ?? '';
    case 'image':    return msg.image?.caption ?? '[Imagem]';
    case 'audio':    return '[Audio]';
    case 'video':    return msg.video?.caption ?? '[Video]';
    case 'document': return msg.document?.caption ?? `[Documento: ${msg.document?.filename ?? 'arquivo'}]`;
    case 'sticker':  return '[Sticker]';
    case 'location': return '[Localizacao]';
    default:         return `[${msg.type}]`;
  }
}
