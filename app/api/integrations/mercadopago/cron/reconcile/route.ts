/**
 * GET/POST /api/integrations/mercadopago/cron/reconcile
 *
 * Cron de resiliência — recupera webhooks PERDIDOS do Mercado Pago. Re-consulta
 * o MP e drena cada pedido via settlePaymentNotification — exatamente o mesmo
 * caminho autoritativo do webhook (GET /v1/payments/{id} + guard de FSM +
 * idempotência por payment.id). Duas varreduras complementares:
 *
 *   1. APROVAÇÃO perdida: pedidos pending|authorized com externalPaymentId. Se o
 *      pagamento aprovou e o webhook não chegou, a reconciliação o liquida.
 *   2. ESTORNO perdido (BLOCKER): pedidos refunded|failed cujos EFEITOS de
 *      reversão ficaram pendentes (estoque não restaurado OU receita não
 *      estornada). settlePaymentNotification re-aplica os efeitos por
 *      ESTADO-DESEJADO (guards CAS garantem idempotência) — sem isto, um
 *      estorno/chargeback com webhook perdido nunca recuperava estoque/caixa.
 *
 * Recomendação: rodar a cada 5–15 min (ex: `*\/10 * * * *`).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Resiliência:
 *   - Varre tenant a tenant (businesses com mpConnected; nunca full-scan).
 *   - Query por-tenant filtra businessId (R1) + provider + FSM (indexado).
 *   - try/catch POR PEDIDO e POR TENANT — uma falha não trava a varredura.
 *   - needsManualReview: pulado em ambas as varreduras — o cron NÃO re-tenta
 *     cegamente pedidos sinalizados (refund parcial, valor/transição divergente).
 *   - Idempotente: settlePaymentNotification re-consulta o MP; pedidos já
 *     liquidados/estornados viram no-op e os guards CAS impedem efeito duplo.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { DeliveryOrder } from '@/lib/types';
import { settlePaymentNotification } from '@/lib/services/mercadopago/webhook-settle';
import { isCronAuthorized, unauthorized, listConnectedBusinessIds } from '../_shared';

export const maxDuration = 60;

/** Máximo de pedidos re-consultados por tenant por execução (por varredura). */
const MAX_ORDERS_PER_TENANT = 100;

/** Teto da varredura GLOBAL de órfãos de estorno (read-only, observabilidade). */
const MAX_ORPHAN_SCAN = 300;

/** Janela "recente" (horas) dos sinais operacionais agregados ao fim do run. */
const RECENT_WINDOW_HOURS = 24;

/** Guards de reversão que vivem no pedido mas não no tipo base (espelha
 *  transaction-reversal.ts e os campos gravados por webhook-settle). */
type OrderWithReviewGuard = DeliveryOrder & {
  needsManualReview?: boolean;
  transactionReversedAt?: string;
};

interface TenantSummary {
  businessId: string;
  candidates: number;
  settled: number;
  noop: number;
  /** Pedidos refunded|failed com efeitos de reversão re-aplicados (recuperação). */
  reversalRecovered: number;
  /** Pedidos pulados por needsManualReview (não re-tentados). */
  manualReview: number;
  failed: number;
  error?: string;
}

/** Efeitos de reversão pendentes: estoque debitado e não restaurado, OU receita
 *  lançada e não estornada. stockRestoredAt=null (claim) conta como pendente. */
function reversalEffectsPending(order: OrderWithReviewGuard): boolean {
  const stockPending = !!order.stockDeductedAt && typeof order.stockRestoredAt !== 'string';
  const txPending = !!order.transactionId && typeof order.transactionReversedAt !== 'string';
  return stockPending || txPending;
}

