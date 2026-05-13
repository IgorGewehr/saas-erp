/**
 * lib/services/conversationToPipeline.ts
 *
 * "Enviar conversa para o pipeline" — promove o contato da conversa para um
 * estágio do CRM pipeline. Encapsula 2 fluxos:
 *
 *   (1) Conversa NÃO vinculada a Client → cria um Client novo (similar ao
 *       quickCreate do LinkContactPanel) com status = targetStage, source =
 *       canal da conversa, e linka via `crmContactId`. Single source of truth
 *       pra evitar drift entre os 2 quick-creates.
 *
 *   (2) Conversa JÁ vinculada → atualiza status do Client existente para
 *       targetStage. Não toca em outros campos.
 *
 * Idempotência: chamar 2x seguidas com o mesmo targetStage é no-op (no caso 2)
 * ou cria 2 clients (no caso 1 — race rara). Para evitar duplicação em race
 * real, o caller deveria desabilitar o botão durante a chamada.
 *
 * Multi-tenant: Client criado herda `businessId` recebido; updates filtram
 * por documento ID (que já é tenant-safe via rules).
 */

import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { Client, Conversation, LeadStatus } from '@/lib/types';

interface SendToPipelineParams {
  conversation: Conversation;
  /** Lista atual de clients do tenant — usada pra detectar match por telefone
   *  e evitar duplicação quando a conversa ainda não foi linkada manualmente. */
  clients: Client[];
  businessId: string;
  /** Estágio inicial do contato no pipeline. Caller geralmente passa 'novo'
   *  ou um stage escolhido em submenu. */
  targetStage: LeadStatus;
}

export interface SendToPipelineResult {
  clientId: string;
  /** 'created' = novo Client; 'updated' = Client existente teve status mudado;
   *  'linked' = Client existente foi encontrado por telefone e linkado;
   *  'no-op' = Client já estava no estágio destino (nada mudou de fato). */
  outcome: 'created' | 'updated' | 'linked' | 'no-op';
}

/** Extrai só dígitos — espelha o `digits()` de ConversasModule pra match. */
function digits(s: string | null | undefined): string {
  return (s || '').replace(/\D/g, '');
}

/** Procura cliente já cadastrado com mesmo telefone (últimos 8 dígitos +
 *  DDD batendo). Evita criar duplicata se o operador já cadastrou o cliente
 *  manualmente em outro fluxo. Replicado do LinkContactPanel.quickCreate.
 *
 *  Filtra por businessId como defesa em profundidade — o caller deveria
 *  passar lista já filtrada, mas custa zero garantir aqui. */
function findClientByPhone(
  clients: Client[],
  phoneDigits: string,
  businessId: string,
): Client | null {
  if (!phoneDigits) return null;
  const newLast8 = phoneDigits.slice(-8);
  const newDdd = phoneDigits.replace(/^55/, '').slice(0, 2);
  for (const c of clients) {
    if (c.businessId !== businessId) continue;
    if (c.mergedInto || (c as { deletedAt?: string }).deletedAt) continue;
    for (const cand of [c.phone, c.whatsapp].filter(Boolean) as string[]) {
      const candDigits = digits(cand);
      if (!candDigits) continue;
      const candLast8 = candDigits.slice(-8);
      const candDdd = candDigits.replace(/^55/, '').slice(0, 2);
      if (candLast8 === newLast8 && candDdd === newDdd) return c;
    }
  }
  return null;
}

export async function sendConversationToPipeline(
  params: SendToPipelineParams,
): Promise<SendToPipelineResult> {
  const { conversation, clients, businessId, targetStage } = params;
  const now = new Date().toISOString();

  // Caso 1: conversa já tem client linkado → updateDoc no status.
  if (conversation.crmContactId) {
    const linked = clients.find(c => c.id === conversation.crmContactId);
    // No-op apenas se já está no estágio destino E já é lead do pipeline.
    // Sem o check de inPipeline, clientes "só vinculados" (inPipeline:false)
    // com status default 'novo' não entrariam no funil ao mandar pra "Novo".
    if (linked && linked.status === targetStage && linked.inPipeline !== false) {
      return { clientId: conversation.crmContactId, outcome: 'no-op' };
    }
    await updateDoc(doc(db, 'clients', conversation.crmContactId), {
      status: targetStage,
      inPipeline: true,
      updatedAt: now,
    });
    return { clientId: conversation.crmContactId, outcome: 'updated' };
  }

  // Caso 2: sem link. Verifica se já existe Client com mesmo telefone.
  const phoneDigits = digits(conversation.contactPhone || conversation.contactExternalId);
  const existing = phoneDigits ? findClientByPhone(clients, phoneDigits, businessId) : null;
  if (existing) {
    // Atualiza status do existente E linka a conversa. Também escreve
    // channelIdentities + avatarUrl pra paridade com LinkContactPanel.link():
    // sem channelIdentities, futuras mensagens inbound não auto-linkariam
    // nesse Client (auto-link procura por channelIdentities[canal]).
    const patch: Record<string, unknown> = {
      status: targetStage,
      inPipeline: true,
      lastConversationId: conversation.id,
      lastConversationAt: now,
      updatedAt: now,
    };
    if (phoneDigits) {
      const key = conversation.channel === 'whatsapp' ? 'channelIdentities.whatsapp'
        : conversation.channel === 'facebook' ? 'channelIdentities.facebook'
        : 'channelIdentities.instagram';
      patch[key] = phoneDigits;
    }
    if (conversation.contactAvatarUrl && !existing.avatarUrl) {
      patch.avatarUrl = conversation.contactAvatarUrl;
    }
    await updateDoc(doc(db, 'clients', existing.id), patch);
    await updateDoc(doc(db, 'conversations', conversation.id), {
      crmContactId: existing.id,
      updatedAt: now,
    });
    return { clientId: existing.id, outcome: 'linked' };
  }

  // Caso 3: cria Client novo. Mesmo shape do LinkContactPanel.quickCreate,
  // mas entra direto no pipeline (inPipeline:true) com o estágio escolhido,
  // diferente do quickCreate que cria com inPipeline:false.
  const payload: Record<string, unknown> = {
    businessId,
    name: (conversation.customContactName ?? conversation.contactName) || 'Novo contato',
    tipo: 'pf',
    source: conversation.channel,
    status: targetStage,
    inPipeline: true,
    score: 0,
    isActive: true,
    totalSpent: 0,
    visitCount: 0,
    lastConversationId: conversation.id,
    lastConversationAt: now,
    createdAt: now,
    updatedAt: now,
  };
  if (phoneDigits) {
    if (conversation.channel === 'whatsapp') payload.whatsapp = phoneDigits;
    else payload.phone = phoneDigits;
    payload.channelIdentities = { [conversation.channel]: phoneDigits };
  }
  if (conversation.contactAvatarUrl) payload.avatarUrl = conversation.contactAvatarUrl;

  const ref = await addDoc(collection(db, 'clients'), payload);
  await updateDoc(doc(db, 'conversations', conversation.id), {
    crmContactId: ref.id,
    updatedAt: now,
  });
  return { clientId: ref.id, outcome: 'created' };
}
