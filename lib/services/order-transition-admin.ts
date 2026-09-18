/**
 * lib/services/order-transition-admin.ts
 *
 * Transição de status server-side de Order (B2B/condicional, M02.6), com os
 * efeitos REAIS documentados em `ORDER_TRANSITION_EFFECTS`
 * (lib/contracts/fsm/order.ts):
 *
 *   confirmado→faturado: dedução de estoque (applyStockOperationAdmin, reusa
 *     o núcleo M01 — expande BOM, bloqueia negativo) + lançamento da receita
 *     (createTransactionSafeAdmin, núcleo M03.2 — idempotente por
 *     businessId+orderId+type+installmentNumber). Parcelas: `order.installments`
 *     > 1 gera N Transactions com installmentGroupId=orderId, vencendo em
 *     ciclos mensais a partir de agora (simplificação deliberada —
 *     `paymentTerms` é texto livre, não um cronograma parseável).
 *   *→cancelado (a partir de faturado): restaura o estoque deduzido e
 *     cancela cada Transaction vinculada via transitionTransactionSafeAdmin
 *     (FSM de Transaction já aceita pendente/pago→cancelado).
 *   demais transições: só atualização de status (mesmo tratamento que o
 *     próprio ORDER_TRANSITION_EFFECTS documenta como "Nenhum side-effect" —
 *     reserva de estoque em confirmado é marcada "opcional" pelo FSM e
 *     deliberadamente NÃO implementada nesta fatia).
 *
 * NF-e (emissão/cancelamento) É DELIBERADAMENTE ADIADA — ver
 * docs/paridade/M02_PLANO_IMPLEMENTACAO.md §M02.6. Emitir um documento
 * fiscal real sem poder validar contra um SEFAZ de homologação neste
 * ambiente é um risco maior que o valor desta fatia; `fiscalDocId` fica
 * vazio e o pedido segue faturável/cancelável normalmente sem fiscal.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { assertTransitionOrder } from '@/lib/contracts/fsm/order';
import { applyStockOperationAdmin } from '@/lib/services/stock-core-admin';
import { createTransactionSafeAdmin, transitionTransactionSafeAdmin } from '@/lib/services/transactionTxGuardAdmin';
import { splitInstallments, installmentDueDate } from '@/lib/utils/installments';
import type { Order, OrderStatus, Product, StockAlert } from '@/lib/types';

export class OrderTransitionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OrderTransitionError';
  }
}

export interface OrderTransitionActor {
  id: string;
  name: string;
}

export interface OrderTransitionResult {
  order: Order;
  stockApplied: boolean;
  invoiced: boolean;
  transactionIds: string[];
  stockAlerts: StockAlert[];
}

// Movidos pra lib/utils/installments.ts (puro, sem firebase-admin) pra a prévia
// de cronograma da Vitrine mostrar exatamente o que este serviço grava. O
// reexport mantém o import histórico (tests/services/orderTransitionAdmin.test.ts).
export { splitInstallments };

interface OrderStockLine {
  productId: string;
  quantity: number;
  variantId?: string;
}

/**
 * Linhas de estoque do pedido SEM os itens marcados "Não controlar estoque"
 * (`trackStock === false`). Sem este filtro, faturar um serviço cadastrado como
 * produto com saldo 0 estourava InsufficientStockError (política `prevent`) e o
 * cancelamento "restaurava" um saldo que nunca foi baixado. Produto ou variação
 * que não aparece no índice (inexistente/outro negócio) FICA na lista: quem
 * recusa com o erro certo é o núcleo de estoque.
 */
