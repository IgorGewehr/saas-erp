/**
 * Snapshot e comparação read-only para o aceite da paridade M01.
 *
 * A coleta é feita por um único businessId e guarda apenas os valores necessários
 * para provar que migração/deploy não alteraram saldo nem custo. A comparação é
 * determinística e cobre produto simples, variações e lotes.
 */

export const M01_HOMOLOGATION_SNAPSHOT_VERSION = 1 as const;

export interface M01AuditDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface M01BalanceSnapshotEntry {
  key: string;
  entity: 'product' | 'variant' | 'lot';
  productId: string;
  variantId?: string;
  lotId?: string;
  stock: number;
  unitCost: number;
}

export interface M01AuditIssue {
  code: 'TENANT_MISMATCH' | 'INVALID_NUMBER' | 'ORPHAN_LOT' | 'LOT_BALANCE_MISMATCH';
  entityId: string;
  message: string;
}

export interface M01HomologationSnapshot {
  schemaVersion: typeof M01_HOMOLOGATION_SNAPSHOT_VERSION;
  businessId: string;
  capturedAt: string;
  entries: M01BalanceSnapshotEntry[];
  issues: M01AuditIssue[];
  summary: {
    products: number;
    variants: number;
    lots: number;
    issues: number;
  };
}

export interface M01SnapshotDifference {
  key: string;
  entity: M01BalanceSnapshotEntry['entity'];
  productId: string;
  variantId?: string;
  lotId?: string;
  status: 'changed' | 'added' | 'removed';
  beforeStock?: number;
  afterStock?: number;
  stockDelta?: number;
  beforeUnitCost?: number;
  afterUnitCost?: number;
  unitCostDelta?: number;
}

export interface M01SnapshotComparison {
  businessId: string;
  beforeCapturedAt: string;
  afterCapturedAt: string;
  preserved: boolean;
  comparedEntries: number;
  unchangedEntries: number;
  differences: M01SnapshotDifference[];
  beforeIssues: M01AuditIssue[];
  afterIssues: M01AuditIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(
  value: unknown,
  fallback: number,
  issues: M01AuditIssue[],
  entityId: string,
  field: string,
): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? fallback);
  if (Number.isFinite(parsed)) return parsed;
  issues.push({
    code: 'INVALID_NUMBER',
    entityId,
    message: `${field} não contém um número finito.`,
  });
  return fallback;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function targetKey(productId: string, variantId?: string): string {
  return variantId ? `variant:${productId}:${variantId}` : `product:${productId}`;
}

function lotKey(lotId: string): string {
  return `lot:${lotId}`;
}

export function buildM01HomologationSnapshot(params: {
  businessId: string;
  capturedAt?: string;
  products: M01AuditDocument[];
  stockLots: M01AuditDocument[];
}): M01HomologationSnapshot {
  const businessId = params.businessId.trim();
  if (!businessId) throw new Error('businessId é obrigatório para a auditoria M01.');
  const capturedAt = params.capturedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(capturedAt))) throw new Error('capturedAt inválido.');

  const entries: M01BalanceSnapshotEntry[] = [];
  const issues: M01AuditIssue[] = [];
  const productTargets = new Map<string, { trackLots: boolean; stock: number }>();
  let productCount = 0;
  let variantCount = 0;

  for (const document of [...params.products].sort((left, right) => left.id.localeCompare(right.id))) {
    const documentBusinessId = String(document.data.businessId ?? '');
    if (documentBusinessId !== businessId) {
      issues.push({
        code: 'TENANT_MISMATCH',
        entityId: document.id,
        message: `Produto retornado para ${businessId} pertence a ${documentBusinessId || '(vazio)'}.`,
      });
      continue;
    }
    productCount += 1;
    const stock = finiteNumber(document.data.currentStock, 0, issues, document.id, 'currentStock');
    const unitCost = finiteNumber(document.data.costPrice, 0, issues, document.id, 'costPrice');
    const key = targetKey(document.id);
    entries.push({ key, entity: 'product', productId: document.id, stock, unitCost });
    productTargets.set(key, { trackLots: document.data.trackLots === true, stock });

    const variants = Array.isArray(document.data.variants) ? document.data.variants : [];
    for (const rawVariant of variants) {
      if (!isRecord(rawVariant) || typeof rawVariant.id !== 'string' || !rawVariant.id.trim()) continue;
      variantCount += 1;
      const variantId = rawVariant.id;
      const variantEntityId = `${document.id}/${variantId}`;
      const variantStock = finiteNumber(rawVariant.currentStock, 0, issues, variantEntityId, 'currentStock');
      const variantCost = finiteNumber(rawVariant.costPrice, unitCost, issues, variantEntityId, 'costPrice');
      const variantKey = targetKey(document.id, variantId);
      entries.push({
        key: variantKey,
        entity: 'variant',
        productId: document.id,
        variantId,
        stock: variantStock,
        unitCost: variantCost,
      });
      productTargets.set(variantKey, { trackLots: document.data.trackLots === true, stock: variantStock });
    }
  }

  const lotTotals = new Map<string, number>();
  let lotCount = 0;
  for (const document of [...params.stockLots].sort((left, right) => left.id.localeCompare(right.id))) {
    const documentBusinessId = String(document.data.businessId ?? '');
    if (documentBusinessId !== businessId) {
      issues.push({
        code: 'TENANT_MISMATCH',
        entityId: document.id,
        message: `Lote retornado para ${businessId} pertence a ${documentBusinessId || '(vazio)'}.`,
      });
      continue;
    }
    const productId = String(document.data.productId ?? '').trim();
    const variantId = typeof document.data.variantId === 'string' && document.data.variantId.trim()
      ? document.data.variantId.trim()
      : undefined;
    const ownerKey = targetKey(productId, variantId);
    if (!productTargets.has(ownerKey)) {
      issues.push({
        code: 'ORPHAN_LOT',
        entityId: document.id,
        message: `Lote referencia alvo inexistente no tenant: ${ownerKey}.`,
      });
    }
    lotCount += 1;
    const stock = finiteNumber(document.data.currentQuantity, 0, issues, document.id, 'currentQuantity');
    const unitCost = finiteNumber(document.data.unitCost, 0, issues, document.id, 'unitCost');
    entries.push({
      key: lotKey(document.id),
      entity: 'lot',
      productId,
      ...(variantId ? { variantId } : {}),
      lotId: document.id,
      stock,
      unitCost,
    });
    lotTotals.set(ownerKey, round((lotTotals.get(ownerKey) ?? 0) + stock));
  }

  for (const [key, target] of productTargets) {
    if (!target.trackLots) continue;
    const lotStock = lotTotals.get(key) ?? 0;
    if (Math.abs(lotStock - target.stock) > 1e-6) {
      issues.push({
        code: 'LOT_BALANCE_MISMATCH',
        entityId: key,
        message: `Saldo do produto/variação (${target.stock}) diverge da soma dos lotes (${lotStock}).`,
      });
    }
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));
  return {
    schemaVersion: M01_HOMOLOGATION_SNAPSHOT_VERSION,
    businessId,
    capturedAt,
    entries,
    issues,
    summary: { products: productCount, variants: variantCount, lots: lotCount, issues: issues.length },
  };
}

