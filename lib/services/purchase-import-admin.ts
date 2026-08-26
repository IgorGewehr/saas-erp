import { createHash } from 'node:crypto';
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
import { normalizeBarcode, normalizeSku } from '@/lib/services/product-catalog-admin';
import type { Product } from '@/lib/types';
import type { ReviewPurchaseNoteRequest } from '@/lib/contracts/api/purchase-note-review';

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
    const activeVariants = (product.variants ?? []).filter((variant) => variant.isActive !== false);
    const candidates = activeVariants.length
      ? activeVariants.map((variant) => ({
        variantId: variant.id,
        name: `${product.name} — ${variant.name}`,
        sku: variant.sku,
        barcode: variant.barcode,
      }))
      : [{ variantId: undefined, name: product.name, sku: product.sku, barcode: product.barcode ?? product.gtin }];
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
    source: 'manual_upload',
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
    const document = withoutUndefined({
      ...snapshot.data(),
      ...canonical,
      items: canonical.items.map(legacyItem),
      notes: canonical.notes,
      reviewedAt: canonical.reviewedAt,
      reviewedBy: canonical.reviewedBy,
      reviewedByName: params.actor.name,
      updatedAt: now,
    }) as unknown as PreparedPurchaseNote;
    tx.set(noteRef, document as unknown as Record<string, unknown>);
    return document;
  });
}
