/**
 * Checkout comercial server-side do PDV, API v1 e agente (M02.3).
 *
 * O cliente envia somente a intenção legada. Catálogo, variação, modificadores,
 * serviços, desconto permitido e estoque são revalidados pela cotação M02.1.
 * A execução usa o coordenador recuperável M02.2 e cria um lançamento financeiro
 * determinístico por alocação aplicável.
 */

import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  CreateSaleWithSideEffectsInputSchema,
  type CreateSaleWithSideEffectsInput,
} from '@/contracts/api/services/sale-server';
import {
  CommercialOperationIdempotencyConflictError,
  CommercialOperationError,
  commercialOperationId,
  ensureCommercialEffectDocumentAdmin,
  runCommercialOperationAdmin,
  type CommercialOperationHandlerContext,
} from '@/lib/services/commercial-operation-admin';
import {
  CommercialOperationSchema,
  CommercialStockEffectSchema,
  type CommercialOperationRequest,
} from '@/lib/contracts/domain/commercialOperation';
import {
  applyAuthoritativeCommercialDiscounts,
  centsToReais,
  quoteCommercialCartAdmin,
  reaisToCents,
} from '@/lib/services/commercial-quote';
import { loadCommercialBenefitResourcesAdmin } from '@/lib/services/commercial-benefits-admin';
import { evaluateCoupon, normalizeCouponCode } from '@/lib/services/orders/coupons';
import { normalizeGiftCardCode } from '@/lib/services/orders/checkoutRedemptions';
import { recordClientPurchaseAdmin } from '@/lib/services/clients/recordPurchase';
import type { StockAdjustmentAdmin } from '@/lib/services/stock-admin';
import type { Payment, PaymentMethod, Sale, SelectedModifier } from '@/lib/types';

type CommercialChannel = CommercialOperationRequest['channel'];
type CommercialActorType = CommercialOperationRequest['actor']['type'];
type CommercialPayment = CommercialOperationRequest['payments'][number];

const IMMEDIATE_METHODS = new Set<PaymentMethod>(['dinheiro', 'pix', 'credito', 'debito', 'outros']);
const DEFERRED_METHODS = new Set<PaymentMethod>(['boleto', 'creditoLoja']);
const BENEFIT_METHODS = new Set<PaymentMethod>(['pontos', 'gift_card']);

export interface SaleCheckoutExecutionContext {
  channel?: CommercialChannel;
  actorType?: CommercialActorType;
  canApplyManualDiscount?: boolean;
  /** Taxa resolvida no servidor. O campo homônimo do payload legado é ignorado. */
  commissionRate?: number;
  now?: () => Date;
}

export interface CreateSaleResult {
  sale: Sale;
  operationId: string;
  transactionId?: string;
  transactionIds: string[];
  commissionTransactionId?: string;
  stockMovements: number;
  stockAdjustments: StockAdjustmentAdmin[];
  paymentStatus: NonNullable<Sale['paymentStatus']>;
  /** True quando o coordenador devolveu o resultado persistido. */
  replayed: boolean;
}

