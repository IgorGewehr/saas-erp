import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { PurchaseNoteV2Schema, type PurchaseNoteItemV2, type PurchaseNoteV2 } from '@/lib/contracts/domain/purchaseNoteV2';
import type { ParsedPurchaseXml } from '@/lib/services/purchase-xml-parser';
import {
  createSupplierAdmin,
  findSupplierByDocumentAdmin,
  updateSupplierAdmin,
  type SupplierActor,
} from '@/lib/services/supplier-admin';
import type { SupplierCatalogPatch } from '@/lib/contracts/api/supplier-catalog';
import {
  createProductCatalogAdmin,
  normalizeBarcode,
  normalizeSku,
} from '@/lib/services/product-catalog-admin';
import type { BankAccount, Product, Transaction } from '@/lib/types';
import type { ReviewPurchaseNoteRequest } from '@/lib/contracts/api/purchase-note-review';
import type { ProductCatalogData } from '@/lib/contracts/api/product-catalog';
import { StockMovementV2Schema, type StockMovementV2 } from '@/lib/contracts/domain/stockMovementV2';
import {
  applyStockOperationAdmin,
  StockDependencyConflictError,
} from '@/lib/services/stock-core-admin';
import {
  ensurePurchaseAuditEvent,
  purchaseEventActor,
  type PurchaseEventActor,
} from '@/lib/services/purchase-domain-events';

export class PurchaseNoteDuplicateError extends Error {
  constructor(public readonly existingNoteId: string) {
    super('Esta NF-e já foi adicionada neste negócio.');
    this.name = 'PurchaseNoteDuplicateError';
  }
}

export interface PreparedPurchaseNote extends PurchaseNoteV2 {
  supplierName: string;
  supplierCnpj: string;
  supplierId?: string;
  totalProducts: number;
  totalTaxes: number;
  totalValue: number;
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, withoutUndefined(entry)]),
    ) as T;
  }
  return value;
}

function claimId(businessId: string, accessKey: string): string {
  return createHash('sha256').update(`${businessId}:purchase-access-key:${accessKey}`).digest('hex');
}

