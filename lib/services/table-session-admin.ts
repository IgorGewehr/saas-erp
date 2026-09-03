/**
 * lib/services/table-session-admin.ts
 *
 * Núcleo server-side das comandas de mesa (`tableSessions`). Fonte ÚNICA das
 * transições de `TableSession` — chamada pelas rotas `/api/table-sessions/*` e
 * pelo `/api/orders/public` (auto-abertura via QR `?mesa=N`).
 *
 * FSM: lib/contracts/fsm/tableSession.ts (aberta→fechada→paga | cancelada).
 *
 * Efeito cross-módulo (R5): `fechada→paga` marca TODOS os pedidos vinculados
 * como `entregue` com `settledViaSaleId` (sem receita própria) — a receita
 * única vem da Sale criada no checkout do PDV. Documentado como `table.settled`
 * (audit-only) em lib/contracts/events/index.ts; roda inline aqui com guards CAS.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  assertTransitionTableSession,
  TABLE_SESSION_TERMINAL_STATUSES,
} from '@/lib/contracts/fsm/tableSession';
import { TableSessionSchema, type TableSession } from '@/lib/contracts/domain/tableSession';
import { DELIVERY_ORDER_TERMINAL_STATUSES } from '@/lib/contracts/fsm/deliveryOrder';
import { transitionDeliveryOrderAdmin } from '@/lib/services/delivery-order-transition-admin';
import { dispatchDomainEvent } from '@/lib/contracts/_runtime/dispatch';
import type { DeliveryOrder } from '@/lib/types';

export class TableSessionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TableSessionError';
  }
}

export interface TableSessionActor {
  id: string;
  name: string;
  type: 'user' | 'agent' | 'public';
}

function loadSession(snap: FirebaseFirestore.DocumentSnapshot): TableSession & { id: string } {
  return { id: snap.id, ...(snap.data() as Record<string, unknown>) } as TableSession & { id: string };
}

function assertOwn(session: { businessId?: string }, businessId: string): void {
  if (session.businessId !== businessId) {
    throw new TableSessionError('TENANT_MISMATCH', 'Comanda pertence a outro negócio.');
  }
}

/** Soma o `total` dos pedidos vinculados que não foram cancelados. */
async function sumLinkedOrders(
  db: Firestore,
  orderIds: string[],
): Promise<{ subtotal: number; openOrderIds: string[] }> {
  if (orderIds.length === 0) return { subtotal: 0, openOrderIds: [] };
  const refs = orderIds.map((id) => db.collection('deliveryOrders').doc(id));
  const snaps = await db.getAll(...refs);
  let subtotal = 0;
  const openOrderIds: string[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const order = snap.data() as DeliveryOrder;
    if (order.status === 'cancelado') continue;
    subtotal += order.total ?? 0;
    if (!DELIVERY_ORDER_TERMINAL_STATUSES.has(order.status)) openOrderIds.push(snap.id);
  }
  return { subtotal: Math.round(subtotal * 100) / 100, openOrderIds };
}

// ─── Abrir ───────────────────────────────────────────────────────────────────

export async function openTableSessionAdmin(params: {
  db?: Firestore;
  businessId: string;
  tableLabel: string;
  tableId?: string;
  actor: TableSessionActor;
  sectorId?: string;
  guestName?: string;
  guestCount?: number;
  now?: Date;
}): Promise<{ session: TableSession & { id: string }; created: boolean }> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const label = params.tableLabel.trim();
  if (!label) throw new TableSessionError('INVALID_LABEL', 'Informe o nome/número da mesa.');

  const col = db.collection('tableSessions');
  const openQuery = col
    .where('businessId', '==', params.businessId)
    .where('tableLabel', '==', label)
    .where('status', '==', 'aberta')
    .limit(1);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(openQuery);
    if (!existing.empty) {
      return { session: loadSession(existing.docs[0]), created: false };
    }
    const ref = col.doc();
    const doc: TableSession = {
      businessId: params.businessId,
      tableLabel: label,
      ...(params.tableId ? { tableId: params.tableId } : {}),
      status: 'aberta',
      openedAt: nowIso,
      openedByUid: params.actor.id,
      openedByName: params.actor.name,
      orderIds: [],
      ...(params.sectorId ? { sectorId: params.sectorId } : {}),
      ...(params.guestName ? { guestName: params.guestName.trim() } : {}),
      ...(params.guestCount ? { guestCount: params.guestCount } : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    TableSessionSchema.parse(doc);
    tx.set(ref, doc);
    return { session: { id: ref.id, ...doc }, created: true };
  });
}

