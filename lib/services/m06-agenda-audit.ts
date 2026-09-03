/**
 * Snapshot e comparação read-only do baseline da Agenda (M06.0).
 *
 * Mesma forma da auditoria M02 (`m02-commercial-audit.ts`): esta camada é PURA
 * — recebe documentos já lidos, relaciona efeitos e denuncia problemas. Quem lê
 * do Firestore é `scripts/audit-m06-agenda.ts`, sempre por UM businessId.
 *
 * O objetivo desta auditoria é MEDIR o estrago real antes da convergência
 * planejada em `docs/paridade/M06_PLANO_IMPLEMENTACAO.md`. Cada código de
 * problema corresponde a uma lacuna concreta do diagnóstico:
 *
 *  - OVERLAP                    → 6 canais gravam com 3 algoritmos de conflito
 *                                 diferentes (2 sem nenhum). Quantos horários já
 *                                 estão sobrepostos na base de verdade?
 *  - COMPLETION_WITHOUT_EFFECT  → o browser grava o status e SÓ DEPOIS dispara o
 *                                 evento de efeitos. Quantos atendimentos ficaram
 *                                 concluídos sem comissão/fidelidade/insumo?
 *  - LEGACY_PROFESSIONALS       → o check de conflito só olha `professionalId`;
 *                                 quantos docs ainda não têm `professionalIds[]`?
 *  - OUTSIDE_WORKING_HOURS      → o agente não revalida horário de trabalho ao
 *                                 gravar. Quantos already violam a agenda do
 *                                 profissional?
 *  - SESSION_OVER_CAPACITY      → o guard Admin não conta vagas de turma.
 *  - MISSING_*_REFERENCE        → comissão/cobrança/NFSe apontando pra documento
 *                                 que não existe mais.
 *
 * IMPORTANTE — a detecção de OVERLAP usa a regra CANÔNICA (todos os
 * profissionais de `professionalIds[]`, não só o legado). É de propósito: o
 * ponto é justamente encontrar as sobreposições que o check atual NÃO vê.
 */

export const M06_AGENDA_SNAPSHOT_VERSION = 1 as const;

export interface M06AuditDocument {
  id: string;
  data: Record<string, unknown>;
}

export interface M06AgendaAuditInput {
  businessId: string;
  capturedAt?: string;
  appointments: M06AuditDocument[];
  services: M06AuditDocument[];
  /** Membros do tenant — usados só para ler `workingHours`. */
  users: M06AuditDocument[];
  /** Para validar `commissionTransactionId`, `billingTransactionId` e `billingInstallmentGroupId`. */
  transactions: M06AuditDocument[];
  /** Para validar `fiscalDocumentId` (NFSe emitida a partir do atendimento). */
  fiscalDocuments: M06AuditDocument[];
}

export type M06AuditIssueCode =
  | 'TENANT_MISMATCH'
  | 'INVALID_SCHEDULE'
  | 'OVERLAP'
  | 'COMPLETION_WITHOUT_EFFECT'
  | 'LEGACY_PROFESSIONALS'
  | 'MISSING_PROFESSIONAL'
  | 'OUTSIDE_WORKING_HOURS'
  | 'SESSION_OVER_CAPACITY'
  | 'MISSING_FINANCIAL_REFERENCE'
  | 'MISSING_FISCAL_REFERENCE';

export interface M06AgendaAuditIssue {
  code: M06AuditIssueCode;
  entityKey: string;
  message: string;
}

export interface M06AgendaEffectReferences {
  transactions: string[];
  fiscalDocuments: string[];
}

export interface M06AgendaSnapshotEntry {
  key: string;
  appointmentId: string;
  status: string;
  date: string;
  startTime: string;
  endTime: string;
  professionalIds: string[];
  sessionKey?: string;
  effects: M06AgendaEffectReferences;
}

