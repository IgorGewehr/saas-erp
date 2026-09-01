/**
 * Transição de status server-side de DeliveryOrder (M02.5d).
 *
 * Fonte ÚNICA das transições que hoje eram implementadas de forma duplicada em
 * OrdersModule.tsx (client SDK) e app/api/agent/tools/orders/route.ts (admin
 * SDK). Mercado Pago (webhook-settle.ts, crons) fica de fora — nunca muda
 * `status` (só `paymentFsmStatus`) e já reusa `restoreOrderStockRecoverable`.
 *
 * Efeitos centralizados:
 *   - `entregue`: gate X1 (pedido online exige pagamento confirmado), receita
 *     idempotente (transactions/{orderId}_revenue, CAS em transactionId),
 *     registro de compra do cliente e acúmulo de fidelidade.
 *   - `cancelado`: restauro de estoque via restoreOrderStockRecoverable (já
 *     resolve BOM/insumos de modificador em 3 passes — a versão client
 *     (OrdersModule) não fazia essa resolução).
 *   - demais transições: dedução de estoque ao entrar em `preparando` só para
 *     pedidos legados sem `stockDeductedAt` (pedidos criados pelos adaptadores
 *     M02.5a/b/c já saem de `recebido` com estoque deduzido na criação).
 */

import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { assertTransitionDeliveryOrder } from '@/lib/contracts/fsm/deliveryOrder';
import { restoreOrderStockRecoverable } from '@/lib/services/order-stock-restore';
import { recordClientPurchaseAdmin } from '@/lib/services/clients/recordPurchase';
import { addLoyaltyPointsAdmin, calculateEarnedPoints } from '@/lib/services/loyalty';
import { buildOrderStockLines } from '@/lib/services/stock-lines';
import { loadProductIndex } from '@/lib/services/stock-admin';
import { applyStockOperationAdmin } from '@/lib/services/stock-core-admin';
import type {
  DeliveryOrder, DeliveryOrderStatus, StockAlert, ConversationChannel, LoyaltyConfig,
} from '@/lib/types';

export class DeliveryOrderTransitionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeliveryOrderTransitionError';
  }
}

export interface DeliveryOrderTransitionActor {
  id: string;
  name: string;
  type: 'user' | 'agent';
}

export interface DeliveryOrderTransitionResult {
  order: DeliveryOrder;
  stockApplied: boolean;
  revenueBooked: boolean;
  stockAlerts: StockAlert[];
}

function isOnlineOrder(order: DeliveryOrder): boolean {
  return order.paymentProvider === 'mercadopago'
    || (typeof order.paymentMethod === 'string' && order.paymentMethod.endsWith('_online'));
}

function loyaltyConfig(raw: unknown): LoyaltyConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Partial<LoyaltyConfig>;
  if (
    value.isEnabled !== true
    || typeof value.pointsPerReal !== 'number'
    || typeof value.pointValueInCentavos !== 'number'
    || typeof value.minPointsToRedeem !== 'number'
  ) return undefined;
  return value as LoyaltyConfig;
}

/**
 * Lança a receita de entrega de forma idempotente (mesmo padrão de
 * sales-server.ts: CAS em transactionId dentro de uma única transação) e, só
 * na execução que efetivamente lançou a receita, registra a compra do cliente
 * e acumula fidelidade — ambos best-effort (não derrubam a entrega já
 * efetivada se falharem).
 */
