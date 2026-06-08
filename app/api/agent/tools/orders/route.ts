import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type {
  DeliveryOrder, DeliveryOrderItem, DeliveryOrderStatus,
  DeliveryOrderPaymentMethod, DeliveryOrderPaymentStatus, DeliveryType,
  Product, DeliveryOrderAddress,
} from '@/lib/types';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { deductStockAdmin } from '@/lib/services/stock-admin';
import { assertTransitionDeliveryOrder } from '@/lib/contracts/fsm/deliveryOrder';

// ─── Action schemas ──────────────────────────────────────────────────────────

type Action =
  | 'create'
  | 'get'
  | 'list_by_client'
  | 'update_status'
  | 'update_items'
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
      case 'update_items':
        return NextResponse.json({ ok: true, data: await updateItems(
          businessId,
          body.params.id as string,
          body.params.items as Array<{ productId: string; quantity: number; notes?: string }>,
        ) });
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

  // Validate products exist & are deliverable, compute prices, pre-check stock (incl BOM)
  const productRefs = await Promise.all(
    params.items.map(i => adminDb.collection('products').doc(i.productId).get()),
  );
  const productIndex = new Map<string, Product>();
  for (let i = 0; i < params.items.length; i++) {
    const snap = productRefs[i];
    if (snap.exists) productIndex.set(snap.id, snap.data() as Product);
  }

  // Stock validation — expands BOM and sums totals per leaf SKU
  const stockBucket = new Map<string, number>();
  for (let i = 0; i < params.items.length; i++) {
    const line = params.items[i];
    const product = productIndex.get(line.productId);
    if (!product) throw new Error(`Produto não encontrado: ${line.productId}`);
    if (product.components && product.components.length > 0) {
      for (const comp of product.components) {
        stockBucket.set(comp.productId, (stockBucket.get(comp.productId) || 0) + comp.quantity * line.quantity);
      }
    } else {
      stockBucket.set(product.id, (stockBucket.get(product.id) || 0) + line.quantity);
    }
  }
  // Fetch any leaf products that aren't already in the index
  const missingLeafIds = Array.from(stockBucket.keys()).filter(id => !productIndex.has(id));
  if (missingLeafIds.length > 0) {
    const extra = await Promise.all(
      missingLeafIds.map(id => adminDb.collection('products').doc(id).get()),
    );
    extra.forEach(s => { if (s.exists) productIndex.set(s.id, s.data() as Product); });
  }
  const shortages: string[] = [];
  for (const [pid, qty] of stockBucket.entries()) {
    const prod = productIndex.get(pid);
    if (!prod) continue;
    if ((prod.currentStock || 0) < qty) {
      shortages.push(`${prod.name} (pedido: ${qty}, disponível: ${prod.currentStock || 0})`);
    }
  }
  if (shortages.length > 0) {
    throw new Error(`Estoque insuficiente: ${shortages.join('; ')}`);
  }

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

  // P1.7: dedução atômica de estoque ANTES de persistir o pedido. deductStockAdmin
  // roda em runTransaction única (lê o estoque real dentro da tx → sem oversell por
  // concorrência) e grava um doc em stockMovements por SKU folha (trilha de auditoria).
  // Se a dedução falhar, a exceção propaga e o pedido NÃO é criado (abort) — em vez do
  // comportamento antigo de salvar o pedido e só logar a falha. O productIndex já tem
  // os produtos top-level + folhas de BOM; passamos as linhas top-level e o serviço
  // expande o BOM internamente (mesma expansão usada na pré-checagem acima).
  const stockLines = params.items.map((line) => ({ productId: line.productId, quantity: line.quantity }));
  await deductStockAdmin(adminDb, stockLines, {
    businessId,
    operatorId: 'agent',
    operatorName: 'Agente IA',
    reason: `Pedido #${number}`,
    productIndex,
  });

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
    stockDeductedAt: now,
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
  // R4/P1.9: bloqueia pulos de estado (ex: recebido→entregue) antes do write.
  assertTransitionDeliveryOrder(data.status, status);

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updatedAt: now };
  if (status === 'entregue') {
    patch.deliveredAt = now;
    // Receita de delivery → Transaction (idempotente via data.transactionId).
    // Mantém consistência com OrdersModule.handleStatusChange + PDV (saleId).
    if (!data.transactionId) {
      const txRef = adminDb.collection('transactions').doc();
      await txRef.set({
        businessId,
        type: 'receita',
        category: 'Vendas',
        description: `Pedido #${data.number}${data.clientName ? ` - ${data.clientName}` : ''}`,
        amount: data.total,
        dueDate: now.split('T')[0],
        paymentDate: now.split('T')[0],
        status: 'pago',
        clientId: data.clientId || null,
        contactId: data.clientId || null,
        clientName: data.clientName || null,
        deliveryOrderId: orderId,
        paymentMethod: data.paymentMethod || null,
        createdAt: now,
        updatedAt: now,
      });
      patch.transactionId = txRef.id;
    }
  }
  await ref.update(patch);
  return { id: orderId, status };
}

