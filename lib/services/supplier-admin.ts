import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { SupplierCatalogData, SupplierCatalogPatch } from '@/lib/contracts/api/supplier-catalog';
import {
  normalizeBrazilianDocument,
  SupplierV2Schema,
  type SupplierV2,
} from '@/lib/contracts/domain/supplier';
import type { Product, PurchaseNote, StockMovement, Supplier } from '@/lib/types';

export interface SupplierActor {
  uid: string;
  name: string;
}

export interface SupplierHistoryEntry {
  id: string;
  businessId: string;
  supplierId: string;
  action: 'created' | 'updated' | 'archived' | 'reactivated';
  actorId: string;
  actorName: string;
  changedFields: string[];
  createdAt: string;
}

export interface SupplierRelations {
  history: SupplierHistoryEntry[];
  purchaseNotes: PurchaseNote[];
  products: Product[];
  stockMovements: StockMovement[];
}

export interface SupplierPage {
  suppliers: Supplier[];
  hasMore: boolean;
  nextCursor: string | null;
}

export class SupplierNotFoundError extends Error {
  constructor() {
    super('Fornecedor não encontrado.');
    this.name = 'SupplierNotFoundError';
  }
}

export class SupplierDuplicateDocumentError extends Error {
  constructor(public readonly document: string) {
    super('Já existe um fornecedor com este CPF/CNPJ neste negócio.');
    this.name = 'SupplierDuplicateDocumentError';
  }
}

export class SupplierInvalidDocumentError extends Error {
  constructor() {
    super('CPF deve ter 11 dígitos e CNPJ deve ter 14 dígitos.');
    this.name = 'SupplierInvalidDocumentError';
  }
}

export function normalizeSupplierDocument(value: unknown): string {
  return normalizeBrazilianDocument(value);
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

function cleanOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean || undefined;
}

function documentClaimId(businessId: string, document: string): string {
  return createHash('sha256').update(`${businessId}:supplier-document:${document}`).digest('hex');
}

function buildSupplierDocument(params: {
  id: string;
  businessId: string;
  existing?: Record<string, unknown>;
  patch: SupplierCatalogData | SupplierCatalogPatch;
  actor: SupplierActor;
  now: string;
}): Supplier {
  const merged = { ...(params.existing ?? {}), ...withoutUndefined(params.patch) } as Record<string, unknown>;
  const document = normalizeSupplierDocument(merged.document ?? merged.cnpj);
  const documentType = merged.documentType === 'cpf' ? 'cpf' : 'cnpj';
  if ((documentType === 'cpf' && document.length !== 11) || (documentType === 'cnpj' && document.length !== 14)) {
    throw new SupplierInvalidDocumentError();
  }

  for (const field of [
    'nomeFantasia', 'inscricaoEstadual', 'phone', 'email', 'notes', 'paymentTerms',
  ]) {
    const clean = cleanOptionalText(merged[field]);
    if (clean === undefined) delete merged[field];
    else merged[field] = clean;
  }

  const isActive = merged.isActive !== false;
  const parsed = SupplierV2Schema.parse({
    ...merged,
    id: params.id,
    businessId: params.businessId,
    schemaVersion: 2,
    documentType,
    document,
    cnpj: documentType === 'cnpj' ? document : undefined,
    razaoSocial: String(merged.razaoSocial ?? '').trim(),
    isActive,
    createdAt: typeof merged.createdAt === 'string' ? merged.createdAt : params.now,
    updatedAt: params.now,
    ...(isActive
      ? { archivedAt: undefined, archivedBy: undefined }
      : {
          archivedAt: typeof merged.archivedAt === 'string' ? merged.archivedAt : params.now,
          archivedBy: typeof merged.archivedBy === 'string' ? merged.archivedBy : params.actor.uid,
        }),
  });
  return withoutUndefined(parsed) as SupplierV2 as Supplier;
}

async function assertNoLegacyDuplicate(
  db: Firestore,
  businessId: string,
  document: string,
  exceptSupplierId?: string,
): Promise<void> {
  const snapshot = await db.collection('suppliers').where('businessId', '==', businessId).get();
  for (const row of snapshot.docs) {
    if (row.id === exceptSupplierId) continue;
    const data = row.data();
    if (normalizeSupplierDocument(data.document ?? data.cnpj) === document) {
      throw new SupplierDuplicateDocumentError(document);
    }
  }
}

