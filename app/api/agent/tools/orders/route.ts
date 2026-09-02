import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { withIdempotency } from '@/lib/contracts/_runtime/idempotency';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type {
  DeliveryOrder, DeliveryOrderItem, DeliveryOrderStatus,
  DeliveryOrderPaymentMethod, DeliveryOrderPaymentStatus, DeliveryType,
  Product, DeliveryOrderAddress, Business,
} from '@/lib/types';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { assertOrdersAcceptedNow } from '@/lib/services/orders/acceptance';
import { createDeliveryOrderWithSideEffects } from '@/lib/services/delivery-order-server';
import { transitionDeliveryOrderAdmin } from '@/lib/services/delivery-order-transition-admin';
import { editDeliveryOrderAdmin } from '@/lib/services/delivery-order-edit-admin';

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
  // deliveryFee/discount removidos (M02.5c): frete sempre por zona, sem
  // desconto manual do agente — decisão de segurança (ver M02_AGENTE_PEDIDOS.md).
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

  // COER-02/R3 — Idempotência: a reentrega da mesma mensagem/tool-call (retry do
  // agente, replay do webhook, timeout+retry) criava um pedido DUPLICADO — novo
  // número sequencial + nova dedução de estoque. Envolvemos a criação em
  // `withIdempotency` (mesmo runtime do cardápio público) com uma chave
  // DETERMINÍSTICA por (businessId, conversação, carrinho): replays devolvem o
  // MESMO pedido sem realocar número nem debitar estoque de novo. Sem messageId
  // nos params, derivamos um hash estável do carrinho (productId+qtd+notes) — dois
  // pedidos idênticos na MESMA conversa dentro do TTL (24h) convergem, tradeoff
  // aceito para eliminar a duplicação por reentrega. `businessId` já é prefixado
  // pelo próprio withIdempotency no docId.
  const cartHash = createHash('sha256')
    .update(JSON.stringify(
      params.items
        .map((i) => [i.productId, i.quantity, i.notes ?? ''] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])),
    ))
    .digest('hex')
    .slice(0, 16);
  const convScope = params.conversationId ?? params.contactExternalId ?? 'noconv';
  const idempotencyKey = `agent-order_${convScope}_${cartHash}`;

  const { result } = await withIdempotency(
    adminDb,
    { businessId, key: idempotencyKey, endpoint: 'POST /api/agent/tools/orders#create' },
    () => createOrderInner(businessId, params, idempotencyKey),
  );
  return result;
}

async function createOrderInner(businessId: string, params: CreateParams, idempotencyKey: string) {
  // Guardrail off-hours (M13): se o business NÃO aceita pedidos fora do horário
  // e está fechado agora, recusa no servidor. `open===null` (sem grade de 7
  // dias) = indeterminado → não bloqueia.
  const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
  const biz = bizSnap.exists ? (bizSnap.data() as Business) : null;
  // COER-01: fonte ÚNICA do guard de horário — o MESMO helper do cardápio público
  // (lib/services/orders/acceptance), evitando drift entre os dois caminhos.
  if (biz) assertOrdersAcceptedNow(biz);

  // M02.5c: preço, modificadores, zona de entrega, estoque e cliente passam a
  // ser resolvidos pelo mesmo núcleo comercial do cardápio público/pedido
  // manual (lib/services/delivery-order-server.ts), canal 'agent'. O agente
  // PERDE a capacidade de aplicar desconto manual ou taxa de entrega fora de
  // zona (decisão de segurança — evita que uma conversa manipule o modelo pra
  // conceder desconto sem revisão humana); endereço fora de área agora é
  // rejeitado, igual ao cardápio público.
  const result = await createDeliveryOrderWithSideEffects({
    businessId,
    clientId: params.clientId,
    clientName: params.clientName,
    clientPhone: params.clientPhone,
    items: params.items.map((item) => ({
      productId: item.productId,
      // Placeholder: o agente nunca teve preço/nome por item pra enviar (só
      // productId/quantity/notes) — sobrescrito pelo snapshot autoritativo da
      // cotação. A checagem de preço obsoleto por item é pulada para o canal
      // 'agent' em delivery-order-server.ts (não há preço real do cliente
      // para comparar).
      productName: item.productId,
      quantity: item.quantity,
      unitPrice: 0,
      total: 0,
      ...(item.notes ? { notes: item.notes } : {}),
    })),
    deliveryType: params.deliveryType,
    deliveryAddress: params.deliveryType === 'entrega' ? params.deliveryAddress : undefined,
    paymentMethod: params.paymentMethod,
    paymentStatus: params.paymentStatus,
    changeFor: params.changeFor,
    customerNotes: params.customerNotes,
    estimatedMinutes: params.estimatedMinutes,
    // Contrato do agente (lib/contracts/api/agent/_shared.ts) tem 'web' como
    // canal possível, que não existe em DeliveryOrderChannelSchema — normaliza
    // pra 'site'. CreateParams não declara 'web' (o runtime não é validado
    // contra o contrato Zod aqui), daí o cast defensivo.
    originChannel: (params.channel as string) === 'web' ? 'site' : (params.channel || 'manual'),
    conversationId: params.conversationId,
    contactExternalId: params.contactExternalId,
    operatorId: 'agent',
    operatorName: 'Agente IA',
    idempotencyKey,
  }, adminDb, {
    channel: 'agent',
    actorType: 'agent',
  });

  return {
    id: result.order.id,
    number: result.orderNumber,
    total: result.total,
    subtotal: result.order.subtotal,
    estimatedDeliveryAt: result.order.estimatedDeliveryAt,
  };
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
  // M02.5d: FSM, gate X1, receita de entrega (com fidelidade — antes ausente
  // neste caminho) e restauro de estoque no cancelamento passam a vir da MESMA
  // função usada pela rota autenticada de pedido manual (OrdersModule).
  const result = await transitionDeliveryOrderAdmin({
    orderId, businessId, targetStatus: status,
    actor: { id: 'agent', name: 'Agente IA', type: 'agent' },
  });
  return { id: orderId, status: result.order.status };
}

async function updateItems(
  businessId: string,
  orderId: string,
  newItems: Array<{ productId: string; quantity: number; notes?: string }>,
) {
  if (!newItems?.length) throw new Error('items required');

  // Resolve preço no catálogo — agente nunca tem preço real pra enviar (mesmo
  // motivo do `create`, ver M02_AGENTE_PEDIDOS.md). Status/estoque/reconciliação
  // ficam por conta de editDeliveryOrderAdmin (fonte única, mesma da UI).
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

  const result = await editDeliveryOrderAdmin({
    db: adminDb,
    orderId,
    businessId,
    patch: { items: resolvedItems },
    actor: { id: 'agent', name: 'Agente IA', type: 'agent' },
  });
  return { id: orderId, itemsCount: result.order.items.length, subtotal: result.order.subtotal, total: result.order.total };
}

async function cancelOrder(businessId: string, orderId: string, reason?: string) {
  const result = await transitionDeliveryOrderAdmin({
    orderId, businessId, targetStatus: 'cancelado', reason,
    actor: { id: 'agent', name: 'Agente IA', type: 'agent' },
  });
  return { id: orderId, status: result.order.status };
}

async function listRecent(businessId: string, limit: number) {
  const snap = await adminDb.collection('deliveryOrders')
    .where('businessId', '==', businessId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => ({ ...(d.data() as DeliveryOrder), id: d.id }));
}
