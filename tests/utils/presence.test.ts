import { describe, expect, it } from 'vitest';
import { getMemberDisplayStatus, isMemberOnline } from '@/lib/utils/presence';

describe('getMemberDisplayStatus', () => {
  it('retorna offline quando userStatus é invisible, mesmo com isOnline=true', () => {
    expect(getMemberDisplayStatus({
      userStatus: 'invisible', isOnline: true, lastSeenAt: new Date().toISOString(),
    })).toBe('offline');
  });

  it('retorna offline quando isOnline é false', () => {
    expect(getMemberDisplayStatus({
      userStatus: 'online', isOnline: false, lastSeenAt: new Date().toISOString(),
    })).toBe('offline');
  });

  it('retorna offline quando lastSeenAt está ausente', () => {
    expect(getMemberDisplayStatus({ userStatus: 'online', isOnline: true })).toBe('offline');
  });

  it('retorna offline quando lastSeenAt está velho (>= 3min)', () => {
    const stale = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    expect(getMemberDisplayStatus({ userStatus: 'online', isOnline: true, lastSeenAt: stale })).toBe('offline');
  });

  it('retorna busy quando userStatus é busy e lastSeenAt é recente', () => {
    const fresh = new Date().toISOString();
    expect(getMemberDisplayStatus({ userStatus: 'busy', isOnline: true, lastSeenAt: fresh })).toBe('busy');
  });

  it('retorna online quando userStatus é online e lastSeenAt é recente', () => {
    const fresh = new Date().toISOString();
    expect(getMemberDisplayStatus({ userStatus: 'online', isOnline: true, lastSeenAt: fresh })).toBe('online');
  });
});

describe('isMemberOnline', () => {
  it('é false quando getMemberDisplayStatus retorna offline', () => {
    expect(isMemberOnline({ userStatus: 'invisible', isOnline: true, lastSeenAt: new Date().toISOString() })).toBe(false);
  });

  it('é true quando getMemberDisplayStatus retorna online ou busy', () => {
    const fresh = new Date().toISOString();
    expect(isMemberOnline({ userStatus: 'online', isOnline: true, lastSeenAt: fresh })).toBe(true);
    expect(isMemberOnline({ userStatus: 'busy', isOnline: true, lastSeenAt: fresh })).toBe(true);
  });
});