function normalizeText(value?: string): string {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokenOverlap(left: string, right: string): number {
  const a = new Set(normalizeText(left).split(' ').filter((token) => token.length > 2));
  const b = new Set(normalizeText(right).split(' ').filter((token) => token.length > 2));
  if (!a.size || !b.size) return 0;
  let matches = 0;
  a.forEach((token) => { if (b.has(token)) matches += 1; });
  return matches / Math.max(a.size, b.size);
}

function productSuggestions(item: PurchaseNoteItemV2, products: Product[]): NonNullable<PurchaseNoteItemV2['matchSuggestions']> {
  const supplierCode = normalizeSku(item.supplierProductCode);
  const gtin = normalizeBarcode(item.gtin);
  const suggestions: NonNullable<PurchaseNoteItemV2['matchSuggestions']> = [];

  for (const product of products) {
    const variants = product.variants ?? [];
    const trackedVariants = variants.filter((variant) => variant.isActive !== false && variant.trackStock !== false);
    const candidates = variants.length
      ? trackedVariants.map((variant) => ({
        variantId: variant.id,
        name: `${product.name} — ${variant.name}`,
        sku: variant.sku,
        barcode: variant.barcode,
      }))
      : product.trackStock === false ? [] : [{ variantId: undefined, name: product.name, sku: product.sku, barcode: product.barcode ?? product.gtin }];
    for (const candidate of candidates) {
      const reasons: string[] = [];
      let confidence = 0;
      if (gtin && normalizeBarcode(candidate.barcode) === gtin) {
        confidence = 1;
        reasons.push('GTIN/código de barras exato');
      }
      if (supplierCode && normalizeSku(candidate.sku) === supplierCode) {
        confidence = Math.max(confidence, 0.96);
        reasons.push('código do fornecedor/SKU exato');
      }
      const sourceName = normalizeText(item.productName);
      const candidateName = normalizeText(candidate.name);
      if (sourceName === candidateName) {
        confidence = Math.max(confidence, 0.92);
        reasons.push('nome exato');
      } else {
        const overlap = tokenOverlap(sourceName, candidateName);
        if (overlap >= 0.5) {
          confidence = Math.max(confidence, 0.45 + overlap * 0.4);
          reasons.push('nome semelhante');
        }
      }
      if (item.ncm && product.ncm && item.ncm.replace(/\D/g, '') === product.ncm.replace(/\D/g, '')) {
        confidence = Math.min(1, confidence + 0.08);
        reasons.push('NCM compatível');
      }
      if (confidence >= 0.45) suggestions.push({
        productId: product.id,
        ...(candidate.variantId ? { variantId: candidate.variantId } : {}),
        productName: candidate.name,
        confidence: Math.round(confidence * 100) / 100,
        reasons,
      });
    }
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function normalizedUnit(value: string): string {
  return value.normalize('NFKC').trim().toUpperCase();
}

function conversionFor(item: PurchaseNoteItemV2, product: Product | undefined): { stockUnit: string; factor: number } {
  if (!product) return { stockUnit: item.purchaseUnit, factor: 1 };
  const purchaseUnit = normalizedUnit(item.purchaseUnit);
  const stockUnit = normalizedUnit(product.unit);
  if (purchaseUnit === normalizedUnit(product.purchaseUnit ?? product.unit)) {
    return { stockUnit: product.unit, factor: product.purchaseToStockFactor ?? 1 };
  }
  if (purchaseUnit === stockUnit) return { stockUnit: product.unit, factor: 1 };
  const known: Record<string, number> = { 'KG:G': 1000, 'G:KG': 0.001, 'L:ML': 1000, 'ML:L': 0.001 };
  return { stockUnit: product.unit, factor: known[`${purchaseUnit}:${stockUnit}`] ?? 1 };
}

function landedTotal(item: PurchaseNoteItemV2): number {
  const costs = item.allocatedCosts;
  return item.productTotal + (costs?.freight ?? 0) + (costs?.insurance ?? 0)
    + (costs?.other ?? 0) + (costs?.st ?? 0) + (costs?.ipi ?? 0) - (costs?.discount ?? 0);
}

function legacyItem(item: PurchaseNoteItemV2): Record<string, unknown> {
  return {
    ...item,
    ...(item.supplierProductCode ? { cProd: item.supplierProductCode } : {}),
    unit: item.purchaseUnit,
    quantity: item.purchaseQuantity,
    total: item.productTotal,
    icms: item.taxes?.icms,
    ipi: item.taxes?.ipi,
    pis: item.taxes?.pis,
    cofins: item.taxes?.cofins,
    ...(item.action !== 'pending' ? { importAction: item.action } : {}),
  };
}

export function preparedDocument(
  current: Record<string, unknown>,
  canonical: PurchaseNoteV2,
  extra: Record<string, unknown> = {},
): PreparedPurchaseNote {
  return withoutUndefined({
    ...current,
    ...canonical,
    supplierName: canonical.supplier.name,
    supplierCnpj: canonical.supplier.document,
    supplierId: canonical.supplier.id,
    items: canonical.items.map(legacyItem),
    totalProducts: canonical.totals.products,
    totalTaxes: canonical.totals.invoice - canonical.totals.products,
    totalValue: canonical.totals.invoice,
    ...extra,
  }) as unknown as PreparedPurchaseNote;
}

export class PurchaseNoteNotReviewableError extends Error {
  constructor(message = 'A nota não está disponível para revisão.') {
    super(message);
    this.name = 'PurchaseNoteNotReviewableError';
  }
}

export async function findPurchaseNoteByAccessKeyAdmin(
  db: Firestore,
  businessId: string,
  accessKey: string,
): Promise<string | null> {
  const claim = await db.collection('purchaseNoteIdentifiers').doc(claimId(businessId, accessKey)).get();
  if (claim.exists && claim.data()?.businessId === businessId) return String(claim.data()?.purchaseNoteId ?? '') || null;
  const legacy = await db.collection('purchaseNotes').where('businessId', '==', businessId).where('accessKey', '==', accessKey).limit(1).get();
  return legacy.empty ? null : legacy.docs[0].id;
}

export async function preparePurchaseNoteAdmin(params: {
  db: Firestore;
  businessId: string;
  noteId: string;
  parsed: ParsedPurchaseXml;
  xmlStoragePath: string;
  originalFileName: string;
  actor: SupplierActor;
  source?: PurchaseNoteV2['source'];
}): Promise<PreparedPurchaseNote> {
  const existingId = await findPurchaseNoteByAccessKeyAdmin(params.db, params.businessId, params.parsed.accessKey);
  if (existingId) throw new PurchaseNoteDuplicateError(existingId);

  let supplier = await findSupplierByDocumentAdmin(
    params.db,
    params.businessId,
    params.parsed.supplier.document,
  );
  if (!supplier) {
    supplier = await createSupplierAdmin({
      db: params.db,
      businessId: params.businessId,
      actor: params.actor,
      data: {
        documentType: params.parsed.supplier.documentType,
        document: params.parsed.supplier.document,
        razaoSocial: params.parsed.supplier.name,
        nomeFantasia: params.parsed.supplier.tradeName,
        inscricaoEstadual: params.parsed.supplier.stateRegistration,
        phone: params.parsed.supplier.phone,
        endereco: params.parsed.supplier.address,
        isActive: true,
      },
    });
  } else {
    const patch: SupplierCatalogPatch = {};
    if (!supplier.nomeFantasia && params.parsed.supplier.tradeName) patch.nomeFantasia = params.parsed.supplier.tradeName;
    if (!supplier.inscricaoEstadual && params.parsed.supplier.stateRegistration) patch.inscricaoEstadual = params.parsed.supplier.stateRegistration;
    if (!supplier.phone && params.parsed.supplier.phone) patch.phone = params.parsed.supplier.phone;
    const incomingAddress = params.parsed.supplier.address;
    if (incomingAddress && Object.values(incomingAddress).some(Boolean)) {
      const currentAddress = supplier.endereco;
      const address = {
        logradouro: currentAddress?.logradouro || incomingAddress.logradouro,
        numero: currentAddress?.numero || incomingAddress.numero,
        complemento: currentAddress?.complemento || incomingAddress.complemento,
        bairro: currentAddress?.bairro || incomingAddress.bairro,
        municipio: currentAddress?.municipio || incomingAddress.municipio,
        uf: currentAddress?.uf || incomingAddress.uf,
        cep: currentAddress?.cep || incomingAddress.cep,
      };
      if (JSON.stringify(address) !== JSON.stringify(currentAddress)) patch.endereco = address;
    }
    if (Object.keys(patch).length) {
      supplier = await updateSupplierAdmin({
        db: params.db,
        businessId: params.businessId,
        supplierId: supplier.id,
        patch,
        actor: params.actor,
      });
    }
  }

  const productsSnapshot = await params.db.collection('products')
    .where('businessId', '==', params.businessId)
    .where('isActive', '==', true)
    .limit(1000)
    .get();
  const products = productsSnapshot.docs.map((row) => ({ ...row.data(), id: row.id } as Product));
  const productIndex = new Map(products.map((product) => [product.id, product]));
  const items = params.parsed.items.map((item) => {
    const matchSuggestions = productSuggestions(item, products);
    const best = matchSuggestions[0];
    const conversion = conversionFor(item, best?.confidence >= 0.85 ? productIndex.get(best.productId) : undefined);
    const stockQuantity = item.purchaseQuantity * conversion.factor;
    return {
      ...item,
      matchSuggestions,
      stockUnit: conversion.stockUnit,
      conversionFactor: conversion.factor,
      stockQuantity,
      landedUnitCost: Math.round((landedTotal(item) / stockQuantity + Number.EPSILON) * 10000) / 10000,
    };
  });
  const now = new Date().toISOString();
  const canonical = PurchaseNoteV2Schema.parse({
    schemaVersion: 2,
    id: params.noteId,
    businessId: params.businessId,
    accessKey: params.parsed.accessKey,
    numero: params.parsed.numero,
    serie: params.parsed.serie,
    issueDate: params.parsed.issueDate,
    source: params.source ?? 'manual_upload',
    supplier: { id: supplier.id, document: params.parsed.supplier.document, name: params.parsed.supplier.name },
    recipientDocument: params.parsed.recipientDocument,
    items,
    totals: params.parsed.totals,
    status: 'pendente',
    stockMovementIds: [],
    xmlStoragePath: params.xmlStoragePath,
    xmlSha256: params.parsed.xmlSha256,
    originalFileName: params.originalFileName.slice(0, 255),
    validationWarnings: params.parsed.warnings,
    createdAt: now,
    updatedAt: now,
  });
  const document = withoutUndefined({
    ...canonical,
    supplierName: canonical.supplier.name,
    supplierCnpj: canonical.supplier.document,
    supplierId: canonical.supplier.id,
    items: canonical.items.map(legacyItem),
    totalProducts: canonical.totals.products,
    totalTaxes: canonical.totals.invoice - canonical.totals.products,
    totalValue: canonical.totals.invoice,
    createdBy: params.actor.uid,
    createdByName: params.actor.name,
  }) as unknown as PreparedPurchaseNote;
  const noteRef = params.db.collection('purchaseNotes').doc(params.noteId);
  const identifierRef = params.db.collection('purchaseNoteIdentifiers').doc(claimId(params.businessId, params.parsed.accessKey));
  await params.db.runTransaction(async (tx) => {
    const [noteSnapshot, identifierSnapshot] = await Promise.all([tx.get(noteRef), tx.get(identifierRef)]);
    if (noteSnapshot.exists) throw new PurchaseNoteDuplicateError(noteSnapshot.id);
    if (identifierSnapshot.exists) {
      throw new PurchaseNoteDuplicateError(String(identifierSnapshot.data()?.purchaseNoteId ?? ''));
    }
    tx.create(noteRef, document as unknown as Record<string, unknown>);
    tx.create(identifierRef, {
      businessId: params.businessId,
      purchaseNoteId: params.noteId,
      accessKey: params.parsed.accessKey,
      createdAt: now,
    });
  });
  return document;
}

export async function reviewPurchaseNoteAdmin(params: {
  db: Firestore;
  businessId: string;
  noteId: string;
  items: ReviewPurchaseNoteRequest['items'];
  notes?: string;
  actor: SupplierActor;
}): Promise<PreparedPurchaseNote> {
  const noteRef = params.db.collection('purchaseNotes').doc(params.noteId);
  return params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(noteRef);
    if (!snapshot.exists || snapshot.data()?.businessId !== params.businessId) {
      throw new PurchaseNoteNotReviewableError('Nota não encontrada.');
    }
    const note = PurchaseNoteV2Schema.parse({ ...snapshot.data(), id: snapshot.id });
    if (!['rascunho', 'pendente'].includes(note.status) || note.stockImportedAt || note.importClaim) {
      throw new PurchaseNoteNotReviewableError();
    }
    if (params.items.length !== note.items.length) {
      throw new PurchaseNoteNotReviewableError('Revise todos os itens da nota.');
    }
    const reviewByLine = new Map(params.items.map((item) => [item.lineId, item]));
    if (note.items.some((item) => !reviewByLine.has(item.lineId))) {
      throw new PurchaseNoteNotReviewableError('A revisão não corresponde aos itens da nota.');
    }

    const products = new Map<string, Product>();
    for (const review of params.items) {
      if (review.action !== 'match' || !review.productId || products.has(review.productId)) continue;
      const productSnapshot = await tx.get(params.db.collection('products').doc(review.productId));
      if (!productSnapshot.exists || productSnapshot.data()?.businessId !== params.businessId) {
        throw new PurchaseNoteNotReviewableError(`Produto inválido na linha ${review.lineId}.`);
      }
      const product = { ...productSnapshot.data(), id: productSnapshot.id } as Product;
      if (product.isActive === false) throw new PurchaseNoteNotReviewableError(`Produto inativo na linha ${review.lineId}.`);
      products.set(product.id, product);
    }

    const reviewedItems = note.items.map((item) => {
      const review = reviewByLine.get(item.lineId)!;
      if (review.action === 'match') {
        const product = products.get(review.productId!);
        const variant = review.variantId
          ? product?.variants?.find((candidate) => candidate.id === review.variantId)
          : undefined;
        if (!review.variantId && product?.variants?.some((candidate) => candidate.isActive !== false)) {
          throw new PurchaseNoteNotReviewableError(`Selecione uma variação na linha ${item.lineId}.`);
        }
        if (review.variantId && (!variant || variant.isActive === false)) {
          throw new PurchaseNoteNotReviewableError(`Variação inválida na linha ${item.lineId}.`);
        }
        if ((variant ? variant.trackStock === false : product?.trackStock === false)) {
          throw new PurchaseNoteNotReviewableError(`Controle de estoque desativado na linha ${item.lineId}.`);
        }
        return {
          ...item,
          action: 'match' as const,
          productId: product!.id,
          ...(variant ? { variantId: variant.id } : {}),
          newProduct: undefined,
          stockUnit: product!.unit,
          conversionFactor: review.conversionFactor,
          stockQuantity: item.purchaseQuantity * review.conversionFactor,
          landedUnitCost: review.landedUnitCost,
          importStatus: 'pending' as const,
          lot: review.lot,
          error: undefined,
        };
      }
      if (review.action === 'create') {
        return {
          ...item,
          action: 'create' as const,
          productId: undefined,
          variantId: undefined,
          newProduct: review.newProduct,
          stockUnit: review.newProduct!.unit,
          conversionFactor: review.conversionFactor,
          stockQuantity: item.purchaseQuantity * review.conversionFactor,
          landedUnitCost: review.landedUnitCost,
          importStatus: 'pending' as const,
          lot: review.lot,
          error: undefined,
        };
      }
      return {
        ...item,
        action: 'skip' as const,
        productId: undefined,
        variantId: undefined,
        newProduct: undefined,
        conversionFactor: 1,
        stockQuantity: item.purchaseQuantity,
        importStatus: 'skipped' as const,
        lot: undefined,
        error: undefined,
      };
    });
    const now = new Date().toISOString();
    const canonical = PurchaseNoteV2Schema.parse({
      ...note,
      items: reviewedItems,
      notes: params.notes || undefined,
      reviewedAt: now,
      reviewedBy: params.actor.uid,
      updatedAt: now,
    });
    const document = preparedDocument(snapshot.data() ?? {}, canonical, {
      reviewedByName: params.actor.name,
      updatedAt: now,
    });
    tx.set(noteRef, document as unknown as Record<string, unknown>);
    return document;
  });
}

const PURCHASE_CLAIM_TTL_MS = 5 * 60 * 1000;
const RETRYABLE_PURCHASE_STATUSES = new Set<PurchaseNoteV2['status']>(['parcial', 'falha']);

export class PurchaseNoteClaimConflictError extends Error {
  constructor() {
    super('Esta nota já está sendo confirmada por outro usuário.');
    this.name = 'PurchaseNoteClaimConflictError';
  }
}

export class PurchaseNoteNotReadyError extends Error {
  constructor(message = 'Revise todos os itens antes de confirmar a entrada.') {
    super(message);
    this.name = 'PurchaseNoteNotReadyError';
  }
}

class PurchaseNoteClaimLostError extends Error {
  constructor() {
    super('O processamento perdeu a posse da nota. Tente novamente em instantes.');
    this.name = 'PurchaseNoteClaimLostError';
  }
}

export interface PurchaseNoteConfirmationResult {
  note: PreparedPurchaseNote;
  replayed: boolean;
  importedCount: number;
  skippedCount: number;
  errorCount: number;
}

function confirmationResult(note: PreparedPurchaseNote, replayed: boolean): PurchaseNoteConfirmationResult {
  return {
    note,
    replayed,
    importedCount: note.items.filter((item) => item.importStatus === 'imported').length,
    skippedCount: note.items.filter((item) => item.importStatus === 'skipped').length,
    errorCount: note.items.filter((item) => item.importStatus === 'error').length,
  };
}

function purchaseProductId(businessId: string, noteId: string, lineId: string): string {
  const digest = createHash('sha256').update(`${businessId}:${noteId}:${lineId}:purchase-product`).digest('hex');
  return `purchase_product_${digest.slice(0, 40)}`;
}

async function ensurePurchaseProduct(params: {
  db: Firestore;
  businessId: string;
  noteId: string;
  item: PurchaseNoteItemV2;
}): Promise<Product> {
  if (!params.item.newProduct) throw new PurchaseNoteNotReadyError(`Dados do novo produto ausentes na linha ${params.item.lineId}.`);
  const productId = purchaseProductId(params.businessId, params.noteId, params.item.lineId);
  const productRef = params.db.collection('products').doc(productId);
  const existing = await productRef.get();
  if (existing.exists) {
    if (existing.data()?.businessId !== params.businessId) throw new Error('Produto determinístico pertence a outro negócio.');
    return { ...existing.data(), id: existing.id } as Product;
  }
  const draft = params.item.newProduct;
  const data: ProductCatalogData = {
    kind: 'simple',
    name: draft.name,
    category: draft.category,
    unit: draft.unit,
    purchaseUnit: params.item.purchaseUnit,
    purchaseToStockFactor: params.item.conversionFactor,
    costMethod: 'moving_average',
    costPrice: params.item.landedUnitCost,
    salePrice: 0,
    minStock: 0,
    trackStock: true,
    trackLots: Boolean(params.item.lot),
    trackExpiry: Boolean(params.item.lot?.expiresAt),
    expiryWarningDays: 30,
    isActive: true,
    menuAvailable: false,
    isDeliverable: false,
    sku: draft.sku,
    barcode: draft.barcode,
    ncm: params.item.ncm,
    cfop: params.item.cfop,
    gtin: params.item.gtin,
  };
  try {
    return await createProductCatalogAdmin({ db: params.db, businessId: params.businessId, productId, data });
  } catch (cause) {
    const raced = await productRef.get();
    if (raced.exists && raced.data()?.businessId === params.businessId) {
      return { ...raced.data(), id: raced.id } as Product;
    }
    throw cause;
  }
}

async function persistPurchaseItemResult(params: {
  db: Firestore;
  noteId: string;
  businessId: string;
  claimToken: string;
  lineId: string;
  patch: Partial<PurchaseNoteItemV2>;
}): Promise<void> {
  const noteRef = params.db.collection('purchaseNotes').doc(params.noteId);
  await params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(noteRef);
    if (!snapshot.exists || snapshot.data()?.businessId !== params.businessId) throw new PurchaseNoteClaimLostError();
    const note = PurchaseNoteV2Schema.parse({ ...snapshot.data(), id: snapshot.id });
    if (note.status !== 'processando' || note.importClaim?.token !== params.claimToken) {
      throw new PurchaseNoteClaimLostError();
    }
    let found = false;
    const items = note.items.map((item) => {
      if (item.lineId !== params.lineId) return item;
      found = true;
      return { ...item, ...params.patch };
    });
    if (!found) throw new PurchaseNoteClaimLostError();
    const now = new Date().toISOString();
    const canonical = PurchaseNoteV2Schema.parse({ ...note, items, updatedAt: now });
    tx.set(noteRef, preparedDocument(snapshot.data() ?? {}, canonical, { updatedAt: now }) as unknown as Record<string, unknown>);
  });
}

