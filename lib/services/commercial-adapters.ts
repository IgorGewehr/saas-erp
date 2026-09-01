import { DeliveryOrderSchema, type DeliveryOrder } from '@/contracts/domain/deliveryOrder';
import { OrderSchema, type Order } from '@/contracts/domain/order';
import { SaleSchema, type Sale } from '@/contracts/domain/sale';
import {
  CommercialDocumentV2Schema,
  type CommercialDocumentV2,
  type CommercialPaymentAllocation,
  type QuotedCommercialLine,
} from '@/contracts/domain/commercialV2';
import { reaisToCents } from '@/lib/services/commercial-quote';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function paymentMethod(method: string | undefined): CommercialPaymentAllocation['method'] {
  const map: Record<string, CommercialPaymentAllocation['method']> = {
    dinheiro: 'cash',
    pix: 'pix',
    pix_online: 'pix',
    credito: 'credit_card',
    cartao_credito: 'credit_card',
    cartao_online: 'credit_card',
    debito: 'debit_card',
    cartao_debito: 'debit_card',
    boleto: 'boleto',
    transferencia: 'bank_transfer',
    creditoLoja: 'store_credit',
    semPagamento: 'unpaid',
    pontos: 'loyalty_points',
    gift_card: 'gift_card',
    voucher: 'voucher',
    outro: 'other',
    outros: 'other',
  };
  return method ? map[method] ?? 'other' : 'unpaid';
}

function modifiersFromLegacy(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const result = value.map((rawGroup) => {
    const group = asRecord(rawGroup);
    const selectedOptions = Array.isArray(group.selectedOptions)
      ? group.selectedOptions.map((rawOption) => {
          const option = asRecord(rawOption);
          return {
            optionId: String(option.optionId ?? 'legacy-option'),
            optionName: String(option.optionName ?? 'Opção legada'),
            quantity: Number(option.quantity ?? 1),
            additionalPriceCents: reaisToCents(Number(option.additionalPrice ?? 0)),
          };
        })
      : [];
    const priceStrategy: 'sum' | 'max' | 'avg' = group.priceStrategy === 'max' || group.priceStrategy === 'avg'
      ? group.priceStrategy
      : 'sum';
    return {
      groupId: String(group.groupId ?? 'legacy-group'),
      groupName: String(group.groupName ?? 'Modificador legado'),
      priceStrategy,
      selectedOptions,
    };
  }).filter((group) => group.selectedOptions.length > 0);
  return result.length ? result : undefined;
}

function legacyLine(input: {
  raw: UnknownRecord;
  lineId: string;
  kind: 'product' | 'service';
  productId?: string;
  serviceId?: string;
  name: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  basePrice?: number;
}): QuotedCommercialLine {
  const unitAmountCents = reaisToCents(input.unitPrice);
  const baseUnitAmountCents = reaisToCents(input.basePrice ?? input.unitPrice);
  const subtotalCents = Math.round(unitAmountCents * input.quantity);
  const discountCents = Math.min(subtotalCents, reaisToCents(input.discount ?? 0));
  const variantId = optionalString(input.raw.variantId);
  const variantName = optionalString(input.raw.variantName) ?? (variantId ? input.name : undefined);
  const selectedModifiers = modifiersFromLegacy(input.raw.selectedModifiers);

  return {
    lineId: input.lineId,
    kind: input.kind,
    ...(input.productId ? { productId: input.productId } : {}),
    ...(input.serviceId ? { serviceId: input.serviceId } : {}),
    ...(variantId ? { variantId, variantNameSnapshot: variantName } : {}),
    nameSnapshot: input.name,
    ...(input.sku ? { skuSnapshot: input.sku } : {}),
    quantity: input.quantity,
    baseUnitAmountCents,
    modifierUnitAmountCents: Math.max(0, unitAmountCents - baseUnitAmountCents),
    unitAmountCents,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
    ...(selectedModifiers ? { selectedModifiers } : {}),
    stockRequirements: [],
    ...(optionalString(input.raw.notes) ? { notes: optionalString(input.raw.notes) } : {}),
  };
}

