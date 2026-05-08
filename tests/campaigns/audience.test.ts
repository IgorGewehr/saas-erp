import { describe, expect, it } from 'vitest';
import {
  audienceTagsToFilterGroups,
  getClientAge,
  matchesAudienceFilterGroups,
  resolveClientAudience,
} from '@/lib/campaigns/audience';
import type { Client, SegmentFilterGroup } from '@/lib/types';

function client(partial: Partial<Client> & Pick<Client, 'id' | 'name'>): Client {
  return {
    businessId: 'biz_1',
    source: 'manual',
    status: 'novo',
    score: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Client;
}

describe('campaign audience resolver', () => {
  it('filters existing clients by age and CRM tag for WhatsApp campaigns', () => {
    const filters: SegmentFilterGroup[] = [{
      id: 'mothers-day',
      filters: [
        { field: 'age', operator: 'gt', value: 30 },
        { field: 'tags', operator: 'contains', value: 'maes' },
      ],
    }];

    const result = resolveClientAudience([
      client({ id: 'c1', name: 'Ana', birthDate: '1990-05-10', phone: '(11) 98765-4321', tags: ['maes'] }),
      client({ id: 'c2', name: 'Bia', birthDate: '2001-01-01', phone: '(11) 91234-5678', tags: ['maes'] }),
      client({ id: 'c3', name: 'Carla', birthDate: '1988-01-01', phone: '(11) 90000-0000', tags: ['vip'] }),
    ], filters, {
      channel: 'whatsapp',
      now: new Date('2026-05-08T12:00:00.000Z'),
    });

    expect(result.matchedClients.map(c => c.id)).toEqual(['c1']);
    expect(result.recipients).toEqual([
      { contactId: 'c1', name: 'Ana', phoneNumber: '5511987654321' },
    ]);
  });

  it('resolves Facebook Page audiences from conversation history and recipient IDs', () => {
    const filters: SegmentFilterGroup[] = [{
      id: 'facebook-remarketing',
      filters: [{ field: 'conversationChannel', operator: 'contains', value: 'facebook' }],
    }];

    const result = resolveClientAudience([
      client({ id: 'c1', name: 'Daniel' }),
      client({ id: 'c2', name: 'Elisa' }),
    ], filters, {
      channel: 'facebook',
      conversationContactIdsByChannel: new Map([
        ['facebook', new Set(['c1'])],
      ]),
      conversationRecipientIdsByChannel: new Map([
        ['facebook', new Map([['c1', '1234567890']])],
      ]),
    });

    expect(result.matchedClients.map(c => c.id)).toEqual(['c1']);
    expect(result.recipients).toEqual([
      { contactId: 'c1', name: 'Daniel', recipientId: '1234567890' },
    ]);
  });

  it('can require marketing opt-in and deduplicates destinations', () => {
    const result = resolveClientAudience([
      client({ id: 'c1', name: 'Ana', phone: '(11) 98765-4321', optInMarketing: true }),
      client({ id: 'c2', name: 'Ana duplicada', whatsapp: '5511987654321', optInMarketing: true }),
      client({ id: 'c3', name: 'Sem opt-in', phone: '(11) 91234-5678', optInMarketing: false }),
    ], [], {
      channel: 'whatsapp',
      requireMarketingOptIn: true,
    });

    expect(result.recipients).toEqual([
      { contactId: 'c1', name: 'Ana', phoneNumber: '5511987654321' },
    ]);
    expect(result.skipped.duplicateDestination).toBe(1);
    expect(result.skipped.optInMissing).toBe(1);
  });

  it('evaluates derived age consistently from birthDate', () => {
    const pessoa = client({ id: 'c1', name: 'Ana', birthDate: '1996-05-09' });

    expect(getClientAge(pessoa, new Date('2026-05-08T12:00:00.000Z'))).toBe(29);
    expect(getClientAge(pessoa, new Date('2026-05-09T12:00:00.000Z'))).toBe(30);
  });

  it('supports boolean channel identity filters', () => {
    const pessoa = client({ id: 'c1', name: 'Ana' });

    expect(matchesAudienceFilterGroups(pessoa, [{
      id: 'has-facebook',
      filters: [{ field: 'hasFacebook', operator: 'eq', value: true }],
    }], {
      channel: 'facebook',
      conversationRecipientIdsByChannel: new Map([
        ['facebook', new Map([['c1', '1234567890']])],
      ]),
    })).toBe(true);
  });
});

describe('audienceTagsToFilterGroups + ctx.tags', () => {
  it('returns empty array for missing/empty/whitespace input', () => {
    expect(audienceTagsToFilterGroups(undefined)).toEqual([]);
    expect(audienceTagsToFilterGroups(null)).toEqual([]);
    expect(audienceTagsToFilterGroups([])).toEqual([]);
    expect(audienceTagsToFilterGroups(['', '  ', ''])).toEqual([]);
  });

  it('builds a single OR-style group with array value (trim + dedup)', () => {
    expect(audienceTagsToFilterGroups(['vip', '  vip  ', 'recente'])).toEqual([{
      id: 'audience-tags',
      filters: [{ field: 'tags', operator: 'contains', value: ['vip', 'recente'] }],
    }]);
  });

  it('matches clients with ANY of the given tags (OR semantics)', () => {
    const recipients = resolveClientAudience([
      client({ id: 'c1', name: 'Ana', phone: '11987654321', tags: ['vip'] }),
      client({ id: 'c2', name: 'Bia', phone: '11912345678', tags: ['recente'] }),
      client({ id: 'c3', name: 'Carla', phone: '11900000000', tags: ['outra'] }),
    ], audienceTagsToFilterGroups(['vip', 'recente']), {
      channel: 'whatsapp',
    });
    expect(recipients.matchedClients.map(c => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('honors ctx.tags as alternate path when filterGroups is empty', () => {
    const result = resolveClientAudience([
      client({ id: 'c1', name: 'Ana', phone: '11987654321', tags: ['vip'] }),
      client({ id: 'c2', name: 'Bia', phone: '11912345678', tags: [] }),
    ], undefined, {
      channel: 'whatsapp',
      tags: ['vip'],
    });
    expect(result.matchedClients.map(c => c.id)).toEqual(['c1']);
  });

  it('tag matching is case-insensitive (lowercased on both sides)', () => {
    const result = resolveClientAudience([
      client({ id: 'c1', name: 'Ana', phone: '11987654321', tags: ['VIP'] }),
    ], audienceTagsToFilterGroups(['vip']), { channel: 'whatsapp' });
    expect(result.matchedClients.map(c => c.id)).toEqual(['c1']);
  });
});