function assertSnapshot(value: M01HomologationSnapshot, label: string): void {
  if (value.schemaVersion !== M01_HOMOLOGATION_SNAPSHOT_VERSION) {
    throw new Error(`${label}: versão de snapshot M01 incompatível.`);
  }
  if (!value.businessId?.trim()) throw new Error(`${label}: businessId ausente.`);
  if (!Array.isArray(value.entries) || !Array.isArray(value.issues)) {
    throw new Error(`${label}: snapshot M01 inválido.`);
  }
}

export function compareM01HomologationSnapshots(
  before: M01HomologationSnapshot,
  after: M01HomologationSnapshot,
): M01SnapshotComparison {
  assertSnapshot(before, 'baseline');
  assertSnapshot(after, 'atual');
  if (before.businessId !== after.businessId) {
    throw new Error('Snapshots de businessId diferentes não podem ser comparados.');
  }

  const beforeEntries = new Map(before.entries.map((entry) => [entry.key, entry]));
  const afterEntries = new Map(after.entries.map((entry) => [entry.key, entry]));
  const keys = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort();
  const differences: M01SnapshotDifference[] = [];
  let unchangedEntries = 0;

  for (const key of keys) {
    const previous = beforeEntries.get(key);
    const current = afterEntries.get(key);
    const source = current ?? previous!;
    if (!previous || !current) {
      differences.push({
        key,
        entity: source.entity,
        productId: source.productId,
        ...(source.variantId ? { variantId: source.variantId } : {}),
        ...(source.lotId ? { lotId: source.lotId } : {}),
        status: previous ? 'removed' : 'added',
        ...(previous ? { beforeStock: previous.stock, beforeUnitCost: previous.unitCost } : {}),
        ...(current ? { afterStock: current.stock, afterUnitCost: current.unitCost } : {}),
      });
      continue;
    }
    const stockDelta = round(current.stock - previous.stock);
    const unitCostDelta = round(current.unitCost - previous.unitCost);
    if (Math.abs(stockDelta) <= 1e-6 && Math.abs(unitCostDelta) <= 1e-6) {
      unchangedEntries += 1;
      continue;
    }
    differences.push({
      key,
      entity: current.entity,
      productId: current.productId,
      ...(current.variantId ? { variantId: current.variantId } : {}),
      ...(current.lotId ? { lotId: current.lotId } : {}),
      status: 'changed',
      beforeStock: previous.stock,
      afterStock: current.stock,
      stockDelta,
      beforeUnitCost: previous.unitCost,
      afterUnitCost: current.unitCost,
      unitCostDelta,
    });
  }

  return {
    businessId: before.businessId,
    beforeCapturedAt: before.capturedAt,
    afterCapturedAt: after.capturedAt,
    preserved: differences.length === 0 && before.issues.length === 0 && after.issues.length === 0,
    comparedEntries: keys.length,
    unchangedEntries,
    differences,
    beforeIssues: before.issues,
    afterIssues: after.issues,
  };
}
