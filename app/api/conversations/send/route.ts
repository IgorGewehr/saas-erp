/**
 * Outbound Message Sender
 *
 * Sends messages to contacts via Meta APIs:
 *  - WhatsApp Business Cloud API
 *  - Facebook Messenger Platform
 *  - Instagram Messaging API
 *
 * POST /api/conversations/send
 * Body: { businessId, conversationId, messageId, channel, recipientId, content }
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import crypto from 'crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { sessions } from '@/app/api/whatsapp/baileys-manager';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage as firebaseStorage } from '@/lib/config/firebase';
import type {
  ConversationChannel,
  ChannelCredentials,
} from '@/lib/types';



// ─── Types ───────────────────────────────────────────────────────────────────

interface SendRequestBody {
  businessId: string;
  conversationId: string;
  messageId?: string; // local message ID to update status after send
  messageDocId?: string; // Firestore document ID for retry
  channel: ConversationChannel;
  recipientId: string;
  content: string;
  type?: 'text' | 'template' | 'media'; // message type (default: text)
  templateName?: string; // WhatsApp template name (e.g. 'hello_world')
  templateLanguage?: string; // template language code (e.g. 'pt_BR')
  templateParams?: unknown[]; // template component parameters
  mediaUrl?: string; // URL of the media file (Firebase Storage)
  mediaType?: 'image' | 'video' | 'audio' | 'document'; // type of media
}

interface MetaApiResponse {
  messages?: Array<{ id: string }>;
  message_id?: string;
  recipient_id?: string;
  error?: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;   // e.g. 2018109 = 24h window, 2018141 = insufficient permission
    error_data?: unknown;
    fbtrace_id?: string;
  };
}

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// ─── Meta Error Handling ─────────────────────────────────────────────────────

function handleMetaApiError(
  response: Response,
  data: MetaApiResponse,
  channelLabel: string,
): never {
  const errorCode = data.error?.code;
  const errorSubcode = data.error?.error_subcode;
  const errorMsg = data.error?.message ?? `API retornou status ${response.status}`;
  const fbtrace = data.error?.fbtrace_id ?? '';

  // Always log the full error detail so Netlify logs show subcode
  console.error(`[Send] Meta API error [${channelLabel}] code=${errorCode} subcode=${errorSubcode} trace=${fbtrace} msg="${errorMsg}"`);

  // Map known Meta error codes + subcodes to actionable messages
  // Subcodes take priority — same code can mean very different things
  let userMessage: string;
  let shouldRetry = false;

  // ── Messenger Platform subcodes (Facebook / Instagram DM) ──────────────────
  // 2018109 = Cannot message users who are not connected to your page (outside 24h window)
  // 2018141 = Insufficient permission for this action (wrong scope)
  // 2018108 = Cannot send to a user who has blocked messages from your page
  // 2018065 = This message is outside of the allowed window
  if (errorSubcode === 2018109 || errorSubcode === 2018065) {
    userMessage = 'Janela de 24h encerrada. Aguarde uma mensagem do contato para reabrir a janela.';
  } else if (errorSubcode === 2018141) {
    userMessage = 'Permissao insuficiente. Reconecte o canal em Configuracoes para gerar um token com as permissoes aprovadas.';
  } else if (errorSubcode === 2018108) {
    userMessage = 'O contato bloqueou mensagens da sua pagina.';
  } else {
    switch (errorCode) {
      case 130429:
        userMessage = 'Limite de envio atingido. Tente novamente em alguns segundos.';
        shouldRetry = true;
        break;
      case 131047:
        userMessage = 'Fora da janela de 24h. Use uma mensagem de template.';
        break;
      case 131051:
        userMessage = 'Tipo de mensagem nao suportado para este canal.';
        break;
      case 131026:
        userMessage = 'Numero invalido ou destinatario nao esta no WhatsApp.';
        break;
      case 131030:
        userMessage = 'Numero nao esta na lista permitida. O app Meta ainda esta em modo de desenvolvimento — adicione o numero no Meta Developer Dashboard ou publique o app em modo Live.';
        break;
      case 190:
        userMessage = 'Token de acesso expirado. Reconecte o canal em Configuracoes.';
        break;
      case 368:
        userMessage = 'Conta temporariamente bloqueada por violacao de politicas.';
        break;
      case 3:
        userMessage = 'O aplicativo nao tem permissao para esta chamada de API. Reconecte o canal para gerar um token com as permissoes aprovadas.';
        break;
      case 10:
        userMessage = 'Permissao negada. Reconecte o canal em Configuracoes para renovar o token.';
        break;
      case 200:
      case 230:
        userMessage = 'Permissao de escrita ausente no token. Reconecte o canal em Configuracoes.';
        break;
      default:
        userMessage = `Falha ao enviar via ${channelLabel}: ${errorMsg}`;
    }
  }

  throw new Error(JSON.stringify({
    message: userMessage,
    code: errorCode,
    subcode: errorSubcode,
    shouldRetry,
    originalError: errorMsg,
    fbtrace,
  }));
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`send:${clientIp}`, 30, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded. Tente novamente em breve.' }, { status: 429 });
  }

  try {
    // Read the body as text first so we can (a) verify HMAC when agent-signed and (b) reuse it as JSON.
    const rawBody = await req.text();
    const body: SendRequestBody = JSON.parse(rawBody);
    const { businessId, conversationId, messageId, messageDocId, channel, recipientId, content, type, templateName, templateLanguage, templateParams, mediaUrl, mediaType } = body;

    // Authentication: accept either a Firebase session (UI) or an HMAC-signed agent call.
    const agentSignature = req.headers.get('x-agent-signature');
    if (agentSignature) {
      const timestampStr = req.headers.get('x-agent-timestamp');
      const headerBusinessId = req.headers.get('x-business-id');
      const secret = process.env.AGENT_SHARED_SECRET;
      if (!secret) {
        return NextResponse.json({ error: 'Agent auth not configured' }, { status: 500 });
      }
      if (!timestampStr || !headerBusinessId || headerBusinessId !== businessId) {
        return NextResponse.json({ error: 'Invalid agent headers' }, { status: 401 });
      }
      const ts = Number(timestampStr);
      if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
        return NextResponse.json({ error: 'Stale agent timestamp' }, { status: 401 });
      }
      const message = `${ts}.${headerBusinessId}.${rawBody}`;
      const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
      const ok = agentSignature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(agentSignature, 'hex'), Buffer.from(expected, 'hex'));
      if (!ok) {
        return NextResponse.json({ error: 'Invalid agent signature' }, { status: 401 });
      }
    } else {
      const authResult = await verifyAuth(req, businessId);
      if (isAuthError(authResult)) return authResult;
    }

    // Validate required fields
    const isMedia = type === 'media';
    if (!businessId || !channel || !recipientId || (!content && !isMedia)) {
      return NextResponse.json(
        { error: 'Campos obrigatórios: businessId, channel, recipientId, content' },
        { status: 400 },
      );
    }

    if (isMedia && !mediaUrl) {
      return NextResponse.json(
        { error: 'mediaUrl obrigatório para mensagens de mídia' },
        { status: 400 },
      );
    }

    if (!['whatsapp', 'facebook', 'instagram'].includes(channel)) {
      return NextResponse.json(
        { error: `Canal inválido: ${channel}. Use whatsapp, facebook ou instagram.` },
        { status: 400 },
      );
    }

    // Fix S4: Template params validation
    if (type === 'template') {
      if (!templateName) {
        return NextResponse.json({ error: 'templateName e obrigatorio para mensagens de template' }, { status: 400 });
      }
      // Validate templateParams is an array if provided
      if (templateParams && !Array.isArray(templateParams)) {
        return NextResponse.json({ error: 'templateParams deve ser um array' }, { status: 400 });
      }
    }

    // Fetch business document to get channel credentials
    const businessRef = adminDb.collection('businesses').doc(businessId);
    const businessSnap = await businessRef.get();

    if (!businessSnap.exists) {
      return NextResponse.json(
        { error: 'Empresa não encontrada' },
        { status: 404 },
      );
    }

    const businessData = businessSnap.data();
    const channels: ChannelCredentials | undefined = businessData?.channels;

    if (!channels) {
      return NextResponse.json(
        { error: 'Nenhum canal de comunicação configurado para esta empresa', code: 'disconnected' },
        { status: 400 },
      );
    }

    // ── Channel connectivity pre-check ──────────────────────────────────────
    const channelLabel: Record<string, string> = {
      whatsapp: 'WhatsApp',
      facebook: 'Facebook Messenger',
      instagram: 'Instagram',
    };

    const channelConfig = channels[channel as keyof ChannelCredentials];
    if (!channelConfig || typeof channelConfig !== 'object') {
      return NextResponse.json({
        error: `${channelLabel[channel] || channel} não está configurado. Conecte o canal em Configurações.`,
        code: 'disconnected',
      }, { status: 400 });
    }

    if ('isConnected' in channelConfig && !channelConfig.isConnected) {
      return NextResponse.json({
        error: `${channelLabel[channel] || channel} está desconectado. Reconecte nas Configurações.`,
        code: 'disconnected',
      }, { status: 400 });
    }

    // Skip token checks for Baileys connections (no token needed)
    const isBaileysChannel = channel === 'whatsapp' &&
      'connectedVia' in channelConfig &&
      channelConfig.connectedVia === 'baileys';

    if (!isBaileysChannel) {
      // Token presence check
      const tokenField = channel === 'whatsapp' ? 'accessToken'
        : channel === 'facebook' ? 'pageAccessToken'
        : 'accessToken';

      if (tokenField in channelConfig && !channelConfig[tokenField as keyof typeof channelConfig]) {
        return NextResponse.json({
          error: `Token do ${channelLabel[channel] || channel} ausente. Reconecte o canal em Configurações.`,
          code: 'disconnected',
        }, { status: 400 });
      }
    }

    // Token expiry pre-check
    if ('tokenExpiresAt' in channelConfig && channelConfig.tokenExpiresAt) {
      const expiresAt = new Date(channelConfig.tokenExpiresAt as string).getTime();
      if (Date.now() > expiresAt) {
        return NextResponse.json({
          error: `Token do ${channelLabel[channel] || channel} expirado. Reconecte o canal em Configurações.`,
          code: 'token_expired',
        }, { status: 400 });
      }
      if (Date.now() > expiresAt - 7 * 24 * 60 * 60 * 1000) {
        console.warn('[Send Message] Token expiring soon for', channel, 'business:', businessId);
      }
    }

    // Send via the appropriate Meta API
    let result: { externalMessageId: string };

    const mediaOpts = isMedia ? { mediaUrl: mediaUrl!, mediaType: mediaType || 'document' as const } : undefined;

    switch (channel) {
      case 'whatsapp': {
        // Check if this business uses Baileys (WhatsApp Web) or Cloud API
        const waConfig = channels.whatsapp;
        const isBaileys = waConfig && 'connectedVia' in waConfig && waConfig.connectedVia === 'baileys';

        if (isBaileys) {
          result = await sendWhatsAppBaileys(businessId, recipientId, content, conversationId);
        } else {
          result = await sendWhatsApp(channels, recipientId, content, {
            type: type || 'text',
            templateName,
            templateLanguage,
            templateParams,
            media: mediaOpts,
          });
        }
        break;
      }
      case 'facebook':
        result = await sendFacebookMessenger(channels, recipientId, content, mediaOpts);
        break;
      case 'instagram': {
        const igMediaOpts = await prepareMediaForInstagram(mediaOpts, businessId);
        result = await sendInstagram(channels, recipientId, content, igMediaOpts);
        break;
      }
      default:
        return NextResponse.json(
          { error: `Canal não suportado: ${channel}` },
          { status: 400 },
        );
    }

    // Update or create the message record in Firestore
    const docIdToUpdate = messageDocId || messageId;
    if (docIdToUpdate) {
      await updateMessageAfterSend(docIdToUpdate, result.externalMessageId, businessId);
    } else if (conversationId) {
      // Agent-originated send: no pre-existing doc — create one so it appears in the UI
      await saveAgentMessage(businessId, conversationId, channel, content, result.externalMessageId);
    }

    return NextResponse.json({
      ok: true,
      success: true,
      externalMessageId: result.externalMessageId,
    });

  } catch (error: unknown) {
    let message = 'Erro ao enviar mensagem';
    let statusCode = 400;
    let errorDetails: Record<string, unknown> = {};

    if (error instanceof Error) {
      const rawMsg = error.message;

      // Check for disconnected/missing channel errors
      if (rawMsg.includes('não está conectado') || rawMsg.includes('incompletas') || rawMsg.includes('ausente')) {
        return NextResponse.json({ error: rawMsg, code: 'disconnected' }, { status: 400 });
      }

      try {
        errorDetails = JSON.parse(rawMsg);
        message = errorDetails.message as string;
        if (errorDetails.code === 190) statusCode = 401;
      } catch {
        message = rawMsg;
      }
    }

    console.error('[Send Message] Error:', message, errorDetails);
    return NextResponse.json({ error: message, code: 'send_failed', ...errorDetails }, { status: statusCode });
  }
}

// ─── WhatsApp via Baileys (WhatsApp Web) ─────────────────────────────────────

async function sendWhatsAppBaileys(
  businessId: string,
  recipientId: string,
  content: string,
  conversationId: string,
): Promise<{ externalMessageId: string }> {
  const session = sessions.get(businessId);

  if (!session || !session.sock) {
    throw new Error('WhatsApp Web não está conectado. Reconecte escaneando o QR Code em Configurações.');
  }

  if (!session.isConnected) {
    throw new Error('WhatsApp Web está reconectando. Tente novamente em alguns segundos.');
  }

  // ── Resolve the REAL phone number from the conversation document ──
  // The frontend sends contactExternalId as recipientId, but for Facebook
  // conversations that's a PSID (not a phone number). We MUST read the
  // conversation doc and extract the actual phone.
  let phoneNumber: string | null = null;

  if (conversationId) {
    try {
      const convSnap = await adminDb.collection('conversations').doc(conversationId).get();
      if (convSnap.exists) {
        const convData = convSnap.data()!;

        // Priority 1: contactPhone is always a real phone (formatted by our listener)
        // e.g. "+55 21 99999-9999" → strip to "5521999999999"
        if (convData.contactPhone) {
          const stripped = convData.contactPhone.replace(/[^0-9]/g, '');
          if (stripped.length >= 10 && stripped.length <= 13) {
            phoneNumber = stripped;
          }
        }

        // Priority 2: contactExternalId — but ONLY if it looks like a BR phone
        // (starts with country code 55 and has 12-13 digits).
        // PSIDs and Facebook IDs are 15-17 digits and never start with 55.
        if (!phoneNumber && convData.contactExternalId) {
          const ext = convData.contactExternalId.replace(/[^0-9]/g, '');
          if (/^55\d{10,11}$/.test(ext)) {
            phoneNumber = ext;
          }
        }

        console.log('[Baileys Send] Resolved phone from conversation:', {
          contactPhone: convData.contactPhone,
          contactExternalId: convData.contactExternalId,
          resolved: phoneNumber,
        });
      }
    } catch (err) {
      console.warn('[Baileys Send] Erro ao buscar conversa:', err);
    }
  }

  // Fallback: try recipientId itself if it looks like a phone number
  if (!phoneNumber) {
    const fallback = recipientId.replace(/[^0-9]/g, '');
    if (/^55\d{10,11}$/.test(fallback)) {
      phoneNumber = fallback;
    }
  }

  if (!phoneNumber) {
    throw new Error(
      `Nao foi possivel identificar o numero de telefone do destinatario. ` +
      `recipientId recebido: ${recipientId}. Verifique os dados da conversa.`
    );
  }

  // ── Validate number and resolve correct JID ──
  const candidateJid = `${phoneNumber}@s.whatsapp.net`;

  let targetJid = candidateJid;

  try {
    // onWhatsApp validates the number and returns the canonical JID
    // (handles Brazil's 9th digit ambiguity automatically)
    const [result] = await session.sock.onWhatsApp(candidateJid);
    if (result?.exists && result.jid) {
      targetJid = result.jid;
    } else {
      console.warn(`[Baileys Send] Numero ${phoneNumber} nao foi encontrado no onWhatsApp. Tentando enviar mesmo assim.`);
    }
  } catch (err) {
    console.warn('[Baileys Send] onWhatsApp falhou, tentando envio direto:', (err as Error).message);
  }

  // ── Send message ──
  try {
    const sent = await session.sock.sendMessage(targetJid, { text: content });
    const externalMessageId = sent?.key?.id || `baileys_${Date.now()}`;

    return { externalMessageId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack?.split('\n').slice(0, 3).join(' | ') : '';
    console.error('[Baileys Send] Erro ao enviar mensagem:', {
      jid: targetJid,
      error: errorMsg,
      stack: errorStack,
    });
    throw new Error('Falha ao enviar mensagem via WhatsApp Web. Verifique a conexão.');
  }
}

// ─── WhatsApp Cloud API ──────────────────────────────────────────────────────

interface MediaOptions {
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'audio' | 'document';
}

interface WhatsAppTemplateOptions {
  type?: 'text' | 'template' | 'media';
  templateName?: string;
  templateLanguage?: string;
  templateParams?: unknown[];
  media?: MediaOptions;
}

async function sendWhatsApp(
  channels: ChannelCredentials,
  recipientId: string,
  content: string,
  templateOptions?: WhatsAppTemplateOptions,
): Promise<{ externalMessageId: string }> {
  const whatsapp = channels.whatsapp;

  if (!whatsapp || !whatsapp.isConnected) {
    throw new Error('Canal WhatsApp não está conectado');
  }

  if (!whatsapp.phoneNumberId || !whatsapp.accessToken) {
    throw new Error('Credenciais do WhatsApp incompletas (phoneNumberId ou accessToken ausente)');
  }

  const accessToken = await decryptToken(whatsapp.accessToken);

  // Build message body based on type (text, template, or media)
  let messageBody: Record<string, unknown>;

  if (templateOptions?.type === 'template') {
    messageBody = {
      messaging_product: 'whatsapp',
      to: recipientId,
      type: 'template',
      template: {
        name: templateOptions.templateName || 'hello_world',
        language: { code: templateOptions.templateLanguage || 'pt_BR' },
        ...(templateOptions.templateParams ? { components: templateOptions.templateParams } : {}),
      },
    };
  } else if (templateOptions?.type === 'media' && templateOptions.media) {
    const { mediaUrl, mediaType } = templateOptions.media;
    // WhatsApp media message format
    messageBody = {
      messaging_product: 'whatsapp',
      to: recipientId,
      type: mediaType,
      [mediaType]: {
        link: mediaUrl,
        ...(mediaType !== 'audio' ? { caption: content || undefined } : {}),
      },
    };
  } else {
    messageBody = {
      messaging_product: 'whatsapp',
      to: recipientId,
      type: 'text',
      text: { body: content, preview_url: true },
    };
  }

  const response = await fetch(
    `${META_BASE_URL}/${whatsapp.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageBody),
    },
  );

  const data: MetaApiResponse = await response.json();

  if (!response.ok || data.error) {
    handleMetaApiError(response, data, 'WhatsApp');
  }

  const externalMessageId = data.messages?.[0]?.id;
  if (!externalMessageId) {
    throw new Error('WhatsApp API não retornou ID da mensagem');
  }

  return { externalMessageId };
}

// ─── Facebook Messenger ──────────────────────────────────────────────────────

async function sendFacebookMessenger(
  channels: ChannelCredentials,
  recipientId: string,
  content: string,
  media?: MediaOptions,
): Promise<{ externalMessageId: string }> {
  const facebook = channels.facebook;

  if (!facebook || !facebook.isConnected) {
    throw new Error('Canal Facebook Messenger não está conectado');
  }

  if (!facebook.pageAccessToken) {
    throw new Error('Credenciais do Facebook incompletas (pageAccessToken ausente)');
  }

  const pageAccessToken = await decryptToken(facebook.pageAccessToken);

  // Build message payload - media or text
  const messagePayload = media
    ? {
        attachment: {
          type: media.mediaType === 'document' ? 'file' : media.mediaType,
          payload: { url: media.mediaUrl, is_reusable: true },
        },
      }
    : { text: content };

  const response = await fetch(
    `${META_BASE_URL}/me/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pageAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: messagePayload,
      }),
    },
  );

  const data: MetaApiResponse = await response.json();

  if (!response.ok || data.error) {
    handleMetaApiError(response, data, 'Facebook');
  }

  const externalMessageId = data.message_id;
  if (!externalMessageId) {
    throw new Error('Facebook API não retornou ID da mensagem');
  }

  return { externalMessageId };
}

// ─── Instagram Messaging ─────────────────────────────────────────────────────

// ─── Audio Conversion (OGG → M4A for Instagram) ─────────────────────────────

/**
 * Instagram Direct only accepts AAC audio (.m4a / .mp4).
 * When sending OGG/Opus (from WhatsApp or browser recordings),
 * we convert to M4A via ffmpeg before uploading.
 */
