/**
 * lib/services/mercadopago/webhook-settle.ts
 *
 * Liquidação de uma notificação de pagamento do Mercado Pago. SERVER-ONLY.
 *
 * O webhook do MP só entrega `type` + `data.id` (id do payment). NUNCA confiamos
 * no payload: RE-CONSULTAMOS GET /v1/payments/{id} com o token do tenant e
 * decidimos o dinheiro a partir da resposta autoritativa do MP.
 *
 * Defesas:
 *   - R1: businessId validado contra o external_reference do payment.
 *   - Idempotência REAL = CAS de status na FSM dentro do runTransaction: cada
 *     notificação SEMPRE re-consulta o MP (status autoritativo) e aplica a
 *     transição via canTransitionPayment/assertTransitionPayment. Reaplicar o
 *     mesmo status = no-op; pending→paid→refunded fluem normalmente. NÃO há
 *     dedup keyado em payment.id (colapsaria o ciclo do pedido em 1 evento).
 *   - Guard de status dentro de runTransaction (sem race entre webhooks).
 *   - Conferência de valor pago × esperado (tolerância 1 centavo).
 *   - live_mode do pagamento × mpLiveMode do tenant (sandbox não liquida real).
 *   - assertTransitionPayment antes de qualquer mudança de FSM.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import { dispatchDomainEvent } from '@/contracts/_runtime/dispatch';
import { parseExternalReference } from '@/contracts/domain/payment';
import {
  assertTransitionPayment,
  canTransitionPayment,
  type PaymentFsmStatus,
} from '@/contracts/fsm/payment';
import type { DeliveryOrder, Product } from '@/lib/types';
import {
  loadProductIndex,
  restoreStockAdmin,
  type StockDeductionLine,
} from '@/lib/services/stock-admin';
import { reverseDeliveryOrderRevenue } from '@/lib/services/transaction-reversal';
import { getMpAccessToken } from './auth';
import { mpFetch } from './client';

const AMOUNT_TOLERANCE = 0.011; // ~1 centavo

interface MpPaymentDetail {
  id: number | string;
  status: string;
  status_detail?: string;
  external_reference?: string;
  transaction_amount?: number;
  transaction_details?: { total_paid_amount?: number };
  payment_method_id?: string;
  payment_type_id?: string;
  live_mode?: boolean;
}

export interface SettleResult {
  /** type !== 'payment' → ignorado. */
  ignored?: boolean;
  /** Não foi possível resolver o pedido/tenant a partir do payment. */
  unmatched?: boolean;
  /** @deprecated Conflito "outro payment.id já pagou" é inalcançável (o pedido é
   *  resolvido por externalPaymentId==dataId). Campo mantido por compatibilidade
   *  de tipo com callers; nunca mais é produzido. */
  alert?: boolean;
  /** Valor pago divergente do esperado → não marcado como pago. */
  mismatch?: boolean;
  /** No-op idempotente (já estava no estado final). */
  noop?: boolean;
  /** Pagamento de outro ambiente (sandbox×prod) → ignorado, não liquida. */
  liveModeMismatch?: boolean;
  /** Razão de recusa do cartão (MP 'rejected') — pra UI reoferecer método. */
  declineReason?: string;
  businessId?: string;
  orderId?: string;
  externalPaymentId?: string;
  /** Estado final aplicado ao pedido (quando houve mudança). */
  paymentFsmStatus?: PaymentFsmStatus;
}

export async function settlePaymentNotification(args: {
  type: string;
  dataId: string;
}): Promise<SettleResult> {
  // Só pagamentos interessam (merchant_order/plan/etc. são ignorados aqui).
  if (args.type !== 'payment') return { ignored: true };

  const dataId = args.dataId;

  // Resolve o tenant SEM precisar de token: o externalPaymentId já foi gravado
  // no pedido na criação da cobrança (antes da aprovação). Isso quebra o
  // ovo-galinha (precisar de token p/ achar tenant p/ pegar token).
  const orderSnapQuery = await adminDb
    .collection('deliveryOrders')
    .where('externalPaymentId', '==', dataId)
    .limit(1)
    .get();

  if (orderSnapQuery.empty) {
    await recordUnmatched(null, dataId, 'pedido não encontrado por externalPaymentId');
    return { unmatched: true, externalPaymentId: dataId };
  }

  const orderDoc = orderSnapQuery.docs[0];
  const order = orderDoc.data() as DeliveryOrder;
  const businessId = order.businessId;
  const orderId = orderDoc.id;

  // SEM dedup por payment.id: o ciclo do PEDIDO (pending→paid→refunded) chega em
  // múltiplas notificações sobre o MESMO payment.id — colapsá-las descartaria o
  // estorno/captura. A idempotência vive no CAS de status da FSM (settleOnce
  // re-consulta o MP e só aplica transições válidas; reaplicar status = no-op).
  return settleOnce({ businessId, orderId, dataId });
}

