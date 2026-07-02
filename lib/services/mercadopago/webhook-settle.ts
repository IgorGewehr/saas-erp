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
  PAYMENT_TERMINAL_STATUSES,
  type PaymentFsmStatus,
} from '@/contracts/fsm/payment';
import type { DeliveryOrder, Transaction } from '@/lib/types';
import { restoreOrderStockRecoverable } from '@/lib/services/order-stock-restore';
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
  transaction_details?: {
    total_paid_amount?: number;
    /** Valor líquido creditado ao vendedor (bruto − taxas do MP), autoritativo. */
    net_received_amount?: number;
  };
  /** Detalhamento das taxas retidas pelo MP (mercadopago_fee, financing, etc.). */
  fee_details?: Array<{ type?: string; amount?: number; fee_payer?: string }>;
  payment_method_id?: string;
  payment_type_id?: string;
  live_mode?: boolean;
  /** Total já estornado deste pagamento (R$). MP mantém o payment 'approved' num
   *  refund PARCIAL e expõe o valor estornado aqui (fallback: soma de refunds[]). */
  transaction_amount_refunded?: number;
  refunds?: Array<{ amount?: number }>;
}

/** Total estornado: campo agregado do MP, com fallback na soma de refunds[]. */
function computeRefundedAmount(payment: MpPaymentDetail): number {
  if (typeof payment.transaction_amount_refunded === 'number') {
    return payment.transaction_amount_refunded;
  }
  return (payment.refunds ?? []).reduce((sum, r) => sum + (r.amount ?? 0), 0);
}

/**
 * Taxa do MP retida na liquidação. Fonte autoritativa é
 * transaction_details.net_received_amount (bruto − líquido); fallback na soma de
 * fee_details[]. Nunca negativa. netAmount = paidAmount − fee.
 */
function computeMpFee(
  payment: MpPaymentDetail,
  paidAmount: number,
): { mpFee: number; netAmount: number } {
  const net = payment.transaction_details?.net_received_amount;
  if (typeof net === 'number') {
    const mpFee = Math.max(0, paidAmount - net);
    return { mpFee, netAmount: net };
  }
  const mpFee = Math.max(
    0,
    (payment.fee_details ?? []).reduce((sum, f) => sum + (f.amount ?? 0), 0),
  );
  return { mpFee, netAmount: paidAmount - mpFee };
}

