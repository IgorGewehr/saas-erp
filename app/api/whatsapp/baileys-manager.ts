/**
 * Baileys Session Manager — Singleton module
 *
 * Shared between /api/whatsapp/connect (SSE QR) and /api/whatsapp/restore (auto-restore).
 * Manages one Baileys socket per businessId in a global Map.
 */

import fs from 'node:fs';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  proto,
  WAMessage,
  WAMessageUpdate,
  MessageUpsertType,
} from '@whiskeysockets/baileys';
import {
  useFirestoreAuthState,
  hasFirestoreAuthState,
  deleteFirestoreAuthState,
} from '@/lib/services/baileys/firestore-auth-state';
import { downloadAndUploadBaileysMedia } from '@/lib/services/baileys/media-storage';
import QRCode from 'qrcode';
import pino from 'pino';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { getAlternativeBrazilianPhone } from '@/lib/utils/phoneAlternatives';

// ─── Constants ───────────────────────────────────────────────────────────────

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

// Logger silencioso compartilhado — usado por downloadMediaMessage de Baileys.
// Singleton pra evitar criar nova instância de pino a cada mensagem inbound
// com mídia (cada instance abre file descriptor pro stderr).
const SILENT_LOGGER = pino({ level: 'silent' });

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
  /** Contadores de debug — atualizados em tempo real pelos event listeners. */
  _dbg: {
    upsertFired: number;
    upsertNotify: number;
    filtered: {
      fromMe: number;
      noMsg: number;
      group: number;
      lid: number;
      statusBroadcast: number;  // separado de protocolMessage agora
      protocolMsg: number;      // waMsg.message.protocolMessage
      reactionMsg: number;      // waMsg.message.reactionMessage
      oldAppend: number;        // type=append e mais velho que 5min
    };
    processed: number;
    saved: number;
    earlyReturn: number;
    lastRawJid: string | null;
    lastSavedConvId: string | null;   // ID da última conversa salva
    lastSavedMsgId: string | null;    // ID da última mensagem salva
    lastSavedPhone: string | null;    // telefone do último remetente salvo
    lastMsgTypes: string[];     // últimos 5 tipos de waMsg.message que chegaram
    lastError: string | null;
    lastErrorAt: string | null;
    contactsUpserted: number;
  };
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
 * Lock de criação de sessão por sessionKey. Resolve race condition: dois
 * requests concorrentes pra `createBaileysSession(...sessionKey)` chegavam
 * juntos, ambos passavam o check `sessions.get(...)` (Map vazio) e ambos
 * criavam socket — segundo socket ficava órfão (sem ref no Map) e WhatsApp
 * mandava connectionReplaced num deles.
 *
 * Cenários reais que disparam:
 *   - Operador clica "Conectar" 2x rapidamente
 *   - Múltiplas tabs abertas com a app
 *   - Restart do servidor enquanto operador também tenta conectar (instrumentation hook + UI request)
 *
 * Usa globalSessions pra sobreviver HMR em dev — mesmo padrão das outras maps.
 */
if (!globalSessions.__baileysSessionLocks) {
  globalSessions.__baileysSessionLocks = new Map<string, Promise<BaileysSession>>();
}
const sessionLocks = globalSessions.__baileysSessionLocks as Map<string, Promise<BaileysSession>>;

/**
 * Sincronia: tenta resolver connectionId pelo cache local. Útil em pontos
 * onde fazer await é caro (ex: getConnectedSession). Retorna null se não
 * conhecido — caller pode cair pro async resolver.
 */
function tryResolveConnectionIdSync(businessId: string): string | null {
  return businessToConnectionId.get(businessId) || null;
}



// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  // Brasil: o 9º dígito foi obrigatório para celulares desde 2016.
  // O WhatsApp armazena internamente sem o 9º dígito (8 dígitos após DDD).
  // Celulares BR: primeiro dígito após DDD é 6-9 → inserir '9' antes.
  if (phone.length === 12 && phone.startsWith('55')) {
    const firstAfterDDD = phone[4];
    if (firstAfterDDD >= '6' && firstAfterDDD <= '9') {
      phone = phone.slice(0, 4) + '9' + phone.slice(4);
    }
  }
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
async function persistDisconnect(
  businessId: string,
  connectionId: string,
  reason?: 'replaced' | 'logged_out' | 'network' | 'manual',
): Promise<void> {
  const now = new Date().toISOString();
  // Atualiza connection doc (modelo novo)
  try {
    const { updateConnection } = await import('@/lib/services/channels/channelConnections');
    await updateConnection(connectionId, {
      isConnected: false,
      disconnectedAt: now,
      ...(reason ? { disconnectReason: reason } : {}),
    });
  } catch (err) {
    console.warn('[Baileys] persistDisconnect: connection update failed:', err);
  }
  // Atualiza businesses.channels.whatsappBaileys (legado) só se for business connection
  try {
    const connSnap = await adminDb.collection('channelConnections').doc(connectionId).get();
    const isBusinessConn = !connSnap.exists || connSnap.data()?.ownerType !== 'user';
    if (isBusinessConn) {
      const update: Record<string, unknown> = {
        'channels.whatsappBaileys.isConnected': false,
        'channels.whatsappBaileys.disconnectedAt': now,
        updatedAt: now,
      };
      if (reason) update['channels.whatsappBaileys.disconnectReason'] = reason;
      await adminDb.collection('businesses').doc(businessId).update(update);
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
/**
 * Garante que existe uma sessão Baileys conectada para `sessionKey`.
 *
 * Se a sessão está em memória e conectada, retorna direto. Caso contrário,
 * tenta restaurar a partir do auth state no Firestore (sem exigir QR scan
 * novo) e aguarda até 30s pela conexão completar.
 *
 * Usado por:
 *  - sendBaileysBroadcastMessage (broadcasts)
 *  - sendWhatsAppBaileys (envio 1:1 em conversas) — antes não tinha lazy
 *    restore, então qualquer reconexão pendente disparava "WhatsApp Web não
 *    está conectado" mesmo se o session estava restaurando legitimamente.
 *
 * Lança Error com mensagem orientando o operador quando não consegue.
 */
export async function ensureBaileysSessionConnected(
  businessId: string,
  sessionKey: string,
  logTag = 'Baileys',
): Promise<BaileysSession> {
  let session = sessions.get(sessionKey);
  console.log(`[${logTag}] Initial session check:`, {
    businessId,
    sessionKey,
    hasSession: !!session,
    hasSock: !!session?.sock,
    isConnected: session?.isConnected,
    mapSize: sessions.size,
  });

  if (session?.sock && session.isConnected) return session;

  // Lazy restore: tenta restaurar do Firestore antes de falhar.
  const hasAuthState = await hasFirestoreAuthState(sessionKey);
  console.log(`[${logTag}] Auth state in Firestore:`, { sessionKey, hasAuthState });

  if (hasAuthState) {
    // Se já há session no map (restore em andamento), só aguarda — não
    // chama createBaileysSession de novo pra evitar loop concorrente.
    if (!session) {
      console.log(`[${logTag}] Lazy-restoring session for connectionId: ${sessionKey}`);
      try {
        await createBaileysSession(businessId, 'restore', sessionKey);
      } catch (err) {
        console.error(`[${logTag}] Lazy restore failed:`, err);
      }
    }

    const startedAt = Date.now();
    const TIMEOUT_MS = 30_000;
    let nextLogAt = startedAt + 5_000;
    while (Date.now() - startedAt < TIMEOUT_MS) {
      const s = sessions.get(sessionKey);
      if (s?.isConnected) {
        console.log(`[${logTag}] Session connected after ${Date.now() - startedAt}ms`);
        return s;
      }
      if (Date.now() >= nextLogAt) {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        console.log(`[${logTag}] Aguardando reconexão... ${elapsed}s elapsed (hasSocket=${!!s?.sock}, isConnected=${s?.isConnected ?? false})`);
        nextLogAt = Date.now() + 5_000;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    session = sessions.get(sessionKey);
  }

  if (!session?.sock) {
    throw new Error(
      'WhatsApp Web não está conectado. Reconecte escaneando o QR Code em ' +
      'Configurações → Canais.',
    );
  }
  if (!session.isConnected) {
    throw new Error(
      'WhatsApp Web está reconectando. Aguarde alguns segundos e tente novamente — ' +
      'se persistir após 1 min, verifique a conexão em Configurações → Canais.',
    );
  }
  return session;
}

export async function sendBaileysBroadcastMessage(
  businessId: string,
  phoneNumber: string,
  text: string,
  connectionId?: string,
): Promise<{ externalMessageId: string }> {
  // Resolve a chave de sessão (connectionId). Caller pode passar explicitly
  // pra usar canal pessoal de um operador; default é a primary business.
  const sessionKey = await resolveConnectionIdForBaileys(businessId, connectionId);
  const session = await ensureBaileysSessionConnected(businessId, sessionKey, 'Baileys Broadcast');

  // phoneNumber já vem em E.164 (apenas dígitos) do RecipientListInput
  const digits = phoneNumber.replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    throw new Error(`Número inválido: ${phoneNumber}`);
  }

  // onWhatsApp resolve o JID canônico (lida com 9º dígito BR) e indica se número
  // tem WhatsApp. Diferenciamos 3 outcomes pra dar erro claro pro operador:
  //   - exists=true → temos JID canônico, segue envio
  //   - exists=false → número confirmadamente não tem WA → erro claro, aborta
  //   - falha de rede → log + tenta enviar direto. Se falhar, erro técnico
  //     terá menos contexto, mas operador entende ("não foi possível verificar").
  const candidateJid = `${digits}@s.whatsapp.net`;
  let targetJid = candidateJid;
  let knownNotOnWhatsApp = false;
  let onWhatsAppCheckFailed = false;
  try {
    const [result] = await session.sock.onWhatsApp(candidateJid);
    if (result?.exists && result.jid) {
      targetJid = result.jid;
    } else if (result && !result.exists) {
      knownNotOnWhatsApp = true;
    }
  } catch (err) {
    onWhatsAppCheckFailed = true;
    console.warn('[Baileys Broadcast] onWhatsApp check falhou (rede/timeout), tentando envio direto:', err);
  }

  if (knownNotOnWhatsApp) {
    throw new Error(`Número ${digits} não está cadastrado no WhatsApp.`);
  }

  let sent;
  try {
    sent = await session.sock.sendMessage(targetJid, { text });
  } catch (sendErr) {
    // Se o check inicial falhou por rede, anota isso na mensagem de erro pra
    // operador entender que pode ser problema de validação de número, não
    // necessariamente número inválido.
    if (onWhatsAppCheckFailed) {
      const reason = sendErr instanceof Error ? sendErr.message : String(sendErr);
      throw new Error(
        `Falha ao enviar pra ${digits}. Não foi possível validar antes (rede instável). ` +
        `Verifique o número e tente novamente. Detalhe técnico: ${reason}`,
      );
    }
    throw sendErr;
  }
  // Random suffix evita colisão se sent.key.id ausente em mensagens consecutivas
  const externalMessageId = sent?.key?.id
    || `baileys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { externalMessageId };
}

// ─── Firestore: save inbound message ─────────────────────────────────────────

interface InboundSaveResult { conversationId: string; messageId: string; phone: string }

/**
 * Vincula a conversa a um contato CRM existente quando o telefone bate com
 * `channelIdentities.whatsapp`. Best-effort — falhas não bloqueiam o flow
 * principal. Idempotente: chamar múltiplas vezes com a mesma combinação
 * resulta em escrita inofensiva.
 *
 * Extraído pra helper porque é necessário em 2 lugares no handleInboundMessage:
 * o branch `!matchedDoc` (conversa nova) e o branch `claimResult.kind==='conflict'`
 * (race detectado, conv nova criada com canal correto).
 */
async function autoLinkCrmContact(
  businessId: string,
  conversationId: string,
  senderPhone: string,
  fallbackContactName: string,
  now: string,
): Promise<void> {
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
        contactName: crmContact.data().name || fallbackContactName,
      });
      await adminDb.collection('clients').doc(crmContact.id).update({
        lastConversationId: conversationId,
        lastConversationAt: now,
        updatedAt: now,
      });
    }
  } catch { /* non-critical */ }
}

async function handleInboundMessage(
  businessId: string,
  connectionId: string,
  waMessage: WAMessage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sock: any,
): Promise<InboundSaveResult | false> {
  const rawJid = waMessage.key.remoteJid;
  if (!rawJid) return false;

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

    // Cadeia de resolução LID → telefone (Baileys 7+):
    // 1. lidToPhone map (contacts.upsert)
    // 2. participantAlt / remoteJidAlt / participant (campos do proto)
    // 3. sock.onWhatsApp() — consulta o WA para resolver o LID em tempo real
    const participantAlt = key.participantAlt as string | undefined;
    const remoteJidAlt = key.remoteJidAlt as string | undefined;
    const keyParticipant = waMessage.key.participant;
    const msgParticipant = key.participant as string | undefined;

    const mappedPhone = session?.lidToPhone.get(rawJid);
    const resolvedJid = [participantAlt, remoteJidAlt, keyParticipant, msgParticipant]
      .find(j => j && (j.includes('@s.whatsapp.net') || j.includes('@lid')));

    if (mappedPhone && /^\d{10,15}$/.test(mappedPhone)) {
      senderPhone = mappedPhone;
    } else if (resolvedJid?.includes('@s.whatsapp.net')) {
      senderPhone = resolvedJid.replace('@s.whatsapp.net', '');
      jidForProfile = resolvedJid;
      // Memoriza no mapa para próximas mensagens deste LID
      if (session) session.lidToPhone.set(rawJid, senderPhone);
    } else {
      // Fallback: resolve via sock.onWhatsApp (consulta WhatsApp)
      // Funciona mesmo sem contacts.upsert populado.
      let resolved = false;
      try {
        const results = await sock.onWhatsApp(rawJid);
        const match = results?.find((r: { exists?: boolean; jid?: string }) => r.exists && r.jid?.includes('@s.whatsapp.net'));
        if (match?.jid) {
          senderPhone = match.jid.replace('@s.whatsapp.net', '');
          jidForProfile = match.jid;
          if (session) session.lidToPhone.set(rawJid, senderPhone);
          resolved = true;
        }
      } catch { /* onWhatsApp pode falhar — segue para drop */ }

      if (!resolved) {
        console.warn('[Baileys] @lid sem resolução:', rawJid, { participantAlt, remoteJidAlt });
        return false;
      }
    }
  } else if (rawJid.endsWith('@g.us')) {
    // Group message — should already be filtered but just in case
    return false;
  } else {
    // Unknown suffix — extract digits
    senderPhone = rawJid.replace(/@.*$/, '');
  }

  // Validate: senderPhone must look like a phone number (10-15 digits)
  if (!/^\d{10,15}$/.test(senderPhone)) {
    console.warn('[Baileys] Invalid phone extracted from JID:', { rawJid, senderPhone });
    return false;
  }

  const messageId = waMessage.key.id || `wa_${Date.now()}`;
  const timestamp = waMessage.messageTimestamp
    ? new Date(Number(waMessage.messageTimestamp) * 1000).toISOString()
    : new Date().toISOString();

  const msgContent = waMessage.message;
  const text = extractMessageText(msgContent);
  const mediaType = extractMediaType(msgContent);
  if (!text && !mediaType) return false;

  const displayText = text || getMediaLabel(mediaType);
  const now = new Date().toISOString();

  // Deduplicate
  try {
    const dupSnap = await adminDb.collection('conversationMessages')
      .where('externalMessageId', '==', messageId)
      .where('businessId', '==', businessId)
      .limit(1)
      .get();
    if (!dupSnap.empty) return false;
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
    // Sempre busca AMBOS os formatos (exact + alt 9-prefix BR) e mergea —
    // sem isso, dups com formatos diferentes (com/sem 9) se perpetuavam:
    // exact achava uma duplicata antiga e nunca caía pro alt. Ao mergear
    // + ordenar por lastMessageAt, sempre roteamos pra conv com atividade
    // mais recente (consolida histórico mesmo com dups pré-existentes).
    let candidates = (await adminDb.collection('conversations')
      .where('businessId', '==', businessId)
      .where('channel', '==', 'whatsapp')
      .where('contactExternalId', '==', senderPhone)
      .orderBy('lastMessageAt', 'desc')
      .limit(5)
      .get()).docs;

    if (altPhone) {
      const altDocs = (await adminDb.collection('conversations')
        .where('businessId', '==', businessId)
        .where('channel', '==', 'whatsapp')
        .where('contactExternalId', '==', altPhone)
        .orderBy('lastMessageAt', 'desc')
        .limit(5)
        .get()).docs;
      if (altDocs.length > 0) {
        const seen = new Set(candidates.map(d => d.id));
        for (const d of altDocs) if (!seen.has(d.id)) candidates.push(d);
        // Re-ordena merged set — pickBestCandidate confia em primeira = mais recente
        candidates.sort((a, b) => {
          const ta = (a.data().lastMessageAt as string | undefined) ?? '';
          const tb = (b.data().lastMessageAt as string | undefined) ?? '';
          return tb.localeCompare(ta);
        });
      }
    }

    const matchedDoc = pickBestCandidate(candidates);
    let conversationId: string;

    if (!matchedDoc) {
      // Auto-assign para canais pessoais (ownerType='user'): a conversa que
      // chega num canal pessoal pertence ao owner do canal por default.
      // E denormaliza channelOwnerType/channelOwnerId no doc da conversa pra
      // que rules e queries consigam isolar canais pessoais sem precisar
      // fazer get() do channelConnections em cada read.
      let initialAssignedTo: string | undefined;
      let initialAssignedToName: string | undefined;
      let channelOwnerType: 'business' | 'user' = 'business';
      let channelOwnerId: string | undefined;
      try {
        const connSnap = await adminDb.collection('channelConnections').doc(connectionId).get();
        const connData = connSnap.data();
        if (connData?.ownerType === 'user' && connData.ownerId) {
          channelOwnerType = 'user';
          channelOwnerId = connData.ownerId as string;
          initialAssignedTo = connData.ownerId as string;
          // Tenta puxar nome do owner pra denormalizar
          try {
            const userSnap = await adminDb.collection('users').doc(initialAssignedTo).get();
            initialAssignedToName = (userSnap.data()?.name as string) || undefined;
          } catch { /* opcional */ }
        }
      } catch { /* connection lookup falhou — assume business */ }

      const newConvRef = await adminDb.collection('conversations').add({
        businessId,
        channel: 'whatsapp',
        connectedVia: 'baileys',
        // Vincula a conversa ao canal específico que recebeu a msg.
        // Essencial pra reply: send/route.ts resolve a sessão correta a
        // partir desse campo. Sem isso, send caía pra primary business
        // mesmo quando a msg veio em canal pessoal (ownerType='user').
        channelConnectionId: connectionId,
        channelOwnerType,
        ...(channelOwnerId ? { channelOwnerId } : {}),
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
      await autoLinkCrmContact(businessId, conversationId, senderPhone, contactName, now);
    } else {
      // Match em conversa legacy/sem channelConnectionId. Usa transaction pra
      // resolver race: se OUTRO canal Baileys (ex: canal pessoal de outro
      // operador) reivindicou a mesma legacy entre o pickBestCandidate e o
      // update, sua mensagem precisa ir pra uma conversa NOVA — senão o
      // backfill aleatoriamente vincularia a conversa ao canal "vencedor"
      // do race e mensagens posteriores sairiam pelo canal errado.
      const claimResult = await adminDb.runTransaction(async (tx) => {
        const fresh = await tx.get(matchedDoc.ref);
        if (!fresh.exists) {
          // Conversa foi deletada entre query e transaction — cair pro create.
          return { kind: 'conflict' as const };
        }
        const data = fresh.data()!;
        const existingConn = data.channelConnectionId as string | undefined;

        // Se já foi reivindicada por OUTRO canal, NÃO sobrescrever — caller
        // cria conversa nova com o canal correto.
        if (existingConn && existingConn !== connectionId) {
          return { kind: 'conflict' as const };
        }

        const convUpdate: Record<string, unknown> = {
          lastMessage: displayText,
          lastMessageAt: timestamp,
          lastMessageDirection: 'inbound',
          unreadCount: FieldValue.increment(1),
          updatedAt: now,
        };
        if (pushName && (!data.contactName || /^\+?\d[\d\s-]+$/.test(data.contactName))) {
          convUpdate.contactName = pushName;
        }
        if (avatarUrl && !data.contactAvatarUrl) {
          convUpdate.contactAvatarUrl = avatarUrl;
        }
        // Backfill / correção: Baileys é autoritativo (sabemos exatamente
        // qual sessão entregou a msg). Atualiza connectedVia também pra
        // que a UI mostre "WhatsApp Web" em conversas que migraram do
        // legado Cloud → Baileys.
        if (existingConn !== connectionId) {
          convUpdate.channelConnectionId = connectionId;
        }
        if (data.connectedVia !== 'baileys') {
          convUpdate.connectedVia = 'baileys';
        }

        tx.update(matchedDoc.ref, convUpdate);
        return {
          kind: 'updated' as const,
          appliedContactName: convUpdate.contactName as string | undefined,
        };
      });

      if (claimResult.kind === 'conflict') {
        // Outro canal venceu o race — cria conversa nova com o connectionId
        // atual pra preservar identidade de transporte. Fluxo idêntico ao
        // do branch "matchedDoc===null" acima, mas duplicado pra evitar
        // refactor maior agora.
        let initialAssignedTo: string | undefined;
        let initialAssignedToName: string | undefined;
        let channelOwnerType: 'business' | 'user' = 'business';
        let channelOwnerId: string | undefined;
        try {
          const connSnap = await adminDb.collection('channelConnections').doc(connectionId).get();
          const connData = connSnap.data();
          if (connData?.ownerType === 'user' && connData.ownerId) {
            channelOwnerType = 'user';
            channelOwnerId = connData.ownerId as string;
            initialAssignedTo = connData.ownerId as string;
            try {
              const userSnap = await adminDb.collection('users').doc(initialAssignedTo).get();
              initialAssignedToName = (userSnap.data()?.name as string) || undefined;
            } catch { /* opcional */ }
          }
        } catch { /* connection lookup falhou — assume business */ }

        const newConvRef = await adminDb.collection('conversations').add({
          businessId,
          channel: 'whatsapp',
          connectedVia: 'baileys',
          channelConnectionId: connectionId,
          channelOwnerType,
          ...(channelOwnerId ? { channelOwnerId } : {}),
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
        console.log(`[Baileys] Race em conversa legacy resolvido — criada nova conv ${conversationId.slice(-6)} pra canal ${connectionId.slice(-6)}`);
        // Auto-link CRM tambem na branch de conflict — sem isso, conversas
        // criadas via race perderiam a vinculação ao crmContact.
        await autoLinkCrmContact(businessId, conversationId, senderPhone, contactName, now);
      } else {
        conversationId = matchedDoc.id;
        if (claimResult.appliedContactName) contactName = claimResult.appliedContactName;
      }
    }

    // Download de mídia (image/audio/video/document/sticker): faz download via
    // Baileys (decodifica E2EE) + upload pro Firebase Storage, retorna URL signed.
    // Sem isso, mensagens de mídia ficavam com mediaUrl=null e a UI renderizava
    // bolha vazia. Não bloqueia o save: se o download/upload falhar, persiste a
    // mensagem com mediaUrl=null e o operador vê o preview "[Imagem]"/"[Áudio]"
    // — perda de informação visual mas não perde o registro.
    let mediaUrl: string | null = null;
    if (mediaType) {
      try {
        const mediaResult = await downloadAndUploadBaileysMedia({
          waMessage,
          businessId,
          conversationId,
          logger: SILENT_LOGGER,
          reuploadRequest: sock.updateMediaMessage,
        });
        if (mediaResult) mediaUrl = mediaResult.mediaUrl;
      } catch (mediaErr) {
        console.error('[Baileys] Falha no download/upload de mídia (mensagem salva sem URL):', mediaErr);
      }
    }

    const msgRef = await adminDb.collection('conversationMessages').add({
      conversationId,
      businessId,
      channel: 'whatsapp',
      // Mensagens recebidas pelo socket Baileys são sempre transporte 'baileys'.
      // Denormalizado por mensagem pra UI poder mostrar o transporte mesmo se
      // a conversa migrar de canal no futuro.
      connectedVia: 'baileys',
      direction: 'inbound',
      content: displayText,
      status: 'delivered',
      externalMessageId: messageId,
      senderName: contactName,
      mediaType: mediaType ?? null,
      mediaUrl,
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
    return { conversationId, messageId: msgRef.id, phone: senderPhone };
  } catch (err) {
    console.error('[Baileys] Erro ao salvar mensagem inbound:', err);
    throw err; // outer catch registra em _dbg.lastError
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

  // Already running? Return existing — fast path (sem lock necessário pra leitura)
  const existing = sessions.get(sessionKey);
  if (existing) return existing;

  // Lock por sessionKey: dois requests concorrentes pra mesma sessão compartilham
  // a MESMA promise (segundo aguarda o primeiro), evitando criação duplicada de
  // socket. O lock é removido quando a promise resolve/rejeita.
  const pending = sessionLocks.get(sessionKey);
  if (pending) {
    return pending;
  }

  const creationPromise = (async () => {
    // Re-check dentro do lock — outro request pode ter terminado entre o check
    // de cima e a aquisição do lock (cenário raro mas possível com microtasks).
    const recheck = sessions.get(sessionKey);
    if (recheck) return recheck;
    return doCreateBaileysSession(businessId, mode, sessionKey);
  })();

  sessionLocks.set(sessionKey, creationPromise);
  try {
    return await creationPromise;
  } finally {
    // Importante: limpar mesmo em caso de erro pra próxima tentativa não ficar
    // travada esperando uma promise rejeitada já consumida.
    sessionLocks.delete(sessionKey);
  }
}

/**
 * Implementação real de criar a sessão. Separada de createBaileysSession pra
 * que o lock fique limpo no wrapper. Não chamar diretamente — sempre via
 * createBaileysSession (que aplica o lock).
 */
async function doCreateBaileysSession(
  businessId: string,
  mode: 'fresh' | 'restore',
  sessionKey: string,
): Promise<BaileysSession> {
  // Auth state agora é persistido no Firestore (lib/services/baileys/firestore-auth-state.ts).
  // Não há mais migração de diretório legado — sessões antigas baseadas em disco
  // precisam ser re-pareadas via QR Code (a primeira instância que pareia escreve
  // no Firestore e a partir daí qualquer máquina que abrir a conexão hidrata dali).

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
    _dbg: {
      upsertFired: 0, upsertNotify: 0,
      filtered: { fromMe: 0, noMsg: 0, group: 0, lid: 0, statusBroadcast: 0, protocolMsg: 0, reactionMsg: 0, oldAppend: 0 },
      processed: 0, saved: 0, earlyReturn: 0,
      lastSavedConvId: null, lastSavedMsgId: null, lastSavedPhone: null,
      lastRawJid: null, lastMsgTypes: [], lastError: null, lastErrorAt: null,
      contactsUpserted: 0,
    },
  };

  sessions.set(sessionKey, session);
  rememberBusinessKey(businessId, sessionKey);

  let restartCount = 0;

  async function startSocket(clearFirst: boolean) {
    // clearFirst=true: usuário escaneou QR fresh → apaga state anterior do Firestore
    // pra que initAuthCreds() gere identidade nova. Apenas o fluxo 'fresh' deve
    // limpar; auto-restart por queda de rede NUNCA passa clearFirst=true.
    if (clearFirst) {
      await deleteFirestoreAuthState(sessionKey);
    }

    const { state, saveCreds } = await useFirestoreAuthState(sessionKey);

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
      session._dbg.contactsUpserted += contacts.length;
      for (const c of contacts) {
        const rawPhone = c.phoneNumber?.replace(/\D/g, '');
        if (!rawPhone) continue;
        if (c.lid) session.lidToPhone.set(c.lid, rawPhone);
        if (c.id) session.lidToPhone.set(c.id, rawPhone);
      }
    });

    // ── Message listener ──
    sock.ev.on('messages.upsert', async ({ messages: waMessages, type }: { messages: WAMessage[]; type: MessageUpsertType }) => {
      session._dbg.upsertFired++;
      if (type === 'notify') session._dbg.upsertNotify++;

      for (const waMsg of waMessages) {
        const jid = waMsg.key.remoteJid ?? '';
        session._dbg.lastRawJid = `${jid} [type=${type}]`;
        // Registra os tipos de mensagem para diagnóstico
        if (waMsg.message) {
          const msgTypes = Object.keys(waMsg.message).filter(k => k !== 'messageContextInfo');
          if (msgTypes.length > 0) {
            session._dbg.lastMsgTypes = [msgTypes.join('+'), ...session._dbg.lastMsgTypes].slice(0, 5);
          }
        }
        try {
          if (waMsg.key.fromMe) { session._dbg.filtered.fromMe++; continue; }
          if (jid === 'status@broadcast') { session._dbg.filtered.statusBroadcast++; continue; }
          if (jid.endsWith('@g.us')) { session._dbg.filtered.group++; continue; }
          if (!waMsg.message) { session._dbg.filtered.noMsg++; continue; }
          if (waMsg.message.protocolMessage) { session._dbg.filtered.protocolMsg++; continue; }
          if (waMsg.message.reactionMessage) { session._dbg.filtered.reactionMsg++; continue; }

          if (type !== 'notify') {
            const tsRaw = waMsg.messageTimestamp;
            const tsMs = (typeof tsRaw === 'number' ? tsRaw : Number(tsRaw)) * 1000;
            if (Date.now() - tsMs > 5 * 60 * 1000) { session._dbg.filtered.oldAppend++; continue; }
          }

          session._dbg.processed++;
          const result = await handleInboundMessage(businessId, sessionKey, waMsg, sock);
          if (result) {
            session._dbg.saved++;
            session._dbg.lastSavedConvId = result.conversationId;
            session._dbg.lastSavedMsgId = result.messageId;
            session._dbg.lastSavedPhone = result.phone;
          } else {
            session._dbg.earlyReturn = (session._dbg.earlyReturn || 0) + 1;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          session._dbg.lastError = msg;
          session._dbg.lastErrorAt = new Date().toISOString();
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
          const raw = me.id.split(':')[0].split('@')[0];
          // Aplica o mesmo fix de 9º dígito que formatPhone — WA armazena sem '9'
          if (raw.length === 12 && raw.startsWith('55') && raw[4] >= '6') {
            phoneNumber = raw.slice(0, 4) + '9' + raw.slice(4);
          } else {
            phoneNumber = raw || null;
          }
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
          void persistDisconnect(businessId, sessionKey, 'logged_out').catch((err) => {
            console.error('[Baileys] Failed to persist logout state:', err);
          });
          // Apaga creds revogadas do Firestore — re-pareamento via QR é obrigatório.
          void deleteFirestoreAuthState(sessionKey).catch((err) => {
            console.error('[Baileys] Failed to delete auth state on logout:', err);
          });
          void destroySession(businessId, sessionKey);
          return;
        }

        // Outro dispositivo conectou com as mesmas creds — limite multi-device do
        // WhatsApp. Auto-restart aqui causa ping-pong (a gente substitui de volta
        // → o outro lado também recebe connectionReplaced → ele restart → e
        // voltamos do zero indefinidamente). NÃO faz restart; deixa o usuário
        // decidir (clicando "Reconectar" na UI, que vai derrubar o outro device).
        if (statusCode === DisconnectReason.connectionReplaced) {
          console.warn(`[Baileys] Sessão substituída por outro dispositivo (${sessionKey.slice(-12)}). Não fazendo auto-restart pra evitar ping-pong.`);
          broadcast(session, {
            type: 'disconnected',
            reason: 'replaced',
            message: 'Outro dispositivo se conectou com as mesmas credenciais. Para usar aqui, clique em "Reconectar" — isso vai desconectar o outro dispositivo.',
          });
          void persistDisconnect(businessId, sessionKey, 'replaced').catch((err) => {
            console.error('[Baileys] Failed to persist replaced state:', err);
          });
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
            // NUNCA apaga credenciais durante auto-restart — só fresh QR (mode='fresh')
            // deve limpar. O código anterior apagava para connectionClosed/timedOut/
            // connectionReplaced, forçando re-scan a cada queda de rede (BUG CRÍTICO).

            // Guard: se a sessão foi destruída entre o agendamento e a execução
            // (ex: usuário desconectou manualmente, ou outro evento de close
            // disparou destroySession antes), não cria zombie socket.
            if (session.isDestroyed) return;

            startSocket(false).catch((err) => {
              console.error('[Baileys] Auto-restart falhou:', err);
              broadcast(session, { type: 'error', message: 'Falha ao reconectar. Tente novamente.' });
              void persistDisconnect(businessId, sessionKey, 'network').catch(() => {});
              void destroySession(businessId, sessionKey);
            });
          }, delay);
          return;
        }

        // Esgotou MAX_AUTO_RESTARTS — desiste e informa o operador.
        console.error(`[Baileys] Esgotou ${MAX_AUTO_RESTARTS} tentativas de restart (último code: ${statusCode})`);
        broadcast(session, { type: 'error', message: 'Não foi possível reconectar após várias tentativas. Verifique sua conexão e re-escaneie o QR Code.' });
        void persistDisconnect(businessId, sessionKey, 'network').catch(() => {});
        void destroySession(businessId, sessionKey);
      }
    });
  }

  // First start
  const isFresh = mode === 'fresh';
  try {
    await startSocket(isFresh);
  } catch (err) {
    // Se startSocket falhar (ex: erro carregando creds, makeWASocket throw,
    // listener registration error), o objeto `session` foi adicionado ao Map
    // mas nunca conectou. Sem este cleanup, próximas chamadas a
    // `createBaileysSession` veriam `sessions.get(sessionKey)` retornar essa
    // session zumbi (sock pode ou não estar setado, isConnected=false sempre)
    // e callers como `sendWhatsAppBaileys` falhariam com mensagens confusas.
    sessions.delete(sessionKey);
    forgetBusinessKey(businessId, sessionKey);
    throw err;
  }

  return session;
}
