/**
 * Ledgers transacionais de benefícios do núcleo comercial (M02.4).
 *
 * Cupom, gift card e pontos são reservados numa única transação antes do
 * estoque. A confirmação acontece depois do documento comercial. Replays usam
 * os IDs determinísticos do coordenador e nunca alteram saldo/limite novamente.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { CouponSchema, type Coupon } from '@/lib/contracts/domain/coupon';
import type {
  CommercialOperationRequest,
  CommercialOperationStepEffectsInput,
} from '@/lib/contracts/domain/commercialOperation';
import type { GiftCard, LoyaltyConfig } from '@/lib/types';
import type {
  CommercialOperationError,
  CommercialOperationHandlerContext,
} from '@/lib/services/commercial-operation-admin';
import { centsToReais, reaisToCents } from '@/lib/services/commercial-quote';
import { checkGiftCardEligibility, normalizeGiftCardCode } from '@/lib/services/orders/checkoutRedemptions';
import { evaluateCoupon, normalizeCouponCode } from '@/lib/services/orders/coupons';

type Benefit = CommercialOperationRequest['benefits'][number];

export class CommercialBenefitError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommercialBenefitError';
  }
}

function fail(code: string, message: string): never {
  throw new CommercialBenefitError(code, message);
}

function clientIdFrom(context: CommercialOperationHandlerContext): string | undefined {
  return typeof context.request.document.clientId === 'string'
    ? context.request.document.clientId
    : undefined;
}

function nowIso(context: CommercialOperationHandlerContext): string {
  return typeof context.request.document.createdAt === 'string'
    ? context.request.document.createdAt
    : context.request.quote.quotedAt;
}

/**
 * A cotação carrega o único frete/tipo de entrega autoritativo da operação.
 * PDV nunca preenche `quote.delivery`, então o fallback retirada/0 preserva o
 * comportamento anterior a esta função existir (M02.3/M02.4).
 */
function deliveryContextFrom(context: CommercialOperationHandlerContext): {
  deliveryFee: number;
  deliveryType: 'entrega' | 'retirada';
} {
  const delivery = context.request.quote.delivery;
  return {
    deliveryFee: delivery ? centsToReais(delivery.feeCents) : 0,
    deliveryType: delivery?.type ?? 'retirada',
  };
}

function loyaltyConfig(raw: unknown): LoyaltyConfig | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Partial<LoyaltyConfig>;
  if (
    value.isEnabled !== true
    || typeof value.pointsPerReal !== 'number'
    || typeof value.pointValueInCentavos !== 'number'
    || typeof value.minPointsToRedeem !== 'number'
    || value.pointsPerReal < 0
    || value.pointValueInCentavos <= 0
    || value.minPointsToRedeem < 0
  ) return undefined;
  return value as LoyaltyConfig;
}

function effectId(context: CommercialOperationHandlerContext, benefit: Benefit): string {
  const id = benefit.type === 'coupon'
    ? context.effectIds.couponRedemptionIds[benefit.intentId]
    : benefit.type === 'gift_card'
      ? context.effectIds.giftCardRedemptionIds[benefit.intentId]
      : context.effectIds.loyaltyTransactionIds[benefit.intentId];
  if (!id) fail('BENEFIT_EFFECT_ID_MISSING', 'O benefício não possui ledger determinístico.');
  return id;
}

function effectResult(context: CommercialOperationHandlerContext): CommercialOperationStepEffectsInput {
  return {
    couponRedemptionIds: context.request.benefits
      .filter((benefit) => benefit.type === 'coupon')
      .map((benefit) => effectId(context, benefit)),
    giftCardRedemptionIds: context.request.benefits
      .filter((benefit) => benefit.type === 'gift_card')
      .map((benefit) => effectId(context, benefit)),
    loyaltyTransactionIds: context.request.benefits
      .filter((benefit) => benefit.type === 'loyalty_points')
      .map((benefit) => effectId(context, benefit)),
  };
}