/** Varredura 1 — aprovação perdida (pending|authorized). */
async function reconcileOpenPayments(
  businessId: string,
  summary: TenantSummary,
): Promise<void> {
  let snap;
  try {
    snap = await adminDb
      .collection('deliveryOrders')
      .where('businessId', '==', businessId)
      .where('paymentProvider', '==', 'mercadopago')
      .where('paymentFsmStatus', 'in', ['pending', 'authorized'])
      .limit(MAX_ORDERS_PER_TENANT)
      .get();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('index')) {
      summary.error =
        'Composite index ausente para deliveryOrders(businessId, paymentProvider, paymentFsmStatus). Crie via firestore.indexes.json.';
      return;
    }
    summary.error = msg;
    return;
  }

  for (const doc of snap.docs) {
    const order = doc.data() as OrderWithReviewGuard;
    if (order.needsManualReview) {
      summary.manualReview++;
      continue;
    }
    const externalPaymentId = order.externalPaymentId;
    if (!externalPaymentId) continue; // cobrança nunca criada → nada a reconsultar
    summary.candidates++;
    try {
      const result = await settlePaymentNotification({
        type: 'payment',
        dataId: externalPaymentId,
      });
      if (result.paymentFsmStatus === 'paid' || result.paymentFsmStatus === 'refunded') {
        summary.settled++;
      } else {
        summary.noop++;
      }
    } catch (err) {
      summary.failed++;
      console.error(
        `[mp-cron/reconcile] tenant ${businessId} pedido ${doc.id} (${externalPaymentId}) falhou:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/** Varredura 2 — estorno perdido (BLOCKER): pedidos refunded|failed cujos efeitos
 *  de reversão ficaram pendentes. Re-drena pelo MESMO caminho autoritativo; o
 *  settlePaymentNotification re-aplica estoque/estorno por estado-desejado. */
async function recoverReversalEffects(
  businessId: string,
  summary: TenantSummary,
): Promise<void> {
  let snap;
  try {
    snap = await adminDb
      .collection('deliveryOrders')
      .where('businessId', '==', businessId)
      .where('paymentProvider', '==', 'mercadopago')
      .where('paymentFsmStatus', 'in', ['refunded', 'failed'])
      .limit(MAX_ORDERS_PER_TENANT)
      .get();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes('index')) {
      summary.error =
        'Composite index ausente para deliveryOrders(businessId, paymentProvider, paymentFsmStatus). Crie via firestore.indexes.json.';
      return;
    }
    summary.error = msg;
    return;
  }

  for (const doc of snap.docs) {
    const order = doc.data() as OrderWithReviewGuard;
    if (order.needsManualReview) {
      summary.manualReview++;
      continue;
    }
    if (!reversalEffectsPending(order)) continue; // efeitos já aplicados → nada a fazer
    const externalPaymentId = order.externalPaymentId;
    if (!externalPaymentId) continue;
    try {
      await settlePaymentNotification({ type: 'payment', dataId: externalPaymentId });
      // Re-leitura para confirmar que os efeitos drenaram (idempotente).
      const fresh = (await doc.ref.get()).data() as OrderWithReviewGuard | undefined;
      if (fresh && !reversalEffectsPending(fresh)) summary.reversalRecovered++;
    } catch (err) {
      summary.failed++;
      console.error(
        `[mp-cron/reconcile] reversal tenant ${businessId} pedido ${doc.id} (${externalPaymentId}) falhou:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

interface OrphanReversalAlert {
  /** Pedidos refunded|failed com efeitos pendentes em tenants SEM MP conectado. */
  orphanedReversalsPending: number;
  /** Tenants distintos afetados. */
  affectedTenants: number;
  /** Teto MAX_ORPHAN_SCAN atingido → a contagem pode estar SUBESTIMADA (backlog
   *  maior que o cap). Sinaliza pra não ler o número como completo. */
  scanCapReached?: boolean;
  /** Erro de índice/consulta — degrada gracioso, não interrompe o run. */
  error?: string;
}

/**
 * MP-03 — ALERTA (read-only): pedidos refunded|failed cujos EFEITOS de reversão
 * ficaram pendentes em tenants que DESCONECTARAM o MP. Sem token, este cron NÃO
 * consegue re-drenar (settlePaymentNotification re-consulta o MP), então em vez de
 * silenciosamente não recuperar, CONTABILIZA e emite console.warn estruturado para
 * disparar reconexão/intervenção manual. NÃO muda estado financeiro.
 *
 * Varredura GLOBAL indexada (single-field `in` é auto-indexado — nunca full-scan),
 * filtrada em código por provider + tenant-desconectado + efeitos pendentes. Cap
 * MAX_ORPHAN_SCAN. Tenants conectados são pulados — já são tratados pelas varreduras
 * autoritativas acima.
 */
async function alertOrphanedReversals(connected: Set<string>): Promise<OrphanReversalAlert> {
  let snap;
  try {
    snap = await adminDb
      .collection('deliveryOrders')
      .where('paymentFsmStatus', 'in', ['refunded', 'failed'])
      .limit(MAX_ORPHAN_SCAN)
      .get();
  } catch (err) {
    return {
      orphanedReversalsPending: 0,
      affectedTenants: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const perTenant = new Map<string, number>();
  for (const doc of snap.docs) {
    const order = doc.data() as OrderWithReviewGuard;
    if (order.paymentProvider !== 'mercadopago') continue;
    if (!order.businessId || connected.has(order.businessId)) continue; // conectado → já tratado
    if (!reversalEffectsPending(order)) continue;
    perTenant.set(order.businessId, (perTenant.get(order.businessId) ?? 0) + 1);
  }

  // Teto atingido → a varredura global pode ter SUBESTIMADO o backlog real.
  const scanCapReached = snap.size >= MAX_ORPHAN_SCAN;
  const orphanedReversalsPending = [...perTenant.values()].reduce((s, n) => s + n, 0);
  if (orphanedReversalsPending > 0 || scanCapReached) {
    console.warn(
      '[mp-cron/reconcile] ALERTA órfãos de estorno (MP desconectado, efeitos pendentes):',
      JSON.stringify({
        orphanedReversalsPending,
        affectedTenants: perTenant.size,
        scanCapReached,
        ...(scanCapReached ? { hintCap: `varredura atingiu o teto de ${MAX_ORPHAN_SCAN} — contagem possivelmente subestimada; pagine/eleve o cap.` } : {}),
        tenants: [...perTenant.entries()].map(([businessId, pending]) => ({ businessId, pending })),
        hint: 'Reconectar o Mercado Pago do tenant ou tratar manualmente o estorno (estoque/receita).',
      }),
    );
  }
  return { orphanedReversalsPending, affectedTenants: perTenant.size, scanCapReached };
}

interface OperationalSignals {
  /** -1 = sinal indisponível (consulta falhou; não-fatal). */
  settleMismatchRecent: number;
  unmatchedPaymentsRecent: number;
  ordersNeedingReview: number;
  windowHours: number;
}

/**
 * Observability — conta sinais operacionais ao final do run (read-only, NÃO muda
 * estado financeiro): settleMismatch + unmatchedPayments criados na janela recente,
 * e o backlog atual de pedidos com needsManualReview. Cada contagem é isolada
 * (try/catch → -1) — um sinal indisponível não quebra o run nem os demais.
 */
async function tallyOperationalSignals(): Promise<OperationalSignals> {
  const cutoffIso = new Date(Date.now() - RECENT_WINDOW_HOURS * 3_600_000).toISOString();
  const safeCount = async (run: () => Promise<number>): Promise<number> => {
    try {
      return await run();
    } catch {
      return -1;
    }
  };

  const [settleMismatchRecent, unmatchedPaymentsRecent, ordersNeedingReview] = await Promise.all([
    safeCount(async () =>
      (
        await adminDb.collection('settleMismatch').where('createdAt', '>=', cutoffIso).count().get()
      ).data().count,
    ),
    safeCount(async () =>
      (
        await adminDb
          .collection('unmatchedPayments')
          .where('createdAt', '>=', cutoffIso)
          .count()
          .get()
      ).data().count,
    ),
    safeCount(async () =>
      (
        await adminDb.collection('deliveryOrders').where('needsManualReview', '==', true).count().get()
      ).data().count,
    ),
  ]);

  return {
    settleMismatchRecent,
    unmatchedPaymentsRecent,
    ordersNeedingReview,
    windowHours: RECENT_WINDOW_HOURS,
  };
}

async function reconcileTenant(businessId: string): Promise<TenantSummary> {
  const summary: TenantSummary = {
    businessId,
    candidates: 0,
    settled: 0,
    noop: 0,
    reversalRecovered: 0,
    manualReview: 0,
    failed: 0,
  };

  await reconcileOpenPayments(businessId, summary);
  await recoverReversalEffects(businessId, summary);

  return summary;
}

async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) return unauthorized();

  try {
    const businessIds = await listConnectedBusinessIds();
    const connectedSet = new Set(businessIds);
    const tenants: TenantSummary[] = [];

    for (const businessId of businessIds) {
      try {
        tenants.push(await reconcileTenant(businessId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[mp-cron/reconcile] tenant ${businessId} falhou:`, msg);
        tenants.push({
          businessId,
          candidates: 0,
          settled: 0,
          noop: 0,
          reversalRecovered: 0,
          manualReview: 0,
          failed: 0,
          error: msg,
        });
      }
    }

    // Read-only, pós-varreduras: alerta de órfãos (MP-03) + sinais operacionais.
    const [orphanedReversals, signals] = await Promise.all([
      alertOrphanedReversals(connectedSet),
      tallyOperationalSignals(),
    ]);

    const summary = {
      scannedTenants: tenants.length,
      candidates: tenants.reduce((s, t) => s + t.candidates, 0),
      settled: tenants.reduce((s, t) => s + t.settled, 0),
      noop: tenants.reduce((s, t) => s + t.noop, 0),
      reversalRecovered: tenants.reduce((s, t) => s + t.reversalRecovered, 0),
      manualReview: tenants.reduce((s, t) => s + t.manualReview, 0),
      failed: tenants.reduce((s, t) => s + t.failed, 0),
      orphanedReversals,
      signals,
      tenants,
    };
    console.log('[mp-cron/reconcile] resumo:', JSON.stringify({ ...summary, tenants: undefined }));
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    console.error('[mp-cron/reconcile] falha geral:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
