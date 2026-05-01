/**
 * Channel Connections — service helpers (server-side).
 *
 * Centraliza acesso à coleção `channelConnections`. Usado por:
 *   - /api/webhooks/meta — resolveChannelConnection(phoneNumberId|pageId|igAccountId)
 *   - /api/conversations/send — getConnectionForConversation(conversation)
 *   - /api/whatsapp/connect — createOrUpdateBaileysConnection
 *   - /api/channels/meta-signup — createOrUpdateCloudConnection
 *
 * Backwards compat (Fase 1): se a busca por channelConnections não retorna nada
 * (caso de tenant ainda sem migração), faz fallback pra businesses.channels.*
 * e cria a connection on-the-fly. Idempotente — chamadas concorrentes do
 * webhook + UI não criam duplicatas.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import type {
  ChannelConnection,
  ChannelConnectionType,
  ChannelOwnerType,
  ChannelCredentials,
  Conversation,
} from '@/lib/types';

const COLLECTION = 'channelConnections';

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * Resolve a conexão a partir do identificador externo (phoneNumberId pra Cloud,
 * pageId pra FB, accountId pra IG). Retorna null se não encontrar.
 *
 * Webhook usa pra mapear `phone_number_id` recebido → connection + businessId.
 */
export async function resolveChannelConnectionByExternalId(
  type: ChannelConnectionType,
  externalId: string,
): Promise<ChannelConnection | null> {
  const fieldByType: Record<ChannelConnectionType, string> = {
    whatsapp_cloud: 'phoneNumberId',
    whatsapp_baileys: 'phoneNumber',
    facebook: 'pageId',
    instagram: 'igAccountId',
  };
  const field = fieldByType[type];
  if (!field) return null;

  const snap = await adminDb.collection(COLLECTION)
    .where('type', '==', type)
    .where(field, '==', externalId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { ...(doc.data() as ChannelConnection), id: doc.id };
}

/**
 * Lista as conexões de um business (qualquer tipo, qualquer ownerType).
 * Usar quando precisar enumerar opções (UI, send fallback).
 */
export async function listConnectionsForBusiness(
  businessId: string,
): Promise<ChannelConnection[]> {
  const snap = await adminDb.collection(COLLECTION)
    .where('businessId', '==', businessId)
    .where('isActive', '==', true)
    .get();
  return snap.docs.map(d => ({ ...(d.data() as ChannelConnection), id: d.id }));
}

/**
 * Conexão usada pra envio de uma conversation. Prefere o `channelConnectionId`
 * já gravado; cai pro businesses.channels.* legado se ainda não migrado.
 */
export async function getConnectionForConversation(
  conversation: Pick<Conversation, 'businessId' | 'channel' | 'connectedVia' | 'channelConnectionId'>,
): Promise<ChannelConnection | null> {
  if (conversation.channelConnectionId) {
    const snap = await adminDb.collection(COLLECTION).doc(conversation.channelConnectionId).get();
    if (snap.exists) return { ...(snap.data() as ChannelConnection), id: snap.id };
  }
  // Fallback: encontra a primary do tipo correto pro business
  const type = inferTypeFromConversation(conversation);
  if (!type) return null;
  return findPrimaryConnection(conversation.businessId, type);
}

/**
 * Connection padrão pra um tipo dentro de um business. Usado em fallback e
 * pra resolver ambiguidade quando há múltiplas (Fase 2+).
 */
export async function findPrimaryConnection(
  businessId: string,
  type: ChannelConnectionType,
): Promise<ChannelConnection | null> {
  // Tenta isPrimary=true primeiro
  let snap = await adminDb.collection(COLLECTION)
    .where('businessId', '==', businessId)
    .where('type', '==', type)
    .where('isPrimary', '==', true)
    .where('isActive', '==', true)
    .limit(1)
    .get();
  if (!snap.empty) {
    const d = snap.docs[0];
    return { ...(d.data() as ChannelConnection), id: d.id };
  }
  // Sem primary marcada — pega qualquer ativa do tipo
  snap = await adminDb.collection(COLLECTION)
    .where('businessId', '==', businessId)
    .where('type', '==', type)
    .where('isActive', '==', true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { ...(d.data() as ChannelConnection), id: d.id };
}

// ─── Migration helpers ─────────────────────────────────────────────────────

/**
 * Lê `businesses/{id}.channels.*` e cria channelConnections espelhadas
 * (ownerType='business', isPrimary=true). Idempotente — se já existe
 * connection do mesmo type+businessId+isPrimary=true, retorna ela em vez
 * de criar.
 *
 * Usado em duas situações:
 *   1. Lazy migration: webhook/send chama quando não acha connection ainda.
 *   2. Backfill em batch: script que percorre todos os businesses.
 */
export async function ensureBusinessConnectionsFromLegacy(
  businessId: string,
): Promise<ChannelConnection[]> {
  const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
  if (!bizSnap.exists) return [];
  const channels = (bizSnap.data()?.channels || {}) as ChannelCredentials;
  const out: ChannelConnection[] = [];
  const now = new Date().toISOString();

  // Cloud: prefere whatsappCloud, fallback whatsapp legacy
  const cloud = channels.whatsappCloud || channels.whatsapp;
  if (cloud?.phoneNumberId) {
    const existing = await findPrimaryConnection(businessId, 'whatsapp_cloud');
    if (!existing) {
      out.push(await createConnection({
        businessId,
        type: 'whatsapp_cloud',
        ownerType: 'business',
        displayName: cloud.displayName || cloud.displayPhoneNumber || 'WhatsApp',
        phoneNumber: cloud.displayPhoneNumber || (cloud as { phoneNumber?: string }).phoneNumber,
        phoneNumberId: cloud.phoneNumberId,
        wabaId: (cloud as { wabaId?: string }).wabaId || (cloud as { businessAccountId?: string }).businessAccountId,
        accessToken: cloud.accessToken,
        tokenExpiresAt: cloud.tokenExpiresAt,
        isConnected: !!cloud.isConnected,
        isActive: true,
        isPrimary: true,
        connectedAt: cloud.connectedAt,
        createdAt: now,
        updatedAt: now,
      }));
    } else {
      out.push(existing);
    }
  }

  if (channels.whatsappBaileys?.phoneNumber) {
    const existing = await findPrimaryConnection(businessId, 'whatsapp_baileys');
    if (!existing) {
      const b = channels.whatsappBaileys;
      out.push(await createConnection({
        businessId,
        type: 'whatsapp_baileys',
        ownerType: 'business',
        displayName: b.displayPhoneNumber || b.phoneNumber || 'WhatsApp Web',
        phoneNumber: b.phoneNumber,
        isConnected: !!b.isConnected,
        isActive: true,
        isPrimary: true,
        connectedAt: b.connectedAt,
        createdAt: now,
        updatedAt: now,
      }));
    } else {
      out.push(existing);
    }
  }

  if (channels.facebook?.pageId) {
    const existing = await findPrimaryConnection(businessId, 'facebook');
    if (!existing) {
      const f = channels.facebook;
      out.push(await createConnection({
        businessId,
        type: 'facebook',
        ownerType: 'business',
        displayName: f.pageName || 'Facebook Messenger',
        pageId: f.pageId,
        pageAccessToken: f.pageAccessToken,
        pageName: f.pageName,
        isConnected: !!f.isConnected,
        isActive: true,
        isPrimary: true,
        connectedAt: f.connectedAt,
        createdAt: now,
        updatedAt: now,
      }));
    } else {
      out.push(existing);
    }
  }

  if (channels.instagram?.accountId) {
    const existing = await findPrimaryConnection(businessId, 'instagram');
    if (!existing) {
      const i = channels.instagram;
      out.push(await createConnection({
        businessId,
        type: 'instagram',
        ownerType: 'business',
        displayName: i.accountName || 'Instagram',
        igAccountId: i.accountId,
        igAccountName: i.accountName,
        isConnected: !!i.isConnected,
        isActive: true,
        isPrimary: true,
        connectedAt: i.connectedAt,
        createdAt: now,
        updatedAt: now,
      }));
    } else {
      out.push(existing);
    }
  }

  return out;
}

// ─── Writes ────────────────────────────────────────────────────────────────

/**
 * Cria uma connection. Strip campos undefined antes de gravar (Firestore
 * rejeita undefined values).
 */
export async function createConnection(
  data: Omit<ChannelConnection, 'id'>,
): Promise<ChannelConnection> {
  const clean = stripUndefined(data);
  const ref = await adminDb.collection(COLLECTION).add(clean);
  return { ...(clean as ChannelConnection), id: ref.id };
}

export async function updateConnection(
  id: string,
  patch: Partial<Omit<ChannelConnection, 'id' | 'businessId' | 'type'>>,
): Promise<void> {
  const clean = stripUndefined(patch as Record<string, unknown>);
  clean.updatedAt = new Date().toISOString();
  await adminDb.collection(COLLECTION).doc(id).update(clean);
}

// ─── Internals ─────────────────────────────────────────────────────────────

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function inferTypeFromConversation(
  conv: Pick<Conversation, 'channel' | 'connectedVia'>,
): ChannelConnectionType | null {
  if (conv.channel === 'whatsapp') {
    return conv.connectedVia === 'baileys' ? 'whatsapp_baileys' : 'whatsapp_cloud';
  }
  if (conv.channel === 'facebook') return 'facebook';
  if (conv.channel === 'instagram') return 'instagram';
  return null;
}

// ─── Owner permission helpers ──────────────────────────────────────────────

/**
 * Pode o usuário acessar (ler/enviar) por esta conexão?
 *  - admin/founder: sempre
 *  - operator+: sim para 'business'; para 'user' apenas se for o próprio owner
 */
export function canUserAccessConnection(
  connection: Pick<ChannelConnection, 'ownerType' | 'ownerId'>,
  user: { uid: string; role?: string },
): boolean {
  if (user.role === 'founder' || user.role === 'admin') return true;
  if (connection.ownerType === 'business') return true;
  if (connection.ownerType === 'user' && connection.ownerId === user.uid) return true;
  return false;
}

/**
 * Pode o usuário gerenciar (conectar/desconectar) esta conexão?
 *  - admin/founder: sim
 *  - operator+: apenas connections 'user' do próprio uid
 */
export function canUserManageConnection(
  connection: Pick<ChannelConnection, 'ownerType' | 'ownerId'>,
  user: { uid: string; role?: string },
): boolean {
  if (user.role === 'founder' || user.role === 'admin') return true;
  if (connection.ownerType === 'user' && connection.ownerId === user.uid) return true;
  return false;
}

export type { ChannelOwnerType };
