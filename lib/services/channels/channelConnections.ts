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
 * Resultado de `ensureBusinessConnectionsFromLegacy` — distingue connections
 * recém-criadas das pré-existentes pra logging/contadores precisos.
 */
export interface EnsureResult {
  connection: ChannelConnection;
  wasCreated: boolean;
}

/**
 * Lê `businesses/{id}.channels.*` e cria channelConnections espelhadas
 * (ownerType='business', isPrimary=true). Idempotente E concorrência-safe —
 * usa doc ID determinístico `${businessId}_${type}_primary` com create-or-noop
 * via runTransaction, então duas chamadas concorrentes pra mesmo business
 * (ex: dois webhooks simultâneos) não criam duplicatas.
 *
 * Usado em duas situações:
 *   1. Lazy migration: webhook/send chama quando não acha connection ainda.
 *   2. Backfill em batch: script que percorre todos os businesses.
 */
export async function ensureBusinessConnectionsFromLegacy(
  businessId: string,
): Promise<EnsureResult[]> {
  const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
  if (!bizSnap.exists) return [];
  const channels = (bizSnap.data()?.channels || {}) as ChannelCredentials;
  const results: EnsureResult[] = [];

  // Cloud: prefere whatsappCloud, fallback whatsapp legacy
  const cloud = channels.whatsappCloud || channels.whatsapp;
  if (cloud?.phoneNumberId) {
    results.push(await ensurePrimaryBusinessConnection(businessId, 'whatsapp_cloud', () => ({
      displayName: cloud.displayName || cloud.displayPhoneNumber || 'WhatsApp',
      phoneNumber: cloud.displayPhoneNumber || (cloud as { phoneNumber?: string }).phoneNumber,
      phoneNumberId: cloud.phoneNumberId,
      wabaId: (cloud as { wabaId?: string }).wabaId || (cloud as { businessAccountId?: string }).businessAccountId,
      accessToken: cloud.accessToken,
      tokenExpiresAt: cloud.tokenExpiresAt,
      isConnected: !!cloud.isConnected,
      connectedAt: cloud.connectedAt,
    })));
  }

  if (channels.whatsappBaileys?.phoneNumber) {
    const b = channels.whatsappBaileys;
    results.push(await ensurePrimaryBusinessConnection(businessId, 'whatsapp_baileys', () => ({
      displayName: b.displayPhoneNumber || b.phoneNumber || 'WhatsApp Web',
      phoneNumber: b.phoneNumber,
      isConnected: !!b.isConnected,
      connectedAt: b.connectedAt,
    })));
  }

  if (channels.facebook?.pageId) {
    const f = channels.facebook;
    results.push(await ensurePrimaryBusinessConnection(businessId, 'facebook', () => ({
      displayName: f.pageName || 'Facebook Messenger',
      pageId: f.pageId,
      pageAccessToken: f.pageAccessToken,
      pageName: f.pageName,
      isConnected: !!f.isConnected,
      connectedAt: f.connectedAt,
    })));
  }

  if (channels.instagram?.accountId) {
    const i = channels.instagram;
    results.push(await ensurePrimaryBusinessConnection(businessId, 'instagram', () => ({
      displayName: i.accountName || 'Instagram',
      igAccountId: i.accountId,
      igAccountName: i.accountName,
      isConnected: !!i.isConnected,
      connectedAt: i.connectedAt,
    })));
  }

  return results;
}

/**
 * Helper interno: garante a connection 'business' primária pra um (businessId,
 * type), criando atomicamente via transação com doc ID determinístico.
 *
 * Doc ID = `${businessId}_${type}_primary`. Garante unicidade por
 * (businessId, type) no nível do Firestore — concurrent writes mergem em vez
 * de criar duplicatas.
 */
