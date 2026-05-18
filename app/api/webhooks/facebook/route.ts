/**
 * Facebook Messenger Webhook
 *
 * Endpoint dedicado para o Facebook Messenger Platform.
 *
 * Setup no Meta Developer Dashboard:
 *  1. Callback URL: https://seu-dominio.com/api/webhooks/facebook
 *  2. Verify Token: valor de META_FACEBOOK_VERIFY_TOKEN no .env.local
 *  3. Assinaturas: messages, messaging_postbacks, message_deliveries, message_reads
 *
 * Variáveis de ambiente necessárias:
 *  - META_FACEBOOK_VERIFY_TOKEN  (verificação do webhook)
 *  - META_APP_SECRET             (validação de assinatura HMAC)
 *  - ENCRYPTION_KEY              (descriptografar pageAccessToken do Firestore)
 */

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { decryptToken } from '@/lib/utils/encryption';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: 'image' | 'video' | 'audio' | 'file' | 'fallback';
      payload: { url?: string };
    }>;
    is_echo?: boolean;
    is_deleted?: boolean;
  };
  delivery?: { mids: string[]; watermark: number };
  read?: { watermark: number };
  postback?: { title: string; payload: string; mid: string };
}

interface WebhookEntry {
  id: string;
  time: number;
  messaging?: MessagingEvent[];
}

interface WebhookBody {
  object: string;
  entry: WebhookEntry[];
}

// ─── GET — Verificação do Webhook ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.META_FACEBOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    console.error('[FB Webhook] META_FACEBOOK_VERIFY_TOKEN not configured');
    return new NextResponse('Server misconfigured', { status: 500 });
  }

  if (mode === 'subscribe' && token === verifyToken) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  console.warn('[FB Webhook] Verificação falhou — token ou mode inválido');
  return new NextResponse('Forbidden', { status: 403 });
}

// ─── Verificação de Assinatura HMAC ──────────────────────────────────────────

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error('[FB Webhook] META_APP_SECRET not configured — skipping signature check');
    return false;
  }

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const expected = `sha256=${expectedHash}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

// ─── POST — Recebimento de Eventos ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    const isValid = verifySignature(rawBody, req.headers.get('x-hub-signature-256'));
    if (!isValid) {
      console.error('[FB Webhook] Assinatura HMAC inválida — rejeitando evento');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const body: WebhookBody = JSON.parse(rawBody);

    if (body.object !== 'page') {
      console.warn('[FB Webhook] Objeto inesperado recebido:', body.object);
      return new NextResponse('Not Found', { status: 404 });
    }

    if (!body.entry || !Array.isArray(body.entry)) {
      return new NextResponse('EVENT_RECEIVED', { status: 200 });
    }

    await Promise.all(body.entry.map((entry) => processEntry(entry)));

    return new NextResponse('EVENT_RECEIVED', { status: 200 });
  } catch (err) {
    console.error('[FB Webhook] Erro ao processar evento:', err);
    return new NextResponse('EVENT_RECEIVED', { status: 200 });
  }
}

// ─── Processamento de Entry ──────────────────────────────────────────────────

async function processEntry(entry: WebhookEntry): Promise<void> {
  if (!entry.messaging || !Array.isArray(entry.messaging)) return;

  const pageId = String(entry.id);

  for (const event of entry.messaging) {
    try {
      if (event.message?.is_echo) continue;
      if (event.message?.is_deleted) continue;

      const senderId = String(event.sender.id);
      const timestamp = new Date(event.timestamp).toISOString();

      if (event.delivery) {
        await handleDeliveryReceipt(pageId, event.delivery);
        continue;
      }

      if (event.read) {
        await handleReadReceipt(pageId, senderId, event.read);
        continue;
      }

      if (event.postback) {
        await saveInboundMessage({
          pageId,
          senderId,
          messageId: `postback_${event.timestamp}`,
          text: event.postback.title || event.postback.payload || '[Postback]',
          timestamp,
        });
        continue;
      }

      if (event.message?.text) {
        await saveInboundMessage({
          pageId,
          senderId,
          messageId: event.message.mid,
          text: event.message.text,
          timestamp,
        });
        continue;
      }

      if (event.message?.attachments && event.message.attachments.length > 0) {
        const att = event.message.attachments[0];
        const typeMap: Record<string, 'image' | 'video' | 'audio' | 'document'> = {
          image: 'image',
          video: 'video',
          audio: 'audio',
          file: 'document',
          fallback: 'document',
        };
        const labelMap: Record<string, string> = {
          image: 'Imagem',
          video: 'Vídeo',
          audio: 'Áudio',
          file: 'Documento',
          fallback: 'Anexo',
        };
        const mediaType = typeMap[att.type] || 'document';
        const label = labelMap[att.type] || 'Anexo';

        await saveInboundMessage({
          pageId,
          senderId,
          messageId: event.message.mid,
          text: `[${label}]`,
          timestamp,
          mediaType,
          mediaUrl: att.payload?.url,
        });
        continue;
      }
    } catch (err) {
      console.error('[FB Webhook] Erro ao processar evento de messaging:', err);
    }
  }
}

// ─── Graph API: Buscar Perfil do Remetente ──────────────────────────────────

interface SenderProfile {
  name: string;
  profilePic?: string;
}

async function fetchSenderProfile(
  senderId: string,
  pageAccessToken: string,
): Promise<SenderProfile | null> {
  try {
    const url = `https://graph.facebook.com/v21.0/${senderId}?fields=name,first_name,last_name,profile_pic&access_token=${pageAccessToken}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) {
      const body = await res.text();
      console.warn('[FB Webhook] Graph API profile fetch falhou:', res.status, body);
      return null;
    }

    const data = await res.json();
    // Prefer full `name` field; fall back to first+last; fall back to senderId
    const name = data.name
      || (`${data.first_name || ''} ${data.last_name || ''}`).trim()
      || senderId;

    return { name, profilePic: data.profile_pic || undefined };
  } catch (err) {
    console.error('[FB Webhook] Erro ao buscar perfil do remetente:', err);
    return null;
  }
}

