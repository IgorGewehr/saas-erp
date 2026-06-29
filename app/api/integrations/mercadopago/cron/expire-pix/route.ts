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
import type { DeliveryOrder } from '@/lib/types';
import { restoreOrderStockRecoverable } from '@/lib/services/order-stock-restore';
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
  // Delega ao helper ÚNICO (lib/services/order-stock-restore) — fonte da verdade
  // do restauro recuperável (claim distinguível + linhas com modificadores).
  return restoreOrderStockRecoverable(orderId, businessId, {
    operatorName: 'Cron PIX expirado',
    context: 'PIX expirado',
  });
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
