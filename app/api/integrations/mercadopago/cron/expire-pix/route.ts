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
 *   - R1: cada pedido é tocado SÓ com seu próprio businessId — re-conferido dentro
 *     de cada transação (cur.businessId !== order.businessId → aborta).
 *   - M6 (órfãos): a varredura NÃO depende de mpConnected. O flip pending→expired
 *     e o restauro de estoque são operações LOCAIS (não precisam de token MP), logo
 *     selecionamos pedidos PIX pending vencidos GLOBALMENTE (cross-tenant, query
 *     indexada — nunca full-scan), inclusive de tenants que desconectaram o MP.
 *     Sem isto, pedidos pendentes viravam órfãos eternos ao desconectar a conta.
 *   - M7 (starvation): as duas varreduras ordenam asc (paymentExpiresAt / updatedAt)
 *     e têm teto GLOBAL por execução. Servindo sempre o pedido que espera há mais
 *     tempo primeiro, nenhum tenant fica permanentemente atrás do cap.
 *   - FSM: CAS atômica pending→expired (assertTransitionPayment) dentro de tx —
 *     só UM run flipa cada pedido; depois ele sai da query (não é mais pending).
 *   - Estoque RECUPERÁVEL: o flip pending→expired NÃO terminaliza o restauro.
 *     Quando o pedido tem estoque debitado a restaurar, o flip grava
 *     `stockRestoredAt: null` (claim explícito) no MESMO tx; o restauro corre
 *     logo após. Se o restauro falhar, o campo fica null e uma VARREDURA de
 *     recuperação (paymentFsmStatus=='expired' && stockRestoredAt==null) o
 *     reprocessa no próximo run — não há vazamento de estoque por webhook/restore
 *     perdido.
 *   - M4 (TOCTOU): o restauro REIVINDICA o claim DENTRO de runTransaction (CAS)
 *     ANTES de chamar restoreStockAdmin (que NÃO é idempotente) — espelha
 *     restoreOrderStockOnReversal do webhook-settle. O guard `typeof
 *     stockRestoredAt === 'string'` rejeita o pedido se outro run já concluiu o
 *     restauro entre a query e o claim, evitando duplo-incremento de estoque.
 *     Idempotência: restoreStockAdmin grava timestamp em stockRestoredAt ao
 *     concluir; o pedido some da varredura (null → string). Ordem das operações:
 *     restaurar estoque PRIMEIRO, gravar o timestamp DEPOIS — falha deixa o
 *     pedido elegível pra retry.
 *   - Estoque: reconstrói as MESMAS linhas debitadas na criação (itens +
 *     modificadores com linkedProductId), via restoreStockAdmin (BOM expandido).
 *   - try/catch POR PEDIDO; índices ausentes reportados em `errors[]`.
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
import { isCronAuthorized, unauthorized } from '../_shared';

export const maxDuration = 60;

/** Teto GLOBAL de pedidos vencidos flipados por execução (cross-tenant, justo). */
const MAX_EXPIRE_PER_RUN = 300;
/** Teto GLOBAL de restauros residuais reprocessados por execução. */
const MAX_RECOVER_PER_RUN = 300;

