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

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { isOptOutKeyword } from '@/lib/utils/optOutKeywords';
import { detectLikelyBotReply } from '@/lib/utils/botDetection';
import { getAlternativeBrazilianPhone } from '@/lib/utils/phoneAlternatives';
import { uploadServerMedia } from '@/lib/services/storage/adminUpload';
import { markWebhookSeen } from '@/contracts/_runtime/webhookIdempotency';

// Storage uploads são feitos via uploadServerMedia (admin SDK) — antes
// inicializávamos o client SDK aqui mas server-side não tem auth do Firebase,
// então as Storage Rules retornavam `storage/unauthorized` em todo upload.

/**
 * Persiste falha do pipeline de mídia em `webhookFailures` para diagnóstico
 * via UI (Configurações → Enterprise → Logs). Não throw — registrar erro
 * nunca pode causar segundo erro.
 */
/**
 * Verifica se o agente IA autônomo está ativo para um business — usado pra
 * gatear features que só fazem sentido quando o tenant pediu o agente:
 *
 *   - Transcrição de áudio (Whisper) e descrição de imagem (GPT-4o vision):
 *     a saída substitui o `content` da mensagem pra que o agente possa
 *     raciocinar sobre o conteúdo. Sem agente ligado, isso só polui a
 *     bolha de texto pro operador humano (que já vê o player/imagem) e
 *     gera custo OpenAI sem benefício.
 *
 * Nota arquitetural: `aiAgent.enabled` controla APENAS o agente autônomo
 * de atendimento ao cliente. Não confundir com o Dashboard AI (chat operador/
 * analista pra gerenciar o ERP), que é independente e sempre disponível.
 */
async function isAgentEnabled(businessId: string): Promise<boolean> {
  try {
    const snap = await adminDb.collection('businesses').doc(businessId).get();
    return !!snap.data()?.settings?.aiAgent?.enabled;
  } catch (err) {
    console.warn('[meta-webhook] Failed to check aiAgent.enabled, defaulting to false:', err);
    return false;
  }
}