// ─── Admin SDK: Page Access Token ────────────────────────────────────────────

async function getDecryptedPageToken(businessId: string): Promise<string | null> {
  try {
    const businessDoc = await adminDb.doc(`businesses/${businessId}`).get();
    if (!businessDoc.exists) return null;
    const data = businessDoc.data();
    const encryptedToken = data?.channels?.facebook?.pageAccessToken;
    if (!encryptedToken) {
      console.warn('[FB Webhook] Nenhum pageAccessToken encontrado para business:', businessId);
      return null;
    }
    return await decryptToken(encryptedToken);
  } catch (err) {
    console.error('[FB Webhook] Erro ao descriptografar pageAccessToken:', err);
    return null;
  }
}

// ─── Admin SDK: Resolver businessId ──────────────────────────────────────────

async function resolveBusinessId(pageId: string): Promise<string | null> {
  try {
    const snap = await adminDb
      .collection('businesses')
      .where('channels.facebook.pageId', '==', pageId)
      .limit(1)
      .get();
    if (snap.empty) {
      console.warn('[FB Webhook] Nenhum business encontrado para pageId:', pageId);
      return null;
    }
    return snap.docs[0].id;
  } catch (err) {
    console.error('[FB Webhook] Erro ao resolver businessId:', err);
    return null;
  }
}

// ─── Admin SDK: Salvar Mensagem Inbound ──────────────────────────────────────

interface InboundParams {
  pageId: string;
  senderId: string;
  messageId: string;
  text: string;
  timestamp: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  mediaUrl?: string;
}