export interface SalePaymentSemantics {
  commercialMethod: CommercialPayment['method'];
  allocationStatus: CommercialPayment['status'];
  legacyStatus: NonNullable<Payment['status']>;
  createsFinancialTransaction: boolean;
  financialStatus: 'pago' | 'pendente' | 'not_applicable';
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

function saleInputFingerprint(input: CreateSaleWithSideEffectsInput): string {
  return hash(JSON.stringify(stable(input)));
}

function deriveIdempotencyKey(input: CreateSaleWithSideEffectsInput): string {
  return hash(JSON.stringify(stable({
    businessId: input.businessId,
    clientId: input.clientId,
    operatorId: input.operatorId,
    items: input.items,
    payments: input.payments,
    discount: input.discount,
    tip: input.tip,
    status: input.status,
  }))).slice(0, 40);
}

function defaultChannel(input: CreateSaleWithSideEffectsInput): CommercialChannel {
  if (input.operatorId === 'api') return 'api_v1';
  if (input.operatorId === 'agent' || input.channelType) return 'agent';
  return 'pdv';
}

export function salePaymentSemantics(method: PaymentMethod): SalePaymentSemantics {
  const commercialMethod: Record<PaymentMethod, CommercialPayment['method']> = {
    dinheiro: 'cash',
    pix: 'pix',
    credito: 'credit_card',
    debito: 'debit_card',
    boleto: 'boleto',
    creditoLoja: 'store_credit',
    semPagamento: 'unpaid',
    pontos: 'loyalty_points',
    gift_card: 'gift_card',
    outros: 'other',
  };
  if (IMMEDIATE_METHODS.has(method)) {
    return {
      commercialMethod: commercialMethod[method],
      allocationStatus: 'paid',
      legacyStatus: 'paid',
      createsFinancialTransaction: true,
      financialStatus: 'pago',
    };
  }
  if (DEFERRED_METHODS.has(method)) {
    return {
      commercialMethod: commercialMethod[method],
      allocationStatus: 'pending',
      legacyStatus: 'pending',
      createsFinancialTransaction: true,
      financialStatus: 'pendente',
    };
  }
  if (BENEFIT_METHODS.has(method)) {
    return {
      commercialMethod: commercialMethod[method],
      allocationStatus: 'pending',
      legacyStatus: 'pending',
      createsFinancialTransaction: false,
      financialStatus: 'not_applicable',
    };
  }
  return {
    commercialMethod: 'unpaid',
    allocationStatus: 'pending',
    legacyStatus: 'unpaid',
    createsFinancialTransaction: false,
    financialStatus: 'not_applicable',
  };
}

function plusDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function aggregatePaymentStatus(payments: Payment[]): NonNullable<Sale['paymentStatus']> {
  if (payments.every((payment) => payment.status === 'unpaid')) return 'unpaid';
  const paid = payments.some((payment) => payment.status === 'paid');
  const pending = payments.some((payment) => payment.status !== 'paid');
  if (paid && pending) return 'partial';
  return paid ? 'paid' : 'pending';
}

function aggregateFinancialStatus(payments: Payment[]): NonNullable<Sale['financialStatus']> {
  const applicable = payments.filter((payment) => salePaymentSemantics(payment.method).createsFinancialTransaction);
  if (applicable.length === 0) return 'not_applicable';
  const paid = applicable.some((payment) => payment.status === 'paid');
  const pending = applicable.some((payment) => payment.status !== 'paid');
  if (paid && pending) return 'partial';
  return paid ? 'paid' : 'pending';
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

async function validatedClientName(
  db: Firestore,
  businessId: string,
  clientId: string | undefined,
  fallback: string | undefined,
): Promise<string | undefined> {
  if (!clientId) return fallback?.trim() || undefined;
  const snapshot = await db.collection('clients').doc(clientId).get();
  if (!snapshot.exists) throw new CommercialOperationError('CLIENT_NOT_FOUND', 'Cliente não encontrado.');
  const data = snapshot.data();
  if (data?.businessId !== businessId) {
    throw new CommercialOperationError('TENANT_MISMATCH', 'Cliente pertence a outro negócio.');
  }
  return typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallback?.trim() || undefined;
}

function validateCommissionRate(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : 0;
}

function clientExpectedTotalCents(input: CreateSaleWithSideEffectsInput): number {
  const subtotal = input.items.reduce((sum, item) =>
    sum + Math.round(reaisToCents(item.unitPrice) * item.quantity), 0);
  const discounts = input.items.reduce((sum, item) => sum + reaisToCents(item.discount), 0)
    + reaisToCents(input.discount);
  return Math.max(0, subtotal + reaisToCents(input.tip ?? 0) - discounts);
}

async function buildNewOperationRequest(params: {
  db: Firestore;
  input: CreateSaleWithSideEffectsInput;
  idempotencyKey: string;
  inputFingerprint: string;
  context: SaleCheckoutExecutionContext;
  now: Date;
}): Promise<CommercialOperationRequest> {
  const { db, input, context, now } = params;
  if (input.status !== 'finalizada') {
    throw new CommercialOperationError('SALE_STATUS_INVALID', 'O checkout comercial aceita somente venda finalizada.');
  }
  const clientName = await validatedClientName(db, input.businessId, input.clientId, input.clientName);
  const itemDiscountCents = input.items.reduce((sum, item) => sum + reaisToCents(item.discount), 0);
  const manualDiscountCents = itemDiscountCents + reaisToCents(input.discount);
  const channel = context.channel ?? defaultChannel(input);
  const quote = await quoteCommercialCartAdmin({
    db,
    input: {
      schemaVersion: 2,
      businessId: input.businessId,
      channel,
      lines: input.items.map((item, index) => ({
        lineId: `sale-line-${index + 1}`,
        ...(item.productId ? { productId: item.productId } : {}),
        ...(item.serviceId ? { serviceId: item.serviceId } : {}),
        ...(item.variantId ? { variantId: item.variantId } : {}),
        quantity: item.quantity,
        ...(item.selectedModifiers?.length ? { selectedModifiers: normalizeModifiers(item.selectedModifiers) } : {}),
        ...(item.notes ? { notes: item.notes } : {}),
      })),
      ...(manualDiscountCents > 0 ? {
        manualDiscount: {
          kind: 'fixed' as const,
          amountCents: manualDiscountCents,
          reason: input.discountReason ?? 'Desconto informado no checkout legado',
        },
      } : {}),
      tipCents: reaisToCents(input.tip ?? 0),
      expectedTotalCents: clientExpectedTotalCents(input),
    },
    canApplyManualDiscount: context.canApplyManualDiscount === true,
    ...(channel === 'pdv' ? { operatorId: input.operatorId } : {}),
    quotedAt: now,
  });

  const giftCardCodes = input.payments
    .filter((payment) => payment.method === 'gift_card')
    .map((payment) => payment.benefitCode || payment.cardBrand)
    .filter((code): code is string => Boolean(code));

  const benefitResources = await loadCommercialBenefitResourcesAdmin({
    db,
    businessId: input.businessId,
    clientId: input.clientId,
    couponCode: input.couponCode,
    giftCardCodes,
  });

  let effectiveQuote = quote;
  const benefits: CommercialOperationRequest['benefits'] = [];
  let couponDiscountCents = 0;

  if (input.couponCode) {
    if (!benefitResources.coupon) {
      throw new CommercialOperationError('COUPON_NOT_FOUND', 'Cupom não encontrado.');
    }
    const evaluation = evaluateCoupon(benefitResources.coupon, {
      subtotal: centsToReais(quote.pricing.subtotalCents),
      deliveryFee: 0,
      deliveryType: 'retirada',
      now,
      hasIdentity: Boolean(input.clientId),
      isFirstOrder: input.clientId ? Number((benefitResources.client as { visitCount?: number } | undefined)?.visitCount ?? 0) === 0 : undefined,
    });
    if (!evaluation.ok) {
      throw new CommercialOperationError(`COUPON_${evaluation.reason.toUpperCase()}`, 'Cupom indisponível para esta venda.');
    }
    couponDiscountCents = Math.min(
      reaisToCents(evaluation.discount),
      Math.max(0, quote.pricing.subtotalCents - manualDiscountCents),
    );
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

  let giftCardIndex = 0;
  let pointsRedeemedTotal = 0;
  for (const payment of input.payments) {
    if (payment.method === 'gift_card') {
      giftCardIndex += 1;
      const code = payment.benefitCode || payment.cardBrand;
      const card = code ? benefitResources.giftCards.get(normalizeGiftCardCode(code)) : undefined;
      if (!card) throw new CommercialOperationError('GIFT_CARD_NOT_FOUND', 'Gift card não encontrado.');
      benefits.push({
        intentId: `gift-card-${giftCardIndex}`,
        type: 'gift_card',
        action: 'redeem',
        referenceId: card.id,
        code: card.code,
        amountCents: reaisToCents(payment.amount),
      });
    } else if (payment.method === 'pontos') {
      if (!input.clientId || !benefitResources.loyalty) {
        throw new CommercialOperationError('LOYALTY_UNAVAILABLE', 'Programa de fidelidade ou cliente indisponível.');
      }
      const points = Math.ceil(reaisToCents(payment.amount) / benefitResources.loyalty.pointValueInCentavos);
      pointsRedeemedTotal += points;
      benefits.push({
        intentId: 'loyalty-redeem-1',
        type: 'loyalty_points',
        action: 'redeem',
        referenceId: input.clientId,
        amountCents: reaisToCents(payment.amount),
        quantity: points,
        unitAmountCents: benefitResources.loyalty.pointValueInCentavos,
      });
    }
  }

  let pointsEarnedTotal = 0;
  if (input.clientId && benefitResources.loyalty?.isEnabled && benefitResources.loyalty.pointsPerReal > 0) {
    const totalSpentReais = centsToReais(effectiveQuote.pricing.totalCents);
    pointsEarnedTotal = Math.floor(totalSpentReais * benefitResources.loyalty.pointsPerReal);
    if (pointsEarnedTotal > 0) {
      benefits.push({
        intentId: 'loyalty-earn-1',
        type: 'loyalty_points',
        action: 'earn',
        referenceId: input.clientId,
        amountCents: effectiveQuote.pricing.totalCents,
        quantity: pointsEarnedTotal,
        unitAmountCents: benefitResources.loyalty.pointValueInCentavos,
      });
    }
  }

  const payments: CommercialPayment[] = input.payments.map((payment, index) => {
    const semantics = salePaymentSemantics(payment.method);
    return {
      allocationId: `payment-${index + 1}`,
      method: semantics.commercialMethod,
      amountCents: reaisToCents(payment.amount),
      status: semantics.allocationStatus,
      ...(payment.installments ? { installments: payment.installments } : {}),
      ...(payment.dueDate ? { dueDate: payment.dueDate } : {}),
      ...(payment.cardBrand ? { provider: payment.cardBrand } : {}),
    };
  });
  const legacyPayments: Payment[] = input.payments.map((payment) => ({
    method: payment.method,
    amount: centsToReais(reaisToCents(payment.amount)),
    ...(payment.installments ? { installments: payment.installments } : {}),
    ...(payment.cardBrand ? { cardBrand: payment.cardBrand } : {}),
    ...(payment.dueDate ? { dueDate: payment.dueDate } : {}),
    status: salePaymentSemantics(payment.method).legacyStatus,
  }));
  const paymentStatus = aggregatePaymentStatus(legacyPayments);
  const financialStatus = aggregateFinancialStatus(legacyPayments);
  const commissionRate = validateCommissionRate(context.commissionRate);
  const hasStock = effectiveQuote.lines.some((line) => line.stockRequirements.some((requirement) => requirement.tracked));
  const items = effectiveQuote.lines.map((line) => ({
    id: line.lineId,
    ...(line.productId ? { productId: line.productId } : {}),
    ...(line.serviceId ? { serviceId: line.serviceId } : {}),
    ...(line.variantId ? { variantId: line.variantId } : {}),
    description: line.variantNameSnapshot ? `${line.nameSnapshot} — ${line.variantNameSnapshot}` : line.nameSnapshot,
    quantity: line.quantity,
    unitPrice: centsToReais(line.unitAmountCents),
    discount: 0,
    total: centsToReais(line.subtotalCents),
    ...(line.selectedModifiers?.length ? { selectedModifiers: quotedModifiersToLegacy(line.selectedModifiers) } : {}),
    ...(line.modifierUnitAmountCents > 0 ? { basePrice: centsToReais(line.baseUnitAmountCents) } : {}),
    ...(line.notes ? { notes: line.notes } : {}),
  }));
  const createdAt = now.toISOString();
  const document = {
    businessId: input.businessId,
    ...(input.clientId ? { clientId: input.clientId, contactId: input.clientId } : {}),
    ...(clientName ? { clientName } : {}),
    items,
    payments: legacyPayments,
    subtotal: centsToReais(effectiveQuote.pricing.subtotalCents),
    discount: centsToReais(effectiveQuote.pricing.discountCents),
    ...(effectiveQuote.pricing.tipCents > 0 ? { tip: centsToReais(effectiveQuote.pricing.tipCents) } : {}),
    total: centsToReais(effectiveQuote.pricing.totalCents),
    status: 'finalizada' as const,
    paymentStatus,
    financialStatus,
    stockStatus: hasStock ? 'applied' as const : 'not_required' as const,
    fiscalStatus: 'nao_emitido',
    manualDiscount: centsToReais(manualDiscountCents),
    ...(benefitResources.coupon ? {
      couponId: benefitResources.coupon.id,
      couponCode: benefitResources.coupon.code,
      couponDiscount: centsToReais(couponDiscountCents),
    } : {}),
    ...(pointsRedeemedTotal > 0 ? { pointsRedeemed: pointsRedeemedTotal } : {}),
    ...(pointsEarnedTotal > 0 ? { pointsEarned: pointsEarnedTotal } : {}),
    operatorId: input.operatorId,
    operatorName: input.operatorName,
    commissionRateApplied: commissionRate,
    saleCheckoutFingerprint: params.inputFingerprint,
    createdAt,
    updatedAt: createdAt,
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.channelType ? { channelType: input.channelType } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.sectorId ? { sectorId: input.sectorId } : {}),
    ...(input.dealId ? { dealId: input.dealId } : {}),
    ...(input.appointmentId ? { appointmentId: input.appointmentId } : {}),
  };

  return {
    schemaVersion: 1,
    businessId: input.businessId,
    idempotencyKey: params.idempotencyKey,
    sourceType: 'sale',
    channel,
    quote: effectiveQuote,
    target: { collection: 'sales' },
    document,
    payments,
    benefits,
    actor: {
      id: input.operatorId,
      name: input.operatorName,
      type: context.actorType ?? (channel === 'agent' ? 'agent' : channel === 'api_v1' ? 'api' : 'user'),
    },
  };
}

function legacyPaymentMethod(request: CommercialOperationRequest, allocationId: string): PaymentMethod {
  const index = request.payments.findIndex((payment) => payment.allocationId === allocationId);
  const documentPayments = Array.isArray(request.document.payments) ? request.document.payments : [];
  const raw = documentPayments[index] as { method?: unknown } | undefined;
  return typeof raw?.method === 'string' ? raw.method as PaymentMethod : 'outros';
}

function isFinancialAllocation(request: CommercialOperationRequest, allocation: CommercialPayment): boolean {
  return salePaymentSemantics(legacyPaymentMethod(request, allocation.allocationId)).createsFinancialTransaction;
}

async function markClientWonAdmin(params: {
  db: Firestore;
  businessId: string;
  clientId: string;
  nowIso: string;
}): Promise<void> {
  const ref = params.db.collection('clients').doc(params.clientId);
  await params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new CommercialOperationError('CLIENT_NOT_FOUND', 'Cliente não encontrado.');
    if (snapshot.data()?.businessId !== params.businessId) {
      throw new CommercialOperationError('TENANT_MISMATCH', 'Cliente pertence a outro negócio.');
    }
    if (snapshot.data()?.status !== 'ganho') tx.update(ref, { status: 'ganho', updatedAt: params.nowIso });
  });
}