async function updateItems(
  businessId: string,
  orderId: string,
  newItems: Array<{ productId: string; quantity: number; notes?: string }>,
) {
  if (!newItems?.length) throw new Error('items required');

  const ref = adminDb.collection('deliveryOrders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Pedido não encontrado');
  const existing = snap.data() as DeliveryOrder;
  if (existing.businessId !== businessId) throw new Error('Cross-tenant access denied');

  // Only allow item edits before the kitchen starts
  if (existing.status === 'preparando' || existing.status === 'pronto' || existing.status === 'saiu_entrega' || existing.status === 'entregue') {
    throw new Error(`Não é possível editar itens — pedido já está com status "${existing.status}"`);
  }
  // Block if stock was already deducted (defense in depth)
  if (existing.stockDeductedAt) {
    throw new Error('Itens não podem ser alterados após dedução de estoque');
  }

  // Resolve new items + recompute totals
  const productRefs = await Promise.all(
    newItems.map(i => adminDb.collection('products').doc(i.productId).get()),
  );
  const resolvedItems: DeliveryOrderItem[] = [];
  for (let i = 0; i < newItems.length; i++) {
    const line = newItems[i];
    const s = productRefs[i];
    if (!s.exists) throw new Error(`Produto não encontrado: ${line.productId}`);
    const p = s.data() as Product;
    if (p.businessId !== businessId) throw new Error('Cross-tenant product access denied');
    if (!p.isDeliverable) throw new Error(`Produto "${p.name}" não está no cardápio`);
    resolvedItems.push({
      productId: s.id,
      productName: p.name,
      quantity: line.quantity,
      unitPrice: p.salePrice,
      total: p.salePrice * line.quantity,
      ...(line.notes ? { notes: line.notes } : {}),
      ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
    });
  }

  const subtotal = resolvedItems.reduce((s, i) => s + i.total, 0);
  const total = Math.max(0, subtotal + (existing.deliveryFee || 0) - (existing.discount || 0));
  await ref.update({
    items: resolvedItems,
    subtotal,
    total,
    updatedAt: new Date().toISOString(),
  });
  return { id: orderId, itemsCount: resolvedItems.length, subtotal, total };
}

async function cancelOrder(businessId: string, orderId: string, reason?: string) {
  const ref = adminDb.collection('deliveryOrders').doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Order not found');
  const data = snap.data() as DeliveryOrder;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  // R4/P1.9: cancelar só a partir de estado não-terminal (entregue/cancelado bloqueiam).
  assertTransitionDeliveryOrder(data.status, 'cancelado');

  const now = new Date().toISOString();
  await ref.update({
    status: 'cancelado',
    internalNotes: reason ? `${data.internalNotes ? data.internalNotes + ' · ' : ''}Cancelado: ${reason}` : data.internalNotes,
    updatedAt: now,
  });

  // Restore stock if it had been deducted when the order was created
  if ((data as DeliveryOrder & { stockDeductedAt?: string }).stockDeductedAt) {
    try {
      const restoreBucket = await buildStockBucket(data.items);
      const batch = adminDb.batch();
      for (const [pid, qty] of restoreBucket.entries()) {
        batch.update(adminDb.collection('products').doc(pid), {
          currentStock: FieldValue.increment(qty),
          updatedAt: now,
        });
      }
      await batch.commit();
    } catch (stockErr) {
      console.error('[orders/cancel] stock restore failed:', stockErr);
    }
  }

  return { id: orderId, status: 'cancelado' };
}

async function buildStockBucket(items: DeliveryOrderItem[]): Promise<Map<string, number>> {
  const bucket = new Map<string, number>();
  const productSnaps = await Promise.all(items.map(i => adminDb.collection('products').doc(i.productId).get()));
  const productIndex = new Map<string, Product>();
  productSnaps.forEach(s => { if (s.exists) productIndex.set(s.id, s.data() as Product); });

  // Fetch any BOM leaf products not in the top-level set
  const leafIds = new Set<string>();
  for (const item of items) {
    const p = productIndex.get(item.productId);
    if (p?.components?.length) p.components.forEach(c => leafIds.add(c.productId));
  }
  const missing = Array.from(leafIds).filter(id => !productIndex.has(id));
  if (missing.length > 0) {
    const extra = await Promise.all(missing.map(id => adminDb.collection('products').doc(id).get()));
    extra.forEach(s => { if (s.exists) productIndex.set(s.id, s.data() as Product); });
  }

  for (const item of items) {
    const p = productIndex.get(item.productId);
    if (!p) continue;
    if (p.components?.length) {
      for (const comp of p.components) {
        bucket.set(comp.productId, (bucket.get(comp.productId) || 0) + comp.quantity * item.quantity);
      }
    } else {
      bucket.set(p.id, (bucket.get(p.id) || 0) + item.quantity);
    }
  }
  return bucket;
}

async function listRecent(businessId: string, limit: number) {
  const snap = await adminDb.collection('deliveryOrders')
    .where('businessId', '==', businessId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => ({ ...(d.data() as DeliveryOrder), id: d.id }));
}