/** Refund PARCIAL: estornou ALGO, mas menos que o valor cheio (fora da tolerância). */
function isPartialRefund(refundedAmount: number, fullAmount: number): boolean {
  return (
    refundedAmount > AMOUNT_TOLERANCE &&
    refundedAmount < fullAmount - AMOUNT_TOLERANCE
  );
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
  /** Pedido marcado para revisão manual (refund parcial, valor/transição
   *  divergente) — o cron NÃO deve re-tentar cegamente. */
  needsManualReview?: boolean;
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
  const refundedAmount = computeRefundedAmount(payment);
  const { mpFee, netAmount } = computeMpFee(payment, paidAmount);
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

    // M2: settleMismatch com doc id DETERMINÍSTICO (orderId_externalPaymentId) →
    // dedup (re-entrega sobrescreve em vez de empilhar). Marca needsManualReview
    // no pedido pro cron de reconciliação NÃO re-tentar cegamente em loop.
    const mismatchDocId = `${orderId}_${String(payment.id)}`;
    const recordMismatch = (reason: string, extra?: Record<string, unknown>) => {
      tx.set(
        adminDb.collection('settleMismatch').doc(mismatchDocId),
        {
          businessId,
          orderId,
          externalPaymentId: String(payment.id),
          reason,
          ...(extra ?? {}),
          mpStatus,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true },
      );
      tx.update(orderRef, {
        needsManualReview: true,
        needsManualReviewReason: reason,
        updatedAt: nowIso,
      });
    };

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
        // M3: MP mantém status 'approved' num refund PARCIAL, sinalizando-o só
        // via transaction_amount_refunded/refunds[]. Refund parcial NÃO vira
        // 'refunded' cheio (perderia receita parcial) — registra settleMismatch
        // + needsManualReview para tratamento manual.
        const fullAmount = current.paymentAmount ?? current.total ?? 0;
        if (isPartialRefund(refundedAmount, fullAmount)) {
          recordMismatch('refund parcial — requer revisão manual', {
            refundedAmount,
            fullAmount,
          });
          return {
            mismatch: true,
            needsManualReview: true,
            businessId,
            orderId,
            externalPaymentId: dataId,
            paymentFsmStatus: 'paid',
          };
        }
        return { noop: true, businessId, orderId, externalPaymentId: dataId, paymentFsmStatus: 'paid' };
      }

      // Confere valor pago × esperado. Fonte da verdade é o total DERIVADO do
      // pedido (R6), não o mutável paymentAmount (que pode ter sido sobrescrito
      // por uma liquidação anterior com o valor pago).
      const expected = current.total ?? 0;
      if (Math.abs(paidAmount - expected) > AMOUNT_TOLERANCE) {
        recordMismatch('valor pago diverge do esperado', {
          expectedAmount: expected,
          paidAmount,
        });
        return { mismatch: true, needsManualReview: true, businessId, orderId, externalPaymentId: dataId };
      }

      // Guard FSM como CAS (espelha a branch de reversão): transição inválida
      // (ex.: MP entrega 'approved' fora de ordem após refunded/failed) vira
      // settleMismatch em vez de throw — um throw aqui viraria 500 e o MP
      // reentregaria pra sempre um estado impossível.
      if (!canTransitionPayment(from, 'paid')) {
        // 'approved' chega mas a FSM proíbe paid a partir de `from`.
        // - refunded: estorno já concluído; um 'approved' tardio/duplicado do MP é
        //   stale (o dinheiro já voltou) → NO-OP silencioso.
        if (from === 'refunded') {
          return { noop: true, businessId, orderId, externalPaymentId: dataId, paymentFsmStatus: from };
        }
        // - expired/failed (pedido MORTO localmente pelo cron/recusa) ou estado
        //   não-terminal inesperado: um pagamento REALMENTE aprovado aqui significa
        //   DINHEIRO RECEBIDO no MP que a FSM não consegue liquidar. NÃO engolir —
        //   sinaliza revisão manual (estornar ao cliente OU reativar o pedido).
        recordMismatch(`pagamento aprovado em pedido '${from}' — requer revisão manual (dinheiro pode ter sido recebido)`);
        return { mismatch: true, needsManualReview: true, businessId, orderId, externalPaymentId: dataId };
      }
      assertTransitionPayment(from, 'paid');

      // FIN-DEL-01: a taxa do MP é uma DESPESA real. Sem capturá-la, o lucro
      // infla e a conciliação quebra pelo bruto. Lança a taxa como Transaction de
      // despesa "Taxas de pagamento" com doc id DETERMINÍSTICO ({orderId}_mpfee):
      // como esta branch só roda na transição FRESCA (from !== 'paid', garantido
      // pelo CAS da FSM) E o id é determinístico, a reentrega do MP não duplica.
      const feeTransactionId = `${orderId}_mpfee`;
      if (mpFee > AMOUNT_TOLERANCE) {
        const feeDate = nowIso.split('T')[0];
        const feeTx: Omit<Transaction, 'id'> = {
          businessId,
          type: 'despesa',
          category: 'Taxas de pagamento',
          description: `Taxa Mercado Pago — pedido #${current.number ?? orderId}`,
          amount: mpFee,
          dueDate: feeDate,
          paymentDate: feeDate,
          status: 'pago',
          deliveryOrderId: orderId,
          notes: `Taxa retida na liquidação do payment ${String(payment.id)} (bruto ${paidAmount.toFixed(2)}, líquido ${netAmount.toFixed(2)})`,
          ...(current.clientId ? { clientId: current.clientId, contactId: current.clientId } : {}),
          ...(current.clientName ? { clientName: current.clientName } : {}),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        tx.set(adminDb.collection('transactions').doc(feeTransactionId), feeTx);
      }

      tx.update(orderRef, {
        paymentFsmStatus: 'paid',
        paymentStatus: 'pago',
        paymentProvider: 'mercadopago',
        externalPaymentId: String(payment.id),
        paymentMethodKind: payment.payment_method_id === 'pix' ? 'pix' : 'card',
        paymentAmount: paidAmount,
        mpFee,
        netAmount,
        ...(mpFee > AMOUNT_TOLERANCE ? { feeTransactionId } : {}),
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

      // M3: refund PARCIAL (estornou parte do valor) não pode marcar 'refunded'
      // cheio — isso restauraria estoque e estornaria a receita TOTAL. Registra
      // settleMismatch + needsManualReview e mantém o estado atual.
      if (target === 'refunded') {
        const fullAmount = current.paymentAmount ?? current.total ?? 0;
        if (isPartialRefund(refundedAmount, fullAmount)) {
          recordMismatch('refund parcial — requer revisão manual', {
            refundedAmount,
            fullAmount,
          });
          return { mismatch: true, needsManualReview: true, businessId, orderId, externalPaymentId: dataId };
        }
      }

      if (!canTransitionPayment(from, target)) {
        // MP-02: se o pedido JÁ está terminal (expired/refunded/failed) por
        // OUTRO caminho (cron expire-pix / estorno concorrente), uma reversão
        // tardia do MP é NO-OP silencioso — não settleMismatch/needsManualReview.
        if (PAYMENT_TERMINAL_STATUSES.has(from)) {
          return { noop: true, businessId, orderId, externalPaymentId: dataId, paymentFsmStatus: from };
        }
        // Reversão impossível a partir de estado NÃO-terminal (ex: refund de
        // pedido nunca pago) → divergência REAL: registra e não muda dinheiro.
        recordMismatch(`reversão inválida ${from} → ${target}`);
        return { mismatch: true, needsManualReview: true, businessId, orderId, externalPaymentId: dataId };
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
  //
  // Aprovação: gate em !outcome.noop — payment.approved NÃO é re-disparado na
  // reentrega (from === target já 'paid' retorna noop).
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
  }

  // Reversão: efeitos re-executáveis por ESTADO-DESEJADO. Rodam tanto na
  // transição fresca QUANTO na reentrega/recuperação (outcome.noop) — basta o
  // estado-alvo ser refunded/failed. Os guards CAS (stockRestoredAt /
  // transactionReversedAt) garantem idempotência, então re-aplicar é seguro e
  // RECUPERA efeitos de um webhook de estorno perdido (o cron reconcile reentrega
  // por este mesmo caminho quando detecta efeitos pendentes). EFEITO DIRETO (sem
  // depender de handler de evento registrado), cross-coleção, FORA da tx de FSM:
  //   (a) restaura o estoque debitado na criação (guard stockRestoredAt, mesmo
  //       padrão do cron expire-pix);
  //   (b) só quando há receita lançada (pedido entregue → transactionId), reverte
  //       a Transaction via contra-lançamento (guard transactionReversedAt).
  //       'failed' nunca chegou a 'paid', logo não há receita a estornar — só
  //       estoque.
  if (outcome.paymentFsmStatus === 'refunded' || outcome.paymentFsmStatus === 'failed') {
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

      // Evento de auditoria só na transição FRESCA (não na reentrega/recuperação),
      // pra não duplicar a trilha. Os efeitos de dinheiro acima são idempotentes;
      // o evento aqui é só registro (não há subscriber do qual dependamos).
      if (!outcome.noop) {
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
  }

  return outcome;
}

/**
 * Restaura, idempotentemente, o estoque debitado na criação do pedido (PIX
 * público debita na criação). Espelha restoreOrderStock do cron expire-pix
 * (ordem RECUPERÁVEL):
 *   1. CAS claim DENTRO da tx ANTES de restaurar: grava stockRestoredAt=null
 *      (claim explícito, queryável) só se ainda não há timestamp.
 *   2. Reconstrói as mesmas linhas (itens + modificadores com linkedProductId,
 *      BOM expandido por restoreStockAdmin) e restaura.
 *   3. Grava o timestamp em stockRestoredAt SÓ APÓS concluir.
 * Se restoreStockAdmin falhar (passo 2), stockRestoredAt fica null e a varredura
 * de recuperação do cron reconcile (refunded + restore pendente) reprocessa no
 * próximo run — sem vazamento de estoque por webhook/restore perdido.
 */
async function restoreOrderStockOnReversal(
  orderId: string,
  businessId: string,
): Promise<boolean> {
  // Delega ao helper ÚNICO (lib/services/order-stock-restore) — fonte da verdade
  // do restauro recuperável (claim distinguível + linhas com modificadores).
  return restoreOrderStockRecoverable(orderId, businessId, {
    operatorName: 'Estorno MP (webhook)',
    context: 'pagamento estornado',
  });
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
