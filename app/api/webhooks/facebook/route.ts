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
 *  - META_FACEBOOK_VERIFY_TOKEN      (verificação do webhook)
 *  - META_FACEBOOK_PAGE_ACCESS_TOKEN  (envio de mensagens)
 *  - META_APP_SECRET                  (validação de assinatura HMAC)
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, getApp } from 'firebase/app';
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

/**
 * Facebook verifica o webhook enviando GET com:
 *  hub.mode      = "subscribe"
 *  hub.verify_token = <seu token>
 *  hub.challenge  = <string aleatória para ecoar>
 */
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
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  ✅  Facebook Webhook — Verificação OK          ║');
    console.log('╚══════════════════════════════════════════════════╝');
    // Retorna o challenge como texto puro (não JSON) — requisito da Meta
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

    // Verificar assinatura HMAC
    const isValid = verifySignature(rawBody, req.headers.get('x-hub-signature-256'));
    if (!isValid) {
      console.error('[FB Webhook] Assinatura HMAC inválida — rejeitando evento');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const body: WebhookBody = JSON.parse(rawBody);

    // Verificação de objeto — apenas 'page' é aceito nesta rota
    if (body.object !== 'page') {
      console.warn('[FB Webhook] Objeto inesperado recebido:', body.object);
      return new NextResponse('Not Found', { status: 404 });
    }

    if (!body.entry || !Array.isArray(body.entry)) {
      return new NextResponse('EVENT_RECEIVED', { status: 200 });
    }

    // Processar cada entry em paralelo
    await Promise.all(body.entry.map((entry) => processEntry(entry)));

    // Retornar 200 rapidamente para evitar timeout da Meta
    return new NextResponse('EVENT_RECEIVED', { status: 200 });
  } catch (err) {
    console.error('[FB Webhook] Erro ao processar evento:', err);
    // Sempre 200 para a Meta não ficar reenviando
    return new NextResponse('EVENT_RECEIVED', { status: 200 });
  }
}

// ─── Processamento de Entry ──────────────────────────────────────────────────

async function processEntry(entry: WebhookEntry): Promise<void> {
  if (!entry.messaging || !Array.isArray(entry.messaging)) return;

  const pageId = String(entry.id);

  for (const event of entry.messaging) {
    try {
      // Ignorar echoes (mensagens enviadas pela própria page)
      if (event.message?.is_echo) continue;
      if (event.message?.is_deleted) continue;

      const senderId = String(event.sender.id);
      const timestamp = new Date(event.timestamp).toISOString();

      // ── Delivery receipts ────────────────────────────────────────────
      if (event.delivery) {
        await handleDeliveryReceipt(pageId, event.delivery);
        continue;
      }

      // ── Read receipts ────────────────────────────────────────────────
      if (event.read) {
        await handleReadReceipt(pageId, senderId, event.read);
        continue;
      }

      // ── Postback ─────────────────────────────────────────────────────
      if (event.postback) {
        logInboundMessage(senderId, event.postback.title || event.postback.payload);
        await saveInboundMessage({
          pageId,
          senderId,
          messageId: `postback_${event.timestamp}`,
          text: event.postback.title || event.postback.payload || '[Postback]',
          timestamp,
        });
        continue;
      }

      // ── Mensagem de texto ────────────────────────────────────────────
      if (event.message?.text) {
        const text = event.message.text;

        logInboundMessage(senderId, text);

        await saveInboundMessage({
          pageId,
          senderId,
          messageId: event.message.mid,
          text,
          timestamp,
        });

        // Resposta automática de teste
        await sendMessageToFacebook(
          senderId,
          `Olá! Mensagem recebida no saas-erp: ${text}`,
        );
        continue;
      }

      // ── Mensagem com attachment ──────────────────────────────────────
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

        logInboundMessage(senderId, `[${label}]`);

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
      // Continua com o próximo evento — não quebra o loop
    }
  }
}

// ─── Log Formatado ───────────────────────────────────────────────────────────

function logInboundMessage(senderId: string, text: string): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  💬  NOVA MENSAGEM — Facebook Messenger         ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  👤 Sender ID:  ${senderId.padEnd(32)}║`);
  console.log(`║  📝 Mensagem:   ${text.slice(0, 32).padEnd(32)}║`);
  if (text.length > 32) {
    console.log(`║                 ${text.slice(32, 64).padEnd(32)}║`);
  }
  console.log(`║  🕐 Horário:    ${new Date().toLocaleTimeString('pt-BR').padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
}

