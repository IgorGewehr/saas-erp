/**
 * lib/utils/conversationListPagination.ts
 *
 * Helpers puros pro fast-path paginado da lista de Conversas
 * (app/components/features/conversations/ConversasModule.tsx). Extraídos
 * pra cá porque são a parte testável sem mock de Firestore desta mudança —
 * o componente só orquestra onSnapshot/getDocs em torno destas funções.
 */

import type { Conversation } from '@/lib/types';

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1h sem resposta vira "esquecida" — mesmo corte da UI (matchesSmartView).

/**
 * True quando a conversa está em soneca ativa. Diferente de um campo
 * `null`-vs-ausente comum: cancelar soneca faz `deleteField()` (nunca grava
 * `null`), então docs sem soneca ativa têm `snoozedUntil` AUSENTE. Nenhuma
 * query Firestore consegue expressar "sem soneca ativa" via where() nesse
 * formato — por isso o fast-path sempre filtra soneca client-side, pós-fetch,
 * usando esta mesma função (ver `excludeSnoozed`).
 */
export function isSnoozed(conv: Pick<Conversation, 'snoozedUntil'>, now: number): boolean {
  if (!conv.snoozedUntil) return false;
  const until = new Date(conv.snoozedUntil).getTime();
  return Number.isFinite(until) && until > now;
}

/** Remove conversas em soneca ativa de uma página já buscada. */
export function excludeSnoozed<T extends Pick<Conversation, 'snoozedUntil'>>(convs: T[], now: number): T[] {
  return convs.filter(c => !isSnoozed(c, now));
}

/**
 * Decide se o fast-path precisa buscar mais uma página bruta antes de
 * devolver resultado ao chamador. Como soneca só é filtrável depois do
 * fetch (ver `isSnoozed`), uma página "cheia" (raw === pageSize) pode
 * esconder mais itens elegíveis além dos filtrados — só para quando a
 * página bruta vem curta (fim real da coleção) ou o alvo foi atingido.
 */
export function needsAnotherFetch(rawFetchedCount: number, afterSnoozeFilterCount: number, pageSize: number): boolean {
  return afterSnoozeFilterCount < pageSize && rawFetchedCount >= pageSize;
}

/**
 * Views da lista de Conversas com query server-side segura no fast-path —
 * mapeiam pra índices compostos existentes ou aos 2 novos adicionados junto
 * desta mudança (ver firestore.indexes.json). Fora deste set (unassigned/
 * unread/snoozed/in_pipeline) a view SEMPRE cai no fallback (array
 * completo), por lacuna de dado (campo ausente vs. null, mesmo problema do
 * `snoozedUntil` acima) ou natureza cross-collection (in_pipeline depende
 * de clientsList, que `conversations` não tem como fazer join).
 */
export const FAST_PATH_VIEWS = new Set<string>([
  'all', 'all_open', 'waiting_client', 'all_resolved', 'mine',
  'awaiting_reply', 'stale', 'resolved_today',
]);

export type FastPathView =
  | 'all' | 'all_open' | 'waiting_client' | 'all_resolved' | 'mine'
  | 'awaiting_reply' | 'stale' | 'resolved_today';

export function isFastPathView(view: string): view is FastPathView {
  return FAST_PATH_VIEWS.has(view);
}

export interface FastPathEqualityFilter {
  field: 'status' | 'assignedTo' | 'lastMessageDirection';
  value: string;
}

export interface FastPathQuerySpec {
  equalityFilters: FastPathEqualityFilter[];
  /** Campo usado tanto pro orderBy quanto (se houver) pro corte de
   *  inequality abaixo — Firestore exige que sejam o mesmo campo. */
  orderByField: 'lastMessageAt' | 'updatedAt';
  /** Corte de inequality sobre orderByField — só 'stale' (upper bound) e
   *  'resolved_today' (lower bound) usam. */
  cutoff?: { op: '<' | '>='; iso: string };
}

/**
 * Monta a especificação de query (filtros de igualdade + orderBy + corte
 * opcional) pra uma view do fast-path. `now` é injetado pelo chamador (não
 * `Date.now()` interno) pra manter a função determinística/testável.
 */
export function getFastPathQuerySpec(view: FastPathView, currentUid: string, now: number): FastPathQuerySpec {
  switch (view) {
    case 'all':
      return { equalityFilters: [], orderByField: 'lastMessageAt' };
    case 'all_open':
      return { equalityFilters: [{ field: 'status', value: 'open' }], orderByField: 'lastMessageAt' };
    case 'waiting_client':
      return { equalityFilters: [{ field: 'status', value: 'waiting' }], orderByField: 'lastMessageAt' };
    case 'all_resolved':
      return { equalityFilters: [{ field: 'status', value: 'resolved' }], orderByField: 'lastMessageAt' };
    case 'mine':
      return {
        equalityFilters: [{ field: 'status', value: 'open' }, { field: 'assignedTo', value: currentUid }],
        orderByField: 'lastMessageAt',
      };
    case 'awaiting_reply':
      return {
        equalityFilters: [{ field: 'status', value: 'open' }, { field: 'lastMessageDirection', value: 'inbound' }],
        orderByField: 'lastMessageAt',
      };
    case 'stale':
      return {
        equalityFilters: [{ field: 'status', value: 'open' }, { field: 'lastMessageDirection', value: 'inbound' }],
        orderByField: 'lastMessageAt',
        cutoff: { op: '<', iso: new Date(now - STALE_THRESHOLD_MS).toISOString() },
      };
    case 'resolved_today': {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      return {
        equalityFilters: [{ field: 'status', value: 'resolved' }],
        orderByField: 'updatedAt',
        cutoff: { op: '>=', iso: startOfDay.toISOString() },
      };
    }
  }
}

/**
 * Dedup por id entre várias listas, mantendo a versão da lista que vier
 * DEPOIS na ordem de `lists` (chamador deve passar página congelada primeiro
 * e janela viva por último, pra que updates ao vivo sempre vençam uma cópia
 * desatualizada da mesma conversa numa página antiga). Reordena desc pelo
 * `sortField` ao final.
 */
export function mergeConversationLists(
  lists: Conversation[][],
  sortField: 'lastMessageAt' | 'updatedAt' = 'lastMessageAt',
): Conversation[] {
  const merged = new Map<string, Conversation>();
  for (const list of lists) {
    for (const c of list) merged.set(c.id, c);
  }
  return Array.from(merged.values()).sort((a, b) => (b[sortField] || '').localeCompare(a[sortField] || ''));
}

export interface ConversationCursor {
  value: string;
  id: string;
}

/** Cursor de paginação (tupla valor+id, pro tiebreaker de empates exatos no
 *  campo de ordenação — lacuna que o precedente de paginação de mensagens
 *  não tem, não repetir aqui). */
export function buildCursor(conv: Conversation, sortField: 'lastMessageAt' | 'updatedAt'): ConversationCursor {
  return { value: conv[sortField] || '', id: conv.id };
}
