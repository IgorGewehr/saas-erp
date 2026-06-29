import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Client } from '@/lib/types';
import { buildPhoneMatchCandidates } from '@/lib/services/clients/resolveIdentity';

type Action = 'lookup_by_phone' | 'create' | 'get' | 'update' | 'update_address' | 'get_full_history';

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
      case 'update':
        return NextResponse.json({ ok: true, data: await updateClient(businessId, body.params.id as string, body.params.patch as Record<string, unknown>) });
      case 'get_full_history':
        return NextResponse.json({ ok: true, data: await getFullHistory(businessId, body.params.id as string) });
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
  // Match canônico BR (com/sem 55, com/sem 9, últimos 8 dígitos) em
  // phone + whatsapp + channelIdentities.whatsapp — mesma regra do helper de
  // identidade (resolveClientIdentity), pra casar dados legados e não duplicar.
  const candidates = buildPhoneMatchCandidates(phone);
  if (candidates.length === 0) return null;
  const fields = ['phone', 'whatsapp', 'channelIdentities.whatsapp'] as const;
  const snaps = await Promise.all(
    fields.map((f) =>
      adminDb.collection('clients').where('businessId', '==', businessId).where(f, 'in', candidates).limit(5).get(),
    ),
  );
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const data = d.data() as Client;
      if ((data as { deletedAt?: string }).deletedAt) continue; // soft-deleted não casa
      return { ...data, id: d.id };
    }
  }
  return null;
}

async function createClient(businessId: string, params: Record<string, unknown>) {
  const name = (params.name as string | undefined)?.trim();
  if (!name) throw new Error('name required');
  const phone = digits(params.phone as string | undefined);
  const whatsapp = digits(params.whatsapp as string | undefined) || phone;
  // Source is typed as a channel for auto-link (whatsapp/facebook/instagram) or a generic acquisition source
  const source = (params.source as Client['source']) || 'whatsapp';
  const channel = params.channel as 'whatsapp' | 'facebook' | 'instagram' | undefined;
  const cpfCnpj = (params.cpfCnpj as string | undefined)?.trim() || undefined;
  // tipo: aceita param explícito; senão detecta pelos dígitos do cpfCnpj
  // (14 → PJ, 11 → PF); fallback PF mantém comportamento antigo pra leads
  // criados sem CPF/CNPJ (caso típico de conversa WhatsApp).
  const tipoParam = params.tipo as 'pf' | 'pj' | undefined;
  const cpfCnpjDigits = cpfCnpj ? cpfCnpj.replace(/\D/g, '') : '';
  const tipo: 'pf' | 'pj' = tipoParam ?? (cpfCnpjDigits.length === 14 ? 'pj' : 'pf');

  // Dedupe check
  if (phone) {
    const existing = await lookupByPhone(businessId, phone);
    if (existing) return existing;
  }

  const now = new Date().toISOString();
  // Populate channelIdentities so the next inbound webhook auto-links this client
  const channelIdentities: Record<string, string> = {};
  const externalId = digits(params.externalId as string | undefined);
  if (channel === 'whatsapp' && (whatsapp || externalId)) channelIdentities.whatsapp = whatsapp || externalId;
  if (channel === 'facebook' && externalId) channelIdentities.facebook = externalId;
  if (channel === 'instagram' && externalId) channelIdentities.instagram = externalId;
  // If source is a channel name and externalId given, mirror into channelIdentities too
  if (source === 'whatsapp' && whatsapp && !channelIdentities.whatsapp) channelIdentities.whatsapp = whatsapp;

  const doc: Partial<Client> = {
    businessId,
    name,
    tipo,
    phone: phone || undefined,
    whatsapp: whatsapp || undefined,
    email: (params.email as string | undefined) || undefined,
    cpfCnpj,
    source,
    status: 'novo',
    score: 0,
    isActive: true,
    totalSpent: 0,
    visitCount: 0,
    ...(Object.keys(channelIdentities).length > 0 ? { channelIdentities } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const cleaned = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
  const ref = await adminDb.collection('clients').add(cleaned);
  return { id: ref.id, ...cleaned };
}

async function updateClient(businessId: string, id: string, patch: Record<string, unknown>) {
  const ref = adminDb.collection('clients').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Client not found');
  const data = snap.data() as Client;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');

  // Whitelist of safe-to-update fields the agent may touch
  const allowed: (keyof Client)[] = [
    'name', 'email', 'phone', 'whatsapp', 'company',
    'notes', 'tags', 'status', 'lifecycleStage', 'source',
    'preferredChannel', 'optInMarketing', 'birthDate', 'gender',
    'aiSummary',
  ];
  const cleanPatch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of allowed) {
    if (patch[key] !== undefined) cleanPatch[key] = patch[key];
  }
  // Normalize phone/whatsapp digits
  if (cleanPatch.phone) cleanPatch.phone = digits(String(cleanPatch.phone));
  if (cleanPatch.whatsapp) cleanPatch.whatsapp = digits(String(cleanPatch.whatsapp));

  await ref.update(cleanPatch);
  return { id, ...cleanPatch };
}

async function getFullHistory(businessId: string, id: string) {
  // Client profile
  const snap = await adminDb.collection('clients').doc(id).get();
  if (!snap.exists) throw new Error('Client not found');
  const client = snap.data() as Client;
  if (client.businessId !== businessId) throw new Error('Cross-tenant access denied');

  // Parallel fetch: orders, appointments (up to 20 of each, newest first)
  const [ordersSnap, apptsSnap] = await Promise.all([
    adminDb.collection('deliveryOrders')
      .where('businessId', '==', businessId)
      .where('clientId', '==', id)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get(),
    adminDb.collection('appointments')
      .where('businessId', '==', businessId)
      .where('clientId', '==', id)
      .orderBy('date', 'desc')
      .limit(20)
      .get(),
  ]);

  return {
    client: { ...client, id: snap.id },
    orders: ordersSnap.docs.map(d => {
      const o = d.data();
      return { id: d.id, number: o.number, status: o.status, total: o.total, createdAt: o.createdAt, items: (o.items || []).map((i: { productName: string; quantity: number }) => `${i.quantity}× ${i.productName}`) };
    }),
    appointments: apptsSnap.docs.map(d => {
      const a = d.data();
      return { id: d.id, date: a.date, startTime: a.startTime, serviceName: a.serviceName, professionalName: a.professionalName, status: a.status, price: a.price };
    }),
    stats: {
      totalOrders: ordersSnap.size,
      totalAppointments: apptsSnap.size,
      totalSpent: client.totalSpent || 0,
      visitCount: client.visitCount || 0,
      lastVisit: client.lastVisit,
    },
  };
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
