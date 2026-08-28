import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import {
  ProductV2Schema,
  type ProductV2,
} from '@/lib/contracts/domain/productV2';
import {
  PurchaseNoteV2Schema,
  type PurchaseNoteItemV2,
  type PurchaseNoteV2,
} from '@/lib/contracts/domain/purchaseNoteV2';
import { StockMovementV2Schema } from '@/lib/contracts/domain/stockMovementV2';
import { SupplierV2Schema } from '@/lib/contracts/domain/supplier';
import { normalizeBarcode, normalizeSku } from '@/lib/services/product-catalog-admin';
import { writeStructuredOperationLog } from '@/lib/services/structured-operation-log';

export const M01_MIGRATION_VERSION = 'm01-parity-v2-2026-08-28';
export const M01_MIGRATION_ENTITIES = [
  'products',
  'suppliers',
  'purchaseNotes',
  'stockMovements',
] as const;

export type M01MigrationEntity = typeof M01_MIGRATION_ENTITIES[number];
export type M01MigrationPlanStatus = 'unchanged' | 'update' | 'invalid';

interface MigrationClaim {
  collection: 'productIdentifiers' | 'supplierIdentifiers' | 'purchaseNoteIdentifiers';
  id: string;
  ownerField: 'productId' | 'supplierId' | 'purchaseNoteId';
  ownerId: string;
  data: Record<string, unknown>;
}

export interface M01DocumentMigrationPlan {
  entity: M01MigrationEntity;
  documentId: string;
  status: M01MigrationPlanStatus;
  patch: Record<string, unknown>;
  claims: MigrationClaim[];
  warnings: string[];
  errors: string[];
}

export interface M01MigrationStats {
  scanned: number;
  updated: number;
  unchanged: number;
  invalid: number;
  conflicts: number;
  claimsCreated: number;
  pages: number;
}

export interface M01MigrationResult {
  migrationVersion: string;
  runId: string;
  businessId: string;
  dryRun: boolean;
  stats: Record<M01MigrationEntity, M01MigrationStats>;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedPatch(current: Record<string, unknown>, canonical: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(withoutUndefined(canonical))
      .filter(([key, value]) => !jsonEqual(current[key], value)),
  );
}

function productClaims(product: ProductV2, now: string): MigrationClaim[] {
  const identifiers: Array<{ type: 'sku' | 'barcode'; value: string; variantId?: string }> = [];
  const sku = normalizeSku(product.sku);
  const barcode = normalizeBarcode(product.barcode);
  if (sku) identifiers.push({ type: 'sku', value: sku });
  if (barcode) identifiers.push({ type: 'barcode', value: barcode });
  for (const variant of product.variants) {
    const variantSku = normalizeSku(variant.sku);
    const variantBarcode = normalizeBarcode(variant.barcode);
    if (variantSku) identifiers.push({ type: 'sku', value: variantSku, variantId: variant.id });
    if (variantBarcode) identifiers.push({ type: 'barcode', value: variantBarcode, variantId: variant.id });
  }
  return identifiers.map((identifier) => ({
    collection: 'productIdentifiers',
    id: hash(`${product.businessId}:${identifier.type}:${identifier.value}`),
    ownerField: 'productId',
    ownerId: product.id,
    data: withoutUndefined({
      businessId: product.businessId,
      productId: product.id,
      variantId: identifier.variantId,
      type: identifier.type,
      value: identifier.value,
      createdAt: product.createdAt,
      updatedAt: now,
    }),
  }));
}

function compatiblePurchaseItem(item: PurchaseNoteItemV2): Record<string, unknown> {
  return withoutUndefined({
    ...item,
    cProd: item.supplierProductCode,
    unit: item.purchaseUnit,
    quantity: item.purchaseQuantity,
    total: item.productTotal,
    icms: item.taxes?.icms,
    ipi: item.taxes?.ipi,
    pis: item.taxes?.pis,
    cofins: item.taxes?.cofins,
    ...(item.action !== 'pending' ? { importAction: item.action } : {}),
  });
}

