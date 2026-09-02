import type { Firestore } from 'firebase-admin/firestore';
import { ProductV2Schema, type ProductV2 } from '@/contracts/domain/productV2';
import { ServiceSchema, type Service } from '@/contracts/domain/service';
import {
  CommercialQuoteRequestSchema,
  CommercialQuoteSchema,
  type CommercialQuote,
  type CommercialQuoteRequest,
  type CommercialStockRequirement,
  type QuotedCommercialLine,
} from '@/contracts/domain/commercialV2';
import { resolveDeliveryZone } from '@/lib/services/orders/deliveryZones';
import type { Business } from '@/lib/types';

export type CommercialQuoteErrorCode =
  | 'CATALOG_ITEM_NOT_FOUND'
  | 'INVALID_CATALOG_ITEM'
  | 'TENANT_MISMATCH'
  | 'ITEM_INACTIVE'
  | 'ITEM_UNAVAILABLE'
  | 'VARIANT_REQUIRED'
  | 'VARIANT_NOT_FOUND'
  | 'MODIFIER_INVALID'
  | 'DISCOUNT_FORBIDDEN'
  | 'DELIVERY_OUT_OF_AREA'
  | 'DELIVERY_FEE_OVERRIDE_FORBIDDEN'
  | 'STALE_QUOTE';

export class CommercialQuoteError extends Error {
  constructor(
    public readonly code: CommercialQuoteErrorCode,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'CommercialQuoteError';
  }
}

export interface CommercialDeliveryResolution {
  feeCents: number;
  resolution: 'matched' | 'flat' | 'none' | 'manual';
  zoneName?: string;
  estimatedMinutes?: number;
}

export interface CommercialQuoteResources {
  products: ReadonlyMap<string, ProductV2>;
  services: ReadonlyMap<string, Service>;
  delivery?: CommercialDeliveryResolution;
  canApplyManualDiscount: boolean;
  operatorId?: string;
}

export interface QuoteCommercialCartAdminInput {
  db: Firestore;
  input: unknown;
  canApplyManualDiscount: boolean;
  /** Gerente+ pode propor uma taxa de entrega quando nenhuma zona resolve o
   *  endereço (M02.5b). Default false — PDV/site nunca passam isso. */
  canOverrideDeliveryFee?: boolean;
  operatorId?: string;
  quotedAt?: Date;
}

/** Política monetária única da M02: reais entram uma vez e viram centavos inteiros. */
export function reaisToCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new CommercialQuoteError('INVALID_CATALOG_ITEM', 'Valor monetário inválido no catálogo.');
  }
  return Math.round((value + Number.EPSILON) * 100);
}

export function centsToReais(value: number): number {
  return value / 100;
}

/** Acrescenta descontos já resolvidos por um serviço server-side (ex.: cupom). */
export function applyAuthoritativeCommercialDiscounts(
  quote: CommercialQuote,
  discounts: Array<{
    source: 'coupon' | 'campaign' | 'points' | 'other';
    amountCents: number;
    referenceId?: string;
    reason?: string;
  }>,
): CommercialQuote {
  // Inclui o frete no teto: sem isso, um benefício que precisa cobrir mercadoria
  // + entrega (ex.: gift card) seria clampado ao subtotal e debitado a mais do
  // que o total efetivamente reduzido. Para Sale, deliveryFeeCents é sempre 0.
  let remainingCents = Math.max(
    0,
    quote.pricing.subtotalCents + quote.pricing.deliveryFeeCents - quote.pricing.discountCents,
  );
  const applied = discounts.map((discount) => {
    const amountCents = Math.min(remainingCents, Math.max(0, Math.round(discount.amountCents)));
    remainingCents -= amountCents;
    return { ...discount, amountCents };
  }).filter((discount) => discount.amountCents > 0);
  const addedCents = applied.reduce((sum, discount) => sum + discount.amountCents, 0);
  const discountCents = quote.pricing.discountCents + addedCents;
  return CommercialQuoteSchema.parse({
    ...quote,
    pricing: {
      ...quote.pricing,
      discountCents,
      totalCents: Math.max(
        0,
        quote.pricing.subtotalCents
          + quote.pricing.deliveryFeeCents
          + quote.pricing.tipCents
          - discountCents,
      ),
      discounts: [...quote.pricing.discounts, ...applied],
    },
  });
}