async function patchSaleFinancialState(params: {
  context: CommercialOperationHandlerContext;
  transactionIds: string[];
  primaryTransactionId?: string;
  commissionTransactionId?: string;
  paymentStatus: NonNullable<Sale['paymentStatus']>;
  financialStatus: NonNullable<Sale['financialStatus']>;
  nowIso: string;
}): Promise<void> {
  const ref = params.context.db.collection('sales').doc(params.context.documentId);
  await params.context.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const sale = snapshot.data();
    if (!snapshot.exists || sale?.businessId !== params.context.request.businessId || sale?.commercialOperationId !== params.context.operationId) {
      throw new CommercialOperationError('SALE_REFERENCE_CONFLICT', 'Venda comercial não encontrada ou divergente.');
    }
    tx.update(ref, {
      transactionIds: params.transactionIds,
      ...(params.primaryTransactionId ? { transactionId: params.primaryTransactionId } : {}),
      ...(params.commissionTransactionId ? { commissionTransactionId: params.commissionTransactionId } : {}),
      paymentStatus: params.paymentStatus,
      financialStatus: params.financialStatus,
      updatedAt: params.nowIso,
    });
  });
}

async function reconcileSaleDownstream(
  context: CommercialOperationHandlerContext,
): Promise<{ transactionIds: string[] }> {
  const createdAt = typeof context.request.document.createdAt === 'string'
    ? context.request.document.createdAt
    : context.request.quote.quotedAt;
  const baseDate = new Date(createdAt);
  const today = createdAt.slice(0, 10);
  const transactionIds: string[] = [];

  for (const allocation of context.request.payments) {
    if (!isFinancialAllocation(context.request, allocation)) continue;
    const documentId = context.effectIds.transactionIds[allocation.allocationId];
    const legacyMethod = legacyPaymentMethod(context.request, allocation.allocationId);
    const deferred = allocation.status === 'pending';
    await ensureCommercialEffectDocumentAdmin({
      db: context.db,
      collection: 'transactions',
      documentId,
      businessId: context.request.businessId,
      operationId: context.operationId,
      data: {
        type: 'receita',
        category: 'Vendas',
        description: `Venda #${context.documentId.slice(0, 6)} — ${legacyMethod}`,
        amount: centsToReais(allocation.amountCents),
        dueDate: allocation.dueDate ?? (deferred ? plusDays(baseDate, 30) : today),
        ...(deferred ? {} : { paymentDate: today }),
        status: deferred ? 'pendente' : 'pago',
        saleId: context.documentId,
        paymentMethod: legacyMethod,
        paymentAllocationId: allocation.allocationId,
        commercialPaymentStatus: allocation.status,
        ...(allocation.installments ? { installments: allocation.installments } : {}),
        ...(context.request.document.clientId ? { clientId: context.request.document.clientId, contactId: context.request.document.clientId } : {}),
        ...(context.request.document.clientName ? { clientName: context.request.document.clientName } : {}),
        ...(context.request.document.channelType ? { channelType: context.request.document.channelType } : {}),
        ...(context.request.document.conversationId ? { conversationId: context.request.document.conversationId } : {}),
        ...(context.request.document.sectorId ? { sectorId: context.request.document.sectorId } : {}),
        createdAt,
        updatedAt: createdAt,
      },
      now: baseDate,
    });
    transactionIds.push(documentId);
  }
  const primaryTransactionId = transactionIds[0];

  const commissionRate = validateCommissionRate(
    typeof context.request.document.commissionRateApplied === 'number'
      ? context.request.document.commissionRateApplied
      : 0,
  );
  let commissionTransactionId: string | undefined;
  if (commissionRate > 0 && context.request.quote.pricing.totalCents > 0) {
    commissionTransactionId = `${context.documentId}_commission`;
    await ensureCommercialEffectDocumentAdmin({
      db: context.db,
      collection: 'transactions',
      documentId: commissionTransactionId,
      businessId: context.request.businessId,
      operationId: context.operationId,
      data: {
        type: 'despesa',
        category: 'Comissoes',
        description: `Comissão ${context.request.actor.name} — Venda #${context.documentId.slice(0, 6)} (${commissionRate}%)`,
        amount: centsToReais(Math.round(context.request.quote.pricing.totalCents * commissionRate / 100)),
        dueDate: today,
        paymentDate: null,
        status: 'pendente',
        clientId: context.request.actor.id,
        clientName: context.request.actor.name,
        saleId: context.documentId,
        operatorId: context.request.actor.id,
        operatorName: context.request.actor.name,
        createdAt,
        updatedAt: createdAt,
      },
      now: baseDate,
    });
    transactionIds.push(commissionTransactionId);
  }

  const clientId = typeof context.request.document.clientId === 'string' ? context.request.document.clientId : undefined;
  if (clientId) {
    await recordClientPurchaseAdmin({
      db: context.db,
      businessId: context.request.businessId,
      clientId,
      sourceId: context.documentId,
      amount: centsToReais(context.request.quote.pricing.totalCents),
    });
    await markClientWonAdmin({ db: context.db, businessId: context.request.businessId, clientId, nowIso: createdAt });
  }

  const documentPayments = Array.isArray(context.request.document.payments)
    ? context.request.document.payments as Payment[]
    : [];
  await patchSaleFinancialState({
    context,
    transactionIds,
    primaryTransactionId,
    commissionTransactionId,
    paymentStatus: aggregatePaymentStatus(documentPayments),
    financialStatus: aggregateFinancialStatus(documentPayments),
    nowIso: createdAt,
  });
  return { transactionIds };
}

