import { describe, expect, it } from 'vitest';
import { computeProfileSyncKey } from '@/lib/services/settings/profileSync';
import type { User } from '@/lib/types';

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    uid: 'u1',
    email: 'dentista@example.com',
    name: 'Dra. Ana',
    role: 'operator',
    businessId: 'biz1',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeProfileSyncKey', () => {
  it('produz a mesma chave para um objeto estruturalmente igual com referência nova', () => {
    // Simula o onSnapshot recriando `user` (nova referência) sem mudança real
    // de conteúdo — ex: heartbeat de presença tocando isOnline/lastSeenAt.
    const a = fakeUser({ isOnline: true, lastSeenAt: '2026-01-01T00:00:00.000Z' });
    const b = fakeUser({ isOnline: false, lastSeenAt: '2026-01-01T00:01:00.000Z' });
    expect(a).not.toBe(b);
    expect(computeProfileSyncKey(a)).toBe(computeProfileSyncKey(b));
  });

  it('muda a chave quando o nome realmente muda', () => {
    const a = fakeUser({ name: 'Dra. Ana' });
    const b = fakeUser({ name: 'Dra. Ana Paula' });
    expect(computeProfileSyncKey(a)).not.toBe(computeProfileSyncKey(b));
  });

  it('muda a chave quando o telefone muda', () => {
    const a = fakeUser({ phone: '5511999990000' });
    const b = fakeUser({ phone: '5511999991111' });
    expect(computeProfileSyncKey(a)).not.toBe(computeProfileSyncKey(b));
  });

  it('muda a chave quando profileAddress muda', () => {
    const a = fakeUser({ profileAddress: { cep: '01000-000' } });
    const b = fakeUser({ profileAddress: { cep: '02000-000' } });
    expect(computeProfileSyncKey(a)).not.toBe(computeProfileSyncKey(b));
  });

  it('muda a chave quando isProfessional/serviceIds/workingHours mudam', () => {
    const a = fakeUser({ isProfessional: true, serviceIds: ['s1'] });
    const b = fakeUser({ isProfessional: true, serviceIds: ['s1', 's2'] });
    expect(computeProfileSyncKey(a)).not.toBe(computeProfileSyncKey(b));
  });

  it('muda a chave quando o uid muda (troca de conta força resync)', () => {
    const a = fakeUser({ uid: 'u1' });
    const b = fakeUser({ uid: 'u2' });
    expect(computeProfileSyncKey(a)).not.toBe(computeProfileSyncKey(b));
  });

  it('trata user null/undefined de forma estável', () => {
    expect(computeProfileSyncKey(null)).toBe(computeProfileSyncKey(undefined));
    expect(computeProfileSyncKey(null)).not.toBe(computeProfileSyncKey(fakeUser()));
  });
});
