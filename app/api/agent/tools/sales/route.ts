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
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody, resolveClientId } from '@/lib/agent/auth';
import { createSaleWithSideEffects } from '@/lib/services/sales-server';
import { assertTransitionSale } from '@/lib/contracts/fsm/sale';
import type { Sale, SaleItem, Payment, PaymentMethod } from '@/lib/types';

type Action = 'list' | 'get' | 'list_by_client' | 'create' | 'cancel' | 'summary_today';
type SaleStatus = 'aberta' | 'finalizada' | 'cancelada';

interface CreateParams {
  idempotencyKey?: string;
  clientId?: string;
  // Aliases aceitos no boundary (P2.10) — normalizados pra clientId via resolveClientId.
  contactId?: string;
  crmContactId?: string;
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
  // FKs de resultado (P2.10) — origem conhecida que esta venda concretizou.
  dealId?: string;
  appointmentId?: string;
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

  // P1.2/P1.8: delega ao serviço único (Sale + Transaction de receita +
  // StockMovements + comissão), com idempotência determinística embutida —
  // antes este caminho só fazia `ref.set(sale)` (estoque inflado, sem receita,
  // duplicava em retry). `discount`/`tip`/`total` são derivados pelo serviço
  // a partir dos itens; subtotal/total enviados pelo agent são ignorados de
  // propósito (o serviço é a fonte canônica desses números).
  const result = await createSaleWithSideEffects({
    businessId,
    clientId: resolveClientId(p),
    clientName: p.clientName,
    items: p.items.map((it) => ({
      productId: it.productId,
      serviceId: it.serviceId,
      variantId: it.variantId,
      description: it.description,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discount: it.discount || 0,
      total: it.total,
      basePrice: it.basePrice,
      selectedModifiers: it.selectedModifiers,
      notes: it.notes,
    })),
    payments: p.payments.map((x) => ({
      method: x.method,
      amount: x.amount,
      installments: x.installments,
      cardBrand: x.cardBrand,
      dueDate: x.dueDate,
    })),
    discount: typeof p.discount === 'number' ? p.discount : 0,
    tip: typeof p.tip === 'number' ? p.tip : undefined,
    status: p.status && VALID_STATUS.includes(p.status) ? p.status : 'finalizada',
    notes: p.notes?.slice(0, 500),
    channelType: p.channelType,
    conversationId: p.conversationId,
    operatorId: p.operatorId || 'agent',
    operatorName: p.operatorName || 'Agente IA',
    ...(p.dealId ? { dealId: p.dealId } : {}),
    ...(p.appointmentId ? { appointmentId: p.appointmentId } : {}),
    ...(p.idempotencyKey ? { idempotencyKey: p.idempotencyKey } : {}),
  }, adminDb, {
    channel: 'agent',
    actorType: 'agent',
    canApplyManualDiscount: true,
    commissionRate: 0,
  });

  return result.sale;
}

async function cancelSale(businessId: string, id: string, reason?: string): Promise<Sale> {
  if (!id) throw new Error('id required');
  const ref = adminDb.collection('sales').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Sale not found');
  const sale = snap.data() as Sale;
  if (sale.businessId !== businessId) throw new Error('Cross-tenant access denied');
  // R4/P1.9: FSM cobre o antigo guard "já cancelada" e bloqueia origens inválidas.
  assertTransitionSale(sale.status, 'cancelada');

  const now = new Date().toISOString();
  const notes = reason
    ? `${sale.notes ? `${sale.notes}\n---\n` : ''}[Cancelada ${now.slice(0, 10)}] ${reason.slice(0, 200)}`
    : sale.notes;

  // Fase 5b: grava audit trail do cancelamento. Agent nao tem `user` —
  // usa identificador agente (operatorId stays = autor original da venda).
  const patch: Partial<Sale> = {
    status: 'cancelada',
    notes,
    cancelledAt: now,
    cancelledBy: 'agent',
    cancelledByName: 'IA agente',
    updatedAt: now,
  };
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