async function ensurePrimaryBusinessConnection(
  businessId: string,
  type: ChannelConnectionType,
  buildPayload: () => Partial<ChannelConnection>,
): Promise<EnsureResult> {
  const docId = primaryConnectionDocId(businessId, type);
  const ref = adminDb.collection(COLLECTION).doc(docId);
  const now = new Date().toISOString();

  return await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const partial = buildPayload();

    if (snap.exists) {
      // Doc já existe — atualiza credentials/state vindos do legado
      // (token rotation, isConnected mudou, etc) sem mexer em campos de
      // metadata como displayName customizado pelo operador.
      const existing = snap.data() as ChannelConnection;
      const merge: Record<string, unknown> = stripUndefined({
        // Credentials vindas do legado SEMPRE prevalecem (rotação de token)
        accessToken: partial.accessToken,
        tokenExpiresAt: partial.tokenExpiresAt,
        pageAccessToken: partial.pageAccessToken,
        // Identificadores externos (não devem mudar, mas se mudou aceita)
        phoneNumberId: partial.phoneNumberId,
        pageId: partial.pageId,
        igAccountId: partial.igAccountId,
        wabaId: partial.wabaId,
        // Estado
        isConnected: partial.isConnected ?? existing.isConnected,
        connectedAt: partial.connectedAt,
        // displayName: só sobrescreve se ainda é o default ('Canal' ou vazio)
        ...(existing.displayName && existing.displayName !== 'Canal'
          ? {}
          : { displayName: partial.displayName }),
        updatedAt: now,
      });
      tx.update(ref, merge);
      return {
        connection: { ...existing, ...merge, id: snap.id } as ChannelConnection,
        wasCreated: false,
      };
    }

    // Doc não existe — cria do zero
    const data: Omit<ChannelConnection, 'id'> = stripUndefined({
      businessId,
      type,
      ownerType: 'business',
      displayName: partial.displayName || 'Canal',
      ...partial,
      isActive: true,
      isPrimary: true,
      isConnected: partial.isConnected ?? false,
      createdAt: now,
      updatedAt: now,
    } as Omit<ChannelConnection, 'id'>);
    tx.set(ref, data);
    return {
      connection: { ...(data as ChannelConnection), id: docId },
      wasCreated: true,
    };
  });
}

/**
 * Doc ID determinístico pra connection 'business' primária. Garante que
 * concurrent writes pra mesma (business, type) atinjam o mesmo doc.
 */
export function primaryConnectionDocId(businessId: string, type: ChannelConnectionType): string {
  return `${businessId}__${type}__primary`;
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

// ─── Backwards-compat shim ─────────────────────────────────────────────────

/**
 * Constrói um objeto ChannelCredentials-shaped a partir de uma ChannelConnection,
 * pra reusar as funções legadas de send (sendWhatsApp, sendFacebookMessenger, etc)
 * sem ter que refatorá-las completamente. Cobre apenas o tipo da connection
 * (não acumula múltiplos tipos num único objeto).
 */
export function buildLegacyChannelsFromConnection(
  conn: ChannelConnection,
): ChannelCredentials {
  const out: ChannelCredentials = {};
  if (conn.type === 'whatsapp_cloud') {
    out.whatsappCloud = {
      isConnected: !!conn.isConnected,
      phoneNumberId: conn.phoneNumberId || '',
      accessToken: conn.accessToken || '',
      wabaId: conn.wabaId,
      displayName: conn.displayName,
      displayPhoneNumber: conn.phoneNumber,
      tokenExpiresAt: conn.tokenExpiresAt,
      connectedAt: conn.connectedAt,
      disconnectedAt: conn.disconnectedAt,
    };
    // Mantém também `whatsapp` legado preenchido pra que callers que ainda lêem
    // `channels.whatsapp` (fluxo legado) continuem funcionando.
    out.whatsapp = {
      isConnected: !!conn.isConnected,
      phoneNumberId: conn.phoneNumberId || '',
      businessAccountId: conn.wabaId || '',
      accessToken: conn.accessToken || '',
      wabaId: conn.wabaId,
      displayName: conn.displayName,
      displayPhoneNumber: conn.phoneNumber,
      phoneNumber: conn.phoneNumber,
      tokenExpiresAt: conn.tokenExpiresAt,
      connectedAt: conn.connectedAt,
      disconnectedAt: conn.disconnectedAt,
    };
  } else if (conn.type === 'whatsapp_baileys') {
    out.whatsappBaileys = {
      isConnected: !!conn.isConnected,
      phoneNumber: conn.phoneNumber || '',
      displayPhoneNumber: conn.phoneNumber,
      connectedAt: conn.connectedAt,
      disconnectedAt: conn.disconnectedAt,
    };
  } else if (conn.type === 'facebook') {
    out.facebook = {
      isConnected: !!conn.isConnected,
      pageId: conn.pageId || '',
      pageAccessToken: conn.pageAccessToken || '',
      pageName: conn.pageName,
      connectedAt: conn.connectedAt,
      disconnectedAt: conn.disconnectedAt,
    };
  } else if (conn.type === 'instagram') {
    out.instagram = {
      isConnected: !!conn.isConnected,
      accountId: conn.igAccountId || '',
      accountName: conn.igAccountName,
      connectedAt: conn.connectedAt,
      disconnectedAt: conn.disconnectedAt,
    };
  }
  return out;
}