function historyAction(previous: Supplier | undefined, next: Supplier): SupplierHistoryEntry['action'] {
  if (!previous) return 'created';
  if (previous.isActive && !next.isActive) return 'archived';
  if (!previous.isActive && next.isActive) return 'reactivated';
  return 'updated';
}

function changedFields(previous: Supplier | undefined, next: Supplier): string[] {
  if (!previous) return Object.keys(next).filter((field) => !['id', 'businessId', 'createdAt', 'updatedAt'].includes(field));
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].filter((key) => JSON.stringify(previous[key as keyof Supplier]) !== JSON.stringify(next[key as keyof Supplier]));
}

async function writeSupplier(params: {
  db: Firestore;
  businessId: string;
  supplierId: string;
  patch: SupplierCatalogData | SupplierCatalogPatch;
  actor: SupplierActor;
  create: boolean;
}): Promise<Supplier> {
  const supplierRef = params.db.collection('suppliers').doc(params.supplierId);
  const historyRef = params.db.collection('supplierHistory').doc();

  return params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(supplierRef);
    if (params.create && snapshot.exists) throw new Error('Identificador de fornecedor já utilizado.');
    if (!params.create && (!snapshot.exists || snapshot.data()?.businessId !== params.businessId)) {
      throw new SupplierNotFoundError();
    }

    const previous = snapshot.exists
      ? buildSupplierDocument({
          id: snapshot.id,
          businessId: params.businessId,
          existing: snapshot.data(),
          patch: {},
          actor: params.actor,
          now: String(snapshot.data()?.updatedAt ?? new Date().toISOString()),
        })
      : undefined;
    const now = new Date().toISOString();
    const next = buildSupplierDocument({
      id: params.supplierId,
      businessId: params.businessId,
      existing: snapshot.data(),
      patch: params.patch,
      actor: params.actor,
      now,
    });

    const previousDocument = previous ? normalizeSupplierDocument(previous.document ?? previous.cnpj) : undefined;
    const nextDocument = normalizeSupplierDocument(next.document ?? next.cnpj);
    const previousClaimRef = previousDocument
      ? params.db.collection('supplierIdentifiers').doc(documentClaimId(params.businessId, previousDocument))
      : null;
    const nextClaimRef = params.db.collection('supplierIdentifiers').doc(documentClaimId(params.businessId, nextDocument));
    const nextClaim = await tx.get(nextClaimRef);
    if (nextClaim.exists && nextClaim.data()?.supplierId !== params.supplierId) {
      throw new SupplierDuplicateDocumentError(nextDocument);
    }
    const previousClaim = previousClaimRef && previousDocument !== nextDocument
      ? await tx.get(previousClaimRef)
      : null;

    if (params.create) tx.create(supplierRef, next as unknown as Record<string, unknown>);
    else tx.set(supplierRef, next as unknown as Record<string, unknown>);
    tx.set(nextClaimRef, {
      businessId: params.businessId,
      supplierId: params.supplierId,
      document: nextDocument,
      updatedAt: now,
    });
    if (previousClaimRef && previousDocument !== nextDocument) {
      if (previousClaim?.exists && previousClaim.data()?.supplierId === params.supplierId) tx.delete(previousClaimRef);
    }
    tx.create(historyRef, {
      businessId: params.businessId,
      supplierId: params.supplierId,
      action: historyAction(previous, next),
      actorId: params.actor.uid,
      actorName: params.actor.name,
      changedFields: changedFields(previous, next),
      createdAt: now,
    });
    return next;
  });
}

async function linkLegacyPurchaseNotes(db: Firestore, supplier: Supplier): Promise<void> {
  const document = normalizeSupplierDocument(supplier.document ?? supplier.cnpj);
  if (document.length !== 14) return;
  const snapshot = await db.collection('purchaseNotes').where('businessId', '==', supplier.businessId).get();
  const matches = snapshot.docs.filter((row) => {
    const note = row.data();
    return !note.supplierId && normalizeSupplierDocument(note.supplierCnpj) === document;
  });
  for (let offset = 0; offset < matches.length; offset += 450) {
    const batch = db.batch();
    for (const row of matches.slice(offset, offset + 450)) {
      batch.update(row.ref, { supplierId: supplier.id, updatedAt: new Date().toISOString() });
    }
    await batch.commit();
  }
}

