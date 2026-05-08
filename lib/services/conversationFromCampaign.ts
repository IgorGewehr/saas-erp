/**
 * conversationFromCampaign — espelha a lógica do webhook (meta/route.ts)
 * pra que mensagens enviadas via campanha (broadcast pontual ou recorrente
 * de aniversário) apareçam na aba "Conversas" do operador.
 *
 * Sem isso, a Meta/Baileys entrega ao destinatário mas o operador só vê a
 * conversa quando o cliente responde — e mesmo assim sem a mensagem
 * original que iniciou a thread.
 *
 * Match logic: exact contactExternalId → variante BR com/sem 9 → fallback
 * last-8 + DDD. Cria conversa se não achou; atualiza preview se achou.
 *
 * Append da mensagem outbound em `conversationMessages` com flags de
 * rastreio (`isFromCampaign` + ids da fonte).
 *
 * Best-effort: falha aqui não aborta o envio. A msg já foi entregue.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { getAlternativeBrazilianPhone } from '@/lib/utils/phoneAlternatives';
import { cleanContactName } from '@/lib/utils/contactName';

export type CampaignSource =
  | { kind: 'broadcast'; broadcastId: string; broadcastMessageId: string }
  | { kind: 'birthday'; birthdayCampaignId: string; birthdayCampaignLogId: string };

interface UpsertParams {
  adminDb: Firestore;
  businessId: string;
  channel: 'whatsapp' | 'facebook' | 'instagram';
  /** Phone digits (sem +) ou IGSID/PSID. */
  recipientId: string;
  contactName?: string;
  /** crmContactId, se vinculado. Birthday usa clientId (Clients ≠ CRM contacts).
   *  Ainda assim populamos pra rastreio quando disponível. */
  contactId?: string;
  /** Texto que vai aparecer na conversa (já renderizado se template). */
  content: string;
  /** wamid / mid retornado pela Meta, ou id local do Baileys. */
  externalMessageId?: string;
  source: CampaignSource;
  connectedVia?: 'embedded_signup' | 'baileys';
  channelConnectionId?: string;
  channelOwnerType?: 'business' | 'user';
  channelOwnerId?: string;
}

/** Formata número BR pra display em contactPhone (espelha o webhook). */
function formatBrPhoneForDisplay(externalId: string): string | undefined {
  const digits = externalId.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return undefined;
}

export async function upsertConversationFromCampaign(params: UpsertParams): Promise<void> {
  const { adminDb } = params;
  try {
    const now = new Date().toISOString();

    // 1. Find — exact match
    const safeQuery = async (externalId: string): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> => {
      try {
        return (await adminDb.collection('conversations')
          .where('businessId', '==', params.businessId)
          .where('channel', '==', params.channel)
          .where('contactExternalId', '==', externalId)
          .orderBy('lastMessageAt', 'desc')
          .limit(5)
          .get()).docs;
      } catch {
        return (await adminDb.collection('conversations')
          .where('businessId', '==', params.businessId)
          .where('channel', '==', params.channel)
          .where('contactExternalId', '==', externalId)
          .limit(5)
          .get()).docs;
      }
    };

    let candidates = await safeQuery(params.recipientId);

    // 2. Fuzzy: variação BR com/sem 9 — sempre roda pra consolidar duplicatas.
    if (params.channel === 'whatsapp') {
      const alt = getAlternativeBrazilianPhone(params.recipientId);
      if (alt) {
        const altDocs = await safeQuery(alt);
        if (altDocs.length > 0) {
          const seen = new Set(candidates.map(d => d.id));
          for (const d of altDocs) if (!seen.has(d.id)) candidates.push(d);
        }
      }
    }

    // 3. Fuzzy: últimos 8 dígitos + DDD (cobre formatações esquisitas).
    if (candidates.length === 0 && params.channel === 'whatsapp') {
      const digits = params.recipientId.replace(/\D/g, '');
      if (digits.length >= 10) {
        const last8 = digits.slice(-8);
        const ddd = digits.length >= 11 ? digits.slice(-11, -9) : digits.slice(-10, -8);
        const all = (await adminDb.collection('conversations')
          .where('businessId', '==', params.businessId)
          .where('channel', '==', params.channel)
          .limit(100)
          .get()).docs;
        candidates = all.filter(d => {
          const ext = (d.data().contactExternalId as string | undefined)?.replace(/\D/g, '') || '';
          if (ext.length < 10) return false;
          const docLast8 = ext.slice(-8);
          const docDdd = ext.length >= 11 ? ext.slice(-11, -9) : ext.slice(-10, -8);
          return docLast8 === last8 && docDdd === ddd;
        });
      }
    }

    // Pick mais recente (ou cria nova).
    const matched = candidates.sort((a, b) => {
      const ta = (a.data().lastMessageAt as string | undefined) ?? '';
      const tb = (b.data().lastMessageAt as string | undefined) ?? '';
      return tb.localeCompare(ta);
    })[0];

    let conversationId: string;
    if (matched) {
      conversationId = matched.id;
      await matched.ref.update({
        lastMessage: params.content.slice(0, 200),
        lastMessageAt: now,
        lastMessageDirection: 'outbound',
        updatedAt: now,
      });
    } else {
      const isWhatsApp = params.channel === 'whatsapp';
      const phoneFormatted = isWhatsApp ? formatBrPhoneForDisplay(params.recipientId) : undefined;
      const newConvData: Record<string, unknown> = {
        businessId: params.businessId,
        channel: params.channel,
        ...(params.connectedVia ? { connectedVia: params.connectedVia } : {}),
        ...(params.channelConnectionId ? { channelConnectionId: params.channelConnectionId } : {}),
        channelOwnerType: params.channelOwnerType ?? 'business',
        ...(params.channelOwnerId ? { channelOwnerId: params.channelOwnerId } : {}),
        contactName: cleanContactName(params.contactName) || params.recipientId,
        contactExternalId: params.recipientId,
        ...(phoneFormatted ? { contactPhone: phoneFormatted } : {}),
        ...(params.contactId ? { crmContactId: params.contactId } : {}),
        status: 'open',
        lastMessage: params.content.slice(0, 200),
        lastMessageAt: now,
        lastMessageDirection: 'outbound',
        unreadCount: 0,
        firstResponseAt: now,
        createdAt: now,
        updatedAt: now,
      };
      const convRef = await adminDb.collection('conversations').add(newConvData);
      conversationId = convRef.id;
    }

    // Append da mensagem outbound. Flags de rastreio variam por fonte.
    const sourceFields: Record<string, unknown> = params.source.kind === 'broadcast'
      ? {
          broadcastId: params.source.broadcastId,
          broadcastMessageId: params.source.broadcastMessageId,
        }
      : {
          birthdayCampaignId: params.source.birthdayCampaignId,
          birthdayCampaignLogId: params.source.birthdayCampaignLogId,
        };

    const msgData: Record<string, unknown> = {
      conversationId,
      businessId: params.businessId,
      channel: params.channel,
      direction: 'outbound',
      content: params.content,
      status: 'sent',
      senderName: 'Campanha',
      isFromCampaign: true,
      ...sourceFields,
      sentAt: now,
      createdAt: now,
    };
    if (params.externalMessageId) msgData.externalMessageId = params.externalMessageId;
    if (params.connectedVia) msgData.connectedVia = params.connectedVia;
    await adminDb.collection('conversationMessages').add(msgData);
  } catch (err) {
    // Não-crítico: a mensagem já foi entregue. Loga pra debug.
    console.warn('[conversationFromCampaign] upsert failed:', err);
  }
}