function quoteError(code: CommercialQuoteErrorCode, message: string, status = 400): never {
  throw new CommercialQuoteError(code, message, status);
}

function requireTenant(entity: { businessId: string }, businessId: string, label: string): void {
  if (entity.businessId !== businessId) {
    quoteError('TENANT_MISMATCH', `${label} não pertence ao negócio informado.`, 403);
  }
}

function stockRequirement(
  product: ProductV2,
  quantity: number,
  variantId?: string,
): CommercialStockRequirement[] {
  if (product.kind === 'composite') {
    return (product.components ?? []).map((component) => ({
      productId: component.productId,
      productName: component.productName,
      quantity: component.quantity * quantity,
      available: 0,
      tracked: true,
    }));
  }

  if (variantId) {
    const variant = product.variants.find((candidate) => candidate.id === variantId);
    if (!variant) quoteError('VARIANT_NOT_FOUND', `Variação indisponível para ${product.name}.`);
    return [{
      productId: product.id,
      productName: `${product.name} — ${variant.name}`,
      variantId: variant.id,
      quantity,
      available: variant.currentStock,
      tracked: variant.trackStock,
    }];
  }

  return [{
    productId: product.id,
    productName: product.name,
    quantity,
    available: product.currentStock,
    tracked: product.trackStock,
  }];
}

function hydrateRequirements(
  requirements: CommercialStockRequirement[],
  products: ReadonlyMap<string, ProductV2>,
  businessId: string,
): CommercialStockRequirement[] {
  const hydrated: CommercialStockRequirement[] = [];
  for (const requirement of requirements) {
    const stockProduct = products.get(requirement.productId);
    if (!stockProduct) {
      quoteError('CATALOG_ITEM_NOT_FOUND', `Insumo de estoque não encontrado: ${requirement.productName}.`, 404);
    }
    requireTenant(stockProduct, businessId, `Insumo ${stockProduct.id}`);
    if (stockProduct.isActive === false || stockProduct.archivedAt) {
      quoteError('ITEM_INACTIVE', `Insumo inativo: ${stockProduct.name}.`);
    }

    if (requirement.variantId) {
      const variant = stockProduct.variants.find((candidate) => candidate.id === requirement.variantId);
      if (!variant || !variant.isActive) {
        quoteError('VARIANT_NOT_FOUND', `Variação indisponível para ${stockProduct.name}.`);
      }
      hydrated.push({
        ...requirement,
        productName: `${stockProduct.name} — ${variant.name}`,
        available: variant.currentStock,
        tracked: variant.trackStock,
      });
      continue;
    }

    hydrated.push({
      ...requirement,
      productName: stockProduct.name,
      available: stockProduct.currentStock,
      tracked: stockProduct.trackStock,
    });
  }
  return hydrated;
}

/** Espelha `expandBomLines`: cada linha original expande somente um nível. */
function expandRequirementsOnce(
  requirements: CommercialStockRequirement[],
  products: ReadonlyMap<string, ProductV2>,
  businessId: string,
): CommercialStockRequirement[] {
  const expanded: CommercialStockRequirement[] = [];
  for (const requirement of requirements) {
    const product = products.get(requirement.productId);
    if (!product) {
      quoteError('CATALOG_ITEM_NOT_FOUND', `Insumo de estoque não encontrado: ${requirement.productName}.`, 404);
    }
    requireTenant(product, businessId, `Insumo ${product.id}`);
    if (!product.isActive || product.archivedAt) {
      quoteError('ITEM_INACTIVE', `Insumo inativo: ${product.name}.`);
    }
    if (product.kind === 'composite') {
      for (const component of product.components ?? []) {
        expanded.push({
          productId: component.productId,
          productName: component.productName,
          quantity: component.quantity * requirement.quantity,
          available: 0,
          tracked: true,
        });
      }
    } else {
      expanded.push(requirement);
    }
  }
  return hydrateRequirements(expanded, products, businessId);
}