function conciseError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : 'Falha desconhecida ao importar o item.';
  return message.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Falha desconhecida ao importar o item.';
}

export async function confirmPurchaseNoteAdmin(params: {
  db: Firestore;
  businessId: string;
  noteId: string;
  actor: PurchaseEventActor;
  retryFailed?: boolean;
}): Promise<PurchaseNoteConfirmationResult> {
  const noteRef = params.db.collection('purchaseNotes').doc(params.noteId);
  const claimToken = randomUUID();
  const claimedAt = new Date();
  const claimed = await params.db.runTransaction(async (tx): Promise<
    { kind: 'terminal'; note: PreparedPurchaseNote } |
    { kind: 'claimed'; note: PurchaseNoteV2 }
  > => {
    const snapshot = await tx.get(noteRef);
    if (!snapshot.exists || snapshot.data()?.businessId !== params.businessId) {
      throw new PurchaseNoteNotReadyError('Nota não encontrada.');
    }
    const note = PurchaseNoteV2Schema.parse({ ...snapshot.data(), id: snapshot.id });
    const retryingFailedItems = Boolean(
      params.retryFailed &&
      RETRYABLE_PURCHASE_STATUSES.has(note.status) &&
      note.items.some((item) => item.importStatus === 'error'),
    );
    if (note.status === 'importada' || (RETRYABLE_PURCHASE_STATUSES.has(note.status) && !retryingFailedItems)) {
      return { kind: 'terminal', note: preparedDocument(snapshot.data() ?? {}, note) };
    }
    if (note.reversalClaim) {
      throw new PurchaseNoteNotReadyError('A nota possui uma reversão em andamento e não pode ser reprocessada.');
    }
    if (note.status === 'processando' && note.importClaim && Date.parse(note.importClaim.expiresAt) > claimedAt.getTime()) {
      throw new PurchaseNoteClaimConflictError();
    }
    if (!['pendente', 'rascunho', 'processando', 'parcial', 'falha'].includes(note.status) || !note.reviewedAt) {
      throw new PurchaseNoteNotReadyError();
    }
    if (note.items.some((item) => item.action === 'pending')) throw new PurchaseNoteNotReadyError();
    const expiresAt = new Date(claimedAt.getTime() + PURCHASE_CLAIM_TTL_MS).toISOString();
    const canonical = PurchaseNoteV2Schema.parse({
      ...note,
      status: 'processando',
      importClaim: {
        token: claimToken,
        claimedBy: params.actor.uid,
        claimedAt: claimedAt.toISOString(),
        expiresAt,
      },
      updatedAt: claimedAt.toISOString(),
    });
    tx.set(noteRef, preparedDocument(snapshot.data() ?? {}, canonical, {
      importClaimedByName: params.actor.name,
      updatedAt: claimedAt.toISOString(),
    }) as unknown as Record<string, unknown>);
    return { kind: 'claimed', note: canonical };
  });

  if (claimed.kind === 'terminal') return confirmationResult(claimed.note, true);

  for (const item of claimed.note.items) {
    if (item.importStatus === 'imported' || item.importStatus === 'skipped' || item.action === 'skip') continue;
    let productId = item.productId;
    let movementId: string | undefined;
    try {
      if (item.action === 'create') {
        const product = await ensurePurchaseProduct({
          db: params.db,
          businessId: params.businessId,
          noteId: params.noteId,
          item,
        });
        productId = product.id;
      }
      if (!productId) throw new PurchaseNoteNotReadyError(`Produto ausente na linha ${item.lineId}.`);
      const stock = await applyStockOperationAdmin(params.db, {
        businessId: params.businessId,
        type: 'entrada',
        lines: [{
          productId,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          quantity: item.stockQuantity,
          sourceLineId: item.lineId,
          unitCost: item.landedUnitCost,
          ...(item.lot ? {
            lot: {
              ...item.lot,
              ...(claimed.note.supplier.id ? { supplierId: claimed.note.supplier.id } : {}),
              supplierName: claimed.note.supplier.name,
              supplierDocument: claimed.note.supplier.document,
              purchaseNoteNumber: `${claimed.note.numero}/${claimed.note.serie}`,
            },
          } : {}),
        }],
        operatorId: params.actor.uid,
        operatorName: params.actor.name,
        reason: `NF-e ${claimed.note.numero}/${claimed.note.serie} — ${claimed.note.supplier.name}`,
        sourceType: 'purchase',
        sourceId: params.noteId,
        sourceDocument: { collection: 'purchaseNotes', id: params.noteId, existence: 'required' },
        idempotencyKey: `purchase:${params.noteId}:line:${item.lineId}:entry`,
        expandBom: false,
        negativeStockPolicy: 'prevent',
        requireActiveProducts: true,
        requireTrackedProducts: true,
      });
      movementId = stock.adjustments[0]?.movementId;
      if (!movementId) throw new Error('A entrada não gerou movimento de estoque.');
    } catch (cause) {
      if (cause instanceof PurchaseNoteClaimLostError) throw cause;
      await persistPurchaseItemResult({
        db: params.db,
        noteId: params.noteId,
        businessId: params.businessId,
        claimToken,
        lineId: item.lineId,
        patch: {
          ...(productId ? { productId } : {}),
          importStatus: 'error',
          error: conciseError(cause),
        },
      });
      continue;
    }
    await persistPurchaseItemResult({
      db: params.db,
      noteId: params.noteId,
      businessId: params.businessId,
      claimToken,
      lineId: item.lineId,
      patch: {
        productId,
        importStatus: 'imported',
        stockMovementId: movementId,
        error: undefined,
      },
    });
  }

  return params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(noteRef);
    if (!snapshot.exists || snapshot.data()?.businessId !== params.businessId) throw new PurchaseNoteClaimLostError();
    const note = PurchaseNoteV2Schema.parse({ ...snapshot.data(), id: snapshot.id });
    if (note.status !== 'processando' || note.importClaim?.token !== claimToken) throw new PurchaseNoteClaimLostError();
    const importedItems = note.items.filter((item) => item.importStatus === 'imported');
    const errorItems = note.items.filter((item) => item.importStatus === 'error');
    const status: PurchaseNoteV2['status'] = errorItems.length === 0
      ? 'importada'
      : importedItems.length > 0 ? 'parcial' : 'falha';
    const now = new Date().toISOString();
    const importError = errorItems.length
      ? `${errorItems.length} item(ns) com erro: ${errorItems.map((item) => item.error).filter(Boolean).join(' | ')}`.slice(0, 2000)
      : undefined;
    const stockMovementIds = [...new Set(importedItems.map((item) => item.stockMovementId).filter((id): id is string => Boolean(id)))];
    const canonical = PurchaseNoteV2Schema.parse({
      ...note,
      status,
      importClaim: undefined,
      stockMovementIds,
      ...(status === 'importada' || status === 'parcial' ? {
        stockImportedAt: note.stockImportedAt ?? now,
        importedAt: note.importedAt ?? now,
      } : {
        stockImportedAt: undefined,
      }),
      importError,
      updatedAt: now,
    });
    const document = preparedDocument(snapshot.data() ?? {}, canonical, {
      importedBy: params.actor.uid,
      importedByName: params.actor.name,
      importedActorType: params.actor.type ?? 'user',
      updatedAt: now,
    });
    if (status === 'importada' || status === 'parcial') {
      await ensurePurchaseAuditEvent({
        db: params.db,
        tx,
        event: {
          type: 'purchase.imported',
          businessId: params.businessId,
          occurredAt: canonical.importedAt ?? now,
          ...purchaseEventActor(params.actor),
          purchaseNoteId: params.noteId,
          movementsCreated: stockMovementIds.length,
          movementIds: stockMovementIds,
          costUpdates: importedItems.length,
          resultStatus: status,
          ...(canonical.supplier.id ? { supplierId: canonical.supplier.id } : {}),
          total: canonical.totals.invoice,
        },
      });
    }
    tx.set(noteRef, document as unknown as Record<string, unknown>);
    return confirmationResult(document, false);
  });
}

