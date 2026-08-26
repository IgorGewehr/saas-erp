import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { ProductV2Schema, type ProductImageV2 } from '@/lib/contracts/domain/productV2';
import type { ProductCatalogData, ProductCatalogPatch } from '@/lib/contracts/api/product-catalog';
import type { Product } from '@/lib/types';

type IdentifierType = 'sku' | 'barcode';

interface ProductIdentifier {
  type: IdentifierType;
  value: string;
  variantId?: string;
}

export interface CatalogActor {
  uid: string;
  name: string;
}

export class ProductCatalogNotFoundError extends Error {
  constructor() {
    super('Produto não encontrado.');
    this.name = 'ProductCatalogNotFoundError';
  }
}

export class ProductCatalogDuplicateIdentifierError extends Error {
  constructor(
    public readonly identifierType: IdentifierType,
    public readonly identifierValue: string,
  ) {
    super(`${identifierType === 'sku' ? 'SKU' : 'Código de barras'} já utilizado neste negócio.`);
    this.name = 'ProductCatalogDuplicateIdentifierError';
  }
}

export class ProductCatalogVariantStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductCatalogVariantStockError';
  }
}

export function normalizeSku(value?: string | null): string | undefined {
  const normalized = value?.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
  return normalized || undefined;
}

export function normalizeBarcode(value?: string | null): string | undefined {
  const normalized = value?.normalize('NFKC').trim().replace(/[\s-]+/g, '').toUpperCase();
  return normalized || undefined;
}

function cleanOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => withoutUndefined(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, withoutUndefined(entry)]),
    ) as T;
  }
  return value;
}

function cleanLegacyProduct(raw: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...raw };
  const nullableOptionalFields = [
    'maxStock',
    'imageUrl',
    'menuCategory',
    'menuCategoryId',
    'menuDescription',
    'preparationTime',
    'components',
    'dietary',
    'modifierGroups',
    'fiscalTax',
    'archivedAt',
  ];
  for (const field of nullableOptionalFields) {
    if (clean[field] === null) delete clean[field];
  }
  return clean;
}

function normalizeImages(images: ProductImageV2[]): ProductImageV2[] {
  const ordered = images
    .map((image, index) => ({ ...image, sortOrder: index, isPrimary: false }));
  if (ordered[0]) ordered[0].isPrimary = true;
  return ordered;
}

