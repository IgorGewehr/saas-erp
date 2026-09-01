/**
 * Checkout comercial server-side do cardápio público (M02.5a).
 *
 * O cliente envia somente a intenção (itens, endereço, cupom/gift card).
 * Catálogo, modificadores, zona de entrega e desconto são revalidados pela
 * cotação M02.1. A execução usa o coordenador recuperável M02.2 e os ledgers
 * de benefícios M02.4 — o mesmo núcleo já usado pelo PDV (M02.3/M02.4).
 *
 * Variação de catálogo (variantId), pedido manual e do agente ficam para
 * fatias seguintes (M02.5b+) — este adaptador cobre só o canal `site`.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  CreateDeliveryOrderWithSideEffectsInputSchema,
  type CreateDeliveryOrderWithSideEffectsInput,
} from '@/contracts/api/services/delivery-order-server';
import {
  CommercialOperationIdempotencyConflictError,
  CommercialOperationError,
  commercialOperationId,
  runCommercialOperationAdmin,
} from '@/lib/services/commercial-operation-admin';
import {
  CommercialOperationSchema,
  CommercialStockEffectSchema,
  type CommercialOperationRequest,
} from '@/lib/contracts/domain/commercialOperation';
import { CommercialQuoteSchema, type CommercialQuote } from '@/lib/contracts/domain/commercialV2';
import {
  applyAuthoritativeCommercialDiscounts,
  centsToReais,
  quoteCommercialCartAdmin,
  reaisToCents,
} from '@/lib/services/commercial-quote';
import { loadCommercialBenefitResourcesAdmin } from '@/lib/services/commercial-benefits-admin';
import { evaluateCoupon, COUPON_REJECT_MESSAGE } from '@/lib/services/orders/coupons';
import { checkGiftCardEligibility, normalizeGiftCardCode } from '@/lib/services/orders/checkoutRedemptions';
import { resolveClientIdentityAdmin } from '@/lib/services/clients/resolveIdentity';
import { allocateOrderNumberAdmin } from '@/lib/services/orderNumber';
import type { StockAdjustmentAdmin } from '@/lib/services/stock-admin';
import type { DeliveryOrder, SelectedModifier } from '@/lib/types';

type CommercialChannel = CommercialOperationRequest['channel'];
type CommercialActorType = CommercialOperationRequest['actor']['type'];

export interface DeliveryOrderExecutionContext {
  channel?: CommercialChannel;
  actorType?: CommercialActorType;
  now?: () => Date;
}

export interface CreateDeliveryOrderResult {
  order: DeliveryOrder;
  operationId: string;
  orderNumber: number;
  trackingToken: string;
  total: number;
  discount: number;
  giftCardAmount: number;
  stockMovements: number;
  stockAdjustments: StockAdjustmentAdmin[];
  /** True quando o coordenador devolveu o resultado já persistido (replay). */
  replayed: boolean;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function deliveryInputFingerprint(input: CreateDeliveryOrderWithSideEffectsInput): string {
  return hash(JSON.stringify(stable(input)));
}

/** Ausente do header X-Idempotency-Key ⇒ deriva do próprio conteúdo do carrinho
 *  (mesmo padrão de sales-server.ts). Um retry idêntico ainda deduplica; uma
 *  mudança real de carrinho vira uma operação nova. */
function deriveIdempotencyKey(input: CreateDeliveryOrderWithSideEffectsInput): string {
  return hash(JSON.stringify(stable({
    businessId: input.businessId,
    clientPhone: input.clientPhone,
    items: input.items,
    deliveryType: input.deliveryType,
    deliveryAddress: input.deliveryAddress,
    couponCode: input.couponCode,
    giftCardCode: input.giftCardCode,
  }))).slice(0, 40);
}

function normalizeModifiers(modifiers: SelectedModifier[] | undefined) {
  return modifiers?.map((group) => ({
    groupId: group.groupId,
    selectedOptions: group.selectedOptions.map((option) => ({
      optionId: option.optionId,
      quantity: option.quantity,
    })),
  }));
}

function quotedModifiersToLegacy(
  modifiers: CommercialOperationRequest['quote']['lines'][number]['selectedModifiers'],
): SelectedModifier[] | undefined {
  if (!modifiers?.length) return undefined;
  return modifiers.map((group) => ({
    groupId: group.groupId,
    groupName: group.groupName,
    priceStrategy: group.priceStrategy,
    selectedOptions: group.selectedOptions.map((option) => ({
      optionId: option.optionId,
      optionName: option.optionName,
      additionalPrice: centsToReais(option.additionalPriceCents),
      quantity: option.quantity,
    })),
  }));
}

/** Zera o frete diretamente (frete grátis não é um desconto de mercadoria).
 *  `quote.delivery.feeCents` (informativo/original) NÃO é tocado aqui — é ele
 *  que ancora o valor reservado no ledger do cupom (ver commercial-benefits-admin). */
