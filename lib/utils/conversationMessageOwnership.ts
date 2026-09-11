/**
 * lib/utils/conversationMessageOwnership.ts
 *
 * `conversationMessages` (Firestore) precisa de get() no `conversations` pai
 * pra decidir quem pode ler cada mensagem (`parentConversationAccessible` em
 * firestore.rules) — Firestore avalia isso por documento numa query de
 * lista, então N mensagens = N gets no mesmo pai (achado M13). Fix: gravar
 * channelOwnerType/channelOwnerId (as mesmas denormalizações já usadas em
 * `Conversation`) DIRETO na mensagem na criação, pra a regra decidir sem
 * get(). Usado tanto no client SDK (ConversasModule.tsx) quanto nas ~9 rotas
 * admin-SDK que criam mensagem — por isso pure/sem dependência de
 * firebase-admin nem do client SDK.
 *
 * Mensagens sem esses campos (criadas antes desta mudança, ou por algum site
 * não migrado) caem no fallback via get() — ver firestore.rules,
 * comportamento idêntico ao de hoje, nunca menos permissivo.
 *
 * Importante: isto é uma cópia do valor da conversa NO MOMENTO da criação da
 * mensagem — se o canal for transferido depois, as mensagens JÁ CRIADAS
 * ficam desatualizadas até o fan-out em transfer-channel/route.ts
 * re-escrevê-las (ver `messageOwnershipFanOutUpdate`).
 */

export interface ConversationOwnershipSource {
  channelOwnerType?: 'business' | 'user';
  channelOwnerId?: string;
}

export interface MessageOwnershipFields {
  channelOwnerType?: 'business' | 'user';
  channelOwnerId?: string;
}

/** Campos a espalhar no payload de CRIAÇÃO de uma conversationMessages doc. */
export function messageOwnershipFields(conv: ConversationOwnershipSource): MessageOwnershipFields {
  const fields: MessageOwnershipFields = {};
  if (conv.channelOwnerType) fields.channelOwnerType = conv.channelOwnerType;
  if (conv.channelOwnerId) fields.channelOwnerId = conv.channelOwnerId;
  return fields;
}