function compatiblePurchaseNote(note: PurchaseNoteV2): Record<string, unknown> {
  return withoutUndefined({
    ...note,
    supplierName: note.supplier.name,
    supplierCnpj: note.supplier.document,
    supplierId: note.supplier.id,
    items: note.items.map(compatiblePurchaseItem),
    totalProducts: note.totals.products,
    totalTaxes: note.totals.invoice - note.totals.products,
    totalValue: note.totals.invoice,
  });
}

function validationErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string[] {
  return error.issues.slice(0, 20).map((issue) =>
    `${issue.path.map(String).join('.') || 'document'}: ${issue.message}`,
  );
}

export function planM01DocumentMigration(params: {
  entity: M01MigrationEntity;
  documentId: string;
  businessId: string;
  raw: Record<string, unknown>;
  now: string;
}): M01DocumentMigrationPlan {
  const { entity, documentId, businessId, raw, now } = params;
  if (raw.businessId !== businessId) {
    return {
      entity,
      documentId,
      status: 'invalid',
      patch: {},
      claims: [],
      warnings: [],
      errors: ['businessId do documento diverge do tenant da execução'],
    };
  }

  let canonical: Record<string, unknown>;
  let claims: MigrationClaim[] = [];
  if (entity === 'products') {
    const parsed = ProductV2Schema.safeParse({ ...raw, id: documentId, businessId });
    if (!parsed.success) return { entity, documentId, status: 'invalid', patch: {}, claims, warnings: [], errors: validationErrors(parsed.error) };
    canonical = withoutUndefined({
      ...parsed.data,
      skuNormalized: normalizeSku(parsed.data.sku),
      barcodeNormalized: normalizeBarcode(parsed.data.barcode),
    });
    claims = productClaims(parsed.data, now);
    const claimKeys = claims.map((claim) => `${claim.collection}:${claim.id}`);
    if (new Set(claimKeys).size !== claimKeys.length) {
      return {
        entity,
        documentId,
        status: 'invalid',
        patch: {},
        claims: [],
        warnings: [],
        errors: ['produto possui SKU/código de barras duplicado entre produto e variações'],
      };
    }
  } else if (entity === 'suppliers') {
    const parsed = SupplierV2Schema.safeParse({ ...raw, id: documentId, businessId });
    if (!parsed.success) return { entity, documentId, status: 'invalid', patch: {}, claims, warnings: [], errors: validationErrors(parsed.error) };
    canonical = withoutUndefined(parsed.data);
    claims = [{
      collection: 'supplierIdentifiers',
      id: hash(`${businessId}:supplier-document:${parsed.data.document}`),
      ownerField: 'supplierId',
      ownerId: documentId,
      data: {
        businessId,
        supplierId: documentId,
        document: parsed.data.document,
        updatedAt: now,
      },
    }];
  } else if (entity === 'purchaseNotes') {
    const parsed = PurchaseNoteV2Schema.safeParse({ ...raw, id: documentId, businessId });
    if (!parsed.success) return { entity, documentId, status: 'invalid', patch: {}, claims, warnings: [], errors: validationErrors(parsed.error) };
    canonical = compatiblePurchaseNote(parsed.data);
    claims = [{
      collection: 'purchaseNoteIdentifiers',
      id: hash(`${businessId}:purchase-access-key:${parsed.data.accessKey}`),
      ownerField: 'purchaseNoteId',
      ownerId: documentId,
      data: {
        businessId,
        purchaseNoteId: documentId,
        accessKey: parsed.data.accessKey,
        createdAt: parsed.data.createdAt,
      },
    }];
  } else {
    const parsed = StockMovementV2Schema.safeParse({ ...raw, id: documentId, businessId });
    if (!parsed.success) return { entity, documentId, status: 'invalid', patch: {}, claims, warnings: [], errors: validationErrors(parsed.error) };
    canonical = withoutUndefined({
      ...parsed.data,
      correlationId: parsed.data.correlationId ?? parsed.data.idempotencyKey,
    });
  }

  const patch = changedPatch(raw, canonical);
  const warnings = Array.isArray(canonical.migration)
    ? []
    : typeof canonical.migration === 'object' && canonical.migration !== null
      ? Object.values(canonical.migration as Record<string, unknown>)
          .flatMap((value) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])
      : [];
  return {
    entity,
    documentId,
    status: Object.keys(patch).length ? 'update' : 'unchanged',
    patch,
    claims,
    warnings,
    errors: [],
  };
}

