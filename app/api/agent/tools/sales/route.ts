/**
 * Agent tool: Sales (PDV transactions).
 *
 * Distinct from DeliveryOrders (delivery/takeout) and Appointments (services).
 * Sales are immediate POS transactions with payment at time of sale.
 *
 * Actions:
 *   - list                 list sales with filters
 *   - get                  single sale
 *   - list_by_client       sales for a specific client
 *   - create               create a new sale (status=finalizada by default)
 *   - cancel               cancel a finalized sale (status='cancelada')
 *   - summary_today        sales summary for today (count, revenue, payment methods)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Sale, SaleItem, Payment, PaymentMethod } from '@/lib/types';

type Action = 'list' | 'get' | 'list_by_client' | 'create' | 'cancel' | 'summary_today';
type SaleStatus = 'aberta' | 'finalizada' | 'cancelada';

interface CreateParams {
  clientId?: string;
  clientName?: string;
  items: Array<Omit<SaleItem, 'id'>>;
  payments: Payment[];
  subtotal?: number;           // derived from items if omitted
  discount?: number;
  tip?: number;
  total?: number;              // derived from subtotal-discount+tip if omitted
  status?: SaleStatus;         // default 'finalizada'
  notes?: string;
  operatorId?: string;         // defaults to 'agent'
  operatorName?: string;
  channelType?: 'whatsapp' | 'facebook' | 'instagram';
  conversationId?: string;
}

const VALID_STATUS: SaleStatus[] = ['aberta', 'finalizada', 'cancelada'];

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
        return NextResponse.json({ ok: true, data: await listSales(businessId, body.params as { status?: SaleStatus; fromDate?: string; toDate?: string; limit?: number }) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getSale(businessId, body.params.id as string) });
      case 'list_by_client':
        return NextResponse.json({ ok: true, data: await listByClient(businessId, body.params.clientId as string, body.params.limit as number | undefined) });
      case 'create':
        return NextResponse.json({ ok: true, data: await createSale(businessId, body.params as unknown as CreateParams) });
      case 'cancel':
        return NextResponse.json({ ok: true, data: await cancelSale(businessId, body.params.id as string, body.params.reason as string | undefined) });
      case 'summary_today':
        return NextResponse.json({ ok: true, data: await summaryToday(businessId) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.sales] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function listSales(
  businessId: string,
  p: { status?: SaleStatus; fromDate?: string; toDate?: string; limit?: number },
): Promise<Sale[]> {
  const limit = Math.min(Math.max(p.limit ?? 50, 1), 200);
  let q: FirebaseFirestore.Query = adminDb.collection('sales').where('businessId', '==', businessId);
  if (p.status && VALID_STATUS.includes(p.status)) q = q.where('status', '==', p.status);
  if (p.fromDate) q = q.where('createdAt', '>=', p.fromDate);
  if (p.toDate) q = q.where('createdAt', '<=', p.toDate);

  const snap = await q.orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as Sale), id: d.id }));
}

async function getSale(businessId: string, id: string): Promise<Sale | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('sales').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as Sale;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

async function listByClient(businessId: string, clientId: string, limit?: number): Promise<Sale[]> {
  if (!clientId) throw new Error('clientId required');
  const cap = Math.min(Math.max(limit ?? 20, 1), 100);
  const snap = await adminDb
    .collection('sales')
    .where('businessId', '==', businessId)
    .where('clientId', '==', clientId)
    .orderBy('createdAt', 'desc')
    .limit(cap)
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as Sale), id: d.id }));
}

async function createSale(businessId: string, p: CreateParams): Promise<Sale> {
  if (!Array.isArray(p.items) || p.items.length === 0) throw new Error('items required');
  if (!Array.isArray(p.payments) || p.payments.length === 0) throw new Error('payments required');

  // Compute totals if not provided
  const subtotal = typeof p.subtotal === 'number' ? p.subtotal : p.items.reduce((s, it) => s + (it.total ?? it.quantity * it.unitPrice), 0);
  const discount = typeof p.discount === 'number' ? p.discount : 0;
  const tip = typeof p.tip === 'number' ? p.tip : 0;
  const total = typeof p.total === 'number' ? p.total : subtotal - discount + tip;

  // Validate payments sum ~= total (allow 1 cent tolerance for rounding)
  const payTotal = p.payments.reduce((s, x) => s + x.amount, 0);
  if (Math.abs(payTotal - total) > 0.01) {
    throw new Error(`Sum of payments (${payTotal.toFixed(2)}) does not match total (${total.toFixed(2)})`);
  }

  const now = new Date().toISOString();
  const ref = adminDb.collection('sales').doc();

  const items: SaleItem[] = p.items.map((it) => ({
    id: adminDb.collection('_').doc().id,
    productId: it.productId,
    serviceId: it.serviceId,
    description: it.description,
    quantity: it.quantity,
    unitPrice: round(it.unitPrice),
    discount: round(it.discount || 0),
    total: round(it.total ?? it.quantity * it.unitPrice),
  }));

  const sale: Sale = {
    id: ref.id,
    businessId,
    clientId: p.clientId,
    clientName: p.clientName,
    items,
    payments: p.payments.map((x) => ({ ...x, amount: round(x.amount) })),
    subtotal: round(subtotal),
    discount: round(discount),
    tip: tip ? round(tip) : undefined,
    total: round(total),
    status: p.status && VALID_STATUS.includes(p.status) ? p.status : 'finalizada',
    notes: p.notes?.slice(0, 500),
    operatorId: p.operatorId || 'agent',
    operatorName: p.operatorName || 'Agente IA',
    channelType: p.channelType,
    conversationId: p.conversationId,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(sale);
  return sale;
}

async function cancelSale(businessId: string, id: string, reason?: string): Promise<Sale> {
  if (!id) throw new Error('id required');
  const ref = adminDb.collection('sales').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Sale not found');
  const sale = snap.data() as Sale;
  if (sale.businessId !== businessId) throw new Error('Cross-tenant access denied');
  if (sale.status === 'cancelada') throw new Error('Sale already cancelled');

  const now = new Date().toISOString();
  const notes = reason
    ? `${sale.notes ? `${sale.notes}\n---\n` : ''}[Cancelada ${now.slice(0, 10)}] ${reason.slice(0, 200)}`
    : sale.notes;

  const patch: Partial<Sale> = { status: 'cancelada', notes, updatedAt: now };
  await ref.update(patch);
  return { ...sale, ...patch, id: snap.id };
}

async function summaryToday(businessId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const startOfDay = `${today}T00:00:00.000Z`;
  const endOfDay = `${today}T23:59:59.999Z`;

  const snap = await adminDb
    .collection('sales')
    .where('businessId', '==', businessId)
    .where('createdAt', '>=', startOfDay)
    .where('createdAt', '<=', endOfDay)
    .get();

  let totalRevenue = 0;
  let totalDiscount = 0;
  let totalCount = 0;
  let cancelledCount = 0;
  const byMethod: Record<PaymentMethod | string, number> = {};

  for (const d of snap.docs) {
    const s = d.data() as Sale;
    if (s.status === 'cancelada') {
      cancelledCount += 1;
      continue;
    }
    totalCount += 1;
    totalRevenue += s.total;
    totalDiscount += s.discount || 0;
    for (const pay of s.payments || []) {
      byMethod[pay.method] = (byMethod[pay.method] || 0) + pay.amount;
    }
  }

  return {
    date: today,
    revenue: round(totalRevenue),
    totalDiscount: round(totalDiscount),
    avgTicket: totalCount > 0 ? round(totalRevenue / totalCount) : 0,
    saleCount: totalCount,
    cancelledCount,
    byPaymentMethod: Object.entries(byMethod).map(([method, amount]) => ({ method, amount: round(amount) })).sort((a, b) => b.amount - a.amount),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