function applyModifierStrategy(strategy: 'sum' | 'max' | 'avg', values: number[]): number {
  if (values.length === 0) return 0;
  if (strategy === 'max') return Math.max(...values);
  if (strategy === 'avg') return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return values.reduce((sum, value) => sum + value, 0);
}

function quoteProductLine(
  request: CommercialQuoteRequest['lines'][number],
  product: ProductV2,
  input: CommercialQuoteRequest,
  resources: CommercialQuoteResources,
  index: number,
): QuotedCommercialLine {
  requireTenant(product, input.businessId, `Produto ${product.id}`);
  if (!product.isActive || product.archivedAt) {
    quoteError('ITEM_INACTIVE', `Produto inativo: ${product.name}.`);
  }
  if ((input.channel === 'site' || input.channel === 'agent') && product.isDeliverable === false) {
    quoteError('ITEM_UNAVAILABLE', `Produto fora do cardápio: ${product.name}.`);
  }
  if ((input.channel === 'site' || input.channel === 'agent') && !product.menuAvailable) {
    quoteError('ITEM_UNAVAILABLE', `Produto indisponível hoje: ${product.name}.`);
  }

  const needsVariant = product.kind === 'variant' || product.variants.length > 0;
  if (needsVariant && !request.variantId) {
    quoteError('VARIANT_REQUIRED', `Escolha uma variação para ${product.name}.`);
  }
  if (!needsVariant && request.variantId) {
    quoteError('VARIANT_NOT_FOUND', `Produto ${product.name} não possui a variação informada.`);
  }
  const variant = request.variantId
    ? product.variants.find((candidate) => candidate.id === request.variantId)
    : undefined;
  if (request.variantId && (!variant || !variant.isActive)) {
    quoteError('VARIANT_NOT_FOUND', `Variação indisponível para ${product.name}.`);
  }

  const selectedGroups = request.selectedModifiers ?? [];
  if (new Set(selectedGroups.map((group) => group.groupId)).size !== selectedGroups.length) {
    quoteError('MODIFIER_INVALID', `Grupo de modificadores duplicado em ${product.name}.`);
  }

  for (const definition of product.modifierGroups ?? []) {
    const selected = selectedGroups.find((group) => group.groupId === definition.id);
    const count = selected?.selectedOptions.reduce((sum, option) => sum + option.quantity, 0) ?? 0;
    if (definition.required && count < Math.max(1, definition.minSelections)) {
      quoteError('MODIFIER_INVALID', `Selecione ${definition.name}.`);
    }
    if (selected && count < definition.minSelections) {
      quoteError('MODIFIER_INVALID', `Selecione ao menos ${definition.minSelections} em ${definition.name}.`);
    }
    if (count > definition.maxSelections) {
      quoteError('MODIFIER_INVALID', `Máximo ${definition.maxSelections} em ${definition.name}.`);
    }
  }

  let modifierUnitAmountCents = 0;
  const modifierRequirements: CommercialStockRequirement[] = [];
  const quotedModifiers = selectedGroups.map((selected) => {
    const definition = product.modifierGroups?.find((group) => group.id === selected.groupId);
    if (!definition) quoteError('MODIFIER_INVALID', `Modificador inválido em ${product.name}.`);
    if (new Set(selected.selectedOptions.map((option) => option.optionId)).size !== selected.selectedOptions.length) {
      quoteError('MODIFIER_INVALID', `Opção de modificador duplicada em ${definition.name}.`);
    }

    const optionValues: number[] = [];
    const selectedOptions = selected.selectedOptions.map((selectedOption) => {
      const option = definition.options.find((candidate) => candidate.id === selectedOption.optionId);
      if (!option || option.available === false) {
        quoteError('MODIFIER_INVALID', `Opção indisponível em ${definition.name}.`);
      }
      if (selectedOption.quantity > (option.maxQuantity ?? 99)) {
        quoteError('MODIFIER_INVALID', `Quantidade inválida para ${option.name}.`);
      }
      const optionPriceCents = reaisToCents(option.additionalPrice);
      optionValues.push(optionPriceCents * selectedOption.quantity);
      if (option.linkedProductId) {
        modifierRequirements.push({
          productId: option.linkedProductId,
          productName: option.name,
          quantity: (option.consumeQty ?? 1) * selectedOption.quantity * request.quantity,
          available: 0,
          tracked: true,
        });
      }
      return {
        optionId: option.id,
        optionName: option.name,
        quantity: selectedOption.quantity,
        additionalPriceCents: optionPriceCents,
        ...(option.linkedProductId ? { linkedProductId: option.linkedProductId } : {}),
        ...(option.consumeQty ? { consumeQuantity: option.consumeQty } : {}),
      };
    });
    modifierUnitAmountCents += applyModifierStrategy(definition.priceStrategy, optionValues);
    return {
      groupId: definition.id,
      groupName: definition.name,
      priceStrategy: definition.priceStrategy,
      selectedOptions,
    };
  });

  const baseUnitAmountCents = reaisToCents(variant?.salePrice ?? product.salePrice);
  const unitAmountCents = baseUnitAmountCents + modifierUnitAmountCents;
  const subtotalCents = Math.round(unitAmountCents * request.quantity);
  const baseRequirements = stockRequirement(product, request.quantity, variant?.id);
  const requirements = [
    ...hydrateRequirements(baseRequirements, resources.products, input.businessId),
    ...expandRequirementsOnce(modifierRequirements, resources.products, input.businessId),
  ];

  return {
    lineId: request.lineId ?? `line-${index + 1}`,
    kind: 'product',
    productId: product.id,
    ...(variant ? { variantId: variant.id, variantNameSnapshot: variant.name } : {}),
    nameSnapshot: product.name,
    ...(variant?.sku || product.sku ? { skuSnapshot: variant?.sku ?? product.sku } : {}),
    quantity: request.quantity,
    baseUnitAmountCents,
    modifierUnitAmountCents,
    unitAmountCents,
    subtotalCents,
    discountCents: 0,
    totalCents: subtotalCents,
    ...(quotedModifiers.length ? { selectedModifiers: quotedModifiers } : {}),
    stockRequirements: requirements,
    ...(request.notes ? { notes: request.notes } : {}),
  };
}