function emptyStats(): M01MigrationStats {
  return { scanned: 0, updated: 0, unchanged: 0, invalid: 0, conflicts: 0, claimsCreated: 0, pages: 0 };
}

function emptyResult(runId: string, businessId: string, dryRun: boolean): M01MigrationResult {
  return {
    migrationVersion: M01_MIGRATION_VERSION,
    runId,
    businessId,
    dryRun,
    stats: {
      products: emptyStats(),
      suppliers: emptyStats(),
      purchaseNotes: emptyStats(),
      stockMovements: emptyStats(),
    },
  };
}

async function inspectClaims(db: Firestore, plan: M01DocumentMigrationPlan): Promise<{
  conflicts: string[];
  missing: MigrationClaim[];
}> {
  const snapshots = await Promise.all(plan.claims.map((claim) =>
    db.collection(claim.collection).doc(claim.id).get(),
  ));
  const conflicts: string[] = [];
  const missing: MigrationClaim[] = [];
  snapshots.forEach((snapshot, index) => {
    const claim = plan.claims[index];
    if (!snapshot.exists) missing.push(claim);
    else if (snapshot.data()?.[claim.ownerField] !== claim.ownerId) {
      conflicts.push(`${claim.collection}/${claim.id}`);
    }
  });
  return { conflicts, missing };
}

async function applyDocument(params: {
  db: Firestore;
  businessId: string;
  entity: M01MigrationEntity;
  documentId: string;
  runId: string;
  now: string;
}): Promise<{ outcome: 'updated' | 'unchanged' | 'invalid' | 'conflict'; claimsCreated: number }> {
  const targetRef = params.db.collection(params.entity).doc(params.documentId);
  const backupId = hash(`${params.runId}:${params.entity}:${params.documentId}`);
  const backupRef = params.db.collection('m01MigrationBackups').doc(backupId);

  return params.db.runTransaction(async (tx) => {
    const current = await tx.get(targetRef);
    if (!current.exists) return { outcome: 'unchanged', claimsCreated: 0 };
    const raw = current.data() as Record<string, unknown>;
    const plan = planM01DocumentMigration({ ...params, raw });
    if (plan.status === 'invalid') return { outcome: 'invalid', claimsCreated: 0 };

    const claimSnapshots = await Promise.all(plan.claims.map((claim) =>
      tx.get(params.db.collection(claim.collection).doc(claim.id)),
    ));
    if (claimSnapshots.some((snapshot, index) =>
      snapshot.exists && snapshot.data()?.[plan.claims[index].ownerField] !== plan.claims[index].ownerId)) {
      return { outcome: 'conflict', claimsCreated: 0 };
    }

    let supplierId: string | undefined;
    let supplierClaim: FirebaseFirestore.DocumentSnapshot | undefined;
    if (params.entity === 'purchaseNotes') {
      const supplier = plan.patch.supplier ?? raw.supplier;
      const document = supplier && typeof supplier === 'object'
        ? String((supplier as Record<string, unknown>).document ?? '')
        : '';
      if (document) {
        const ref = params.db.collection('supplierIdentifiers')
          .doc(hash(`${params.businessId}:supplier-document:${document}`));
        supplierClaim = await tx.get(ref);
        if (supplierClaim.exists && supplierClaim.data()?.businessId === params.businessId) {
          supplierId = String(supplierClaim.data()?.supplierId ?? '') || undefined;
        }
      }
    }

    const missingClaims = plan.claims.filter((_, index) => !claimSnapshots[index].exists);
    const patch = { ...plan.patch };
    if (supplierId) {
      const supplier = (patch.supplier ?? raw.supplier) as Record<string, unknown>;
      patch.supplier = { ...supplier, id: supplierId };
      patch.supplierId = supplierId;
    }
    const changed = Object.keys(patch).length > 0 || missingClaims.length > 0;
    const backup = await tx.get(backupRef);
    // Se a execução caiu antes do checkpoint da página, o mesmo documento é
    // reavaliado no resume. O backup determinístico permite contabilizá-lo
    // novamente como atualizado sem repetir qualquer escrita.
    if (!changed) {
      return { outcome: backup.exists ? 'updated' : 'unchanged', claimsCreated: 0 };
    }
    if (!backup.exists) {
      tx.create(backupRef, {
        schemaVersion: 1,
        migrationVersion: M01_MIGRATION_VERSION,
        runId: params.runId,
        businessId: params.businessId,
        targetCollection: params.entity,
        targetId: params.documentId,
        original: raw,
        createdClaims: missingClaims.map((claim) => `${claim.collection}/${claim.id}`),
        rollbackStatus: 'pending',
        createdAt: params.now,
      });
    }
    tx.set(targetRef, {
      ...patch,
      migrationAudit: {
        version: M01_MIGRATION_VERSION,
        runId: params.runId,
        migratedAt: params.now,
      },
    }, { merge: true });
    for (const claim of missingClaims) {
      tx.create(params.db.collection(claim.collection).doc(claim.id), {
        ...claim.data,
        migrationRunId: params.runId,
      });
    }
    return { outcome: 'updated', claimsCreated: missingClaims.length };
  });
}

