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
import { getAlternativeBrazilianPhone } from '@/lib/utils/phoneAlternatives';

// ─── Constants ───────────────────────────────────────────────────────────────

export const SESSIONS_DIR = path.join(process.cwd(), 'whatsapp-sessions');

const RESTARTABLE_CODES = new Set([
  DisconnectReason.restartRequired,
  DisconnectReason.timedOut,
  DisconnectReason.connectionClosed,
  DisconnectReason.connectionReplaced,
]);

// Códigos que indicam logout real — a sessão foi revogada e NÃO deve ser reiniciada.
// Qualquer outro código (incluindo undefined = rede caiu) deve tentar restart.
const PERMANENT_DISCONNECT_CODES = new Set([
  DisconnectReason.loggedOut,
  DisconnectReason.multideviceMismatch,
  DisconnectReason.forbidden,
]);

const MAX_AUTO_RESTARTS = 8;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BaileysSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sock: any;
  listeners: Set<(data: Record<string, unknown>) => void>;
  isConnected: boolean;
  lastQr: string | null;
  /** Marcado true em destroySession() para que o handler de connection.close pule o auto-restart. */
  isDestroyed: boolean;
  /** ID da channelConnection associada — chave da sessão no Map. */
  connectionId: string;
  /** Tenant. handleInboundMessage usa pra atribuir msgs entrantes. */
  businessId: string;
  /** LID (@lid) → número de telefone (dígitos). Populado por contacts.upsert. */
  lidToPhone: Map<string, string>;
}

// ─── Global Singleton Map ────────────────────────────────────────────────────

// Attach to globalThis to survive HMR in dev.
// CHAVE: connectionId (não businessId) — suporta múltiplas sessões por business
// (canais pessoais de operadores na Phase 2). Para callers que ainda passam
// apenas businessId, resolveConnectionIdForBaileys() mapeia → primary do business.
const globalSessions = (globalThis as Record<string, unknown>);
if (!globalSessions.__baileySessions) {
  globalSessions.__baileySessions = new Map<string, BaileysSession>();
}
export const sessions = globalSessions.__baileySessions as Map<string, BaileysSession>;

/**
 * Resolve connectionId final pra usar como chave de sessão.
 *  - Se explicitConnectionId fornecido, retorna ele direto (caller sabe qual)
 *  - Senão, busca/cria a connection 'business' primária Baileys do businessId
 *
 * Usar em todos os pontos onde uma sessão precisa ser endereçada.
 */
async function resolveConnectionIdForBaileys(
  businessId: string,
  explicitConnectionId?: string,
): Promise<string> {
  if (explicitConnectionId) return explicitConnectionId;
  const { ensurePrimaryBaileysBusinessConnection } = await import('@/lib/services/channels/channelConnections');
  const conn = await ensurePrimaryBaileysBusinessConnection(businessId);
  return conn.id;
}

/**
 * Espelho local do connectionId em Map<businessId, connectionId> pra paths
 * síncronos que precisam da chave (ex: callers legados que só têm businessId
 * em mãos). Populado depois que resolveConnectionIdForBaileys roda.
 *
 * Como `sessions`, vive em globalThis pra sobreviver HMR em dev — sem isso
 * o cache zerava em cada reload e getConnectedSession(businessId) retornava
 * null mesmo com sessão viva no Map global.
 */
if (!globalSessions.__baileysBusinessToConn) {
  globalSessions.__baileysBusinessToConn = new Map<string, string>();
}
const businessToConnectionId = globalSessions.__baileysBusinessToConn as Map<string, string>;
function rememberBusinessKey(businessId: string, connectionId: string): void {
  businessToConnectionId.set(businessId, connectionId);
}
function forgetBusinessKey(businessId: string, connectionId: string): void {
  if (businessToConnectionId.get(businessId) === connectionId) {
    businessToConnectionId.delete(businessId);
  }
}