async function convertOggToM4a(oggUrl: string, businessId: string): Promise<string> {
  const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  const { Readable, PassThrough } = await import('stream');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { writeFile, readFile, unlink } = await import('fs/promises');

  ffmpeg.setFfmpegPath(ffmpegInstaller.path);

  // 1. Download OGG from Firebase Storage
  const res = await fetch(oggUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Failed to download OGG: ${res.status}`);
  const oggBuffer = Buffer.from(await res.arrayBuffer());

  // 2. Convert via temp files (ffmpeg needs seekable I/O for M4A)
  const inputPath = join(tmpdir(), `input_${Date.now()}.ogg`);
  const outputPath = join(tmpdir(), `output_${Date.now()}.m4a`);

  await writeFile(inputPath, oggBuffer);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('aac')
      .audioBitrate('128k')
      .audioChannels(1)
      .format('ipod') // M4A container
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath);
  });

  const m4aBuffer = await readFile(outputPath);

  // 3. Cleanup temp files
  await unlink(inputPath).catch(() => {});
  await unlink(outputPath).catch(() => {});

  // 4. Upload converted file to Firebase Storage
  const storagePath = `conversations/${businessId}/converted/${Date.now()}_audio.m4a`;
  const storageRef = ref(firebaseStorage, storagePath);
  await uploadBytes(storageRef, m4aBuffer, { contentType: 'audio/mp4' });

  return getDownloadURL(storageRef);
}

/**
 * Pre-processes media options for Instagram.
 * Converts unsupported audio formats (OGG) to M4A (AAC).
 */
async function prepareMediaForInstagram(
  media: MediaOptions | undefined,
  businessId: string,
): Promise<MediaOptions | undefined> {
  if (!media) return media;
  if (media.mediaType !== 'audio') return media;

  // Check if the URL points to an OGG file
  const url = media.mediaUrl.toLowerCase();
  const isOgg = url.includes('.ogg') || url.includes('.opus') || url.includes('.webm');
  if (!isOgg) return media;

  console.warn('[Send] Converting OGG audio to M4A for Instagram compatibility');
  const convertedUrl = await convertOggToM4a(media.mediaUrl, businessId);
  return { ...media, mediaUrl: convertedUrl };
}

// ─── Instagram Messaging API ────────────────────────────────────────────────

async function sendInstagram(
  channels: ChannelCredentials,
  recipientId: string,
  content: string,
  media?: MediaOptions,
): Promise<{ externalMessageId: string }> {
  const instagram = channels.instagram;
  const facebook = channels.facebook;

  if (!instagram || !instagram.isConnected) {
    throw new Error('Canal Instagram não está conectado');
  }

  // We need the Facebook Page access token to send Instagram DMs.
  // Instagram DMs that arrive via page subscription (object:"page") must be
  // replied to using POST /{page-id}/messages with pages_messaging permission.
  // Using POST /{ig-account-id}/messages requires instagram_business_manage_messages
  // which needs separate Meta App Review — error 3 "does not have capability".
  if (!facebook?.pageAccessToken || !facebook?.pageId) {
    throw new Error(
      'Credenciais do Instagram incompletas: a Página do Facebook vinculada é necessária para enviar mensagens. ' +
      'Reconecte o canal em Configurações.',
    );
  }

  const pageAccessToken = await decryptToken(facebook.pageAccessToken);
  const pageId = facebook.pageId;

  // Build message payload - media or text
  const messagePayload = media
    ? {
        attachment: {
          type: media.mediaType === 'document' ? 'file' : media.mediaType,
          payload: { url: media.mediaUrl },
        },
      }
    : { text: content };

  // POST /{page-id}/messages with the IGSID (Instagram Scoped User ID) as recipient.
  // This uses pages_messaging permission (approved) and works for all Instagram DMs
  // that arrived via page-level webhook subscription — no separate App Review needed.
  const response = await fetch(
    `${META_BASE_URL}/${pageId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pageAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: messagePayload,
      }),
    },
  );

  const data: MetaApiResponse = await response.json();

  if (!response.ok || data.error) {
    // Error code 10 = 24h messaging window is closed (contact must message first).
    if (data.error?.code === 10) {
      throw new Error(JSON.stringify({
        message: 'Janela de 24h encerrada. Aguarde uma nova mensagem do contato para abrir a janela novamente.',
        code: 10,
        shouldRetry: false,
        originalError: data.error?.message,
      }));
    }
    handleMetaApiError(response, data, 'Instagram');
  }

  const externalMessageId = data.message_id;
  if (!externalMessageId) {
    throw new Error('Instagram API não retornou ID da mensagem');
  }

  return { externalMessageId };
}