async function storedRequestForReplay(params: {
  db: Firestore;
  businessId: string;
  idempotencyKey: string;
  inputFingerprint: string;
}): Promise<CommercialOperationRequest | undefined> {
  const operationId = commercialOperationId(params.businessId, 'sale', params.idempotencyKey);
  const snapshot = await params.db.collection('commercialOperations').doc(operationId).get();
  if (!snapshot.exists) return undefined;
  const operation = CommercialOperationSchema.parse({ ...snapshot.data(), operationId: snapshot.id });
  if (operation.businessId !== params.businessId || operation.sourceType !== 'sale') {
    throw new CommercialOperationIdempotencyConflictError();
  }
  if (operation.request.document.saleCheckoutFingerprint !== params.inputFingerprint) {
    throw new CommercialOperationIdempotencyConflictError();
  }
  return operation.request;
}

export async function createSaleWithSideEffects(
  rawInput: CreateSaleWithSideEffectsInput,
  db: Firestore = adminDb,
  executionContext: SaleCheckoutExecutionContext = {},
): Promise<CreateSaleResult> {
  const input = CreateSaleWithSideEffectsInputSchema.parse(rawInput);
  const idempotencyKey = input.idempotencyKey ?? deriveIdempotencyKey(input);
  const inputFingerprint = saleInputFingerprint(input);
  const nowFactory = executionContext.now ?? (() => new Date());
  const storedRequest = await storedRequestForReplay({
    db,
    businessId: input.businessId,
    idempotencyKey,
    inputFingerprint,
  });
  const request = storedRequest ?? await buildNewOperationRequest({
    db,
    input,
    idempotencyKey,
    inputFingerprint,
    context: executionContext,
    now: nowFactory(),
  });

  const result = await runCommercialOperationAdmin({
    db,
    request,
    now: nowFactory,
    handlers: { reconcileDownstream: reconcileSaleDownstream },
  });
  const saleSnapshot = await db.collection('sales').doc(result.documentId).get();
  if (!saleSnapshot.exists || saleSnapshot.data()?.businessId !== input.businessId) {
    throw new CommercialOperationError('SALE_RESULT_NOT_FOUND', 'A venda concluída não foi encontrada.');
  }
  const sale = { id: saleSnapshot.id, ...saleSnapshot.data() } as Sale;
  const operationSnapshot = await db.collection('commercialOperations').doc(result.operationId).get();
  const operation = CommercialOperationSchema.parse({ ...operationSnapshot.data(), operationId: result.operationId });
  const stock = operation.checkpoints.stock_applied.result
    ? CommercialStockEffectSchema.parse(operation.checkpoints.stock_applied.result)
    : undefined;
  const transactionIds = result.effects.transactionIds;

  return {
    sale,
    operationId: result.operationId,
    ...(sale.transactionId ? { transactionId: sale.transactionId } : {}),
    transactionIds,
    ...(sale.commissionTransactionId ? { commissionTransactionId: sale.commissionTransactionId } : {}),
    stockMovements: stock?.adjustments.length ?? 0,
    stockAdjustments: (stock?.adjustments ?? []) as StockAdjustmentAdmin[],
    paymentStatus: sale.paymentStatus ?? 'pending',
    replayed: result.replayed,
  };
}
