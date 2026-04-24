/**
 * Agent tool: Supplier (fornecedor) CRUD.
 *
 * Supports list/get/create/update. Linked to purchaseNotes via supplierId/cnpj.
 *
 * Actions:
 *   - list                all active suppliers
 *   - get                 single supplier
 *   - create              new supplier
 *   - update              patch whitelisted fields
 *   - find_by_cnpj        lookup by CNPJ (for deduplication during NF-e import)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Supplier, Address } from '@/lib/types';

type Action = 'list' | 'get' | 'create' | 'update' | 'find_by_cnpj';

interface CreateParams {
  razaoSocial: string;
  nomeFantasia?: string;
  cnpj: string;
  inscricaoEstadual?: string;
  phone?: string;
  email?: string;
  endereco?: Address;
  notes?: string;
}

const WRITEABLE: (keyof Supplier)[] = [
  'razaoSocial', 'nomeFantasia', 'cnpj', 'inscricaoEstadual',
  'phone', 'email', 'endereco', 'notes', 'isActive',
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
        return NextResponse.json({ ok: true, data: await listSuppliers(businessId, body.params as { includeInactive?: boolean; limit?: number }) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getSupplier(businessId, body.params.id as string) });
      case 'create':
        return NextResponse.json({ ok: true, data: await createSupplier(businessId, body.params as unknown as CreateParams) });
      case 'update':
        return NextResponse.json({ ok: true, data: await updateSupplier(businessId, body.params.id as string, body.params.patch as Partial<Supplier>) });
      case 'find_by_cnpj':
        return NextResponse.json({ ok: true, data: await findByCnpj(businessId, body.params.cnpj as string) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.suppliers] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function listSuppliers(businessId: string, p: { includeInactive?: boolean; limit?: number }): Promise<Supplier[]> {
  const limit = Math.min(Math.max(p.limit ?? 100, 1), 500);
  let q: FirebaseFirestore.Query = adminDb.collection('suppliers').where('businessId', '==', businessId);
  if (!p.includeInactive) q = q.where('isActive', '==', true);

  const snap = await q.orderBy('razaoSocial').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as Supplier), id: d.id }));
}

async function getSupplier(businessId: string, id: string): Promise<Supplier | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('suppliers').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as Supplier;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

async function createSupplier(businessId: string, p: CreateParams): Promise<Supplier> {
  if (!p.razaoSocial) throw new Error('razaoSocial required');
  if (!p.cnpj) throw new Error('cnpj required');

  const cnpjNorm = p.cnpj.replace(/\D/g, '');
  if (cnpjNorm.length !== 14) throw new Error('CNPJ must have 14 digits');

  // De-dup by CNPJ
  const existing = await findByCnpj(businessId, cnpjNorm);
  if (existing) {
    throw new Error(`Supplier already exists with this CNPJ (id: ${existing.id})`);
  }

  const now = new Date().toISOString();
  const ref = adminDb.collection('suppliers').doc();
  const supplier: Supplier = {
    id: ref.id,
    businessId,
    razaoSocial: p.razaoSocial.slice(0, 200),
    nomeFantasia: p.nomeFantasia?.slice(0, 200),
    cnpj: cnpjNorm,
    inscricaoEstadual: p.inscricaoEstadual,
    phone: p.phone,
    email: p.email,
    endereco: p.endereco,
    notes: p.notes?.slice(0, 500),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(supplier);
  return supplier;
}

async function updateSupplier(businessId: string, id: string, patch: Partial<Supplier>): Promise<Supplier> {
  if (!id) throw new Error('id required');
  const ref = adminDb.collection('suppliers').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Supplier not found');
  const supplier = snap.data() as Supplier;
  if (supplier.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const clean: Record<string, unknown> = {};
  for (const k of WRITEABLE) {
    if (k in patch) clean[k] = (patch as Record<string, unknown>)[k];
  }
  if (typeof clean.razaoSocial === 'string') clean.razaoSocial = (clean.razaoSocial as string).slice(0, 200);
  if (typeof clean.notes === 'string') clean.notes = (clean.notes as string).slice(0, 500);
  if (typeof clean.cnpj === 'string') {
    const norm = (clean.cnpj as string).replace(/\D/g, '');
    if (norm.length !== 14) throw new Error('CNPJ must have 14 digits');
    clean.cnpj = norm;
  }

  clean.updatedAt = new Date().toISOString();
  await ref.update(clean);
  return { ...supplier, ...clean, id: snap.id } as Supplier;
}

async function findByCnpj(businessId: string, cnpj: string): Promise<Supplier | null> {
  if (!cnpj) throw new Error('cnpj required');
  const norm = cnpj.replace(/\D/g, '');
  const snap = await adminDb
    .collection('suppliers')
    .where('businessId', '==', businessId)
    .where('cnpj', '==', norm)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { ...(doc.data() as Supplier), id: doc.id };
}