async function logMediaFailure(
  source: string,
  businessId: string | null,
  conversationId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await adminDb.collection('webhookFailures').add({
      source,
      channel: 'whatsapp',
      ...(businessId ? { businessId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...details,
      createdAt: new Date().toISOString(),
    });
  } catch (logErr) {
    console.warn('[Media] webhookFailures log failed (non-fatal):', logErr);
  }
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
      const errBody = await metaRes.text().catch(() => '');
      console.error('[Media] Failed to get media URL:', metaRes.status, errBody);
      await logMediaFailure('meta-media-url-fetch', params.businessId, params.conversationId, {
        mediaId: params.mediaId,
        declaredMime: params.mimeType,
        httpStatus: metaRes.status,
        error: `Meta media URL fetch failed: HTTP ${metaRes.status}`,
        errorBody: errBody?.slice(0, 500),
      });
      return null;
    }

    const metaData = await metaRes.json();
    const mediaUrl = metaData.url;
    if (!mediaUrl) {
      console.error('[Media] No URL in Meta response:', metaData);
      await logMediaFailure('meta-media-url-missing', params.businessId, params.conversationId, {
        mediaId: params.mediaId,
        declaredMime: params.mimeType,
        error: 'Meta API retornou response sem campo `url`',
        metaResponse: JSON.stringify(metaData).slice(0, 500),
      });
      return null;
    }

    // 2. Download the actual binary from Meta's CDN
    const mediaRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
      signal: AbortSignal.timeout(30000),
    });

    if (!mediaRes.ok) {
      console.error('[Media] Failed to download media:', mediaRes.status);
      await logMediaFailure('meta-media-download', params.businessId, params.conversationId, {
        mediaId: params.mediaId,
        declaredMime: params.mimeType,
        httpStatus: mediaRes.status,
        error: `Meta CDN download failed: HTTP ${mediaRes.status}`,
      });
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
        // Falha de ffmpeg é uma das causas suspeitas pra "operador não recebe áudio".
        // Persistimos pra diagnóstico via UI sem precisar acessar logs do servidor.
        console.warn('[Media] Audio conversion failed, keeping original format:', convErr);
        await logMediaFailure('meta-audio-conversion', params.businessId, params.conversationId, {
          mediaType: 'audio',
          declaredMime: params.mimeType,
          contentType: realContentType,
          bufferSize: buffer.length,
          mediaId: params.mediaId,
          error: convErr instanceof Error ? convErr.message : String(convErr),
          errorStack: convErr instanceof Error ? convErr.stack?.slice(0, 500) : undefined,
          severity: 'warning', // não-fatal: mantém arquivo original
        });
      }
    }

    const ext = mimeToExtension(uploadContentType);
    const fileName = `${Date.now()}_${params.mediaId.slice(-8)}${ext}`;
    const storagePath = `conversations/${params.businessId}/${params.conversationId}/${fileName}`;

    // 5. Upload via admin SDK — bypassa Storage Rules que esperam request.auth
    //    de um usuário client-side (que não existe em webhooks).
    const downloadUrl = await uploadServerMedia({
      storagePath,
      buffer: uploadBuffer,
      contentType: uploadContentType,
    });
    return downloadUrl;
  } catch (err) {
    console.error('[Media] Error downloading/uploading media:', err);
    await logMediaFailure('meta-media-pipeline', params.businessId, params.conversationId, {
      mediaId: params.mediaId,
      declaredMime: params.mimeType,
      error: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
    });
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
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { writeFile, readFile, unlink } = await import('fs/promises');

  // Linux/macOS: usa ffmpeg do PATH. Windows: usa o binário do
  // @ffmpeg-installer (apt-installed no Dockerfile pro container).
  if (process.platform === 'win32') {
    const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }

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

    return await uploadServerMedia({
      storagePath,
      buffer,
      contentType: uploadContentType,
    });
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
    // Prefere o novo campo isolado whatsappCloud; fallback para legado whatsapp
    // (que só é Cloud se connectedVia !== 'baileys').
    const cloudCfg = bizData?.channels?.whatsappCloud;
    const legacy = bizData?.channels?.whatsapp;
    const encryptedToken = cloudCfg?.accessToken
      ?? (legacy?.connectedVia !== 'baileys' ? legacy?.accessToken : null);
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
  /** Apenas documentos: nome de arquivo declarado pelo emissor.
   *  Vai pro doc Firestore como `fileName` pra renderizar no card. */
  fileName?: string;
  /** Mensagens tipo 'contacts' (vCard): array de contatos compartilhados pelo
   *  cliente. UI renderiza card visual em vez do preview "[Contato]". */
  sharedContacts?: Array<{ name: string; phones?: string[]; emails?: string[] }>;
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
  /** Documentos: nome de arquivo do emissor — gravado em `fileName`. */
  fileName?: string;
  /** Mensagens 'contacts' (vCard): contatos compartilhados pelo cliente. */
  sharedContacts?: Array<{ name: string; phones?: string[]; emails?: string[] }>;
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
    console.log('[Meta Webhook] Verification successful');
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn('[Meta Webhook] Verification failed');
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

        // Download media from Meta and upload to Firebase Storage. Hoist
        // `resolvedBusinessId` pro escopo do msg pra reusar no gate de
        // enrichment abaixo (evita 2ª chamada a resolveBusinessId).
        let firebaseMediaUrl: string | undefined;
        let resolvedBusinessId: string | null = null;
        if (hasMedia && extracted.mediaId) {
          resolvedBusinessId = await resolveBusinessId('whatsapp', phoneNumberId);
          if (resolvedBusinessId) {
            const accessToken = await getWhatsAppAccessToken(resolvedBusinessId);
            if (accessToken) {
              const url = await downloadAndUploadMedia({
                mediaId: extracted.mediaId,
                accessToken,
                businessId: resolvedBusinessId,
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
        let agentContent = extracted.content;
        let conversationPreview = extracted.content
          || (hasMedia ? MEDIA_PREVIEW[msg.type] || '[Midia]' : '');

        // ─── Humanization: enrich voice notes + images into text for the agent ──
        // Só roda quando o agente autônomo está ligado (aiAgent.enabled). Caso
        // contrário, a transcrição/descrição apareceria como bolha de texto pro
        // operador humano — duplicando info que ele já vê no player/imagem.
        // Também evita custo OpenAI desnecessário em tenants sem agente ativo.
        if (hasMedia && firebaseMediaUrl && !extracted.content && resolvedBusinessId
            && await isAgentEnabled(resolvedBusinessId)) {
          if (mediaType === 'audio') {
            const { enrichAudio } = await import('@/lib/channels/media-enrichment');
            const enriched = await enrichAudio({ mediaUrl: firebaseMediaUrl, mimeType: extracted.mediaMimeType });
            if (enriched) {
              agentContent = enriched.content;
              conversationPreview = enriched.preview;
            }
          } else if (mediaType === 'image') {
            const { enrichImage } = await import('@/lib/channels/media-enrichment');
            const enriched = await enrichImage({ mediaUrl: firebaseMediaUrl, mimeType: extracted.mediaMimeType });
            if (enriched) {
              agentContent = enriched.content;
              conversationPreview = enriched.preview;
            }
          }
        }

        await saveInboundMessage({
          channel: 'whatsapp',
          channelIdentifier: phoneNumberId,
          externalId: msg.from,
          senderName: value.contacts?.find(c => c.wa_id === msg.from)?.profile.name,
          messageId: msg.id,
          content: agentContent,
          conversationPreview,
          mediaType,
          mediaId: extracted.mediaId,
          mediaUrl: firebaseMediaUrl,
          mediaMimeType: extracted.mediaMimeType,
          fileName: extracted.fileName,
          sharedContacts: extracted.sharedContacts,
          replyToMessageId: msg.context?.id,
          timestamp: new Date(parseInt(msg.timestamp) * 1000).toISOString(),
        });

        // 5.11 — Auto opt-out por keyword: se mensagem é só "PARAR"/"STOP"/etc.,
        // grava em marketingOptOuts. O agent ainda pode responder confirmando
        // (mensagem não é descartada — só evita futuras campanhas).
        if (isOptOutKeyword(extracted.content)) {
          try {
            const businessId = await resolveBusinessId('whatsapp', phoneNumberId);
            if (businessId) {
              const identifier = msg.from.toLowerCase(); // E.164 sem +
              const docId = `${businessId}_whatsapp_${identifier.replace(/[^a-z0-9._@+-]/g, '_').slice(0, 200)}`;
              await adminDb.collection('marketingOptOuts').doc(docId).set({
                id: docId,
                businessId,
                channel: 'whatsapp',
                identifier,
                source: 'whatsapp-keyword',
                optedOutAt: new Date().toISOString(),
                reasonText: extracted.content?.slice(0, 100),
              });
              console.log(`[Meta Webhook] Recorded WhatsApp opt-out for ${identifier} (keyword: "${extracted.content}")`);
            }
          } catch (optOutErr) {
            console.error('[Meta Webhook] Failed to record opt-out:', optOutErr);
          }
        }
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
      // resolvedBusinessId hoisted pra reusar no gate de enrichment abaixo.
      let resolvedMediaUrl = attachmentUrl;
      let resolvedBusinessId: string | null = null;
      if (mappedMediaType === 'audio' && attachmentUrl) {
        resolvedBusinessId = await resolveBusinessId(channel, channelIdentifier);
        if (resolvedBusinessId) {
          const pageToken = await getDecryptedPageToken(resolvedBusinessId);
          const stored = await downloadAndUploadAttachment({
            url: attachmentUrl,
            mediaType: 'audio',
            businessId: resolvedBusinessId,
            tempConvId: `${channel}_${event.sender.id}`,
            pageToken: pageToken || undefined,
          }).catch((err) => { console.warn('[Attachment FB] audio store failed:', err); return null; });
          if (stored) resolvedMediaUrl = stored;
        }
      }

      // Humanization: enrich voice notes and images so the agent sees text.
      // Gated por aiAgent.enabled — sem agente autônomo, transcrição vira só
      // poluição visual na bolha + custo OpenAI sem benefício. Quando o
      // resolvedBusinessId não foi setado (mídia não-áudio sem download),
      // resolve-se aqui sob demanda.
      const fallbackLabel = `[${attachmentType === 'file' ? 'Documento' : attachmentType === 'image' ? 'Imagem' : attachmentType === 'video' ? 'Video' : attachmentType === 'audio' ? 'Audio' : 'Anexo'}]`;
      let agentContent = event.message.text || fallbackLabel;
      if (!event.message.text && resolvedMediaUrl
          && (mappedMediaType === 'audio' || mappedMediaType === 'image')) {
        if (!resolvedBusinessId) {
          resolvedBusinessId = await resolveBusinessId(channel, channelIdentifier);
        }
        if (resolvedBusinessId && await isAgentEnabled(resolvedBusinessId)) {
          if (mappedMediaType === 'audio') {
            const { enrichAudio } = await import('@/lib/channels/media-enrichment');
            const enriched = await enrichAudio({ mediaUrl: resolvedMediaUrl });
            if (enriched) agentContent = enriched.content;
          } else if (mappedMediaType === 'image') {
            const { enrichImage } = await import('@/lib/channels/media-enrichment');
            const enriched = await enrichImage({ mediaUrl: resolvedMediaUrl });
            if (enriched) agentContent = enriched.content;
          }
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
        content: agentContent,
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

      // For audio: download and convert OGG→M4A if needed (Instagram rejects OGG, Safari can't play it).
      // resolvedBusinessId hoisted pra reusar no gate de enrichment abaixo (paridade com handleFacebookEvent).
      let resolvedMediaUrl = attachmentUrl;
      let resolvedBusinessId: string | null = null;
      if (mappedMediaType === 'audio' && attachmentUrl) {
        resolvedBusinessId = await resolveBusinessId('instagram', String(accountId));
        if (resolvedBusinessId) {
          const pageToken = await getDecryptedPageToken(resolvedBusinessId);
          const stored = await downloadAndUploadAttachment({
            url: attachmentUrl,
            mediaType: 'audio',
            businessId: resolvedBusinessId,
            tempConvId: `instagram_${event.sender.id}`,
            pageToken: pageToken || undefined,
          }).catch((err) => { console.warn('[Attachment IG] audio store failed:', err); return null; });
          if (stored) resolvedMediaUrl = stored;
        }
      }

      // Humanization: enrich voice notes and images so the agent sees text.
      // Gated por aiAgent.enabled — paridade com WhatsApp e Facebook handlers.
      // Sem agente autônomo, transcrição/descrição vira poluição visual + custo
      // OpenAI sem benefício (operador humano já vê player/imagem na bolha).
      const fallbackLabel = `[${attachmentType === 'file' ? 'Documento' : attachmentType === 'image' ? 'Imagem' : attachmentType === 'video' ? 'Video' : attachmentType === 'audio' ? 'Audio' : 'Anexo'}]`;
      let agentContent = event.message.text || '';
      if (!event.message.text && resolvedMediaUrl
          && (mappedMediaType === 'audio' || mappedMediaType === 'image')) {
        if (!resolvedBusinessId) {
          resolvedBusinessId = await resolveBusinessId('instagram', String(accountId));
        }
        if (resolvedBusinessId && await isAgentEnabled(resolvedBusinessId)) {
          if (mappedMediaType === 'audio') {
            const { enrichAudio } = await import('@/lib/channels/media-enrichment');
            const enriched = await enrichAudio({ mediaUrl: resolvedMediaUrl });
            if (enriched) agentContent = enriched.content;
          } else if (mappedMediaType === 'image') {
            const { enrichImage } = await import('@/lib/channels/media-enrichment');
            const enriched = await enrichImage({ mediaUrl: resolvedMediaUrl });
            if (enriched) agentContent = enriched.content;
          }
        }
      }

      await saveInboundMessage({
        channel: 'instagram',
        channelIdentifier: accountId,
        externalId: String(event.sender.id),
        senderName,
        senderAvatarUrl,
        messageId: event.message.mid,
        content: agentContent,
        conversationPreview: event.message.text || fallbackLabel,
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
/**
 * Resolve { businessId, connectionId } a partir do identificador externo recebido
 * no webhook. Prioridade:
 *  1. channelConnections (modelo novo, suporta múltiplas conexões + canais
 *     pessoais)
 *  2. businesses.channels.* legado (até a migração rodar pra todos os tenants)
 *
 * Quando encontra via legado, dispara lazy migration em background — cria a
 * channelConnection correspondente e retorna o ID dela.
 */
async function resolveChannelContext(
  channel: 'whatsapp' | 'facebook' | 'instagram',
  channelIdentifier: string,
): Promise<{ businessId: string; connectionId: string | null } | null> {
  try {
    // 1. Try channelConnections first
    const typeMap = {
      whatsapp: 'whatsapp_cloud',
      facebook: 'facebook',
      instagram: 'instagram',
    } as const;
    const { resolveChannelConnectionByExternalId, ensureBusinessConnectionsFromLegacy } =
      await import('@/lib/services/channels/channelConnections');
    const conn = await resolveChannelConnectionByExternalId(
      typeMap[channel],
      channelIdentifier,
    );
    if (conn) {
      return { businessId: conn.businessId, connectionId: conn.id };
    }

    // 2. Legacy fallback — same logic as before
    const businessId = await resolveBusinessId(channel, channelIdentifier);
    if (!businessId) return null;
    // Lazy migration: cria channelConnections espelhando businesses.channels.*
    // assíncrono pra não atrasar webhook. Idempotente.
    void ensureBusinessConnectionsFromLegacy(businessId)
      .then((results) => {
        const newCount = results.filter(r => r.wasCreated).length;
        if (newCount > 0) {
          console.log(`[Meta Webhook] Lazy-migrated ${newCount} new channel connection(s) for ${businessId}`);
        }
      })
      .catch((err) => {
        console.warn('[Meta Webhook] Lazy migration failed:', err);
      });
    return { businessId, connectionId: null };
  } catch (err) {
    console.error('[Meta Webhook] resolveChannelContext error:', err);
    return null;
  }
}

async function resolveBusinessId(
  channel: 'whatsapp' | 'facebook' | 'instagram',
  channelIdentifier: string,
): Promise<string | null> {
  try {
    if (channel === 'whatsapp') {
      // Tenta o novo campo isolado primeiro; fallback para legado
      const snapNew = await adminDb.collection('businesses')
        .where('channels.whatsappCloud.phoneNumberId', '==', channelIdentifier)
        .limit(1)
        .get();
      if (!snapNew.empty) return snapNew.docs[0].id;

      const snapLegacy = await adminDb.collection('businesses')
        .where('channels.whatsapp.phoneNumberId', '==', channelIdentifier)
        .limit(1)
        .get();
      return snapLegacy.empty ? null : snapLegacy.docs[0].id;
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

    // Upload via admin SDK (helper compartilhado com o pipeline de mídia).
    const permanentUrl = await uploadServerMedia({
      storagePath: `avatars/meta/${senderId}.jpg`,
      buffer,
      contentType,
    });
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
 * Instagram: fields=name,profile_pic (username is NOT valid on IGSID endpoint)
 * Facebook:  fields=first_name,last_name,profile_pic (falls back to name-only on error)
 */
async function fetchSenderProfile(
  senderId: string,
  pageAccessToken: string,
  channel: 'facebook' | 'instagram' = 'facebook',
): Promise<{ name: string; profilePic?: string } | null> {
  try {
    // Instagram IGSIDs: name + profile_pic only — "username" is NOT a valid field on the
    // IGSID endpoint and causes the entire request to fail with a 400 error.
    // Facebook Messenger PSIDs: first_name + last_name + profile_pic.
    const fields = channel === 'instagram'
      ? 'name,profile_pic'
      : 'first_name,last_name,profile_pic';

    const url = `https://graph.facebook.com/v21.0/${senderId}?fields=${fields}&access_token=${pageAccessToken}`;
    let res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    // If the first call fails (e.g. profile_pic not permitted for this account),
    // retry with name-only fields to at least recover the display name.
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.warn(`[Profile] Fetch failed (${channel}) sender=${senderId} status=${res.status}:`, errorText);

      const fallbackFields = channel === 'instagram' ? 'name' : 'first_name,last_name,name';
      const fallbackUrl = `https://graph.facebook.com/v21.0/${senderId}?fields=${fallbackFields}&access_token=${pageAccessToken}`;
      res = await fetch(fallbackUrl, { signal: AbortSignal.timeout(5000) });

      if (!res.ok) {
        const fallbackError = await res.text().catch(() => '');
        console.warn(`[Profile] Fallback fetch also failed (${channel}) sender=${senderId} status=${res.status}:`, fallbackError);
        return null;
      }
    }

    const data = await res.json();
    console.log(`[Profile] Raw response (${channel}) sender=${senderId}:`, JSON.stringify(data));

    // Build name with best available data
    let name: string;
    if (channel === 'instagram') {
      name = data.name || senderId;
    } else {
      // Facebook: combine first + last, fall back to full name field, then senderId
      if (data.first_name || data.last_name) {
        name = [data.first_name, data.last_name].filter(Boolean).join(' ');
      } else if (data.name) {
        name = data.name;
      } else {
        console.warn(`[Profile] Facebook returned no name fields for sender=${senderId}. Token may not be a Page Access Token.`);
        name = senderId;
      }
    }

    // Resolve profile picture URL.
    // Instagram IGSIDs: profile_pic is a valid inline field.
    // Facebook PSIDs: use the /picture edge (redirect=false) — the industry-standard approach.
    //   The edge returns { data: { url, is_silhouette } }. is_silhouette=true means no real photo.
    let rawPic: string | undefined = data.profile_pic || data.picture?.data?.url || undefined;

    if (channel !== 'instagram' && !rawPic) {
      try {
        const picRes = await fetch(
          `https://graph.facebook.com/v21.0/${senderId}/picture?redirect=false&type=large&access_token=${pageAccessToken}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (picRes.ok) {
          const picData = await picRes.json();
          if (picData?.data?.url && !picData.data.is_silhouette) {
            rawPic = picData.data.url;
          }
        }
      } catch {
        // Non-fatal — profile without picture is acceptable
      }
    }

    // Persist the ephemeral Meta CDN URL to Firebase Storage so it never expires.
    const profilePic = rawPic
      ? await persistProfilePic(rawPic, senderId)
      : undefined;

    if (!rawPic) {
      console.log(`[Profile] No profile picture for ${channel} sender=${senderId} (private account or silhouette)`);
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
    console.log('[Profile] Page token resolved for business', businessId, ':', { hasToken: !!token });
    return token;
  } catch (err) {
    console.error('[Meta Webhook] Error getting page token:', err);
    return null;
  }
}

// ─── Firestore Helpers ────────────────────────────────────────────────────────

/**
 * Formata phone E.164 (sem `+`) para exibição amigável BR.
 * Ex: "5554996785446" → "+55 54 99678-5446"
 *     "5511999998888" → "+55 11 99999-8888"
 *     "555499675546"  → "+55 54 9967-5546" (sem 9 inicial — celular antigo)
 * Não-BR: retorna `+{phone}` sem formatação.
 */
function formatBrPhoneForDisplay(phone: string): string {
  if (!phone) return '';
  if (phone.length === 13 && phone.startsWith('55')) {
    return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} ${phone.slice(4, 9)}-${phone.slice(9)}`;
  }
  if (phone.length === 12 && phone.startsWith('55')) {
    return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} ${phone.slice(4, 8)}-${phone.slice(8)}`;
  }
  return `+${phone}`;
}

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

  // 1. Resolve businessId + channelConnectionId from channel identifier
  // For Instagram DMs arriving via page subscription (object:'page'), the channelIdentifier
  // is event.recipient.id which may be the Instagram account ID or the page ID depending
  // on how Meta structures the payload. If primary lookup fails, try the fallbackPageId
  // (the entry.id = Facebook page ID) which is always reliable.
  let resolved = await resolveChannelContext(params.channel, params.channelIdentifier);

  if (!resolved && params.channel === 'instagram' && params.fallbackPageId) {
    resolved = await resolveChannelContext('facebook', params.fallbackPageId);
    if (resolved) {
      console.log('[Meta Webhook] Instagram resolved via fallbackPageId:', params.fallbackPageId);
    }
  }

  let businessId = resolved?.businessId ?? null;
  const channelConnectionId = resolved?.connectionId ?? null;

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

  // 2. Idempotência atômica via markWebhookSeen (SDD: substitui query+race-window
  //    pela criação atômica de um doc em `webhookSeen/{businessId}_{wamid}`).
  //    Se outro pod já marcou esse wamid, retornamos seen=true e pulamos.
  try {
    const { seen } = await markWebhookSeen(adminDb, {
      businessId,
      externalMessageId: params.messageId,
      source: 'meta_webhook',
    });
    if (seen) {
      console.log('[Meta Webhook] Duplicate message skipped (markWebhookSeen):', params.messageId);
      return;
    }
  } catch (dupErr) {
    console.error('[Meta Webhook] markWebhookSeen failed:', dupErr);
    // Continue processing — better to risk a duplicate than to lose a message
  }

  const now = new Date().toISOString();

  try {
    // 3. Find or create conversation
    //
    // Phase 2 P1.2: cada (contato, canal específico) é uma thread separada.
    // Antes a query só filtrava por contactExternalId — funciona pra Phase 2
    // (1 canal por tipo) mas Phase 3 vai permitir múltiplas Cloud connections
    // por business. Com múltiplas, mesmo contato em canais distintos virava
    // 1 thread só com channelConnectionId pulando — flip-flop confuso.
    //
    // Estratégia: busca até 5 candidates, escolhe o melhor:
    //   1. Match exato (mesmo channelConnectionId)
    //   2. Conversa legada sem channelConnectionId (será backfillada)
    //   3. Nada → cria nova thread (ignora candidates de OUTRO canal)
    //
    // Cross-transport guard: pra `whatsapp`, NUNCA matchar conversa cujo
    // `connectedVia === 'baileys'` — webhook Cloud só pode reivindicar threads
    // Cloud (embedded_signup) ou legadas sem tag de transporte. Sem esse
    // guard, mensagem inbound do Cloud caía em conversa Baileys do mesmo
    // contato e os dois canais se misturavam na UI.
    const isCrossTransportBaileys = (d: FirebaseFirestore.QueryDocumentSnapshot): boolean => {
      if (params.channel !== 'whatsapp') return false;
      return d.data().connectedVia === 'baileys';
    };
    const pickBestCandidate = (
      docs: FirebaseFirestore.QueryDocumentSnapshot[],
    ): FirebaseFirestore.QueryDocumentSnapshot | null => {
      const eligible = docs.filter(d => !isCrossTransportBaileys(d));
      if (!channelConnectionId) {
        // Sem connectionId resolvido (tenant não-migrado): mantém comportamento
        // legado — primeira candidate é o match (mas só entre as elegíveis).
        return eligible[0] || null;
      }
      let legacy: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      for (const d of eligible) {
        const docConnId = d.data().channelConnectionId as string | undefined;
        if (docConnId === channelConnectionId) return d;
        if (!docConnId && !legacy) legacy = d;
      }
      return legacy;
    };

    // Phase 3 audit P1.1: orderBy pra escolha estável quando há 2+ legacies.
    // Run sem orderBy se a query falhar — degrade gracefully se index estiver
    // sendo construído em produção, evita lost-message.
    const safeQuery = async (externalId: string): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> => {
      try {
        return (await adminDb.collection('conversations')
          .where('businessId', '==', businessId)
          .where('channel', '==', params.channel)
          .where('contactExternalId', '==', externalId)
          .orderBy('lastMessageAt', 'desc')
          .limit(5)
          .get()).docs;
      } catch (err) {
        // Fallback sem orderBy se index ausente
        console.warn('[Meta Webhook] orderBy query failed (falling back), index may be missing:', err);
        return (await adminDb.collection('conversations')
          .where('businessId', '==', businessId)
          .where('channel', '==', params.channel)
          .where('contactExternalId', '==', externalId)
          .limit(5)
          .get()).docs;
      }
    };

    // Sempre busca AMBOS os formatos (exact + alt 9-prefix BR) e consolida.
    // Sem isso, quando Meta envia o número sem o 9 mas existe conv com 9 (ou
    // vice-versa), o exact match achava um duplicate antigo em vez de cair
    // pro fuzzy — resultado: campanha caía em conv-A, resposta do cliente
    // caía em conv-B (já que ambas existiam mas a busca exact parou na 1ª).
    // Mergeando + ordenando por lastMessageAt, sempre priorizamos a conv
    // com atividade mais recente — o que naturalmente consolida o histórico.
    let candidateDocs = await safeQuery(params.externalId);

    let altUsed: string | null = null;
    if (params.channel === 'whatsapp') {
      const altPhone = getAlternativeBrazilianPhone(params.externalId);
      if (altPhone) {
        altUsed = altPhone;
        const altDocs = await safeQuery(altPhone);
        if (altDocs.length > 0) {
          // Dedup por id e merge — pickBestCandidate vai escolher o melhor.
          const seen = new Set(candidateDocs.map(d => d.id));
          for (const d of altDocs) if (!seen.has(d.id)) candidateDocs.push(d);
        }
      }
    }

    // Re-ordena merged set por lastMessageAt desc — pickBestCandidate
    // confia que a primeira candidate é a mais recente quando não há
    // channelConnectionId pra tiebreak.
    candidateDocs.sort((a, b) => {
      const ta = (a.data().lastMessageAt as string | undefined) ?? '';
      const tb = (b.data().lastMessageAt as string | undefined) ?? '';
      return tb.localeCompare(ta);
    });

    // Fuzzy fallback 2: últimos 8 dígitos com mesmo DDD — cobre normalizações
    // mais variadas (ex: contato salvo sem código do país, com formatação,
    // ou edge cases que o getAlternativeBrazilianPhone não cobre).
    let last8Used: string | null = null;
    if (candidateDocs.length === 0 && params.channel === 'whatsapp') {
      const digits = params.externalId.replace(/\D/g, '');
      if (digits.length >= 10) {
        // Pega últimos 8 dígitos do número incoming
        const last8 = digits.slice(-8);
        // Pega DDD do incoming (assume 2 dígitos antes dos últimos 8 ou 9)
        const ddd = digits.length >= 11
          ? digits.slice(-11, -9)  // 11+ dígitos: últimos 9 são número, antes é DDD
          : digits.slice(-10, -8); // 10 dígitos: últimos 8 + 2 DDD
        // Busca todas conversas e filtra client-side por DDD+last8 (querying só
        // por contactExternalId LIKE não dá no Firestore — usa scan limitado).
        const allConvs = (await adminDb.collection('conversations')
          .where('businessId', '==', businessId)
          .where('channel', '==', params.channel)
          .limit(100) // limite conservador — usuário típico tem <100 conversas Cloud
          .get()).docs;
        candidateDocs = allConvs.filter(d => {
          // Cross-transport guard: nunca matchar Baileys via fuzzy fallback
          // do webhook Cloud — preserva isolamento entre transportes.
          if (isCrossTransportBaileys(d)) return false;
          const ext = (d.data().contactExternalId as string | undefined)?.replace(/\D/g, '') || '';
          if (!ext || ext.length < 10) return false;
          const docLast8 = ext.slice(-8);
          const docDdd = ext.length >= 11
            ? ext.slice(-11, -9)
            : ext.slice(-10, -8);
          return docLast8 === last8 && docDdd === ddd;
        });
        if (candidateDocs.length > 0) {
          last8Used = `last8=${last8} ddd=${ddd}`;
          console.log(`[Meta Webhook] Found ${candidateDocs.length} match(es) via last-8-digits fallback for ${params.externalId}`);
        }
      }
    }

    const matchedDoc = pickBestCandidate(candidateDocs);

    // Debug log: quando criamos nova conversa, salva metadados pra auditoria
    // posterior. Ajuda a entender por que o match falhou se for caso real
    // (vs. contato verdadeiramente novo).
    if (!matchedDoc) {
      try {
        await adminDb.collection('webhookConvCreates').add({
          businessId,
          channel: params.channel,
          externalId: params.externalId,
          altTried: altUsed,
          last8Tried: last8Used,
          channelConnectionId: channelConnectionId || null,
          senderName: params.senderName || null,
          createdAt: now,
        }).catch(() => {});
      } catch { /* non-blocking */ }
    }

    let conversationId: string;

    if (!matchedDoc) {
      // Create new conversation
      // Para WhatsApp, popula `contactPhone` com o externalId formatado.
      // O Baileys já fazia isso (baileys-manager.ts:340), mas o webhook Cloud
      // antes só populava no auto-link CRM (mais abaixo) — então conversas
      // sem contato CRM ficavam com contactPhone vazio e o header da UI não
      // exibia o número.
      const isWhatsApp = params.channel === 'whatsapp';
      const formattedPhone = isWhatsApp ? formatBrPhoneForDisplay(params.externalId) : undefined;
      const newConvRef = await adminDb.collection('conversations').add({
        businessId,
        channel: params.channel,
        // All Meta webhooks come from the official APIs (Embedded Signup). Tag it so
        // the UI can distinguish from Baileys (WhatsApp Web).
        ...(isWhatsApp ? { connectedVia: 'embedded_signup' } : {}),
        // channelConnectionId: vincula a conversa à conexão específica que recebeu
        // a mensagem. Pode ser null em ambientes ainda não-migrados (lazy
        // migration foi disparada em background no resolveChannelContext).
        ...(channelConnectionId ? { channelConnectionId } : {}),
        // Cloud/FB/IG são sempre 'business' por regra do produto (Embedded Signup
        // do Meta = uma conta por business). Apenas Baileys pode ser 'user'.
        channelOwnerType: 'business',
        contactName: params.senderName ?? params.externalId,
        contactExternalId: params.externalId,
        ...(formattedPhone ? { contactPhone: formattedPhone } : {}),
        ...(params.senderAvatarUrl ? { contactAvatarUrl: params.senderAvatarUrl } : {}),
        status: 'open',
        lastMessage: params.conversationPreview || params.content || '[Midia]',
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        firstInboundFromContactAt: params.timestamp,
        lastInboundFromContactAt: params.timestamp,
        // Conv nova: nao ha outbound anterior, mas keywords ainda podem flagrar
        // (caso raro de contato abrir conversa ja com mensagem de auto-reply).
        ...(detectLikelyBotReply({
          content: params.content ?? '',
          msgTimestampMs: new Date(params.timestamp).getTime(),
          prevOutboundAtMs: null,
        }) ? { firstInboundLikelyBot: true } : {}),
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

        // Fuzzy match: para WhatsApp tenta tanto o formato recebido quanto o
        // alternativo (com/sem 9 inicial BR). Pra outros canais (FB/IG), só exato.
        const altPhoneForLink = params.channel === 'whatsapp'
          ? getAlternativeBrazilianPhone(params.externalId)
          : null;
        const candidates = altPhoneForLink ? [params.externalId, altPhoneForLink] : [params.externalId];

        let matchedContact: FirebaseFirestore.DocumentSnapshot | null = null;
        for (const candidate of candidates) {
          const snap = await adminDb.collection('clients')
            .where('businessId', '==', businessId)
            .where(channelField, '==', candidate)
            .limit(1)
            .get();
          if (!snap.empty) { matchedContact = snap.docs[0]; break; }
        }

        // Fallback adicional para WhatsApp: match por campo `phone` (compatibilidade
        // com clientes importados antes da estrutura channelIdentities).
        if (!matchedContact && params.channel === 'whatsapp') {
          for (const candidate of candidates) {
            const snap = await adminDb.collection('clients')
              .where('businessId', '==', businessId)
              .where('phone', '==', candidate)
              .limit(1)
              .get();
            if (!snap.empty) { matchedContact = snap.docs[0]; break; }
          }
        }

        if (matchedContact) {
          const contactData = matchedContact.data()!;
          await adminDb.doc(`conversations/${conversationId}`).update({
            crmContactId: matchedContact.id,
            contactName: contactData.name || params.senderName || params.externalId,
            contactPhone: contactData.phone || (params.channel === 'whatsapp' ? params.externalId : null),
          });
          await adminDb.doc(`clients/${matchedContact.id}`).update({
            lastConversationId: conversationId,
            lastConversationAt: now,
            // Preserva o formato exato vindo do webhook em channelIdentities
            // (útil quando o registro original tinha formato alternativo).
            ...(params.channel === 'whatsapp' ? { 'channelIdentities.whatsapp': params.externalId } : {}),
            updatedAt: now,
          });
          console.log('[Meta Webhook] Linked conversation to CRM contact:', matchedContact.id);
        }
      } catch (linkErr) {
        // Non-fatal — don't break message processing if CRM link fails
        console.warn('[Meta Webhook] Failed to auto-link CRM contact:', linkErr);
      }

      console.log('[Meta Webhook] Created new conversation:', conversationId);
    } else {
      // Update existing conversation
      conversationId = matchedDoc.id;

      const existingData = matchedDoc.data();

      // Soft-delete guard: only resurrect if the new message is newer than deletedAt.
      // Trata ambos os formatos (legado `isDeleted: true` e novo `deletedAt`).
      const isDeletedConv = !!existingData.deletedAt || existingData.isDeleted === true;
      if (isDeletedConv) {
        const deletedAt = existingData.deletedAt ? new Date(existingData.deletedAt).getTime() : 0;
        const messageAt = new Date(params.timestamp).getTime();
        if (messageAt <= deletedAt) {
          // Message is older than delete — skip silently
          return;
        }
        // New message after delete — resurrect the conversation
        console.log('[Meta Webhook] Resurrecting soft-deleted conversation:', conversationId);
      }

      // Detecção de bot: só roda na PRIMEIRA inbound do contato e se há um
      // outbound anterior pra comparar tempo (caso típico: campanha → resposta).
      // Sem prev outbound, só o teste de palavra-chave roda. Falso positivo
      // baixo — combinamos tempo curto OR palavras-chave, e só na 1ª inbound.
      const isFirstInbound = !existingData.firstInboundFromContactAt;
      let likelyBotPatch: Record<string, unknown> = {};
      if (isFirstInbound) {
        const prevOutboundAtMs = existingData.lastMessageDirection === 'outbound' && existingData.lastMessageAt
          ? new Date(existingData.lastMessageAt as string).getTime()
          : null;
        const isBot = detectLikelyBotReply({
          content: params.content ?? '',
          msgTimestampMs: new Date(params.timestamp).getTime(),
          prevOutboundAtMs,
        });
        if (isBot) likelyBotPatch = { firstInboundLikelyBot: true };
      }

      const enrichUpdate: Record<string, unknown> = {
        lastMessage: params.conversationPreview || params.content || '[Midia]',
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: FieldValue.increment(1),
        updatedAt: now,
        // Clear soft-delete flags on resurrect — limpa AMBOS formatos
        // (contrato novo + legado pre-Fase 2 do plano de soft-delete).
        isDeleted: FieldValue.delete(),
        deletedAt: FieldValue.delete(),
        deletedBy: FieldValue.delete(),
        deletedByName: FieldValue.delete(),
        // first-touch do contato — habilita filtro "Cliente não respondeu".
        // Não sobrescreve; conv pré-campanha onde o contato já respondeu antes
        // mantém o timestamp original.
        ...(isFirstInbound ? { firstInboundFromContactAt: params.timestamp } : {}),
        // last-touch sempre atualiza — alimenta detecção da janela 24h pros
        // lembretes automaticos (isOutsideMetaWindow).
        lastInboundFromContactAt: params.timestamp,
        ...likelyBotPatch,
      };
      // Backfill / correção de channelConnectionId. Preenche se ausente; também
      // corrige se diferente do resolvido — o webhook é autoritativo (sabemos
      // exatamente qual phoneNumberId/pageId/igAccountId entregou esta msg).
      // Antes só preenchia quando ausente, e mapeamentos errados ficavam
      // permanentes. Agora reflete a fonte real do tráfego.
      if (channelConnectionId
          && existingData.channelConnectionId !== channelConnectionId) {
        enrichUpdate.channelConnectionId = channelConnectionId;
      }
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
      // Only update if the incoming name is a real name (not another placeholder or numeric ID).
      // This prevents a failed fetch from "updating" a placeholder with another placeholder,
      // which caused old contacts to stay stuck as "Usuário do Facebook" forever.
      const newNameIsReal = !!params.senderName
        && !PLACEHOLDER_NAMES.includes(params.senderName)
        && !/^\d+$/.test(params.senderName);
      if (newNameIsReal && nameIsPlaceholder) {
        enrichUpdate.contactName = params.senderName;
      }
      // Enrich avatar if missing, if the stored URL is an expiring Meta CDN URL,
      // or if the conversation is being resurrected (re-fetch may have gotten a better photo).
      const currentAvatar = existingData.contactAvatarUrl as string | undefined;
      // Reusa o flag computado no guard (linha ~1758). Cobre ambos formatos.
      const isResurrect = isDeletedConv;
      const newAvatarIsBetter = params.senderAvatarUrl && (
        !currentAvatar
        || currentAvatar.includes('fbcdn.net')
        || (isResurrect && params.senderAvatarUrl.includes('firebasestorage'))
      );
      if (newAvatarIsBetter) {
        enrichUpdate.contactAvatarUrl = params.senderAvatarUrl;
      }
      await adminDb.doc(`conversations/${conversationId}`).update(enrichUpdate);

      console.log('[Meta Webhook] Updated conversation:', conversationId);

      // Auto-link to CRM if not already linked.
      // Antes este branch só tentava match exato, enquanto o branch "nova
      // conversa" usava fuzzy (channelIdentities + phone + getAlternativeBrazilianPhone).
      // Resultado: contatos legacy salvos sem 9º dígito ficavam permanentemente
      // não-linkados se a conversa já existia. Agora aplica a mesma lógica fuzzy.
      if (!existingData.crmContactId) {
        try {
          const channelField = params.channel === 'whatsapp'
            ? 'channelIdentities.whatsapp'
            : params.channel === 'facebook'
            ? 'channelIdentities.facebook'
            : 'channelIdentities.instagram';

          const altPhoneForLink = params.channel === 'whatsapp'
            ? getAlternativeBrazilianPhone(params.externalId)
            : null;
          const candidates = altPhoneForLink ? [params.externalId, altPhoneForLink] : [params.externalId];

          let matchedContact: FirebaseFirestore.DocumentSnapshot | null = null;
          for (const candidate of candidates) {
            const snap = await adminDb.collection('clients')
              .where('businessId', '==', businessId)
              .where(channelField, '==', candidate)
              .limit(1)
              .get();
            if (!snap.empty) { matchedContact = snap.docs[0]; break; }
          }
          if (!matchedContact && params.channel === 'whatsapp') {
            for (const candidate of candidates) {
              const snap = await adminDb.collection('clients')
                .where('businessId', '==', businessId)
                .where('phone', '==', candidate)
                .limit(1)
                .get();
              if (!snap.empty) { matchedContact = snap.docs[0]; break; }
            }
          }

          if (matchedContact) {
            await adminDb.doc(`conversations/${conversationId}`).update({
              crmContactId: matchedContact.id,
            });
            await adminDb.doc(`clients/${matchedContact.id}`).update({
              lastConversationId: conversationId,
              lastConversationAt: now,
              ...(params.channel === 'whatsapp' ? { 'channelIdentities.whatsapp': params.externalId } : {}),
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
      // Mensagens vindas via Meta webhooks são SEMPRE da Cloud API oficial.
      // Marcamos por mensagem (denormalizado) pra UI conseguir mostrar o
      // transporte mesmo se a conversa migrar de canal no futuro.
      ...(params.channel === 'whatsapp' ? { connectedVia: 'embedded_signup' as const } : {}),
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
    if (params.fileName) msgDoc.fileName = params.fileName;
    if (params.sharedContacts?.length) msgDoc.sharedContacts = params.sharedContacts;
    if (params.replyToMessageId) msgDoc.replyToMessageId = params.replyToMessageId;
    if (params.senderAvatarUrl) msgDoc.senderAvatarUrl = params.senderAvatarUrl;
    const msgRef = await adminDb.collection('conversationMessages').add(msgDoc);

    console.log('[Meta Webhook] Saved inbound message for conversation:', conversationId);

    // Dispatch to AI agent (true fire-and-forget — do NOT await, debounce runs inside).
    // Meta webhooks only deliver messages FROM the contact (never operator notes or
    // outbound messages), so isInternal is always false here.
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
        // Meta wamid/mid — needed for combined read-receipt + typing indicator
        externalMessageId: params.messageId,
        // Meta webhooks are always contact-originated inbound — never internal notes
        isInternal: false,
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

  // ── 1. Update conversationMessage (best-effort) ─────────────────────────
  // Antes esse bloco tinha `return` em 2 caminhos (msgSnap empty + status
  // regression) que pulavam os updates de broadcastMessages/birthdayCampaign-
  // Logs abaixo. Resultado: broadcasts agendados onde o upsert de conversa
  // sofresse race com o webhook (ou broadcasts cuja conversa ficou stale)
  // nunca recebiam delivered/read em broadcastMessages — stats agregadas
  // ficavam congeladas em "0 entregue, 0 lida" indefinidamente.
  //
  // Agora o bloco é if/else interno; broadcasts/birthday updates SEMPRE rodam
  // com suas próprias guardas (existence + regression).
  try {
    const msgSnap = await adminDb.collection('conversationMessages')
      .where('externalMessageId', '==', params.messageId)
      .where('businessId', '==', params.businessId)
      .limit(1)
      .get();

    if (msgSnap.empty) {
      // Not an error — could be a status update for a message we didn't send
      // through our system, OR mensagem só de broadcastMessages sem conversa
      // (race com upsertConversationFromBroadcast).
      console.log('[Meta Webhook] No conversationMessage found for externalMessageId:', params.messageId);
    } else {
      const msgDoc = msgSnap.docs[0];
      const currentData = msgDoc.data();

      // Status regression guard — don't go backwards (except 'failed' always applies)
      const currentOrder = STATUS_ORDER[currentData.status] ?? -1;
      const newOrder = STATUS_ORDER[params.status] ?? -1;
      const shouldUpdate = params.status === 'failed' || newOrder > currentOrder;

      if (shouldUpdate) {
        const updateData: Record<string, string | number> = { status: params.status };

        if (params.status === 'delivered') {
          updateData.deliveredAt = params.timestamp;
        }
        if (params.status === 'read') {
          updateData.readAt = params.timestamp;
          if (!currentData.deliveredAt) {
            updateData.deliveredAt = params.timestamp;
          }
        }
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
        console.log('[Meta Webhook] Updated conversationMessage status:', msgDoc.id, '->', params.status);

        // If read, also bump conversation timestamp
        if (params.status === 'read' && currentData.conversationId) {
          try {
            await adminDb.doc(`conversations/${currentData.conversationId}`).update({
              updatedAt: new Date().toISOString(),
            });
          } catch {
            // Non-critical
          }
        }
      }
    }
  } catch (err) {
    console.error('[Meta Webhook] Error updating conversationMessage status:', err);
    // Não retorna — broadcastMessages/birthdayCampaignLogs ainda devem tentar.
  }

  // ── 2. Sempre tenta broadcastMessages ───────────────────────────────────
  // Mensagens enviadas via /api/broadcasts/send criam doc em broadcastMessages
  // independentemente de conversationMessages. Tem guards próprios (existence
  // + regression) — chamada é segura mesmo quando conversationMessages falhou.
  await updateBroadcastMessageStatus(params).catch(err =>
    console.error('[Meta Webhook] Error updating broadcastMessage status:', err)
  );

  // ── 3. Sempre tenta birthdayCampaignLogs ────────────────────────────────
  // Campanhas recorrentes de aniversário. Mesmo padrão — guards próprios,
  // independente de conversationMessages.
  await updateBirthdayCampaignLogStatus(params).catch(err =>
    console.error('[Meta Webhook] Error updating birthdayCampaignLog status:', err)
  );
}

/** Atualiza um BroadcastMessage por externalMessageId — invocado a partir de updateMessageStatus. */
async function updateBroadcastMessageStatus(params: {
  businessId: string;
  messageId: string;
  status: string;
  timestamp: string;
  errors?: Array<{ code: number; title: string }>;
}): Promise<void> {
  const snap = await adminDb.collection('broadcastMessages')
    .where('externalMessageId', '==', params.messageId)
    .where('businessId', '==', params.businessId)
    .limit(1)
    .get();
  if (snap.empty) return;

  const doc = snap.docs[0];
  const current = doc.data();
  const currentOrder = STATUS_ORDER[current.status] ?? -1;
  const newOrder = STATUS_ORDER[params.status] ?? -1;
  // Status regression guard — nunca volta atrás (exceto 'failed' que sempre aplica)
  if (params.status !== 'failed' && newOrder <= currentOrder) return;

  const update: Record<string, string | number> = { status: params.status };
  if (params.status === 'delivered') update.deliveredAt = params.timestamp;
  if (params.status === 'read') {
    update.readAt = params.timestamp;
    if (!current.deliveredAt) update.deliveredAt = params.timestamp;
  }
  if (params.status === 'failed' && params.errors?.length) {
    const firstError = params.errors[0];
    update.errorMessage = firstError.title;
  }

  await doc.ref.update(update);

  // Atualiza stats agregados no Broadcast pai (incremento de delivered/read)
  if (current.broadcastId && (params.status === 'delivered' || params.status === 'read')) {
    const field = params.status === 'delivered' ? 'stats.delivered' : 'stats.read';
    const { FieldValue } = await import('firebase-admin/firestore');
    await adminDb.collection('broadcasts').doc(current.broadcastId).update({
      [field]: FieldValue.increment(1),
      updatedAt: new Date().toISOString(),
    }).catch(() => {/* doc pode ter sido deletado */});
  }
}

/**
 * Atualiza birthdayCampaignLogs por externalMessageId — espelha o que
 * updateBroadcastMessageStatus faz pra broadcastMessages, mas pra logs
 * de campanhas recorrentes. Campanha pai recebe incremento atômico nas
 * stats `totalDelivered` / `totalRead`.
 *
 * Status regression guard idêntico (nunca volta atrás, 'failed' sempre
 * aplica). Idempotente — multiple deliveries do mesmo wamid não
 * incrementam 2x graças ao guard.
 */
async function updateBirthdayCampaignLogStatus(params: {
  businessId: string;
  messageId: string;
  status: string;
  timestamp: string;
  errors?: Array<{ code: number; title: string }>;
}): Promise<void> {
  const snap = await adminDb.collection('birthdayCampaignLogs')
    .where('externalMessageId', '==', params.messageId)
    .where('businessId', '==', params.businessId)
    .limit(1)
    .get();
  if (snap.empty) return;

  const doc = snap.docs[0];
  const current = doc.data();
  const currentOrder = STATUS_ORDER[current.status] ?? -1;
  const newOrder = STATUS_ORDER[params.status] ?? -1;
  if (params.status !== 'failed' && newOrder <= currentOrder) return;

  const update: Record<string, string | number> = { status: params.status };
  if (params.status === 'delivered') update.deliveredAt = params.timestamp;
  if (params.status === 'read') {
    update.readAt = params.timestamp;
    if (!current.deliveredAt) update.deliveredAt = params.timestamp;
  }
  if (params.status === 'failed' && params.errors?.length) {
    update.errorMessage = params.errors[0].title;
  }

  await doc.ref.update(update);

  if (current.campaignId && (params.status === 'delivered' || params.status === 'read')) {
    const field = params.status === 'delivered' ? 'stats.totalDelivered' : 'stats.totalRead';
    const { FieldValue } = await import('firebase-admin/firestore');
    await adminDb.collection('birthdayCampaigns').doc(current.campaignId).update({
      [field]: FieldValue.increment(1),
      updatedAt: new Date().toISOString(),
    }).catch(() => {/* doc pode ter sido deletado */});
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
        fileName: msg.document?.filename,
      };
    case 'sticker':
      return { content: '', mediaId: msg.sticker?.id };
    case 'location':
      return { content: `[Localizacao: ${msg.location?.latitude}, ${msg.location?.longitude}]` };
    case 'contacts': {
      // Meta envia contacts[] com { name: { formatted_name }, phones: [{ phone }] }.
      // Parseia pra estrutura própria + gera preview "📇 Nome (e N outros)".
      const rawContacts = msg.contacts || [];
      const sharedContacts = rawContacts.map(c => {
        const name = c.name?.formatted_name?.trim() || 'Contato';
        const phones = (c.phones || [])
          .map(p => p.phone?.trim())
          .filter((p): p is string => !!p);
        return phones.length > 0 ? { name, phones } : { name };
      });
      const first = sharedContacts[0];
      const preview = !first
        ? '📇 Contato'
        : sharedContacts.length === 1
          ? `📇 ${first.name}`
          : `📇 ${first.name} (e ${sharedContacts.length - 1} outro${sharedContacts.length > 2 ? 's' : ''})`;
      return { content: preview, sharedContacts };
    }
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