export class PurchaseNoteReversalConflictError extends Error {
  constructor() {
    super('Esta nota já está sendo revertida por outro usuário.');
    this.name = 'PurchaseNoteReversalConflictError';
  }
}

export class PurchaseNoteNotReversibleError extends Error {
  constructor(message = 'Somente compras importadas ou parcialmente importadas podem ser revertidas.') {
    super(message);
    this.name = 'PurchaseNoteNotReversibleError';
  }
}

export class PurchaseNoteReversalBlockedError extends Error {
  readonly code = 'PURCHASE_REVERSAL_BLOCKED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseNoteReversalBlockedError';
  }
}

class PurchaseNoteReversalClaimLostError extends Error {
  constructor() {
    super('O processamento perdeu a posse da reversão. Tente novamente em instantes.');
    this.name = 'PurchaseNoteReversalClaimLostError';
  }
}

export interface PurchaseNoteReversalResult {
  note: PreparedPurchaseNote;
  replayed: boolean;
  reversedCount: number;
}

interface PurchaseReversalTarget {
  item: PurchaseNoteItemV2;
  movement: StockMovementV2;
}

function assertFinancialTransactionForReversal(params: {
  note: PurchaseNoteV2;
  transaction: Transaction;
}): void {
  const expectedAmount = Math.round((params.note.totals.invoice + Number.EPSILON) * 100) / 100;
  const transaction = params.transaction;
  if (
    transaction.businessId !== params.note.businessId || transaction.type !== 'despesa' ||
    transaction.purchaseNoteId !== params.note.id || transaction.sourceType !== 'purchase' ||
    Math.abs(transaction.amount - expectedAmount) > 0.001
  ) {
    throw new PurchaseNoteReversalBlockedError('O vínculo financeiro da compra está inconsistente e exige revisão manual.');
  }
  if (params.note.financial?.status === 'paid' && transaction.status !== 'pago') {
    throw new PurchaseNoteReversalBlockedError('A despesa paga foi alterada fora da compra; revise o financeiro antes da reversão.');
  }
  if (params.note.financial?.status === 'payable_created' && !['pendente', 'atrasado', 'pago', 'cancelado'].includes(transaction.status)) {
    throw new PurchaseNoteReversalBlockedError('A conta a pagar foi alterada fora da compra; revise o financeiro antes da reversão.');
  }
  if (transaction.status === 'pago' && !(params.note.financial?.bankAccountId ?? transaction.bankAccountId)) {
    throw new PurchaseNoteReversalBlockedError('A despesa foi paga sem indicar a conta debitada; revise o financeiro antes da reversão.');
  }
}

