/**
 * Snapshot e comparação read-only do baseline comercial M02.
 *
 * O coletor consulta sempre um único businessId. Esta camada é pura: recebe os
 * documentos já lidos, relaciona os efeitos e denuncia referências ausentes,
 * efeitos órfãos, divergência de pagamentos e vazamento entre tenants.
 */

export const M02_COMMERCIAL_SNAPSHOT_VERSION = 1 as const;

export type M02CommercialSourceType = 'sale' | 'deliveryOrder' | 'order';

export interface M02AuditDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface M02CommercialAuditInput {
  businessId: string;
  capturedAt?: string;
  sales: M02AuditDocument[];
  deliveryOrders: M02AuditDocument[];
  orders: M02AuditDocument[];
  transactions: M02AuditDocument[];
  stockMovements: M02AuditDocument[];
  couponRedemptions: M02AuditDocument[];
  giftCardRedemptions: M02AuditDocument[];
  loyaltyTransactions: M02AuditDocument[];
  fiscalDocuments: M02AuditDocument[];
}

export interface M02EffectReferences {
  transactions: string[];
  stockMovements: string[];
  couponRedemptions: string[];
  giftCardRedemptions: string[];
  loyaltyTransactions: string[];
  fiscalDocuments: string[];
}

export interface M02CommercialSnapshotEntry {
  key: string;
  sourceType: M02CommercialSourceType;
  sourceId: string;
  status: string;
  total: number;
  paymentTotal?: number;
  effects: M02EffectReferences;
}

export type M02AuditIssueCode =
  | 'TENANT_MISMATCH'
  | 'INVALID_NUMBER'
  | 'PAYMENT_TOTAL_MISMATCH'
  | 'MISSING_FINANCIAL_REFERENCE'
  | 'MISSING_STOCK_REFERENCE'
  | 'MISSING_FISCAL_REFERENCE'
  | 'ORPHAN_EFFECT';

export interface M02CommercialAuditIssue {
  code: M02AuditIssueCode;
  entityKey: string;
  message: string;
}

export interface M02CommercialSnapshot {
  schemaVersion: typeof M02_COMMERCIAL_SNAPSHOT_VERSION;
  businessId: string;
  capturedAt: string;
  entries: M02CommercialSnapshotEntry[];
  issues: M02CommercialAuditIssue[];
  summary: {
    sales: number;
    deliveryOrders: number;
    orders: number;
    grossTotal: number;
    effects: Record<keyof M02EffectReferences, number>;
    issues: number;
  };
}

export interface M02CommercialSnapshotDifference {
  key: string;
  status: 'changed' | 'added' | 'removed';
  before?: M02CommercialSnapshotEntry;
  after?: M02CommercialSnapshotEntry;
}

export interface M02CommercialSnapshotComparison {
  businessId: string;
  beforeCapturedAt: string;
  afterCapturedAt: string;
  preserved: boolean;
  healthy: boolean;
  comparedEntries: number;
  unchangedEntries: number;
  differences: M02CommercialSnapshotDifference[];
  newIssues: M02CommercialAuditIssue[];
  resolvedIssues: M02CommercialAuditIssue[];
  currentIssues: M02CommercialAuditIssue[];
}

const EFFECT_COLLECTIONS = [
  'transactions',
  'stockMovements',
  'couponRedemptions',
  'giftCardRedemptions',
  'loyaltyTransactions',
  'fiscalDocuments',
] as const satisfies ReadonlyArray<keyof M02EffectReferences>;

