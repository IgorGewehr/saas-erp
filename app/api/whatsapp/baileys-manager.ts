/**
 * Baileys Session Manager — Singleton module
 *
 * Shared between /api/whatsapp/connect (SSE QR) and /api/whatsapp/restore (auto-restore).
 * Manages one Baileys socket per businessId in a global Map.
 */

import path from 'path';
import fs from 'fs';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  proto,
  WAMessage,
  WAMessageUpdate,
  MessageUpsertType,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';

// ─── Constants ───────────────────────────────────────────────────────────────

export const SESSIONS_DIR = path.join(process.cwd(), 'whatsapp-sessions');

const RESTARTABLE_CODES = new Set([
  DisconnectReason.restartRequired,
  DisconnectReason.timedOut,
  DisconnectReason.connectionClosed,
  DisconnectReason.connectionReplaced,
]);

const MAX_AUTO_RESTARTS = 5;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BaileysSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sock: any;
  listeners: Set<(data: Record<string, unknown>) => void>;
  isConnected: boolean;
  lastQr: string | null;
}

// ─── Global Singleton Map ────────────────────────────────────────────────────

// Attach to globalThis to survive HMR in dev
const globalSessions = (globalThis as Record<string, unknown>);
if (!globalSessions.__baileySessions) {
  globalSessions.__baileySessions = new Map<string, BaileysSession>();
}
export const sessions = globalSessions.__baileySessions as Map<string, BaileysSession>;



// ─── Helpers ─────────────────────────────────────────────────────────────────

function clearSessionDir(sessionDir: string) {
  try {
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[Baileys] Erro ao limpar sessao:', err);
  }
  fs.mkdirSync(sessionDir, { recursive: true });
}

export function broadcast(session: BaileysSession, data: Record<string, unknown>) {
  for (const listener of session.listeners) {
    try {
      listener(data);
    } catch {
      session.listeners.delete(listener);
    }
  }
}

