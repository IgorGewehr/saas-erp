/**
 * Snapshot e comparação read-only do baseline do Financeiro (M03.0).
 *
 * Mesma forma das auditorias M02/M06 (`m02-commercial-audit.ts`/`m06-agenda-audit.ts`):
 * esta camada é PURA — recebe documentos já lidos, relaciona referências e denuncia
 * problemas. Quem lê do Firestore é `scripts/audit-m03-financial.ts`, sempre por UM
 * businessId.
 *
 * O objetivo é MEDIR o estrago real antes do hardening planejado em
 * `docs/paridade/M03_PLANO_IMPLEMENTACAO.md`. Cada código de problema corresponde a
 * uma lacuna concreta do diagnóstico de abertura do M03:
 *
 *  - INVALID_TYPE/INVALID_STATUS   → `firestore.rules` só valida enum na ESCRITA; um
 *                                    doc criado antes de uma regra existir, ou via
 *                                    Admin SDK sem passar pelas rules, pode ter
 *                                    escapado. Mede se isso já aconteceu.
 *  - NON_POSITIVE_AMOUNT           → nenhuma camada (rules, FSM, os 13 caminhos de
 *                                    escrita) valida `amount > 0` hoje.
 *  - INSTALLMENT_COUNT_MISMATCH    → parcelas são documentos irmãos ligados só por
 *                                    `installmentGroupId`/`installmentTotal`, sem
 *                                    nenhuma transação atômica garantindo que todas
 *                                    foram criadas.
 *  - ORPHAN_RECURRENCE             → `recurrenceId` aponta pro documento "cabeça" da
 *                                    série (que carrega o objeto `recurrence`); mede
 *                                    quantas ocorrências apontam pra uma cabeça que
 *                                    não existe mais.
 *  - BROKEN_SOURCE_REFERENCE       → `saleId`/`purchaseNoteId`/`appointmentId`/
 *                                    `deliveryOrderId` apontando pra um documento de
 *                                    origem que não existe (mesma classe de problema
 *                                    já medida em M06 pro lado da Agenda).
 *  - DUPLICATE_SOURCE_TRANSACTION  → double-click já auto-documentado em
 *                                    `docs/agenda/AGENDA_COBRANCA.md`: duas
 *                                    transações ativas com a MESMA origem+tipo.
 */

export const M03_FINANCIAL_SNAPSHOT_VERSION = 1 as const;

export interface M03AuditDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface M03FinancialAuditInput {
  businessId: string;
  capturedAt?: string;
  transactions: M03AuditDocument[];
  /** Usados só para validar referência de origem (existe/não existe). */
  sales: M03AuditDocument[];
  purchaseNotes: M03AuditDocument[];
  appointments: M03AuditDocument[];
  deliveryOrders: M03AuditDocument[];
}

export type M03AuditIssueCode =
  | 'TENANT_MISMATCH'
  | 'INVALID_TYPE'
  | 'INVALID_STATUS'
  | 'NON_POSITIVE_AMOUNT'
  | 'INSTALLMENT_COUNT_MISMATCH'
  | 'ORPHAN_RECURRENCE'
  | 'BROKEN_SOURCE_REFERENCE'
  | 'DUPLICATE_SOURCE_TRANSACTION';

export interface M03FinancialAuditIssue {
  code: M03AuditIssueCode;
  entityKey: string;
  message: string;
}

export interface M03FinancialSourceRefs {
  saleId?: string;
  purchaseNoteId?: string;
  appointmentId?: string;
  deliveryOrderId?: string;
}

export interface M03FinancialSnapshotEntry {
  key: string;
  transactionId: string;
  type: string;
  status: string;
  amount: number;
  installmentGroupId?: string;
  installmentTotal?: number;
  recurrenceId?: string;
  sourceRefs: M03FinancialSourceRefs;
}

export interface M03FinancialSnapshot {
  schemaVersion: typeof M03_FINANCIAL_SNAPSHOT_VERSION;
  businessId: string;
  capturedAt: string;
  entries: M03FinancialSnapshotEntry[];
  issues: M03FinancialAuditIssue[];
  summary: {
    transactions: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    invalidType: number;
    invalidStatus: number;
    nonPositiveAmount: number;
    installmentMismatches: number;
    orphanRecurrences: number;
    brokenReferences: number;
    duplicateSourceTransactions: number;
    issues: number;
  };
}

export interface M03FinancialSnapshotDifference {
  key: string;
  status: 'changed' | 'added' | 'removed';
  before?: M03FinancialSnapshotEntry;
  after?: M03FinancialSnapshotEntry;
}