export async function createSupplierAdmin(params: {
  db: Firestore;
  businessId: string;
  data: SupplierCatalogData;
  actor: SupplierActor;
}): Promise<Supplier> {
  const document = normalizeSupplierDocument(params.data.document);
  await assertNoLegacyDuplicate(params.db, params.businessId, document);
  const ref = params.db.collection('suppliers').doc();
  const supplier = await writeSupplier({ ...params, supplierId: ref.id, patch: params.data, create: true });
  try {
    await linkLegacyPurchaseNotes(params.db, supplier);
  } catch (cause) {
    console.error('[suppliers] legacy purchase-note link failed after create', cause);
  }
  return supplier;
}

export async function updateSupplierAdmin(params: {
  db: Firestore;
  businessId: string;
  supplierId: string;
  patch: SupplierCatalogPatch;
  actor: SupplierActor;
}): Promise<Supplier> {
  const current = await getSupplierAdmin(params.db, params.businessId, params.supplierId);
  if (!current) throw new SupplierNotFoundError();
  const document = normalizeSupplierDocument(params.patch.document ?? current.document ?? current.cnpj);
  await assertNoLegacyDuplicate(params.db, params.businessId, document, params.supplierId);
  const supplier = await writeSupplier({ ...params, patch: params.patch, create: false });
  try {
    await linkLegacyPurchaseNotes(params.db, supplier);
  } catch (cause) {
    console.error('[suppliers] legacy purchase-note link failed after update', cause);
  }
  return supplier;
}

export async function archiveSupplierAdmin(params: {
  db: Firestore;
  businessId: string;
  supplierId: string;
  actor: SupplierActor;
}): Promise<Supplier> {
  return updateSupplierAdmin({ ...params, patch: { isActive: false } });
}

export async function getSupplierAdmin(
  db: Firestore,
  businessId: string,
  supplierId: string,
): Promise<Supplier | null> {
  const snapshot = await db.collection('suppliers').doc(supplierId).get();
  if (!snapshot.exists) return null;
  if (snapshot.data()?.businessId !== businessId) throw new SupplierNotFoundError();
  return buildSupplierDocument({
    id: snapshot.id,
    businessId,
    existing: snapshot.data(),
    patch: {},
    actor: { uid: 'system', name: 'Sistema' },
    now: String(snapshot.data()?.updatedAt ?? snapshot.data()?.createdAt ?? new Date().toISOString()),
  });
}

export async function listSuppliersAdmin(params: {
  db: Firestore;
  businessId: string;
  includeInactive?: boolean;
  cursor?: string | null;
  limit?: number;
}): Promise<SupplierPage> {
  const pageSize = Math.min(Math.max(params.limit ?? 100, 1), 200);
  const collected: Array<{ supplier: Supplier; rawId: string }> = [];
  let scanCursor = params.cursor ?? null;
  let exhausted = false;
  while (collected.length <= pageSize && !exhausted) {
    let query: FirebaseFirestore.Query = params.db.collection('suppliers')
      .where('businessId', '==', params.businessId)
      .orderBy('__name__')
      .limit(200);
    if (scanCursor) query = query.startAfter(scanCursor);
    const snapshot = await query.get();
    exhausted = snapshot.docs.length < 200;
    for (const row of snapshot.docs) {
      scanCursor = row.id;
      const supplier = buildSupplierDocument({
        id: row.id,
        businessId: params.businessId,
        existing: row.data(),
        patch: {},
        actor: { uid: 'system', name: 'Sistema' },
        now: String(row.data().updatedAt ?? row.data().createdAt ?? new Date().toISOString()),
      });
      if (params.includeInactive || supplier.isActive) collected.push({ supplier, rawId: row.id });
      if (collected.length > pageSize) break;
    }
    if (snapshot.docs.length === 0) exhausted = true;
  }
  const suppliers = collected.slice(0, pageSize).map((item) => item.supplier);
  const hasMore = collected.length > pageSize || !exhausted;
  return {
    suppliers,
    hasMore,
    nextCursor: hasMore ? collected[pageSize - 1]?.rawId ?? scanCursor : null,
  };
}