function emptyEffects(raw: UnknownRecord) {
  const transactionIds = [
    ...stringArray(raw.transactionIds),
    optionalString(raw.transactionId),
    optionalString(raw.commissionTransactionId),
    optionalString(raw.feeTransactionId),
  ]
    .filter((value): value is string => Boolean(value));
  const fiscalDocumentIds = [optionalString(raw.fiscalDocId), optionalString(raw.fiscalDocumentId)]
    .filter((value): value is string => Boolean(value));
  return {
    ...(optionalString(raw.commercialOperationId) || optionalString(raw.operationId)
      ? { operationId: optionalString(raw.commercialOperationId) ?? optionalString(raw.operationId) }
      : {}),
    transactionIds: [...new Set(transactionIds)],
    stockMovementIds: stringArray(raw.stockMovementIds),
    couponRedemptionIds: stringArray(raw.couponRedemptionIds),
    giftCardRedemptionIds: stringArray(raw.giftCardRedemptionIds),
    loyaltyTransactionIds: stringArray(raw.loyaltyTransactionIds),
    fiscalDocumentIds: [...new Set(fiscalDocumentIds)],
  };
}

export function adaptSaleToCommercialV2(rawInput: unknown): CommercialDocumentV2 {
  const raw = asRecord(rawInput);
  const sale: Sale = SaleSchema.parse(rawInput);
  const rawItems = Array.isArray(raw.items) ? raw.items.map(asRecord) : [];
  const lines = sale.items.map((item, index) => legacyLine({
    raw: rawItems[index] ?? {},
    lineId: item.id,
    kind: item.serviceId ? 'service' : 'product',
    productId: item.productId,
    serviceId: item.serviceId,
    name: item.description,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
  }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const discountCents = reaisToCents(sale.discount);
  const tipCents = reaisToCents(sale.tip ?? 0);
  const payments = sale.payments.map((payment, index) => ({
    allocationId: `${sale.id}:payment:${index + 1}`,
    method: paymentMethod(payment.method),
    amountCents: reaisToCents(payment.amount),
    status: payment.status === 'pending' || payment.status === 'unpaid' ? 'pending' as const
      : sale.status === 'finalizada' ? 'paid' as const
      : sale.status === 'cancelada' ? 'refunded' as const
        : 'pending' as const,
    ...(payment.installments ? { installments: payment.installments } : {}),
    ...(payment.cardBrand ? { provider: payment.cardBrand } : {}),
  }));

  return CommercialDocumentV2Schema.parse({
    schemaVersion: 2,
    sourceType: 'sale',
    sourceId: sale.id,
    businessId: sale.businessId,
    channel: sale.channelType ? 'agent' : 'pdv',
    status: sale.status,
    clientId: sale.clientId,
    clientName: sale.clientName,
    lines,
    pricing: {
      subtotalCents,
      discountCents,
      deliveryFeeCents: 0,
      tipCents,
      totalCents: Math.max(0, subtotalCents + tipCents - discountCents),
      discounts: discountCents > 0
        ? [{ source: 'manual', amountCents: discountCents, reason: 'Desconto legado sem origem estruturada' }]
        : [],
    },
    payments,
    effects: emptyEffects(raw),
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
  });
}

export function adaptDeliveryOrderToCommercialV2(rawInput: unknown): CommercialDocumentV2 {
  const raw = asRecord(rawInput);
  const giftCardCents = reaisToCents(Number(raw.giftCardAmount ?? 0));
  const storedTotal = Number(raw.total ?? 0);
  // Desde a M02.5a, o schema legado já desconta giftCardAmount do total (o
  // documento sempre guardou o valor pago, pós-tender) — não há mais reinflação a fazer.
  const order: DeliveryOrder = DeliveryOrderSchema.parse(rawInput);
  const rawItems = Array.isArray(raw.items) ? raw.items.map(asRecord) : [];
  const lines = order.items.map((item, index) => legacyLine({
    raw: rawItems[index] ?? {},
    lineId: `${order.id}:item:${index + 1}`,
    kind: 'product',
    productId: item.productId,
    name: item.productName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    basePrice: item.basePrice,
  }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const commercialDiscountCents = reaisToCents(order.discount ?? 0);
  const couponDiscountCents = Math.min(
    commercialDiscountCents,
    reaisToCents(Number(raw.couponDiscount ?? (optionalString(raw.couponId) ? order.discount ?? 0 : 0))),
  );
  const manualDiscountCents = commercialDiscountCents - couponDiscountCents;
  const discountCents = commercialDiscountCents + giftCardCents;
  const deliveryFeeCents = reaisToCents(order.deliveryFee ?? 0);
  const payments: CommercialPaymentAllocation[] = [];
  if (giftCardCents > 0) {
    payments.push({
      allocationId: `${order.id}:gift-card`,
      method: 'gift_card',
      amountCents: giftCardCents,
      status: 'paid',
      ...(optionalString(raw.giftCardId) ? { externalPaymentId: optionalString(raw.giftCardId) } : {}),
    });
  }
  if (order.paymentMethod || order.total > 0) {
    payments.push({
      allocationId: `${order.id}:payment:1`,
      method: paymentMethod(order.paymentMethod),
      amountCents: reaisToCents(giftCardCents > 0 ? storedTotal : order.total),
      status: order.paymentStatus === 'pago' ? 'paid'
        : order.paymentStatus === 'estornado' ? 'refunded'
          : 'pending',
      ...(optionalString(raw.paymentProvider) ? { provider: optionalString(raw.paymentProvider) } : {}),
      ...(optionalString(raw.externalPaymentId) ? { externalPaymentId: optionalString(raw.externalPaymentId) } : {}),
    });
  }

  const channel = order.channel === 'site' ? 'site'
    : order.channel === 'manual' || !order.channel ? 'manual'
      : 'agent';
  const discounts: CommercialDocumentV2['pricing']['discounts'] = [];
  if (couponDiscountCents > 0) {
    discounts.push({
      source: 'coupon',
      amountCents: couponDiscountCents,
      ...(optionalString(raw.couponId) ? { referenceId: optionalString(raw.couponId) } : {}),
    });
  }
  if (manualDiscountCents > 0) {
    discounts.push({
      source: 'manual',
      amountCents: manualDiscountCents,
      reason: 'Desconto legado sem origem estruturada',
    });
  }
  if (giftCardCents > 0) {
    // O documento legado reduz gift card do campo total. A leitura V2 mantém um
    // ajuste explícito para fechar a aritmética e também expõe a tender separada.
    discounts.push({
      source: 'other',
      amountCents: giftCardCents,
      referenceId: optionalString(raw.giftCardId) ?? 'legacy-gift-card-adjustment',
      reason: 'Ajuste de compatibilidade: gift card reduzia o total legado',
    });
  }

  return CommercialDocumentV2Schema.parse({
    schemaVersion: 2,
    sourceType: 'deliveryOrder',
    sourceId: order.id,
    businessId: order.businessId,
    channel,
    status: order.status,
    clientId: order.clientId,
    clientName: order.clientName,
    lines,
    pricing: {
      subtotalCents,
      discountCents,
      deliveryFeeCents,
      tipCents: 0,
      totalCents: Math.max(0, subtotalCents + deliveryFeeCents - discountCents),
      discounts,
    },
    payments,
    effects: emptyEffects(raw),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  });
}

export function adaptOrderToCommercialV2(rawInput: unknown): CommercialDocumentV2 {
  const raw = asRecord(rawInput);
  const order: Order = OrderSchema.parse(rawInput);
  const rawItems = Array.isArray(raw.items) ? raw.items.map(asRecord) : [];
  const lines = order.items.map((item, index) => legacyLine({
    raw: rawItems[index] ?? {},
    lineId: `${order.id}:item:${index + 1}`,
    kind: 'product',
    productId: item.productId,
    name: item.productName,
    sku: item.sku,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
  }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const discountCents = reaisToCents(order.discount);
  const payments = order.payments?.map((payment, index) => ({
    allocationId: `${order.id}:payment:${index + 1}`,
    method: paymentMethod(payment.method),
    amountCents: reaisToCents(payment.amount),
    status: order.status === 'entregue' ? 'paid' as const : 'pending' as const,
    ...(payment.installments ? { installments: payment.installments } : {}),
  })) ?? (order.paymentMethod ? [{
    allocationId: `${order.id}:payment:1`,
    method: paymentMethod(order.paymentMethod),
    amountCents: reaisToCents(order.total),
    status: order.status === 'entregue' ? 'paid' as const : 'pending' as const,
  }] : []);

  return CommercialDocumentV2Schema.parse({
    schemaVersion: 2,
    sourceType: 'order',
    sourceId: order.id,
    businessId: order.businessId,
    channel: order.type === 'pdv' ? 'pdv' : 'b2b',
    status: order.status,
    clientId: order.clientId,
    clientName: order.clientName,
    lines,
    pricing: {
      subtotalCents,
      discountCents,
      deliveryFeeCents: 0,
      tipCents: 0,
      totalCents: Math.max(0, subtotalCents - discountCents),
      discounts: discountCents > 0
        ? [{ source: 'manual', amountCents: discountCents, reason: 'Desconto legado sem origem estruturada' }]
        : [],
    },
    payments,
    effects: emptyEffects(raw),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  });
}