export interface M03FinancialSnapshotComparison {
  businessId: string;
  beforeCapturedAt: string;
  afterCapturedAt: string;
  preserved: boolean;
  healthy: boolean;
  comparedEntries: number;
  unchangedEntries: number;
  differences: M03FinancialSnapshotDifference[];
  newIssues: M03FinancialAuditIssue[];
  resolvedIssues: M03FinancialAuditIssue[];
  currentIssues: M03FinancialAuditIssue[];
}

const VALID_TYPES = new Set(['receita', 'despesa']);
const VALID_STATUSES = new Set(['pendente', 'pago', 'atrasado', 'cancelado']);
/** Só uma transação cancelada libera o "slot" de origem — mesma convenção da Agenda. */
const CANCELLED_STATUS = 'cancelado';

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

function issueKey(issue: M03FinancialAuditIssue): string {
  return `${issue.code}:${issue.entityKey}:${issue.message}`;
}

function readOwnedDocuments(
  collectionName: string,
  documents: M03AuditDocument[],
  businessId: string,
  issues: M03FinancialAuditIssue[],
): M03AuditDocument[] {
  const owned: M03AuditDocument[] = [];
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

export function buildM03FinancialSnapshot(input: M03FinancialAuditInput): M03FinancialSnapshot {
  const businessId = input.businessId.trim();
  if (!businessId) throw new Error('businessId é obrigatório para a auditoria M03.');
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(capturedAt))) throw new Error('capturedAt inválido.');

  const issues: M03FinancialAuditIssue[] = [];
  const transactions = readOwnedDocuments('transactions', input.transactions, businessId, issues);
  const sales = readOwnedDocuments('sales', input.sales, businessId, issues);
  const purchaseNotes = readOwnedDocuments('purchaseNotes', input.purchaseNotes, businessId, issues);
  const appointments = readOwnedDocuments('appointments', input.appointments, businessId, issues);
  const deliveryOrders = readOwnedDocuments('deliveryOrders', input.deliveryOrders, businessId, issues);

  const saleIds = new Set(sales.map((d) => d.id));
  const purchaseNoteIds = new Set(purchaseNotes.map((d) => d.id));
  const appointmentIds = new Set(appointments.map((d) => d.id));
  const deliveryOrderIds = new Set(deliveryOrders.map((d) => d.id));
  const transactionIds = new Set(transactions.map((d) => d.id));

  const entries: M03FinancialSnapshotEntry[] = [];
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let invalidType = 0;
  let invalidStatus = 0;
  let nonPositiveAmount = 0;
  let orphanRecurrences = 0;
  let brokenReferences = 0;

  // Agrupamentos pra segunda passada (precisam ver TODOS os membros antes de decidir).
  const installmentGroups = new Map<string, { total?: number; memberIds: string[] }>();
  const sourceCombos = new Map<string, string[]>(); // `${field}:${id}:${type}` -> transactionIds ativos

  for (const document of transactions) {
    const data = document.data;
    const key = `transaction:${document.id}`;
    const type = String(data.type ?? '');
    const status = String(data.status ?? '');
    const amount = numberValue(data.amount) ?? 0;
    const isActive = status !== CANCELLED_STATUS;

    byType[type || '(vazio)'] = (byType[type || '(vazio)'] ?? 0) + 1;
    byStatus[status || '(vazio)'] = (byStatus[status || '(vazio)'] ?? 0) + 1;

    if (!VALID_TYPES.has(type)) {
      invalidType += 1;
      issues.push({
        code: 'INVALID_TYPE',
        entityKey: key,
        message: `type="${type || '(vazio)'}" fora do enum válido (receita|despesa).`,
      });
    }
    if (!VALID_STATUSES.has(status)) {
      invalidStatus += 1;
      issues.push({
        code: 'INVALID_STATUS',
        entityKey: key,
        message: `status="${status || '(vazio)'}" fora do enum válido do FSM (pendente|pago|atrasado|cancelado).`,
      });
    }
    if (amount <= 0) {
      nonPositiveAmount += 1;
      issues.push({
        code: 'NON_POSITIVE_AMOUNT',
        entityKey: key,
        message: `amount=${amount} não é positivo — nenhuma camada de validação hoje impede isso.`,
      });
    }

    const sourceRefs: M03FinancialSourceRefs = {
      saleId: stringValue(data.saleId),
      purchaseNoteId: stringValue(data.purchaseNoteId),
      appointmentId: stringValue(data.appointmentId),
      deliveryOrderId: stringValue(data.deliveryOrderId),
    };

    for (const [field, id, existsIn] of [
      ['saleId', sourceRefs.saleId, saleIds],
      ['purchaseNoteId', sourceRefs.purchaseNoteId, purchaseNoteIds],
      ['appointmentId', sourceRefs.appointmentId, appointmentIds],
      ['deliveryOrderId', sourceRefs.deliveryOrderId, deliveryOrderIds],
    ] as const) {
      if (!id) continue;
      if (!existsIn.has(id)) {
        brokenReferences += 1;
        issues.push({
          code: 'BROKEN_SOURCE_REFERENCE',
          entityKey: key,
          message: `${field}=${id} não existe no tenant.`,
        });
      }
      if (isActive) {
        const comboKey = `${field}:${id}:${type}`;
        const list = sourceCombos.get(comboKey) ?? [];
        list.push(document.id);
        sourceCombos.set(comboKey, list);
      }
    }

    const recurrenceId = stringValue(data.recurrenceId);
    if (recurrenceId && !transactionIds.has(recurrenceId)) {
      orphanRecurrences += 1;
      issues.push({
        code: 'ORPHAN_RECURRENCE',
        entityKey: key,
        message: `recurrenceId=${recurrenceId} não aponta pra nenhuma transação existente no tenant.`,
      });
    }

    const installmentGroupId = stringValue(data.installmentGroupId);
    const installmentTotal = numberValue(data.installmentTotal);
    if (installmentGroupId) {
      const group = installmentGroups.get(installmentGroupId) ?? { memberIds: [] };
      group.memberIds.push(document.id);
      if (installmentTotal !== undefined && group.total === undefined) group.total = installmentTotal;
      installmentGroups.set(installmentGroupId, group);
    }

    entries.push({
      key,
      transactionId: document.id,
      type,
      status,
      amount,
      ...(installmentGroupId ? { installmentGroupId } : {}),
      ...(installmentTotal !== undefined ? { installmentTotal } : {}),
      ...(recurrenceId ? { recurrenceId } : {}),
      sourceRefs,
    });
  }

  // ── Parcelamento: contagem real de membros vs. installmentTotal declarado ──
  let installmentMismatches = 0;
  for (const [groupId, group] of [...installmentGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.total === undefined) continue;
    if (group.memberIds.length !== group.total) {
      installmentMismatches += 1;
      issues.push({
        code: 'INSTALLMENT_COUNT_MISMATCH',
        entityKey: `installmentGroup:${groupId}`,
        message: `${group.memberIds.length} parcela(s) encontrada(s), mas installmentTotal declara ${group.total}.`,
      });
    }
  }

  // ── Duplicidade: 2+ transações ATIVAS com a mesma origem+tipo ───────────────
  let duplicateSourceTransactions = 0;
  for (const [comboKey, ids] of [...sourceCombos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.length <= 1) continue;
    duplicateSourceTransactions += 1;
    const sorted = [...ids].sort();
    issues.push({
      code: 'DUPLICATE_SOURCE_TRANSACTION',
      entityKey: sorted.map((id) => `transaction:${id}`).join('|'),
      message: `${ids.length} transações ativas compartilham a mesma origem+tipo (${comboKey}) — possível duplicidade de double-click.`,
    });
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));
  issues.sort((left, right) => issueKey(left).localeCompare(issueKey(right)));

  return {
    schemaVersion: M03_FINANCIAL_SNAPSHOT_VERSION,
    businessId,
    capturedAt,
    entries,
    issues,
    summary: {
      transactions: transactions.length,
      byStatus,
      byType,
      invalidType,
      invalidStatus,
      nonPositiveAmount,
      installmentMismatches,
      orphanRecurrences,
      brokenReferences,
      duplicateSourceTransactions,
      issues: issues.length,
    },
  };
}

function assertSnapshot(snapshot: M03FinancialSnapshot, label: string): void {
  if (snapshot.schemaVersion !== M03_FINANCIAL_SNAPSHOT_VERSION) {
    throw new Error(`${label}: versão de snapshot M03 incompatível.`);
  }
  if (!snapshot.businessId?.trim() || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.issues)) {
    throw new Error(`${label}: snapshot M03 inválido.`);
  }
}

export function compareM03FinancialSnapshots(
  before: M03FinancialSnapshot,
  after: M03FinancialSnapshot,
): M03FinancialSnapshotComparison {
  assertSnapshot(before, 'baseline');
  assertSnapshot(after, 'atual');
  if (before.businessId !== after.businessId) {
    throw new Error('Snapshots M03 de businessId diferentes não podem ser comparados.');
  }

  const beforeEntries = new Map(before.entries.map((entry) => [entry.key, entry]));
  const afterEntries = new Map(after.entries.map((entry) => [entry.key, entry]));
  const keys = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort();
  const differences: M03FinancialSnapshotDifference[] = [];
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