export async function findSupplierByDocumentAdmin(
  db: Firestore,
  businessId: string,
  document: string,
): Promise<Supplier | null> {
  const wanted = normalizeSupplierDocument(document);
  const snapshot = await db.collection('suppliers').where('businessId', '==', businessId).get();
  const row = snapshot.docs.find((candidate) => {
    const data = candidate.data();
    return normalizeSupplierDocument(data.document ?? data.cnpj) === wanted;
  });
  return row ? getSupplierAdmin(db, businessId, row.id) : null;
}

export async function searchSuppliersAdmin(params: {
  db: Firestore;
  businessId: string;
  query: string;
  includeInactive?: boolean;
  limit?: number;
}): Promise<Array<Supplier & { _score: number }>> {
  const snapshot = await params.db.collection('suppliers').where('businessId', '==', params.businessId).limit(1000).get();
  const text = params.query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const digits = normalizeSupplierDocument(params.query);
  const scored: Array<Supplier & { _score: number }> = [];
  for (const row of snapshot.docs) {
    const supplier = await getSupplierAdmin(params.db, params.businessId, row.id);
    if (!supplier || (!params.includeInactive && !supplier.isActive)) continue;
    const legal = supplier.razaoSocial.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const trade = supplier.nomeFantasia?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() ?? '';
    const document = normalizeSupplierDocument(supplier.document ?? supplier.cnpj);
    let score = 0;
    if (digits.length >= 3 && document.includes(digits)) score = 100;
    else if (legal === text || trade === text) score = 95;
    else if (legal.startsWith(text) || trade.startsWith(text)) score = 75;
    else if (legal.includes(text) || trade.includes(text)) score = 55;
    if (score) scored.push({ ...supplier, _score: score });
  }
  return scored.sort((a, b) => b._score - a._score).slice(0, Math.min(params.limit ?? 20, 50));
}

export async function getSupplierRelationsAdmin(params: {
  db: Firestore;
  businessId: string;
  supplierId: string;
}): Promise<SupplierRelations> {
  const supplier = await getSupplierAdmin(params.db, params.businessId, params.supplierId);
  if (!supplier) throw new SupplierNotFoundError();
  const [historySnapshot, notesSnapshot] = await Promise.all([
    params.db.collection('supplierHistory')
      .where('businessId', '==', params.businessId)
      .where('supplierId', '==', params.supplierId)
      .orderBy('createdAt', 'desc')
      .get(),
    params.db.collection('purchaseNotes').where('businessId', '==', params.businessId).get(),
  ]);
  const document = normalizeSupplierDocument(supplier.document ?? supplier.cnpj);
  const purchaseNotes = notesSnapshot.docs
    .map((row) => ({ ...row.data(), id: row.id } as PurchaseNote))
    .filter((note) => note.supplierId === params.supplierId || normalizeSupplierDocument(note.supplierCnpj) === document)
    .sort((a, b) => (b.issueDate ?? '').localeCompare(a.issueDate ?? ''));

  const movementIds = new Set(purchaseNotes.flatMap((note) => note.stockMovementIds ?? []));
  const stockMovements = (await Promise.all([...movementIds].map(async (id) => {
    const row = await params.db.collection('stockMovements').doc(id).get();
    if (!row.exists || row.data()?.businessId !== params.businessId) return null;
    return { ...row.data(), id: row.id } as StockMovement;
  }))).filter((movement): movement is StockMovement => Boolean(movement));

  const productIds = new Set<string>();
  purchaseNotes.forEach((note) => note.items.forEach((item) => { if (item.productId) productIds.add(item.productId); }));
  stockMovements.forEach((movement) => { if (movement.productId) productIds.add(movement.productId); });
  const products = (await Promise.all([...productIds].map(async (id) => {
    const row = await params.db.collection('products').doc(id).get();
    if (!row.exists || row.data()?.businessId !== params.businessId) return null;
    return { ...row.data(), id: row.id } as Product;
  }))).filter((product): product is Product => Boolean(product));

  const history = historySnapshot.docs
    .map((row) => ({ ...row.data(), id: row.id } as SupplierHistoryEntry))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { history, purchaseNotes, products, stockMovements };
}
