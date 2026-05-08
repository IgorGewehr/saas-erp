import type {
  BroadcastChannel,
  BroadcastRecipient,
  Client,
  ConversationChannel,
  SegmentFilter,
  SegmentFilterGroup,
} from '@/lib/types';

export type CampaignRecipientChannel = BroadcastChannel;

export interface AudienceResolveContext {
  channel: CampaignRecipientChannel;
  conversationContactIdsByChannel?: Map<ConversationChannel, Set<string>>;
  conversationRecipientIdsByChannel?: Map<ConversationChannel, Map<string, string>>;
  requireMarketingOptIn?: boolean;
  includeInactive?: boolean;
  now?: Date;
  // Quando presente, vira um filterGroup adicional (AND-merged com os groups
  // recebidos) — match em qualquer tag (OR interno).
  tags?: string[];
}

/**
 * Converte uma lista de tags em um SegmentFilterGroup — OR entre tags.
 * Cliente bate se tiver ao menos uma das tags. Implementa OR via value=array,
 * que `evaluateAudienceFilter` resolve com `expectedValues.some(...)`
 * (linha 135-137 abaixo).
 *
 * Trim + dedup. Retorna [] se nenhuma tag válida — chamador trata ausência.
 */
export function audienceTagsToFilterGroups(tags: string[] | undefined | null): SegmentFilterGroup[] {
  if (!Array.isArray(tags)) return [];
  const cleaned = Array.from(new Set(
    tags.map(t => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
  ));
  if (cleaned.length === 0) return [];
  return [{
    id: 'audience-tags',
    filters: [{ field: 'tags', operator: 'contains', value: cleaned }],
  }];
}

export interface AudienceResolveResult {
  matchedClients: Client[];
  recipients: BroadcastRecipient[];
  totalClients: number;
  skipped: {
    inactive: number;
    missingDestination: number;
    optInMissing: number;
    duplicateDestination: number;
  };
}

function normalizePhoneForCampaign(raw?: string | null): string | null {
  let digits = (raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith('0')) digits = digits.slice(1);
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }
  if (digits.startsWith('55')) {
    if (digits.length !== 12 && digits.length !== 13) return null;
    const ddd = Number(digits.slice(2, 4));
    if (!Number.isFinite(ddd) || ddd < 11 || ddd > 99) return null;
    if (digits.length === 13 && digits[4] !== '9') return null;
    return digits;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}

function normalizeEmail(raw?: string | null): string | null {
  const email = (raw || '').trim().toLowerCase();
  if (!email) return null;
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email) ? email : null;
}

function getNestedVal(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc, key) => (
    acc != null && typeof acc === 'object'
      ? (acc as Record<string, unknown>)[key]
      : undefined
  ), obj);
}