function assertUniqueResources(benefits: Benefit[]): void {
  const keys = benefits.map((benefit) => `${benefit.type}:${benefit.action}:${benefit.referenceId ?? ''}`);
  if (new Set(keys).size !== keys.length) {
    fail('BENEFIT_DUPLICATE', 'O mesmo benefício foi informado mais de uma vez.');
  }
}

function ledgerCollection(benefit: Benefit): 'couponRedemptions' | 'giftCardRedemptions' | 'loyaltyTransactions' {
  return benefit.type === 'coupon'
    ? 'couponRedemptions'
    : benefit.type === 'gift_card'
      ? 'giftCardRedemptions'
      : 'loyaltyTransactions';
}

function assertExistingLedger(
  data: FirebaseFirestore.DocumentData | undefined,
  context: CommercialOperationHandlerContext,
  benefit: Benefit,
): void {
  if (
    data?.businessId !== context.request.businessId
    || data?.commercialOperationId !== context.operationId
    || data?.intentId !== benefit.intentId
    || data?.status === 'reversed'
  ) {
    fail('BENEFIT_LEDGER_CONFLICT', 'O ledger do benefício está ocupado ou já foi revertido.');
  }
}

/** Reserva todos os benefícios de consumo atomicamente. Intenções de acúmulo são confirmadas depois. */
export async function reserveCommercialBenefitsAdmin(
  context: CommercialOperationHandlerContext,
): Promise<CommercialOperationStepEffectsInput> {
  const redeemBenefits = context.request.benefits.filter((benefit) => benefit.action === 'redeem');
  assertUniqueResources(context.request.benefits);
  if (redeemBenefits.length === 0) return effectResult(context);

  const businessId = context.request.businessId;
  const clientId = clientIdFrom(context);
  const createdAt = nowIso(context);
  const manualDiscountCents = context.request.quote.pricing.discounts
    .filter((discount) => discount.source === 'manual')
    .reduce((sum, discount) => sum + discount.amountCents, 0);

  await context.db.runTransaction(async (tx) => {
    const ledgerSnapshots = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const benefit of redeemBenefits) {
      const id = effectId(context, benefit);
      ledgerSnapshots.set(id, await tx.get(context.db.collection(ledgerCollection(benefit)).doc(id)));
    }

    const missing = redeemBenefits.filter((benefit) => !ledgerSnapshots.get(effectId(context, benefit))?.exists);
    for (const benefit of redeemBenefits) {
      const snapshot = ledgerSnapshots.get(effectId(context, benefit));
      if (snapshot?.exists) assertExistingLedger(snapshot.data(), context, benefit);
    }
    if (missing.length === 0) return;

    const clientRef = clientId ? context.db.collection('clients').doc(clientId) : undefined;
    const needsClient = missing.some((benefit) => benefit.type === 'loyalty_points' || benefit.type === 'coupon');
    const clientSnapshot = needsClient && clientRef ? await tx.get(clientRef) : undefined;
    if (needsClient && clientId && (!clientSnapshot?.exists || clientSnapshot.data()?.businessId !== businessId)) {
      fail('TENANT_MISMATCH', 'Cliente do benefício não pertence ao negócio.');
    }

    const businessRef = context.db.collection('businesses').doc(businessId);
    const businessSnapshot = missing.some((benefit) => benefit.type === 'loyalty_points')
      ? await tx.get(businessRef)
      : undefined;
    if (businessSnapshot && (!businessSnapshot.exists || businessSnapshot.data()?.id && businessSnapshot.id !== businessId)) {
      fail('TENANT_MISMATCH', 'Configuração de fidelidade não pertence ao negócio.');
    }
    const config = loyaltyConfig(businessSnapshot?.data()?.settings?.loyalty);

    let loyaltyBalance = Number(clientSnapshot?.data()?.loyaltyPoints ?? 0);
    const writes: Array<() => void> = [];

    for (const benefit of missing) {
      const ledgerId = effectId(context, benefit);
      const ledgerRef = context.db.collection(ledgerCollection(benefit)).doc(ledgerId);

      if (benefit.type === 'coupon') {
        const couponRef = context.db.collection('coupons').doc(benefit.referenceId!);
        const couponSnapshot = await tx.get(couponRef);
        if (!couponSnapshot.exists) fail('COUPON_NOT_FOUND', 'Cupom não encontrado.');
        const coupon = CouponSchema.parse({ ...couponSnapshot.data(), id: couponSnapshot.id });
        if (coupon.businessId !== businessId || normalizeCouponCode(coupon.code) !== normalizeCouponCode(benefit.code!)) {
          fail('TENANT_MISMATCH', 'Cupom pertence a outro negócio.');
        }

        let clientRedemptionCount = 0;
        if (coupon.usageLimitPerClient !== undefined && clientId) {
          const query = context.db.collection('couponRedemptions')
            .where('businessId', '==', businessId)
            .where('couponId', '==', coupon.id)
            .where('clientId', '==', clientId);
          const snapshot = await tx.get(query);
          clientRedemptionCount = snapshot.docs.filter((doc) => doc.data().status !== 'reversed').length;
        }
        const evaluation = evaluateCoupon(coupon, {
          subtotal: centsToReais(context.request.quote.pricing.subtotalCents),
          ...deliveryContextFrom(context),
          now: new Date(createdAt),
          hasIdentity: Boolean(clientId),
          isFirstOrder: clientId ? Number(clientSnapshot?.data()?.visitCount ?? 0) === 0 : undefined,
          clientRedemptionCount,
        });
        if (!evaluation.ok) fail(`COUPON_${evaluation.reason.toUpperCase()}`, 'Cupom indisponível para esta venda.');
        // Frete grátis não desconta a mercadoria: o valor reservado representa
        // o frete zerado (autoritativo em quote.delivery), não evaluation.discount.
        const expectedCents = evaluation.freeDelivery
          ? (context.request.quote.delivery?.feeCents ?? 0)
          : Math.min(
              reaisToCents(evaluation.discount),
              Math.max(0, context.request.quote.pricing.subtotalCents - manualDiscountCents),
            );
        if (expectedCents !== benefit.amountCents || expectedCents <= 0) {
          fail('COUPON_VALUE_CHANGED', 'O desconto do cupom foi alterado. Revise a venda.');
        }
        const nextUsedCount = coupon.usedCount + 1;
        writes.push(() => {
          tx.update(couponRef, {
            usedCount: nextUsedCount,
            ...(coupon.usageLimit !== undefined && nextUsedCount >= coupon.usageLimit ? { status: 'exhausted' } : {}),
            updatedAt: createdAt,
          });
          tx.create(ledgerRef, {
            businessId,
            couponId: coupon.id,
            code: coupon.code,
            orderId: context.documentId,
            saleId: context.documentId,
            ...(clientId ? { clientId } : {}),
            discount: centsToReais(benefit.amountCents),
            amountCents: benefit.amountCents,
            channel: context.request.channel,
            intentId: benefit.intentId,
            status: 'reserved',
            couponStatusBefore: coupon.status,
            commercialOperationId: context.operationId,
            commercialRequestFingerprint: context.requestFingerprint,
            createdAt,
            updatedAt: createdAt,
          });
        });
        continue;
      }

      if (benefit.type === 'gift_card') {
        const giftRef = context.db.collection('giftCards').doc(benefit.referenceId!);
        const giftSnapshot = await tx.get(giftRef);
        if (!giftSnapshot.exists) fail('GIFT_CARD_NOT_FOUND', 'Gift card não encontrado.');
        const gift = { ...giftSnapshot.data(), id: giftSnapshot.id } as GiftCard;
        if (gift.businessId !== businessId || normalizeGiftCardCode(gift.code) !== normalizeGiftCardCode(benefit.code!)) {
          fail('TENANT_MISMATCH', 'Gift card pertence a outro negócio.');
        }
        const eligibility = checkGiftCardEligibility(gift, createdAt);
        if (eligibility) fail(`GIFT_CARD_${eligibility.toUpperCase()}`, 'Gift card inválido ou sem saldo suficiente.');
        const remainingCents = reaisToCents(gift.remainingValue);
        if (remainingCents < benefit.amountCents || benefit.amountCents <= 0) {
          fail('GIFT_CARD_INSUFFICIENT', 'Gift card inválido ou sem saldo suficiente.');
        }
        const newRemainingCents = remainingCents - benefit.amountCents;
        writes.push(() => {
          tx.update(giftRef, {
            remainingValue: centsToReais(newRemainingCents),
            status: newRemainingCents === 0 ? 'used' : 'active',
            usedBySaleId: context.documentId,
            usedAt: createdAt,
            updatedAt: createdAt,
          });
          tx.create(ledgerRef, {
            businessId,
            giftCardId: gift.id,
            code: gift.code,
            saleId: context.documentId,
            amount: centsToReais(benefit.amountCents),
            amountCents: benefit.amountCents,
            intentId: benefit.intentId,
            status: 'reserved',
            giftStatusBefore: gift.status,
            commercialOperationId: context.operationId,
            commercialRequestFingerprint: context.requestFingerprint,
            createdAt,
            updatedAt: createdAt,
          });
        });
        continue;
      }

      if (!clientId || benefit.referenceId !== clientId || !clientRef || !config) {
        fail('LOYALTY_UNAVAILABLE', 'Programa de fidelidade ou cliente indisponível.');
      }
      if (benefit.unitAmountCents !== config.pointValueInCentavos) {
        fail('LOYALTY_POLICY_CHANGED', 'A conversão dos pontos foi alterada. Revise a venda.');
      }
      const points = benefit.quantity!;
      if (points < config.minPointsToRedeem || Math.ceil(benefit.amountCents / config.pointValueInCentavos) !== points) {
        fail('LOYALTY_VALUE_INVALID', 'Quantidade de pontos inválida para o pagamento.');
      }
      if (loyaltyBalance < points) fail('LOYALTY_INSUFFICIENT', `Saldo insuficiente. Cliente possui ${loyaltyBalance} pontos.`);
      loyaltyBalance -= points;
      writes.push(() => tx.create(ledgerRef, {
        businessId,
        clientId,
        clientName: context.request.document.clientName ?? 'Cliente',
        type: 'resgate',
        points: -points,
        balanceAfter: loyaltyBalance,
        description: `Resgate - Venda #${context.documentId.slice(0, 6)}`,
        sourceId: context.documentId,
        sourceType: 'sale',
        amountCents: benefit.amountCents,
        unitAmountCents: benefit.unitAmountCents,
        intentId: benefit.intentId,
        status: 'reserved',
        commercialOperationId: context.operationId,
        commercialRequestFingerprint: context.requestFingerprint,
        createdAt,
        updatedAt: createdAt,
      }));
    }

    if (clientRef && missing.some((benefit) => benefit.type === 'loyalty_points')) {
      writes.push(() => tx.update(clientRef, { loyaltyPoints: loyaltyBalance, updatedAt: createdAt }));
    }
    writes.forEach((write) => write());
  });

  return effectResult(context);
}