function buildProductDocument(params: {
  id: string;
  businessId: string;
  existing?: Record<string, unknown>;
  patch: ProductCatalogPatch | ProductCatalogData;
  now: string;
}): Product {
  const existing = cleanLegacyProduct(params.existing ?? {});
  const patch = withoutUndefined(params.patch) as Record<string, unknown>;
  const merged = { ...existing, ...patch };

  for (const field of [
    'description', 'sku', 'barcode', 'ncm', 'cfop', 'cest', 'gtin', 'gtinTrib',
    'unidadeTrib', 'menuCategory', 'menuCategoryId', 'menuDescription',
  ]) {
    const cleaned = cleanOptionalText(merged[field]);
    if (cleaned === undefined) delete merged[field];
    else merged[field] = cleaned;
  }

  if (merged.isDeliverable === false) {
    delete merged.menuCategory;
    delete merged.menuCategoryId;
    delete merged.menuDescription;
    delete merged.preparationTime;
    merged.dietary = [];
    merged.modifierGroups = [];
  }

  const components = Array.isArray(merged.components) ? merged.components : [];
  const requestedVariants = Array.isArray(merged.variants) ? merged.variants : [];
  const existingVariants: NonNullable<Product['variants']> = Array.isArray(existing.variants)
    ? existing.variants as NonNullable<Product['variants']>
    : [];
  const existingVariantById = new Map(existingVariants.map((variant) => [variant.id, variant]));
  for (const oldVariant of existingVariants) {
    if (!requestedVariants.some((variant) => variant && typeof variant === 'object' && 'id' in variant && variant.id === oldVariant.id)
      && oldVariant.currentStock !== 0) {
      throw new ProductCatalogVariantStockError(
        `A variação ${oldVariant.name} possui estoque e deve ser zerada antes de ser removida.`,
      );
    }
  }
  if (existingVariants.length === 0 && requestedVariants.length > 0 && Number(existing.currentStock ?? 0) !== 0) {
    throw new ProductCatalogVariantStockError(
      'Zere o estoque principal antes de transformar o produto em produto com variações.',
    );
  }
  const variants = requestedVariants.map((rawVariant) => {
    const variant = rawVariant as NonNullable<Product['variants']>[number];
    return {
      ...variant,
      currentStock: existingVariantById.get(variant.id)?.currentStock ?? 0,
    };
  });
  const images = normalizeImages(Array.isArray(merged.images) ? merged.images as ProductImageV2[] : []);
  const kind = components.length > 0 ? 'composite' : variants.length > 0 ? 'variant' : 'simple';
  const isActive = merged.isActive !== false;
  const primaryImage = images.find((image) => image.isPrimary) ?? images[0];

  const parsed = ProductV2Schema.parse({
    ...merged,
    id: params.id,
    businessId: params.businessId,
    schemaVersion: 2,
    kind,
    name: String(merged.name ?? '').trim(),
    category: String(merged.category ?? '').trim(),
    unit: merged.unit ?? 'UN',
    purchaseUnit: merged.purchaseUnit ?? merged.unit ?? 'UN',
    purchaseToStockFactor: merged.purchaseToStockFactor ?? 1,
    costMethod: merged.costMethod ?? 'moving_average',
    costPrice: merged.costPrice ?? 0,
    salePrice: merged.salePrice ?? 0,
    currentStock: merged.currentStock ?? 0,
    minStock: merged.minStock ?? 0,
    trackStock: kind === 'simple' ? merged.trackStock !== false : false,
    isActive,
    menuAvailable: merged.menuAvailable !== false,
    imageUrl: primaryImage?.url,
    images,
    variants,
    components: components.length > 0 ? components : undefined,
    modifierGroups: Array.isArray(merged.modifierGroups) && merged.modifierGroups.length > 0
      ? merged.modifierGroups
      : undefined,
    dietary: Array.isArray(merged.dietary) && merged.dietary.length > 0 ? merged.dietary : undefined,
    createdAt: typeof merged.createdAt === 'string' ? merged.createdAt : params.now,
    updatedAt: params.now,
    ...(isActive ? { archivedAt: undefined } : { archivedAt: merged.archivedAt ?? params.now }),
  });

  const skuNormalized = normalizeSku(parsed.sku);
  const barcodeNormalized = normalizeBarcode(parsed.barcode);
  return withoutUndefined({
    ...parsed,
    skuNormalized,
    barcodeNormalized,
    ...(isActive ? {} : { archivedBy: merged.archivedBy }),
  }) as Product;
}

function identifiersForProduct(product: Pick<Product, 'sku' | 'barcode' | 'variants'>): ProductIdentifier[] {
  const identifiers: ProductIdentifier[] = [];
  const sku = normalizeSku(product.sku);
  const barcode = normalizeBarcode(product.barcode);
  if (sku) identifiers.push({ type: 'sku', value: sku });
  if (barcode) identifiers.push({ type: 'barcode', value: barcode });
  for (const variant of product.variants ?? []) {
    const variantSku = normalizeSku(variant.sku);
    const variantBarcode = normalizeBarcode(variant.barcode);
    if (variantSku) identifiers.push({ type: 'sku', value: variantSku, variantId: variant.id });
    if (variantBarcode) identifiers.push({ type: 'barcode', value: variantBarcode, variantId: variant.id });
  }
  return identifiers;
}

function assertNoInternalDuplicateIdentifiers(identifiers: ProductIdentifier[]): void {
  const seen = new Set<string>();
  for (const identifier of identifiers) {
    const key = `${identifier.type}:${identifier.value}`;
    if (seen.has(key)) {
      throw new ProductCatalogDuplicateIdentifierError(identifier.type, identifier.value);
    }
    seen.add(key);
  }
}

function identifierClaimId(businessId: string, identifier: ProductIdentifier): string {
  return createHash('sha256')
    .update(`${businessId}:${identifier.type}:${identifier.value}`)
    .digest('hex');
}

async function assertNoLegacyDuplicate(
  db: Firestore,
  businessId: string,
  identifiers: ProductIdentifier[],
  exceptProductId?: string,
): Promise<void> {
  if (identifiers.length === 0) return;
  const wanted = new Map(identifiers.map((identifier) => [
    `${identifier.type}:${identifier.value}`,
    identifier,
  ]));
  const snapshot = await db.collection('products').where('businessId', '==', businessId).get();
  for (const doc of snapshot.docs) {
    if (doc.id === exceptProductId) continue;
    const product = doc.data() as Product;
    for (const identifier of identifiersForProduct(product)) {
      const duplicate = wanted.get(`${identifier.type}:${identifier.value}`);
      if (duplicate) {
        throw new ProductCatalogDuplicateIdentifierError(duplicate.type, duplicate.value);
      }
    }
  }
}

