import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type {
  DeliveryOrder, DeliveryOrderItem, DeliveryOrderStatus,
  DeliveryOrderPaymentMethod, DeliveryOrderPaymentStatus, DeliveryType,
  Product, DeliveryOrderAddress,
} from '@/lib/types';
import { Timestamp } from 'firebase-admin/firestore';

// ─── Action schemas ──────────────────────────────────────────────────────────

type Action =
  | 'create'
  | 'get'
  | 'list_by_client'
  | 'update_status'
  | 'cancel'
  | 'list_recent';

interface CreateParams {
  clientName: string;
  clientPhone?: string;
  clientId?: string;
  items: Array<{ productId: string; quantity: number; notes?: string }>;
  deliveryType: DeliveryType;
  deliveryAddress?: DeliveryOrderAddress;
  deliveryFee?: number;
  discount?: number;
  paymentMethod?: DeliveryOrderPaymentMethod;
  paymentStatus?: DeliveryOrderPaymentStatus;
  changeFor?: number;
  customerNotes?: string;
  estimatedMinutes?: number;
  // provenance
  channel?: 'whatsapp' | 'facebook' | 'instagram' | 'manual' | 'site';
  conversationId?: string;
  contactExternalId?: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

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
      case 'create':
        return NextResponse.json({ ok: true, data: await createOrder(businessId, body.params as unknown as CreateParams) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getOrder(businessId, body.params.id as string) });
      case 'list_by_client':
        return NextResponse.json({ ok: true, data: await listByClient(businessId, (body.params.clientId || body.params.phone) as string, (body.params.limit as number) || 10) });
      case 'update_status':
        return NextResponse.json({ ok: true, data: await updateStatus(businessId, body.params.id as string, body.params.status as DeliveryOrderStatus) });
      case 'cancel':
        return NextResponse.json({ ok: true, data: await cancelOrder(businessId, body.params.id as string, body.params.reason as string | undefined) });
      case 'list_recent':
        return NextResponse.json({ ok: true, data: await listRecent(businessId, (body.params.limit as number) || 20) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent/tools/orders]', body.action, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ─── Implementations ─────────────────────────────────────────────────────────

async function createOrder(businessId: string, params: CreateParams) {
  if (!params.clientName) throw new Error('clientName required');
  if (!params.items?.length) throw new Error('items required');

  // Validate products exist & are deliverable, compute prices
  const productRefs = await Promise.all(
    params.items.map(i => adminDb.collection('products').doc(i.productId).get()),
  );
  const resolvedItems: DeliveryOrderItem[] = [];
  for (let i = 0; i < params.items.length; i++) {
    const line = params.items[i];
    const snap = productRefs[i];
    if (!snap.exists) throw new Error(`Product ${line.productId} not found`);
    const p = snap.data() as Product;
    if (p.businessId !== businessId) throw new Error('Cross-tenant product access denied');
    if (!p.isDeliverable) throw new Error(`Product "${p.name}" is not on the menu`);
    resolvedItems.push({
      productId: snap.id,
      productName: p.name,
      quantity: line.quantity,
      unitPrice: p.salePrice,
      total: p.salePrice * line.quantity,
      ...(line.notes ? { notes: line.notes } : {}),
      ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
    });
  }

  const subtotal = resolvedItems.reduce((s, i) => s + i.total, 0);
  const total = Math.max(0, subtotal + (params.deliveryFee || 0) - (params.discount || 0));

  // Sequential order number per business
  const counterRef = adminDb.collection('businesses').doc(businessId).collection('counters').doc('deliveryOrder');
  const number = await adminDb.runTransaction(async (t) => {
    const snap = await t.get(counterRef);
    const current = (snap.data()?.lastNumber as number | undefined) || 0;
    const next = current + 1;
    t.set(counterRef, { lastNumber: next }, { merge: true });
    return next;
  });

  const now = new Date().toISOString();
  const estimatedDeliveryAt = new Date(Date.now() + (params.estimatedMinutes || 45) * 60000).toISOString();

  const doc: Omit<DeliveryOrder, 'id'> = {
    businessId,
    number,
    status: 'recebido',
    clientId: params.clientId,
    clientName: params.clientName.trim(),
    clientPhone: params.clientPhone,
    channel: params.channel || 'manual',
    conversationId: params.conversationId,
    contactExternalId: params.contactExternalId,
    items: resolvedItems,
    subtotal,
    deliveryFee: params.deliveryFee,
    discount: params.discount,
    total,
    deliveryType: params.deliveryType,
    deliveryAddress: params.deliveryType === 'entrega' ? params.deliveryAddress : undefined,
    paymentMethod: params.paymentMethod,
    paymentStatus: params.paymentStatus || 'pendente',
    changeFor: params.changeFor,
    customerNotes: params.customerNotes,
    estimatedDeliveryAt,
    createdAt: now,
    updatedAt: now,
  };
  const cleaned = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
  const ref = await adminDb.collection('deliveryOrders').add(cleaned);

  return { id: ref.id, number, total, subtotal, estimatedDeliveryAt };
}

async function getOrder(businessId: string, orderId: string) {
  const snap = await adminDb.collection('deliveryOrders').doc(orderId).get();
  if (!snap.exists) throw new Error('Order not found');
  const data = snap.data() as DeliveryOrder;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: snap.id };
}

async function listByClient(businessId: string, lookupKey: string, limit: number) {
  // Look up by clientId first, fallback to phone match
  let q = adminDb.collection('deliveryOrders')
    .where('businessId', '==', businessId)
    .where('clientId', '==', lookupKey)
    .orderBy('createdAt', 'desc')
    .limit(limit);
  let snap = await q.get();

  if (snap.empty) {
    q = adminDb.collection('deliveryOrders')
      .where('businessId', '==', businessId)
      .where('clientPhone', '==', lookupKey)
      .orderBy('createdAt', 'desc')
      .limit(limit);
    snap = await q.get();
  }
  return snap.docs.map(d => ({ ...(d.data() as DeliveryOrder), id: d.id }));
}

async function updateStatus(businessId: string, orderId: string, status: DeliveryOrderStatus) {
  const ref = adminDb.collection('deliveryOrders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Order not found');
  const data = snap.data() as DeliveryOrder;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const patch: Record<string, unknown> = { status, updatedAt: new Date().toISOString() };
  if (status === 'entregue') patch.deliveredAt = new Date().toISOString();
  await ref.update(patch);
  return { id: orderId, status };
}

async function cancelOrder(businessId: string, orderId: string, reason?: string) {
  const ref = adminDb.collection('deliveryOrders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Order not found');
  const data = snap.data() as DeliveryOrder;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');

  await ref.update({
    status: 'cancelado',
    internalNotes: reason ? `${data.internalNotes ? data.internalNotes + ' · ' : ''}Cancelado: ${reason}` : data.internalNotes,
    updatedAt: new Date().toISOString(),
  });
  return { id: orderId, status: 'cancelado' };
}

async function listRecent(businessId: string, limit: number) {
  const snap = await adminDb.collection('deliveryOrders')
    .where('businessId', '==', businessId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => ({ ...(d.data() as DeliveryOrder), id: d.id }));
}
