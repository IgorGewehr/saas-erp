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
        { error: 'Nenhum canal de comunicação configurado para esta empresa' },
        { status: 400 },
      );
    }

    // Fix T2: Token expiry pre-check for WhatsApp
    if (channel === 'whatsapp' && channels.whatsapp?.tokenExpiresAt) {
      const expiresAt = new Date(channels.whatsapp.tokenExpiresAt).getTime();
      if (Date.now() > expiresAt) {
        return NextResponse.json({
          error: 'Token do WhatsApp expirado. Reconecte o canal em Configuracoes > Canais.',
          code: 'TOKEN_EXPIRED',
        }, { status: 401 });
      }
      // Warn if expiring within 7 days
      if (Date.now() > expiresAt - 7 * 24 * 60 * 60 * 1000) {
        console.warn('[Send Message] WhatsApp token expiring soon for business:', businessId);
      }
    }

    // Send via the appropriate Meta API
    let result: { externalMessageId: string };

    const mediaOpts = isMedia ? { mediaUrl: mediaUrl!, mediaType: mediaType || 'document' as const } : undefined;

    switch (channel) {
      case 'whatsapp':
        result = await sendWhatsApp(channels, recipientId, content, {
          type: type || 'text',
          templateName,
          templateLanguage,
          templateParams,
          media: mediaOpts,
        });
        break;
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
    let message = 'Erro desconhecido ao enviar mensagem';
    let statusCode = 500;
    let errorDetails: Record<string, unknown> = {};

    if (error instanceof Error) {
      try {
        errorDetails = JSON.parse(error.message);
        message = errorDetails.message as string;
        // If it's a token error, return 401
        if (errorDetails.code === 190) statusCode = 401;
      } catch {
        message = error.message;
      }
    }

    console.error('[Send Message] Error:', message, errorDetails);
    return NextResponse.json({ error: message, ...errorDetails }, { status: statusCode });
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