async function saveInboundMessage(params: InboundParams): Promise<void> {
  // 1. Resolver businessId — multi-tenant: cada pageId pertence a um único business
  const businessId = await resolveBusinessId(params.pageId);
  if (!businessId) {
    try {
      await adminDb.collection('webhookFailures').add({
        reason: 'business_not_found',
        channel: 'facebook',
        channelIdentifier: params.pageId,
        externalId: params.senderId,
        messageId: params.messageId,
        content: params.text.substring(0, 100),
        timestamp: params.timestamp,
        createdAt: new Date().toISOString(),
      });
    } catch (dlqErr) {
      console.error('[FB Webhook] Falha ao salvar na dead-letter queue:', dlqErr);
    }
    return;
  }

  // 2. Checar duplicata (businessId garante isolamento multi-tenant)
  try {
    const dupSnap = await adminDb
      .collection('conversationMessages')
      .where('externalMessageId', '==', params.messageId)
      .where('businessId', '==', businessId)
      .limit(1)
      .get();
    if (!dupSnap.empty) return;
  } catch (dupErr) {
    console.error('[FB Webhook] Erro ao verificar duplicata:', dupErr);
  }

  const now = new Date().toISOString();

  // 2.5. Buscar perfil do remetente
  let senderName: string | null = null;
  let senderAvatarUrl: string | null = null;
  const pageToken = await getDecryptedPageToken(businessId);
  if (pageToken) {
    const profile = await fetchSenderProfile(params.senderId, pageToken);
    if (profile) {
      senderName = profile.name;
      senderAvatarUrl = profile.profilePic ?? null;
    }
  }

  try {
    // 3. Encontrar ou criar conversa (filtro por businessId garante isolamento)
    const convSnap = await adminDb
      .collection('conversations')
      .where('businessId', '==', businessId)
      .where('channel', '==', 'facebook')
      .where('contactExternalId', '==', params.senderId)
      .limit(1)
      .get();

    let conversationId: string;

    if (convSnap.empty) {
      const newConvRef = await adminDb.collection('conversations').add({
        businessId,
        channel: 'facebook',
        // Facebook Page é sempre 'business' (limitação do Meta — uma Page por business).
        channelOwnerType: 'business',
        contactName: senderName || params.senderId,
        contactExternalId: params.senderId,
        ...(senderAvatarUrl ? { contactAvatarUrl: senderAvatarUrl } : {}),
        status: 'open',
        lastMessage: params.text,
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        firstInboundFromContactAt: params.timestamp,
        unreadCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      conversationId = newConvRef.id;
      await tryLinkCrmContact(businessId, params.senderId, conversationId, now);
    } else {
      conversationId = convSnap.docs[0].id;
      const existingConv = convSnap.docs[0].data();

      const convUpdate: Record<string, unknown> = {
        lastMessage: params.text,
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: FieldValue.increment(1),
        updatedAt: now,
        // first-touch do contato — habilita filtro "Cliente não respondeu".
        ...(!existingConv.firstInboundFromContactAt ? { firstInboundFromContactAt: params.timestamp } : {}),
      };

      // Enrich name: replace numeric IDs AND default placeholder names with the real name
      const PLACEHOLDER_NAMES = ['Usuário do Facebook', 'Usuário do Instagram', 'Facebook User'];
      const currentName = existingConv.contactName as string | undefined;
      if (senderName && (!currentName || /^\d+$/.test(currentName) || PLACEHOLDER_NAMES.includes(currentName))) {
        convUpdate.contactName = senderName;
      }
      if (senderAvatarUrl && !existingConv.contactAvatarUrl) {
        convUpdate.contactAvatarUrl = senderAvatarUrl;
      }

      await adminDb.doc(`conversations/${conversationId}`).update(convUpdate);
    }

    // 4. Salvar mensagem
    await adminDb.collection('conversationMessages').add({
      conversationId,
      businessId,
      channel: 'facebook',
      direction: 'inbound',
      content: params.text,
      status: 'delivered',
      externalMessageId: params.messageId,
      senderName: senderName || null,
      mediaType: params.mediaType ?? null,
      mediaUrl: params.mediaUrl ?? null,
      sentAt: params.timestamp,
      createdAt: now,
    });
  } catch (err) {
    console.error('[FB Webhook] Erro ao salvar mensagem inbound:', err);
  }
}

// ─── Admin SDK: Delivery Receipt ─────────────────────────────────────────────

async function handleDeliveryReceipt(
  pageId: string,
  delivery: { mids: string[]; watermark: number },
): Promise<void> {
  const businessId = await resolveBusinessId(pageId);
  if (!businessId) return;

  const deliveredAt = new Date(delivery.watermark).toISOString();

  for (const mid of delivery.mids ?? []) {
    try {
      const msgSnap = await adminDb
        .collection('conversationMessages')
        .where('externalMessageId', '==', mid)
        .where('businessId', '==', businessId)
        .limit(1)
        .get();
      if (!msgSnap.empty) {
        const msgData = msgSnap.docs[0].data();
        if (msgData.status === 'read') continue;
        await adminDb.doc(`conversationMessages/${msgSnap.docs[0].id}`).update({
          status: 'delivered',
          deliveredAt,
        });
      }
    } catch (err) {
      console.error('[FB Webhook] Erro ao processar delivery receipt:', err);
    }
  }
}

// ─── Admin SDK: Read Receipt ─────────────────────────────────────────────────

async function handleReadReceipt(
  pageId: string,
  senderId: string,
  read: { watermark: number },
): Promise<void> {
  const businessId = await resolveBusinessId(pageId);
  if (!businessId) return;

  const readAt = new Date(read.watermark).toISOString();

  try {
    const convSnap = await adminDb
      .collection('conversations')
      .where('businessId', '==', businessId)
      .where('channel', '==', 'facebook')
      .where('contactExternalId', '==', senderId)
      .limit(1)
      .get();
    if (convSnap.empty) return;

    const msgsSnap = await adminDb
      .collection('conversationMessages')
      .where('businessId', '==', businessId)
      .where('conversationId', '==', convSnap.docs[0].id)
      .where('direction', '==', 'outbound')
      .where('status', 'in', ['sent', 'delivered'])
      .get();

    const updates = msgsSnap.docs
      .filter((d) => {
        const data = d.data();
        return data.sentAt && data.sentAt <= readAt;
      })
      .map((d) => {
        const data = d.data();
        return adminDb.doc(`conversationMessages/${d.id}`).update({
          status: 'read',
          readAt,
          ...(!data.deliveredAt ? { deliveredAt: readAt } : {}),
        });
      });

    await Promise.all(updates);
  } catch (err) {
    console.error('[FB Webhook] Erro ao processar read receipt:', err);
  }
}

// ─── Admin SDK: Auto-link CRM Contact ───────────────────────────────────────

async function tryLinkCrmContact(
  businessId: string,
  senderId: string,
  conversationId: string,
  now: string,
): Promise<void> {
  try {
    const contactSnap = await adminDb
      .collection('clients')
      .where('businessId', '==', businessId)
      .where('channelIdentities.facebook', '==', senderId)
      .limit(1)
      .get();

    if (!contactSnap.empty) {
      const contact = contactSnap.docs[0];
      const contactData = contact.data();
      await adminDb.doc(`conversations/${conversationId}`).update({
        crmContactId: contact.id,
        contactName: contactData.name || senderId,
      });
      await adminDb.doc(`clients/${contact.id}`).update({
        lastConversationId: conversationId,
        lastConversationAt: now,
        updatedAt: now,
      });
    }
  } catch (err) {
    console.warn('[FB Webhook] Falha ao linkar CRM contact:', err);
  }
}
