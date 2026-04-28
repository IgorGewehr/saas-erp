/**
 * Agent tool: Team & sector introspection (read-only).
 *
 * Exposes the team structure to the agent so it can:
 *   - Know who to assign tasks/conversations to
 *   - Check sector ownership of a conversation/kanban
 *   - Understand capacity (how busy each professional is)
 *
 * Actions:
 *   - list_sectors          sectors in the business
 *   - list_members          users (optionally filtered by sector, role, active)
 *   - get_member            single user
 *   - capacity_today        count of today's pending work per user (appts/orders/conversations)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Sector, User, UserRole } from '@/lib/types';

type Action = 'list_sectors' | 'list_members' | 'get_member' | 'capacity_today';

const SAFE_USER_FIELDS: (keyof User)[] = [
  'id', 'uid', 'name', 'email', 'role', 'sectorIds', 'isProfessional',
  'serviceIds', 'commissionRate', 'isActive', 'isOnline', 'userStatus',
  'lastSeenAt', 'workingHours', 'photoURL',
];

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (err) {
    const resp = agentAuthErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  const body = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  try {
    switch (body.action) {
      case 'list_sectors':
        return NextResponse.json({ ok: true, data: await listSectors(businessId) });
      case 'list_members':
        return NextResponse.json({ ok: true, data: await listMembers(businessId, body.params as { sectorId?: string; role?: UserRole; isProfessional?: boolean; isActive?: boolean; limit?: number }) });
      case 'get_member':
        return NextResponse.json({ ok: true, data: await getMember(businessId, body.params.id as string) });
      case 'capacity_today':
        return NextResponse.json({ ok: true, data: await capacityToday(businessId, body.params.userId as string | undefined) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.team] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function listSectors(businessId: string): Promise<Sector[]> {
  const snap = await adminDb
    .collection('sectors')
    .where('businessId', '==', businessId)
    .where('isActive', '==', true)
    .orderBy('name')
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as Sector), id: d.id }));
}

async function listMembers(
  businessId: string,
  p: { sectorId?: string; role?: UserRole; isProfessional?: boolean; isActive?: boolean; limit?: number },
): Promise<Partial<User>[]> {
  const limit = Math.min(Math.max(p.limit ?? 100, 1), 500);

  let q: FirebaseFirestore.Query = adminDb.collection('users').where('businessId', '==', businessId);
  if (p.sectorId) q = q.where('sectorIds', 'array-contains', p.sectorId);
  if (p.role) q = q.where('role', '==', p.role);
  if (typeof p.isProfessional === 'boolean') q = q.where('isProfessional', '==', p.isProfessional);
  if (typeof p.isActive === 'boolean') q = q.where('isActive', '==', p.isActive);

  const snap = await q.orderBy('name').limit(limit).get();
  return snap.docs.map((d) => projectUser({ ...(d.data() as User), id: d.id }));
}

async function getMember(businessId: string, id: string): Promise<Partial<User> | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('users').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as User;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return projectUser({ ...data, id: doc.id });
}

async function capacityToday(businessId: string, userId?: string): Promise<Array<{ userId: string; userName: string; appointments: number; orders: number; kanbanCards: number; conversations: number }>> {
  const today = new Date().toISOString().slice(0, 10);

  // 1. Appointments scheduled today
  let apptQ: FirebaseFirestore.Query = adminDb
    .collection('appointments')
    .where('businessId', '==', businessId)
    .where('date', '==', today);
  if (userId) apptQ = apptQ.where('professionalId', '==', userId);
  const appts = await apptQ.get();

  // 2. Kanban cards assigned and due today or earlier, status not done
  // (approximation — we just check assignee)
  let kanbanQ: FirebaseFirestore.Query = adminDb
    .collection('kanbanCards')
    .where('businessId', '==', businessId);
  if (userId) kanbanQ = kanbanQ.where('assigneeIds', 'array-contains', userId);
  const cards = await kanbanQ.limit(500).get();

  // 3. Open conversations assigned
  let convQ: FirebaseFirestore.Query = adminDb
    .collection('conversations')
    .where('businessId', '==', businessId)
    .where('status', '==', 'open');
  if (userId) convQ = convQ.where('assignedTo', '==', userId);
  const convs = await convQ.limit(500).get();

  // Build index
  const counts: Record<string, { appointments: number; orders: number; kanbanCards: number; conversations: number; userName: string }> = {};

  const bump = (uid: string | undefined, key: 'appointments' | 'orders' | 'kanbanCards' | 'conversations', name?: string) => {
    if (!uid) return;
    counts[uid] ||= { appointments: 0, orders: 0, kanbanCards: 0, conversations: 0, userName: name || '' };
    counts[uid][key] += 1;
    if (name && !counts[uid].userName) counts[uid].userName = name;
  };

  for (const d of appts.docs) {
    const a = d.data() as { professionalId?: string; professionalName?: string };
    bump(a.professionalId, 'appointments', a.professionalName);
  }
  for (const d of cards.docs) {
    const c = d.data() as { assigneeIds?: string[]; assigneeNames?: string[] };
    (c.assigneeIds || []).forEach((uid, i) => bump(uid, 'kanbanCards', c.assigneeNames?.[i]));
  }
  for (const d of convs.docs) {
    const v = d.data() as { assignedTo?: string; assignedToName?: string };
    bump(v.assignedTo, 'conversations', v.assignedToName);
  }

  // If userId filter provided, return single-element array
  if (userId) {
    const entry = counts[userId] || { appointments: 0, orders: 0, kanbanCards: 0, conversations: 0, userName: '' };
    return [{ userId, ...entry }];
  }

  return Object.entries(counts).map(([uid, v]) => ({ userId: uid, ...v }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function projectUser(u: User): Partial<User> {
  const out: Partial<User> = {};
  for (const k of SAFE_USER_FIELDS) {
    (out as Record<string, unknown>)[k] = (u as unknown as Record<string, unknown>)[k];
  }
  return out;
}