export function getClientAge(client: Pick<Client, 'birthDate'>, now = new Date()): number | null {
  const raw = client.birthDate;
  if (!raw || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const [year, month, day] = raw.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  let age = currentYear - year;
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age--;
  return age >= 0 && age < 130 ? age : null;
}

export function getClientBirthMonth(client: Pick<Client, 'birthDate'>): number | null {
  const raw = client.birthDate;
  if (!raw || !/^\d{4}-\d{2}/.test(raw)) return null;
  const month = Number(raw.slice(5, 7));
  return month >= 1 && month <= 12 ? month : null;
}

function getConversationChannels(
  client: Client,
  map?: Map<ConversationChannel, Set<string>>,
): ConversationChannel[] {
  if (!map) return [];
  const out: ConversationChannel[] = [];
  for (const channel of ['whatsapp', 'facebook', 'instagram'] as ConversationChannel[]) {
    if (map.get(channel)?.has(client.id)) out.push(channel);
  }
  return out;
}

export function getAudienceFieldValue(client: Client, field: string, ctx?: AudienceResolveContext): unknown {
  if (field === 'age') return getClientAge(client, ctx?.now);
  if (field === 'birthMonth') return getClientBirthMonth(client);
  if (field === 'hasWhatsapp') return !!normalizePhoneForCampaign(client.whatsapp || client.channelIdentities?.whatsapp || client.phone);
  if (field === 'hasEmail') return !!normalizeEmail(client.email);
  if (field === 'hasFacebook') return !!client.channelIdentities?.facebook
    || !!ctx?.conversationRecipientIdsByChannel?.get('facebook')?.has(client.id);
  if (field === 'hasInstagram') return !!client.channelIdentities?.instagram
    || !!ctx?.conversationRecipientIdsByChannel?.get('instagram')?.has(client.id);
  if (field === 'conversationChannel') return getConversationChannels(client, ctx?.conversationContactIdsByChannel);
  return getNestedVal(client, field);
}

function coerceFilterValue(value: SegmentFilter['value'], actual: unknown): SegmentFilter['value'] {
  if (typeof actual === 'number' && typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (typeof actual === 'boolean' && typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

function normalizeComparable(value: unknown): unknown {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

export function evaluateAudienceFilter(client: Client, filter: SegmentFilter, ctx?: AudienceResolveContext): boolean {
  const actual = getAudienceFieldValue(client, filter.field, ctx);
  const expected = coerceFilterValue(filter.value, actual);

  if (Array.isArray(actual)) {
    const values = actual.map(v => normalizeComparable(v));
    if (Array.isArray(expected)) {
      const expectedValues = expected.map(v => normalizeComparable(v));
      if (filter.operator === 'in' || filter.operator === 'contains' || filter.operator === 'eq') {
        return expectedValues.some(v => values.includes(v));
      }
      if (filter.operator === 'not_in' || filter.operator === 'not_contains' || filter.operator === 'neq') {
        return expectedValues.every(v => !values.includes(v));
      }
    }
    const value = normalizeComparable(expected);
    if (filter.operator === 'contains' || filter.operator === 'eq') return values.includes(value);
    if (filter.operator === 'not_contains' || filter.operator === 'neq') return !values.includes(value);
    return false;
  }

  const actualComparable = normalizeComparable(actual);
  const expectedComparable = normalizeComparable(expected);

  switch (filter.operator) {
    case 'eq':
      return actualComparable === expectedComparable;
    case 'neq':
      return actualComparable !== expectedComparable;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'contains':
      return typeof actualComparable === 'string'
        && typeof expectedComparable === 'string'
        && actualComparable.includes(expectedComparable);
    case 'not_contains':
      return !(typeof actualComparable === 'string'
        && typeof expectedComparable === 'string'
        && actualComparable.includes(expectedComparable));
    case 'in':
      return Array.isArray(expected)
        ? expected.map(v => normalizeComparable(v)).includes(actualComparable)
        : false;
    case 'not_in':
      return Array.isArray(expected)
        ? !expected.map(v => normalizeComparable(v)).includes(actualComparable)
        : false;
    default:
      return false;
  }
}

export function matchesAudienceFilterGroups(
  client: Client,
  filterGroups: SegmentFilterGroup[] | undefined,
  ctx?: AudienceResolveContext,
): boolean {
  const groups = (filterGroups || []).filter(group => Array.isArray(group.filters) && group.filters.length > 0);
  if (!groups.length) return true;
  return groups.some(group => group.filters.every(filter => evaluateAudienceFilter(client, filter, ctx)));
}

export function clientToBroadcastRecipient(
  client: Client,
  channel: CampaignRecipientChannel,
  ctx?: AudienceResolveContext,
): BroadcastRecipient | null {
  if (channel === 'email') {
    const email = normalizeEmail(client.email);
    if (!email) return null;
    return { contactId: client.id, name: client.name, email };
  }

  if (channel === 'facebook' || channel === 'instagram') {
    const recipientId = client.channelIdentities?.[channel]
      || ctx?.conversationRecipientIdsByChannel?.get(channel)?.get(client.id);
    if (!recipientId) return null;
    return { contactId: client.id, name: client.name, recipientId };
  }

  const phoneNumber = normalizePhoneForCampaign(client.whatsapp || client.channelIdentities?.whatsapp || client.phone);
  if (!phoneNumber) return null;
  return { contactId: client.id, name: client.name, phoneNumber };
}

export function resolveClientAudience(
  clients: Client[],
  filterGroups: SegmentFilterGroup[] | undefined,
  ctx: AudienceResolveContext,
): AudienceResolveResult {
  const matchedClients: Client[] = [];
  const recipients: BroadcastRecipient[] = [];
  const seenDestinations = new Set<string>();
  const skipped = {
    inactive: 0,
    missingDestination: 0,
    optInMissing: 0,
    duplicateDestination: 0,
  };

  // Mescla ctx.tags como filterGroup extra. Como groups combinam com OR,
  // tags isoladas viram audiência válida mesmo sem outros filterGroups —
  // fecha o caminho da API pública (`audienceTags` em /api/v1/broadcasts)
  // sem quebrar o caso onde o frontend já passou filterGroups explícitos.
  const tagGroups = audienceTagsToFilterGroups(ctx.tags);
  const effectiveGroups = tagGroups.length > 0
    ? [...(filterGroups ?? []), ...tagGroups]
    : filterGroups;

  for (const client of clients) {
    if (!ctx.includeInactive && (client.mergedInto || (client as { deletedAt?: string }).deletedAt || client.isActive === false)) {
      skipped.inactive++;
      continue;
    }
    if (ctx.requireMarketingOptIn && client.optInMarketing !== true) {
      skipped.optInMissing++;
      continue;
    }
    if (!matchesAudienceFilterGroups(client, effectiveGroups, ctx)) continue;

    matchedClients.push(client);
    const recipient = clientToBroadcastRecipient(client, ctx.channel, ctx);
    if (!recipient) {
      skipped.missingDestination++;
      continue;
    }

    const destination = ctx.channel === 'email'
      ? recipient.email?.toLowerCase()
      : ctx.channel === 'whatsapp'
        ? recipient.phoneNumber?.replace(/\D/g, '')
        : recipient.recipientId?.trim()
          || client.channelIdentities?.[ctx.channel]?.trim();
    if (!destination) {
      skipped.missingDestination++;
      continue;
    }
    if (seenDestinations.has(destination)) {
      skipped.duplicateDestination++;
      continue;
    }
    seenDestinations.add(destination);
    recipients.push(recipient);
  }

  return {
    matchedClients,
    recipients,
    totalClients: clients.length,
    skipped,
  };
}
