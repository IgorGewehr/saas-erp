import { describe, it, expect } from 'vitest';
import {
  isSnoozed,
  excludeSnoozed,
  needsAnotherFetch,
  isFastPathView,
  getFastPathQuerySpec,
  mergeConversationLists,
  buildCursor,
} from '@/lib/utils/conversationListPagination';
import type { Conversation } from '@/lib/types';

const NOW = new Date('2026-06-15T12:00:00.000Z').getTime();

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: overrides.id ?? 'c1',
    businessId: 'b1',
    channel: 'whatsapp',
    status: 'open',
    contactName: 'Cliente',
    lastMessage: 'oi',
    lastMessageAt: '2026-06-15T10:00:00.000Z',
    lastMessageDirection: 'inbound',
    unreadCount: 0,
    createdAt: '2026-06-15T09:00:00.000Z',
    updatedAt: '2026-06-15T10:00:00.000Z',
    ...overrides,
  } as Conversation;
}

describe('isSnoozed', () => {
  it('false quando snoozedUntil ausente', () => {
    expect(isSnoozed({}, NOW)).toBe(false);
  });

  it('true quando snoozedUntil no futuro', () => {
    expect(isSnoozed({ snoozedUntil: '2026-06-15T13:00:00.000Z' }, NOW)).toBe(true);
  });

  it('false quando snoozedUntil no passado (soneca expirada)', () => {
    expect(isSnoozed({ snoozedUntil: '2026-06-15T11:00:00.000Z' }, NOW)).toBe(false);
  });

  it('false quando snoozedUntil é data inválida (defensivo)', () => {
    expect(isSnoozed({ snoozedUntil: 'not-a-date' }, NOW)).toBe(false);
  });
});

describe('excludeSnoozed', () => {
  it('remove só os itens com soneca ativa, preserva o resto', () => {
    const convs = [
      makeConv({ id: 'a' }),
      makeConv({ id: 'b', snoozedUntil: '2026-06-15T13:00:00.000Z' }),
      makeConv({ id: 'c' }),
    ];
    expect(excludeSnoozed(convs, NOW).map(c => c.id)).toEqual(['a', 'c']);
  });

  it('array vazio devolve array vazio', () => {
    expect(excludeSnoozed([], NOW)).toEqual([]);
  });
});

describe('needsAnotherFetch', () => {
  it('true quando página veio cheia mas sobrou menos que o alvo após filtrar soneca', () => {
    expect(needsAnotherFetch(30, 25, 30)).toBe(true);
  });

  it('false quando o alvo já foi atingido mesmo com página cheia', () => {
    expect(needsAnotherFetch(30, 30, 30)).toBe(false);
  });

  it('false quando a página bruta veio curta (fim real da coleção)', () => {
    expect(needsAnotherFetch(12, 8, 30)).toBe(false);
  });

  it('false quando não sobrou nada mas a página bruta também veio vazia', () => {
    expect(needsAnotherFetch(0, 0, 30)).toBe(false);
  });
});

describe('isFastPathView', () => {
  it('aceita as 8 views migráveis', () => {
    for (const v of ['all', 'all_open', 'waiting_client', 'all_resolved', 'mine', 'awaiting_reply', 'stale', 'resolved_today']) {
      expect(isFastPathView(v)).toBe(true);
    }
  });

  it('rejeita views que ficam em fallback', () => {
    for (const v of ['unassigned', 'unread', 'snoozed', 'in_pipeline']) {
      expect(isFastPathView(v)).toBe(false);
    }
  });
});

