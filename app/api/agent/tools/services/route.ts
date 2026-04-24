/**
 * Agent tool: Services CRUD (agenda catalog management).
 *
 * Complements the read-only `agenda_list_services` from /api/agent/tools/agenda
 * — this endpoint is the operational side for the operator console.
 *
 * Actions:
 *   - list               all services (incl. inactive)
 *   - get                single service
 *   - create             new service
 *   - update             patch whitelisted fields
 *   - set_active         toggle isActive
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Service } from '@/lib/types';

type Action = 'list' | 'get' | 'create' | 'update' | 'set_active';

interface CreateParams {
  name: string;
  description?: string;
  duration: number;
  price: number;
  category?: string;
  color?: string;
  commissionRate?: number;
  userId?: string;
  userName?: string;
}

const WRITEABLE: (keyof Service)[] = [
  'name', 'description', 'duration', 'price', 'category', 'color',
  'commissionRate', 'isActive', 'userId', 'userName',
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
      case 'list':
        return NextResponse.json({ ok: true, data: await listServices(businessId, body.params as { includeInactive?: boolean; category?: string; limit?: number }) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getService(businessId, body.params.id as string) });
      case 'create':
        return NextResponse.json({ ok: true, data: await createService(businessId, body.params as unknown as CreateParams) });
      case 'update':
        return NextResponse.json({ ok: true, data: await updateService(businessId, body.params.id as string, body.params.patch as Partial<Service>) });
      case 'set_active':
        return NextResponse.json({ ok: true, data: await updateService(businessId, body.params.id as string, { isActive: body.params.isActive as boolean }) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.services] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function listServices(businessId: string, p: { includeInactive?: boolean; category?: string; limit?: number }): Promise<Service[]> {
  const limit = Math.min(Math.max(p.limit ?? 100, 1), 500);
  let q: FirebaseFirestore.Query = adminDb.collection('services').where('businessId', '==', businessId);
  if (!p.includeInactive) q = q.where('isActive', '==', true);
  if (p.category) q = q.where('category', '==', p.category);

  const snap = await q.orderBy('name').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as Service), id: d.id }));
}

async function getService(businessId: string, id: string): Promise<Service | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('services').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as Service;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

async function createService(businessId: string, p: CreateParams): Promise<Service> {
  if (!p.name) throw new Error('name required');
  if (typeof p.duration !== 'number' || p.duration <= 0) throw new Error('duration must be > 0');
  if (typeof p.price !== 'number' || p.price < 0) throw new Error('price must be >= 0');

  const now = new Date().toISOString();
  const ref = adminDb.collection('services').doc();
  const service: Service = {
    id: ref.id,
    businessId,
    userId: p.userId,
    userName: p.userName,
    name: p.name.slice(0, 200),
    description: p.description?.slice(0, 2000),
    duration: p.duration,
    price: round(p.price),
    category: p.category,
    color: p.color || '#ef4444',
    commissionRate: typeof p.commissionRate === 'number' ? Math.max(0, Math.min(100, p.commissionRate)) : undefined,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(service);
  return service;
}

async function updateService(businessId: string, id: string, patch: Partial<Service>): Promise<Service> {
  if (!id) throw new Error('id required');
  const ref = adminDb.collection('services').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Service not found');
  const service = snap.data() as Service;
  if (service.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const clean: Record<string, unknown> = {};
  for (const k of WRITEABLE) {
    if (k in patch) clean[k] = (patch as Record<string, unknown>)[k];
  }
  if (typeof clean.name === 'string') clean.name = (clean.name as string).slice(0, 200);
  if (typeof clean.description === 'string') clean.description = (clean.description as string).slice(0, 2000);
  if (typeof clean.price === 'number') clean.price = round(clean.price as number);
  if (typeof clean.commissionRate === 'number') {
    clean.commissionRate = Math.max(0, Math.min(100, clean.commissionRate as number));
  }

  clean.updatedAt = new Date().toISOString();
  await ref.update(clean);
  return { ...service, ...clean, id: snap.id } as Service;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