async function validatePurchaseFinancialReversal(params: {
  db: Firestore;
  businessId: string;
  note: PurchaseNoteV2;
}): Promise<void> {
  const financial = params.note.financial;
  if (!financial || financial.status === 'not_requested' || financial.status === 'reversed') return;
  if (!financial.transactionId) {
    throw new PurchaseNoteReversalBlockedError('A compra não possui o identificador do lançamento financeiro.');
  }
  const transactionSnapshot = await params.db.collection('transactions').doc(financial.transactionId).get();
  if (!transactionSnapshot.exists) {
    throw new PurchaseNoteReversalBlockedError('O lançamento financeiro da compra não foi encontrado.');
  }
  const transaction = { ...transactionSnapshot.data(), id: transactionSnapshot.id } as Transaction;
  assertFinancialTransactionForReversal({ note: params.note, transaction });
  if (transaction.status === 'pago') {
    const bankAccountId = financial.bankAccountId ?? transaction.bankAccountId;
    if (!bankAccountId) {
      throw new PurchaseNoteReversalBlockedError('A compra paga não possui conta financeira para recompor o saldo.');
    }
    const bankSnapshot = await params.db.collection('bankAccounts').doc(bankAccountId).get();
    if (!bankSnapshot.exists || bankSnapshot.data()?.businessId !== params.businessId || !Number.isFinite(bankSnapshot.data()?.balance)) {
      throw new PurchaseNoteReversalBlockedError('A conta da compra paga não está disponível para recompor o saldo.');
    }
  }
}