function zeroDeliveryFee(quote: CommercialQuote): CommercialQuote {
  return CommercialQuoteSchema.parse({
    ...quote,
    pricing: {
      ...quote.pricing,
      deliveryFeeCents: 0,
      totalCents: Math.max(0, quote.pricing.subtotalCents + quote.pricing.tipCents - quote.pricing.discountCents),
    },
  });
}

async function storedRequestForReplay(params: {
  db: Firestore;
  businessId: string;
  idempotencyKey: string;
  inputFingerprint: string;
}): Promise<CommercialOperationRequest | undefined> {
  const operationId = commercialOperationId(params.businessId, 'deliveryOrder', params.idempotencyKey);
  const snapshot = await params.db.collection('commercialOperations').doc(operationId).get();
  if (!snapshot.exists) return undefined;
  const operation = CommercialOperationSchema.parse({ ...snapshot.data(), operationId: snapshot.id });
  if (operation.businessId !== params.businessId || operation.sourceType !== 'deliveryOrder') {
    throw new CommercialOperationIdempotencyConflictError();
  }
  if (operation.request.document.deliveryOrderCheckoutFingerprint !== params.inputFingerprint) {
    throw new CommercialOperationIdempotencyConflictError();
  }
  return operation.request;
}

async function buildNewOperationRequest(params: {
  db: Firestore;
  input: CreateDeliveryOrderWithSideEffectsInput;
  idempotencyKey: string;
  inputFingerprint: string;
  context: DeliveryOrderExecutionContext;
  now: Date;
}): Promise<CommercialOperationRequest> {
  const { db, input, now } = params;
  const channel = params.context.channel ?? 'site';
  const nowIso = now.toISOString();

  // ── Cliente (dedup/canonical por telefone) ─────────────────────────────────
  let clientId: string | undefined;
  if (input.clientPhone) {
    const phone = input.clientPhone.replace(/\D/g, '');
    if (phone.length < 8) throw new CommercialOperationError('INVALID_PHONE', 'Telefone inválido.');
    const { clientId: resolvedId } = await resolveClientIdentityAdmin({
      db, businessId: input.businessId, phone: input.clientPhone, name: input.clientName,
    });
    clientId = resolvedId ?? undefined;
  }

  // ── Cotação autoritativa (preço, modificadores, zona, estoque) ─────────────
  const quote = await quoteCommercialCartAdmin({
    db,
    input: {
      schemaVersion: 2,
      businessId: input.businessId,
      channel,
      lines: input.items.map((item, index) => ({
        lineId: `delivery-line-${index + 1}`,
        productId: item.productId,
        quantity: item.quantity,
        ...(item.selectedModifiers?.length ? { selectedModifiers: normalizeModifiers(item.selectedModifiers) } : {}),
        ...(item.notes ? { notes: item.notes } : {}),
      })),
      delivery: { type: input.deliveryType, cep: input.deliveryAddress?.cep, bairro: input.deliveryAddress?.bairro },
      tipCents: 0,
      // Sem expectedTotalCents agregado: ele compararia contra subtotal+frete e o
      // frete só é conhecido DEPOIS da zona resolvida aqui dentro — usaríamos o
      // valor (ignorado) enviado pelo cliente e geraríamos falso positivo em toda
      // entrega. A integridade por item é conferida abaixo, linha a linha.
    },
    canApplyManualDiscount: false,
    quotedAt: now,
  });

  // Preço obsoleto/adulterado por item (mesma tolerância do route legado):
  // a cotação nunca lê o preço do cliente, então uma divergência aqui só
  // significa "o catálogo mudou desde que o carrinho foi montado".
  const PRICE_TOLERANCE_CENTS = 2;
  quote.lines.forEach((line, index) => {
    const clientTotalCents = reaisToCents(input.items[index]!.total);
    if (Math.abs(line.totalCents - clientTotalCents) > PRICE_TOLERANCE_CENTS) {
      throw new CommercialOperationError(
        'ITEM_PRICE_CHANGED',
        `Preço inválido para ${line.nameSnapshot}. Atualize o carrinho e tente novamente.`,
      );
    }
  });

  const benefitResources = await loadCommercialBenefitResourcesAdmin({
    db,
    businessId: input.businessId,
    clientId,
    couponCode: input.couponCode,
    giftCardCodes: input.giftCardCode ? [input.giftCardCode] : [],
  });
  const isFirstOrder = clientId
    ? Number((benefitResources.client as { visitCount?: number } | undefined)?.visitCount ?? 0) === 0
    : true;

  // Nome/última visita atualizados cedo (best-effort, espelha o route legado):
  // mesmo que o pedido falhe depois (estoque/benefício), o cliente já existe.
  if (clientId) {
    await db.collection('clients').doc(clientId).update({
      name: (benefitResources.client as { name?: string } | undefined)?.name || input.clientName.trim(),
      lastVisit: nowIso,
      updatedAt: nowIso,
    });
  }

  let effectiveQuote = quote;
  const benefits: CommercialOperationRequest['benefits'] = [];
  let couponDiscountCents = 0;
  let giftCardAmountCents = 0;

  // ── Cupom (avaliado ANTES de queimar número/estoque) ───────────────────────
  if (input.couponCode) {
    if (!benefitResources.coupon) throw new CommercialOperationError('COUPON_NOT_FOUND', 'Cupom inválido.');
    const evaluation = evaluateCoupon(benefitResources.coupon, {
      subtotal: centsToReais(quote.pricing.subtotalCents),
      deliveryFee: quote.delivery ? centsToReais(quote.delivery.feeCents) : 0,
      deliveryType: quote.delivery?.type ?? 'retirada',
      now,
      hasIdentity: Boolean(clientId),
      isFirstOrder,
    });
    if (!evaluation.ok) {
      throw new CommercialOperationError(`COUPON_${evaluation.reason.toUpperCase()}`, COUPON_REJECT_MESSAGE[evaluation.reason]);
    }
    if (evaluation.freeDelivery) {
      const originalFeeCents = quote.delivery?.feeCents ?? 0;
      // Frete grátis num pedido sem frete (retirada / zona sem taxa) é elegível
      // mas inócuo — nada a reservar/ledger, o cupom só não teve efeito monetário.
      if (originalFeeCents > 0) {
        effectiveQuote = zeroDeliveryFee(effectiveQuote);
        benefits.push({
          intentId: 'coupon-1',
          type: 'coupon',
          action: 'redeem',
          referenceId: benefitResources.coupon.id,
          code: benefitResources.coupon.code,
          amountCents: originalFeeCents,
        });
      }
    } else {
      couponDiscountCents = Math.min(reaisToCents(evaluation.discount), quote.pricing.subtotalCents);
      if (couponDiscountCents > 0) {
        effectiveQuote = applyAuthoritativeCommercialDiscounts(effectiveQuote, [{
          source: 'coupon',
          amountCents: couponDiscountCents,
          referenceId: benefitResources.coupon.id,
          reason: `Cupom ${benefitResources.coupon.code}`,
        }]);
        benefits.push({
          intentId: 'coupon-1',
          type: 'coupon',
          action: 'redeem',
          referenceId: benefitResources.coupon.id,
          code: benefitResources.coupon.code,
          amountCents: couponDiscountCents,
        });
      }
    }
  }

  // ── Gift card — pré-check de elegibilidade (mensagem genérica anti-oráculo) ─
  let giftCard: { id: string; code: string; remainingValue: number } | undefined;
  if (input.giftCardCode) {
    const card = benefitResources.giftCards.get(normalizeGiftCardCode(input.giftCardCode));
    const reason = card ? checkGiftCardEligibility(card, nowIso) : 'not_found';
    if (reason) {
      console.warn('[DeliveryOrder] gift card inelegível (pré-check):', reason);
      throw new CommercialOperationError('GIFT_CARD_INELIGIBLE', 'Gift card inválido ou sem saldo disponível.');
    }
    giftCard = card;
  }
  if (giftCard) {
    const payableCents = effectiveQuote.pricing.totalCents;
    giftCardAmountCents = Math.min(reaisToCents(giftCard.remainingValue), payableCents);
    if (giftCardAmountCents > 0) {
      effectiveQuote = applyAuthoritativeCommercialDiscounts(effectiveQuote, [{
        source: 'other',
        amountCents: giftCardAmountCents,
        referenceId: giftCard.id,
        reason: 'Gift card',
      }]);
      benefits.push({
        intentId: 'gift-card-1',
        type: 'gift_card',
        action: 'redeem',
        referenceId: giftCard.id,
        code: giftCard.code,
        amountCents: giftCardAmountCents,
      });
    }
  }

  // ── Número sequencial (depois de toda validação síncrona de benefício) ─────
  const orderNumber = await allocateOrderNumberAdmin(db, input.businessId);
  const trackingToken = randomBytes(32).toString('base64url');

  const items = effectiveQuote.lines.map((line) => ({
    productId: line.productId!,
    productName: line.nameSnapshot,
    quantity: line.quantity,
    unitPrice: centsToReais(line.unitAmountCents),
    total: centsToReais(line.subtotalCents),
    ...(line.notes ? { notes: line.notes } : {}),
    ...(line.modifierUnitAmountCents > 0 ? { basePrice: centsToReais(line.baseUnitAmountCents) } : {}),
    ...(line.selectedModifiers?.length ? { selectedModifiers: quotedModifiersToLegacy(line.selectedModifiers) } : {}),
  }));

  const document = {
    businessId: input.businessId,
    number: orderNumber,
    status: 'recebido' as const,
    ...(clientId ? { clientId } : {}),
    clientName: input.clientName.trim(),
    ...(input.clientPhone ? { clientPhone: input.clientPhone.replace(/\D/g, '') } : {}),
    channel: 'site' as const,
    items,
    subtotal: centsToReais(effectiveQuote.pricing.subtotalCents),
    deliveryFee: centsToReais(effectiveQuote.pricing.deliveryFeeCents),
    ...(couponDiscountCents > 0 ? { discount: centsToReais(couponDiscountCents) } : {}),
    ...(benefits.some((b) => b.type === 'coupon')
      ? { couponId: benefitResources.coupon!.id, couponCode: benefitResources.coupon!.code, couponDiscount: centsToReais(couponDiscountCents) }
      : {}),
    ...(giftCardAmountCents > 0
      ? { giftCardId: giftCard!.id, giftCardCode: giftCard!.code, giftCardAmount: centsToReais(giftCardAmountCents) }
      : {}),
    total: centsToReais(effectiveQuote.pricing.totalCents),
    deliveryType: input.deliveryType,
    ...(input.deliveryType === 'entrega' ? { deliveryAddress: input.deliveryAddress } : {}),
    paymentMethod: input.paymentMethod ?? 'pix',
    paymentStatus: 'pendente' as const,
    ...(input.changeFor && input.changeFor > centsToReais(effectiveQuote.pricing.totalCents) ? { changeFor: input.changeFor } : {}),
    ...(input.customerNotes ? { customerNotes: input.customerNotes.slice(0, 1000) } : {}),
    trackingToken,
    deliveryOrderCheckoutFingerprint: params.inputFingerprint,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    schemaVersion: 1,
    businessId: input.businessId,
    idempotencyKey: params.idempotencyKey,
    sourceType: 'deliveryOrder',
    channel,
    quote: effectiveQuote,
    target: { collection: 'deliveryOrders' },
    document,
    payments: [],
    benefits,
    actor: {
      id: 'public',
      name: 'Cardápio online',
      type: params.context.actorType ?? 'system',
    },
  };
}