async function buildTrackedStockLines(
  db: Firestore,
  order: Order & { id: string },
): Promise<OrderStockLine[]> {
  const productItems = order.items.filter((item) => item.productId);
  if (productItems.length === 0) return [];

  const productIds = [...new Set(productItems.map((item) => item.productId!))];
  const snapshots = await db.getAll(...productIds.map((id) => db.collection('products').doc(id)));
  const index = new Map<string, Product>();
  for (const snapshot of snapshots) {
    const data = snapshot.data() as Product | undefined;
    if (snapshot.exists && data?.businessId === order.businessId) index.set(snapshot.id, data);
  }

  return productItems
    .filter((item) => {
      const product = index.get(item.productId!);
      if (!product) return true;
      if (!item.variantId) return product.trackStock !== false;
      const variant = product.variants?.find((candidate) => candidate.id === item.variantId);
      return variant ? variant.trackStock !== false : true;
    })
    .map((item) => ({
      productId: item.productId!,
      quantity: item.quantity,
      ...(item.variantId ? { variantId: item.variantId } : {}),
    }));
}

async function invoiceOrder(
  db: Firestore,
  order: Order & { id: string },
  actor: OrderTransitionActor,
  now: Date,
): Promise<{ stockApplied: boolean; stockAlerts: StockAlert[]; transactionIds: string[] }> {
  // ── Dedução de estoque — só itens de produto COM controle de estoque. ─────
  const lines = await buildTrackedStockLines(db, order);
  let stockApplied = false;
  let stockAlerts: StockAlert[] = [];
  if (lines.length > 0) {
    const result = await applyStockOperationAdmin(db, {
      businessId: order.businessId,
      type: 'saida',
      lines,
      operatorId: actor.id,
      operatorName: actor.name,
      sourceType: 'order',
      sourceId: order.id,
      sourceDocument: { collection: 'orders', id: order.id, existence: 'required' },
      idempotencyKey: `order:${order.id}:deduct`,
      reason: `Pedido B2B #${order.id}`,
      expandBom: true,
      negativeStockPolicy: 'prevent',
    });
    stockApplied = true;
    stockAlerts = result.adjustments.flatMap((a) => (a.alert ? [a.alert] : []));
  }

  // ── Receita — 1 Transaction (à vista) ou N parceladas. ─────────────────────
  const installments = Math.max(1, order.installments ?? 1);
  const amounts = splitInstallments(order.total, installments);
  const transactionIds: string[] = [];
  for (let i = 0; i < amounts.length; i++) {
    const dueDate = installmentDueDate(now, i);
    const result = await createTransactionSafeAdmin(db, {
      businessId: order.businessId,
      type: 'receita',
      status: 'pendente',
      category: 'Vendas B2B',
      description: `Pedido B2B #${order.id.slice(-6).toUpperCase()}${order.clientName ? ` — ${order.clientName}` : ''}${
        amounts.length > 1 ? ` (parcela ${i + 1}/${amounts.length})` : ''
      }`,
      amount: amounts[i],
      dueDate,
      orderId: order.id,
      ...(amounts.length > 1 ? { installmentGroupId: order.id, installmentNumber: i + 1 } : {}),
      ...(order.clientId ? { clientId: order.clientId, contactId: order.clientId } : {}),
      ...(order.clientName ? { clientName: order.clientName } : {}),
      ...(order.paymentMethod ? { paymentMethod: order.paymentMethod } : {}),
      ...(order.sectorId ? { sectorId: order.sectorId } : {}),
    });
    transactionIds.push(result.id);
  }

  return { stockApplied, stockAlerts, transactionIds };
}