async function settleOnce(args: {
  businessId: string;
  orderId: string;
  dataId: string;
}): Promise<SettleResult> {
  const { businessId, orderId, dataId } = args;

  // RE-CONSULTA autoritativa no MP com o token do tenant.
  const accessToken = await getMpAccessToken(businessId);
  const payment = await mpFetch<MpPaymentDetail>(
    `/v1/payments/${encodeURIComponent(dataId)}`,
    { accessToken },
  );

  // R1/R6: o external_reference do payment DEVE bater com o tenant+pedido.
  const ref = parseExternalReference(String(payment.external_reference ?? ''));
  if (ref.businessId !== businessId || ref.orderId !== orderId) {
    await recordUnmatched(businessId, dataId, 'external_reference diverge do pedido resolvido', {
      expectedBusinessId: businessId,
      expectedOrderId: orderId,
      refBusinessId: ref.businessId,
      refOrderId: ref.orderId,
    });
    return { unmatched: true, businessId, orderId, externalPaymentId: dataId };
  }

  // Ambiente: um pagamento sandbox (live_mode=false) NÃO pode liquidar um pedido
  // de uma conta produtiva (e vice-versa). Mismatch → registra e ignora.
  const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
  const tenantLiveMode = Boolean(bizSnap.data()?.mpLiveMode);
  if (typeof payment.live_mode === 'boolean' && payment.live_mode !== tenantLiveMode) {
    await recordUnmatched(businessId, dataId, 'live_mode do pagamento diverge do tenant', {
      orderId,
      paymentLiveMode: payment.live_mode,
      tenantLiveMode,
    });
    return { liveModeMismatch: true, businessId, orderId, externalPaymentId: dataId };
  }

  const paidAmount =
    payment.transaction_details?.total_paid_amount ?? payment.transaction_amount ?? 0;
  const mpStatus = payment.status;

  const orderRef = adminDb.collection('deliveryOrders').doc(orderId);

  // Decisão dentro da transação: evita race entre webhooks concorrentes.
  const outcome = await adminDb.runTransaction<SettleResult>(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      return { unmatched: true, businessId, orderId, externalPaymentId: dataId };
    }
    const current = snap.data() as DeliveryOrder;

    // R1: re-confere o tenant do doc lido.
    if (current.businessId !== businessId) {
      return { unmatched: true, businessId, orderId, externalPaymentId: dataId };
    }

    const from: PaymentFsmStatus = current.paymentFsmStatus ?? 'pending';
    const nowIso = new Date().toISOString();

    // ── Aprovação ──────────────────────────────────────────────────────────
    if (mpStatus === 'approved') {
      // Guard de pedido JÁ pago — só relevante para aprovações (refund/cancel
      // legítimos vêm DEPOIS de paid e são tratados na branch de reversão).
      // O pedido é localizado por where('externalPaymentId','==',dataId) e
      // settleOnce re-consulta GET /v1/payments/{dataId}, logo
      // String(payment.id) === current.externalPaymentId === dataId SEMPRE: não
      // existe caminho de "outro payment.id liquidando este pedido" aqui (esse
      // cenário cairia em unmatched na resolução, não nesta branch). Por isso o
      // único desfecho possível é o no-op idempotente de reentrega do MP.
      if (from === 'paid') {
        return { noop: true, businessId, orderId, externalPaymentId: dataId, paymentFsmStatus: 'paid' };
      }

      // Confere valor pago × esperado. Fonte da verdade é o total DERIVADO do
      // pedido (R6), não o mutável paymentAmount (que pode ter sido sobrescrito
      // por uma liquidação anterior com o valor pago).
      const expected = current.total ?? 0;
      if (Math.abs(paidAmount - expected) > AMOUNT_TOLERANCE) {
        tx.set(adminDb.collection('settleMismatch').doc(), {
          businessId,
          orderId,
          externalPaymentId: String(payment.id),
          expectedAmount: expected,
          paidAmount,
          reason: 'valor pago diverge do esperado',
          createdAt: nowIso,
        });
        return { mismatch: true, businessId, orderId, externalPaymentId: dataId };
      }

      // Guard FSM como CAS (espelha a branch de reversão): transição inválida
      // (ex.: MP entrega 'approved' fora de ordem após refunded/failed) vira
      // settleMismatch em vez de throw — um throw aqui viraria 500 e o MP
      // reentregaria pra sempre um estado impossível.
      if (!canTransitionPayment(from, 'paid')) {
        tx.set(adminDb.collection('settleMismatch').doc(), {
          businessId,
          orderId,
          externalPaymentId: String(payment.id),
          reason: `transição inválida ${from} → paid`,
          mpStatus,
          createdAt: nowIso,
        });
        return { mismatch: true, businessId, orderId, externalPaymentId: dataId };
      }
      assertTransitionPayment(from, 'paid');
      tx.update(orderRef, {
        paymentFsmStatus: 'paid',
        paymentStatus: 'pago',
        paymentProvider: 'mercadopago',
        externalPaymentId: String(payment.id),
        paymentMethodKind: payment.payment_method_id === 'pix' ? 'pix' : 'card',
        paymentAmount: paidAmount,
        paidAt: nowIso,
        updatedAt: nowIso,
      });
      return {
        businessId,
        orderId,
        externalPaymentId: String(payment.id),
        paymentFsmStatus: 'paid',
      };
    }

    // ── Reversão (refunded / charged_back / cancelled) ──────────────────────
    if (mpStatus === 'refunded' || mpStatus === 'charged_back' || mpStatus === 'cancelled') {
      // cancelled antes de pagar = falha; após pago = estorno.
      const target: PaymentFsmStatus =
        mpStatus === 'cancelled' && from !== 'paid' ? 'failed' : 'refunded';
      if (from === target) {
        return { noop: true, businessId, orderId, externalPaymentId: dataId, paymentFsmStatus: from };
      }
      if (!canTransitionPayment(from, target)) {
        // Reversão impossível pela FSM (ex: refund de pedido nunca pago) →
        // registra e não muda dinheiro.
        tx.set(adminDb.collection('settleMismatch').doc(), {
          businessId,
          orderId,
          externalPaymentId: String(payment.id),
          reason: `reversão inválida ${from} → ${target}`,
          mpStatus,
          createdAt: nowIso,
        });
        return { mismatch: true, businessId, orderId, externalPaymentId: dataId };
      }
      assertTransitionPayment(from, target);
      tx.update(orderRef, {
        paymentFsmStatus: target,
        ...(target === 'refunded'
          ? { paymentStatus: 'estornado', refundedAt: nowIso }
          : {}),
        externalPaymentId: String(payment.id),
        updatedAt: nowIso,
      });
      return {
        businessId,
        orderId,
        externalPaymentId: String(payment.id),
        paymentFsmStatus: target,
      };
    }

    // ── Autorização (cartão pré-autorizado, ainda não capturado) ────────────
    if (mpStatus === 'authorized' && from === 'pending') {
      assertTransitionPayment(from, 'authorized');
      tx.update(orderRef, {
        paymentFsmStatus: 'authorized',
        externalPaymentId: String(payment.id),
        updatedAt: nowIso,
      });
      return {
        businessId,
        orderId,
        externalPaymentId: String(payment.id),
        paymentFsmStatus: 'authorized',
      };
    }

    // ── Recusa de cartão ('rejected') ──────────────────────────────────────
    // Decisão unificada: recusa NÃO terminaliza. O pedido fica 'pending' (nova
    // tentativa permitida) e a razão é registrada pra UI reoferecer o método.
    // NUNCA mover pra 'failed' aqui.
    if (mpStatus === 'rejected') {
      const declineReason = payment.status_detail ?? 'rejected';
      if (from === 'pending') {
        tx.update(orderRef, {
          lastPaymentDeclineReason: declineReason,
          lastPaymentDeclineAt: nowIso,
          updatedAt: nowIso,
        });
      }
      return { noop: true, businessId, orderId, externalPaymentId: dataId, declineReason };
    }

    // pending / in_process / outros → ainda não decide dinheiro.
    return { noop: true, businessId, orderId, externalPaymentId: dataId };
  });

  // Side-effects cross-módulo FORA da transação (R5 — via eventos).
  // Gate em !outcome.noop: a reentrega do MP (from === target) retorna noop com
  // o MESMO paymentFsmStatus e NÃO deve re-disparar evento/estorno/restauro.
  if (!outcome.noop && outcome.paymentFsmStatus === 'paid') {
    await dispatchDomainEvent(adminDb, {
      type: 'payment.approved',
      businessId,
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      orderId,
      externalPaymentId: String(payment.id),
      paymentMethodKind: payment.payment_method_id === 'pix' ? 'pix' : 'card',
      amount: paidAmount,
    }).catch((err) => {
      console.error('[mp-settle] dispatch payment.approved falhou (não-fatal):', err);
    });
  } else if (!outcome.noop && (outcome.paymentFsmStatus === 'refunded' || outcome.paymentFsmStatus === 'failed')) {
    // EFEITO DIRETO (sem depender de handler de evento registrado), cross-coleção,
    // FORA da tx de FSM e idempotente — tolera reentrega do webhook:
    //   (a) restaura o estoque debitado na criação (guard stockRestoredAt, mesmo
    //       padrão do cron expire-pix);
    //   (b) só quando há receita lançada (pedido entregue → transactionId),
    //       reverte a Transaction via contra-lançamento (guard
    //       transactionReversedAt). 'failed' nunca chegou a 'paid', logo não há
    //       receita a estornar — só estoque.
    await restoreOrderStockOnReversal(orderId, businessId).catch((err) => {
      console.error('[mp-settle] restauro de estoque no estorno falhou (não-fatal):', err);
    });

    if (outcome.paymentFsmStatus === 'refunded') {
      await reverseDeliveryOrderRevenue(adminDb, {
        businessId,
        orderId,
        reason: `Estorno MP (payment ${String(payment.id)})`,
      }).catch((err) => {
        console.error('[mp-settle] estorno da Transaction falhou (não-fatal):', err);
      });

      // Mantido APENAS para auditoria (não há subscriber do qual dependamos).
      await dispatchDomainEvent(adminDb, {
        type: 'payment.refunded',
        businessId,
        occurredAt: new Date().toISOString(),
        actorType: 'system',
        orderId,
        externalPaymentId: String(payment.id),
        amount: paidAmount,
      }).catch((err) => {
        console.error('[mp-settle] dispatch payment.refunded falhou (não-fatal):', err);
      });
    }
  }

  return outcome;
}

