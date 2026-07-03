/**
 * lib/services/orders/checkoutRedemptions.ts
 *
 * Resgates "dinheiro" no checkout de delivery (admin SDK). Hoje: GIFT CARD.
 * (Pontos de fidelidade NÃO entram no checkout público anônimo — identidade por
 * telefone não é verificada, então gastar pontos de terceiros seria trivial;
 * resgate de pontos pertence ao PDV/agente, canais de identidade mediada. Ver
 * lib/services/orders/coupons.ts para o guard de identidade análogo.)
 *
 * Gift card é instrumento AO PORTADOR: quem tem o código gasta o saldo (é como
 * dinheiro). Por isso NÃO existe endpoint público que revele saldo/validade
 * (evita enumeração de códigos) — o resgate acontece só na SUBMISSÃO do pedido,
 * throttled pelo rate-limit do checkout, e o valor aplicado volta na resposta.
 *
 * Garantias (espelham couponRedeem):
 *   - Débito ATÔMICO: remainingValue lido FRESCO dentro da transação e escrito
 *     com o novo saldo — dois pedidos concorrentes não gastam além do saldo.
 *   - Idempotência: giftCardRedemptions/{giftCardId}_{key} com `key` = chave de
 *     idempotência do carrinho (estável entre retries) — replay não re-debita.
 *   - Parcial: resgata min(saldo, amountToRedeem); status vira 'used' ao zerar.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { GiftCard } from '@/lib/types';

export type GiftCardRejectReason =
  | 'not_found'
  | 'inactive'   // status !== 'active' (used/expired/cancelled)
  | 'expired'    // expiresAt no passado
  | 'empty';     // remainingValue <= 0

export type GiftCardRedeemResult =
  | {
      ok: true;
      giftCardId: string;
      code: string;
      /** Valor efetivamente resgatado (BRL) — reduz o total do pedido. */
      amountRedeemed: number;
      /** Saldo restante no gift card após o resgate. */
      remainingValue: number;
    }
  | { ok: false; reason: GiftCardRejectReason };

export interface RedeemGiftCardParams {
  businessId: string;
  code: string;
  /** Teto do resgate: o valor a pagar após cupom. Resgata min(saldo, isto). */
  amountToRedeem: number;
  /** Chave de idempotência (a do carrinho quando houver, senão o id do pedido). */
  redemptionKey: string;
  orderId: string;
}

/** Normaliza o código do gift card como gravado: trim + MAIÚSCULAS. */
export function normalizeGiftCardCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Elegibilidade PURA do gift card (status/expiração/saldo) — SEM debitar. Usada
 * (1) como pré-check no checkout ANTES da dedução de estoque (rejeita cartão
 * inválido cedo, sem side-effect) e (2) dentro de redeemGiftCardAdmin com o doc
 * lido fresco na transação. `null` = elegível.
 */
export function checkGiftCardEligibility(
  gc: Pick<GiftCard, 'status' | 'expiresAt' | 'remainingValue'>,
  nowIso: string,
): GiftCardRejectReason | null {
  if (gc.status !== 'active') return 'inactive';
  if (gc.expiresAt && gc.expiresAt < nowIso) return 'expired';
  if (gc.remainingValue <= 0) return 'empty';
  return null;
}

/** Carrega o gift card por código dentro do tenant. Null se não existe. */
export async function loadGiftCardByCode(
  db: Firestore,
  businessId: string,
  code: string,
): Promise<(GiftCard & { id: string }) | null> {
  const snap = await db
    .collection('giftCards')
    .where('businessId', '==', businessId)
    .where('code', '==', normalizeGiftCardCode(code))
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { ...(d.data() as GiftCard), id: d.id };
}

/**
 * Resgata (parcialmente) um gift card contra o valor a pagar. Determinística no
 * valor: resgata min(saldo, amountToRedeem). Não lança em rejeição de
 * elegibilidade — só em erro de infra. `now` vem do chamador (ISO) para manter
 * a expiração testável; aqui usamos o relógio do servidor via parâmetro implícito
 * não — a expiração é comparada contra `nowIso`.
 */
export async function redeemGiftCardAdmin(
  db: Firestore,
  params: RedeemGiftCardParams & { nowIso: string },
): Promise<GiftCardRedeemResult> {
  const { businessId, code, amountToRedeem, redemptionKey, orderId, nowIso } = params;

  const found = await loadGiftCardByCode(db, businessId, code);
  if (!found) return { ok: false, reason: 'not_found' };
  const giftCardId = found.id;

  const gcRef = db.collection('giftCards').doc(giftCardId);
  const ledgerRef = db.collection('giftCardRedemptions').doc(`${giftCardId}_${redemptionKey}`);

  return db.runTransaction(async (trx) => {
    const [gcSnap, ledgerSnap] = await Promise.all([trx.get(gcRef), trx.get(ledgerRef)]);
    if (!gcSnap.exists) return { ok: false, reason: 'not_found' as const };
    const gc = gcSnap.data() as GiftCard;

    // Replay idempotente: o mesmo carrinho/pedido já resgatou → devolve o valor
    // gravado, sem re-debitar.
    if (ledgerSnap.exists) {
      const prev = ledgerSnap.data() as { amount?: number };
      return {
        ok: true as const,
        giftCardId,
        code: gc.code,
        amountRedeemed: prev.amount ?? 0,
        remainingValue: gc.remainingValue,
      };
    }

    const ineligible = checkGiftCardEligibility(gc, nowIso);
    if (ineligible) {
      // Expirado: persiste o status na mesma tx (autolimpeza). Demais: no-op.
      if (ineligible === 'expired') trx.update(gcRef, { status: 'expired', updatedAt: nowIso });
      return { ok: false, reason: ineligible };
    }

    const amountRedeemed = Math.min(Math.max(0, amountToRedeem), gc.remainingValue);
    if (amountRedeemed <= 0) {
      // Nada a pagar (pedido já zerado por cupom) — não consome saldo nem grava
      // ledger; o gift card fica intacto para um próximo pedido.
      return {
        ok: true as const,
        giftCardId,
        code: gc.code,
        amountRedeemed: 0,
        remainingValue: gc.remainingValue,
      };
    }

    const newRemaining = Math.round((gc.remainingValue - amountRedeemed) * 100) / 100;
    trx.update(gcRef, {
      remainingValue: newRemaining,
      status: newRemaining <= 0 ? 'used' : 'active',
      usedByOrderId: orderId,
      usedAt: nowIso,
      updatedAt: nowIso,
    });
    trx.set(ledgerRef, {
      businessId,
      giftCardId,
      code: gc.code,
      orderId,
      amount: amountRedeemed,
      createdAt: nowIso,
    });

    return {
      ok: true as const,
      giftCardId,
      code: gc.code,
      amountRedeemed,
      remainingValue: newRemaining,
    };
  });
}

/** Mensagem PT-BR curta por motivo de rejeição do gift card. */
export const GIFT_CARD_REJECT_MESSAGE: Record<GiftCardRejectReason, string> = {
  not_found: 'Gift card inválido.',
  inactive: 'Este gift card não está mais ativo.',
  expired: 'Este gift card expirou.',
  empty: 'Este gift card não tem saldo disponível.',
};
