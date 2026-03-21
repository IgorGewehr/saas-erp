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
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
} from 'firebase/firestore';
import { decryptToken } from '@/lib/utils/encryption';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import { sessions } from '@/app/api/whatsapp/baileys-manager';
import type {
  ConversationChannel,
  ChannelCredentials,
} from '@/lib/types';

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
  const errorMsg = data.error?.message ?? `API retornou status ${response.status}`;

  // Map known Meta error codes to actionable messages
  let userMessage: string;
  let shouldRetry = false;

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
    case 190:
      userMessage = 'Token de acesso expirado. Reconecte o canal em Configuracoes.';
      break;
    case 368:
      userMessage = 'Conta temporariamente bloqueada por violacao de politicas.';
      break;
    case 10:
      userMessage = 'Permissao negada. Verifique as permissoes do canal.';
      break;
    default:
      userMessage = `Falha ao enviar via ${channelLabel}: ${errorMsg}`;
  }

  throw new Error(JSON.stringify({
    message: userMessage,
    code: errorCode,
    shouldRetry,
    originalError: errorMsg,
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
    // Parse body first so we can verify businessId ownership
    const body: SendRequestBody = await req.json();
    const { businessId, conversationId, messageId, messageDocId, channel, recipientId, content, type, templateName, templateLanguage, templateParams, mediaUrl, mediaType } = body;

    // Verify authentication and business ownership
    const authResult = await verifyAuth(req, businessId);
    if (isAuthError(authResult)) return authResult;

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
    const db = getDb();
    const businessRef = doc(db, 'businesses', businessId);
    const businessSnap = await getDoc(businessRef);

    if (!businessSnap.exists()) {
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
          result = await sendWhatsAppBaileys(businessId, recipientId, content, conversationId, db);
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
      case 'instagram':
        result = await sendInstagram(channels, recipientId, content, mediaOpts);
        break;
      default:
        return NextResponse.json(
          { error: `Canal não suportado: ${channel}` },
          { status: 400 },
        );
    }

    // Update message status from 'sending' to 'sent' in Firestore
    const docIdToUpdate = messageDocId || messageId;
    if (docIdToUpdate) {
      await updateMessageAfterSend(db, docIdToUpdate, result.externalMessageId, businessId);
    }

    return NextResponse.json({
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
  db: ReturnType<typeof getFirestore>,
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
      const convSnap = await getDoc(doc(db, 'conversations', conversationId));
      if (convSnap.exists()) {
        const convData = convSnap.data();

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
      throw new Error(`Numero ${phoneNumber} nao possui WhatsApp.`);
    }
  } catch (err) {
    // If onWhatsApp itself throws (network issue), log and try sending anyway
    if (err instanceof Error && err.message.includes('nao possui')) {
      throw err; // Re-throw our own user-friendly error
    }
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

  // Instagram uses the Facebook page access token
  if (!facebook?.pageAccessToken) {
    throw new Error('Credenciais do Instagram incompletas (pageAccessToken do Facebook necessário)');
  }

  const pageAccessToken = await decryptToken(facebook.pageAccessToken);

  // Build message payload - media or text
  const messagePayload = media
    ? {
        attachment: {
          type: media.mediaType === 'document' ? 'file' : media.mediaType,
          payload: { url: media.mediaUrl },
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
    handleMetaApiError(response, data, 'Instagram');
  }

  const externalMessageId = data.message_id;
  if (!externalMessageId) {
    throw new Error('Instagram API não retornou ID da mensagem');
  }

  return { externalMessageId };
}

// ─── Firestore Helpers ───────────────────────────────────────────────────────

async function updateMessageAfterSend(
  db: ReturnType<typeof getFirestore>,
  messageId: string,
  externalMessageId: string,
  businessId: string,
) {
  try {
    // Try direct doc update first (if messageId is the Firestore document ID)
    const msgRef = doc(db, 'conversationMessages', messageId);
    const msgSnap = await getDoc(msgRef);

    if (msgSnap.exists()) {
      await updateDoc(msgRef, {
        status: 'sent',
        externalMessageId,
      });
      return;
    }

    // Fallback: query by a custom field if the ID is application-level
    const q = query(
      collection(db, 'conversationMessages'),
      where('id', '==', messageId),
      where('businessId', '==', businessId),
    );
    const snap = await getDocs(q);

    if (!snap.empty) {
      await updateDoc(snap.docs[0].ref, {
        status: 'sent',
        externalMessageId,
      });
    }
  } catch (err) {
    // Non-critical — log but don't fail the request
    console.error('[Send Message] Failed to update message status:', err);
  }
}