// ─── Envio de Mensagem (Função Bônus) ────────────────────────────────────────

/**
 * Envia uma mensagem de texto para um usuário do Facebook Messenger.
 *
 * Usa a Send API v19.0 do Facebook:
 * https://developers.facebook.com/docs/messenger-platform/send-messages
 *
 * @param senderId - PSID (Page-Scoped User ID) do destinatário
 * @param text - Texto da mensagem (máx. 2000 caracteres)
 */
async function sendMessageToFacebook(senderId: string, text: string): Promise<void> {
  const pageAccessToken = process.env.META_FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageAccessToken) {
    console.error('[FB Webhook] META_FACEBOOK_PAGE_ACCESS_TOKEN not configured — mensagem não enviada');
    return;
  }

  try {
    const response = await fetch('https://graph.facebook.com/v19.0/me/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pageAccessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text },
        messaging_type: 'RESPONSE',
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[FB Webhook] Erro ao enviar mensagem:', response.status, errorBody);
      return;
    }

    const result = await response.json();
    console.log('[FB Webhook] ✅ Mensagem enviada com sucesso:', {
      recipientId: result.recipient_id,
      messageId: result.message_id,
    });
  } catch (err) {
    console.error('[FB Webhook] Erro de rede ao enviar mensagem:', err);
  }
}

// ─── Firestore: Resolver businessId ──────────────────────────────────────────