async function writeProductAndClaims(params: {
  db: Firestore;
  product: Product;
  previous?: Product;
}): Promise<void> {
  const { db, product, previous } = params;
  const nextIdentifiers = identifiersForProduct(product);
  const previousIdentifiers = previous ? identifiersForProduct(previous) : [];
  assertNoInternalDuplicateIdentifiers(nextIdentifiers);

  const nextByKey = new Map(nextIdentifiers.map((identifier) => [
    `${identifier.type}:${identifier.value}`,
    identifier,
  ]));
  const previousByKey = new Map(previousIdentifiers.map((identifier) => [
    `${identifier.type}:${identifier.value}`,
    identifier,
  ]));
  const allIdentifiers = new Map([...previousByKey, ...nextByKey]);
  const productRef = db.collection('products').doc(product.id);

  await db.runTransaction(async (tx) => {
    const productSnapshot = await tx.get(productRef);
    if (previous) {
      if (!productSnapshot.exists || productSnapshot.data()?.businessId !== product.businessId) {
        throw new ProductCatalogNotFoundError();
      }
    } else if (productSnapshot.exists) {
      throw new Error('Identificador de produto já existente.');
    }

    const claimSnapshots = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const [key, identifier] of allIdentifiers) {
      const ref = db.collection('productIdentifiers').doc(identifierClaimId(product.businessId, identifier));
      claimSnapshots.set(key, await tx.get(ref));
    }

    for (const [key, identifier] of nextByKey) {
      const snapshot = claimSnapshots.get(key);
      if (snapshot?.exists && snapshot.data()?.productId !== product.id) {
        throw new ProductCatalogDuplicateIdentifierError(identifier.type, identifier.value);
      }
    }

    if (previous) tx.set(productRef, product as unknown as Record<string, unknown>);
    else tx.create(productRef, product as unknown as Record<string, unknown>);

    for (const [key, identifier] of previousByKey) {
      if (nextByKey.has(key)) continue;
      const ref = db.collection('productIdentifiers').doc(identifierClaimId(product.businessId, identifier));
      const snapshot = claimSnapshots.get(key);
      if (snapshot?.exists && snapshot.data()?.productId === product.id) tx.delete(ref);
    }

    for (const identifier of nextIdentifiers) {
      const ref = db.collection('productIdentifiers').doc(identifierClaimId(product.businessId, identifier));
      tx.set(ref, withoutUndefined({
        businessId: product.businessId,
        productId: product.id,
        variantId: identifier.variantId,
        type: identifier.type,
        value: identifier.value,
        updatedAt: product.updatedAt,
        createdAt: claimSnapshots.get(`${identifier.type}:${identifier.value}`)?.data()?.createdAt
          ?? product.createdAt,
      }));
    }
  });
}

export async function getProductCatalogAdmin(
  db: Firestore,
  businessId: string,
  productId: string,
): Promise<Product> {
  const snapshot = await db.collection('products').doc(productId).get();
  if (!snapshot.exists || snapshot.data()?.businessId !== businessId) {
    throw new ProductCatalogNotFoundError();
  }
  return { ...(snapshot.data() as Product), id: snapshot.id };
}

export async function createProductCatalogAdmin(params: {
  db: Firestore;
  businessId: string;
  data: ProductCatalogData;
}): Promise<Product> {
  const ref = params.db.collection('products').doc();
  const now = new Date().toISOString();
  const product = buildProductDocument({
    id: ref.id,
    businessId: params.businessId,
    patch: params.data,
    now,
  });
  const identifiers = identifiersForProduct(product);
  assertNoInternalDuplicateIdentifiers(identifiers);
  await assertNoLegacyDuplicate(params.db, params.businessId, identifiers);
  await writeProductAndClaims({ db: params.db, product });
  return product;
}