/** Confirma reservas e cria o acúmulo de pontos no mesmo checkpoint downstream. */
export async function confirmCommercialBenefitsAdmin(
  context: CommercialOperationHandlerContext,
): Promise<CommercialOperationStepEffectsInput> {
  if (context.request.benefits.length === 0) return effectResult(context);
  const businessId = context.request.businessId;
  const clientId = clientIdFrom(context);
  const confirmedAt = nowIso(context);

  await context.db.runTransaction(async (tx) => {
    const snapshots = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const benefit of context.request.benefits) {
      const id = effectId(context, benefit);
      snapshots.set(id, await tx.get(context.db.collection(ledgerCollection(benefit)).doc(id)));
    }

    const earnBenefits = context.request.benefits.filter((benefit) => benefit.action === 'earn');
    const missingEarn = earnBenefits.filter((benefit) => !snapshots.get(effectId(context, benefit))?.exists);
    const clientRef = clientId ? context.db.collection('clients').doc(clientId) : undefined;
    const clientSnapshot = missingEarn.length && clientRef ? await tx.get(clientRef) : undefined;
    if (missingEarn.length && (!clientRef || !clientSnapshot?.exists || clientSnapshot.data()?.businessId !== businessId)) {
      fail('TENANT_MISMATCH', 'Cliente do acúmulo não pertence ao negócio.');
    }
    let balance = Number(clientSnapshot?.data()?.loyaltyPoints ?? 0);

    for (const benefit of context.request.benefits) {
      const id = effectId(context, benefit);
      const ref = context.db.collection(ledgerCollection(benefit)).doc(id);
      const snapshot = snapshots.get(id)!;
      if (benefit.action === 'redeem') {
        if (!snapshot.exists) fail('BENEFIT_RESERVATION_MISSING', 'Reserva de benefício não encontrada.');
        assertExistingLedger(snapshot.data(), context, benefit);
        if (snapshot.data()?.status === 'reserved') tx.update(ref, { status: 'confirmed', confirmedAt, updatedAt: confirmedAt });
        continue;
      }
      if (snapshot.exists) {
        assertExistingLedger(snapshot.data(), context, benefit);
        continue;
      }
      if (benefit.type !== 'loyalty_points' || benefit.referenceId !== clientId) {
        fail('LOYALTY_EARN_INVALID', 'Intenção de acúmulo de pontos inválida.');
      }
      balance += benefit.quantity!;
      tx.create(ref, {
        businessId,
        clientId,
        clientName: context.request.document.clientName ?? 'Cliente',
        type: 'acumulo',
        points: benefit.quantity,
        balanceAfter: balance,
        description: `Venda #${context.documentId.slice(0, 6)}`,
        sourceId: context.documentId,
        sourceType: 'sale',
        earningBasisCents: benefit.amountCents,
        intentId: benefit.intentId,
        status: 'confirmed',
        commercialOperationId: context.operationId,
        commercialRequestFingerprint: context.requestFingerprint,
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
        ...(typeof context.request.document.loyaltyExpiresAt === 'string'
          ? { expiresAt: context.request.document.loyaltyExpiresAt }
          : {}),
      });
    }
    if (missingEarn.length && clientRef) tx.update(clientRef, { loyaltyPoints: balance, updatedAt: confirmedAt });
  });
  return effectResult(context);
}

