/**
 * lib/utils/presence.ts
 *
 * M09 Gap 6: `getMemberDisplayStatus` estava duplicada (copy-paste idêntico)
 * em SettingsModule.tsx e TeamChatPanel.tsx — util compartilhado consolida
 * as duas cópias. Ver CLAUDE.md §4: nunca confiar em `member.isOnline` cru,
 * ele ignora `userStatus === 'invisible'`.
 */

import type { User } from '@/lib/types';

const STALE_AFTER_MS = 3 * 60 * 1000;

export function getMemberDisplayStatus(member: Pick<User, 'userStatus' | 'isOnline' | 'lastSeenAt'>): 'online' | 'busy' | 'offline' {
  if (member.userStatus === 'invisible') return 'offline';
  if (!member.isOnline || !member.lastSeenAt) return 'offline';
  if (Date.now() - new Date(member.lastSeenAt).getTime() >= STALE_AFTER_MS) return 'offline';
  return member.userStatus === 'busy' ? 'busy' : 'online';
}

export function isMemberOnline(member: Pick<User, 'userStatus' | 'isOnline' | 'lastSeenAt'>): boolean {
  return getMemberDisplayStatus(member) !== 'offline';
}
