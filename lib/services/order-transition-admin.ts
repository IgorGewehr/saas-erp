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
import type { Order, OrderStatus, StockAlert } from '@/lib/types';

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Divide `total` em `n` parcelas (reais), a última absorve o resto do arredondamento. */
export function splitInstallments(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 100) / 100;
  const amounts = Array.from({ length: n }, () => base);
  const roundedSum = Math.round(base * n * 100) / 100;
  amounts[n - 1] = Math.round((amounts[n - 1] + (total - roundedSum)) * 100) / 100;
  return amounts;
}

async function invoiceOrder(
  db: Firestore,
  order: Order & { id: string },
  actor: OrderTransitionActor,
  now: Date,
): Promise<{ stockApplied: boolean; stockAlerts: StockAlert[]; transactionIds: string[] }> {
  // ── Dedução de estoque — só itens de produto (serviços não têm saldo). ────
  const productIds = order.items.map((i) => i.productId).filter((id): id is string => !!id);
  let stockApplied = false;
  let stockAlerts: StockAlert[] = [];
  if (productIds.length > 0) {
    const lines = order.items
      .filter((i) => i.productId)
      .map((i) => ({
        productId: i.productId!,
        quantity: i.quantity,
        ...(i.variantId ? { variantId: i.variantId } : {}),
      }));
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
    const dueDate = new Date(now.getTime() + i * 30 * DAY_MS).toISOString().split('T')[0];
    const result = await createTransactionSafeAdmin(db, {
      businessId: order.businessId,
      type: 'receita',
      status: 'pendente',
      category: 'Vendas B2B',
      description: `Pedido B2B #${order.id}${order.clientName ? ` — ${order.clientName}` : ''}${
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
  const productIds = order.items.map((i) => i.productId).filter((id): id is string => !!id);
  let stockApplied = false;
  let stockAlerts: StockAlert[] = [];
  if (productIds.length > 0) {
    const lines = order.items
      .filter((i) => i.productId)
      .map((i) => ({
        productId: i.productId!,
        quantity: i.quantity,
        ...(i.variantId ? { variantId: i.variantId } : {}),
      }));
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