async function bookDeliveryRevenueAdmin(
  db: Firestore,
  businessId: string,
  orderId: string,
  now: Date,
): Promise<boolean> {
  const orderRef = db.collection('deliveryOrders').doc(orderId);
  const txRef = db.collection('transactions').doc(`${orderId}_revenue`);
  const nowIso = now.toISOString();

  let bookedNow = false;
  let purchaseClientId: string | undefined;
  let purchaseClientName: string | undefined;
  let purchaseAmount = 0;
  let purchaseCountVisit = true;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new DeliveryOrderTransitionError('ORDER_NOT_FOUND', 'Pedido não encontrado.');
    const data = snap.data() as DeliveryOrder;
    if (isOnlineOrder(data) && data.paymentFsmStatus !== 'paid') {
      throw new DeliveryOrderTransitionError('ONLINE_UNPAID', 'Pedido online ainda não foi pago — não é possível entregar.');
    }

    purchaseClientId = data.clientId || undefined;
    purchaseClientName = data.clientName || undefined;
    purchaseAmount = data.total;
    purchaseCountVisit = data.channel !== 'site';

    const patch: Record<string, unknown> = { status: 'entregue', deliveredAt: nowIso, updatedAt: nowIso };
    if (!data.transactionId) {
      tx.set(txRef, {
        businessId,
        type: 'receita',
        category: 'Vendas',
        description: `Pedido #${data.number}${data.clientName ? ` - ${data.clientName}` : ''}`,
        amount: data.total,
        dueDate: nowIso.split('T')[0],
        paymentDate: nowIso.split('T')[0],
        status: 'pago',
        clientId: data.clientId || null,
        contactId: data.clientId || null,
        clientName: data.clientName || null,
        deliveryOrderId: orderId,
        paymentMethod: data.paymentMethod || null,
        ...(data.channel && (['whatsapp', 'facebook', 'instagram'] as string[]).includes(data.channel)
          ? { channelType: data.channel as ConversationChannel }
          : {}),
        ...(data.sectorId ? { sectorId: data.sectorId } : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      patch.transactionId = txRef.id;
      bookedNow = true;
    }
    tx.update(orderRef, patch);
  });

  if (purchaseClientId) {
    try {
      await recordClientPurchaseAdmin({
        db, businessId, clientId: purchaseClientId, sourceId: orderId,
        amount: purchaseAmount, countVisit: purchaseCountVisit,
      });
    } catch (err) {
      console.warn('[DeliveryOrderTransition] recordClientPurchase failed:', err);
    }
  }

  if (bookedNow && purchaseClientId) {
    try {
      const bizSnap = await db.collection('businesses').doc(businessId).get();
      const config = loyaltyConfig(bizSnap.data()?.settings?.loyalty);
      if (config) {
        const earned = calculateEarnedPoints(purchaseAmount, config);
        if (earned > 0) {
          await addLoyaltyPointsAdmin(db, {
            businessId,
            clientId: purchaseClientId,
            clientName: purchaseClientName || '',
            pointsEarned: earned,
            config,
            sourceId: orderId,
            sourceType: 'order',
            description: `Pedido #${orderId}`,
          });
        }
      }
    } catch (err) {
      console.warn('[DeliveryOrderTransition] loyalty accrual failed:', err);
    }
  }

  return bookedNow;
}

export async function transitionDeliveryOrderAdmin(params: {
  db?: Firestore;
  orderId: string;
  businessId: string;
  targetStatus: DeliveryOrderStatus;
  actor: DeliveryOrderTransitionActor;
  reason?: string;
  now?: Date;
}): Promise<DeliveryOrderTransitionResult> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const orderRef = db.collection('deliveryOrders').doc(params.orderId);

  const snapshot = await orderRef.get();
  if (!snapshot.exists) throw new DeliveryOrderTransitionError('ORDER_NOT_FOUND', 'Pedido não encontrado.');
  const order = { id: snapshot.id, ...snapshot.data() } as DeliveryOrder;
  if (order.businessId !== params.businessId) {
    throw new DeliveryOrderTransitionError('TENANT_MISMATCH', 'Pedido pertence a outro negócio.');
  }

  if (params.targetStatus !== order.status) {
    assertTransitionDeliveryOrder(order.status, params.targetStatus);
  }

  let stockApplied = false;
  let revenueBooked = false;
  let stockAlerts: StockAlert[] = [];

  if (params.targetStatus === 'entregue') {
    revenueBooked = await bookDeliveryRevenueAdmin(db, params.businessId, params.orderId, now);
  } else if (params.targetStatus === 'cancelado') {
    await restoreOrderStockRecoverable(params.orderId, params.businessId, {
      operatorName: params.actor.name,
      context: 'pedido cancelado',
    });
    await orderRef.update({
      status: 'cancelado',
      cancelledAt: nowIso,
      cancelledBy: params.actor.id,
      cancelledByName: params.actor.name,
      updatedAt: nowIso,
      ...(params.reason
        ? { internalNotes: order.internalNotes ? `${order.internalNotes} · Cancelado: ${params.reason}` : `Cancelado: ${params.reason}` }
        : {}),
    });
  } else {
    // Dedução de estoque ao entrar em 'preparando' — caminho de compatibilidade
    // para pedidos legados sem stockDeductedAt (pedidos criados pelos
    // adaptadores M02.5a/b/c já saem de 'recebido' com estoque deduzido).
    if (params.targetStatus === 'preparando' && !order.stockDeductedAt) {
      const productIndex = await loadProductIndex(db, order.items.map((i) => i.productId), params.businessId);
      const lines = buildOrderStockLines(order, productIndex);
      const result = await applyStockOperationAdmin(db, {
        businessId: params.businessId,
        type: 'saida',
        lines,
        operatorId: params.actor.id,
        operatorName: params.actor.name,
        sourceType: 'order',
        sourceId: params.orderId,
        sourceDocument: { collection: 'deliveryOrders', id: params.orderId, existence: 'required' },
        idempotencyKey: `order:${params.orderId}:deduct`,
        reason: `Pedido #${order.number}`,
        expandBom: true,
        negativeStockPolicy: 'prevent',
      });
      stockApplied = true;
      stockAlerts = result.adjustments.flatMap((a) => (a.alert ? [a.alert] : []));
      await orderRef.update({ status: params.targetStatus, stockDeductedAt: nowIso, updatedAt: nowIso });
    } else {
      await orderRef.update({ status: params.targetStatus, updatedAt: nowIso });
    }
  }

  const finalSnapshot = await orderRef.get();
  return {
    order: { id: finalSnapshot.id, ...finalSnapshot.data() } as DeliveryOrder,
    stockApplied,
    revenueBooked,
    stockAlerts,
  };
}