/**
 * Restaura, idempotentemente, o estoque debitado na criação do pedido (PIX
 * público debita na criação). Espelha restoreOrderStock do cron expire-pix:
 * guard de re-leitura fresca (stockDeductedAt setado E stockRestoredAt vazio),
 * reconstrói as mesmas linhas (itens + modificadores com linkedProductId, BOM
 * expandido por restoreStockAdmin) e grava stockRestoredAt SÓ APÓS concluir
 * (ordem recuperável: falha deixa o pedido elegível a retry no próximo webhook).
 */
async function restoreOrderStockOnReversal(
  orderId: string,
  businessId: string,
): Promise<boolean> {
  const orderRef = adminDb.collection('deliveryOrders').doc(orderId);
  // CAS claim: reivindica o restauro atomicamente (grava stockRestoredAt DENTRO
  // da tx) ANTES de restaurar, pra dois webhooks de refund concorrentes não
  // restaurarem o estoque em dobro (restoreStockAdmin não é idempotente).
  // Tradeoff: se restoreStockAdmin falhar após o claim, o estoque não é
  // restaurado e não há retry automático (cenário raro — MP reentrega não
  // re-reivindica o claim já gravado).
  const order = await adminDb.runTransaction(async (tx) => {
    const s = await tx.get(orderRef);
    if (!s.exists) return null;
    const o = s.data() as DeliveryOrder;
    if (o.businessId !== businessId) return null; // R1 re-check
    if (!o.stockDeductedAt || o.stockRestoredAt) return null;
    tx.update(orderRef, {
      stockRestoredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return o;
  });
  if (!order) return false;

  const itemIds = (order.items ?? []).map((i) => i.productId);
  if (itemIds.length === 0) return false;

  // 1º passe: itens p/ descobrir linkedProductIds dos modificadores; 2º passe:
  // índice completo (itens + insumos) p/ a restauração.
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
  const lines = buildReversalStockLines(order, productIndex);

  const adjustments = await restoreStockAdmin(adminDb, lines, {
    businessId,
    operatorId: 'system',
    operatorName: 'Estorno MP (webhook)',
    sourceId: orderId,
    reason: `Estorno de estoque — pagamento estornado (pedido #${order.number ?? orderId})`,
    productIndex,
  });

  // stockRestoredAt já foi gravado no claim transacional acima.
  return adjustments.length > 0;
}

/**
 * Reconstrói as linhas de estoque debitadas na criação: linha base de cada item
 * (BOM expandido por restoreStockAdmin) + linhas dos modificadores com
 * linkedProductId. Espelha buildStockLines do cron expire-pix.
 */
function buildReversalStockLines(
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

async function recordUnmatched(
  businessId: string | null,
  dataId: string,
  reason: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await adminDb.collection('unmatchedPayments').add({
      ...(businessId ? { businessId } : {}),
      externalPaymentId: dataId,
      reason,
      ...(extra ?? {}),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[mp-settle] falha ao registrar unmatchedPayment (não-fatal):', err);
  }
}