// ─── Firestore Helpers ───────────────────────────────────────────────────────

async function saveAgentMessage(
  businessId: string,
  conversationId: string,
  channel: string,
  content: string,
  externalMessageId: string,
) {
  try {
    const now = new Date().toISOString();
    await adminDb.collection('conversationMessages').add({
      conversationId,
      businessId,
      channel,
      direction: 'outbound',
      content,
      status: 'sent',
      senderName: 'IA',
      externalMessageId,
      sentAt: now,
      createdAt: now,
    });
    await adminDb.collection('conversations').doc(conversationId).update({
      lastMessage: content,
      lastMessageAt: now,
      lastMessageDirection: 'outbound',
      updatedAt: now,
    });
  } catch (err) {
    console.error('[Send Message] Failed to save agent message to Firestore:', err);
  }
}

async function updateMessageAfterSend(
  messageId: string,
  externalMessageId: string,
  businessId: string,
) {
  try {
    // Try direct doc update first (if messageId is the Firestore document ID)
    const msgRef = adminDb.collection('conversationMessages').doc(messageId);
    const msgSnap = await msgRef.get();

    if (msgSnap.exists) {
      await msgRef.update({
        status: 'sent',
        externalMessageId,
      });
      return;
    }

    // Fallback: query by a custom field if the ID is application-level
    const snap = await adminDb.collection('conversationMessages')
      .where('id', '==', messageId)
      .where('businessId', '==', businessId)
      .limit(1)
      .get();

    if (!snap.empty) {
      await snap.docs[0].ref.update({
        status: 'sent',
        externalMessageId,
      });
    }
  } catch (err) {
    // Non-critical — log but don't fail the request
    console.error('[Send Message] Failed to update message status:', err);
  }
}
