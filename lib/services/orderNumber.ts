/**
 * lib/services/orderNumber.ts
 *
 * Fonte ÚNICA da numeração sequencial de pedidos (orders/deliveryOrders).
 *
 * Antes havia DUAS fontes da verdade divergentes:
 *   - app/api/orders/public/route.ts → `lastOrderNumber` transacional no doc
 *     do business (atômico, sem buraco).
 *   - OrdersModule (UI) → `max(number) + 1` lido em memória, NÃO transacional
 *     → dois canais (cardápio público vs balcão) podiam emitir o MESMO número
 *       sob concorrência, gerando pedidos duplicados.
 *
 * Este módulo unifica em um contador monotônico em
 * `businesses/{businessId}.lastOrderNumber`, incrementado DENTRO de uma
 * runTransaction. Como ambos os canais passam a ler/escrever o mesmo contador
 * de forma atômica, a numeração é globalmente única por tenant (R1).
 *
 * Divisor client-SDK × admin-SDK (mesmo padrão de appointmentTxGuard*):
 *   - allocateOrderNumber       → Firestore client SDK (browser/UI, OrdersModule/PDV)
 *   - allocateOrderNumberAdmin  → Admin SDK (rotas server: orders/public, crons)
 * A lógica pura (lastOrderNumber + 1) é idêntica e vive em `nextFromSnapshot`;
 * só a execução da transação difere por SDK.
 */

import {
  doc,
  runTransaction,
  type Firestore as ClientFirestore,
} from 'firebase/firestore';
import type { Firestore as AdminFirestore } from 'firebase-admin/firestore';

/**
 * Lógica PURA compartilhada pelos dois SDKs: dado o valor atual de
 * `lastOrderNumber` (ou undefined num business novo), retorna o próximo número.
 * Sequência começa em 1. Defensivo contra valores não-numéricos/negativos
 * gravados manualmente — nunca regride a numeração.
 */
export function nextOrderNumber(current: unknown): number {
  const last = typeof current === 'number' && Number.isFinite(current) && current > 0
    ? Math.floor(current)
    : 0;
  return last + 1;
}

/**
 * Aloca o próximo número de pedido via Firestore CLIENT SDK.
 * Incrementa `businesses/{businessId}.lastOrderNumber` dentro de runTransaction
 * e retorna o número alocado. Use no browser (OrdersModule, PDV).
 */
export async function allocateOrderNumber(
  db: ClientFirestore,
  businessId: string,
): Promise<number> {
  if (!businessId) throw new Error('allocateOrderNumber: businessId obrigatorio (R1)');

  const bizRef = doc(db, 'businesses', businessId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(bizRef);
    const next = nextOrderNumber(snap.data()?.lastOrderNumber);
    tx.update(bizRef, { lastOrderNumber: next, updatedAt: new Date().toISOString() });
    return next;
  });
}

/**
 * Aloca o próximo número de pedido via Firebase ADMIN SDK.
 * Mesma semântica de allocateOrderNumber, para rotas server-side
 * (orders/public, crons, webhooks) onde só existe o Admin SDK.
 */
export async function allocateOrderNumberAdmin(
  adminDb: AdminFirestore,
  businessId: string,
): Promise<number> {
  if (!businessId) throw new Error('allocateOrderNumberAdmin: businessId obrigatorio (R1)');

  const bizRef = adminDb.collection('businesses').doc(businessId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(bizRef);
    const next = nextOrderNumber(snap.data()?.lastOrderNumber);
    tx.update(bizRef, { lastOrderNumber: next, updatedAt: new Date().toISOString() });
    return next;
  });
}