async function resolveBusinessId(pageId: string): Promise<string | null> {
  try {
    const db = getDb();
    const q = query(
      collection(db, 'businesses'),
      where('channels.facebook.pageId', '==', pageId),
      firestoreLimit(1),
    );
    const snap = await getDocs(q);
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

// ─── Firestore: Salvar Mensagem Inbound ──────────────────────────────────────

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
  const db = getDb();

  // 1. Resolver businessId
  const businessId = await resolveBusinessId(params.pageId);
  if (!businessId) {
    // Dead-letter queue — salva para investigação
    try {
      await addDoc(collection(db, 'webhookFailures'), {
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

  // 2. Checar duplicata
  try {
    const dupQuery = query(
      collection(db, 'conversationMessages'),
      where('externalMessageId', '==', params.messageId),
      where('businessId', '==', businessId),
      firestoreLimit(1),
    );
    const dupSnap = await getDocs(dupQuery);
    if (!dupSnap.empty) {
      console.log('[FB Webhook] Mensagem duplicada ignorada:', params.messageId);
      return;
    }
  } catch (dupErr) {
    console.error('[FB Webhook] Erro ao verificar duplicata:', dupErr);
    // Continua — melhor duplicar do que perder
  }

  const now = new Date().toISOString();

  try {
    // 3. Encontrar ou criar conversa
    const convQuery = query(
      collection(db, 'conversations'),
      where('businessId', '==', businessId),
      where('channel', '==', 'facebook'),
      where('contactExternalId', '==', params.senderId),
      firestoreLimit(1),
    );
    const convSnap = await getDocs(convQuery);
    let conversationId: string;

    if (convSnap.empty) {
      const newConvRef = await addDoc(collection(db, 'conversations'), {
        businessId,
        channel: 'facebook',
        contactName: params.senderId, // Será atualizado quando tivermos o profile
        contactExternalId: params.senderId,
        status: 'open',
        lastMessage: params.text,
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      conversationId = newConvRef.id;
      console.log('[FB Webhook] Nova conversa criada:', conversationId);

      // Auto-link com CRM contact
      await tryLinkCrmContact(db, businessId, params.senderId, conversationId, now);
    } else {
      conversationId = convSnap.docs[0].id;
      await updateDoc(doc(db, 'conversations', conversationId), {
        lastMessage: params.text,
        lastMessageAt: params.timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: increment(1),
        updatedAt: now,
      });
      console.log('[FB Webhook] Conversa atualizada:', conversationId);
    }

    // 4. Salvar mensagem
    await addDoc(collection(db, 'conversationMessages'), {
      conversationId,
      businessId,
      channel: 'facebook',
      direction: 'inbound',
      content: params.text,
      status: 'delivered',
      externalMessageId: params.messageId,
      senderName: null,
      mediaType: params.mediaType ?? null,
      mediaUrl: params.mediaUrl ?? null,
      sentAt: params.timestamp,
      createdAt: now,
    });

    console.log('[FB Webhook] Mensagem salva na conversa:', conversationId);
  } catch (err) {
    console.error('[FB Webhook] Erro ao salvar mensagem inbound:', err);
  }
}

// ─── Firestore: Delivery Receipt ─────────────────────────────────────────────

async function handleDeliveryReceipt(
  pageId: string,
  delivery: { mids: string[]; watermark: number },
): Promise<void> {
  const businessId = await resolveBusinessId(pageId);
  if (!businessId) return;

  const db = getDb();
  const deliveredAt = new Date(delivery.watermark).toISOString();

  for (const mid of delivery.mids ?? []) {
    try {
      const msgQuery = query(
        collection(db, 'conversationMessages'),
        where('externalMessageId', '==', mid),
        where('businessId', '==', businessId),
        firestoreLimit(1),
      );
      const msgSnap = await getDocs(msgQuery);
      if (!msgSnap.empty) {
        const msgData = msgSnap.docs[0].data();
        // Não regredir status
        if (msgData.status === 'read') continue;
        await updateDoc(doc(db, 'conversationMessages', msgSnap.docs[0].id), {
          status: 'delivered',
          deliveredAt,
        });
      }
    } catch (err) {
      console.error('[FB Webhook] Erro ao processar delivery receipt:', err);
    }
  }
}

// ─── Firestore: Read Receipt ─────────────────────────────────────────────────

async function handleReadReceipt(
  pageId: string,
  senderId: string,
  read: { watermark: number },
): Promise<void> {
  const businessId = await resolveBusinessId(pageId);
  if (!businessId) return;

  const db = getDb();
  const readAt = new Date(read.watermark).toISOString();

  try {
    // Encontrar conversa do sender
    const convQuery = query(
      collection(db, 'conversations'),
      where('businessId', '==', businessId),
      where('channel', '==', 'facebook'),
      where('contactExternalId', '==', senderId),
      firestoreLimit(1),
    );
    const convSnap = await getDocs(convQuery);
    if (convSnap.empty) return;

    // Marcar outbound messages como read
    const msgsQuery = query(
      collection(db, 'conversationMessages'),
      where('businessId', '==', businessId),
      where('conversationId', '==', convSnap.docs[0].id),
      where('direction', '==', 'outbound'),
      where('status', 'in', ['sent', 'delivered']),
    );
    const msgsSnap = await getDocs(msgsQuery);

    const updates = msgsSnap.docs
      .filter((d) => {
        const data = d.data();
        return data.sentAt && data.sentAt <= readAt;
      })
      .map((d) => {
        const data = d.data();
        return updateDoc(doc(db, 'conversationMessages', d.id), {
          status: 'read',
          readAt,
          ...(!data.deliveredAt ? { deliveredAt: readAt } : {}),
        });
      });

    await Promise.all(updates);

    if (updates.length > 0) {
      console.log(`[FB Webhook] ${updates.length} mensagem(ns) marcada(s) como lida(s)`);
    }
  } catch (err) {
    console.error('[FB Webhook] Erro ao processar read receipt:', err);
  }
}

// ─── Firestore: Auto-link CRM Contact ───────────────────────────────────────

async function tryLinkCrmContact(
  db: ReturnType<typeof getFirestore>,
  businessId: string,
  senderId: string,
  conversationId: string,
  now: string,
): Promise<void> {
  try {
    const contactQuery = query(
      collection(db, 'crmContacts'),
      where('businessId', '==', businessId),
      where('channelIdentities.facebook', '==', senderId),
      firestoreLimit(1),
    );
    const contactSnap = await getDocs(contactQuery);

    if (!contactSnap.empty) {
      const contact = contactSnap.docs[0];
      const contactData = contact.data();

      await updateDoc(doc(db, 'conversations', conversationId), {
        crmContactId: contact.id,
        contactName: contactData.name || senderId,
      });
      await updateDoc(doc(db, 'crmContacts', contact.id), {
        lastConversationId: conversationId,
        lastConversationAt: now,
        updatedAt: now,
      });

      console.log('[FB Webhook] Conversa linkada ao CRM contact:', contact.id);
    }
  } catch (err) {
    // Não é fatal — não quebra o fluxo
    console.warn('[FB Webhook] Falha ao linkar CRM contact:', err);
  }
}
