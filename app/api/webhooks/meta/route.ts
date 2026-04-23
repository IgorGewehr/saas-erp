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
import { adminDb } from '@/lib/config/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

// ─── Firebase Storage for media uploads ──────────────────────────────────────

import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function getStorageBucket() {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getStorage(app);
}

// ─── Media Download & Upload ─────────────────────────────────────────────────

/**
 * Downloads media from Meta's servers and uploads to Firebase Storage.
 *
 * Flow:
 * 1. GET https://graph.facebook.com/v21.0/{mediaId} → returns { url }
 * 2. GET {url} with Bearer token → returns binary media data
 * 3. Upload to Firebase Storage → returns public download URL
 */
async function downloadAndUploadMedia(params: {
  mediaId: string;
  accessToken: string;
  businessId: string;
  conversationId: string;
  mimeType?: string;
  channel: 'whatsapp' | 'facebook' | 'instagram';
}): Promise<string | null> {
  try {
    // 1. Get the media URL from Meta
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/${params.mediaId}`,
      {
        headers: { Authorization: `Bearer ${params.accessToken}` },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!metaRes.ok) {
      console.error('[Media] Failed to get media URL:', metaRes.status, await metaRes.text().catch(() => ''));
      return null;
    }

    const metaData = await metaRes.json();
    const mediaUrl = metaData.url;
    if (!mediaUrl) {
      console.error('[Media] No URL in Meta response:', metaData);
      return null;
    }

    // 2. Download the actual binary from Meta's CDN
    const mediaRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
      signal: AbortSignal.timeout(30000),
    });

    if (!mediaRes.ok) {
      console.error('[Media] Failed to download media:', mediaRes.status);
      return null;
    }

    let buffer = Buffer.from(await mediaRes.arrayBuffer() as ArrayBuffer);

    // 3. Determine real content type — prefer the actual HTTP header over what Meta declared
    const realContentType = mediaRes.headers.get('content-type')?.split(';')[0]?.trim()
      || params.mimeType
      || 'application/octet-stream';

    // 4. Convert OGG/Opus/AMR audio to M4A (AAC) for cross-browser compatibility.
    //    WhatsApp voice notes are audio/ogg;codecs=opus — Safari cannot play OGG.
    let uploadBuffer: Uint8Array = buffer;
    let uploadContentType = realContentType;
    if (AUDIO_CONVERT_MIMES.has(realContentType)) {
      try {
        console.log('[Media] Converting', realContentType, 'to M4A for cross-browser support');
        uploadBuffer = await convertAudioToM4a(buffer, mimeToExtension(realContentType));
        uploadContentType = 'audio/mp4';
      } catch (convErr) {
        console.warn('[Media] Audio conversion failed, keeping original format:', convErr);
      }
    }

    const ext = mimeToExtension(uploadContentType);
    const fileName = `${Date.now()}_${params.mediaId.slice(-8)}${ext}`;
    const storagePath = `conversations/${params.businessId}/${params.conversationId}/${fileName}`;

    // 5. Upload to Firebase Storage with correct contentType
    const storage = getStorageBucket();
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, uploadBuffer, {
      contentType: uploadContentType,
    });

    const downloadUrl = await getDownloadURL(storageRef);
    return downloadUrl;
  } catch (err) {
    console.error('[Media] Error downloading/uploading media:', err);
    return null;
  }
}

function mimeToExtension(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
    'audio/aac': '.aac',
    'audio/amr': '.amr',
    'audio/amr-wb': '.amr',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/webm': '.webm',
    'application/pdf': '.pdf',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'image/webp; codecs=vp8': '.webp',
  };
  return map[mime] || '.bin';
}

// MIME types that are not universally supported and should be converted to M4A (AAC)
// OGG/Opus = WhatsApp voice notes; AMR = legacy telephony; WebM = some browser recordings
const AUDIO_CONVERT_MIMES = new Set([
  'audio/ogg', 'audio/opus', 'audio/webm', 'audio/amr', 'audio/amr-wb',
]);

/**
 * Converts an audio buffer to M4A (AAC) for cross-browser/platform compatibility.
 * Safari does not support OGG/Opus. Instagram rejects OGG.
 * AMR is a telephony codec not supported in browsers.
 */
async function convertAudioToM4a(inputBuffer: Buffer, inputExt: string): Promise<Buffer> {
  const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { writeFile, readFile, unlink } = await import('fs/promises');

  ffmpeg.setFfmpegPath(ffmpegInstaller.path);

  const inputPath = join(tmpdir(), `in_${Date.now()}${inputExt}`);
  const outputPath = join(tmpdir(), `out_${Date.now()}.m4a`);

  await writeFile(inputPath, inputBuffer);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('aac')
      .audioBitrate('128k')
      .audioChannels(1)
      .format('ipod') // M4A/AAC container
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath);
  });

  const m4aBuffer = await readFile(outputPath);
  await unlink(inputPath).catch(() => {});
  await unlink(outputPath).catch(() => {});
  return m4aBuffer;
}

/**
 * Downloads a media attachment from a direct URL (Facebook/Instagram CDN),
 * converts OGG audio to M4A if needed, and uploads to Firebase Storage.
 *
 * Meta's attachment URLs are ephemeral (expire in hours) so we always
 * persist them in Firebase Storage.
 */
async function downloadAndUploadAttachment(params: {
  url: string;
  mediaType: string;
  businessId: string;
  tempConvId: string;
  pageToken?: string;
}): Promise<string | null> {
  try {
    const headers: Record<string, string> = {};
    if (params.pageToken) headers['Authorization'] = `Bearer ${params.pageToken}`;

    const res = await fetch(params.url, {
      headers,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error('[Attachment] Download failed:', res.status, params.url.slice(0, 80));
      return null;
    }

    let buffer: Uint8Array = Buffer.from(await res.arrayBuffer() as ArrayBuffer);
    const rawContentType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';

    let uploadContentType = rawContentType;
    if (params.mediaType === 'audio' && AUDIO_CONVERT_MIMES.has(rawContentType)) {
      try {
        console.log('[Attachment] Converting', rawContentType, 'to M4A');
        buffer = await convertAudioToM4a(Buffer.from(buffer), mimeToExtension(rawContentType));
        uploadContentType = 'audio/mp4';
      } catch (convErr) {
        console.warn('[Attachment] Audio conversion failed, keeping original:', convErr);
      }
    }

    const ext = mimeToExtension(uploadContentType);
    const fileName = `${Date.now()}_attach${ext}`;
    const storagePath = `conversations/${params.businessId}/${params.tempConvId}/${fileName}`;

    const storage = getStorageBucket();
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, buffer, { contentType: uploadContentType });
    return getDownloadURL(storageRef);
  } catch (err) {
    console.error('[Attachment] Error:', err);
    return null;
  }
}

/**
 * Gets the access token for a WhatsApp channel (Cloud API).
 * Different from Facebook/Instagram which use pageAccessToken.
 */
async function getWhatsAppAccessToken(businessId: string): Promise<string | null> {
  try {
    const bizSnap = await adminDb.doc(`businesses/${businessId}`).get();
    if (!bizSnap.exists) return null;

    const bizData = bizSnap.data();
    const encryptedToken = bizData?.channels?.whatsapp?.accessToken;
    if (!encryptedToken) return null;

    return decryptToken(encryptedToken);
  } catch (err) {
    console.error('[Media] Error getting WhatsApp access token:', err);
    return null;
  }
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
  fallbackPageId?: string; // For Instagram DMs via page subscription: pageId used as fallback for business resolution
  externalId: string;
  senderName?: string;
  senderAvatarUrl?: string;
  messageId: string;
  content: string; // Text shown inside the chat bubble (empty for media-only messages)
  conversationPreview?: string; // Short text for conversation list sidebar (e.g. "[Imagem]", "[Audio]")
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

  // Accept either token — Meta uses different tokens for WhatsApp vs Page webhooks
  const validTokens = [
    process.env.META_FACEBOOK_VERIFY_TOKEN,
    process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  ].filter(Boolean) as string[];

  if (mode === 'subscribe' && token && validTokens.includes(token)) {
    console.log('[Meta Webhook] Verification successful for token:', token);
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn('[Meta Webhook] Verification failed — token received:', token);
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
    if (!signature) {
      console.error('[Meta Webhook] Missing x-hub-signature-256 header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }
    const isValid = verifySignatureFromBuffer(rawBuffer, signature);
    if (!isValid) {
      console.error('[Meta Webhook] Invalid signature — check META_APP_SECRET in production env');
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

        // Determine media type for Firestore (only real media types, not text/location/etc.)
        const MEDIA_TYPES = new Set(['image', 'audio', 'video', 'document', 'sticker']);
        const hasMedia = MEDIA_TYPES.has(msg.type) && !!extracted.mediaId;
        const mediaType = hasMedia ? (msg.type === 'sticker' ? 'image' : msg.type) as 'image' | 'audio' | 'video' | 'document' : undefined;

        // Download media from Meta and upload to Firebase Storage
        let firebaseMediaUrl: string | undefined;
        if (hasMedia && extracted.mediaId) {
          const businessId = await resolveBusinessId('whatsapp', phoneNumberId);
          if (businessId) {
            const accessToken = await getWhatsAppAccessToken(businessId);
            if (accessToken) {
              const url = await downloadAndUploadMedia({
                mediaId: extracted.mediaId,
                accessToken,
                businessId,
                conversationId: `wa_${msg.from}`, // Temp path; actual conv ID resolved inside saveInboundMessage
                mimeType: extracted.mediaMimeType,
                channel: 'whatsapp',
              });
              if (url) firebaseMediaUrl = url;
            }
          }
        }

        // Build conversation preview for sidebar (short label when content is empty)
        const MEDIA_PREVIEW: Record<string, string> = {
          image: '[Imagem]', audio: '[Audio]', video: '[Video]', document: '[Documento]', sticker: '[Sticker]',
        };
        const conversationPreview = extracted.content
          || (hasMedia ? MEDIA_PREVIEW[msg.type] || '[Midia]' : '');

        await saveInboundMessage({
          channel: 'whatsapp',
          channelIdentifier: phoneNumberId,
          externalId: msg.from,
          senderName: value.contacts?.find(c => c.wa_id === msg.from)?.profile.name,
          messageId: msg.id,
          content: extracted.content,
          conversationPreview,
          mediaType,
          mediaId: extracted.mediaId,
          mediaUrl: firebaseMediaUrl,
          mediaMimeType: extracted.mediaMimeType,
          replyToMessageId: msg.context?.id,
          timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        });
      }
    }

    // Handle status updates (sent -> delivered -> read)
    if (value.statuses) {
      const businessId = await resolveBusinessId('whatsapp', phoneNumberId);
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

// ─── Facebook Messenger + Instagram (via Page subscription) Handler ───────────
//
// When a Page is subscribed with the 'instagram' field, Instagram DMs arrive
// as object:'page' — structurally identical to Facebook Messenger events.
// The only reliable way to distinguish them is event.recipient.id:
//   - Facebook DM:  recipient.id === pageId  (Page-Scoped ID)
//   - Instagram DM: recipient.id === igAccountId (Instagram account ID, ≠ pageId)

async function handleFacebookEvent(entry: MetaWebhookEntry) {
  if (!entry.messaging) return;

  const pageId = String(entry.id);

  for (const event of entry.messaging) {
    // Skip echoes (messages sent by the page itself)
    if (event.message?.is_echo) continue;

    // Detect channel: if recipient.id !== pageId it's an Instagram DM via Page subscription
    const recipientId = String(event.recipient?.id || pageId);
    const isInstagramDm = recipientId !== pageId;
    const channel: 'facebook' | 'instagram' = isInstagramDm ? 'instagram' : 'facebook';
    // Instagram: resolve by instagram.accountId (= recipientId); Facebook: by pageId
    const channelIdentifier = isInstagramDm ? recipientId : pageId;

    // Handle delivery receipts
    if (event.delivery) {
      const businessId = await resolveBusinessId(channel, channelIdentifier);
      if (businessId) {
        for (const mid of event.delivery.mids ?? []) {
          await updateMessageStatus({
            businessId,
            channel,
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
      const businessId = await resolveBusinessId(channel, channelIdentifier);
      if (businessId) {
        const readTimestamp = new Date(event.read.watermark).toISOString();
        const convSnap = await adminDb.collection('conversations')
          .where('businessId', '==', businessId)
          .where('channel', '==', channel)
          .where('contactExternalId', '==', String(event.sender.id))
          .limit(1)
          .get();
        if (!convSnap.empty) {
          const msgsSnap = await adminDb.collection('conversationMessages')
            .where('businessId', '==', businessId)
            .where('conversationId', '==', convSnap.docs[0].id)
            .where('direction', '==', 'outbound')
            .where('status', 'in', ['sent', 'delivered'])
            .get();
          const batch: Promise<FirebaseFirestore.WriteResult>[] = [];
          for (const msgDoc of msgsSnap.docs) {
            const msgData = msgDoc.data();
            if (msgData.sentAt && msgData.sentAt <= readTimestamp) {
              batch.push(
                adminDb.doc(`conversationMessages/${msgDoc.id}`).update({
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

    // Fetch sender profile for messages and postbacks
    let senderName: string | undefined;
    let senderAvatarUrl: string | undefined;

    if (event.message || event.postback) {
      const businessId = await resolveBusinessId(channel, channelIdentifier);
      if (businessId) {
        const pageToken = await getDecryptedPageToken(businessId);
        if (pageToken) {
          const profile = await fetchSenderProfile(String(event.sender.id), pageToken, channel);
          if (profile) {
            senderName = profile.name;
            senderAvatarUrl = profile.profilePic;
          } else {
            console.warn('[Meta Webhook] fetchSenderProfile returned null for sender:', event.sender.id, 'channel:', channel);
          }
        } else {
          console.warn('[Meta Webhook] No page token for business:', businessId, '— skipping profile fetch');
        }
      } else {
        console.warn('[Meta Webhook] Could not resolve businessId for profile fetch. channel:', channel, 'identifier:', channelIdentifier);
      }
      if (!senderName) senderName = isInstagramDm ? 'Usuário do Instagram' : 'Usuário do Facebook';
    }

    // For Instagram DMs arriving via page subscription, pass pageId as fallback so
    // business resolution succeeds even when channelIdentifier (igAccountId) isn't stored.
    const igFallback = isInstagramDm ? pageId : undefined;

    // Handle postback events
    if (event.postback) {
      await saveInboundMessage({
        channel,
        channelIdentifier,
        fallbackPageId: igFallback,
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
        channel,
        channelIdentifier,
        fallbackPageId: igFallback,
        externalId: String(event.sender.id),
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
      const mappedMediaType = (mediaTypeMap[attachmentType] || 'document') as 'image' | 'audio' | 'video' | 'document';

      // For audio: always download and convert OGG→M4A, then store in Firebase.
      // Meta CDN audio URLs expire and OGG/Opus is not supported in Safari or Instagram.
      let resolvedMediaUrl = attachmentUrl;
      if (mappedMediaType === 'audio' && attachmentUrl) {
        const bizId = await resolveBusinessId(channel, channelIdentifier);
        if (bizId) {
          const pageToken = await getDecryptedPageToken(bizId);
          const stored = await downloadAndUploadAttachment({
            url: attachmentUrl,
            mediaType: 'audio',
            businessId: bizId,
            tempConvId: `${channel}_${event.sender.id}`,
            pageToken: pageToken || undefined,
          }).catch((err) => { console.warn('[Attachment FB] audio store failed:', err); return null; });
          if (stored) resolvedMediaUrl = stored;
        }
      }

      await saveInboundMessage({
        channel,
        channelIdentifier,
        fallbackPageId: igFallback,
        externalId: String(event.sender.id),
        senderName,
        senderAvatarUrl,
        messageId: event.message.mid,
        content: event.message.text || `[${attachmentType === 'file' ? 'Documento' : attachmentType === 'image' ? 'Imagem' : attachmentType === 'video' ? 'Video' : attachmentType === 'audio' ? 'Audio' : 'Anexo'}]`,
        mediaType: mappedMediaType,
        mediaUrl: resolvedMediaUrl,
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

    // Handle delivery receipts
    if (event.delivery) {
      const businessId = await resolveBusinessId('instagram', String(entry.id));
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
      const businessId = await resolveBusinessId('instagram', String(entry.id));
      if (businessId) {
        const readTimestamp = new Date(event.read.watermark).toISOString();
        // Find conversation for this contact
        const convSnap = await adminDb.collection('conversations')
          .where('businessId', '==', businessId)
          .where('channel', '==', 'instagram')
          .where('contactExternalId', '==', String(event.sender.id))
          .limit(1)
          .get();
        if (!convSnap.empty) {
          // Mark all outbound messages before watermark as read
          const msgsSnap = await adminDb.collection('conversationMessages')
            .where('businessId', '==', businessId)
            .where('conversationId', '==', convSnap.docs[0].id)
            .where('direction', '==', 'outbound')
            .where('status', 'in', ['sent', 'delivered'])
            .get();
          const batch: Promise<FirebaseFirestore.WriteResult>[] = [];
          for (const msgDoc of msgsSnap.docs) {
            const msgData = msgDoc.data();
            if (msgData.sentAt && msgData.sentAt <= readTimestamp) {
              batch.push(
                adminDb.doc(`conversationMessages/${msgDoc.id}`).update({
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
      const businessId = await resolveBusinessId('instagram', String(accountId));
      if (businessId) {
        const pageToken = await getDecryptedPageToken(businessId);
        if (pageToken) {
          const profile = await fetchSenderProfile(String(event.sender.id), pageToken, 'instagram');
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
        channelIdentifier: accountId,
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
        externalId: String(event.sender.id),
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
      const mappedMediaType = (mediaTypeMap[attachmentType] || 'document') as 'image' | 'audio' | 'video' | 'document';

      // For audio: download and convert OGG→M4A if needed (Instagram rejects OGG, Safari can't play it)
      let resolvedMediaUrl = attachmentUrl;
      if (mappedMediaType === 'audio' && attachmentUrl) {
        const bizId = await resolveBusinessId('instagram', String(accountId));
        if (bizId) {
          const pageToken = await getDecryptedPageToken(bizId);
          const stored = await downloadAndUploadAttachment({
            url: attachmentUrl,
            mediaType: 'audio',
            businessId: bizId,
            tempConvId: `instagram_${event.sender.id}`,
            pageToken: pageToken || undefined,
          }).catch((err) => { console.warn('[Attachment IG] audio store failed:', err); return null; });
          if (stored) resolvedMediaUrl = stored;
        }
      }

      await saveInboundMessage({
        channel: 'instagram',
        channelIdentifier: accountId,
        externalId: String(event.sender.id),
        senderName,
        senderAvatarUrl,
        messageId: event.message.mid,
        content: event.message.text || '',
        conversationPreview: event.message.text || `[${attachmentType === 'file' ? 'Documento' : attachmentType === 'image' ? 'Imagem' : attachmentType === 'video' ? 'Video' : attachmentType === 'audio' ? 'Audio' : 'Anexo'}]`,
        mediaType: mappedMediaType,
        mediaUrl: resolvedMediaUrl,
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
  channel: 'whatsapp' | 'facebook' | 'instagram',
  channelIdentifier: string,
): Promise<string | null> {
  try {
    if (channel === 'whatsapp') {
      const snap = await adminDb.collection('businesses')
        .where('channels.whatsapp.phoneNumberId', '==', channelIdentifier)
        .limit(1)
        .get();
      return snap.empty ? null : snap.docs[0].id;
    }

    if (channel === 'facebook') {
      const snap = await adminDb.collection('businesses')
        .where('channels.facebook.pageId', '==', channelIdentifier)
        .limit(1)
        .get();
      return snap.empty ? null : snap.docs[0].id;
    }

    if (channel === 'instagram') {
      // Primary lookup: channels.instagram.accountId (Instagram Business Account ID)
      const snapIg = await adminDb.collection('businesses')
        .where('channels.instagram.accountId', '==', channelIdentifier)
        .limit(1)
        .get();
      if (!snapIg.empty) return snapIg.docs[0].id;

      // Fallback: Instagram DMs via Page subscription sometimes arrive with the pageId
      // as channelIdentifier instead of the Instagram account ID. Try matching by pageId.
      const snapFb = await adminDb.collection('businesses')
        .where('channels.facebook.pageId', '==', channelIdentifier)
        .limit(1)
        .get();
      if (!snapFb.empty) {
        console.log('[Meta Webhook] Instagram resolved via Facebook pageId fallback:', channelIdentifier);
        return snapFb.docs[0].id;
      }

      return null;
    }

    return null;
  } catch (err) {
    console.error('[Meta Webhook] Error resolving businessId:', err);
    return null;
  }
}

// ─── Profile Picture Persistence ─────────────────────────────────────────────

/**
 * Downloads a profile picture from Meta's temporary CDN and re-uploads it to
 * Firebase Storage as a permanent file.
 *
 * Why: Meta CDN URLs (profile_pic) expire in a few hours. Storing them directly
 * causes broken avatars in the Inbox. This function converts the ephemeral URL
 * into a permanent Firebase Storage URL on the first contact interaction.
 *
 * Storage path: avatars/meta/{senderId}.jpg
 *   - Overwriting the same path is intentional: if the user updates their
 *     profile picture on Instagram/Facebook, the next webhook will refresh it.
 *
 * Fallback: if anything fails (network, storage quota, etc.) the original
 * Meta URL is returned so the webhook flow is never interrupted.
 */
async function persistProfilePic(
  tempUrl: string,
  senderId: string,
): Promise<string> {
  try {
    // Download from Meta's CDN (no auth required for profile_pic URLs)
    const picRes = await fetch(tempUrl, { signal: AbortSignal.timeout(10000) });
    if (!picRes.ok) {
      console.warn(`[Profile Pic] CDN download failed (HTTP ${picRes.status}) — keeping temp URL`);
      return tempUrl;
    }

    const contentType =
      picRes.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
    const buffer = Buffer.from(await picRes.arrayBuffer());

    // Upload to Firebase Storage using the same client SDK already used for media
    const storage = getStorageBucket();
    const storageRef = ref(storage, `avatars/meta/${senderId}.jpg`);
    await uploadBytes(storageRef, buffer, { contentType });

    const permanentUrl = await getDownloadURL(storageRef);
    console.log(`[Profile Pic] Persisted avatar for ${senderId} → Firebase Storage`);
    return permanentUrl;
  } catch (err) {
    console.warn('[Profile Pic] Failed to persist to storage — using temp URL as fallback:', err);
    return tempUrl;
  }
}

// ─── Profile Fetching ─────────────────────────────────────────────────────────

/**
 * Fetches sender profile (name + avatar) from Facebook/Instagram Graph API,
 * then persists the profile picture to Firebase Storage for a permanent URL.
 *
 * Instagram: fields=name,username,profile_pic
 * Facebook:  fields=first_name,last_name,name,profile_pic
 */
async function fetchSenderProfile(
  senderId: string,
  pageAccessToken: string,
  channel: 'facebook' | 'instagram' = 'facebook',
): Promise<{ name: string; profilePic?: string } | null> {
  try {
    // Facebook Messenger PSIDs: first_name + last_name + profile_pic (standard Messenger Profile API)
    // Instagram IGSIDs: name + username + profile_pic
    // Note: profile_pic for Instagram requires instagram_basic permission — may be absent.
    const fields = channel === 'instagram'
      ? 'name,username,profile_pic'
      : 'first_name,last_name,profile_pic';

    const url = `https://graph.facebook.com/v21.0/${senderId}?fields=${fields}&access_token=${pageAccessToken}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.warn(`[Profile] Fetch failed (${channel}) sender=${senderId} status=${res.status}:`, errorText);
      return null;
    }

    const data = await res.json();
    console.log(`[Profile] Raw response (${channel}) sender=${senderId}:`, JSON.stringify(data));

    // Build name with best available data
    let name: string;
    if (channel === 'instagram') {
      name = data.name || (data.username ? `@${data.username}` : senderId);
    } else {
      // Facebook: combine first + last; fall back to senderId if both empty
      if (data.first_name || data.last_name) {
        name = [data.first_name, data.last_name].filter(Boolean).join(' ');
      } else {
        // API returned no name fields — token may be a user token instead of page token
        console.warn(`[Profile] Facebook returned no name fields for sender=${senderId}. Token may not be a Page Access Token.`);
        name = senderId;
      }
    }

    // Persist the ephemeral Meta CDN URL to Firebase Storage so it never expires.
    // profile_pic may be absent for Instagram (requires instagram_basic permission).
    const rawPic = data.profile_pic || data.picture?.data?.url || undefined;
    const profilePic = rawPic
      ? await persistProfilePic(rawPic, senderId)
      : undefined;

    if (!rawPic) {
      console.log(`[Profile] No profile_pic returned for ${channel} sender=${senderId} (permission or private account)`);
    }

    return { name, profilePic };
  } catch (err) {
    console.error(`[Meta Webhook] Error fetching ${channel} sender profile:`, err);
    return null;
  }
}

