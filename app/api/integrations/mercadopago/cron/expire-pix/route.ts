/**
 * GET/POST /api/integrations/mercadopago/cron/expire-pix
 *
 * Cron de resiliência — marca cobranças PIX vencidas como `expired` e RESTAURA o
 * estoque que fora debitado na criação do pedido. O MP expira o QR no lado dele,
 * mas pode não notificar (webhook perdido); este cron fecha o ciclo localmente.
 *
 * Recomendação: rodar a cada 5–15 min (ex: `*\/10 * * * *`).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Invariantes:
 *   - R1: query filtra businessId; só toca pedidos do próprio tenant.
 *   - FSM: CAS atômica pending→expired (assertTransitionPayment) dentro de tx —
 *     só UM run flipa cada pedido; depois ele sai da query (não é mais pending).
 *   - Estoque RECUPERÁVEL: o flip pending→expired NÃO terminaliza o restauro.
 *     Quando o pedido tem estoque debitado a restaurar, o flip grava
 *     `stockRestoredAt: null` (claim explícito) no MESMO tx; o restauro corre
 *     logo após. Se o restauro falhar, o campo fica null e uma VARREDURA de
 *     recuperação (paymentFsmStatus=='expired' && stockRestoredAt==null) o
 *     reprocessa no próximo run — não há vazamento de estoque por webhook/restore
 *     perdido. Idempotência: restoreStockAdmin grava timestamp em stockRestoredAt
 *     ao concluir; assim o pedido some da varredura (null → string) e nunca é
 *     restaurado duas vezes. Ordem das operações: restaurar estoque PRIMEIRO,
 *     gravar o timestamp DEPOIS — falha deixa o pedido elegível pra retry.
 *   - Estoque: reconstrói as MESMAS linhas debitadas na criação (itens +
 *     modificadores com linkedProductId), via restoreStockAdmin (BOM expandido).
 *   - try/catch POR PEDIDO e POR TENANT.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { DeliveryOrder, Product } from '@/lib/types';
import {
  loadProductIndex,
  restoreStockAdmin,
  type StockDeductionLine,
} from '@/lib/services/stock-admin';
import { assertTransitionPayment, type PaymentFsmStatus } from '@/contracts/fsm/payment';
import { isCronAuthorized, unauthorized, listConnectedBusinessIds } from '../_shared';

export const maxDuration = 60;

/** Máximo de pedidos vencidos processados por tenant por execução. */
const MAX_ORDERS_PER_TENANT = 100;

interface TenantSummary {
  businessId: string;
  expired: number;
  stockRestored: number;
  /** Restauros reprocessados pela varredura de recuperação (residual de runs
   *  anteriores cujo restauro falhou após o flip→expired). */
  stockRecovered: number;
  failed: number;
  error?: string;
}

/**
 * Reconstrói as linhas de estoque debitadas na criação do pedido: linha base de
 * cada item (BOM expandido por restoreStockAdmin) + linhas dos modificadores com
 * linkedProductId. Espelha validateAndCleanModifiers de orders/public.
 */
function buildStockLines(
  order: DeliveryOrder,
  productIndex: Map<string, Product>,
): StockDeductionLine[] {
  const lines: StockDeductionLine[] = [];
  for (const item of order.items ?? []) {
    lines.push({ productId: item.productId, quantity: item.quantity });
    const product = productIndex.get(item.productId);
    if (!product?.modifierGroups?.length) continue;
    for (const sm of item.selectedModifiers ?? []) {
      const group = product.modifierGroups.find((g) => g.id === sm.groupId);
      if (!group) continue;
      for (const opt of sm.selectedOptions) {
        const srcOpt = group.options.find((o) => o.id === opt.optionId);
        if (srcOpt?.linkedProductId) {
          lines.push({
            productId: srcOpt.linkedProductId,
            quantity: (srcOpt.consumeQty ?? 1) * Math.max(1, opt.quantity || 1) * item.quantity,
          });
        }
      }
    }
  }
  return lines;
}