/** Reverte somente benefícios desta operação quando o checkout falha permanentemente. */
export async function compensateCommercialBenefitsAdmin(
  context: CommercialOperationHandlerContext,
  reason: string,
): Promise<void> {
  if (context.request.benefits.length === 0) return;
  const reversedAt = new Date().toISOString();
  const businessId = context.request.businessId;
  await context.db.runTransaction(async (tx) => {
    const ledgers = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const benefit of context.request.benefits) {
      const id = effectId(context, benefit);
      ledgers.set(id, await tx.get(context.db.collection(ledgerCollection(benefit)).doc(id)));
    }
    const active = context.request.benefits.filter((benefit) => {
      const snapshot = ledgers.get(effectId(context, benefit));
      return snapshot?.exists && snapshot.data()?.status !== 'reversed';
    });
    if (active.length === 0) return;

    const clientId = clientIdFrom(context);
    const clientRef = clientId ? context.db.collection('clients').doc(clientId) : undefined;
    const loyalty = active.filter((benefit) => benefit.type === 'loyalty_points');
    const clientSnapshot = loyalty.length && clientRef ? await tx.get(clientRef) : undefined;
    if (loyalty.length && (!clientRef || !clientSnapshot?.exists || clientSnapshot.data()?.businessId !== businessId)) {
      fail('TENANT_MISMATCH', 'Cliente da compensação pertence a outro negócio.');
    }
    let loyaltyBalance = Number(clientSnapshot?.data()?.loyaltyPoints ?? 0);

    for (const benefit of active) {
      const id = effectId(context, benefit);
      const ledgerRef = context.db.collection(ledgerCollection(benefit)).doc(id);
      const data = ledgers.get(id)!.data()!;
      assertExistingLedger(data, context, benefit);

      if (benefit.type === 'coupon') {
        const couponRef = context.db.collection('coupons').doc(benefit.referenceId!);
        const snapshot = await tx.get(couponRef);
        if (!snapshot.exists || snapshot.data()?.businessId !== businessId) fail('TENANT_MISMATCH', 'Cupom da compensação diverge.');
        const coupon = snapshot.data() as Coupon;
        const usedCount = Math.max(0, Number(coupon.usedCount ?? 0) - 1);
        tx.update(couponRef, {
          usedCount,
          ...(coupon.status === 'exhausted' && (coupon.usageLimit === undefined || usedCount < coupon.usageLimit)
            ? { status: data.couponStatusBefore ?? 'active' }
            : {}),
          updatedAt: reversedAt,
        });
      } else if (benefit.type === 'gift_card') {
        const giftRef = context.db.collection('giftCards').doc(benefit.referenceId!);
        const snapshot = await tx.get(giftRef);
        if (!snapshot.exists || snapshot.data()?.businessId !== businessId) fail('TENANT_MISMATCH', 'Gift card da compensação diverge.');
        const restoredCents = reaisToCents(Number(snapshot.data()?.remainingValue ?? 0)) + benefit.amountCents;
        tx.update(giftRef, {
          remainingValue: centsToReais(restoredCents),
          status: snapshot.data()?.expiresAt && snapshot.data()!.expiresAt < reversedAt ? 'expired' : 'active',
          updatedAt: reversedAt,
        });
      } else {
        loyaltyBalance -= Number(data.points ?? 0);
      }
      tx.update(ledgerRef, { status: 'reversed', reversedAt, reversalReason: reason, updatedAt: reversedAt });
    }
    if (loyalty.length && clientRef) tx.update(clientRef, { loyaltyPoints: loyaltyBalance, updatedAt: reversedAt });
  });
}