function sourceKey(type: M02CommercialSourceType, id: string): string {
  return `${type}:${id}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function issueKey(issue: M02CommercialAuditIssue): string {
  return `${issue.code}:${issue.entityKey}:${issue.message}`;
}

function emptyEffects(): M02EffectReferences {
  return {
    transactions: [],
    stockMovements: [],
    couponRedemptions: [],
    giftCardRedemptions: [],
    loyaltyTransactions: [],
    fiscalDocuments: [],
  };
}

function pushEffect(
  buckets: Map<string, M02EffectReferences>,
  key: string,
  collection: keyof M02EffectReferences,
  id: string,
): void {
  const effects = buckets.get(key) ?? emptyEffects();
  effects[collection].push(id);
  buckets.set(key, effects);
}

function readOwnedDocuments(
  collectionName: string,
  documents: M02AuditDocument[],
  businessId: string,
  issues: M02CommercialAuditIssue[],
): M02AuditDocument[] {
  const owned: M02AuditDocument[] = [];
  for (const document of documents) {
    const documentBusinessId = String(document.data.businessId ?? '');
    if (documentBusinessId !== businessId) {
      issues.push({
        code: 'TENANT_MISMATCH',
        entityKey: `${collectionName}:${document.id}`,
        message: `Documento retornado para ${businessId} pertence a ${documentBusinessId || '(vazio)'}.`,
      });
      continue;
    }
    owned.push(document);
  }
  return owned.sort((left, right) => left.id.localeCompare(right.id));
}

function finiteNumber(
  value: unknown,
  entityKey: string,
  field: string,
  issues: M02CommercialAuditIssue[],
): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  if (Number.isFinite(parsed)) return round2(parsed);
  issues.push({
    code: 'INVALID_NUMBER',
    entityKey,
    message: `${field} não contém um número finito.`,
  });
  return 0;
}

function resolveOrderSourceKey(
  orderId: string,
  sourceKeys: ReadonlySet<string>,
): string | undefined {
  const deliveryKey = sourceKey('deliveryOrder', orderId);
  if (sourceKeys.has(deliveryKey)) return deliveryKey;
  const b2bKey = sourceKey('order', orderId);
  if (sourceKeys.has(b2bKey)) return b2bKey;
  return undefined;
}

function resolveEffectSourceKey(
  document: M02AuditDocument,
  collection: keyof M02EffectReferences,
  sourceKeys: ReadonlySet<string>,
): string | undefined {
  const saleId = stringValue(document.data.saleId);
  if (saleId) return sourceKey('sale', saleId);
  const deliveryOrderId = stringValue(document.data.deliveryOrderId);
  if (deliveryOrderId) return sourceKey('deliveryOrder', deliveryOrderId);
  const orderId = stringValue(document.data.orderId);
  if (orderId) return resolveOrderSourceKey(orderId, sourceKeys) ?? sourceKey('deliveryOrder', orderId);

  const genericSourceId = stringValue(document.data.sourceId);
  const genericSourceType = stringValue(document.data.sourceType);
  if (genericSourceId && genericSourceType === 'sale') return sourceKey('sale', genericSourceId);
  if (genericSourceId && (genericSourceType === 'order' || genericSourceType === 'deliveryOrder')) {
    return resolveOrderSourceKey(genericSourceId, sourceKeys) ?? sourceKey('deliveryOrder', genericSourceId);
  }

  if (collection === 'fiscalDocuments') {
    const originId = stringValue(document.data.originId);
    const originType = stringValue(document.data.originType);
    if (originId && originType === 'sale') return sourceKey('sale', originId);
    if (originId && (originType === 'order' || originType === 'deliveryOrder')) {
      return resolveOrderSourceKey(originId, sourceKeys);
    }
  }
  return undefined;
}

function addDeclaredReference(
  effects: M02EffectReferences,
  collection: keyof M02EffectReferences,
  value: unknown,
): void {
  const id = stringValue(value);
  if (id) effects[collection].push(id);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function normalizeEffects(effects: M02EffectReferences): M02EffectReferences {
  return {
    transactions: uniqueSorted(effects.transactions),
    stockMovements: uniqueSorted(effects.stockMovements),
    couponRedemptions: uniqueSorted(effects.couponRedemptions),
    giftCardRedemptions: uniqueSorted(effects.giftCardRedemptions),
    loyaltyTransactions: uniqueSorted(effects.loyaltyTransactions),
    fiscalDocuments: uniqueSorted(effects.fiscalDocuments),
  };
}

export function buildM02CommercialSnapshot(input: M02CommercialAuditInput): M02CommercialSnapshot {
  const businessId = input.businessId.trim();
  if (!businessId) throw new Error('businessId é obrigatório para a auditoria M02.');
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(capturedAt))) throw new Error('capturedAt inválido.');

  const issues: M02CommercialAuditIssue[] = [];
  const sales = readOwnedDocuments('sales', input.sales, businessId, issues);
  const deliveryOrders = readOwnedDocuments('deliveryOrders', input.deliveryOrders, businessId, issues);
  const orders = readOwnedDocuments('orders', input.orders, businessId, issues);
  const sources = [
    ...sales.map((document) => ({ type: 'sale' as const, document })),
    ...deliveryOrders.map((document) => ({ type: 'deliveryOrder' as const, document })),
    ...orders.map((document) => ({ type: 'order' as const, document })),
  ];
  const sourceKeys = new Set(sources.map(({ type, document }) => sourceKey(type, document.id)));

  const effectDocuments = {
    transactions: readOwnedDocuments('transactions', input.transactions, businessId, issues),
    stockMovements: readOwnedDocuments('stockMovements', input.stockMovements, businessId, issues),
    couponRedemptions: readOwnedDocuments('couponRedemptions', input.couponRedemptions, businessId, issues),
    giftCardRedemptions: readOwnedDocuments('giftCardRedemptions', input.giftCardRedemptions, businessId, issues),
    loyaltyTransactions: readOwnedDocuments('loyaltyTransactions', input.loyaltyTransactions, businessId, issues),
    fiscalDocuments: readOwnedDocuments('fiscalDocuments', input.fiscalDocuments, businessId, issues),
  } satisfies Record<keyof M02EffectReferences, M02AuditDocument[]>;
  const effectIds = Object.fromEntries(
    EFFECT_COLLECTIONS.map((collection) => [
      collection,
      new Set(effectDocuments[collection].map((document) => document.id)),
    ]),
  ) as Record<keyof M02EffectReferences, Set<string>>;

  const discoveredEffects = new Map<string, M02EffectReferences>();
  for (const collection of EFFECT_COLLECTIONS) {
    for (const document of effectDocuments[collection]) {
      const key = resolveEffectSourceKey(document, collection, sourceKeys);
      // O tenant também possui despesas, compras, ajustes e fidelidade de
      // agendamento. Sem referência comercial explícita, o documento está fora
      // do escopo desta auditoria e não é órfão.
      if (!key) continue;
      if (!sourceKeys.has(key)) {
        issues.push({
          code: 'ORPHAN_EFFECT',
          entityKey: `${collection}:${document.id}`,
          message: 'Efeito comercial não referencia uma venda ou pedido existente no tenant.',
        });
        continue;
      }
      pushEffect(discoveredEffects, key, collection, document.id);
    }
  }

  const entries: M02CommercialSnapshotEntry[] = [];
  for (const { type, document } of sources) {
    const key = sourceKey(type, document.id);
    const effects = discoveredEffects.get(key) ?? emptyEffects();
    addDeclaredReference(effects, 'transactions', document.data.transactionId);
    addDeclaredReference(effects, 'transactions', document.data.commissionTransactionId);
    addDeclaredReference(effects, 'fiscalDocuments', document.data.fiscalDocId);
    if (Array.isArray(document.data.stockMovementIds)) {
      for (const movementId of document.data.stockMovementIds) {
        addDeclaredReference(effects, 'stockMovements', movementId);
      }
    }
    const normalizedEffects = normalizeEffects(effects);

    for (const collection of EFFECT_COLLECTIONS) {
      for (const id of normalizedEffects[collection]) {
        if (!effectIds[collection].has(id)) {
          const code = collection === 'transactions'
            ? 'MISSING_FINANCIAL_REFERENCE'
            : collection === 'stockMovements'
              ? 'MISSING_STOCK_REFERENCE'
              : collection === 'fiscalDocuments'
                ? 'MISSING_FISCAL_REFERENCE'
                : 'ORPHAN_EFFECT';
          issues.push({
            code,
            entityKey: key,
            message: `Referência ${collection}/${id} não foi encontrada no tenant.`,
          });
        }
      }
    }

    const status = String(document.data.status ?? '');
    const total = finiteNumber(document.data.total, key, 'total', issues);
    let paymentTotal: number | undefined;
    if (type === 'sale' && Array.isArray(document.data.payments)) {
      paymentTotal = round2(document.data.payments.reduce((sum: number, raw: unknown) => {
        if (!raw || typeof raw !== 'object') return sum;
        const amount = Number((raw as Record<string, unknown>).amount ?? 0);
        return sum + (Number.isFinite(amount) ? amount : 0);
      }, 0));
      if (status === 'finalizada' && Math.abs(paymentTotal - total) > 0.011) {
        issues.push({
          code: 'PAYMENT_TOTAL_MISMATCH',
          entityKey: key,
          message: `Pagamentos (${paymentTotal}) divergem do total finalizado (${total}).`,
        });
      }
    }

    if (type === 'sale' && status === 'finalizada') {
      const transactionId = stringValue(document.data.transactionId);
      if (!transactionId) {
        issues.push({
          code: 'MISSING_FINANCIAL_REFERENCE',
          entityKey: key,
          message: 'Venda finalizada sem transação de receita válida em transactionId.',
        });
      }
    }
    if (type === 'deliveryOrder' && status === 'entregue') {
      const transactionId = stringValue(document.data.transactionId);
      if (!transactionId) {
        issues.push({
          code: 'MISSING_FINANCIAL_REFERENCE',
          entityKey: key,
          message: 'Pedido entregue sem transação de receita válida em transactionId.',
        });
      }
    }
    if (
      type === 'deliveryOrder'
      && stringValue(document.data.stockDeductedAt)
      && normalizedEffects.stockMovements.length === 0
    ) {
      issues.push({
        code: 'MISSING_STOCK_REFERENCE',
        entityKey: key,
        message: 'Pedido marcado com estoque deduzido sem movimento de estoque relacionado.',
      });
    }

    entries.push({
      key,
      sourceType: type,
      sourceId: document.id,
      status,
      total,
      ...(paymentTotal !== undefined ? { paymentTotal } : {}),
      effects: normalizedEffects,
    });
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));
  issues.sort((left, right) => issueKey(left).localeCompare(issueKey(right)));
  const effects = Object.fromEntries(EFFECT_COLLECTIONS.map((collection) => [
    collection,
    new Set(entries.flatMap((entry) => entry.effects[collection])).size,
  ])) as Record<keyof M02EffectReferences, number>;

  return {
    schemaVersion: M02_COMMERCIAL_SNAPSHOT_VERSION,
    businessId,
    capturedAt,
    entries,
    issues,
    summary: {
      sales: sales.length,
      deliveryOrders: deliveryOrders.length,
      orders: orders.length,
      grossTotal: round2(entries.reduce((sum, entry) => sum + entry.total, 0)),
      effects,
      issues: issues.length,
    },
  };
}

function assertSnapshot(snapshot: M02CommercialSnapshot, label: string): void {
  if (snapshot.schemaVersion !== M02_COMMERCIAL_SNAPSHOT_VERSION) {
    throw new Error(`${label}: versão de snapshot M02 incompatível.`);
  }
  if (!snapshot.businessId?.trim() || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.issues)) {
    throw new Error(`${label}: snapshot M02 inválido.`);
  }
}

export function compareM02CommercialSnapshots(
  before: M02CommercialSnapshot,
  after: M02CommercialSnapshot,
): M02CommercialSnapshotComparison {
  assertSnapshot(before, 'baseline');
  assertSnapshot(after, 'atual');
  if (before.businessId !== after.businessId) {
    throw new Error('Snapshots M02 de businessId diferentes não podem ser comparados.');
  }

  const beforeEntries = new Map(before.entries.map((entry) => [entry.key, entry]));
  const afterEntries = new Map(after.entries.map((entry) => [entry.key, entry]));
  const keys = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort();
  const differences: M02CommercialSnapshotDifference[] = [];
  let unchangedEntries = 0;
  for (const key of keys) {
    const previous = beforeEntries.get(key);
    const current = afterEntries.get(key);
    if (!previous || !current) {
      differences.push({
        key,
        status: previous ? 'removed' : 'added',
        ...(previous ? { before: previous } : {}),
        ...(current ? { after: current } : {}),
      });
      continue;
    }
    if (stable(previous) !== stable(current)) {
      differences.push({ key, status: 'changed', before: previous, after: current });
    } else {
      unchangedEntries += 1;
    }
  }

  const beforeIssueKeys = new Set(before.issues.map(issueKey));
  const afterIssueKeys = new Set(after.issues.map(issueKey));
  const newIssues = after.issues.filter((issue) => !beforeIssueKeys.has(issueKey(issue)));
  const resolvedIssues = before.issues.filter((issue) => !afterIssueKeys.has(issueKey(issue)));

  return {
    businessId: before.businessId,
    beforeCapturedAt: before.capturedAt,
    afterCapturedAt: after.capturedAt,
    preserved: differences.length === 0 && newIssues.length === 0,
    healthy: after.issues.length === 0,
    comparedEntries: keys.length,
    unchangedEntries,
    differences,
    newIssues,
    resolvedIssues,
    currentIssues: after.issues,
  };
}