async function restoreOrderStock(order: DeliveryOrder, orderId: string): Promise<boolean> {
  const orderRef = adminDb.collection('deliveryOrders').doc(orderId);

  // Guard de idempotência (re-leitura fresca): só restaura se o estoque foi
  // debitado e ainda NÃO restaurado. Cobre corridas com o webhook ou com um run
  // anterior que já tenha gravado stockRestoredAt entre a query e este ponto.
  const fresh = await orderRef.get();
  if (!fresh.exists) return false;
  const cur = fresh.data() as DeliveryOrder;
  if (cur.businessId !== order.businessId) return false; // R1 re-check
  if (!cur.stockDeductedAt || cur.stockRestoredAt) return false;

  const itemIds = (order.items ?? []).map((i) => i.productId);
  if (itemIds.length === 0) return false;

  // 1º passe: carrega os produtos dos itens p/ descobrir linkedProductIds dos
  // modificadores; 2º passe: índice completo (itens + insumos) p/ a restauração.
  const itemIndex = await loadProductIndex(adminDb, itemIds, order.businessId);
  const linkedIds: string[] = [];
  for (const item of order.items ?? []) {
    const product = itemIndex.get(item.productId);
    for (const sm of item.selectedModifiers ?? []) {
      const group = product?.modifierGroups?.find((g) => g.id === sm.groupId);
      if (!group) continue;
      for (const opt of sm.selectedOptions) {
        const srcOpt = group.options.find((o) => o.id === opt.optionId);
        if (srcOpt?.linkedProductId) linkedIds.push(srcOpt.linkedProductId);
      }
    }
  }

  const productIndex = await loadProductIndex(
    adminDb,
    [...itemIds, ...linkedIds],
    order.businessId,
  );
  const lines = buildStockLines(order, productIndex);

  const adjustments = await restoreStockAdmin(adminDb, lines, {
    businessId: order.businessId,
    operatorId: 'system',
    operatorName: 'Cron PIX expirado',
    sourceId: orderId,
    reason: `Estorno de estoque — PIX expirado (pedido #${order.number ?? orderId})`,
    productIndex,
  });

  // Timestamp gravado SÓ APÓS o restauro concluir (ordem recuperável): se o
  // restoreStockAdmin acima lançar, stockRestoredAt continua null e a varredura
  // de recuperação reprocessa no próximo run.
  await orderRef.update({
    stockRestoredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return adjustments.length > 0;
}

/**
 * Varredura de recuperação: pedidos JÁ expirados cujo restauro de estoque ficou
 * pendente (stockRestoredAt==null gravado no flip, mas restoreStockAdmin não
 * concluiu num run anterior). Idempotente via o guard stockRestoredAt — pedidos
 * já restaurados têm timestamp (string), não null, e não entram nesta query.
 */
async function recoverPendingRestores(
  businessId: string,
  summary: TenantSummary,
): Promise<void> {
  let snap;
  try {
    snap = await adminDb
      .collection('deliveryOrders')
      .where('businessId', '==', businessId)
      .where('paymentFsmStatus', '==', 'expired')
      .where('stockRestoredAt', '==', null)
      .limit(MAX_ORDERS_PER_TENANT)
      .get();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('index')) {
      summary.error =
        'Composite index ausente para deliveryOrders(businessId, paymentFsmStatus, stockRestoredAt). Crie via firestore.indexes.json.';
      return;
    }
    summary.error = msg;
    return;
  }

  for (const doc of snap.docs) {
    const order = doc.data() as DeliveryOrder;
    if (!order.stockDeductedAt) continue; // nada a restaurar
    try {
      const restored = await restoreOrderStock(order, doc.id);
      if (restored) summary.stockRecovered++;
    } catch (err) {
      summary.failed++;
      console.error(
        `[mp-cron/expire-pix] recover tenant ${businessId} pedido ${doc.id} falhou:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function expireTenant(businessId: string, nowIso: string): Promise<TenantSummary> {
  const summary: TenantSummary = {
    businessId,
    expired: 0,
    stockRestored: 0,
    stockRecovered: 0,
    failed: 0,
  };

  // 1) Recupera restauros pendentes de runs anteriores (residual). Roda ANTES da
  //    fase de expiração pra não competir, no mesmo ciclo, com pedidos recém
  //    flipados (esses, se o restauro falhar, viram residual do PRÓXIMO run).
  await recoverPendingRestores(businessId, summary);

  let snap;
  try {
    snap = await adminDb
      .collection('deliveryOrders')
      .where('businessId', '==', businessId)
      .where('paymentFsmStatus', '==', 'pending')
      .where('paymentExpiresAt', '<=', nowIso)
      .limit(MAX_ORDERS_PER_TENANT)
      .get();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('index')) {
      summary.error =
        'Composite index ausente para deliveryOrders(businessId, paymentFsmStatus, paymentExpiresAt). Crie via firestore.indexes.json.';
      return summary;
    }
    summary.error = msg;
    return summary;
  }

  for (const doc of snap.docs) {
    const order = doc.data() as DeliveryOrder;
    // Só PIX — cartão pendente não "expira" por QR. (Filtro em código p/ manter
    // o index com 3 campos; pedidos não-PIX no estado pending são raros.)
    if (order.paymentMethodKind && order.paymentMethodKind !== 'pix') continue;

    const orderRef = doc.ref;
    try {
      // CAS atômica: só flipa se ainda está pending (single-shot).
      const flipped = await adminDb.runTransaction<{ shouldRestore: boolean } | null>(
        async (tx) => {
          const fresh = await tx.get(orderRef);
          if (!fresh.exists) return null;
          const cur = fresh.data() as DeliveryOrder;
          if (cur.businessId !== businessId) return null; // R1 re-check
          const from: PaymentFsmStatus = cur.paymentFsmStatus ?? 'pending';
          if (from !== 'pending') return null; // já decidido por webhook/outro run
          assertTransitionPayment(from, 'expired');
          const shouldRestore = !!cur.stockDeductedAt && !cur.stockRestoredAt;
          const update: Record<string, unknown> = {
            paymentFsmStatus: 'expired',
            updatedAt: nowIso,
          };
          // Claim explícito do restauro: grava null pra que a varredura de
          // recuperação (stockRestoredAt==null) reprocesse caso o restoreStockAdmin
          // abaixo falhe — o flip→expired NÃO terminaliza o estoque.
          if (shouldRestore) update.stockRestoredAt = null;
          tx.update(orderRef, update);
          return { shouldRestore };
        },
      );

      if (!flipped) continue;
      summary.expired++;

      if (flipped.shouldRestore) {
        const restored = await restoreOrderStock(order, doc.id);
        if (restored) summary.stockRestored++;
      }
    } catch (err) {
      summary.failed++;
      console.error(
        `[mp-cron/expire-pix] tenant ${businessId} pedido ${doc.id} falhou:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return summary;
}

async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) return unauthorized();

  try {
    const nowIso = new Date().toISOString();
    const businessIds = await listConnectedBusinessIds();
    const tenants: TenantSummary[] = [];

    for (const businessId of businessIds) {
      try {
        tenants.push(await expireTenant(businessId, nowIso));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[mp-cron/expire-pix] tenant ${businessId} falhou:`, msg);
        tenants.push({
          businessId,
          expired: 0,
          stockRestored: 0,
          stockRecovered: 0,
          failed: 0,
          error: msg,
        });
      }
    }

    const summary = {
      scannedTenants: tenants.length,
      expired: tenants.reduce((s, t) => s + t.expired, 0),
      stockRestored: tenants.reduce((s, t) => s + t.stockRestored, 0),
      stockRecovered: tenants.reduce((s, t) => s + t.stockRecovered, 0),
      failed: tenants.reduce((s, t) => s + t.failed, 0),
      tenants,
    };
    console.log('[mp-cron/expire-pix] resumo:', JSON.stringify({ ...summary, tenants: undefined }));
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[mp-cron/expire-pix] falha geral:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
