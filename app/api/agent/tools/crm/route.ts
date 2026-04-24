/**
 * Agent tool: CRM operations (contacts, deals, activities, segments).
 *
 * Client CRUD already lives in /api/agent/tools/clients. This endpoint adds the
 * CRM-specific surfaces that the legacy endpoint doesn't cover:
 *
 *   - list_contacts         filtered search across clients (status, tags, lifecycle)
 *   - list_deals            deals pipeline view
 *   - get_deal              single deal
 *   - create_deal           new deal linked to a contact
 *   - update_deal_stage     move deal along pipeline
 *   - close_deal            mark as won/lost with reason
 *   - list_activities       per-contact or per-deal activities
 *   - log_activity          append activity (call, email, meeting, note, task)
 *   - segment_query         resolve a saved Segment's filters into a client list
 *   - list_segments         all business segments (reads)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Client, CRMDeal, CRMActivity, CRMActivityType, LeadStatus, LifecycleStage, Segment, SegmentFilter, SegmentFilterOperator } from '@/lib/types';

type Action =
  | 'list_contacts'
  | 'list_deals'
  | 'get_deal'
  | 'create_deal'
  | 'update_deal_stage'
  | 'close_deal'
  | 'list_activities'
  | 'log_activity'
  | 'segment_query'
  | 'list_segments';

const VALID_ACTIVITY_TYPES: CRMActivityType[] = ['ligacao', 'email', 'reuniao', 'whatsapp', 'tarefa', 'nota', 'proposta'];

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
      case 'list_contacts':
        return NextResponse.json({ ok: true, data: await listContacts(businessId, body.params as { status?: LeadStatus; lifecycleStage?: LifecycleStage; tag?: string; assignedTo?: string; limit?: number }) });
      case 'list_deals':
        return NextResponse.json({ ok: true, data: await listDeals(businessId, body.params as { stage?: string; assignedTo?: string; contactId?: string; limit?: number }) });
      case 'get_deal':
        return NextResponse.json({ ok: true, data: await getDeal(businessId, body.params.id as string) });
      case 'create_deal':
        return NextResponse.json({ ok: true, data: await createDeal(businessId, body.params as unknown as Partial<CRMDeal>) });
      case 'update_deal_stage':
        return NextResponse.json({ ok: true, data: await updateDealStage(businessId, body.params.id as string, body.params.stage as string, body.params.probability as number | undefined) });
      case 'close_deal':
        return NextResponse.json({ ok: true, data: await closeDeal(businessId, body.params.id as string, body.params.won as boolean, body.params.reason as string | undefined) });
      case 'list_activities':
        return NextResponse.json({ ok: true, data: await listActivities(businessId, body.params as { contactId?: string; dealId?: string; type?: CRMActivityType; limit?: number }) });
      case 'log_activity':
        return NextResponse.json({ ok: true, data: await logActivity(businessId, body.params as unknown as Partial<CRMActivity>) });
      case 'segment_query':
        return NextResponse.json({ ok: true, data: await segmentQuery(businessId, body.params.segmentId as string, body.params.limit as number | undefined) });
      case 'list_segments':
        return NextResponse.json({ ok: true, data: await listSegments(businessId) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.crm] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Contacts ────────────────────────────────────────────────────────────────

async function listContacts(
  businessId: string,
  p: { status?: LeadStatus; lifecycleStage?: LifecycleStage; tag?: string; assignedTo?: string; limit?: number },
): Promise<Client[]> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  let q: FirebaseFirestore.Query = adminDb.collection('clients').where('businessId', '==', businessId);
  if (p.status) q = q.where('status', '==', p.status);
  if (p.lifecycleStage) q = q.where('lifecycleStage', '==', p.lifecycleStage);
  if (p.assignedTo) q = q.where('assignedTo', '==', p.assignedTo);
  if (p.tag) q = q.where('tags', 'array-contains', p.tag);

  const snap = await q.orderBy('updatedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as Client), id: d.id }));
}

// ─── Deals ───────────────────────────────────────────────────────────────────

async function listDeals(
  businessId: string,
  p: { stage?: string; assignedTo?: string; contactId?: string; limit?: number },
): Promise<CRMDeal[]> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  let q: FirebaseFirestore.Query = adminDb.collection('crmDeals').where('businessId', '==', businessId);
  if (p.stage) q = q.where('stage', '==', p.stage);
  if (p.assignedTo) q = q.where('assignedTo', '==', p.assignedTo);
  if (p.contactId) q = q.where('contactId', '==', p.contactId);

  const snap = await q.orderBy('updatedAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as CRMDeal), id: d.id }));
}

async function getDeal(businessId: string, id: string): Promise<CRMDeal | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('crmDeals').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as CRMDeal;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

async function createDeal(businessId: string, p: Partial<CRMDeal>): Promise<CRMDeal> {
  if (!p.contactId || typeof p.contactId !== 'string') throw new Error('contactId required');
  if (!p.title || typeof p.title !== 'string') throw new Error('title required');
  if (typeof p.value !== 'number' || p.value < 0) throw new Error('value must be >= 0');
  if (!p.stage) throw new Error('stage required');

  // Verify contact belongs to same tenant
  const contact = await adminDb.collection('clients').doc(p.contactId).get();
  if (!contact.exists) throw new Error('Contact not found');
  const c = contact.data() as Client;
  if (c.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const now = new Date().toISOString();
  const ref = adminDb.collection('crmDeals').doc();
  const deal: CRMDeal = {
    id: ref.id,
    businessId,
    contactId: p.contactId,
    contactName: p.contactName || c.name,
    title: p.title.slice(0, 200),
    value: round(p.value),
    stage: p.stage,
    probability: typeof p.probability === 'number' ? p.probability : 50,
    expectedCloseDate: p.expectedCloseDate,
    assignedTo: p.assignedTo,
    assignedToName: p.assignedToName,
    notes: p.notes?.slice(0, 2000),
    tags: p.tags,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(deal);
  return deal;
}

async function updateDealStage(businessId: string, id: string, stage: string, probability?: number): Promise<CRMDeal> {
  if (!id || !stage) throw new Error('id and stage required');
  const ref = adminDb.collection('crmDeals').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Deal not found');
  const deal = snap.data() as CRMDeal;
  if (deal.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const now = new Date().toISOString();
  const patch: Partial<CRMDeal> = { stage, updatedAt: now };
  if (typeof probability === 'number') patch.probability = Math.max(0, Math.min(100, probability));
  await ref.update(patch);
  return { ...deal, ...patch, id: snap.id };
}

async function closeDeal(businessId: string, id: string, won: boolean, reason?: string): Promise<CRMDeal> {
  if (!id) throw new Error('id required');
  const ref = adminDb.collection('crmDeals').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Deal not found');
  const deal = snap.data() as CRMDeal;
  if (deal.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const now = new Date().toISOString();
  const patch: Partial<CRMDeal> = {
    stage: won ? 'ganho' : 'perdido',
    probability: won ? 100 : 0,
    closedDate: now.slice(0, 10),
    updatedAt: now,
  };
  if (!won && reason) patch.lostReason = reason.slice(0, 500);

  await ref.update(patch);
  return { ...deal, ...patch, id: snap.id };
}

// ─── Activities ──────────────────────────────────────────────────────────────

async function listActivities(
  businessId: string,
  p: { contactId?: string; dealId?: string; type?: CRMActivityType; limit?: number },
): Promise<CRMActivity[]> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  let q: FirebaseFirestore.Query = adminDb.collection('crmActivities').where('businessId', '==', businessId);
  if (p.contactId) q = q.where('contactId', '==', p.contactId);
  if (p.dealId) q = q.where('dealId', '==', p.dealId);
  if (p.type && VALID_ACTIVITY_TYPES.includes(p.type)) q = q.where('type', '==', p.type);

  const snap = await q.orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as CRMActivity), id: d.id }));
}

async function logActivity(businessId: string, p: Partial<CRMActivity>): Promise<CRMActivity> {
  if (!p.type || !VALID_ACTIVITY_TYPES.includes(p.type)) throw new Error(`type must be one of ${VALID_ACTIVITY_TYPES.join(',')}`);
  if (!p.title) throw new Error('title required');
  if (!p.contactId && !p.dealId) throw new Error('either contactId or dealId required');

  const now = new Date().toISOString();
  const ref = adminDb.collection('crmActivities').doc();
  const activity: CRMActivity = {
    id: ref.id,
    businessId,
    contactId: p.contactId,
    contactName: p.contactName,
    dealId: p.dealId,
    dealTitle: p.dealTitle,
    type: p.type,
    title: p.title.slice(0, 200),
    description: p.description?.slice(0, 2000),
    scheduledAt: p.scheduledAt,
    completedAt: p.isCompleted ? (p.completedAt || now) : undefined,
    isCompleted: !!p.isCompleted,
    assignedTo: p.assignedTo,
    assignedToName: p.assignedToName,
    duration: p.duration,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(activity);
  return activity;
}

// ─── Segments ────────────────────────────────────────────────────────────────

async function listSegments(businessId: string): Promise<Segment[]> {
  const snap = await adminDb
    .collection('segments')
    .where('businessId', '==', businessId)
    .orderBy('name')
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as Segment), id: d.id }));
}

async function segmentQuery(businessId: string, segmentId: string, limit?: number): Promise<{ segment: Segment; contacts: Client[] }> {
  if (!segmentId) throw new Error('segmentId required');
  const cap = Math.min(Math.max(limit ?? 100, 1), 500);

  const segDoc = await adminDb.collection('segments').doc(segmentId).get();
  if (!segDoc.exists) throw new Error('Segment not found');
  const segment = { ...(segDoc.data() as Segment), id: segDoc.id };
  if (segment.businessId !== businessId) throw new Error('Cross-tenant access denied');

  // Resolve filters: apply first Firestore-friendly filter in query, rest in memory
  let q: FirebaseFirestore.Query = adminDb.collection('clients').where('businessId', '==', businessId);
  const pending: SegmentFilter[] = [];

  let applied = 0;
  for (const f of segment.filters || []) {
    const op = toFirestoreOp(f.operator);
    if (applied < 1 && op) {
      q = q.where(f.field, op, f.value as string);
      applied += 1;
    } else {
      pending.push(f);
    }
  }

  const snap = await q.limit(cap * 2).get();
  const candidates = snap.docs.map((d) => ({ ...(d.data() as Client), id: d.id }));
  const filtered = candidates.filter((c) => pending.every((f) => evalFilterInMemory(c, f))).slice(0, cap);

  return { segment, contacts: filtered };
}

function toFirestoreOp(op: SegmentFilterOperator): FirebaseFirestore.WhereFilterOp | null {
  switch (op) {
    case 'eq': return '==';
    case 'neq': return '!=';
    case 'gt': return '>';
    case 'lt': return '<';
    case 'in': return 'in';
    case 'not_in': return 'not-in';
    default: return null;
  }
}

function evalFilterInMemory(c: Client, f: SegmentFilter): boolean {
  const val = (c as unknown as Record<string, unknown>)[f.field];
  switch (f.operator) {
    case 'eq': return val === f.value;
    case 'neq': return val !== f.value;
    case 'gt': return typeof val === 'number' && typeof f.value === 'number' && val > f.value;
    case 'lt': return typeof val === 'number' && typeof f.value === 'number' && val < f.value;
    case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(val);
    case 'not_in': return Array.isArray(f.value) && !(f.value as unknown[]).includes(val);
    case 'contains':
      return typeof val === 'string' && typeof f.value === 'string' && val.toLowerCase().includes(f.value.toLowerCase());
    case 'not_contains':
      return !(typeof val === 'string' && typeof f.value === 'string' && val.toLowerCase().includes(f.value.toLowerCase()));
    default: return false;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
