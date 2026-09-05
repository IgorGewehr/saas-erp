/**
 * lib/services/conversationVisibility.ts
 *
 * M07.3: computa `Conversation.visibleToUserIds` a partir de
 * sectorIds/isPrivate/assignedTo — a MESMA lógica de visibilidade que
 * `ConversasModule.tsx:getVisibleConversations` já aplicava só no cliente,
 * agora materializada no documento pra que firestore.rules e a query ao
 * vivo consigam aplicar a restrição no servidor.
 *
 * Por que denormalizar em vez de checar sectorIds direto na rule: uma
 * query `list` (onSnapshot) só é aceita pelo Firestore se a regra puder
 * ser provada usando SÓ os `where()` da própria query — cruzar
 * `conversation.sectorIds` com `get(users/uid).sectorIds` dentro da regra
 * não é provável desse jeito (get() teria que garantir, sem executar a
 * query, que TODO documento retornável bate — o Firestore não confia
 * nisso e rejeita a query inteira). Guardando o resultado já resolvido
 * como array de userIds, a regra vira uma checagem padrão e comprovada:
 * `request.auth.uid in resource.data.visibleToUserIds`.
 *
 * Chamado em TODO write-path que muda sectorIds/isPrivate/assignedTo, e
 * pelo backfill (scripts/backfill-conversation-visible-to.ts) pra
 * conversas existentes, e pela cascata de mudança de membro de setor
 * (Settings→Setores) pra conversas já restritas àquele setor.
 */

export interface SectorMembersLookup {
  memberIds: string[];
}

export interface ComputeVisibleToUserIdsInput {
  sectorIds?: string[];
  isPrivate?: boolean;
  assignedTo?: string;
  /** Map sectorId -> setor (só precisa de memberIds). Setor referenciado
   *  que não existe mais (apagado) é ignorado — mesma filosofia
   *  conservadora de `legacyConversationReadable` em firestore.rules:
   *  perde membro morto, não vaza acesso. */
  sectorsById: Map<string, SectorMembersLookup>;
}

/**
 * `null` = sem restrição (visível pra todo o negócio — mesmo efeito de
 * hoje quando sectorIds está vazio e isPrivate é falso).
 * `string[]` = só estes userIds (+ admins, que sempre bypassam via
 * `isAdmin()` na rule e `isAdmin` no client) podem ver.
 */
export function computeVisibleToUserIds(input: ComputeVisibleToUserIdsInput): string[] | null {
  const hasSectors = !!input.sectorIds?.length;
  const restricted = input.isPrivate || hasSectors;
  if (!restricted) return null;

  const ids = new Set<string>();
  if (input.assignedTo) ids.add(input.assignedTo);
  for (const sectorId of input.sectorIds ?? []) {
    const sector = input.sectorsById.get(sectorId);
    if (!sector) continue;
    for (const memberId of sector.memberIds) ids.add(memberId);
  }
  return Array.from(ids);
}