function quoteServiceLine(
  request: CommercialQuoteRequest['lines'][number],
  service: Service,
  input: CommercialQuoteRequest,
  resources: CommercialQuoteResources,
  index: number,
): QuotedCommercialLine {
  requireTenant(service, input.businessId, `Serviço ${service.id}`);
  if (!service.isActive || service.deletedAt) {
    quoteError('ITEM_INACTIVE', `Serviço inativo: ${service.name}.`);
  }
  if (resources.operatorId && service.operatorIds?.length && !service.operatorIds.includes(resources.operatorId)) {
    quoteError('ITEM_UNAVAILABLE', `Serviço indisponível para o operador informado: ${service.name}.`, 403);
  }
  const unitAmountCents = reaisToCents(service.price);
  const subtotalCents = Math.round(unitAmountCents * request.quantity);
  const requirements = expandRequirementsOnce(
    (service.consumedComponents ?? []).map((component) => ({
      productId: component.productId,
      productName: component.productName,
      quantity: component.quantity * request.quantity,
      available: 0,
      tracked: true,
    })),
    resources.products,
    input.businessId,
  );
  return {
    lineId: request.lineId ?? `line-${index + 1}`,
    kind: 'service',
    serviceId: service.id,
    nameSnapshot: service.name,
    quantity: request.quantity,
    baseUnitAmountCents: unitAmountCents,
    modifierUnitAmountCents: 0,
    unitAmountCents,
    subtotalCents,
    discountCents: 0,
    totalCents: subtotalCents,
    stockRequirements: requirements,
    ...(request.notes ? { notes: request.notes } : {}),
  };
}