interface TenantSummary {
  businessId: string;
  expired: number;
  stockRestored: number;
  /** Restauros reprocessados pela varredura de recuperação (residual de runs
   *  anteriores cujo restauro falhou após o flip→expired). */
  stockRecovered: number;
  failed: number;
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

/**
 * Restaura, idempotentemente, o estoque debitado na criação do pedido. Espelha
 * restoreOrderStockOnReversal do webhook-settle (ordem RECUPERÁVEL):
 *   1. M4 — CAS claim DENTRO da tx ANTES de restaurar: lê o estado FRESCO e grava
 *      stockRestoredAt=null (claim queryável) só se ainda não há timestamp string.
 *      restoreStockAdmin NÃO é idempotente, então a exclusão tem de acontecer aqui.
 *   2. Reconstrói as mesmas linhas (itens + modificadores com linkedProductId,
 *      BOM expandido por restoreStockAdmin) e restaura.
 *   3. Grava o timestamp em stockRestoredAt SÓ APÓS concluir.
 * Se restoreStockAdmin falhar (passo 2), stockRestoredAt fica null e a varredura
 * de recuperação reprocessa no próximo run — sem vazamento de estoque.
 */
async function restoreOrderStock(orderId: string, businessId: string): Promise<boolean> {
  const orderRef = adminDb.collection('deliveryOrders').doc(orderId);

  // Claim recuperável: marca stockRestoredAt=null DENTRO da tx ANTES de restaurar.
  // Guard de já-restaurado = timestamp string (null/undefined ainda são elegíveis).
  const order = await adminDb.runTransaction(async (tx) => {
    const s = await tx.get(orderRef);
    if (!s.exists) return null;
    const o = s.data() as DeliveryOrder;
    if (o.businessId !== businessId) return null; // R1 re-check
    if (!o.stockDeductedAt) return null; // nada debitado a restaurar
    if (typeof o.stockRestoredAt === 'string') return null; // já restaurado
    // Claim distinguível com janela de obsolescência (~5min): outro run em
    // progresso (claim recente) não restaura de novo; claim antigo (run que
    // crashou) volta a ser elegível — recupera sem duplo-restauro concorrente.
    const claimedAt = o.stockRestoreClaimedAt;
    if (typeof claimedAt === 'string' && Date.now() - Date.parse(claimedAt) < 5 * 60 * 1000) return null;
    const nowIso = new Date().toISOString();
    tx.update(orderRef, {
      stockRestoreClaimedAt: nowIso,
      stockRestoredAt: null,
      updatedAt: nowIso,
    });
    return o;
  });
  if (!order) return false;

  const itemIds = (order.items ?? []).map((i) => i.productId);
  if (itemIds.length === 0) return false;

  // 1º passe: carrega os produtos dos itens p/ descobrir linkedProductIds dos
  // modificadores; 2º passe: índice completo (itens + insumos) p/ a restauração.
  const itemIndex = await loadProductIndex(adminDb, itemIds, businessId);
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

  const productIndex = await loadProductIndex(adminDb, [...itemIds, ...linkedIds], businessId);
  const lines = buildStockLines(order, productIndex);

  const adjustments = await restoreStockAdmin(adminDb, lines, {
    businessId,
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
 * Varredura de recuperação GLOBAL (cross-tenant): pedidos JÁ expirados cujo
 * restauro de estoque ficou pendente (stockRestoredAt==null gravado no flip, mas
 * restoreStockAdmin não concluiu num run anterior). Independente de mpConnected
 * (M6 — é operação local). Ordenada por updatedAt asc (M7 — pendência mais antiga
 * primeiro). Idempotente via o guard stockRestoredAt — pedidos já restaurados têm
 * timestamp (string), não null, e não entram nesta query.
 */
async function recoverPendingRestores(
  getSummary: (businessId: string) => TenantSummary,
  errors: string[],
): Promise<void> {
  let snap;
  try {
    snap = await adminDb
      .collection('deliveryOrders')
      .where('paymentFsmStatus', '==', 'expired')
      .where('stockRestoredAt', '==', null)
      .orderBy('updatedAt', 'asc')
      .limit(MAX_RECOVER_PER_RUN)
      .get();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('index')) {
      errors.push(
        'Composite index ausente para deliveryOrders(paymentFsmStatus, stockRestoredAt, updatedAt). Crie via firestore.indexes.json.',
      );
      return;
    }
    errors.push(msg);
    return;
  }

  for (const doc of snap.docs) {
    const order = doc.data() as DeliveryOrder;
    if (!order.businessId) continue; // doc inconsistente — não toca
    if (!order.stockDeductedAt) continue; // nada a restaurar
    const summary = getSummary(order.businessId);
    try {
      const restored = await restoreOrderStock(doc.id, order.businessId);
      if (restored) summary.stockRecovered++;
    } catch (err) {
      summary.failed++;
      console.error(
        `[mp-cron/expire-pix] recover tenant ${order.businessId} pedido ${doc.id} falhou:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Varredura de expiração GLOBAL (cross-tenant): pedidos PIX pending cujo
 * paymentExpiresAt já passou. Independente de mpConnected (M6) e ordenada por
 * paymentExpiresAt asc (M7 — vencidos há mais tempo primeiro). Query indexada
 * (nunca full-scan), teto global MAX_EXPIRE_PER_RUN.
 */
async function expirePendingPix(
  nowIso: string,
  getSummary: (businessId: string) => TenantSummary,
  errors: string[],
): Promise<void> {
  let snap;
  try {
    snap = await adminDb
      .collection('deliveryOrders')
      .where('paymentFsmStatus', '==', 'pending')
      .where('paymentExpiresAt', '<=', nowIso)
      .orderBy('paymentExpiresAt', 'asc')
      .limit(MAX_EXPIRE_PER_RUN)
      .get();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('index')) {
      errors.push(
        'Composite index ausente para deliveryOrders(paymentFsmStatus, paymentExpiresAt). Crie via firestore.indexes.json.',
      );
      return;
    }
    errors.push(msg);
    return;
  }

  for (const doc of snap.docs) {
    const order = doc.data() as DeliveryOrder;
    if (!order.businessId) continue; // doc inconsistente — não toca
    // Só PIX — cartão pendente não "expira" por QR. (Filtro em código p/ manter
    // o index com 2 campos; pedidos não-PIX no estado pending são raros.)
    if (order.paymentMethodKind && order.paymentMethodKind !== 'pix') continue;

    const businessId = order.businessId;
    const summary = getSummary(businessId);
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
          const shouldRestore = !!cur.stockDeductedAt && typeof cur.stockRestoredAt !== 'string';
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
        const restored = await restoreOrderStock(doc.id, businessId);
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
}

async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) return unauthorized();

  try {
    const nowIso = new Date().toISOString();
    const tenants = new Map<string, TenantSummary>();
    const getSummary = (businessId: string): TenantSummary => {
      let s = tenants.get(businessId);
      if (!s) {
        s = { businessId, expired: 0, stockRestored: 0, stockRecovered: 0, failed: 0 };
        tenants.set(businessId, s);
      }
      return s;
    };
    const errors: string[] = [];

    // 1) Recupera restauros pendentes de runs anteriores (residual). Roda ANTES da
    //    fase de expiração pra não competir, no mesmo ciclo, com pedidos recém
    //    flipados (esses, se o restauro falhar, viram residual do PRÓXIMO run).
    await recoverPendingRestores(getSummary, errors);
    await expirePendingPix(nowIso, getSummary, errors);

    const tenantList = [...tenants.values()];
    const summary = {
      scannedTenants: tenantList.length,
      expired: tenantList.reduce((s, t) => s + t.expired, 0),
      stockRestored: tenantList.reduce((s, t) => s + t.stockRestored, 0),
      stockRecovered: tenantList.reduce((s, t) => s + t.stockRecovered, 0),
      failed: tenantList.reduce((s, t) => s + t.failed, 0),
      tenants: tenantList,
      ...(errors.length ? { errors } : {}),
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
