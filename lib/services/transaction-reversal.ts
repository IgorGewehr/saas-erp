/**
 * lib/services/transaction-reversal.ts — estorno idempotente da Transaction de
 * RECEITA gerada por um DeliveryOrder entregue. SERVER-ONLY (firebase-admin).
 *
 * Quando um pagamento é estornado/charged_back DEPOIS do pedido ter sido
 * entregue, já existe uma Transaction de receita (guard `order.transactionId`).
 * Para não inflar o caixa, lançamos um CONTRA-LANÇAMENTO (despesa de mesmo
 * valor, categoria "Estornos") — espelhando como a receita é criada — em vez de
 * apagar/mutar o lançamento original (preserva trilha de auditoria financeira).
 *
 * Idempotência: o guard vive no PRÓPRIO pedido (`transactionReversedAt`), gravado
 * na MESMA runTransaction que cria o contra-lançamento. Re-execução (webhook
 * reentregue) vira no-op. Cross-coleção e fora da tx de FSM por design.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { DeliveryOrder, Transaction } from '@/lib/types';

/** Campos de guard que vivem no pedido mas ainda não estão no tipo base. */
type OrderWithReversalGuard = DeliveryOrder & {
  transactionReversedAt?: string;
  reversalTransactionId?: string;
};

export interface ReverseOrderRevenueResult {
  reversed: boolean;
  reason?: 'no-transaction' | 'already-reversed' | 'order-missing' | 'tenant-mismatch';
  reversalTransactionId?: string;
}

/**
 * Estorna (contra-lança) a receita de um DeliveryOrder, idempotentemente.
 * No-op se o pedido não tem receita lançada (`transactionId` vazio) ou já foi
 * estornado (`transactionReversedAt` setado).
 */
export async function reverseDeliveryOrderRevenue(
  db: Firestore,
  args: { businessId: string; orderId: string; reason?: string },
): Promise<ReverseOrderRevenueResult> {
  const orderRef = db.collection('deliveryOrders').doc(args.orderId);

  return db.runTransaction<ReverseOrderRevenueResult>(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return { reversed: false, reason: 'order-missing' };

    const order = snap.data() as OrderWithReversalGuard;
    if (order.businessId !== args.businessId) return { reversed: false, reason: 'tenant-mismatch' };
    if (!order.transactionId) return { reversed: false, reason: 'no-transaction' };
    if (order.transactionReversedAt) {
      return {
        reversed: false,
        reason: 'already-reversed',
        reversalTransactionId: order.reversalTransactionId,
      };
    }

    // Lê o lançamento original p/ espelhar o valor (fallback no total do pedido).
    const origRef = db.collection('transactions').doc(order.transactionId);
    const origSnap = await tx.get(origRef);
    const orig = origSnap.exists ? (origSnap.data() as Transaction) : null;
    const amount = orig?.amount ?? order.total ?? 0;

    const now = new Date().toISOString();
    const reversalRef = db.collection('transactions').doc();
    const reversal: Omit<Transaction, 'id'> = {
      businessId: args.businessId,
      type: 'despesa',
      category: 'Estornos',
      description:
        args.reason ?? `Estorno do pedido #${order.number ?? args.orderId}`,
      amount,
      dueDate: now.split('T')[0],
      paymentDate: now.split('T')[0],
      status: 'pago',
      deliveryOrderId: args.orderId,
      notes: `Contra-lançamento de estorno (Transaction original ${order.transactionId})`,
      ...(order.clientId ? { clientId: order.clientId, contactId: order.clientId } : {}),
      ...(order.clientName ? { clientName: order.clientName } : {}),
      createdAt: now,
      updatedAt: now,
    };
    tx.set(reversalRef, reversal);

    tx.update(orderRef, {
      transactionReversedAt: now,
      reversalTransactionId: reversalRef.id,
      updatedAt: now,
    });

    return { reversed: true, reversalTransactionId: reversalRef.id };
  });
}