/**
 * Gets the decrypted Facebook page access token for a business.
 * Instagram uses the same token as Facebook Messenger.
 */
async function getDecryptedPageToken(businessId: string): Promise<string | null> {
  try {
    const bizSnap = await adminDb.doc(`businesses/${businessId}`).get();
    if (!bizSnap.exists) return null;

    const bizData = bizSnap.data();
    const encryptedToken = bizData?.channels?.facebook?.pageAccessToken;
    if (!encryptedToken) {
      console.warn('[Profile] No pageAccessToken stored for business:', businessId);
      return null;
    }

    const token = await decryptToken(encryptedToken);
    // Log first 12 chars so we can confirm it's a page token (starts with EAA...) vs user token
    console.log('[Profile] Page token prefix for business', businessId, ':', token.slice(0, 12) + '...');
    return token;
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

  // 1. Resolve businessId from channel identifier
  // For Instagram DMs arriving via page subscription (object:'page'), the channelIdentifier
  // is event.recipient.id which may be the Instagram account ID or the page ID depending
  // on how Meta structures the payload. If primary lookup fails, try the fallbackPageId
  // (the entry.id = Facebook page ID) which is always reliable.
  let businessId = await resolveBusinessId(params.channel, params.channelIdentifier);

  if (!businessId && params.channel === 'instagram' && params.fallbackPageId) {
    businessId = await resolveBusinessId('facebook', params.fallbackPageId);
    if (businessId) {
      console.log('[Meta Webhook] Instagram resolved via fallbackPageId:', params.fallbackPageId);
    }
  }

  if (!businessId) {
    console.error('[Meta Webhook] Could not resolve businessId for', params.channel, 'identifier:', params.channelIdentifier, 'fallback:', params.fallbackPageId);
    try {
      await adminDb.collection('webhookFailures').add({
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
    const dupSnap = await adminDb.collection('conversationMessages')
      .where('externalMessageId', '==', params.messageId)
      .where('businessId', '==', businessId)
      .limit(1)
      .get();
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
    const convSnap = await adminDb.collection('conversations')
      .where('businessId', '==', businessId)
      .where('channel', '==', params.channel)
      .where('contactExternalId', '==', params.externalId)
      .limit(1)
      .get();

    let conversationId: string;

    if (convSnap.empty) {
      // Create new conversation
      const newConvRef = await adminDb.collection('conversations').add({
        businessId,
        channel: params.channel,
        // All Meta webhooks come from the official APIs (Embedded Signup). Tag it so
        // the UI can distinguish from Baileys (WhatsApp Web).
        ...(params.channel === 'whatsapp' ? { connectedVia: 'embedded_signup' } : {}),
        contactName: params.senderName ?? params.externalId,
        contactExternalId: params.externalId,
        ...(params.senderAvatarUrl ? { contactAvatarUrl: params.senderAvatarUrl } : {}),
        status: 'open',
        lastMessage: params.conversationPreview || params.content || '[Midia]',
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

        const contactSnap = await adminDb.collection('clients')
          .where('businessId', '==', businessId)
          .where(channelField, '==', params.externalId)
          .limit(1)
          .get();

        if (!contactSnap.empty) {
          const contact = contactSnap.docs[0];
          const contactData = contact.data();
          // Update conversation with CRM contact reference
          await adminDb.doc(`conversations/${conversationId}`).update({
            crmContactId: contact.id,
            contactName: contactData.name || params.senderName || params.externalId,
            contactPhone: contactData.phone || (params.channel === 'whatsapp' ? params.externalId : null),
          });
          // Update CRM contact with last conversation reference
          await adminDb.doc(`clients/${contact.id}`).update({
            lastConversationId: conversationId,
            lastConversationAt: now,
            updatedAt: now,
          });
          console.log('[Meta Webhook] Linked conversation to CRM contact:', contact.id);
        } else {
          // Also try matching by phone for WhatsApp
          if (params.channel === 'whatsapp') {
            const phoneSnap = await adminDb.collection('clients')
              .where('businessId', '==', businessId)
              .where('phone', '==', params.externalId)
              .limit(1)
              .get();
            if (!phoneSnap.empty) {
              const contact = phoneSnap.docs[0];
              const contactData = contact.data();
              await adminDb.doc(`conversations/${conversationId}`).update({
                crmContactId: contact.id,
                contactName: contactData.name || params.senderName || params.externalId,
                contactPhone: params.externalId,
              });
              await adminDb.doc(`clients/${contact.id}`).update({
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

      const existingData = convSnap.docs[0].data();

      // Soft-delete guard: only resurrect if the new message is newer than deletedAt
      if (existingData.isDeleted) {
        const deletedAt = existingData.deletedAt ? new Date(existingData.deletedAt).getTime() : 0;
        const messageAt = new Date(params.timestamp).getTime();
        if (messageAt <= deletedAt) {
          // Message is older than delete — skip silently
          return;
        }
        // New message after delete — resurrect the conversation
        console.log('[Meta Webhook] Resurrecting soft-deleted conversation:', conversationId);
      }

      const enrichUpdate: Record<string, unknown> = {
        lastMessage: params.conversationPreview || params.content || '[Midia]',
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: FieldValue.increment(1),
        updatedAt: now,
        // Clear soft-delete flags on resurrect
        isDeleted: false,
        deletedAt: null,
      };
      // Default placeholder names used as fallback when profile fetch fails on first message.
      // On subsequent messages (when profile fetch succeeds), overwrite them with the real name.
      const PLACEHOLDER_NAMES = [
        'Usuário do Facebook', 'Usuário do Instagram',
        'Facebook User', 'Instagram User',
      ];
      const currentName = existingData.contactName as string | undefined;
      const nameIsPlaceholder = !currentName
        || /^\d+$/.test(currentName)
        || PLACEHOLDER_NAMES.includes(currentName);
      if (params.senderName && nameIsPlaceholder) {
        enrichUpdate.contactName = params.senderName;
      }
      // Enrich avatar if missing or if we now have a permanent Firebase Storage URL
      const currentAvatar = existingData.contactAvatarUrl as string | undefined;
      const newAvatarIsBetter = params.senderAvatarUrl && (
        !currentAvatar
        || (currentAvatar.includes('fbcdn.net') && params.senderAvatarUrl.includes('firebasestorage'))
      );
      if (newAvatarIsBetter) {
        enrichUpdate.contactAvatarUrl = params.senderAvatarUrl;
      }
      await adminDb.doc(`conversations/${conversationId}`).update(enrichUpdate);

      console.log('[Meta Webhook] Updated conversation:', conversationId);

      // Auto-link to CRM if not already linked
      if (!existingData.crmContactId) {
        try {
          const channelField = params.channel === 'whatsapp'
            ? 'channelIdentities.whatsapp'
            : params.channel === 'facebook'
            ? 'channelIdentities.facebook'
            : 'channelIdentities.instagram';

          const contactSnap = await adminDb.collection('clients')
            .where('businessId', '==', businessId)
            .where(channelField, '==', params.externalId)
            .limit(1)
            .get();

          if (!contactSnap.empty) {
            const contact = contactSnap.docs[0];
            await adminDb.doc(`conversations/${conversationId}`).update({
              crmContactId: contact.id,
            });
            await adminDb.doc(`clients/${contact.id}`).update({
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
    const msgRef = await adminDb.collection('conversationMessages').add(msgDoc);

    console.log('[Meta Webhook] Saved inbound message for conversation:', conversationId);

    // Dispatch to AI agent (true fire-and-forget — do NOT await, debounce runs inside).
    try {
      const { dispatchInboundToAgent } = await import('@/lib/agent/dispatch');
      dispatchInboundToAgent(adminDb, {
        businessId,
        conversationId,
        messageId: msgRef.id,
        channel: params.channel,
        message: params.content,
        contactName: params.senderName || params.externalId,
        contactPhone: params.externalId,
        recipientId: params.externalId,
      }).catch(agentErr => console.warn('[Meta Webhook] Agent dispatch failed:', agentErr));
    } catch (agentErr) {
      console.warn('[Meta Webhook] Agent dispatch failed:', agentErr);
    }
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

  try {
    const msgSnap = await adminDb.collection('conversationMessages')
      .where('externalMessageId', '==', params.messageId)
      .where('businessId', '==', params.businessId)
      .limit(1)
      .get();

    if (msgSnap.empty) {
      // Not an error — could be a status update for a message we didn't send through our system
      console.log('[Meta Webhook] No message found for externalMessageId:', params.messageId);
      return;
    }

    const msgDoc = msgSnap.docs[0];
    const currentData = msgDoc.data();

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
      const firstError = params.errors[0];
      updateData.failedReason = firstError.title;
      updateData.failedCode = firstError.code;
      console.error('[Meta Webhook] Message delivery failed:', {
        messageId: params.messageId,
        channel: params.channel,
        businessId: params.businessId,
        errors: params.errors,
      });
    }

    await adminDb.doc(`conversationMessages/${msgDoc.id}`).update(updateData);

    console.log('[Meta Webhook] Updated message status:', msgDoc.id, '->', params.status);

    // If the message was read, also update the conversation timestamp
    if (params.status === 'read') {
      if (currentData.conversationId) {
        try {
          await adminDb.doc(`conversations/${currentData.conversationId}`).update({
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
        // Only use the real caption from the user — never a filename or placeholder as bubble text
        content: msg.image?.caption || '',
        mediaId: msg.image?.id,
        mediaMimeType: msg.image?.mime_type,
      };
    case 'audio':
      return {
        content: '',
        mediaId: msg.audio?.id,
        mediaMimeType: msg.audio?.mime_type,
      };
    case 'video':
      return {
        content: msg.video?.caption || '',
        mediaId: msg.video?.id,
        mediaMimeType: msg.video?.mime_type,
      };
    case 'document':
      return {
        // For documents, use caption if present; otherwise leave empty (filename goes in conversation preview only)
        content: msg.document?.caption || '',
        mediaId: msg.document?.id,
        mediaMimeType: msg.document?.mime_type,
      };
    case 'sticker':
      return { content: '', mediaId: msg.sticker?.id };
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