/**
 * Sincronia: tenta resolver connectionId pelo cache local. Útil em pontos
 * onde fazer await é caro (ex: getConnectedSession). Retorna null se não
 * conhecido — caller pode cair pro async resolver.
 */
function tryResolveConnectionIdSync(businessId: string): string | null {
  return businessToConnectionId.get(businessId) || null;
}



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
  // Interactive response: list selection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listReply = (msg as any).listResponseMessage?.singleSelectReply?.title as string | undefined;
  if (listReply) return listReply;
  // Interactive response: button tap
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buttonReply = (msg as any).buttonsResponseMessage?.selectedDisplayText as string | undefined;
  if (buttonReply) return buttonReply;
  // Interactive response: template button reply
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const templateReply = (msg as any).templateButtonReplyMessage?.selectedDisplayText as string | undefined;
  if (templateReply) return templateReply;
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

/**
 * Marca a conexão como desconectada no Firestore. Usado quando a sessão é
 * encerrada por evento server-side (loggedOut do telefone, falha após
 * MAX_AUTO_RESTARTS, etc) — sem isso, channelConnections + businesses.channels
 * ficam dizendo isConnected=true mesmo com a sessão morta, e UI/send query
 * resultam em comportamento confuso ("conectado" mas envio falha).
 */
async function persistDisconnect(businessId: string, connectionId: string): Promise<void> {
  const now = new Date().toISOString();
  // Atualiza connection doc (modelo novo)
  try {
    const { updateConnection } = await import('@/lib/services/channels/channelConnections');
    await updateConnection(connectionId, {
      isConnected: false,
      disconnectedAt: now,
    });
  } catch (err) {
    console.warn('[Baileys] persistDisconnect: connection update failed:', err);
  }
  // Atualiza businesses.channels.whatsappBaileys (legado) só se for business connection
  try {
    const connSnap = await adminDb.collection('channelConnections').doc(connectionId).get();
    const isBusinessConn = !connSnap.exists || connSnap.data()?.ownerType !== 'user';
    if (isBusinessConn) {
      await adminDb.collection('businesses').doc(businessId).update({
        'channels.whatsappBaileys.isConnected': false,
        'channels.whatsappBaileys.disconnectedAt': now,
        updatedAt: now,
      });
    }
  } catch (err) {
    console.warn('[Baileys] persistDisconnect: legacy businesses update failed:', err);
  }
}

async function updateFirestoreConnection(
  businessId: string,
  phoneNumber: string | null,
  connectionId?: string,
) {
  const now = new Date().toISOString();
  // Atualização do connection doc (modelo novo). Sempre tentamos antes do
  // legado, pra que o estado autoritativo (channelConnections) reflita o
  // mais rápido possível mesmo se o write legacy falhar.
  if (connectionId) {
    try {
      const { updateConnection } = await import('@/lib/services/channels/channelConnections');
      await updateConnection(connectionId, {
        isConnected: true,
        connectedAt: now,
        phoneNumber: phoneNumber || undefined,
      });
    } catch (connErr) {
      console.warn('[Baileys] channelConnections direct update failed:', connErr);
    }
  }

  try {
    // Escreve APENAS em channels.whatsappBaileys — campo isolado.
    // O campo legado channels.whatsapp não é mais tocado para que conexões
    // Cloud paralelas sobrevivam.
    // ATENÇÃO: para canais 'user' (Phase 2), NÃO sobrescrever — esse path
    // é compartilhado entre business e user channels mas businesses.channels.*
    // é apenas pra business. Verifica via connectionId quando disponível.
    let isBusinessConnection = true;
    if (connectionId) {
      try {
        const snap = await adminDb.collection('channelConnections').doc(connectionId).get();
        const data = snap.data();
        isBusinessConnection = !data || data.ownerType !== 'user';
      } catch { /* assume business */ }
    }

    if (isBusinessConnection) {
      await adminDb.collection('businesses').doc(businessId).update({
        'channels.whatsappBaileys': {
          isConnected: true,
          connectedAt: now,
          phoneNumber: phoneNumber || '',
          displayPhoneNumber: phoneNumber || '',
        },
        updatedAt: now,
      });

      // Sync channelConnections via legacy ensure (cobre case onde connection
      // ainda não existe, ex: primeiro connect num tenant fresh).
      try {
        const { ensureBusinessConnectionsFromLegacy } = await import('@/lib/services/channels/channelConnections');
        await ensureBusinessConnectionsFromLegacy(businessId);
      } catch (syncErr) {
        console.warn('[Baileys] channelConnections sync after connect failed:', syncErr);
      }
    }
  } catch (err) {
    console.error('[Baileys] Firestore connection update error:', err);
  }
}