// ─── Fechar conta ────────────────────────────────────────────────────────────

export async function closeTableSessionAdmin(params: {
  db?: Firestore;
  sessionId: string;
  businessId: string;
  actor: TableSessionActor;
  now?: Date;
}): Promise<TableSession & { id: string }> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const ref = db.collection('tableSessions').doc(params.sessionId);

  const snap = await ref.get();
  if (!snap.exists) throw new TableSessionError('SESSION_NOT_FOUND', 'Comanda não encontrada.');
  const session = loadSession(snap);
  assertOwn(session, params.businessId);
  if (session.status === 'fechada') return session; // idempotente
  assertTransitionTableSession(session.status, 'fechada');

  const { subtotal } = await sumLinkedOrders(db, session.orderIds ?? []);

  await ref.update({
    status: 'fechada',
    closedAt: nowIso,
    closedByUid: params.actor.id,
    closedByName: params.actor.name,
    subtotalSnapshot: subtotal,
    updatedAt: nowIso,
  });

  await dispatchDomainEvent(db, {
    type: 'table.closed',
    businessId: params.businessId,
    occurredAt: nowIso,
    actorType: params.actor.type === 'agent' ? 'agent' : 'user',
    actorId: params.actor.id,
    actorName: params.actor.name,
    tableSessionId: params.sessionId,
    tableLabel: session.tableLabel,
    subtotalSnapshot: subtotal,
    orderCount: (session.orderIds ?? []).length,
  }).catch((err) => console.warn('[tableSession] dispatch table.closed falhou:', err));

  return { ...session, status: 'fechada', closedAt: nowIso, closedByUid: params.actor.id, closedByName: params.actor.name, subtotalSnapshot: subtotal, updatedAt: nowIso };
}

// ─── Reabrir ─────────────────────────────────────────────────────────────────

export async function reopenTableSessionAdmin(params: {
  db?: Firestore;
  sessionId: string;
  businessId: string;
  actor: TableSessionActor;
  now?: Date;
}): Promise<TableSession & { id: string }> {
  const db = params.db ?? adminDb;
  const nowIso = (params.now ?? new Date()).toISOString();
  const ref = db.collection('tableSessions').doc(params.sessionId);

  const snap = await ref.get();
  if (!snap.exists) throw new TableSessionError('SESSION_NOT_FOUND', 'Comanda não encontrada.');
  const session = loadSession(snap);
  assertOwn(session, params.businessId);
  if (session.status === 'aberta') return session;
  assertTransitionTableSession(session.status, 'aberta');

  await ref.update({
    status: 'aberta',
    closedAt: FieldValue.delete(),
    closedByUid: FieldValue.delete(),
    closedByName: FieldValue.delete(),
    subtotalSnapshot: FieldValue.delete(),
    updatedAt: nowIso,
  });
  return { ...session, status: 'aberta', closedAt: undefined, closedByUid: undefined, closedByName: undefined, subtotalSnapshot: undefined, updatedAt: nowIso };
}

// ─── Cancelar mesa ───────────────────────────────────────────────────────────