function reversalTargetKey(movement: Pick<StockMovementV2, 'productId' | 'variantId'>): string {
  return `${movement.productId}:${movement.variantId ?? ''}`;
}

function reversalResult(note: PreparedPurchaseNote, replayed: boolean): PurchaseNoteReversalResult {
  return {
    note,
    replayed,
    reversedCount: note.reversalMovementIds.length,
  };
}

async function loadPurchaseReversalTargets(params: {
  db: Firestore;
  businessId: string;
  note: PurchaseNoteV2;
}): Promise<PurchaseReversalTarget[]> {
  const importedItems = params.note.items.filter((item) => item.importStatus === 'imported');
  const targets = await Promise.all(importedItems.map(async (item): Promise<PurchaseReversalTarget> => {
    if (!item.stockMovementId || !item.productId) {
      throw new PurchaseNoteReversalBlockedError(`A linha ${item.lineId} não possui trilha completa de estoque para reversão automática.`);
    }
    const snapshot = await params.db.collection('stockMovements').doc(item.stockMovementId).get();
    if (!snapshot.exists) {
      throw new PurchaseNoteReversalBlockedError(`O movimento original da linha ${item.lineId} não foi encontrado.`);
    }
    const raw = snapshot.data() ?? {};
    const parsed = StockMovementV2Schema.safeParse({ ...raw, id: snapshot.id });
    if (!parsed.success) {
      throw new PurchaseNoteReversalBlockedError(`O movimento original da linha ${item.lineId} não possui auditoria válida.`);
    }
    const movement = parsed.data;
    const sameVariant = (movement.variantId ?? '') === (item.variantId ?? '');
    if (
      raw.schemaVersion !== 2 || movement.balanceAccuracy !== 'exact' || movement.businessId !== params.businessId ||
      movement.type !== 'entrada' || movement.sourceType !== 'purchase' || movement.sourceId !== params.note.id ||
      movement.sourceLineId !== item.lineId || movement.productId !== item.productId || !sameVariant
    ) {
      throw new PurchaseNoteReversalBlockedError(`A origem do movimento da linha ${item.lineId} não permite reversão automática.`);
    }
    if (movement.previousCost === undefined || movement.newCost === undefined) {
      throw new PurchaseNoteReversalBlockedError(`A linha ${item.lineId} não possui memória de custo; faça a reversão com revisão manual.`);
    }
    if ((movement.lotAllocations?.length ?? 0) > 1) {
      throw new PurchaseNoteReversalBlockedError(`A linha ${item.lineId} possui múltiplos lotes e exige revisão manual.`);
    }
    return { item, movement };
  }));

  const originals = new Set(targets.map(({ movement }) => movement.id));
  const byTarget = new Map<string, PurchaseReversalTarget[]>();
  for (const target of targets) {
    const key = reversalTargetKey(target.movement);
    byTarget.set(key, [...(byTarget.get(key) ?? []), target]);
  }

  await Promise.all([...byTarget.values()].map(async (group) => {
    const firstTimestamp = Math.min(...group.map(({ movement }) => Date.parse(movement.createdAt)));
    if (!Number.isFinite(firstTimestamp)) {
      throw new PurchaseNoteReversalBlockedError('A trilha original não possui data confiável para validar dependências.');
    }
    const sample = group[0].movement;
    const snapshot = await params.db.collection('stockMovements')
      .where('businessId', '==', params.businessId)
      .where('productId', '==', sample.productId)
      .limit(501)
      .get();
    if (snapshot.docs.length > 500) {
      throw new PurchaseNoteReversalBlockedError('Há movimentos demais após a compra; a reversão exige revisão manual.');
    }
    const dependency = snapshot.docs.find((document) => {
      const movement = document.data();
      if (movement.businessId !== params.businessId || (movement.variantId ?? '') !== (sample.variantId ?? '')) return false;
      if (originals.has(document.id)) return false;
      const isOwnReversal = movement.sourceType === 'purchase' && movement.sourceId === params.note.id &&
        typeof movement.reversalOfMovementId === 'string' && originals.has(movement.reversalOfMovementId);
      if (isOwnReversal) return false;
      const createdAt = typeof movement.createdAt === 'string' ? Date.parse(movement.createdAt) : Number.NaN;
      return !Number.isFinite(createdAt) || createdAt >= firstTimestamp;
    });
    if (dependency) {
      throw new PurchaseNoteReversalBlockedError('Há movimentos posteriores de estoque; a reversão exige revisão manual.');
    }
  }));

  return targets.sort((left, right) =>
    Date.parse(right.movement.createdAt) - Date.parse(left.movement.createdAt) ||
    right.movement.id.localeCompare(left.movement.id),
  );
}

