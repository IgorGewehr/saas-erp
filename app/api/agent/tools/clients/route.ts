import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Client } from '@/lib/types';

type Action = 'lookup_by_phone' | 'create' | 'get' | 'update_address';

const digits = (v: string | undefined) => (v || '').replace(/\D/g, '');

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
      case 'lookup_by_phone':
        return NextResponse.json({ ok: true, data: await lookupByPhone(businessId, body.params.phone as string) });
      case 'create':
        return NextResponse.json({ ok: true, data: await createClient(businessId, body.params) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getClient(businessId, body.params.id as string) });
      case 'update_address':
        return NextResponse.json({ ok: true, data: await updateAddress(businessId, body.params.id as string, body.params.address) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent/tools/clients]', body.action, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

async function lookupByPhone(businessId: string, phone: string) {
  const p = digits(phone);
  if (!p) return null;
  // Try phone and whatsapp
  const [phoneSnap, waSnap] = await Promise.all([
    adminDb.collection('clients').where('businessId', '==', businessId).where('phone', '==', p).limit(1).get(),
    adminDb.collection('clients').where('businessId', '==', businessId).where('whatsapp', '==', p).limit(1).get(),
  ]);
  const doc = phoneSnap.docs[0] || waSnap.docs[0];
  return doc ? { ...(doc.data() as Client), id: doc.id } : null;
}

async function createClient(businessId: string, params: Record<string, unknown>) {
  const name = (params.name as string | undefined)?.trim();
  if (!name) throw new Error('name required');
  const phone = digits(params.phone as string | undefined);
  const whatsapp = digits(params.whatsapp as string | undefined) || phone;

  // Dedupe check
  if (phone) {
    const existing = await lookupByPhone(businessId, phone);
    if (existing) return existing;
  }

  const now = new Date().toISOString();
  const doc: Partial<Client> = {
    businessId,
    name,
    phone: phone || undefined,
    whatsapp: whatsapp || undefined,
    email: (params.email as string | undefined) || undefined,
    source: (params.source as Client['source']) || 'whatsapp',
    status: 'novo',
    score: 0,
    isActive: true,
    totalSpent: 0,
    visitCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const cleaned = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
  const ref = await adminDb.collection('clients').add(cleaned);
  return { id: ref.id, ...cleaned };
}

async function getClient(businessId: string, id: string) {
  const snap = await adminDb.collection('clients').doc(id).get();
  if (!snap.exists) throw new Error('Client not found');
  const data = snap.data() as Client;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: snap.id };
}

async function updateAddress(businessId: string, id: string, address: unknown) {
  const ref = adminDb.collection('clients').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Client not found');
  const data = snap.data() as Client;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  await ref.update({ endereco: address, updatedAt: new Date().toISOString() });
  return { id, endereco: address };
}