function aggregateAvailability(lines: QuotedCommercialLine[]) {
  const aggregated = new Map<string, CommercialStockRequirement>();
  for (const requirement of lines.flatMap((line) => line.stockRequirements)) {
    const key = `${requirement.productId}:${requirement.variantId ?? ''}`;
    const current = aggregated.get(key);
    if (current) current.quantity += requirement.quantity;
    else aggregated.set(key, { ...requirement });
  }
  const shortages = [...aggregated.values()].filter(
    (requirement) => requirement.tracked && requirement.quantity > requirement.available,
  );
  return { available: shortages.length === 0, shortages };
}

export function buildCommercialQuote(
  rawInput: unknown,
  resources: CommercialQuoteResources,
  quotedAt = new Date(),
): CommercialQuote {
  const input = CommercialQuoteRequestSchema.parse(rawInput);
  const lines = input.lines.map((line, index) => {
    if (line.productId) {
      const product = resources.products.get(line.productId);
      if (!product) quoteError('CATALOG_ITEM_NOT_FOUND', `Produto não encontrado: ${line.productId}.`, 404);
      return quoteProductLine(line, product, input, resources, index);
    }
    const service = resources.services.get(line.serviceId!);
    if (!service) quoteError('CATALOG_ITEM_NOT_FOUND', `Serviço não encontrado: ${line.serviceId}.`, 404);
    return quoteServiceLine(line, service, input, resources, index);
  });

  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  let discountCents = 0;
  const discounts: CommercialQuote['pricing']['discounts'] = [];
  if (input.manualDiscount) {
    if (!resources.canApplyManualDiscount) {
      quoteError('DISCOUNT_FORBIDDEN', 'Seu perfil não permite aplicar desconto manual.', 403);
    }
    discountCents = input.manualDiscount.kind === 'fixed'
      ? Math.min(subtotalCents, input.manualDiscount.amountCents)
      : Math.min(subtotalCents, Math.round(subtotalCents * input.manualDiscount.basisPoints / 10_000));
    discounts.push({ source: 'manual', amountCents: discountCents, reason: input.manualDiscount.reason });
  }

  const deliveryFeeCents = input.delivery?.type === 'entrega' ? resources.delivery?.feeCents ?? 0 : 0;
  const totalCents = Math.max(0, subtotalCents + deliveryFeeCents + input.tipCents - discountCents);
  if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== totalCents) {
    quoteError(
      'STALE_QUOTE',
      `O total foi atualizado de ${input.expectedTotalCents} para ${totalCents} centavos. Revise a cesta.`,
      409,
    );
  }

  return CommercialQuoteSchema.parse({
    schemaVersion: 2,
    businessId: input.businessId,
    channel: input.channel,
    quotedAt: quotedAt.toISOString(),
    currency: 'BRL',
    lines,
    pricing: {
      subtotalCents,
      discountCents,
      deliveryFeeCents,
      tipCents: input.tipCents,
      totalCents,
      discounts,
    },
    availability: aggregateAvailability(lines),
    ...(input.delivery ? {
      delivery: {
        type: input.delivery.type,
        feeCents: deliveryFeeCents,
        resolution: input.delivery.type !== 'entrega' ? 'none' : resources.delivery?.resolution ?? 'flat',
        ...(resources.delivery?.zoneName ? { zoneName: resources.delivery.zoneName } : {}),
        ...(resources.delivery?.estimatedMinutes !== undefined
          ? { estimatedMinutes: resources.delivery.estimatedMinutes }
          : {}),
      },
    } : {}),
  });
}