export async function updateProductCatalogAdmin(params: {
  db: Firestore;
  businessId: string;
  productId: string;
  patch: ProductCatalogPatch;
}): Promise<Product> {
  const existing = await getProductCatalogAdmin(params.db, params.businessId, params.productId);
  const candidate = buildProductDocument({
    id: existing.id,
    businessId: params.businessId,
    existing: existing as unknown as Record<string, unknown>,
    patch: params.patch,
    now: new Date().toISOString(),
  });
  const identifiers = identifiersForProduct(candidate);
  assertNoInternalDuplicateIdentifiers(identifiers);
  await assertNoLegacyDuplicate(params.db, params.businessId, identifiers, params.productId);

  const productRef = params.db.collection('products').doc(params.productId);
  return params.db.runTransaction(async (tx) => {
    const currentSnapshot = await tx.get(productRef);
    if (!currentSnapshot.exists || currentSnapshot.data()?.businessId !== params.businessId) {
      throw new ProductCatalogNotFoundError();
    }
    const current = { ...(currentSnapshot.data() as Product), id: currentSnapshot.id };
    const product = buildProductDocument({
      id: current.id,
      businessId: params.businessId,
      existing: current as unknown as Record<string, unknown>,
      patch: params.patch,
      now: new Date().toISOString(),
    });
    const nextIdentifiers = identifiersForProduct(product);
    const previousIdentifiers = identifiersForProduct(current);
    assertNoInternalDuplicateIdentifiers(nextIdentifiers);

    const nextByKey = new Map(nextIdentifiers.map((identifier) => [
      `${identifier.type}:${identifier.value}`,
      identifier,
    ]));
    const previousByKey = new Map(previousIdentifiers.map((identifier) => [
      `${identifier.type}:${identifier.value}`,
      identifier,
    ]));
    const allIdentifiers = new Map([...previousByKey, ...nextByKey]);
    const claimSnapshots = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const [key, identifier] of allIdentifiers) {
      const ref = params.db.collection('productIdentifiers').doc(identifierClaimId(params.businessId, identifier));
      claimSnapshots.set(key, await tx.get(ref));
    }
    for (const [key, identifier] of nextByKey) {
      const claim = claimSnapshots.get(key);
      if (claim?.exists && claim.data()?.productId !== product.id) {
        throw new ProductCatalogDuplicateIdentifierError(identifier.type, identifier.value);
      }
    }

    tx.set(productRef, product as unknown as Record<string, unknown>);
    for (const [key, identifier] of previousByKey) {
      if (nextByKey.has(key)) continue;
      const ref = params.db.collection('productIdentifiers').doc(identifierClaimId(params.businessId, identifier));
      const claim = claimSnapshots.get(key);
      if (claim?.exists && claim.data()?.productId === product.id) tx.delete(ref);
    }
    for (const identifier of nextIdentifiers) {
      const key = `${identifier.type}:${identifier.value}`;
      const ref = params.db.collection('productIdentifiers').doc(identifierClaimId(params.businessId, identifier));
      tx.set(ref, withoutUndefined({
        businessId: params.businessId,
        productId: product.id,
        variantId: identifier.variantId,
        type: identifier.type,
        value: identifier.value,
        updatedAt: product.updatedAt,
        createdAt: claimSnapshots.get(key)?.data()?.createdAt ?? product.createdAt,
      }));
    }
    return product;
  });
}

export async function archiveProductCatalogAdmin(params: {
  db: Firestore;
  businessId: string;
  productId: string;
  actor: CatalogActor;
}): Promise<Product> {
  const now = new Date().toISOString();
  const existing = await getProductCatalogAdmin(params.db, params.businessId, params.productId);
  const ref = params.db.collection('products').doc(params.productId);
  await ref.update({
    isActive: false,
    menuAvailable: false,
    archivedAt: now,
    archivedBy: params.actor.uid,
    updatedAt: now,
  });
  return {
    ...existing,
    isActive: false,
    menuAvailable: false,
    archivedAt: now,
    archivedBy: params.actor.uid,
    updatedAt: now,
  };
}

export async function mergeProductImagesAdmin(params: {
  db: Firestore;
  businessId: string;
  productId: string;
  images: ProductImageV2[];
  mode: 'append' | 'replace';
}): Promise<Product> {
  const existing = await getProductCatalogAdmin(params.db, params.businessId, params.productId);
  const current = Array.isArray(existing.images) ? existing.images : [];
  const images = normalizeImages(params.mode === 'replace' ? params.images : [...current, ...params.images]);
  if (images.length > 8) throw new Error('Cada produto aceita no máximo 8 imagens.');
  return updateProductCatalogAdmin({
    db: params.db,
    businessId: params.businessId,
    productId: params.productId,
    patch: { images },
  });
}