async function persistPurchaseItemReversal(params: {
  db: Firestore;
  businessId: string;
  noteId: string;
  claimToken: string;
  lineId: string;
  reversalMovementId: string;
}): Promise<void> {
  const noteRef = params.db.collection('purchaseNotes').doc(params.noteId);
  await params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(noteRef);
    if (!snapshot.exists || snapshot.data()?.businessId !== params.businessId) throw new PurchaseNoteReversalClaimLostError();
    const note = PurchaseNoteV2Schema.parse({ ...snapshot.data(), id: snapshot.id });
    if (note.reversalClaim?.token !== params.claimToken || !['importada', 'parcial'].includes(note.status)) {
      throw new PurchaseNoteReversalClaimLostError();
    }
    const now = new Date().toISOString();
    let found = false;
    const items = note.items.map((item) => {
      if (item.lineId !== params.lineId) return item;
      found = true;
      return { ...item, reversalMovementId: params.reversalMovementId, reversedAt: now };
    });
    if (!found) throw new PurchaseNoteReversalClaimLostError();
    const canonical = PurchaseNoteV2Schema.parse({
      ...note,
      items,
      reversalMovementIds: [...new Set([...note.reversalMovementIds, params.reversalMovementId])],
      updatedAt: now,
    });
    tx.set(noteRef, preparedDocument(snapshot.data() ?? {}, canonical, { updatedAt: now }) as unknown as Record<string, unknown>);
  });
}

async function releasePurchaseReversalClaim(params: {
  db: Firestore;
  businessId: string;
  noteId: string;
  claimToken: string;
  cause: unknown;
}): Promise<void> {
  const noteRef = params.db.collection('purchaseNotes').doc(params.noteId);
  await params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(noteRef);
    if (!snapshot.exists || snapshot.data()?.businessId !== params.businessId) return;
    const note = PurchaseNoteV2Schema.parse({ ...snapshot.data(), id: snapshot.id });
    if (note.reversalClaim?.token !== params.claimToken) return;
    const now = new Date().toISOString();
    const canonical = PurchaseNoteV2Schema.parse({
      ...note,
      reversalClaim: undefined,
      reversalError: conciseError(params.cause),
      updatedAt: now,
    });
    tx.set(noteRef, preparedDocument(snapshot.data() ?? {}, canonical, {
      reversalClaimedByName: undefined,
      updatedAt: now,
    }) as unknown as Record<string, unknown>);
  });
}

