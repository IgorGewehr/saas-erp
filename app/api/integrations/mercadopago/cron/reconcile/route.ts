/**
 * GET/POST /api/integrations/mercadopago/cron/reconcile
 *
 * Cron de resiliência — recupera webhooks PERDIDOS do Mercado Pago. Re-consulta
 * o MP para pagamentos ainda não-liquidados (paymentFsmStatus pending|authorized
 * com externalPaymentId já gravado) e drena cada um via settlePaymentNotification
 * — exatamente o mesmo caminho autoritativo do webhook (GET /v1/payments/{id} +
 * guard de FSM + idempotência por payment.id). Se o pagamento aprovou e o
 * webhook não chegou, a reconciliação o liquida.
 *
 * Recomendação: rodar a cada 5–15 min (ex: `*\/10 * * * *`).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}.
 *
 * Resiliência:
 *   - Varre tenant a tenant (businesses com mpConnected; nunca full-scan).
 *   - Query por-tenant filtra businessId (R1) + provider + FSM aberta (indexado).
 *   - try/catch POR PEDIDO e POR TENANT — uma falha não trava a varredura.
 *   - Idempotente: settlePaymentNotification deduplica por payment.id; pedidos
 *     já liquidados viram no-op.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { DeliveryOrder } from '@/lib/types';
import { settlePaymentNotification } from '@/lib/services/mercadopago/webhook-settle';
import { isCronAuthorized, unauthorized, listConnectedBusinessIds } from '../_shared';

export const maxDuration = 60;

/** Máximo de pedidos re-consultados por tenant por execução. */
const MAX_ORDERS_PER_TENANT = 100;

interface TenantSummary {
  businessId: string;
  candidates: number;
  settled: number;
  noop: number;
  failed: number;
  error?: string;
}

async function reconcileTenant(businessId: string): Promise<TenantSummary> {
  const summary: TenantSummary = {
    businessId,
    candidates: 0,
    settled: 0,
    noop: 0,
    failed: 0,
  };

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
      return summary;
    }
    summary.error = msg;
    return summary;
  }

  for (const doc of snap.docs) {
    const order = doc.data() as DeliveryOrder;
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

  return summary;
}

async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) return unauthorized();

  try {
    const businessIds = await listConnectedBusinessIds();
    const tenants: TenantSummary[] = [];

    for (const businessId of businessIds) {
      try {
        tenants.push(await reconcileTenant(businessId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[mp-cron/reconcile] tenant ${businessId} falhou:`, msg);
        tenants.push({ businessId, candidates: 0, settled: 0, noop: 0, failed: 0, error: msg });
      }
    }

    const summary = {
      scannedTenants: tenants.length,
      candidates: tenants.reduce((s, t) => s + t.candidates, 0),
      settled: tenants.reduce((s, t) => s + t.settled, 0),
      noop: tenants.reduce((s, t) => s + t.noop, 0),
      failed: tenants.reduce((s, t) => s + t.failed, 0),
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
