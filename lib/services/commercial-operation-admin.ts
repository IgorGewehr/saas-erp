/**
 * Coordenador recuperável de operações comerciais da M02.
 *
 * Cada efeito precisa ser determinístico e idempotente. O coordenador mantém
 * lease curta, checkpoints persistidos e retoma somente o que não foi
 * confirmado. O estoque usa diretamente o núcleo transacional entregue na M01.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Firestore, Transaction as FirestoreTransaction } from 'firebase-admin/firestore';
import { DomainEventSchema } from '@/lib/contracts/events';
import {
  COMMERCIAL_OPERATION_CHECKPOINTS,
  CommercialOperationEffectIdsSchema,
  CommercialOperationRequestSchema,
  CommercialOperationResultSchema,
  CommercialOperationSchema,
  CommercialOperationStepEffectsSchema,
  CommercialStockEffectSchema,
  type CommercialOperation,
  type CommercialOperationCheckpointName,
  type CommercialOperationEffectIds,
  type CommercialOperationRequest,
  type CommercialOperationResult,
  type CommercialOperationStepEffectsInput,
  type CommercialOperationStepEffects,
  type CommercialStockEffect,
} from '@/lib/contracts/domain/commercialOperation';
import { applyStockOperationAdmin } from '@/lib/services/stock-core-admin';
import {
  compensateCommercialBenefitsAdmin,
  confirmCommercialBenefitsAdmin,
  reserveCommercialBenefitsAdmin,
} from '@/lib/services/commercial-benefits-admin';
import { writeStructuredOperationLog } from '@/lib/services/structured-operation-log';

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export type CommercialEffectCollection =
  | 'transactions'
  | 'couponRedemptions'
  | 'giftCardRedemptions'
  | 'loyaltyTransactions'
  | 'fiscalDocuments';

export interface CommercialOperationHandlerContext {
  db: Firestore;
  operationId: string;
  requestFingerprint: string;
  request: CommercialOperationRequest;
  effectIds: CommercialOperationEffectIds;
  documentId: string;
}

export interface CommercialOperationHandlers {
  reserveBenefits?: (
    context: CommercialOperationHandlerContext,
  ) => Promise<CommercialOperationStepEffectsInput | void>;
  reconcileDownstream?: (
    context: CommercialOperationHandlerContext & { stock?: CommercialStockEffect },
  ) => Promise<CommercialOperationStepEffectsInput | void>;
}

export interface CommercialOperationFaultHooks {
  /** Exclusivo para testes de recuperação: simula queda após o efeito e antes do checkpoint. */
  afterCheckpointEffect?: (
    checkpoint: CommercialOperationCheckpointName,
    operationId: string,
  ) => Promise<void> | void;
}

export interface RunCommercialOperationAdminInput {
  db: Firestore;
  request: unknown;
  handlers?: CommercialOperationHandlers;
  faults?: CommercialOperationFaultHooks;
  now?: () => Date;
  leaseMs?: number;
  leaseTokenFactory?: () => string;
  failurePolicy?: (
    error: unknown,
    checkpoint: CommercialOperationCheckpointName,
  ) => 'retry' | 'compensate';
}

export interface RunCommercialOperationResult extends CommercialOperationResult {
  replayed: boolean;
}

export class CommercialOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommercialOperationError';
  }
}

export class CommercialOperationIdempotencyConflictError extends CommercialOperationError {
  constructor() {
    super('COMMERCIAL_IDEMPOTENCY_CONFLICT', 'A chave de idempotência já foi usada com outra operação comercial.');
    this.name = 'CommercialOperationIdempotencyConflictError';
  }
}

export class CommercialOperationInProgressError extends CommercialOperationError {
  constructor(public readonly operationId: string) {
    super('COMMERCIAL_OPERATION_IN_PROGRESS', 'A operação comercial ainda está em processamento.');
    this.name = 'CommercialOperationInProgressError';
  }
}

export class CommercialOperationLeaseLostError extends CommercialOperationError {
  constructor() {
    super('COMMERCIAL_LEASE_LOST', 'A execução perdeu o lease da operação comercial.');
    this.name = 'CommercialOperationLeaseLostError';
  }
}

export class CommercialOperationDocumentConflictError extends CommercialOperationError {
  constructor() {
    super('COMMERCIAL_DOCUMENT_CONFLICT', 'O documento comercial determinístico está ocupado por outra operação.');
    this.name = 'CommercialOperationDocumentConflictError';
  }
}

export class CommercialOperationUnavailableError extends CommercialOperationError {
  constructor() {
    super('COMMERCIAL_QUOTE_UNAVAILABLE', 'A cotação contém itens sem disponibilidade. Gere uma nova cotação.');
    this.name = 'CommercialOperationUnavailableError';
  }
}

export class CommercialOperationConfigurationError extends CommercialOperationError {
  constructor(message: string) {
    super('COMMERCIAL_HANDLER_REQUIRED', message);
    this.name = 'CommercialOperationConfigurationError';
  }
}

