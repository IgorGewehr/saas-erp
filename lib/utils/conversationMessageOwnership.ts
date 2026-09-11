/**
 * lib/utils/conversationMessageOwnership.ts
 *
 * `conversationMessages` (Firestore) precisa hoje de get() no `conversations`
 * pai pra decidir quem pode ler cada mensagem (`parentConversationAccessible`
 * em firestore.rules) — Firestore avalia isso por documento numa query de
 * lista, então N mensagens = N gets no mesmo pai (achado M13). Fix: gravar
 * DIRETO na mensagem, na criação, as mesmas denormalizações já usadas em
 * `Conversation` pra decidir acesso:
 *   - channelOwnerType/channelOwnerId — dono do canal (business vs pessoal).
 *   - visibleToUserIds — restrição de setor/privacidade (M07.3).
 * Usado tanto no client SDK (ConversasModule.tsx) quanto nas rotas admin-SDK
 * que criam mensagem — por isso pure/sem dependência de firebase-admin nem
 * do client SDK.
 *
 * Mensagens sem esses campos (criadas antes desta mudança, ou por algum site
 * não migrado) caem no fallback via get() — ver firestore.rules,
 * comportamento idêntico ao de hoje, nunca menos permissivo.
 *
 * Importante: isto é uma cópia do valor da conversa NO MOMENTO da criação da
 * mensagem — se o dono do canal mudar (transferência) ou a visibilidade
 * mudar (setor/privacidade/atribuição) DEPOIS, as mensagens JÁ CRIADAS ficam
 * desatualizadas até o fan-out (ver lib/services/conversationMessageOwnershipFanOut.ts)
 * re-escrevê-las. Sem esse fan-out nos pontos de escrita corretos, esta
 * denormalização vira um vazamento (mensagem continua parecendo acessível
 * a quem não devia mais, ou inacessível a quem devia passar a poder ler).
 */

export interface ConversationAccessControlSource {
  channelOwnerType?: 'business' | 'user';
  channelOwnerId?: string;
  visibleToUserIds?: string[] | null;
}

export interface MessageAccessControlFields {
  channelOwnerType?: 'business' | 'user';
  channelOwnerId?: string;
  visibleToUserIds: string[] | null;
}

/** Campos a espalhar no payload de CRIAÇÃO de uma conversationMessages doc. */
export function messageOwnershipFields(conv: ConversationAccessControlSource): MessageAccessControlFields {
  const fields: MessageAccessControlFields = {
    // Sempre explícito (nunca ausente) — mensagem nova sem restrição herdada
    // grava null, não omite o campo (evita ambiguidade ausente-vs-null, a
    // mesma lacuna que forçou o fallback via get() pras mensagens legadas).
    visibleToUserIds: conv.visibleToUserIds ?? null,
  };
  if (conv.channelOwnerType) fields.channelOwnerType = conv.channelOwnerType;
  if (conv.channelOwnerId) fields.channelOwnerId = conv.channelOwnerId;
  return fields;
}