export async function createDeliveryOrderWithSideEffects(
  rawInput: unknown,
  db: Firestore = adminDb,
  executionContext: DeliveryOrderExecutionContext = {},
): Promise<CreateDeliveryOrderResult> {
  const input = CreateDeliveryOrderWithSideEffectsInputSchema.parse(rawInput);
  const idempotencyKey = input.idempotencyKey ?? deriveIdempotencyKey(input);
  const inputFingerprint = deliveryInputFingerprint(input);
  const nowFactory = executionContext.now ?? (() => new Date());

  const storedRequest = await storedRequestForReplay({
    db, businessId: input.businessId, idempotencyKey, inputFingerprint,
  });
  const request = storedRequest ?? await buildNewOperationRequest({
    db, input, idempotencyKey, inputFingerprint, context: executionContext, now: nowFactory(),
  });

  const result = await runCommercialOperationAdmin({ db, request, now: nowFactory });

  const orderSnapshot = await db.collection('deliveryOrders').doc(result.documentId).get();
  if (!orderSnapshot.exists || orderSnapshot.data()?.businessId !== input.businessId) {
    throw new CommercialOperationError('DELIVERY_ORDER_RESULT_NOT_FOUND', 'O pedido concluído não foi encontrado.');
  }
  const order = { id: orderSnapshot.id, ...orderSnapshot.data() } as DeliveryOrder;

  // Visita contada só depois do pedido persistido (preserva isFirstOrder numa
  // retentativa que falhe antes daqui — mesma regra do route legado). Não
  // reincrementa num replay: a visita já foi contada na tentativa original.
  if (order.clientId && !result.replayed) {
    await db.collection('clients').doc(order.clientId)
      .update({ visitCount: FieldValue.increment(1) })
      .catch(() => {});
  }

  const operationSnapshot = await db.collection('commercialOperations').doc(result.operationId).get();
  const operation = CommercialOperationSchema.parse({ ...operationSnapshot.data(), operationId: result.operationId });
  const stock = operation.checkpoints.stock_applied.result
    ? CommercialStockEffectSchema.parse(operation.checkpoints.stock_applied.result)
    : undefined;

  return {
    order,
    operationId: result.operationId,
    orderNumber: order.number,
    trackingToken: order.trackingToken ?? '',
    total: order.total,
    discount: order.discount ?? 0,
    giftCardAmount: order.giftCardAmount ?? 0,
    stockMovements: stock?.adjustments.length ?? 0,
    stockAdjustments: (stock?.adjustments ?? []) as StockAdjustmentAdmin[],
    replayed: result.replayed,
  };
}