function formatPhone(phone: string): string {
  if (phone.length === 13 && phone.startsWith('55')) {
    return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} ${phone.slice(4, 9)}-${phone.slice(9)}`;
  }
  if (phone.length === 12 && phone.startsWith('55')) {
    return `+${phone.slice(0, 2)} ${phone.slice(2, 4)} ${phone.slice(4, 8)}-${phone.slice(8)}`;
  }
  return `+${phone}`;
}

// ─── Message extraction ──────────────────────────────────────────────────────

function extractMessageText(msg: proto.IMessage | null | undefined): string | null {
  if (!msg) return null;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    null
  );
}

function extractMediaType(msg: proto.IMessage | null | undefined): 'image' | 'video' | 'audio' | 'document' | null {
  if (!msg) return null;
  if (msg.imageMessage) return 'image';
  if (msg.videoMessage) return 'video';
  if (msg.audioMessage) return 'audio';
  if (msg.documentMessage) return 'document';
  if (msg.stickerMessage) return 'image';
  return null;
}

function getMediaLabel(type: string | null): string {
  switch (type) {
    case 'image': return '[Imagem]';
    case 'video': return '[Vídeo]';
    case 'audio': return '[Áudio]';
    case 'document': return '[Documento]';
    default: return '[Mídia]';
  }
}

// ─── Firestore: update connection status ─────────────────────────────────────

async function updateFirestoreConnection(businessId: string, phoneNumber: string | null) {
  try {
    await adminDb.collection('businesses').doc(businessId).update({
      'channels.whatsapp': {
        isConnected: true,
        connectedAt: new Date().toISOString(),
        connectedVia: 'baileys',
        displayPhoneNumber: phoneNumber,
        phoneNumberId: phoneNumber,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Baileys] Firestore connection update error:', err);
  }
}

// ─── Firestore: save inbound message ─────────────────────────────────────────

async function handleInboundMessage(
  businessId: string,
  waMessage: WAMessage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sock: any,
): Promise<void> {
  const rawJid = waMessage.key.remoteJid;
  if (!rawJid) return;

  // ── Resolve phone number from JID ──
  // Baileys can send @lid (Linked Device ID) instead of @s.whatsapp.net.
  // When that happens, the real phone is NOT in remoteJid — we must
  // extract it from the participant field or fall back to the key.participant.
  let senderPhone = '';
  let jidForProfile = rawJid; // JID to use for profile picture lookup

  if (rawJid.endsWith('@s.whatsapp.net')) {
    // Normal case: "5521999999999@s.whatsapp.net"
    senderPhone = rawJid.replace('@s.whatsapp.net', '');
  } else if (rawJid.endsWith('@lid')) {
    // LID (Linked Device ID) — the real phone is in key.remoteJidAlt
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const altJid = (waMessage.key as any).remoteJidAlt as string | undefined;

    if (altJid && altJid.includes('@s.whatsapp.net')) {
      senderPhone = altJid.replace('@s.whatsapp.net', '');
      jidForProfile = altJid;
    } else {
      // Fallback chain: participant fields
      const keyParticipant = waMessage.key.participant;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msgParticipant = (waMessage as any).participant;

      if (keyParticipant && keyParticipant.includes('@s.whatsapp.net')) {
        senderPhone = keyParticipant.replace('@s.whatsapp.net', '');
        jidForProfile = keyParticipant;
      } else if (msgParticipant && msgParticipant.includes('@s.whatsapp.net')) {
        senderPhone = msgParticipant.replace('@s.whatsapp.net', '');
        jidForProfile = msgParticipant;
      } else {
        console.warn('[Baileys] @lid sem remoteJidAlt ou participant. Ignorando:', rawJid);
        return;
      }
    }
  } else if (rawJid.endsWith('@g.us')) {
    // Group message — should already be filtered but just in case
    return;
  } else {
    // Unknown suffix — extract digits
    senderPhone = rawJid.replace(/@.*$/, '');
  }

  // Validate: senderPhone must look like a phone number (10-15 digits)
  if (!/^\d{10,15}$/.test(senderPhone)) {
    console.warn('[Baileys] Invalid phone extracted from JID:', { rawJid, senderPhone });
    return;
  }

  const messageId = waMessage.key.id || `wa_${Date.now()}`;
  const timestamp = waMessage.messageTimestamp
    ? new Date(Number(waMessage.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString();

  const msgContent = waMessage.message;
  const text = extractMessageText(msgContent);
  const mediaType = extractMediaType(msgContent);
  if (!text && !mediaType) return;

  const displayText = text || getMediaLabel(mediaType);
  const now = new Date().toISOString();

  // Deduplicate
  try {
    const dupSnap = await adminDb.collection('conversationMessages')
      .where('externalMessageId', '==', messageId)
      .where('businessId', '==', businessId)
      .limit(1)
      .get();
    if (!dupSnap.empty) return;
  } catch (err) {
    console.error('[Baileys] Erro ao verificar duplicata:', err);
  }

  const pushName = waMessage.pushName || null;
  let contactName = pushName || formatPhone(senderPhone);

  let avatarUrl: string | null = null;
  try {
    avatarUrl = await sock.profilePictureUrl(jidForProfile, 'image');
  } catch {
    // Not all contacts have profile pictures
  }

  try {
    const altPhone = getAlternativePhone(senderPhone);
    let convSnap = await adminDb.collection('conversations')
      .where('businessId', '==', businessId)
      .where('channel', '==', 'whatsapp')
      .where('contactExternalId', '==', senderPhone)
      .limit(1)
      .get();
      
    if (convSnap.empty && altPhone) {
      convSnap = await adminDb.collection('conversations')
        .where('businessId', '==', businessId)
        .where('channel', '==', 'whatsapp')
        .where('contactExternalId', '==', altPhone)
        .limit(1)
        .get();
    }
        
    let conversationId: string;

    if (convSnap.empty) {
      const newConvRef = await adminDb.collection('conversations').add({
        businessId,
        channel: 'whatsapp',
        connectedVia: 'baileys',
        contactName,
        contactPhone: formatPhone(senderPhone),
        contactExternalId: senderPhone,
        ...(avatarUrl ? { contactAvatarUrl: avatarUrl } : {}),
        status: 'open',
        lastMessage: displayText,
        lastMessageAt: timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      conversationId = newConvRef.id;

      // Auto-link CRM contact
      try {
        const crmSnap = await adminDb.collection('clients')
          .where('businessId', '==', businessId)
          .where('channelIdentities.whatsapp', '==', senderPhone)
          .limit(1)
          .get();
        if (!crmSnap.empty) {
          const crmContact = crmSnap.docs[0];
          await adminDb.collection('conversations').doc(conversationId).update({
            crmContactId: crmContact.id,
            contactName: crmContact.data().name || contactName,
          });
          await adminDb.collection('clients').doc(crmContact.id).update({
            lastConversationId: conversationId,
            lastConversationAt: now,
            updatedAt: now,
          });
        }
      } catch { /* non-critical */ }
    } else {
      conversationId = convSnap.docs[0].id;
      const existingConv = convSnap.docs[0].data();

      const convUpdate: Record<string, unknown> = {
        lastMessage: displayText,
        lastMessageAt: timestamp,
        lastMessageDirection: 'inbound',
        unreadCount: FieldValue.increment(1),
        updatedAt: now,
      };

      if (pushName && (!existingConv.contactName || /^\+?\d[\d\s-]+$/.test(existingConv.contactName))) {
        convUpdate.contactName = pushName;
        contactName = pushName;
      }
      if (avatarUrl && !existingConv.contactAvatarUrl) {
        convUpdate.contactAvatarUrl = avatarUrl;
      }

      await adminDb.collection('conversations').doc(conversationId).update(convUpdate);
    }

    const msgRef = await adminDb.collection('conversationMessages').add({
      conversationId,
      businessId,
      channel: 'whatsapp',
      direction: 'inbound',
      content: displayText,
      status: 'delivered',
      externalMessageId: messageId,
      senderName: contactName,
      mediaType: mediaType ?? null,
      mediaUrl: null,
      sentAt: timestamp,
      createdAt: now,
    });

    // Dispatch to AI agent — uses admin SDK for consistent tenant checks
    try {
      const { dispatchInboundToAgent } = await import('@/lib/agent/dispatch');
      await dispatchInboundToAgent(adminDb, {
        businessId,
        conversationId,
        messageId: msgRef.id,
        channel: 'whatsapp',
        message: displayText,
        contactName,
        contactPhone: senderPhone,
        recipientId: senderPhone,
      });
    } catch (agentErr) {
      console.warn('[Baileys] Agent dispatch failed:', agentErr);
    }
  } catch (err) {
    console.error('[Baileys] Erro ao salvar mensagem inbound:', err);
  }
}

// ─── Outbound message status updates ────────────────────────────────────────
// Baileys emits messages.update with numeric proto.WebMessageInfo.Status values.
// We mirror the Meta Cloud API webhook flow so outbound messages don't stay 'sending'.
async function handleOutboundStatusUpdate(
  businessId: string,
  updates: WAMessageUpdate[],
): Promise<void> {
  const now = new Date().toISOString();

  for (const u of updates) {
    // Only process our own sent messages (fromMe). Inbound receipts arrive here too.
    if (!u.key?.fromMe) continue;

    const externalMessageId = u.key.id;
    if (!externalMessageId) continue;

    const statusCode = u.update?.status;
    if (statusCode == null) continue;

    // proto.WebMessageInfo.Status: 0=ERROR 1=PENDING 2=SERVER_ACK 3=DELIVERY_ACK 4=READ 5=PLAYED
    let nextStatus: 'sent' | 'delivered' | 'read' | 'failed' | null = null;
    const patch: Record<string, unknown> = {};

    if (statusCode === 0) {
      nextStatus = 'failed';
    } else if (statusCode === 2) {
      nextStatus = 'sent';
    } else if (statusCode === 3) {
      nextStatus = 'delivered';
      patch.deliveredAt = now;
    } else if (statusCode >= 4) {
      nextStatus = 'read';
      patch.readAt = now;
      patch.deliveredAt = now;
    }

    if (!nextStatus) continue;
    patch.status = nextStatus;

    try {
      const snap = await adminDb.collection('conversationMessages')
        .where('externalMessageId', '==', externalMessageId)
        .where('businessId', '==', businessId)
        .limit(1)
        .get();
      if (snap.empty) continue;

      const msgDoc = snap.docs[0];
      const existing = msgDoc.data() as { status?: string };
      // Never regress: once 'read', ignore 'delivered'/'sent' updates.
      const rank = { sending: 0, sent: 1, delivered: 2, read: 3, failed: -1 } as const;
      const existingRank = rank[(existing.status as keyof typeof rank) || 'sending'] ?? 0;
      const nextRank = rank[nextStatus];
      if (nextStatus !== 'failed' && nextRank <= existingRank) continue;

      await msgDoc.ref.update(patch);
    } catch (err) {
      console.error('[Baileys] Failed to apply status update:', err);
    }
  }
}

// ─── Session lifecycle ───────────────────────────────────────────────────────

export function getConnectedSession(businessId: string): BaileysSession | null {
  const session = sessions.get(businessId);
  return session?.isConnected ? session : null;
}

function getAlternativePhone(phone: string): string | null {
  if (!phone.startsWith('55')) return null;
  const withoutCountry = phone.substring(2);
  if (withoutCountry.length < 10) return null;
  const ddd = withoutCountry.substring(0, 2);
  const number = withoutCountry.substring(2);
  if (number.length === 8) {
    return `55${ddd}9${number}`;
  } else if (number.length === 9 && number.startsWith('9')) {
    return `55${ddd}${number.substring(1)}`;
  }
  return null;
}

export function destroySession(businessId: string) {
  const session = sessions.get(businessId);
  if (!session) return;

  for (const listener of session.listeners) {
    try { listener({ type: 'stream_end' }); } catch { /* ignore */ }
  }
  session.listeners.clear();

  if (session.sock) {
    try { session.sock.end(undefined); } catch { /* ignore */ }
  }

  sessions.delete(businessId);
}

/**
 * Create or restore a Baileys session for a businessId.
 *
 * @param businessId  The tenant ID
 * @param mode
 *   - 'fresh': clear session dir, show QR (used when user clicks "Connect")
 *   - 'restore': reuse existing session files (used on server restart)
 */
export async function createBaileysSession(
  businessId: string,
  mode: 'fresh' | 'restore' = 'fresh',
): Promise<BaileysSession> {
  // Already running? Return existing
  const existing = sessions.get(businessId);
  if (existing) return existing;

  const sessionDir = path.join(SESSIONS_DIR, businessId);

  let version: [number, number, number] | undefined;
  try {
    const v = await fetchLatestBaileysVersion();
    version = v.version;
  } catch {
    console.warn('[Baileys] Usando versao padrao');
  }

  const session: BaileysSession = {
    sock: null,
    listeners: new Set(),
    isConnected: false,
    lastQr: null,
  };

  sessions.set(businessId, session);

  let restartCount = 0;

  async function startSocket(clearFirst: boolean) {
    if (clearFirst) {
      clearSessionDir(sessionDir);
    } else {
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
      version,
      auth: state,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger: pino({ level: 'silent' }) as any,
      browser: Browsers.macOS('Desktop'),
      printQRInTerminal: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: false,
      defaultQueryTimeoutMs: 60_000,
    });

    session.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    // ── Message listener ──
    sock.ev.on('messages.upsert', async ({ messages: waMessages, type }: { messages: WAMessage[]; type: MessageUpsertType }) => {
      if (type !== 'notify') return;

      for (const waMsg of waMessages) {
        try {
          if (waMsg.key.fromMe) continue;
          if (waMsg.key.remoteJid === 'status@broadcast') continue;
          if (waMsg.key.remoteJid?.endsWith('@g.us')) continue;
          if (!waMsg.message) continue;
          if (waMsg.message.protocolMessage || waMsg.message.reactionMessage) continue;

          await handleInboundMessage(businessId, waMsg, sock);
        } catch (err) {
          console.error('[Baileys] Erro ao processar mensagem:', err);
        }
      }
    });

    // ── Outbound status receipts (sent / delivered / read) ──
    sock.ev.on('messages.update', async (updates: WAMessageUpdate[]) => {
      try {
        await handleOutboundStatusUpdate(businessId, updates);
      } catch (err) {
        console.error('[Baileys] Erro em messages.update:', err);
      }
    });

    // ── Connection lifecycle ──
    sock.ev.on('connection.update', async (update: { connection?: string; lastDisconnect?: { error?: Error }; qr?: string }) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
          session.lastQr = qrDataUrl;
          broadcast(session, { type: 'qr', qr: qrDataUrl });
        } catch (err) {
          console.error('[Baileys] QR generation error:', err);
        }
      }

      if (connection === 'open') {
        session.isConnected = true;
        restartCount = 0;
        const phoneNumber = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0] || null;
        console.log('[Baileys] Conectado! Tel:', phoneNumber, '| business:', businessId);

        // Persist first — then notify the UI. This way `onSnapshot` listeners on
        // `businesses/{id}.channels.whatsapp` already see the updated state when the
        // modal closes. Writes failing is surfaced so the UI doesn't get stuck.
        try {
          await updateFirestoreConnection(businessId, phoneNumber);
        } catch (err) {
          console.error('[Baileys] Failed to persist connection to Firestore:', err);
          broadcast(session, { type: 'error', message: 'Conectado, mas falhou ao salvar status. Tente reconectar.' });
          return;
        }
        broadcast(session, { type: 'connected', phoneNumber, status: 'connected' });
      }

      if (connection === 'close') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;

        console.warn('[Baileys] Conexao fechada:', { statusCode, message: lastDisconnect?.error?.message });

        if (statusCode === DisconnectReason.loggedOut) {
          broadcast(session, { type: 'disconnected', reason: 'logged_out' });
          clearSessionDir(sessionDir);
          destroySession(businessId);
          return;
        }

        if (RESTARTABLE_CODES.has(statusCode) && restartCount < MAX_AUTO_RESTARTS) {
          restartCount++;
          const delay = Math.min(1000 * restartCount, 5000);
          console.log(`[Baileys] Auto-restart ${restartCount}/${MAX_AUTO_RESTARTS} em ${delay}ms (code: ${statusCode})`);

          broadcast(session, { type: 'status', status: 'reconnecting', attempt: restartCount });

          setTimeout(() => {
            const keepSession = statusCode === DisconnectReason.restartRequired;
            startSocket(!keepSession).catch((err) => {
              console.error('[Baileys] Auto-restart falhou:', err);
              broadcast(session, { type: 'error', message: 'Falha ao reconectar. Tente novamente.' });
              destroySession(businessId);
            });
          }, delay);
          return;
        }

        broadcast(session, { type: 'error', message: 'Conexao fechada pelo WhatsApp. Tente novamente.' });
        destroySession(businessId);
      }
    });
  }

  // First start
  const isFresh = mode === 'fresh';
  await startSocket(isFresh);

  return session;
}