/** Leitura autoritativa mínima usada para preparar a intenção antes do claim. */
export async function loadCommercialBenefitResourcesAdmin(params: {
  db: Firestore;
  businessId: string;
  clientId?: string;
  couponCode?: string;
  giftCardCodes: string[];
}): Promise<{
  coupon?: Coupon & { id: string };
  giftCards: Map<string, GiftCard>;
  loyalty?: LoyaltyConfig;
  client?: Record<string, unknown>;
}> {
  const [businessSnapshot, clientSnapshot, couponQuery, ...giftQueries] = await Promise.all([
    params.db.collection('businesses').doc(params.businessId).get(),
    params.clientId ? params.db.collection('clients').doc(params.clientId).get() : Promise.resolve(undefined),
    params.couponCode
      ? params.db.collection('coupons')
        .where('businessId', '==', params.businessId)
        .where('code', '==', normalizeCouponCode(params.couponCode))
        .limit(1).get()
      : Promise.resolve(undefined),
    ...params.giftCardCodes.map((code) => params.db.collection('giftCards')
      .where('businessId', '==', params.businessId)
      .where('code', '==', normalizeGiftCardCode(code))
      .limit(1).get()),
  ]);
  if (clientSnapshot && (!clientSnapshot.exists || clientSnapshot.data()?.businessId !== params.businessId)) {
    fail('TENANT_MISMATCH', 'Cliente pertence a outro negócio.');
  }
  const couponDoc = couponQuery?.docs[0];
  const giftCards = new Map<string, GiftCard>();
  params.giftCardCodes.forEach((code, index) => {
    const doc = giftQueries[index]?.docs[0];
    if (doc) giftCards.set(normalizeGiftCardCode(code), { ...doc.data(), id: doc.id } as GiftCard);
  });
  const couponData = couponDoc ? CouponSchema.parse({ ...couponDoc.data(), id: couponDoc.id }) : undefined;
  const coupon: (Coupon & { id: string }) | undefined = couponData ? ({ ...couponData, id: couponDoc!.id } as Coupon & { id: string }) : undefined;
  const loyalty = businessSnapshot.exists ? loyaltyConfig(businessSnapshot.data()?.settings?.loyalty) : undefined;
  return {
    ...(coupon ? { coupon } : {}),
    giftCards,
    ...(loyalty ? { loyalty } : {}),
    ...(clientSnapshot?.exists ? { client: clientSnapshot.data() as Record<string, unknown> } : {}),
  };
}