export async function reversePurchaseNoteAdmin(params: {
  db: Firestore;
  businessId: string;
  noteId: string;
  reason: string;
  actor: PurchaseEventActor;
}): Promise<PurchaseNoteReversalResult> {
  const reason = params.reason.trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new PurchaseNoteNotReversibleError('Informe um motivo de reversão entre 5 e 500 caracteres.');
  }
  const noteRef = params.db.collection('purchaseNotes').doc(params.noteId);
  const claimToken = randomUUID();
  const claimedAt = new Date();
  const claimed = await params.db.runTransaction(async (tx): Promise<
    { kind: 'terminal'; note: PreparedPurchaseNote } |
    { kind: 'claimed'; note: PurchaseNoteV2 }
  > => {
    const snapshot = await tx.get(noteRef);
    if (!snapshot.exists || snapshot.data()?.businessId !== params.businessId) {
      throw new PurchaseNoteNotReversibleError('Nota não encontrada.');
    }
    const note = PurchaseNoteV2Schema.parse({ ...snapshot.data(), id: snapshot.id });
    if (note.status === 'revertida') return { kind: 'terminal', note: preparedDocument(snapshot.data() ?? {}, note) };
    if (note.reversalClaim && Date.parse(note.reversalClaim.expiresAt) > claimedAt.getTime()) {
      throw new PurchaseNoteReversalConflictError();
    }
    if (!['importada', 'parcial'].includes(note.status) || note.importClaim) {
      throw new PurchaseNoteNotReversibleError();
    }
    const now = claimedAt.toISOString();
    const canonical = PurchaseNoteV2Schema.parse({
      ...note,
      reversalClaim: {
        token: claimToken,
        claimedBy: params.actor.uid,
        claimedAt: now,
        expiresAt: new Date(claimedAt.getTime() + PURCHASE_CLAIM_TTL_MS).toISOString(),
      },
      reversalError: undefined,
      updatedAt: now,
    });
    tx.set(noteRef, preparedDocument(snapshot.data() ?? {}, canonical, {
      reversalClaimedByName: params.actor.name,
      updatedAt: now,
    }) as unknown as Record<string, unknown>);
    return { kind: 'claimed', note: canonical };
  });

  if (claimed.kind === 'terminal') return reversalResult(claimed.note, true);

  try {
    await validatePurchaseFinancialReversal({ db: params.db, businessId: params.businessId, note: claimed.note });
    const targets = await loadPurchaseReversalTargets({ db: params.db, businessId: params.businessId, note: claimed.note });
    for (const { item, movement } of targets) {
      if (item.reversalMovementId) continue;
      let result;
      try {
        result = await applyStockOperationAdmin(params.db, {
          businessId: params.businessId,
          type: 'saida',
          lines: [{
            productId: movement.productId,
            ...(movement.variantId ? { variantId: movement.variantId } : {}),
            quantity: Math.abs(movement.quantity),
            sourceLineId: item.lineId,
            expectedCurrentStock: movement.newStock,
            costRestoration: {
              expectedCurrentCost: movement.newCost!,
              targetCost: movement.previousCost!,
            },
            reversalOfMovementId: movement.id,
            ...(movement.lotAllocations?.[0] ? { lotId: movement.lotAllocations[0].lotId } : {}),
          }],
          operatorId: params.actor.uid,
          operatorName: params.actor.name,
          reason: `Reversão NF-e ${claimed.note.numero}/${claimed.note.serie}: ${reason}`,
          sourceType: 'purchase',
          sourceId: params.noteId,
          sourceDocument: { collection: 'purchaseNotes', id: params.noteId, existence: 'required' },
          idempotencyKey: `purchase:${params.noteId}:line:${item.lineId}:reversal`,
          expandBom: false,
          negativeStockPolicy: 'prevent',
        });
      } catch (cause) {
        if (cause instanceof StockDependencyConflictError) {
          throw new PurchaseNoteReversalBlockedError(`${cause.message} A reversão exige revisão manual.`);
        }
        throw cause;
      }
      const reversalMovementId = result.adjustments[0]?.movementId;
      if (!reversalMovementId) throw new Error(`A reversão da linha ${item.lineId} não gerou movimento compensatório.`);
      await persistPurchaseItemReversal({
        db: params.db,
        businessId: params.businessId,
        noteId: params.noteId,
        claimToken,
        lineId: item.lineId,
        reversalMovementId,
      });
    }

    return await params.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(noteRef);
      if (!snapshot.exists || snapshot.data()?.businessId !== params.businessId) throw new PurchaseNoteReversalClaimLostError();
      const note = PurchaseNoteV2Schema.parse({ ...snapshot.data(), id: snapshot.id });
      if (note.reversalClaim?.token !== claimToken || !['importada', 'parcial'].includes(note.status)) {
        throw new PurchaseNoteReversalClaimLostError();
      }
      const financial = note.financial;
      const financialTransactionRef = financial?.transactionId
        ? params.db.collection('transactions').doc(financial.transactionId)
        : undefined;
      const financialTransactionSnapshot = financialTransactionRef ? await tx.get(financialTransactionRef) : undefined;
      const financialTransaction = financialTransactionSnapshot?.exists
        ? { ...financialTransactionSnapshot.data(), id: financialTransactionSnapshot.id } as Transaction
        : undefined;
      const financialBankAccountId = financialTransaction?.status === 'pago'
        ? (financial?.bankAccountId ?? financialTransaction.bankAccountId)
        : undefined;
      const financialBankAccountRef = financialBankAccountId
        ? params.db.collection('bankAccounts').doc(financialBankAccountId)
        : undefined;
      const financialBankAccountSnapshot = financialBankAccountRef ? await tx.get(financialBankAccountRef) : undefined;
      const now = new Date().toISOString();
      const missingReversal = note.items.some((item) => item.importStatus === 'imported' && !item.reversalMovementId);
      if (missingReversal) throw new PurchaseNoteReversalClaimLostError();
      await ensurePurchaseAuditEvent({
        db: params.db,
        tx,
        event: {
          type: 'purchase.reverted',
          businessId: params.businessId,
          occurredAt: now,
          ...purchaseEventActor(params.actor),
          purchaseNoteId: params.noteId,
          movementsReversed: note.reversalMovementIds.length,
          ...(financialTransaction ? { transactionId: financialTransaction.id } : {}),
          ...(financialBankAccountId ? { bankAccountId: financialBankAccountId } : {}),
          amountRestored: financialTransaction?.status === 'pago' ? financialTransaction.amount : 0,
          reason,
        },
      });
      if (financial && !['not_requested', 'reversed'].includes(financial.status)) {
        if (!financialTransactionRef || !financialTransaction) {
          throw new PurchaseNoteReversalBlockedError('O lançamento financeiro da compra não foi encontrado.');
        }
        assertFinancialTransactionForReversal({ note, transaction: financialTransaction });
        if (financialTransaction.status === 'pago') {
          if (!financialBankAccountRef || !financialBankAccountSnapshot?.exists) {
            throw new PurchaseNoteReversalBlockedError('A conta da compra paga não está disponível para recompor o saldo.');
          }
          const account = { ...financialBankAccountSnapshot.data(), id: financialBankAccountSnapshot.id } as BankAccount;
          if (account.businessId !== params.businessId || !Number.isFinite(account.balance)) {
            throw new PurchaseNoteReversalBlockedError('A conta da compra paga não está disponível para recompor o saldo.');
          }
          tx.update(financialBankAccountRef, {
            balance: Math.round((account.balance + financialTransaction.amount + Number.EPSILON) * 100) / 100,
            updatedAt: now,
          });
        }
      }
      if (financialTransactionRef && financialTransaction && financial?.status !== 'reversed') {
        tx.update(financialTransactionRef, {
          status: 'cancelado',
          cancelledAt: now,
          cancelledBy: params.actor.uid,
          cancelledByName: params.actor.name,
          updatedAt: now,
        });
      }
      const canonical = PurchaseNoteV2Schema.parse({
        ...note,
        status: 'revertida',
        reversalClaim: undefined,
        reversalError: undefined,
        revertedAt: now,
        reversedBy: params.actor.uid,
        reversalReason: reason,
        ...(financial ? {
          financial: {
            ...financial,
            ...(financialBankAccountId ? { bankAccountId: financialBankAccountId } : {}),
            status: 'reversed',
          },
        } : {}),
        updatedAt: now,
      });
      const document = preparedDocument(snapshot.data() ?? {}, canonical, {
        reversedByName: params.actor.name,
        reversedActorType: params.actor.type ?? 'user',
        reversalClaimedByName: undefined,
        updatedAt: now,
      });
      tx.set(noteRef, document as unknown as Record<string, unknown>);
      return reversalResult(document, false);
    });
  } catch (cause) {
    await releasePurchaseReversalClaim({
      db: params.db,
      businessId: params.businessId,
      noteId: params.noteId,
      claimToken,
      cause,
    }).catch(() => undefined);
    throw cause;
  }
}