export interface M06AgendaSnapshot {
  schemaVersion: typeof M06_AGENDA_SNAPSHOT_VERSION;
  businessId: string;
  capturedAt: string;
  entries: M06AgendaSnapshotEntry[];
  issues: M06AgendaAuditIssue[];
  summary: {
    appointments: number;
    byStatus: Record<string, number>;
    overlaps: number;
    completionsWithoutEffect: number;
    legacySchema: number;
    withoutProfessional: number;
    outsideWorkingHours: number;
    sessionsOverCapacity: number;
    brokenReferences: number;
    issues: number;
  };
}

export interface M06AgendaSnapshotDifference {
  key: string;
  status: 'changed' | 'added' | 'removed';
  before?: M06AgendaSnapshotEntry;
  after?: M06AgendaSnapshotEntry;
}

export interface M06AgendaSnapshotComparison {
  businessId: string;
  beforeCapturedAt: string;
  afterCapturedAt: string;
  preserved: boolean;
  healthy: boolean;
  comparedEntries: number;
  unchangedEntries: number;
  differences: M06AgendaSnapshotDifference[];
  newIssues: M06AgendaAuditIssue[];
  resolvedIssues: M06AgendaAuditIssue[];
  currentIssues: M06AgendaAuditIssue[];
}

/** Status que libera o slot — espelha `checkAppointmentConflict` (só 'cancelado'). */
const SLOT_RELEASING_STATUSES = new Set(['cancelado']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

function issueKey(issue: M06AgendaAuditIssue): string {
  return `${issue.code}:${issue.entityKey}:${issue.message}`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function readOwnedDocuments(
  collectionName: string,
  documents: M06AuditDocument[],
  businessId: string,
  issues: M06AgendaAuditIssue[],
): M06AuditDocument[] {
  const owned: M06AuditDocument[] = [];
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

/**
 * Lista canônica de profissionais — mesma regra de `lib/utils/appointment.ts`,
 * reimplementada aqui sobre `Record<string, unknown>` porque a auditoria opera
 * em documentos crus (sem tipagem de Appointment) por design.
 */
function professionalIdsOf(data: Record<string, unknown>): string[] {
  const list = Array.isArray(data.professionalIds)
    ? data.professionalIds.map((id) => stringValue(id)).filter((id): id is string => !!id)
    : [];
  if (list.length > 0) return uniqueSorted(list);
  const legacy = stringValue(data.professionalId);
  return legacy ? [legacy] : [];
}

/** Overlap clássico: A não sobrepõe B sse A termina antes de B começar ou vice-versa. */
function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return !(aEnd <= bStart || aStart >= bEnd);
}

interface WorkingDaySchedule {
  enabled?: boolean;
  start?: string;
  end?: string;
}

function workingDayOf(
  user: Record<string, unknown> | undefined,
  date: string,
): WorkingDaySchedule | undefined {
  const hours = user?.workingHours;
  if (!hours || typeof hours !== 'object') return undefined;
  // Midday local — mesmo truque de `checkAppointmentConflict` para não cair no
  // dia anterior em fusos negativos.
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
  if (Number.isNaN(dayOfWeek)) return undefined;
  const schedule = (hours as Record<string, unknown>)[String(dayOfWeek)];
  if (!schedule || typeof schedule !== 'object') return undefined;
  return schedule as WorkingDaySchedule;
}

export function buildM06AgendaSnapshot(input: M06AgendaAuditInput): M06AgendaSnapshot {
  const businessId = input.businessId.trim();
  if (!businessId) throw new Error('businessId é obrigatório para a auditoria M06.');
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(capturedAt))) throw new Error('capturedAt inválido.');

  const issues: M06AgendaAuditIssue[] = [];
  const appointments = readOwnedDocuments('appointments', input.appointments, businessId, issues);
  const services = readOwnedDocuments('services', input.services, businessId, issues);
  const users = readOwnedDocuments('users', input.users, businessId, issues);
  const transactions = readOwnedDocuments('transactions', input.transactions, businessId, issues);
  const fiscalDocuments = readOwnedDocuments('fiscalDocuments', input.fiscalDocuments, businessId, issues);

  const servicesById = new Map(services.map((document) => [document.id, document.data]));
  const usersById = new Map(users.map((document) => [document.id, document.data]));
  const transactionIds = new Set(transactions.map((document) => document.id));
  const installmentGroupIds = new Set(
    transactions
      .map((document) => stringValue(document.data.installmentGroupId))
      .filter((value): value is string => !!value),
  );
  const fiscalDocumentIds = new Set(fiscalDocuments.map((document) => document.id));

  const entries: M06AgendaSnapshotEntry[] = [];
  const byStatus: Record<string, number> = {};

  // Slots ativos por profissional+data, para a varredura de sobreposição.
  const slotsByProfessionalDay = new Map<string, Array<{
    id: string;
    startTime: string;
    endTime: string;
    sessionKey?: string;
  }>>();
  // Reservas ativas por turma, para a checagem de capacidade.
  const seatsBySession = new Map<string, { serviceId?: string; capacitySnapshot?: number; ids: string[] }>();

  let completionsWithoutEffect = 0;
  let legacySchema = 0;
  let withoutProfessional = 0;
  let outsideWorkingHours = 0;
  let brokenReferences = 0;

  for (const document of appointments) {
    const data = document.data;
    const key = `appointment:${document.id}`;
    const status = String(data.status ?? '');
    byStatus[status || '(vazio)'] = (byStatus[status || '(vazio)'] ?? 0) + 1;

    const date = stringValue(data.date) ?? '';
    const startTime = stringValue(data.startTime) ?? '';
    const endTime = stringValue(data.endTime) ?? '';
    const professionals = professionalIdsOf(data);
    const sessionKey = stringValue(data.sessionKey);
    const isActive = !SLOT_RELEASING_STATUSES.has(status);

    const scheduleValid = DATE_RE.test(date) && TIME_RE.test(startTime) && TIME_RE.test(endTime) && startTime < endTime;
    if (!scheduleValid) {
      issues.push({
        code: 'INVALID_SCHEDULE',
        entityKey: key,
        message: `Data/horário inválidos ou fim não posterior ao início (date=${date || '(vazio)'}, start=${startTime || '(vazio)'}, end=${endTime || '(vazio)'}).`,
      });
    }

    // ── Conclusão sem efeito ────────────────────────────────────────────────
    if (status === 'concluido' && !stringValue(data.completionAppliedAt)) {
      completionsWithoutEffect += 1;
      issues.push({
        code: 'COMPLETION_WITHOUT_EFFECT',
        entityKey: key,
        message: 'Atendimento concluído sem completionAppliedAt — comissão, fidelidade, baixa de insumo e métricas nunca foram aplicadas.',
      });
    }

    // ── Schema de profissionais ─────────────────────────────────────────────
    const hasArray = Array.isArray(data.professionalIds)
      && data.professionalIds.some((id) => !!stringValue(id));
    if (professionals.length === 0) {
      withoutProfessional += 1;
      issues.push({
        code: 'MISSING_PROFESSIONAL',
        entityKey: key,
        message: 'Agendamento sem profissional atribuído — hoje não bloqueia ninguém na Agenda, mas bloqueia todos no caminho do agente de IA.',
      });
    } else if (!hasArray) {
      legacySchema += 1;
      issues.push({
        code: 'LEGACY_PROFESSIONALS',
        entityKey: key,
        message: 'Documento usa apenas o campo legado professionalId, sem professionalIds[].',
      });
    }

    // ── Horário de trabalho ─────────────────────────────────────────────────
    if (isActive && scheduleValid) {
      for (const professionalId of professionals) {
        const schedule = workingDayOf(usersById.get(professionalId), date);
        if (!schedule) continue;
        if (!schedule.enabled) {
          outsideWorkingHours += 1;
          issues.push({
            code: 'OUTSIDE_WORKING_HOURS',
            entityKey: key,
            message: `Profissional ${professionalId} não trabalha em ${date}.`,
          });
          continue;
        }
        if (
          (schedule.start && startTime < schedule.start)
          || (schedule.end && endTime > schedule.end)
        ) {
          outsideWorkingHours += 1;
          issues.push({
            code: 'OUTSIDE_WORKING_HOURS',
            entityKey: key,
            message: `Agendamento ${startTime}-${endTime} fora do expediente de ${professionalId} (${schedule.start ?? '?'}-${schedule.end ?? '?'}).`,
          });
        }
      }
    }

    // ── Índices para sobreposição e capacidade ──────────────────────────────
    if (isActive && scheduleValid) {
      for (const professionalId of professionals) {
        const bucketKey = `${professionalId}|${date}`;
        const bucket = slotsByProfessionalDay.get(bucketKey) ?? [];
        bucket.push({ id: document.id, startTime, endTime, ...(sessionKey ? { sessionKey } : {}) });
        slotsByProfessionalDay.set(bucketKey, bucket);
      }
      if (sessionKey) {
        const seats = seatsBySession.get(sessionKey) ?? {
          serviceId: stringValue(data.serviceId),
          capacitySnapshot: typeof data.capacitySnapshot === 'number' ? data.capacitySnapshot : undefined,
          ids: [],
        };
        seats.ids.push(document.id);
        if (seats.capacitySnapshot === undefined && typeof data.capacitySnapshot === 'number') {
          seats.capacitySnapshot = data.capacitySnapshot;
        }
        if (!seats.serviceId) seats.serviceId = stringValue(data.serviceId);
        seatsBySession.set(sessionKey, seats);
      }
    }

    // ── Referências de efeito ───────────────────────────────────────────────
    const effects: M06AgendaEffectReferences = { transactions: [], fiscalDocuments: [] };
    const commissionTransactionId = stringValue(data.commissionTransactionId);
    const billingTransactionId = stringValue(data.billingTransactionId);
    const billingInstallmentGroupId = stringValue(data.billingInstallmentGroupId);
    const fiscalDocumentId = stringValue(data.fiscalDocumentId);

    for (const [field, id] of [
      ['commissionTransactionId', commissionTransactionId],
      ['billingTransactionId', billingTransactionId],
    ] as const) {
      if (!id) continue;
      effects.transactions.push(id);
      if (!transactionIds.has(id)) {
        brokenReferences += 1;
        issues.push({
          code: 'MISSING_FINANCIAL_REFERENCE',
          entityKey: key,
          message: `${field}=${id} não existe em transactions no tenant.`,
        });
      }
    }
    if (billingInstallmentGroupId && !installmentGroupIds.has(billingInstallmentGroupId)) {
      brokenReferences += 1;
      issues.push({
        code: 'MISSING_FINANCIAL_REFERENCE',
        entityKey: key,
        message: `billingInstallmentGroupId=${billingInstallmentGroupId} não tem nenhuma parcela em transactions.`,
      });
    }
    if (fiscalDocumentId) {
      effects.fiscalDocuments.push(fiscalDocumentId);
      if (!fiscalDocumentIds.has(fiscalDocumentId)) {
        brokenReferences += 1;
        issues.push({
          code: 'MISSING_FISCAL_REFERENCE',
          entityKey: key,
          message: `fiscalDocumentId=${fiscalDocumentId} não existe em fiscalDocuments no tenant.`,
        });
      }
    }

    entries.push({
      key,
      appointmentId: document.id,
      status,
      date,
      startTime,
      endTime,
      professionalIds: professionals,
      ...(sessionKey ? { sessionKey } : {}),
      effects: {
        transactions: uniqueSorted(effects.transactions),
        fiscalDocuments: uniqueSorted(effects.fiscalDocuments),
      },
    });
  }

  // ── Sobreposições ─────────────────────────────────────────────────────────
  // Um par é reportado UMA vez, com chave determinística (ids ordenados), para
  // que dois snapshots do mesmo estado produzam exatamente as mesmas issues.
  const reportedPairs = new Set<string>();
  let overlaps = 0;
  for (const [bucketKey, slots] of [...slotsByProfessionalDay.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const ordered = [...slots].sort((left, right) =>
      left.startTime.localeCompare(right.startTime) || left.id.localeCompare(right.id),
    );
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i];
        const b = ordered[j];
        // Colegas da MESMA turma não competem pelo slot — mesma regra do guard.
        if (a.sessionKey && a.sessionKey === b.sessionKey) continue;
        if (!intervalsOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) continue;
        const [first, second] = [a.id, b.id].sort();
        const pairKey = `${bucketKey}|${first}|${second}`;
        if (reportedPairs.has(pairKey)) continue;
        reportedPairs.add(pairKey);
        overlaps += 1;
        const [professionalId, date] = bucketKey.split('|');
        issues.push({
          code: 'OVERLAP',
          entityKey: `appointment:${first}|appointment:${second}`,
          message: `Sobreposição em ${date} para o profissional ${professionalId}: ${a.startTime}-${a.endTime} e ${b.startTime}-${b.endTime}.`,
        });
      }
    }
  }

  // ── Capacidade de turma ───────────────────────────────────────────────────
  let sessionsOverCapacity = 0;
  for (const [sessionKey, seats] of [...seatsBySession.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const service = seats.serviceId ? servicesById.get(seats.serviceId) : undefined;
    const serviceCapacity = typeof service?.capacity === 'number' ? service.capacity : undefined;
    // Capacidade atual do serviço é a referência; o snapshot gravado no
    // agendamento cobre o caso de o serviço ter sido apagado/alterado depois.
    const capacity = serviceCapacity ?? seats.capacitySnapshot;
    if (!capacity || capacity < 1) continue;
    if (seats.ids.length > capacity) {
      sessionsOverCapacity += 1;
      issues.push({
        code: 'SESSION_OVER_CAPACITY',
        entityKey: `session:${sessionKey}`,
        message: `Turma com ${seats.ids.length} reservas ativas para capacidade ${capacity}.`,
      });
    }
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));
  issues.sort((left, right) => issueKey(left).localeCompare(issueKey(right)));

  return {
    schemaVersion: M06_AGENDA_SNAPSHOT_VERSION,
    businessId,
    capturedAt,
    entries,
    issues,
    summary: {
      appointments: appointments.length,
      byStatus,
      overlaps,
      completionsWithoutEffect,
      legacySchema,
      withoutProfessional,
      outsideWorkingHours,
      sessionsOverCapacity,
      brokenReferences,
      issues: issues.length,
    },
  };
}

function assertSnapshot(snapshot: M06AgendaSnapshot, label: string): void {
  if (snapshot.schemaVersion !== M06_AGENDA_SNAPSHOT_VERSION) {
    throw new Error(`${label}: versão de snapshot M06 incompatível.`);
  }
  if (!snapshot.businessId?.trim() || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.issues)) {
    throw new Error(`${label}: snapshot M06 inválido.`);
  }
}

export function compareM06AgendaSnapshots(
  before: M06AgendaSnapshot,
  after: M06AgendaSnapshot,
): M06AgendaSnapshotComparison {
  assertSnapshot(before, 'baseline');
  assertSnapshot(after, 'atual');
  if (before.businessId !== after.businessId) {
    throw new Error('Snapshots M06 de businessId diferentes não podem ser comparados.');
  }

  const beforeEntries = new Map(before.entries.map((entry) => [entry.key, entry]));
  const afterEntries = new Map(after.entries.map((entry) => [entry.key, entry]));
  const keys = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort();
  const differences: M06AgendaSnapshotDifference[] = [];
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
