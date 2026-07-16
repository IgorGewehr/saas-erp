/**
 * index.ts — entrada pública do read-model de Assinaturas (a joia do plano).
 * Decide o eixo (`resolveSubscriptionAxis`) e delega pro eixo correspondente.
 * FUNÇÃO PURA — zero JSX, zero Firestore.
 */

import type { ClientMembership, Membership, Transaction, Project } from '@/lib/types';
import { computeMembershipAxis } from './membership-axis';
import { computeProjectAxis } from './project-axis';
import type { AssinaturasOverview, SubscriptionAxis } from './types';

export * from './types';

export function resolveSubscriptionAxis(clientMemberships: ClientMembership[], projects: Project[], projectsEnabled: boolean): SubscriptionAxis | null {
  if (clientMemberships.length > 0) return 'membership';
  if (projectsEnabled && projects.length > 0) return 'project';
  return null;
}

export function computeAssinaturasOverview(params: {
  clientMemberships: ClientMembership[];
  memberships: Membership[];
  transactions: Transaction[];
  projects: Project[];
  projectsEnabled: boolean;
  period: string;
  now?: Date;
}): AssinaturasOverview | null {
  const now = params.now ?? new Date();
  const axis = resolveSubscriptionAxis(params.clientMemberships, params.projects, params.projectsEnabled);
  if (axis === 'membership') {
    return computeMembershipAxis(params.clientMemberships, params.memberships, params.transactions, params.period, now);
  }
  if (axis === 'project') {
    return computeProjectAxis(params.transactions, params.projects, params.period, now);
  }
  return null;
}