async function reverseInvoicedOrder(
  db: Firestore,
  order: Order & { id: string },
  actor: OrderTransitionActor,
): Promise<{ stockApplied: boolean; stockAlerts: StockAlert[] }> {
  const lines = await buildTrackedStockLines(db, order);
  let stockApplied = false;
  let stockAlerts: StockAlert[] = [];
  if (lines.length > 0) {
    const result = await applyStockOperationAdmin(db, {
      businessId: order.businessId,
      type: 'restauracao',
      lines,
      operatorId: actor.id,
      operatorName: actor.name,
      sourceType: 'order',
      sourceId: order.id,
      sourceDocument: { collection: 'orders', id: order.id, existence: 'required' },
      idempotencyKey: `order:${order.id}:restore`,
      reason: `Cancelamento do pedido B2B #${order.id}`,
      expandBom: true,
    });
    stockApplied = true;
    stockAlerts = result.adjustments.flatMap((a) => (a.alert ? [a.alert] : []));
  }

  const transactionIds = order.transactionIds ?? [];
  for (const transactionId of transactionIds) {
    try {
      await transitionTransactionSafeAdmin({
        db,
        transactionId,
        businessId: order.businessId,
        targetStatus: 'cancelado',
      });
    } catch (err) {
      // Best-effort: uma Transaction já cancelada (FSM rejeita cancelado→cancelado)
      // ou não encontrada não deve travar o cancelamento do pedido inteiro.
      console.warn(`[OrderTransition] falha ao cancelar transaction ${transactionId}:`, err);
    }
  }

  return { stockApplied, stockAlerts };
}

export async function transitionOrderAdmin(params: {
  db?: Firestore;
  orderId: string;
  businessId: string;
  targetStatus: OrderStatus;
  actor: OrderTransitionActor;
  reason?: string;
  now?: Date;
}): Promise<OrderTransitionResult> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const orderRef = db.collection('orders').doc(params.orderId);

  const snapshot = await orderRef.get();
  if (!snapshot.exists) throw new OrderTransitionError('ORDER_NOT_FOUND', 'Pedido não encontrado.');
  const order = { id: snapshot.id, ...snapshot.data() } as Order & { id: string };
  if (order.businessId !== params.businessId) {
    throw new OrderTransitionError('TENANT_MISMATCH', 'Pedido pertence a outro negócio.');
  }

  try {
    assertTransitionOrder(order.status, params.targetStatus);
  } catch {
    throw new OrderTransitionError(
      'INVALID_TRANSITION',
      `Transição inválida: ${order.status} → ${params.targetStatus}.`,
    );
  }

  const statusHistoryEntry = {
    status: params.targetStatus,
    timestamp: nowIso,
    userId: params.actor.id,
    userName: params.actor.name,
    ...(params.reason ? { note: params.reason } : {}),
  };
  const nextStatusHistory = [...(order.statusHistory ?? []), statusHistoryEntry];

  let stockApplied = false;
  let invoiced = false;
  let transactionIds: string[] = [];
  let stockAlerts: StockAlert[] = [];

  if (params.targetStatus === 'faturado') {
    const result = await invoiceOrder(db, order, params.actor, now);
    stockApplied = result.stockApplied;
    stockAlerts = result.stockAlerts;
    transactionIds = result.transactionIds;
    invoiced = true;
    await orderRef.update({
      status: 'faturado',
      invoicedAt: nowIso,
      transactionIds,
      ...(stockApplied ? { stockDeductedAt: nowIso } : {}),
      statusHistory: nextStatusHistory,
      updatedAt: nowIso,
    });
  } else if (params.targetStatus === 'cancelado') {
    if (order.status === 'faturado') {
      const result = await reverseInvoicedOrder(db, order, params.actor);
      stockApplied = result.stockApplied;
      stockAlerts = result.stockAlerts;
    }
    await orderRef.update({
      status: 'cancelado',
      cancelledAt: nowIso,
      cancelledBy: params.actor.id,
      cancelledByName: params.actor.name,
      statusHistory: nextStatusHistory,
      updatedAt: nowIso,
      ...(params.reason
        ? { internalNotes: order.internalNotes ? `${order.internalNotes} · Cancelado: ${params.reason}` : `Cancelado: ${params.reason}` }
        : {}),
    });
  } else {
    await orderRef.update({
      status: params.targetStatus,
      statusHistory: nextStatusHistory,
      updatedAt: nowIso,
    });
  }

  const finalSnapshot = await orderRef.get();
  return {
    order: { id: finalSnapshot.id, ...finalSnapshot.data() } as Order,
    stockApplied,
    invoiced,
    transactionIds,
    stockAlerts,
  };
}