// ─── Public: send simple text message via Baileys ────────────────────────────

/**
 * Envia uma mensagem de texto simples via Baileys.
 *
 * Diferente de `sendWhatsAppBaileys` em conversations/send, esta versão é
 * voltada a broadcasts: recebe o número diretamente (já em E.164) e não
 * precisa fazer lookup em conversations.
 *
 * Lança erro se a sessão não está conectada ou se o número não tem WhatsApp.
 */
export async function sendBaileysBroadcastMessage(
  businessId: string,
  phoneNumber: string,
  text: string,
  connectionId?: string,
): Promise<{ externalMessageId: string }> {
  // Resolve a chave de sessão (connectionId). Caller pode passar explicitly
  // pra usar canal pessoal de um operador; default é a primary business.
  const sessionKey = await resolveConnectionIdForBaileys(businessId, connectionId);
  let session = sessions.get(sessionKey);
  console.log('[Baileys Broadcast] Initial session check:', {
    businessId,
    sessionKey,
    hasSession: !!session,
    hasSock: !!session?.sock,
    isConnected: session?.isConnected,
    mapSize: sessions.size,
  });

  // Lazy restore: se sessão não está em memória OU está mas o sock não conectou
  // (caso típico após restart do server), tenta restaurar automaticamente em
  // vez de falhar. Evita que o operador precise re-escanear o QR Code.
  if (!session?.sock || !session.isConnected) {
    const sessionDir = path.join(SESSIONS_DIR, sessionKey);
    const hasSessionFiles = fs.existsSync(sessionDir)
      && fs.readdirSync(sessionDir).some((f) => f.endsWith('.json'));
    console.log('[Baileys Broadcast] Session files on disk:', { sessionDir, hasSessionFiles });

    if (hasSessionFiles) {
      // Se já há uma session no map mas sock não conectou (restore em andamento
      // ou travado), aguarda direto sem chamar createBaileysSession de novo
      // (que é idempotente mas iniciaria loop).
      if (!session) {
        console.log(`[Baileys Broadcast] Lazy-restoring session for connectionId: ${sessionKey}`);
        try {
          await createBaileysSession(businessId, 'restore', sessionKey);
        } catch (err) {
          console.error('[Baileys Broadcast] Lazy restore failed:', err);
        }
      }

      // Aguarda até 30s pela conexão completar
      const startedAt = Date.now();
      const TIMEOUT_MS = 30_000;
      while (Date.now() - startedAt < TIMEOUT_MS) {
        const s = sessions.get(sessionKey);
        if (s?.isConnected) {
          console.log(`[Baileys Broadcast] Session connected after ${Date.now() - startedAt}ms`);
          session = s;
          break;
        }
        await new Promise(r => setTimeout(r, 250));
      }
      session = sessions.get(sessionKey);
    }

    if (!session?.sock) {
      throw new Error('WhatsApp Web não está conectado. Reconecte escaneando o QR Code em Configurações.');
    }
    if (!session.isConnected) {
      throw new Error('WhatsApp Web está reconectando (timeout 30s). Aguarde a conexão completar e tente novamente.');
    }
  }

  // phoneNumber já vem em E.164 (apenas dígitos) do RecipientListInput
  const digits = phoneNumber.replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new Error(`Número inválido: ${phoneNumber}`);
  }

  // onWhatsApp resolve o JID canônico (lida com 9º dígito BR) e indica se número
  // tem WhatsApp. Em caso de erro de rede ou !exists, deixamos o sendMessage falhar
  // naturalmente — evita anti-pattern de string-match no error message.
  const candidateJid = `${digits}@s.whatsapp.net`;
  let targetJid = candidateJid;
  let knownNotOnWhatsApp = false;
  try {
    const [result] = await session.sock.onWhatsApp(candidateJid);
    if (result?.exists && result.jid) {
      targetJid = result.jid;
    } else if (result && !result.exists) {
      knownNotOnWhatsApp = true;
    }
  } catch (err) {
    // Erro de rede no check — não bloqueia, o sendMessage falhará se necessário
    console.warn('[Baileys Broadcast] onWhatsApp check falhou, tentando envio direto:', err);
  }

  if (knownNotOnWhatsApp) {
    throw new Error(`Número ${digits} não está cadastrado no WhatsApp`);
  }

  const sent = await session.sock.sendMessage(targetJid, { text });
  // Random suffix evita colisão se sent.key.id ausente em mensagens consecutivas
  const externalMessageId = sent?.key?.id
    || `baileys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { externalMessageId };
}

// ─── Firestore: save inbound message ─────────────────────────────────────────

async function handleInboundMessage(
  businessId: string,
  connectionId: string,
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
    // LID (Linked Device ID) — Baileys 7+ usa LIDs em vez de telefones.
    // Prioridade: lidToPhone map → participantAlt → remoteJidAlt → participant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const key = waMessage.key as any;
    const session = sessions.get(connectionId);

    // 1. Nosso mapa LID→phone (populado por contacts.upsert)
    const mappedPhone = session?.lidToPhone.get(rawJid);
    if (mappedPhone && /^\d{10,15}$/.test(mappedPhone)) {
      senderPhone = mappedPhone;
    } else {
      // 2. participantAlt (campo novo do Baileys 7 — prioridade sobre remoteJidAlt)
      const participantAlt = key.participantAlt as string | undefined;
      const remoteJidAlt = key.remoteJidAlt as string | undefined;
      const keyParticipant = waMessage.key.participant;
      const msgParticipant = key.participant as string | undefined;

      const resolved = [participantAlt, remoteJidAlt, keyParticipant, msgParticipant]
        .find(j => j && j.includes('@s.whatsapp.net'));

      if (resolved) {
        senderPhone = resolved.replace('@s.whatsapp.net', '');
        jidForProfile = resolved;
      } else {
        // Última tentativa: tenta o mapa com variantes do LID
        const lidDigits = rawJid.replace('@lid', '');
        const mappedFallback = session?.lidToPhone.get(lidDigits);
        if (mappedFallback && /^\d{10,15}$/.test(mappedFallback)) {
          senderPhone = mappedFallback;
        } else {
          console.warn('[Baileys] @lid sem resolução de telefone. Ignorando:', rawJid, { participantAlt, remoteJidAlt });
          return;
        }
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
    const altPhone = getAlternativeBrazilianPhone(senderPhone);

    // Phase 2 P1.2: find-or-create por (contato + canal específico). Antes a
    // query só filtrava por contactExternalId, então mesmo contato falando em
    // dois canais do business virava UMA única conv com channelConnectionId
    // pulando a cada mensagem (flip-flop). Agora cada (contato, canal) é uma
    // thread separada — o que reflete a realidade UX (canais são identidades
    // distintas pro contato).
    //
    // Estratégia da query: busca até 5 candidates por contactExternalId, depois
    // escolhe o melhor:
    //   1. Match exato (mesmo channelConnectionId)
    //   2. Conversa legada sem channelConnectionId (será backfillada)
    //   3. Nada → cria nova thread (ignora candidates de OUTRO canal)
    const pickBestCandidate = (
      docs: FirebaseFirestore.QueryDocumentSnapshot[],
    ): FirebaseFirestore.QueryDocumentSnapshot | null => {
      let legacy: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      for (const d of docs) {
        const docConnId = d.data().channelConnectionId as string | undefined;
        if (docConnId === connectionId) return d; // match exato — melhor opção
        if (!docConnId && !legacy) legacy = d;     // legacy sem conn — fallback
      }
      return legacy;
    };

    // Phase 3 audit P1.1: orderBy lastMessageAt desc — quando há 2+ legacies
    // sem channelConnectionId (tenant pré-migração), pegamos a mais recente
    // como representativa do thread "vivo". Sem isso, Firestore não garante
    // ordem estável e backfill virava aleatório.
    let candidates = (await adminDb.collection('conversations')
      .where('businessId', '==', businessId)
      .where('channel', '==', 'whatsapp')
      .where('contactExternalId', '==', senderPhone)
      .orderBy('lastMessageAt', 'desc')
      .limit(5)
      .get()).docs;

    if (candidates.length === 0 && altPhone) {
      candidates = (await adminDb.collection('conversations')
        .where('businessId', '==', businessId)
        .where('channel', '==', 'whatsapp')
        .where('contactExternalId', '==', altPhone)
        .orderBy('lastMessageAt', 'desc')
        .limit(5)
        .get()).docs;
    }

    const matchedDoc = pickBestCandidate(candidates);
    let conversationId: string;

    if (!matchedDoc) {
      // Auto-assign para canais pessoais (ownerType='user'): a conversa que
      // chega num canal pessoal pertence ao owner do canal por default.
      // Outros operators continuam vendo (até implementarmos rule server-side
      // pra restringir), mas a atribuição inicial fica clara.
      let initialAssignedTo: string | undefined;
      let initialAssignedToName: string | undefined;
      try {
        const connSnap = await adminDb.collection('channelConnections').doc(connectionId).get();
        const connData = connSnap.data();
        if (connData?.ownerType === 'user' && connData.ownerId) {
          initialAssignedTo = connData.ownerId as string;
          // Tenta puxar nome do owner pra denormalizar
          try {
            const userSnap = await adminDb.collection('users').doc(initialAssignedTo).get();
            initialAssignedToName = (userSnap.data()?.name as string) || undefined;
          } catch { /* opcional */ }
        }
      } catch { /* connection lookup falhou — sem auto-assign */ }

      const newConvRef = await adminDb.collection('conversations').add({
        businessId,
        channel: 'whatsapp',
        connectedVia: 'baileys',
        // Vincula a conversa ao canal específico que recebeu a msg.
        // Essencial pra reply: send/route.ts resolve a sessão correta a
        // partir desse campo. Sem isso, send caía pra primary business
        // mesmo quando a msg veio em canal pessoal (ownerType='user').
        channelConnectionId: connectionId,
        contactName,
        contactPhone: formatPhone(senderPhone),
        contactExternalId: senderPhone,
        ...(avatarUrl ? { contactAvatarUrl: avatarUrl } : {}),
        ...(initialAssignedTo ? { assignedTo: initialAssignedTo } : {}),
        ...(initialAssignedToName ? { assignedToName: initialAssignedToName } : {}),
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
      conversationId = matchedDoc.id;
      const existingConv = matchedDoc.data();

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
      // Backfill / correção do channelConnectionId — Baileys é autoritativo
      // (sabemos exatamente qual sessão entregou a msg). Atualiza se ausente
      // OU se diferente (caso de migração de canal-empresa pra pessoal).
      if (existingConv.channelConnectionId !== connectionId) {
        convUpdate.channelConnectionId = connectionId;
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

    // Dispatch to AI agent — true fire-and-forget (debounce runs inside, do NOT await)
    const _baileysDlog = (m: string) => { const l = `${new Date().toISOString()} ${m}\n`; process.stdout.write(l); try { fs.appendFileSync('/tmp/dispatch.log', l); } catch {} };
    _baileysDlog(`[Baileys] handleInboundMessage reached dispatch — conv=${conversationId.slice(-6)} biz=${businessId.slice(-6)} msg="${displayText.slice(0,50)}"`);
    try {
      const { dispatchInboundToAgent } = await import('@/lib/agent/dispatch');
      _baileysDlog(`[Baileys] dispatchInboundToAgent imported OK`);
      // Baileys messages.upsert only fires for !fromMe messages (filtered at line ~877),
      // so these are always contact-originated inbound — never internal operator notes.
      dispatchInboundToAgent(adminDb, {
        businessId,
        conversationId,
        messageId: msgRef.id,
        channel: 'whatsapp',
        message: displayText,
        contactName,
        contactPhone: senderPhone,
        recipientId: senderPhone,
        // Baileys listener filters fromMe=true before calling handleInboundMessage,
        // so this is always a contact message, never an internal note.
        isInternal: false,
      }).catch(agentErr => console.warn('[Baileys] Agent dispatch promise rejected:', agentErr));
    } catch (agentErr) {
      console.warn('[Baileys] Agent dispatch import/call failed:', agentErr);
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

/**
 * Retorna a sessão conectada. Aceita businessId (compat — usa cache síncrono)
 * ou connectionId (alvo direto).
 *
 * Quando businessId é passado mas não há cache (sessão nunca passou pelo
 * resolver async), retorna null mesmo se a sessão exista — caller deve usar
 * variantes async (sendBaileysBroadcastMessage, etc) que resolvem corretamente.
 */
export function getConnectedSession(businessIdOrConnectionId: string): BaileysSession | null {
  // Tenta como connectionId direto primeiro
  let session = sessions.get(businessIdOrConnectionId);
  if (session?.isConnected) return session;
  // Fallback: trata como businessId e olha no cache local
  const cachedKey = tryResolveConnectionIdSync(businessIdOrConnectionId);
  if (cachedKey) {
    session = sessions.get(cachedKey);
    if (session?.isConnected) return session;
  }
  return null;
}

/**
 * Destrói uma sessão Baileys. Aceita businessId (compat) ou connectionId.
 * Quando connectionId fornecido, alvo direto. Senão, resolve via cache local
 * (rápido, síncrono) ou async pra primary business.
 */
export async function destroySession(businessId: string, connectionId?: string): Promise<void> {
  const sessionKey = connectionId
    || tryResolveConnectionIdSync(businessId)
    || await resolveConnectionIdForBaileys(businessId);
  const session = sessions.get(sessionKey);
  if (!session) return;

  // Mark destroyed BEFORE sock.end() so the async connection.close handler
  // sees isDestroyed=true and skips any auto-restart logic.
  session.isDestroyed = true;

  for (const listener of session.listeners) {
    try { listener({ type: 'stream_end' }); } catch { /* ignore */ }
  }
  session.listeners.clear();

  if (session.sock) {
    try { session.sock.end(undefined); } catch { /* ignore */ }
  }

  sessions.delete(sessionKey);
  forgetBusinessKey(businessId, sessionKey);
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
  connectionId?: string,
): Promise<BaileysSession> {
  // Resolve qual connection é a sessão. Caller pode passar explicitamente pra
  // canais pessoais; default = primary business (cria se ausente).
  const sessionKey = await resolveConnectionIdForBaileys(businessId, connectionId);

  // Already running? Return existing
  const existing = sessions.get(sessionKey);
  if (existing) return existing;

  // Migração one-shot do dir legado (whatsapp-sessions/{businessId}) pra novo
  // (whatsapp-sessions/{connectionId}). Garante que sessões já autenticadas
  // pré-Phase 2 sobrevivam sem requerer re-scan de QR.
  const newDir = path.join(SESSIONS_DIR, sessionKey);
  const legacyDir = path.join(SESSIONS_DIR, businessId);
  if (legacyDir !== newDir && fs.existsSync(legacyDir) && !fs.existsSync(newDir)) {
    let migrated = false;
    try {
      fs.renameSync(legacyDir, newDir);
      console.log(`[Baileys] Migrated session dir: ${businessId} → ${sessionKey}`);
      migrated = true;
    } catch (renameErr) {
      try {
        fs.cpSync(legacyDir, newDir, { recursive: true });
        fs.rmSync(legacyDir, { recursive: true, force: true });
        console.log(`[Baileys] Copied session dir: ${businessId} → ${sessionKey}`);
        migrated = true;
      } catch (cpErr) {
        console.error('[Baileys] CRITICAL: Failed to migrate session dir:', renameErr, cpErr);
      }
    }
    if (!migrated) {
      // Cleanup do dir parcial se cpSync deixou algo
      try { if (fs.existsSync(newDir)) fs.rmSync(newDir, { recursive: true, force: true }); } catch { /* ignore */ }
      throw new Error(
        `Falha ao migrar sessão Baileys (${businessId} → ${sessionKey}). ` +
        `Re-escaneie o QR Code em Configurações → Canais.`
      );
    }
  }
  const sessionDir = newDir;

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
    isDestroyed: false,
    connectionId: sessionKey,
    businessId,
    lidToPhone: new Map(),
  };

  sessions.set(sessionKey, session);
  rememberBusinessKey(businessId, sessionKey);

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
      // Keep-alive ping a cada 25s evita que o WA feche a conexão por inatividade
      keepAliveIntervalMs: 25_000,
      // Backoff em retries de request (ex: envio de msg com rede instável)
      retryRequestDelayMs: 500,
    });

    session.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    // ── Contact LID → phone map (Baileys 7+) ──
    // WhatsApp multi-device usa LIDs (@lid) em vez de telefones em alguns eventos.
    // Populamos o mapa aqui para que handleInboundMessage possa resolver LIDs.
    sock.ev.on('contacts.upsert', (contacts: import('@whiskeysockets/baileys').Contact[]) => {
      for (const c of contacts) {
        const rawPhone = c.phoneNumber?.replace(/\D/g, '');
        if (!rawPhone) continue;
        // Mapeia lid@lid → dígitos do telefone
        if (c.lid) session.lidToPhone.set(c.lid, rawPhone);
        // Mapeia também o próprio JID principal (pode ser @s.whatsapp.net ou @lid)
        if (c.id) session.lidToPhone.set(c.id, rawPhone);
      }
    });

    // ── Message listener ──
    sock.ev.on('messages.upsert', async ({ messages: waMessages, type }: { messages: WAMessage[]; type: MessageUpsertType }) => {
      for (const waMsg of waMessages) {
        try {
          if (waMsg.key.fromMe) continue;
          if (waMsg.key.remoteJid === 'status@broadcast') continue;
          if (waMsg.key.remoteJid?.endsWith('@g.us')) continue;
          if (!waMsg.message) continue;
          if (waMsg.message.protocolMessage || waMsg.message.reactionMessage) continue;

          // For 'append' (history sync after reconnect), only process recent messages.
          // This ensures messages received during a brief disconnect are not lost while
          // ignoring true historical messages loaded on session start.
          if (type !== 'notify') {
            const tsRaw = waMsg.messageTimestamp;
            const tsMs = (typeof tsRaw === 'number' ? tsRaw : Number(tsRaw)) * 1000;
            if (Date.now() - tsMs > 5 * 60 * 1000) continue; // older than 5 min → skip
          }

          await handleInboundMessage(businessId, sessionKey, waMsg, sock);
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

        // Extrai o número do próprio telefone conectado.
        // Prioridade: Contact.phoneNumber (canônico) → JID convencional → LID via mapa
        let phoneNumber: string | null = null;
        const me = sock.user as (import('@whiskeysockets/baileys').Contact & { phoneNumber?: string }) | undefined;
        if (me?.phoneNumber) {
          phoneNumber = me.phoneNumber.replace(/\D/g, '') || null;
        } else if (me?.id && !me.id.endsWith('@lid')) {
          // Formato convencional: "55119...@s.whatsapp.net" ou "55119...:10@s.whatsapp.net"
          phoneNumber = me.id.split(':')[0].split('@')[0] || null;
        } else if (me?.id && me.id.endsWith('@lid')) {
          // Conta LID — tenta resolver via mapa (populado por contacts.upsert)
          phoneNumber = session.lidToPhone.get(me.id) || session.lidToPhone.get(me.lid || '') || null;
        }
        console.log('[Baileys] Conectado! Tel:', phoneNumber, '| userId:', me?.id, '| business:', businessId);

        // Persist first — then notify the UI. This way `onSnapshot` listeners on
        // `businesses/{id}.channels.whatsapp` already see the updated state when the
        // modal closes. Writes failing is surfaced so the UI doesn't get stuck.
        try {
          await updateFirestoreConnection(businessId, phoneNumber, sessionKey);
        } catch (err) {
          console.error('[Baileys] Failed to persist connection to Firestore:', err);
          broadcast(session, { type: 'error', message: 'Conectado, mas falhou ao salvar status. Tente reconectar.' });
          return;
        }
        broadcast(session, { type: 'connected', phoneNumber, status: 'connected' });
      }

      if (connection === 'close') {
        // Session was destroyed externally (e.g. disconnect endpoint) — do not restart.
        if (session.isDestroyed) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;

        console.warn('[Baileys] Conexao fechada:', { statusCode, message: lastDisconnect?.error?.message });

        // Logout real: sessão revogada pelo WA — limpar e não tentar restart.
        if (PERMANENT_DISCONNECT_CODES.has(statusCode)) {
          broadcast(session, { type: 'disconnected', reason: 'logged_out' });
          void persistDisconnect(businessId, sessionKey).catch((err) => {
            console.error('[Baileys] Failed to persist logout state:', err);
          });
          clearSessionDir(sessionDir);
          void destroySession(businessId, sessionKey);
          return;
        }

        // Qualquer outro fechamento (incluindo statusCode=undefined, que indica
        // queda de rede sem código específico) é tratado como restartable.
        // Antes: undefined caia no destroySession — o usuário precisava re-escanear
        // QR a cada oscilação de rede. Agora: tenta reconectar com backoff exponencial.
        if (restartCount < MAX_AUTO_RESTARTS) {
          restartCount++;
          // Backoff exponencial com jitter: 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s
          const baseDelay = Math.min(1000 * Math.pow(2, restartCount - 1), 30_000);
          const jitter = Math.floor(Math.random() * 1000);
          const delay = baseDelay + jitter;
          console.log(`[Baileys] Auto-restart ${restartCount}/${MAX_AUTO_RESTARTS} em ${delay}ms (code: ${statusCode ?? 'undefined'})`);

          broadcast(session, { type: 'status', status: 'reconnecting', attempt: restartCount });

          setTimeout(() => {
            // restartRequired pede pra manter credenciais; outros casos limpam socket mas
            // mantêm session dir (não é loggedOut, só reconecta)
            const keepSession = statusCode === DisconnectReason.restartRequired || statusCode === undefined;
            startSocket(!keepSession).catch((err) => {
              console.error('[Baileys] Auto-restart falhou:', err);
              broadcast(session, { type: 'error', message: 'Falha ao reconectar. Tente novamente.' });
              void persistDisconnect(businessId, sessionKey).catch(() => {});
              void destroySession(businessId, sessionKey);
            });
          }, delay);
          return;
        }

        // Esgotou MAX_AUTO_RESTARTS — desiste e informa o operador.
        console.error(`[Baileys] Esgotou ${MAX_AUTO_RESTARTS} tentativas de restart (último code: ${statusCode})`);
        broadcast(session, { type: 'error', message: 'Não foi possível reconectar após várias tentativas. Verifique sua conexão e re-escaneie o QR Code.' });
        void persistDisconnect(businessId, sessionKey).catch(() => {});
        void destroySession(businessId, sessionKey);
      }
    });
  }

  // First start
  const isFresh = mode === 'fresh';
  await startSocket(isFresh);

  return session;
}