export class CommercialOperationCompensationRequiredError extends CommercialOperationError {
  constructor() {
    super('COMMERCIAL_COMPENSATION_REQUIRED', 'A operação aguarda compensação e não pode ser retomada como checkout.');
    this.name = 'CommercialOperationCompensationRequiredError';
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function stripUndefined<T>(value: T): T {
  return stableValue(value) as T;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${hash(value).slice(0, 40)}`;
}

export function commercialOperationId(
  businessId: string,
  sourceType: CommercialOperationRequest['sourceType'],
  idempotencyKey: string,
): string {
  return deterministicId('commercial', `${businessId}:${sourceType}:${idempotencyKey}`);
}

export function commercialRequestFingerprint(request: CommercialOperationRequest): string {
  // Datas e saldos disponíveis são snapshots voláteis. Eles não podem fazer um
  // retry da mesma intenção parecer outro checkout depois que o próprio estoque
  // já foi baixado. Preço, linhas, quantidades, pagamentos e documento continuam
  // participando integralmente da identidade.
  const quote = {
    ...request.quote,
    quotedAt: undefined,
    lines: request.quote.lines.map((line) => ({
      ...line,
      stockRequirements: line.stockRequirements.map((requirement) => ({
        ...requirement,
        available: undefined,
      })),
    })),
    // A disponibilidade global e a lista de faltas são derivadas dos mesmos
    // requisitos e do saldo instantâneo; ambas podem mudar após a própria baixa.
    availability: undefined,
  };
  const document = {
    ...request.document,
    createdAt: undefined,
    updatedAt: undefined,
  };
  return hash(JSON.stringify(stableValue({ ...request, quote, document })));
}

export function buildCommercialOperationEffectIds(
  request: CommercialOperationRequest,
  operationId = commercialOperationId(request.businessId, request.sourceType, request.idempotencyKey),
): CommercialOperationEffectIds {
  const documentPrefix = request.sourceType === 'sale'
    ? 'sale'
    : request.sourceType === 'deliveryOrder'
      ? 'delivery'
      : 'order';
  const transactionIds = Object.fromEntries(request.payments.map((payment) => [
    payment.allocationId,
    deterministicId('transaction', `${operationId}:payment:${payment.allocationId}`),
  ]));
  const benefitEntries = (type: CommercialOperationRequest['benefits'][number]['type'], prefix: string) =>
    Object.fromEntries(request.benefits
      .filter((benefit) => benefit.type === type)
      .map((benefit) => [benefit.intentId, deterministicId(prefix, `${operationId}:benefit:${benefit.intentId}`)]));

  return CommercialOperationEffectIdsSchema.parse({
    documentId: deterministicId(documentPrefix, `${operationId}:document`),
    stockIdempotencyKey: `${operationId}:stock:v1`,
    transactionIds,
    couponRedemptionIds: benefitEntries('coupon', 'couponredemption'),
    giftCardRedemptionIds: benefitEntries('gift_card', 'giftredemption'),
    loyaltyTransactionIds: benefitEntries('loyalty_points', 'loyaltytx'),
    ...(request.fiscalIntent
      ? { fiscalDocumentId: deterministicId('fiscaldoc', `${operationId}:fiscal:${request.fiscalIntent.type}`) }
      : {}),
    domainEventId: deterministicId('commercial_event', `${operationId}:completed`),
  });
}

export function buildCommercialOperationIdentity(rawRequest: unknown): {
  request: CommercialOperationRequest;
  operationId: string;
  requestFingerprint: string;
  effectIds: CommercialOperationEffectIds;
} {
  const request = CommercialOperationRequestSchema.parse(rawRequest);
  const operationId = commercialOperationId(request.businessId, request.sourceType, request.idempotencyKey);
  return {
    request,
    operationId,
    requestFingerprint: commercialRequestFingerprint(request),
    effectIds: buildCommercialOperationEffectIds(request, operationId),
  };
}

function pendingCheckpoints(nowIso: string): CommercialOperation['checkpoints'] {
  return Object.fromEntries(COMMERCIAL_OPERATION_CHECKPOINTS.map((checkpoint) => [
    checkpoint,
    checkpoint === 'input_validated'
      ? { status: 'completed', attempts: 1, startedAt: nowIso, completedAt: nowIso }
      : { status: 'pending', attempts: 0 },
  ])) as CommercialOperation['checkpoints'];
}

function assertOperationIdentity(
  operation: CommercialOperation,
  identity: ReturnType<typeof buildCommercialOperationIdentity>,
): void {
  if (
    operation.businessId !== identity.request.businessId
    || operation.idempotencyKey !== identity.request.idempotencyKey
    || operation.requestFingerprint !== identity.requestFingerprint
  ) {
    throw new CommercialOperationIdempotencyConflictError();
  }
}

function assertLease(operation: CommercialOperation, leaseToken: string): void {
  if (!operation.lease || operation.lease.token !== leaseToken) {
    throw new CommercialOperationLeaseLostError();
  }
}

function errorCode(cause: unknown): string {
  if (cause instanceof CommercialOperationError) return cause.code;
  if (typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string') {
    return cause.code;
  }
  return 'COMMERCIAL_STEP_FAILED';
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function defaultFailurePolicy(cause: unknown): 'retry' | 'compensate' {
  const code = errorCode(cause);
  if (
    code.includes('INSUFFICIENT')
    || code.includes('REFERENCE')
    || code.includes('TENANT')
    || code.includes('IDEMPOTENCY_CONFLICT')
    || code.includes('DOCUMENT_CONFLICT')
    || code.includes('HANDLER_REQUIRED')
  ) return 'compensate';
  return 'retry';
}

async function claimOperation(params: {
  db: Firestore;
  identity: ReturnType<typeof buildCommercialOperationIdentity>;
  leaseToken: string;
  now: Date;
  leaseMs: number;
}): Promise<{ operation: CommercialOperation; replayed: boolean }> {
  const { db, identity, leaseToken, now, leaseMs } = params;
  const operationRef = db.collection('commercialOperations').doc(identity.operationId);
  const documentRef = db.collection(identity.request.target.collection).doc(identity.effectIds.documentId);
  const nowIso = now.toISOString();

  return db.runTransaction(async (tx) => {
    // Todas as leituras precedem as escritas, como exigido pelo Firestore.
    const operationSnapshot = await tx.get(operationRef);
    const documentSnapshot = await tx.get(documentRef);

    if (operationSnapshot.exists) {
      const existing = CommercialOperationSchema.parse({ ...operationSnapshot.data(), operationId: operationSnapshot.id });
      assertOperationIdentity(existing, identity);
      if (documentSnapshot.exists) {
        const document = documentSnapshot.data();
        if (
          document?.businessId !== identity.request.businessId
          || document?.commercialOperationId !== identity.operationId
          || document?.commercialRequestFingerprint !== identity.requestFingerprint
        ) throw new CommercialOperationDocumentConflictError();
      }
      if (existing.status === 'completed' && existing.result) {
        return { operation: existing, replayed: true };
      }
      if (['compensation_pending', 'compensating', 'compensated'].includes(existing.status)) {
        throw new CommercialOperationCompensationRequiredError();
      }
      if (existing.lease && Date.parse(existing.lease.expiresAt) > now.getTime()) {
        throw new CommercialOperationInProgressError(identity.operationId);
      }
      const resumed = CommercialOperationSchema.parse({
        ...existing,
        status: 'running',
        attempts: existing.attempts + 1,
        lease: {
          token: leaseToken,
          acquiredAt: nowIso,
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        },
        currentCheckpoint: null,
        updatedAt: nowIso,
      });
      tx.set(operationRef, stripUndefined(resumed));
      return { operation: resumed, replayed: false };
    }

    if (documentSnapshot.exists) throw new CommercialOperationDocumentConflictError();
    const created = CommercialOperationSchema.parse({
      schemaVersion: 1,
      operationId: identity.operationId,
      businessId: identity.request.businessId,
      idempotencyKey: identity.request.idempotencyKey,
      requestFingerprint: identity.requestFingerprint,
      sourceType: identity.request.sourceType,
      channel: identity.request.channel,
      status: 'running',
      request: identity.request,
      effectIds: identity.effectIds,
      checkpoints: pendingCheckpoints(nowIso),
      currentCheckpoint: null,
      attempts: 1,
      lease: {
        token: leaseToken,
        acquiredAt: nowIso,
        expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      },
      compensation: { status: 'not_required' },
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    tx.create(operationRef, stripUndefined(created));
    return { operation: created, replayed: false };
  });
}

async function startCheckpoint(params: {
  db: Firestore;
  operationId: string;
  leaseToken: string;
  checkpoint: CommercialOperationCheckpointName;
  now: Date;
  leaseMs: number;
}): Promise<{ operation: CommercialOperation; shouldRun: boolean }> {
  const ref = params.db.collection('commercialOperations').doc(params.operationId);
  return params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new CommercialOperationError('COMMERCIAL_OPERATION_NOT_FOUND', 'Operação comercial não encontrada.');
    const operation = CommercialOperationSchema.parse({ ...snapshot.data(), operationId: snapshot.id });
    assertLease(operation, params.leaseToken);
    const current = operation.checkpoints[params.checkpoint];
    if (current.status === 'completed' || current.status === 'skipped') {
      return { operation, shouldRun: false };
    }
    const nowIso = params.now.toISOString();
    const updated = CommercialOperationSchema.parse({
      ...operation,
      status: 'running',
      currentCheckpoint: params.checkpoint,
      checkpoints: {
        ...operation.checkpoints,
        [params.checkpoint]: {
          status: 'in_progress',
          attempts: current.attempts + 1,
          startedAt: nowIso,
        },
      },
      lease: {
        ...operation.lease!,
        expiresAt: new Date(params.now.getTime() + params.leaseMs).toISOString(),
      },
      updatedAt: nowIso,
    });
    tx.set(ref, stripUndefined(updated));
    return { operation: updated, shouldRun: true };
  });
}

async function finishCheckpoint(params: {
  db: Firestore;
  operationId: string;
  leaseToken: string;
  checkpoint: CommercialOperationCheckpointName;
  now: Date;
  leaseMs: number;
  status: 'completed' | 'skipped';
  result?: unknown;
}): Promise<CommercialOperation> {
  const ref = params.db.collection('commercialOperations').doc(params.operationId);
  return params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new CommercialOperationError('COMMERCIAL_OPERATION_NOT_FOUND', 'Operação comercial não encontrada.');
    const operation = CommercialOperationSchema.parse({ ...snapshot.data(), operationId: snapshot.id });
    assertLease(operation, params.leaseToken);
    const nowIso = params.now.toISOString();
    const checkpoint = operation.checkpoints[params.checkpoint];
    const updated = CommercialOperationSchema.parse({
      ...operation,
      currentCheckpoint: null,
      checkpoints: {
        ...operation.checkpoints,
        [params.checkpoint]: {
          status: params.status,
          attempts: checkpoint.attempts,
          startedAt: checkpoint.startedAt ?? nowIso,
          completedAt: nowIso,
          ...(params.result !== undefined ? { result: stripUndefined(params.result) } : {}),
        },
      },
      lease: {
        ...operation.lease!,
        expiresAt: new Date(params.now.getTime() + params.leaseMs).toISOString(),
      },
      updatedAt: nowIso,
    });
    tx.set(ref, stripUndefined(updated));
    return updated;
  });
}

async function failCheckpoint(params: {
  db: Firestore;
  operationId: string;
  leaseToken: string;
  checkpoint: CommercialOperationCheckpointName;
  cause: unknown;
  now: Date;
  policy: 'retry' | 'compensate';
}): Promise<void> {
  const ref = params.db.collection('commercialOperations').doc(params.operationId);
  await params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;
    const operation = CommercialOperationSchema.parse({ ...snapshot.data(), operationId: snapshot.id });
    assertLease(operation, params.leaseToken);
    const nowIso = params.now.toISOString();
    const error = {
      code: errorCode(params.cause),
      message: errorMessage(params.cause).slice(0, 2000),
      checkpoint: params.checkpoint,
      retryable: params.policy === 'retry',
      occurredAt: nowIso,
    };
    const requiresCompensation = params.policy === 'compensate'
      && COMMERCIAL_OPERATION_CHECKPOINTS.some((name) =>
        !['input_validated', params.checkpoint].includes(name)
        && operation.checkpoints[name].status === 'completed',
      );
    const updated = CommercialOperationSchema.parse({
      ...operation,
      status: requiresCompensation ? 'compensation_pending' : 'failed',
      currentCheckpoint: params.checkpoint,
      checkpoints: {
        ...operation.checkpoints,
        [params.checkpoint]: {
          status: 'failed',
          attempts: operation.checkpoints[params.checkpoint].attempts,
          startedAt: operation.checkpoints[params.checkpoint].startedAt,
          failedAt: nowIso,
          error,
        },
      },
      lease: null,
      lastError: error,
      compensation: requiresCompensation
        ? { status: 'pending', reason: error.message, requestedAt: nowIso, requestedBy: operation.request.actor }
        : operation.compensation,
      updatedAt: nowIso,
    });
    tx.set(ref, stripUndefined(updated));
  });
}

function checkpointResult(operation: CommercialOperation, name: CommercialOperationCheckpointName): unknown {
  return operation.checkpoints[name].result;
}

function parseStepEffects(value: unknown): CommercialOperationStepEffects {
  return CommercialOperationStepEffectsSchema.parse(value ?? {});
}

function mergeStepEffects(operation: CommercialOperation, stock?: CommercialStockEffect) {
  const benefits = parseStepEffects(checkpointResult(operation, 'benefits_reserved'));
  const downstream = parseStepEffects(checkpointResult(operation, 'downstream_reconciled'));
  return {
    operationId: operation.operationId,
    transactionIds: unique([...benefits.transactionIds, ...downstream.transactionIds]),
    stockMovementIds: unique(stock?.movementIds ?? []),
    couponRedemptionIds: unique([...benefits.couponRedemptionIds, ...downstream.couponRedemptionIds]),
    giftCardRedemptionIds: unique([...benefits.giftCardRedemptionIds, ...downstream.giftCardRedemptionIds]),
    loyaltyTransactionIds: unique([...benefits.loyaltyTransactionIds, ...downstream.loyaltyTransactionIds]),
    fiscalDocumentIds: unique([...benefits.fiscalDocumentIds, ...downstream.fiscalDocumentIds]),
  };
}

function commercialStockLines(request: CommercialOperationRequest) {
  return request.quote.lines.flatMap((line) => line.stockRequirements
    .filter((requirement) => requirement.tracked)
    .map((requirement) => ({
      productId: requirement.productId,
      ...(requirement.variantId ? { variantId: requirement.variantId } : {}),
      quantity: requirement.quantity,
      sourceLineId: line.lineId,
    })));
}

async function applyCommercialStock(
  context: CommercialOperationHandlerContext,
): Promise<CommercialStockEffect | undefined> {
  const lines = commercialStockLines(context.request);
  if (lines.length === 0) return undefined;
  const result = await applyStockOperationAdmin(context.db, {
    businessId: context.request.businessId,
    type: 'saida',
    lines,
    operatorId: context.request.actor.id,
    operatorName: context.request.actor.name,
    reason: `Operação comercial ${context.operationId}`,
    sourceType: context.request.sourceType === 'sale' ? 'sale' : 'order',
    sourceId: context.documentId,
    sourceDocument: {
      collection: context.request.target.collection,
      id: context.documentId,
      existence: 'if-present',
    },
    idempotencyKey: context.effectIds.stockIdempotencyKey,
    expandBom: false,
    negativeStockPolicy: 'prevent',
    requireActiveProducts: true,
    requireTrackedProducts: true,
  });
  return CommercialStockEffectSchema.parse({
    stockOperationId: result.operationId,
    replayed: result.replayed,
    movementIds: result.adjustments.map((adjustment) => adjustment.movementId),
    adjustments: result.adjustments,
  });
}

function assertStoredOperation(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  operationId: string,
  leaseToken: string,
): CommercialOperation {
  if (!snapshot.exists) throw new CommercialOperationError('COMMERCIAL_OPERATION_NOT_FOUND', 'Operação comercial não encontrada.');
  const operation = CommercialOperationSchema.parse({ ...snapshot.data(), operationId: snapshot.id });
  if (operation.operationId !== operationId) throw new CommercialOperationIdempotencyConflictError();
  assertLease(operation, leaseToken);
  return operation;
}

async function persistCommercialDocument(params: {
  context: CommercialOperationHandlerContext;
  leaseToken: string;
  stock?: CommercialStockEffect;
  now: Date;
}): Promise<{ documentCollection: CommercialOperationRequest['target']['collection']; documentId: string; replayed: boolean }> {
  const { context, leaseToken, stock, now } = params;
  const operationRef = context.db.collection('commercialOperations').doc(context.operationId);
  const documentRef = context.db.collection(context.request.target.collection).doc(context.documentId);
  return context.db.runTransaction(async (tx) => {
    const operationSnapshot = await tx.get(operationRef);
    const documentSnapshot = await tx.get(documentRef);
    assertStoredOperation(operationSnapshot, context.operationId, leaseToken);
    if (documentSnapshot.exists) {
      const document = documentSnapshot.data();
      if (
        document?.businessId !== context.request.businessId
        || document?.commercialOperationId !== context.operationId
        || document?.commercialRequestFingerprint !== context.requestFingerprint
      ) throw new CommercialOperationDocumentConflictError();
      return {
        documentCollection: context.request.target.collection,
        documentId: context.documentId,
        replayed: true,
      };
    }

    const { id: _ignoredId, ...legacyDocument } = context.request.document;
    tx.create(documentRef, stripUndefined({
      ...legacyDocument,
      businessId: context.request.businessId,
      commercialSchemaVersion: 2,
      commercialOperationId: context.operationId,
      commercialRequestFingerprint: context.requestFingerprint,
      commercialOperationStatus: 'document_persisted',
      commercialEffectIds: context.effectIds,
      ...(stock ? {
        stockOperationId: stock.stockOperationId,
        stockMovementIds: stock.movementIds,
        commercialStockAdjustments: stock.adjustments,
      } : {}),
      updatedAt: now.toISOString(),
    }));
    return {
      documentCollection: context.request.target.collection,
      documentId: context.documentId,
      replayed: false,
    };
  });
}

async function patchCommercialDocumentEffects(params: {
  context: CommercialOperationHandlerContext;
  leaseToken: string;
  effects: ReturnType<typeof mergeStepEffects>;
  now: Date;
}): Promise<void> {
  const operationRef = params.context.db.collection('commercialOperations').doc(params.context.operationId);
  const documentRef = params.context.db.collection(params.context.request.target.collection).doc(params.context.documentId);
  await params.context.db.runTransaction(async (tx) => {
    const operationSnapshot = await tx.get(operationRef);
    const documentSnapshot = await tx.get(documentRef);
    assertStoredOperation(operationSnapshot, params.context.operationId, params.leaseToken);
    if (!documentSnapshot.exists || documentSnapshot.data()?.businessId !== params.context.request.businessId) {
      throw new CommercialOperationDocumentConflictError();
    }
    tx.update(documentRef, stripUndefined({
      commercialEffects: params.effects,
      commercialOperationStatus: 'reconciled',
      updatedAt: params.now.toISOString(),
    }));
  });
}

async function ensureCompletionEvent(params: {
  context: CommercialOperationHandlerContext;
  leaseToken: string;
  stock?: CommercialStockEffect;
  effects: ReturnType<typeof mergeStepEffects>;
  now: Date;
}): Promise<{ eventId: string; replayed: boolean }> {
  const { context } = params;
  const operationRef = context.db.collection('commercialOperations').doc(context.operationId);
  const eventRef = context.db.collection('domainEvents').doc(context.effectIds.domainEventId);
  const event = DomainEventSchema.parse({
    type: 'commercial.operationCompleted',
    businessId: context.request.businessId,
    occurredAt: params.now.toISOString(),
    actorType: context.request.actor.type,
    actorId: context.request.actor.id,
    actorName: context.request.actor.name,
    operationId: context.operationId,
    sourceType: context.request.sourceType,
    sourceId: context.documentId,
    documentCollection: context.request.target.collection,
    documentId: context.documentId,
    totalCents: context.request.quote.pricing.totalCents,
    stockMovementIds: params.stock?.movementIds ?? [],
    transactionIds: params.effects.transactionIds,
  });
  return context.db.runTransaction(async (tx) => {
    const operationSnapshot = await tx.get(operationRef);
    const eventSnapshot = await tx.get(eventRef);
    assertStoredOperation(operationSnapshot, context.operationId, params.leaseToken);
    if (eventSnapshot.exists) {
      const stored = eventSnapshot.data();
      if (
        stored?.type !== 'commercial.operationCompleted'
        || stored?.businessId !== context.request.businessId
        || stored?.operationId !== context.operationId
        || stored?.documentId !== context.documentId
        || stored?.commercialRequestFingerprint !== context.requestFingerprint
      ) {
        throw new CommercialOperationIdempotencyConflictError();
      }
      return { eventId: eventRef.id, replayed: true };
    }
    tx.create(eventRef, {
      ...event,
      id: eventRef.id,
      idempotencyKey: `${context.operationId}:event:completed`,
      commercialRequestFingerprint: context.requestFingerprint,
      status: 'processed',
      handlerResults: [],
      createdAt: params.now.toISOString(),
      processedAt: params.now.toISOString(),
    });
    return { eventId: eventRef.id, replayed: false };
  });
}

async function finalizeOperation(params: {
  context: CommercialOperationHandlerContext;
  leaseToken: string;
  now: Date;
}): Promise<CommercialOperation> {
  const operationRef = params.context.db.collection('commercialOperations').doc(params.context.operationId);
  const documentRef = params.context.db.collection(params.context.request.target.collection).doc(params.context.documentId);
  return params.context.db.runTransaction(async (tx) => {
    const operationSnapshot = await tx.get(operationRef);
    const documentSnapshot = await tx.get(documentRef);
    const operation = assertStoredOperation(operationSnapshot, params.context.operationId, params.leaseToken);
    if (!documentSnapshot.exists || documentSnapshot.data()?.businessId !== params.context.request.businessId) {
      throw new CommercialOperationDocumentConflictError();
    }
    const stock = checkpointResult(operation, 'stock_applied')
      ? CommercialStockEffectSchema.parse(checkpointResult(operation, 'stock_applied'))
      : undefined;
    const event = checkpointResult(operation, 'event_enqueued') as { eventId?: unknown } | undefined;
    const eventId = typeof event?.eventId === 'string' ? event.eventId : params.context.effectIds.domainEventId;
    const completedAt = params.now.toISOString();
    const result = CommercialOperationResultSchema.parse({
      operationId: operation.operationId,
      documentCollection: params.context.request.target.collection,
      documentId: params.context.documentId,
      ...(stock ? { stockOperationId: stock.stockOperationId } : {}),
      effects: mergeStepEffects(operation, stock),
      domainEventId: eventId,
      completedAt,
    });
    const finalCheckpoint = operation.checkpoints.operation_completed;
    const completed = CommercialOperationSchema.parse({
      ...operation,
      status: 'completed',
      currentCheckpoint: null,
      lease: null,
      checkpoints: {
        ...operation.checkpoints,
        operation_completed: {
          status: 'completed',
          attempts: finalCheckpoint.attempts,
          startedAt: finalCheckpoint.startedAt ?? completedAt,
          completedAt,
          result,
        },
      },
      result,
      completedAt,
      updatedAt: completedAt,
    });
    tx.update(documentRef, {
      commercialOperationStatus: 'completed',
      commercialEventId: eventId,
      commercialEffects: result.effects,
      updatedAt: completedAt,
    });
    tx.set(operationRef, stripUndefined(completed));
    return completed;
  });
}

export async function ensureCommercialEffectDocumentAdmin(params: {
  db: Firestore;
  collection: CommercialEffectCollection;
  documentId: string;
  businessId: string;
  operationId: string;
  data: Record<string, unknown>;
  now?: Date;
}): Promise<{ documentId: string; replayed: boolean }> {
  const ref = params.db.collection(params.collection).doc(params.documentId);
  const fingerprint = hash(JSON.stringify(stableValue(params.data)));
  return params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) {
      const stored = snapshot.data();
      if (
        stored?.businessId !== params.businessId
        || stored?.commercialOperationId !== params.operationId
        || stored?.commercialEffectFingerprint !== fingerprint
      ) throw new CommercialOperationIdempotencyConflictError();
      return { documentId: ref.id, replayed: true };
    }
    tx.create(ref, stripUndefined({
      ...params.data,
      businessId: params.businessId,
      commercialOperationId: params.operationId,
      commercialEffectFingerprint: fingerprint,
      createdAt: params.data.createdAt ?? (params.now ?? new Date()).toISOString(),
    }));
    return { documentId: ref.id, replayed: false };
  });
}

export async function runCommercialOperationAdmin({
  db,
  request: rawRequest,
  handlers = {},
  faults,
  now: nowFactory = () => new Date(),
  leaseMs = DEFAULT_LEASE_MS,
  leaseTokenFactory = randomUUID,
  failurePolicy,
}: RunCommercialOperationAdminInput): Promise<RunCommercialOperationResult> {
  const identity = buildCommercialOperationIdentity(rawRequest);
  if (!identity.request.quote.availability.available) {
    // Um replay pode recalcular a disponibilidade depois que a própria operação
    // baixou o saldo. Nesse caso a intenção persistida vence; sem operação prévia,
    // a indisponibilidade continua sendo rejeitada antes de qualquer escrita.
    const existing = await db.collection('commercialOperations').doc(identity.operationId).get();
    if (!existing.exists) throw new CommercialOperationUnavailableError();
  }
  const reserveBenefitsHandler = handlers.reserveBenefits ?? reserveCommercialBenefitsAdmin;
  if (identity.request.benefits.length > 0 && !reserveBenefitsHandler) {
    throw new CommercialOperationConfigurationError('Benefícios exigem um handler idempotente de reserva.');
  }
  if ((identity.request.payments.length > 0 || identity.request.fiscalIntent) && !handlers.reconcileDownstream) {
    throw new CommercialOperationConfigurationError('Pagamentos ou intenção fiscal exigem um handler idempotente de reconciliação.');
  }

  const leaseToken = leaseTokenFactory();
  const claimed = await claimOperation({
    db,
    identity,
    leaseToken,
    now: nowFactory(),
    leaseMs,
  });
  if (claimed.replayed) {
    return { ...CommercialOperationResultSchema.parse(claimed.operation.result), replayed: true };
  }
  if (!claimed.operation.request.quote.availability.available) {
    await failCheckpoint({
      db,
      operationId: identity.operationId,
      leaseToken,
      checkpoint: 'input_validated',
      cause: new CommercialOperationUnavailableError(),
      now: nowFactory(),
      policy: 'retry',
    });
    throw new CommercialOperationUnavailableError();
  }

  // Em retomadas, a requisição persistida é a autoridade. Assim uma nova leitura
  // de catálogo/saldo não reconstrói os efeitos ou timestamps da intenção original.
  const executionRequest = claimed.operation.request;
  const executionEffectIds = claimed.operation.effectIds;
  const executionFingerprint = claimed.operation.requestFingerprint;

  writeStructuredOperationLog('info', {
    event: 'commercial.operation.claimed',
    businessId: executionRequest.businessId,
    correlationId: identity.operationId,
    operationId: identity.operationId,
    idempotencyKey: identity.request.idempotencyKey,
    status: 'running',
    details: { attempt: claimed.operation.attempts, sourceType: executionRequest.sourceType, channel: executionRequest.channel },
  });

  let operation = claimed.operation;
  const context: CommercialOperationHandlerContext = {
    db,
    operationId: identity.operationId,
    requestFingerprint: executionFingerprint,
    request: executionRequest,
    effectIds: executionEffectIds,
    documentId: executionEffectIds.documentId,
  };

  const execute = async <T>(
    checkpoint: CommercialOperationCheckpointName,
    effect: (() => Promise<T>) | null,
  ): Promise<T | undefined> => {
    const started = await startCheckpoint({
      db,
      operationId: identity.operationId,
      leaseToken,
      checkpoint,
      now: nowFactory(),
      leaseMs,
    });
    operation = started.operation;
    if (!started.shouldRun) return checkpointResult(operation, checkpoint) as T | undefined;
    if (!effect) {
      operation = await finishCheckpoint({
        db, operationId: identity.operationId, leaseToken, checkpoint,
        now: nowFactory(), leaseMs, status: 'skipped',
      });
      return undefined;
    }
    try {
      writeStructuredOperationLog('info', {
        event: 'commercial.checkpoint.started',
        businessId: executionRequest.businessId,
        correlationId: identity.operationId,
        operationId: identity.operationId,
        idempotencyKey: identity.request.idempotencyKey,
        status: checkpoint,
      });
      const result = await effect();
      await faults?.afterCheckpointEffect?.(checkpoint, identity.operationId);
      operation = await finishCheckpoint({
        db, operationId: identity.operationId, leaseToken, checkpoint,
        now: nowFactory(), leaseMs, status: 'completed', result,
      });
      writeStructuredOperationLog('info', {
        event: 'commercial.checkpoint.completed',
        businessId: executionRequest.businessId,
        correlationId: identity.operationId,
        operationId: identity.operationId,
        idempotencyKey: identity.request.idempotencyKey,
        status: checkpoint,
      });
      return result;
    } catch (cause) {
      const policy = failurePolicy?.(cause, checkpoint) ?? defaultFailurePolicy(cause);
      await failCheckpoint({
        db, operationId: identity.operationId, leaseToken, checkpoint,
        cause, now: nowFactory(), policy,
      });
      writeStructuredOperationLog('error', {
        event: 'commercial.checkpoint.failed',
        businessId: executionRequest.businessId,
        correlationId: identity.operationId,
        operationId: identity.operationId,
        idempotencyKey: identity.request.idempotencyKey,
        status: checkpoint,
        details: { code: errorCode(cause), retryable: policy === 'retry' },
      });
      throw cause;
    }
  };

  await execute('benefits_reserved', executionRequest.benefits.length
    ? async () => CommercialOperationStepEffectsSchema.parse(await reserveBenefitsHandler(context) ?? {})
    : null);

  const stockLines = commercialStockLines(executionRequest);
  const stock = await execute('stock_applied', stockLines.length
    ? async () => applyCommercialStock(context)
    : null) as CommercialStockEffect | undefined;

  await execute('document_persisted', async () => persistCommercialDocument({
    context,
    leaseToken,
    stock,
    now: nowFactory(),
  }));

  await execute('downstream_reconciled', async () => {
    const benefitEffects = (executionRequest.benefits.length && !handlers.reserveBenefits)
      ? await confirmCommercialBenefitsAdmin(context)
      : {};
    const downstreamCustom = await handlers.reconcileDownstream?.({ ...context, stock }) ?? {};
    const downstream = CommercialOperationStepEffectsSchema.parse({
      couponRedemptionIds: [
        ...(benefitEffects.couponRedemptionIds ?? []),
        ...(downstreamCustom.couponRedemptionIds ?? []),
      ],
      giftCardRedemptionIds: [
        ...(benefitEffects.giftCardRedemptionIds ?? []),
        ...(downstreamCustom.giftCardRedemptionIds ?? []),
      ],
      loyaltyTransactionIds: [
        ...(benefitEffects.loyaltyTransactionIds ?? []),
        ...(downstreamCustom.loyaltyTransactionIds ?? []),
      ],
      transactionIds: [
        ...(benefitEffects.transactionIds ?? []),
        ...(downstreamCustom.transactionIds ?? []),
      ],
      fiscalDocumentIds: [
        ...(benefitEffects.fiscalDocumentIds ?? []),
        ...(downstreamCustom.fiscalDocumentIds ?? []),
      ],
    });
    const preview = {
      ...operation,
      checkpoints: {
        ...operation.checkpoints,
        downstream_reconciled: {
          ...operation.checkpoints.downstream_reconciled,
          result: downstream,
        },
      },
    } as CommercialOperation;
    await patchCommercialDocumentEffects({
      context,
      leaseToken,
      effects: mergeStepEffects(preview, stock),
      now: nowFactory(),
    });
    return downstream;
  });

  const effects = mergeStepEffects(operation, stock);
  await execute('event_enqueued', async () => ensureCompletionEvent({
    context,
    leaseToken,
    stock,
    effects,
    now: nowFactory(),
  }));

  try {
    const started = await startCheckpoint({
      db, operationId: identity.operationId, leaseToken,
      checkpoint: 'operation_completed', now: nowFactory(), leaseMs,
    });
    operation = started.operation;
    if (!started.shouldRun && operation.result) {
      return { ...operation.result, replayed: false };
    }
    operation = await finalizeOperation({ context, leaseToken, now: nowFactory() });
  } catch (cause) {
    const policy = failurePolicy?.(cause, 'operation_completed') ?? defaultFailurePolicy(cause);
    await failCheckpoint({
      db, operationId: identity.operationId, leaseToken,
      checkpoint: 'operation_completed', cause, now: nowFactory(), policy,
    });
    throw cause;
  }

  writeStructuredOperationLog('info', {
    event: 'commercial.operation.completed',
    businessId: executionRequest.businessId,
    correlationId: identity.operationId,
    operationId: identity.operationId,
    idempotencyKey: identity.request.idempotencyKey,
    status: 'completed',
    details: { documentCollection: executionRequest.target.collection, documentId: executionEffectIds.documentId },
  });
  return { ...CommercialOperationResultSchema.parse(operation.result), replayed: false };
}

export async function requestCommercialOperationCompensationAdmin(params: {
  db: Firestore;
  businessId: string;
  operationId: string;
  reason: string;
  actor: CommercialOperationRequest['actor'];
  now?: Date;
}): Promise<{ operation: CommercialOperation; replayed: boolean }> {
  if (params.reason.trim().length < 5 || params.reason.length > 1000) {
    throw new CommercialOperationError('COMMERCIAL_COMPENSATION_REASON_INVALID', 'Informe um motivo de compensação válido.');
  }
  const ref = params.db.collection('commercialOperations').doc(params.operationId);
  const now = params.now ?? new Date();
  const result = await params.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new CommercialOperationError('COMMERCIAL_OPERATION_NOT_FOUND', 'Operação comercial não encontrada.');
    const operation = CommercialOperationSchema.parse({ ...snapshot.data(), operationId: snapshot.id });
    if (operation.businessId !== params.businessId) {
      throw new CommercialOperationError('TENANT_MISMATCH', 'A operação comercial pertence a outro negócio.');
    }
    if (operation.compensation.status === 'pending' || operation.compensation.status === 'in_progress') {
      return { operation, replayed: true };
    }
    if (operation.compensation.status === 'completed') {
      return { operation, replayed: true };
    }
    if (operation.lease && Date.parse(operation.lease.expiresAt) > now.getTime()) {
      throw new CommercialOperationInProgressError(operation.operationId);
    }
    const updated = CommercialOperationSchema.parse({
      ...operation,
      status: 'compensation_pending',
      lease: null,
      compensation: {
        status: 'pending',
        reason: params.reason.trim(),
        requestedAt: now.toISOString(),
        requestedBy: params.actor,
      },
      updatedAt: now.toISOString(),
    });
    tx.set(ref, stripUndefined(updated));
    return { operation: updated, replayed: false };
  });
  writeStructuredOperationLog('warn', {
    event: 'commercial.compensation.requested',
    businessId: params.businessId,
    correlationId: params.operationId,
    operationId: params.operationId,
    status: result.operation.compensation.status,
  });
  return result;
}