export async function runM01Migration(params: {
  db: Firestore;
  businessId: string;
  runId: string;
  dryRun: boolean;
  pageSize?: number;
  resume?: boolean;
}): Promise<M01MigrationResult> {
  if (!params.businessId.trim()) throw new Error('businessId é obrigatório.');
  if (!params.runId.trim()) throw new Error('runId é obrigatório.');
  const startedAt = Date.now();
  const pageSize = Math.min(Math.max(params.pageSize ?? 100, 1), 200);
  const result = emptyResult(params.runId, params.businessId, params.dryRun);
  const runRef = params.db.collection('m01MigrationRuns').doc(hash(`${params.businessId}:${params.runId}`));
  let checkpoints: Partial<Record<M01MigrationEntity, string>> = {};

  if (!params.dryRun) {
    const existing = await runRef.get();
    if (existing.exists) {
      if (!params.resume) throw new Error('runId já existe; use --resume para continuar a mesma execução.');
      if (existing.data()?.businessId !== params.businessId) throw new Error('runId pertence a outro tenant.');
      checkpoints = existing.data()?.checkpoints ?? {};
      const previousStats = existing.data()?.stats as Record<M01MigrationEntity, M01MigrationStats> | undefined;
      if (previousStats) {
        for (const entity of M01_MIGRATION_ENTITIES) {
          if (previousStats[entity]) result.stats[entity] = previousStats[entity];
        }
      }
    }
    await runRef.set({
      schemaVersion: 1,
      migrationVersion: M01_MIGRATION_VERSION,
      runId: params.runId,
      businessId: params.businessId,
      mode: 'apply',
      status: 'running',
      checkpoints,
      startedAt: existing.data()?.startedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  for (const entity of M01_MIGRATION_ENTITIES) {
    let cursor = params.resume ? checkpoints[entity] ?? null : null;
    while (true) {
      let query: FirebaseFirestore.Query = params.db.collection(entity)
        .where('businessId', '==', params.businessId)
        .orderBy('__name__')
        .limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      result.stats[entity].pages++;

      for (const document of snapshot.docs) {
        result.stats[entity].scanned++;
        const now = new Date().toISOString();
        const plan = planM01DocumentMigration({
          entity,
          documentId: document.id,
          businessId: params.businessId,
          raw: document.data(),
          now,
        });
        if (plan.status === 'invalid') {
          result.stats[entity].invalid++;
          writeStructuredOperationLog('warn', {
            event: 'm01.migration.document_invalid',
            businessId: params.businessId,
            correlationId: params.runId,
            operationId: params.runId,
            status: entity,
            details: { documentId: document.id, errors: plan.errors },
          });
          continue;
        }

        if (params.dryRun) {
          const claims = await inspectClaims(params.db, plan);
          if (claims.conflicts.length) result.stats[entity].conflicts++;
          else if (plan.status === 'update' || claims.missing.length) {
            result.stats[entity].updated++;
            result.stats[entity].claimsCreated += claims.missing.length;
          } else result.stats[entity].unchanged++;
        } else {
          const applied = await applyDocument({
            db: params.db,
            businessId: params.businessId,
            entity,
            documentId: document.id,
            runId: params.runId,
            now,
          });
          if (applied.outcome === 'conflict') result.stats[entity].conflicts++;
          else result.stats[entity][applied.outcome]++;
          result.stats[entity].claimsCreated += applied.claimsCreated;
        }
      }

      cursor = snapshot.docs.at(-1)?.id ?? null;
      if (!params.dryRun && cursor) {
        checkpoints[entity] = cursor;
        await runRef.set({
          checkpoints,
          stats: result.stats,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }
      writeStructuredOperationLog('info', {
        event: 'm01.migration.page_completed',
        businessId: params.businessId,
        correlationId: params.runId,
        operationId: params.runId,
        status: params.dryRun ? 'dry_run' : 'apply',
        details: { entity, cursor, stats: result.stats[entity] },
      });
      if (snapshot.docs.length < pageSize) break;
    }
  }

  if (!params.dryRun) {
    await runRef.set({
      status: 'completed',
      stats: result.stats,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }
  writeStructuredOperationLog('info', {
    event: 'm01.migration.completed',
    businessId: params.businessId,
    correlationId: params.runId,
    operationId: params.runId,
    status: params.dryRun ? 'dry_run' : 'applied',
    durationMs: Date.now() - startedAt,
    details: { stats: result.stats },
  });
  return result;
}

export async function rollbackM01Migration(params: {
  db: Firestore;
  businessId: string;
  runId: string;
  pageSize?: number;
}): Promise<{ restored: number; conflicts: number }> {
  const pageSize = Math.min(Math.max(params.pageSize ?? 100, 1), 200);
  let restored = 0;
  let conflicts = 0;
  while (true) {
    const snapshot = await params.db.collection('m01MigrationBackups')
      .where('businessId', '==', params.businessId)
      .where('runId', '==', params.runId)
      .where('rollbackStatus', '==', 'pending')
      .limit(pageSize)
      .get();
    if (snapshot.empty) break;
    for (const backupDocument of snapshot.docs) {
      const restoredDocument = await params.db.runTransaction(async (tx) => {
        const backup = (await tx.get(backupDocument.ref)).data() as Record<string, unknown>;
        const targetCollection = String(backup.targetCollection ?? '');
        const targetId = String(backup.targetId ?? '');
        const targetRef = params.db.collection(targetCollection).doc(targetId);
        const current = await tx.get(targetRef);
        const audit = current.data()?.migrationAudit as Record<string, unknown> | undefined;
        if (!current.exists || audit?.runId !== params.runId) return false;
        const claimRefs = ((backup.createdClaims as string[] | undefined) ?? []).map((path) => {
          const [collection, id] = path.split('/');
          return params.db.collection(collection).doc(id);
        });
        const claims = await Promise.all(claimRefs.map((ref) => tx.get(ref)));
        tx.set(targetRef, backup.original as Record<string, unknown>);
        claims.forEach((claim, index) => {
          if (claim.exists && claim.data()?.migrationRunId === params.runId) tx.delete(claimRefs[index]);
        });
        tx.update(backupDocument.ref, {
          rollbackStatus: 'restored',
          rolledBackAt: new Date().toISOString(),
        });
        return true;
      });
      if (restoredDocument) restored++;
      else {
        conflicts++;
        await backupDocument.ref.set({
          rollbackStatus: 'conflict',
          rollbackConflictAt: new Date().toISOString(),
        }, { merge: true });
      }
    }
  }
  return { restored, conflicts };
}
