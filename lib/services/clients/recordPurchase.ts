/**
 * lib/services/clients/recordPurchase.ts
 *
 * Registra UMA compra na ficha do cliente: incrementa totalSpent / visitCount /
 * lastVisit e promove o lifecycleStage para 'customer'. IDEMPOTENTE por
 * pedido/venda — chamar duas vezes com o mesmo sourceId é no-op.
 *
 * Guard determinístico: subcoleção `clients/{clientId}/purchases/{sourceId}`,
 * criada DENTRO da transação. Se o doc-guard já existe, a tx não re-aplica os
 * incrementos. Isso protege contra retries/duplo-dispatch do MESMO evento de
 * compra.
 *
 * Atenção ao double-count de VISITA: o cardápio (app/api/orders/public) já
 * incrementa `visitCount` no momento em que cria o pedido. Para esse caso o
 * caller deve passar `countVisit: false` — assim recordClientPurchase soma o
 * valor gasto e promove o estágio sem contar a visita de novo. Fluxos que NÃO
 * contam visita na origem (ex: PDV) usam o default `countVisit: true`.
 *
 * Divisor SDK (espelha o resto do código): execução admin vs client; a regra
 * de cálculo do patch (computePurchasePatch) é PURA e compartilhada.
 */

import type { Firestore as AdminFirestore } from 'firebase-admin/firestore';
import {
  doc,
  collection,
  runTransaction,
  type Firestore as ClientFirestore,
} from 'firebase/firestore';
import { db as clientDb } from '@/lib/config/firebase';
import type { Client, LifecycleStage } from '@/lib/types';

export interface RecordPurchaseResult {
  /** true se os incrementos foram aplicados nesta chamada; false se já estavam
   *  (guard de idempotência detectou que o pedido/venda já fora contado). */
  recorded: boolean;
}

interface RecordPurchaseArgs {
  businessId: string;
  clientId: string;
  /** ID estável do pedido OU da venda — chave do guard de idempotência. */
  sourceId: string;
  /** Valor gasto a somar em totalSpent. */
  amount: number;
  /** Some +1 em visitCount? Default true. O cardápio passa false (já contou na
   *  criação do pedido). */
  countVisit?: boolean;
}

// ── Puro (compartilhado entre SDKs) ─────────────────────────────────────────

/** Estágios anteriores a "cliente que comprou" — qualquer um deles (ou ausente,
 *  ou 'churned') é promovido para 'customer' ao registrar uma compra. */
function shouldPromoteToCustomer(stage: LifecycleStage | undefined): boolean {
  return stage !== 'customer';
}

/**
 * Calcula o patch a aplicar no doc do cliente a partir do estado atual.
 * `current` é o doc lido dentro da transação. Função pura — sem I/O.
 */
export function computePurchasePatch(
  current: Pick<Client, 'totalSpent' | 'visitCount' | 'lifecycleStage'>,
  amount: number,
  countVisit: boolean,
  now: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    totalSpent: (current.totalSpent || 0) + (amount || 0),
    lastVisit: now,
    updatedAt: now,
  };
  if (countVisit) patch.visitCount = (current.visitCount || 0) + 1;
  if (shouldPromoteToCustomer(current.lifecycleStage)) patch.lifecycleStage = 'customer';
  return patch;
}

// ── Admin SDK ───────────────────────────────────────────────────────────────

/**
 * Admin SDK: registra a compra de forma idempotente. Usado por rotas
 * server-side (orders/public, agent tools, sales-server).
 */
export async function recordClientPurchaseAdmin(
  args: RecordPurchaseArgs & { db: AdminFirestore },
): Promise<RecordPurchaseResult> {
  const { db, businessId, clientId, sourceId, amount } = args;
  const countVisit = args.countVisit ?? true;
  if (!businessId) throw new Error('recordClientPurchase: businessId obrigatório (R1)');
  if (!clientId || !sourceId) throw new Error('recordClientPurchase: clientId e sourceId obrigatórios');

  const clientRef = db.collection('clients').doc(clientId);
  const guardRef = clientRef.collection('purchases').doc(sourceId);

  return db.runTransaction(async (tx) => {
    const [guardSnap, clientSnap] = await Promise.all([tx.get(guardRef), tx.get(clientRef)]);
    if (guardSnap.exists) return { recorded: false };
    if (!clientSnap.exists) throw new Error('recordClientPurchase: cliente não encontrado');
    const data = clientSnap.data() as Client;
    if (data.businessId !== businessId) throw new Error('recordClientPurchase: cross-tenant negado');

    const now = new Date().toISOString();
    tx.update(clientRef, computePurchasePatch(data, amount, countVisit, now));
    tx.set(guardRef, { businessId, sourceId, amount: amount || 0, recordedAt: now });
    return { recorded: true };
  });
}

// ── Client SDK ────────────────────────────────────────────────────────────

/**
 * Client SDK: registra a compra de forma idempotente. `db` opcional — default é
 * a instância do client SDK. Usado no browser do operador (OrdersModule/PDV).
 */
export async function recordClientPurchaseClient(
  args: RecordPurchaseArgs & { db?: ClientFirestore },
): Promise<RecordPurchaseResult> {
  const { businessId, clientId, sourceId, amount } = args;
  const db = args.db ?? clientDb;
  const countVisit = args.countVisit ?? true;
  if (!businessId) throw new Error('recordClientPurchase: businessId obrigatório (R1)');
  if (!clientId || !sourceId) throw new Error('recordClientPurchase: clientId e sourceId obrigatórios');

  const clientRef = doc(db, 'clients', clientId);
  const guardRef = doc(collection(clientRef, 'purchases'), sourceId);

  try {
    return await runTransaction(db, async (tx) => {
      const guardSnap = await tx.get(guardRef);
      if (guardSnap.exists()) return { recorded: false };
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists()) throw new Error('recordClientPurchase: cliente não encontrado');
      const data = clientSnap.data() as Client;
      if (data.businessId !== businessId) throw new Error('recordClientPurchase: cross-tenant negado');

      const now = new Date().toISOString();
      tx.update(clientRef, computePurchasePatch(data, amount, countVisit, now));
      tx.set(guardRef, { businessId, sourceId, amount: amount || 0, recordedAt: now });
      return { recorded: true };
    });
  } catch (err) {
    // Sinal observável na origem: a leitura do guard (clients/{id}/purchases/{sourceId})
    // é a 1ª op da tx e, na 1ª compra, o doc-guard AINDA não existe — se a regra
    // Firestore negar read de doc inexistente, a tx inteira falha e as stats do
    // cliente (PDV/Pedidos, client-SDK) nunca gravam. console.error (não warn) pra
    // que esse modo de falha apareça nos logs. Re-lança: callers tratam best-effort.
    console.error('[recordClientPurchase] guard tx falhou — stats do cliente NÃO gravadas:', err);
    throw err;
  }
}