async function loadDocuments<T>(
  db: Firestore,
  collection: string,
  ids: Iterable<string>,
  parse: (raw: unknown) => T,
): Promise<Map<string, T>> {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (uniqueIds.length === 0) return new Map();
  const snapshots = await db.getAll(...uniqueIds.map((id) => db.collection(collection).doc(id)));
  const result = new Map<string, T>();
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    try {
      result.set(snapshot.id, parse({ ...snapshot.data(), id: snapshot.id }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      quoteError('INVALID_CATALOG_ITEM', `${collection}/${snapshot.id} inválido: ${message}`);
    }
  }
  return result;
}

function dependencyProductIds(products: Iterable<ProductV2>, services: Iterable<Service>): Set<string> {
  const ids = new Set<string>();
  for (const product of products) {
    for (const component of product.components ?? []) ids.add(component.productId);
    for (const group of product.modifierGroups ?? []) {
      for (const option of group.options) if (option.linkedProductId) ids.add(option.linkedProductId);
    }
  }
  for (const service of services) {
    for (const component of service.consumedComponents ?? []) ids.add(component.productId);
  }
  return ids;
}

export async function quoteCommercialCartAdmin({
  db,
  input: rawInput,
  canApplyManualDiscount,
  canOverrideDeliveryFee = false,
  operatorId,
  quotedAt = new Date(),
}: QuoteCommercialCartAdminInput): Promise<CommercialQuote> {
  const input = CommercialQuoteRequestSchema.parse(rawInput);
  const productIds = input.lines.flatMap((line) => line.productId ? [line.productId] : []);
  const serviceIds = input.lines.flatMap((line) => line.serviceId ? [line.serviceId] : []);
  const products = await loadDocuments(db, 'products', productIds, (raw) => ProductV2Schema.parse(raw));
  const services = await loadDocuments(db, 'services', serviceIds, (raw) => ServiceSchema.parse(raw));

  const firstDependencies = dependencyProductIds(products.values(), services.values());
  const dependencies = await loadDocuments(db, 'products', firstDependencies, (raw) => ProductV2Schema.parse(raw));
  for (const [id, product] of dependencies) products.set(id, product);

  // Um insumo ligado a modificador pode ser composto. O estoque V2 expande um
  // nível de BOM; esta segunda leitura deixa a prévia de disponibilidade simétrica.
  const secondDependencies = dependencyProductIds(dependencies.values(), []);
  const nested = await loadDocuments(db, 'products', secondDependencies, (raw) => ProductV2Schema.parse(raw));
  for (const [id, product] of nested) products.set(id, product);

  let delivery: CommercialDeliveryResolution | undefined;
  if (input.delivery?.type === 'entrega') {
    const businessSnapshot = await db.collection('businesses').doc(input.businessId).get();
    if (!businessSnapshot.exists) quoteError('CATALOG_ITEM_NOT_FOUND', 'Negócio não encontrado.', 404);
    const business = businessSnapshot.data() as Business;
    const resolution = resolveDeliveryZone(business.settings?.aiAgent?.deliveryZones, {
      cep: input.delivery.cep,
      bairro: input.delivery.bairro,
    });
    const manualFeeCents = input.delivery.manualFeeCents;

    if (resolution.status === 'matched') {
      // Zona é autoritativa — um override manual enviado junto é ignorado.
      delivery = {
        feeCents: reaisToCents(resolution.fee),
        resolution: 'matched',
        zoneName: resolution.zone.name,
        estimatedMinutes: resolution.estimatedMinutes,
      };
    } else if (manualFeeCents !== undefined) {
      // out-of-area ou sem zonas configuradas: o operador propôs uma taxa.
      if (!canOverrideDeliveryFee) {
        quoteError('DELIVERY_FEE_OVERRIDE_FORBIDDEN', 'Seu perfil não permite definir a taxa de entrega manualmente.', 403);
      }
      delivery = { feeCents: manualFeeCents, resolution: 'manual' };
    } else if (resolution.status === 'out-of-area') {
      quoteError('DELIVERY_OUT_OF_AREA', 'Endereço fora da área de entrega desta loja.');
    } else {
      delivery = {
        feeCents: reaisToCents(Math.max(0, business.settings?.aiAgent?.pedidos?.deliveryFee ?? 0)),
        resolution: 'flat',
      };
    }
  }

  return buildCommercialQuote(input, {
    products,
    services,
    delivery,
    canApplyManualDiscount,
    operatorId,
  }, quotedAt);
}
