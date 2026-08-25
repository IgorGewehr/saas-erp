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
import { deductStockAdmin } from '@/lib/services/stock-admin';
import { assertTransitionDeliveryOrder } from '@/lib/contracts/fsm/deliveryOrder';
import { allocateOrderNumberAdmin } from '@/lib/services/orderNumber';
import { restoreOrderStockRecoverable } from '@/lib/services/order-stock-restore';
import { recordClientPurchaseAdmin } from '@/lib/services/clients/recordPurchase';
import { resolveClientIdentityAdmin } from '@/lib/services/clients/resolveIdentity';
import { assertOrdersAcceptedNow } from '@/lib/services/orders/acceptance';

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
    () => createOrderInner(businessId, params),
  );
  return result;
}

async function createOrderInner(businessId: string, params: CreateParams) {
  // Guardrail off-hours (M13): se o business NÃO aceita pedidos fora do horário
  // e está fechado agora, recusa no servidor. Antes o flag só "torcia" pro LLM
  // recusar (prompt) — a tool criava o pedido a qualquer hora. `open===null`
  // (sem grade de 7 dias) = indeterminado → não bloqueia.
  const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
  const biz = bizSnap.exists ? (bizSnap.data() as Business) : null;
  // COER-01: fonte ÚNICA do guard de horário — o MESMO helper do cardápio público
  // (lib/services/orders/acceptance), evitando drift entre os dois caminhos.
  if (biz) assertOrdersAcceptedNow(biz);

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
    // "Não controlar estoque" (trackStock===false): fora do pré-check e da dedução.
    if (product.trackStock === false) continue;
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
    // Alinha ao cardápio público (orders/public): produto desativado não vende.
    if (p.isActive === false) throw new Error(`Produto "${p.name}" está desativado`);
    if (!p.isDeliverable) throw new Error(`Product "${p.name}" is not on the menu`);
    if (p.menuAvailable === false) throw new Error(`Produto "${p.name}" está indisponível hoje`);
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

  // Numeração: fonte ÚNICA (business.lastOrderNumber), compartilhada com a UI
  // (OrdersModule) e o cardápio público (orders/public). Antes este canal usava
  // um contador SEPARADO (counters/deliveryOrder) → números colidiam entre canais.
  const number = await allocateOrderNumberAdmin(adminDb, businessId);
  const orderRef = adminDb.collection('deliveryOrders').doc();

  const now = new Date().toISOString();
  const estimatedDeliveryAt = new Date(Date.now() + (params.estimatedMinutes || 45) * 60000).toISOString();

  // P1.7: dedução atômica de estoque ANTES de persistir o pedido. deductStockAdmin
  // roda em runTransaction única (lê o estoque real dentro da tx → sem oversell por
  // concorrência) e grava um doc em stockMovements por SKU folha (trilha de auditoria).
  // Se a dedução falhar, a exceção propaga e o pedido NÃO é criado (abort) — em vez do
  // comportamento antigo de salvar o pedido e só logar a falha. O productIndex já tem
  // os produtos top-level + folhas de BOM; passamos as linhas top-level e o serviço
  // expande o BOM internamente (mesma expansão usada na pré-checagem acima).
  const stockLines = params.items
    .filter((line) => productIndex.get(line.productId)?.trackStock !== false)
    .map((line) => ({ productId: line.productId, quantity: line.quantity }));
  await deductStockAdmin(adminDb, stockLines, {
    businessId,
    operatorId: 'agent',
    operatorName: 'Agente IA',
    sourceType: 'order',
    sourceId: orderRef.id,
    sourceDocument: { collection: 'deliveryOrders', id: orderRef.id, existence: 'if-present' },
    idempotencyKey: `order:${orderRef.id}:deduct`,
    reason: `Pedido #${number}`,
    productIndex,
    negativeStockPolicy: 'prevent',
  });

  // Identidade canônica do cliente quando veio só o telefone (sem clientId):
  // dedup compartilhado com cardápio/PDV + garante clientId no pedido pra a
  // entrega registrar a compra (recordClientPurchase precisa dele). Best-effort.
  let resolvedClientId = params.clientId;
  if (!resolvedClientId && params.clientPhone) {
    try {
      const r = await resolveClientIdentityAdmin({ db: adminDb, businessId, phone: params.clientPhone, name: params.clientName });
      resolvedClientId = r.clientId ?? undefined;
    } catch (e) {
      console.warn('[orders/create] resolveClientIdentity falhou:', e);
    }
  }

  const doc: Omit<DeliveryOrder, 'id'> = {
    businessId,
    number,
    status: 'recebido',
    clientId: resolvedClientId,
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
  await orderRef.set(cleaned);

  return { id: orderRef.id, number, total, subtotal, estimatedDeliveryAt };
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

  if (status === 'entregue') {
    // Receita de delivery → Transaction com ID DETERMINÍSTICO {orderId}_revenue,
    // gravada de forma idempotente numa runTransaction com CAS em transactionId
    // (mesmo padrão de sales-server `${saleId}_revenue`). O ID estável + o guard
    // CAS garantem que entregar pela tool do agente, pela UI (OrdersModule) ou
    // pelo fluxo de pagamento online aprovado NUNCA duplica a receita: todos
    // convergem para o mesmo doc. status/deliveredAt e a FK transactionId são
    // escritos na MESMA transação (atômico).
    //
    // X1-gate: pagamento online (paymentProvider definido — dinheiro regido pela
    // FSM de pagamento) só vira receita 'pago' quando a FSM confirma
    // (paymentFsmStatus === 'paid'). Entregar um pedido online ainda não pago NÃO
    // lança receita aqui — o dinheiro não entrou; a receita será lançada pelo
    // fluxo de aprovação do pagamento usando o MESMO ID determinístico.
    const txRef = adminDb.collection('transactions').doc(`${orderId}_revenue`);
    let revenueRecognized = false;
    let purchaseClientId: string | undefined;
    let purchaseAmount = 0;
    let purchaseCountVisit = true;
    await adminDb.runTransaction(async (t) => {
      const cur = await t.get(ref);
      if (!cur.exists) throw new Error('Order not found');
      const curData = cur.data() as DeliveryOrder;
      const orderPatch: Record<string, unknown> = { status, deliveredAt: now, updatedAt: now };

      const isOnlinePayment = !!curData.paymentProvider;
      const onlineUnpaid = isOnlinePayment && curData.paymentFsmStatus !== 'paid';

      // F2 — gate pagamento→entrega (espelha a UI): pedido online ainda NÃO pago
      // NÃO pode ser entregue — aborta antes de mudar o status (antes só pulava a
      // receita mas marcava 'entregue', criando receita pendente fantasma/assimetria).
      if (onlineUnpaid) {
        throw new Error('Pedido com pagamento online ainda não confirmado — só pode ser entregue após o pagamento aprovar.');
      }

      revenueRecognized = true;
      purchaseClientId = curData.clientId;
      purchaseAmount = curData.total;
      // CLI-1 — 'site' (cardápio público) já contou a visita na criação; não recontar.
      purchaseCountVisit = curData.channel !== 'site';

      // CAS em transactionId: só lança se ainda não houver receita E o gate online passar.
      if (!curData.transactionId && !onlineUnpaid) {
        t.set(txRef, {
          businessId,
          type: 'receita',
          category: 'Vendas',
          description: `Pedido #${curData.number}${curData.clientName ? ` - ${curData.clientName}` : ''}`,
          amount: curData.total,
          dueDate: now.split('T')[0],
          paymentDate: now.split('T')[0],
          status: 'pago',
          clientId: curData.clientId || null,
          contactId: curData.clientId || null,
          clientName: curData.clientName || null,
          deliveryOrderId: orderId,
          paymentMethod: curData.paymentMethod || null,
          createdAt: now,
          updatedAt: now,
        });
        orderPatch.transactionId = txRef.id;
      }
      t.update(ref, orderPatch);
    });

    // Atribui a compra à ficha do cliente — espelha a receita acima e o fluxo da UI
    // (OrdersModule). Idempotente por clients/{clientId}/purchases/{orderId}, então
    // entregar pela tool, pela UI ou pelo fluxo de pagamento converge num único
    // registro. countVisit default (true): o createOrder do agente não conta visita
    // na origem (≠ cardápio público, que conta na criação). Side-effect: falha aqui
    // não reverte a entrega — apenas loga, como no estorno de estoque.
    if (revenueRecognized && purchaseClientId) {
      try {
        await recordClientPurchaseAdmin({
          db: adminDb,
          businessId,
          clientId: purchaseClientId,
          sourceId: orderId,
          amount: purchaseAmount,
          countVisit: purchaseCountVisit,
        });
      } catch (purchaseErr) {
        console.error('[orders/updateStatus] recordClientPurchase failed:', purchaseErr);
      }
    }
    return { id: orderId, status };
  }

  // Cancelamento via updateStatus também restaura estoque (mesmo helper único do
  // cancelOrder) — antes este catch-all marcava 'cancelado' sem devolver estoque.
  if (status === 'cancelado' && data.stockDeductedAt) {
    try {
      await restoreOrderStockRecoverable(orderId, businessId, {
        operatorName: 'Agente (cancelamento)',
        context: 'pedido cancelado',
      });
    } catch (stockErr) {
      console.error('[orders/updateStatus] stock restore failed:', stockErr);
    }
  }
  await ref.update({ status, updatedAt: now });
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

  // Restaura estoque (se debitado na criação) via helper ÚNICO recuperável: claim
  // distinguível anti duplo-restauro + linhas COM insumos de modificadores. O
  // buildStockBucket antigo ignorava modificadores (subcontagem) e não tinha guard
  // de claim (duplo-restauro após cron/webhook).
  if (data.stockDeductedAt) {
    try {
      await restoreOrderStockRecoverable(orderId, businessId, {
        operatorName: 'Agente (cancelamento)',
        context: 'pedido cancelado',
      });
    } catch (stockErr) {
      console.error('[orders/cancel] stock restore failed:', stockErr);
    }
  }

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