export async function cancelTableSessionAdmin(params: {
  db?: Firestore;
  sessionId: string;
  businessId: string;
  actor: TableSessionActor;
  reason?: string;
  now?: Date;
}): Promise<TableSession & { id: string }> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const ref = db.collection('tableSessions').doc(params.sessionId);

  const snap = await ref.get();
  if (!snap.exists) throw new TableSessionError('SESSION_NOT_FOUND', 'Comanda não encontrada.');
  const session = loadSession(snap);
  assertOwn(session, params.businessId);
  if (session.status === 'cancelada') return session;
  assertTransitionTableSession(session.status, 'cancelada');

  const { openOrderIds } = await sumLinkedOrders(db, session.orderIds ?? []);
  for (const orderId of openOrderIds) {
    await transitionDeliveryOrderAdmin({
      db, orderId, businessId: params.businessId, targetStatus: 'cancelado',
      actor: { id: params.actor.id, name: params.actor.name, type: params.actor.type === 'agent' ? 'agent' : 'user' },
      reason: params.reason ? `Mesa cancelada: ${params.reason}` : 'Mesa cancelada',
      now,
    }).catch((err) => console.warn(`[tableSession] cancelar pedido ${orderId} falhou:`, err));
  }

  await ref.update({
    status: 'cancelada',
    ...(params.reason ? { cancelReason: params.reason.trim().slice(0, 500) } : {}),
    updatedAt: nowIso,
  });
  return { ...session, status: 'cancelada', updatedAt: nowIso };
}

// ─── Liquidar (fechada → paga, via PDV) ──────────────────────────────────────

export async function settleTableSessionAdmin(params: {
  db?: Firestore;
  sessionId: string;
  businessId: string;
  saleId: string;
  actor: TableSessionActor;
  now?: Date;
}): Promise<{ session: TableSession & { id: string }; ordersDelivered: string[]; alreadySettled: boolean }> {
  const db = params.db ?? adminDb;
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const ref = db.collection('tableSessions').doc(params.sessionId);

  const snap = await ref.get();
  if (!snap.exists) throw new TableSessionError('SESSION_NOT_FOUND', 'Comanda não encontrada.');
  const session = loadSession(snap);
  assertOwn(session, params.businessId);

  // Idempotente: mesma Sale liquidando de novo é no-op.
  if (session.status === 'paga') {
    if (session.saleId && session.saleId !== params.saleId) {
      throw new TableSessionError('ALREADY_SETTLED', 'Esta comanda já foi paga por outra venda.');
    }
    return { session, ordersDelivered: [], alreadySettled: true };
  }
  assertTransitionTableSession(session.status, 'paga');

  const { openOrderIds } = await sumLinkedOrders(db, session.orderIds ?? []);
  const delivered: string[] = [];
  for (const orderId of openOrderIds) {
    await transitionDeliveryOrderAdmin({
      db, orderId, businessId: params.businessId, targetStatus: 'entregue',
      actor: { id: params.actor.id, name: params.actor.name, type: params.actor.type === 'agent' ? 'agent' : 'user' },
      settleViaSaleId: params.saleId,
      now,
    });
    delivered.push(orderId);
  }

  await ref.update({
    status: 'paga',
    saleId: params.saleId,
    paidAt: nowIso,
    paidByUid: params.actor.id,
    updatedAt: nowIso,
  });

  await dispatchDomainEvent(db, {
    type: 'table.settled',
    businessId: params.businessId,
    occurredAt: nowIso,
    actorType: params.actor.type === 'agent' ? 'agent' : 'user',
    actorId: params.actor.id,
    actorName: params.actor.name,
    tableSessionId: params.sessionId,
    tableLabel: session.tableLabel,
    saleId: params.saleId,
    ordersDelivered: delivered,
  }).catch((err) => console.warn('[tableSession] dispatch table.settled falhou:', err));

  return {
    session: { ...session, status: 'paga', saleId: params.saleId, paidAt: nowIso, paidByUid: params.actor.id, updatedAt: nowIso },
    ordersDelivered: delivered,
    alreadySettled: false,
  };
}

void TABLE_SESSION_TERMINAL_STATUSES;