describe('getFastPathQuerySpec', () => {
  it('all: sem filtro de igualdade, ordena por lastMessageAt', () => {
    const spec = getFastPathQuerySpec('all', 'uid1', NOW);
    expect(spec.equalityFilters).toEqual([]);
    expect(spec.orderByField).toBe('lastMessageAt');
    expect(spec.cutoff).toBeUndefined();
  });

  it('all_open: status==open', () => {
    const spec = getFastPathQuerySpec('all_open', 'uid1', NOW);
    expect(spec.equalityFilters).toEqual([{ field: 'status', value: 'open' }]);
  });

  it('mine: status==open + assignedTo==uid', () => {
    const spec = getFastPathQuerySpec('mine', 'uid1', NOW);
    expect(spec.equalityFilters).toEqual([
      { field: 'status', value: 'open' },
      { field: 'assignedTo', value: 'uid1' },
    ]);
  });

  it('awaiting_reply: status==open + lastMessageDirection==inbound, sem corte', () => {
    const spec = getFastPathQuerySpec('awaiting_reply', 'uid1', NOW);
    expect(spec.equalityFilters).toEqual([
      { field: 'status', value: 'open' },
      { field: 'lastMessageDirection', value: 'inbound' },
    ]);
    expect(spec.cutoff).toBeUndefined();
  });

  it('stale: mesmo filtro de awaiting_reply + corte "<" 1h atrás', () => {
    const spec = getFastPathQuerySpec('stale', 'uid1', NOW);
    expect(spec.equalityFilters).toEqual([
      { field: 'status', value: 'open' },
      { field: 'lastMessageDirection', value: 'inbound' },
    ]);
    expect(spec.orderByField).toBe('lastMessageAt');
    expect(spec.cutoff).toEqual({ op: '<', iso: new Date(NOW - 60 * 60 * 1000).toISOString() });
  });

  it('resolved_today: status==resolved, ordena/corta por updatedAt >= início do dia (fuso local)', () => {
    const spec = getFastPathQuerySpec('resolved_today', 'uid1', NOW);
    expect(spec.equalityFilters).toEqual([{ field: 'status', value: 'resolved' }]);
    expect(spec.orderByField).toBe('updatedAt');
    expect(spec.cutoff?.op).toBe('>=');
    const expectedStartOfDay = new Date(NOW);
    expectedStartOfDay.setHours(0, 0, 0, 0);
    expect(spec.cutoff?.iso).toBe(expectedStartOfDay.toISOString());
  });
});

describe('mergeConversationLists', () => {
  it('dedupe por id, mantendo a versão da lista posterior', () => {
    const frozen = [makeConv({ id: 'a', status: 'open' })];
    const live = [makeConv({ id: 'a', status: 'resolved' })];
    const merged = mergeConversationLists([frozen, live]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('resolved');
  });

  it('ordena desc por lastMessageAt por padrão', () => {
    const a = makeConv({ id: 'a', lastMessageAt: '2026-06-15T08:00:00.000Z' });
    const b = makeConv({ id: 'b', lastMessageAt: '2026-06-15T11:00:00.000Z' });
    const c = makeConv({ id: 'c', lastMessageAt: '2026-06-15T09:00:00.000Z' });
    expect(mergeConversationLists([[a, b, c]]).map(x => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('ordena desc por updatedAt quando sortField é passado', () => {
    const a = makeConv({ id: 'a', updatedAt: '2026-06-15T08:00:00.000Z' });
    const b = makeConv({ id: 'b', updatedAt: '2026-06-15T11:00:00.000Z' });
    expect(mergeConversationLists([[a, b]], 'updatedAt').map(x => x.id)).toEqual(['b', 'a']);
  });

  it('lista vazia devolve array vazio', () => {
    expect(mergeConversationLists([])).toEqual([]);
    expect(mergeConversationLists([[], []])).toEqual([]);
  });

  it('não duplica itens presentes em múltiplas listas com o mesmo conteúdo', () => {
    const a = makeConv({ id: 'a' });
    expect(mergeConversationLists([[a], [a]])).toHaveLength(1);
  });
});

describe('buildCursor', () => {
  it('extrai valor do campo de ordenação + id', () => {
    const conv = makeConv({ id: 'xyz', lastMessageAt: '2026-06-15T10:30:00.000Z' });
    expect(buildCursor(conv, 'lastMessageAt')).toEqual({ value: '2026-06-15T10:30:00.000Z', id: 'xyz' });
  });

  it('funciona com updatedAt', () => {
    const conv = makeConv({ id: 'xyz', updatedAt: '2026-06-15T10:45:00.000Z' });
    expect(buildCursor(conv, 'updatedAt')).toEqual({ value: '2026-06-15T10:45:00.000Z', id: 'xyz' });
  });
});
