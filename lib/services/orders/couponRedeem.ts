/**
 * lib/services/orders/couponRedeem.ts
 *
 * Resgate ATÔMICO de cupom (admin SDK). Ponte entre o motor PURO
 * (`coupons.ts::evaluateCoupon`, que decide elegibilidade/valor) e o Firestore
 * (que precisa consumir o limite sob concorrência, sem oversell de uso).
 *
 * Garantias:
 *   - Limite TOTAL (usageLimit): checado com leitura FRESCA do cupom DENTRO da
 *     transação; o incremento de usedCount é CAS — dois pedidos simultâneos não
 *     ultrapassam o limite.
 *   - Limite POR CLIENTE (usageLimitPerClient): contado por query de
 *     couponRedemptions (couponId+clientId) dentro da transação.
 *   - Idempotência: o resgate é gravado em couponRedemptions/{couponId}_{key},
 *     onde `key` é a chave de idempotência do carrinho (estável entre retries) —
 *     um replay do mesmo carrinho NÃO re-incrementa usedCount; devolve o desconto
 *     já concedido. Sem chave, cai no orderId (estável por pedido persistido).
 *   - Exhausted: ao bater o limite total, marca status='exhausted' na mesma tx.
 *
 * Ordem no checkout: reservar ANTES de alocar número/debitar estoque — uma falha
 * de limite (409) então não queima número nem toca estoque. A janela residual
 * (estoque falha DEPOIS de reservar) super-consome o cupom em no máximo 1 por
 * carrinho; como a chave de idempotência ancora o resgate, o retry do mesmo
 * carrinho não re-consome. Trade-off documentado: limite de cupom é restrição de
 * marketing (não dinheiro), então favorecemos não-bloquear a criação do pedido.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { Coupon } from '@/lib/contracts/domain/coupon';
import {
  evaluateCoupon,
  normalizeCouponCode,
  type CouponContext,
  type CouponRejectReason,
} from './coupons';

export type CouponReserveResult =
  | {
      ok: true;
      couponId: string;
      code: string;
      discount: number;
      freeDelivery: boolean;
      finalFee: number;
    }
  | { ok: false; reason: CouponRejectReason | 'not_found' };

export interface ReserveCouponParams {
  businessId: string;
  code: string;
  /** Chave de idempotência do resgate — a do carrinho (X-Idempotency-Key) quando
   *  houver, senão o id do pedido. Ancora couponRedemptions/{couponId}_{key}. */
  redemptionKey: string;
  /** Id do pedido persistido — gravado no resgate para rastreio/relatório. */
  orderId: string;
  clientId?: string;
  channel?: 'site' | 'pdv' | 'agent' | 'manual';
  ctx: CouponContext;
}

/** Carrega o cupom por código normalizado dentro do tenant. Null se não existe. */
export async function loadCouponByCode(
  db: Firestore,
  businessId: string,
  code: string,
): Promise<(Coupon & { id: string }) | null> {
  const norm = normalizeCouponCode(code);
  const snap = await db
    .collection('coupons')
    .where('businessId', '==', businessId)
    .where('code', '==', norm)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { ...(d.data() as Coupon), id: d.id };
}

/**
 * Avalia + reserva o cupom numa transação. Retorna o desconto concedido (para o
 * chamador aplicar no total do pedido) ou o motivo da rejeição. NÃO lança em
 * rejeição de elegibilidade — só em erro de infra.
 */
export async function reserveCouponAdmin(
  db: Firestore,
  params: ReserveCouponParams,
): Promise<CouponReserveResult> {
  const { businessId, code, redemptionKey, orderId, clientId, channel = 'site', ctx } = params;

  const found = await loadCouponByCode(db, businessId, code);
  if (!found) return { ok: false, reason: 'not_found' };
  const couponId = found.id;

  const couponRef = db.collection('coupons').doc(couponId);
  const redemptionRef = db.collection('couponRedemptions').doc(`${couponId}_${redemptionKey}`);

  return db.runTransaction(async (trx) => {
    // ── Leituras (todas antes de qualquer escrita — regra do Firestore) ──────
    const [couponSnap, redemptionSnap] = await Promise.all([
      trx.get(couponRef),
      trx.get(redemptionRef),
    ]);
    if (!couponSnap.exists) return { ok: false, reason: 'not_found' as const };
    const coupon = { ...(couponSnap.data() as Coupon), id: couponId };

    // Replay idempotente: o mesmo carrinho/pedido já resgatou → devolve o valor
    // gravado, sem re-incrementar. `freeDelivery`/`finalFee` reconstituídos do
    // tipo do cupom (o desconto persistido é a fonte da verdade do valor).
    if (redemptionSnap.exists) {
      const prev = redemptionSnap.data() as { discount?: number };
      const freeDelivery = coupon.discountType === 'free_delivery';
      return {
        ok: true as const,
        couponId,
        code: coupon.code,
        discount: prev.discount ?? 0,
        freeDelivery,
        finalFee: freeDelivery ? 0 : ctx.deliveryFee,
      };
    }

    // Contagem por cliente (dentro da tx) só quando há limite por cliente + id.
    // Filtra businessId (R1) além de couponId+clientId — defesa em profundidade
    // (couponId já é doc-id único, mas nenhuma query escapa do filtro de tenant).
    let clientRedemptionCount = 0;
    if (coupon.usageLimitPerClient !== undefined && clientId) {
      const perClientSnap = await trx.get(
        db
          .collection('couponRedemptions')
          .where('businessId', '==', businessId)
          .where('couponId', '==', couponId)
          .where('clientId', '==', clientId),
      );
      clientRedemptionCount = perClientSnap.size;
    }

    // hasIdentity: cupons 1ª-compra/por-cliente exigem identidade resolvida —
    // sem clientId, evaluateCoupon rejeita (não trata anônimo como 1º pedido).
    const evaluation = evaluateCoupon(coupon, {
      ...ctx,
      clientRedemptionCount,
      hasIdentity: !!clientId,
    });
    if (!evaluation.ok) return { ok: false as const, reason: evaluation.reason };

    // ── Escritas: registra o resgate + consome uma unidade (CAS via increment) ─
    const now = ctx.now.toISOString();
    trx.set(redemptionRef, {
      businessId,
      couponId,
      code: coupon.code,
      orderId,
      ...(clientId ? { clientId } : {}),
      discount: evaluation.discount,
      channel,
      createdAt: now,
    });
    const nextUsed = coupon.usedCount + 1;
    const patch: Record<string, unknown> = {
      usedCount: FieldValue.increment(1),
      updatedAt: now,
    };
    // Fecha o cupom ao atingir o teto total — status EFETIVO já refletiria isso,
    // mas persistir 'exhausted' evita queries/leituras futuras e alimenta a UI.
    if (coupon.usageLimit !== undefined && nextUsed >= coupon.usageLimit) {
      patch.status = 'exhausted';
    }
    trx.update(couponRef, patch);

    return {
      ok: true as const,
      couponId,
      code: coupon.code,
      discount: evaluation.discount,
      freeDelivery: evaluation.freeDelivery,
      finalFee: evaluation.finalFee,
    };
  });
}
