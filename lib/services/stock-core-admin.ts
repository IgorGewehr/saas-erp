/**
 * Núcleo autoritativo de estoque (Admin SDK).
 *
 * Uma única transação:
 * - fecha a idempotência da operação;
 * - lê e valida todos os produtos pelo businessId;
 * - expande BOM quando solicitado;
 * - calcula previousStock/newStock exatos;
 * - atualiza products e grava o ledger stockMovements V2.
 *
 * Este módulo não conhece UI nem rotas. Callers traduzem venda, pedido,
 * compra, serviço ou ajuste manual para StockOperationInput.
 */

import { createHash } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { writeStructuredOperationLog } from '@/lib/services/structured-operation-log';
import { expandBomLines, type BomProductLite } from '@/contracts/_runtime/bom';
import { StockLotEntrySchema, type StockLotAllocation, type StockLotDocument, type StockLotEntry } from '@/lib/contracts/domain/stockLot';
import type { Product, StockAlert } from '@/lib/types';

export type StockOperationType = 'entrada' | 'saida' | 'ajuste' | 'restauracao';

export type StockSourceType =
  | 'manual'
  | 'sale'
  | 'order'
  | 'purchase'
  | 'service'
  | 'refund'
  | 'agent'
  | 'api'
  | 'migration';

export interface StockOperationLine {
  productId: string;
  variantId?: string;
  /**
   * entrada/saida/restauracao: magnitude positiva.
   * ajuste: delta assinado (positivo ou negativo).
   */
  quantity: number;
  sourceLineId?: string;
  /** Custo de aquisição por unidade de estoque. Exclusivo para entrada sem expansão de BOM. */
  unitCost?: number;
  /** Pré-condição de saldo usada por reversões seguras. */
  expectedCurrentStock?: number;
  /** Restauração auditável de custo usada por movimento compensatório. */
  costRestoration?: { expectedCurrentCost: number; targetCost: number };
  /** Movimento de entrada compensado por esta linha. */
  reversalOfMovementId?: string;
  /** Lote existente para saída ou ajuste explícito. */
  lotId?: string;
  /** Metadados do lote criado/incrementado por uma entrada. */
  lot?: StockLotEntry;
}

export type StockSourceCollection =
  | 'sales'
  | 'deliveryOrders'
  | 'orders'
  | 'purchaseNotes'
  | 'appointments'
  | 'services';

export interface StockSourceDocument {
  collection: StockSourceCollection;
  id: string;
  /** `required` falha se a origem ainda não existir; `if-present` só valida o tenant se existir. */
  existence?: 'required' | 'if-present';
}

export interface StockOperationInput {
  businessId: string;
  type: StockOperationType;
  lines: StockOperationLine[];
  operatorId: string;
  operatorName: string;
  reason: string;
  sourceType: StockSourceType;
  sourceId?: string;
  sourceDocument?: StockSourceDocument;
  /** Obrigatória e estável por evento de negócio. */
  idempotencyKey: string;
  /** Default true. Ajuste manual deve usar false para atuar no SKU selecionado. */
  expandBom?: boolean;
  /** Default delta. `absolute` existe apenas para compatibilidade com a API v1. */
  adjustmentMode?: 'delta' | 'absolute';
  /** Default allow, para compatibilidade. Novos fluxos críticos devem usar prevent. */
  negativeStockPolicy?: 'allow' | 'prevent';
  /** Quando true, rejeita produto arquivado dentro da mesma transação do saldo. */
  requireActiveProducts?: boolean;
  /** Quando true, rejeita produto/variação configurado para não controlar estoque. */
  requireTrackedProducts?: boolean;
  /** Compatibilidade gradual: impede negativo apenas nas linhas selecionadas. */
  strictProductIds?: ReadonlySet<string>;
}

export interface StockOperationAdjustment {
  productId: string;
  variantId?: string;
  productName: string;
  movementId: string;
  delta: number;
  previousStock: number;
  newStock: number;
  unitCost?: number;
  previousCost?: number;
  newCost?: number;
  lotAllocations?: StockLotAllocation[];
  alert?: StockAlert;
}

export interface StockOperationResult {
  operationId: string;
  adjustments: StockOperationAdjustment[];
  replayed: boolean;
}

interface StoredStockOperationResult {
  operationId: string;
  adjustments: StockOperationAdjustment[];
}

interface AggregatedLine {
  productId: string;
  variantId?: string;
  quantity: number;
  sourceLineIds: Set<string>;
  strict: boolean;
  incomingCostTotal: number;
  costedQuantity: number;
  expectedCurrentStock?: number;
  costRestoration?: { expectedCurrentCost: number; targetCost: number };
  reversalOfMovementId?: string;
  lotIntents: Array<{
    quantity: number;
    sourceLineId?: string;
    unitCost?: number;
    lotId?: string;
    lot?: StockLotEntry;
  }>;
}

export class InvalidStockOperationError extends Error {
  readonly code = 'INVALID_STOCK_OPERATION' as const;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStockOperationError';
  }
}

export class StockReferenceError extends Error {
  readonly code = 'STOCK_REFERENCE_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'StockReferenceError';
  }
}

export class StockIdempotencyConflictError extends Error {
  readonly code = 'STOCK_IDEMPOTENCY_CONFLICT' as const;
  constructor(public readonly idempotencyKey: string) {
    super('A chave de idempotência já foi usada por outra operação de estoque.');
    this.name = 'StockIdempotencyConflictError';
  }
}

export class StockDependencyConflictError extends Error {
  readonly code = 'STOCK_DEPENDENCY_CONFLICT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'StockDependencyConflictError';
  }
}

export class StockLotConflictError extends Error {
  readonly code = 'STOCK_LOT_CONFLICT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'StockLotConflictError';
  }
}

export interface StockShortage {
  productId: string;
  variantId?: string;
  productName: string;
  requested: number;
  available: number;
}

export class InsufficientStockError extends Error {
  readonly code = 'INSUFFICIENT_STOCK' as const;
  constructor(public readonly shortages: StockShortage[]) {
    super(
      'Estoque insuficiente: ' +
        shortages
          .map((item) => `${item.productName} (disponível: ${item.available}, solicitado: ${item.requested})`)
          .join(', '),
    );
    this.name = 'InsufficientStockError';
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function roundStock(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function roundCost(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function normalizeLotCode(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
}

function stockLotId(businessId: string, productId: string, variantId: string | undefined, code: string): string {
  return `stocklot_${hash(`${businessId}:${productId}:${variantId ?? ''}:${normalizeLotCode(code)}`).slice(0, 40)}`;
}

function brazilDateOnly(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = new Map(parts.map((part) => [part.type, part.value]));
  return `${value.get('year')}-${value.get('month')}-${value.get('day')}`;
}

function validateInput(input: StockOperationInput): void {
  if (!input.businessId.trim()) throw new InvalidStockOperationError('businessId é obrigatório.');
  if (!input.operatorId.trim()) throw new InvalidStockOperationError('operatorId é obrigatório.');
  if (!input.operatorName.trim()) throw new InvalidStockOperationError('operatorName é obrigatório.');
  if (!input.reason.trim() || input.reason.length > 500) {
    throw new InvalidStockOperationError('reason deve ter entre 1 e 500 caracteres.');
  }
  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 300) {
    throw new InvalidStockOperationError('idempotencyKey deve ter entre 1 e 300 caracteres.');
  }
  if (!input.lines.length) throw new InvalidStockOperationError('A operação exige ao menos uma linha.');
  if (input.type === 'ajuste' && input.expandBom !== false) {
    throw new InvalidStockOperationError('Ajuste manual exige expandBom=false.');
  }
  if (!['manual', 'migration'].includes(input.sourceType) && !input.sourceId) {
    throw new InvalidStockOperationError(`${input.sourceType} exige sourceId.`);
  }
  if (input.sourceDocument && input.sourceId && input.sourceDocument.id !== input.sourceId) {
    throw new InvalidStockOperationError('sourceDocument.id deve ser igual a sourceId.');
  }

  for (const [index, line] of input.lines.entries()) {
    if (!line.productId?.trim()) {
      throw new InvalidStockOperationError(`lines[${index}].productId é obrigatório.`);
    }
    if (!Number.isFinite(line.quantity)) {
      throw new InvalidStockOperationError(`lines[${index}].quantity deve ser um número finito.`);
    }
    if (input.type === 'ajuste' && input.adjustmentMode !== 'absolute' && line.quantity === 0) {
      throw new InvalidStockOperationError(`lines[${index}].quantity deve ser diferente de zero.`);
    }
    if (input.type !== 'ajuste' && line.quantity <= 0) {
      throw new InvalidStockOperationError(`lines[${index}].quantity deve ser positiva.`);
    }
    if (line.unitCost !== undefined && (!Number.isFinite(line.unitCost) || line.unitCost < 0)) {
      throw new InvalidStockOperationError(`lines[${index}].unitCost deve ser um número não negativo.`);
    }
    if (line.unitCost !== undefined && (input.type !== 'entrada' || input.expandBom !== false)) {
      throw new InvalidStockOperationError('unitCost só pode ser usado em entrada com expandBom=false.');
    }
    if (line.expectedCurrentStock !== undefined && !Number.isFinite(line.expectedCurrentStock)) {
      throw new InvalidStockOperationError(`lines[${index}].expectedCurrentStock deve ser finito.`);
    }
    if (line.costRestoration && (
      !Number.isFinite(line.costRestoration.expectedCurrentCost) || line.costRestoration.expectedCurrentCost < 0 ||
      !Number.isFinite(line.costRestoration.targetCost) || line.costRestoration.targetCost < 0
    )) {
      throw new InvalidStockOperationError(`lines[${index}].costRestoration possui custo inválido.`);
    }
    if ((line.expectedCurrentStock !== undefined || line.costRestoration || line.reversalOfMovementId) && (
      input.type !== 'saida' || input.expandBom !== false || input.lines.length !== 1
    )) {
      throw new InvalidStockOperationError('Pré-condições de reversão exigem uma única saída com expandBom=false.');
    }
    if (line.lot && line.lotId) {
      throw new InvalidStockOperationError(`lines[${index}] deve informar lot ou lotId, não ambos.`);
    }
    if (line.lot) {
      const parsedLot = StockLotEntrySchema.safeParse(line.lot);
      if (!parsedLot.success) {
        throw new InvalidStockOperationError(`lines[${index}].lot inválido: ${parsedLot.error.issues[0]?.message ?? 'dados inválidos'}.`);
      }
      if (input.type !== 'entrada') {
        throw new InvalidStockOperationError(`lines[${index}].lot só pode ser usado em entrada.`);
      }
    }
    if (line.lotId && input.type === 'entrada') {
      throw new InvalidStockOperationError(`lines[${index}].lotId não pode ser usado em entrada.`);
    }
  }
}

function fingerprint(input: StockOperationInput): string {
  const lines = input.lines
    .map((line) => ({
      productId: line.productId,
      variantId: line.variantId ?? '',
      quantity: roundStock(line.quantity),
      sourceLineId: line.sourceLineId ?? '',
      unitCost: line.unitCost === undefined ? null : roundCost(line.unitCost),
      expectedCurrentStock: line.expectedCurrentStock === undefined ? null : roundStock(line.expectedCurrentStock),
      costRestoration: line.costRestoration ? {
        expectedCurrentCost: roundCost(line.costRestoration.expectedCurrentCost),
        targetCost: roundCost(line.costRestoration.targetCost),
      } : null,
      reversalOfMovementId: line.reversalOfMovementId ?? '',
      lotId: line.lotId ?? '',
      lot: line.lot ? {
        ...line.lot,
        code: normalizeLotCode(line.lot.code),
      } : null,
    }))
    .sort((a, b) =>
      `${a.productId}:${a.variantId}:${a.sourceLineId}:${a.quantity}`.localeCompare(
        `${b.productId}:${b.variantId}:${b.sourceLineId}:${b.quantity}`,
      ),
    );
  return hash(JSON.stringify({
    businessId: input.businessId,
    type: input.type,
    lines,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? '',
    sourceDocument: input.sourceDocument ?? null,
    expandBom: input.expandBom !== false,
    adjustmentMode: input.adjustmentMode ?? 'delta',
    negativeStockPolicy: input.negativeStockPolicy ?? 'allow',
    requireActiveProducts: input.requireActiveProducts === true,
    requireTrackedProducts: input.requireTrackedProducts === true,
    strictProductIds: [...(input.strictProductIds ?? [])].sort(),
  }));
}

function detectStockCrossing(
  product: Pick<Product, 'id' | 'name' | 'minStock'>,
  previousStock: number,
  newStock: number,
  variantId?: string,
): StockAlert | undefined {
  const minStock = product.minStock ?? 0;
  if (minStock <= 0 || newStock >= previousStock) return undefined;
  if (previousStock > minStock && newStock <= minStock) {
    return {
      productId: product.id,
      ...(variantId ? { variantId } : {}),
      productName: product.name,
      previousStock,
      newStock,
      minStock,
      severity: newStock <= 0 ? 'zeroed' : 'min',
    };
  }
  return undefined;
}

function sourceAliases(sourceType: StockSourceType, sourceId?: string): Record<string, string> {
  if (!sourceId) return {};
  switch (sourceType) {
    case 'sale':
      return { saleId: sourceId };
    case 'order':
    case 'refund':
      return { orderId: sourceId };
    case 'purchase':
      return { purchaseId: sourceId };
    case 'service':
      return { appointmentId: sourceId };
    default:
      return {};
  }
}

function aggregateLines(
  input: StockOperationInput,
  productIndex: Map<string, Product>,
): AggregatedLine[] {
  const bucket = new Map<string, AggregatedLine>();
  const shouldExpand = input.expandBom !== false;

  for (const sourceLine of input.lines) {
    const expanded = shouldExpand && !sourceLine.variantId
      ? expandBomLines(
          [{ productId: sourceLine.productId, quantity: sourceLine.quantity }],
          productIndex as unknown as Map<string, BomProductLite>,
        )
      : [{
          productId: sourceLine.productId,
          ...(sourceLine.variantId ? { variantId: sourceLine.variantId } : {}),
          quantity: sourceLine.quantity,
        }];

    for (const line of expanded) {
      const key = `${line.productId}:${'variantId' in line ? line.variantId ?? '' : ''}`;
      const current = bucket.get(key) ?? {
        productId: line.productId,
        ...('variantId' in line && line.variantId ? { variantId: line.variantId } : {}),
        quantity: 0,
        sourceLineIds: new Set<string>(),
        strict: false,
        incomingCostTotal: 0,
        costedQuantity: 0,
        expectedCurrentStock: sourceLine.expectedCurrentStock,
        costRestoration: sourceLine.costRestoration,
        reversalOfMovementId: sourceLine.reversalOfMovementId,
        lotIntents: [],
      };
      current.quantity = roundStock(current.quantity + line.quantity);
      if (sourceLine.unitCost !== undefined) {
        current.incomingCostTotal += line.quantity * sourceLine.unitCost;
        current.costedQuantity = roundStock(current.costedQuantity + line.quantity);
      }
      if (sourceLine.sourceLineId) current.sourceLineIds.add(sourceLine.sourceLineId);
      current.strict = current.strict ||
        input.strictProductIds?.has(sourceLine.productId) === true ||
        input.strictProductIds?.has(line.productId) === true;
      const targetsSource = line.productId === sourceLine.productId
        && (('variantId' in line ? line.variantId : undefined) ?? '') === (sourceLine.variantId ?? '');
      if (targetsSource) {
        current.lotIntents.push({
          quantity: line.quantity,
          ...(sourceLine.sourceLineId ? { sourceLineId: sourceLine.sourceLineId } : {}),
          ...(sourceLine.unitCost !== undefined ? { unitCost: sourceLine.unitCost } : {}),
          ...(sourceLine.lotId ? { lotId: sourceLine.lotId } : {}),
          ...(sourceLine.lot ? { lot: StockLotEntrySchema.parse(sourceLine.lot) } : {}),
        });
      }
      bucket.set(key, current);
    }
  }

  return [...bucket.values()].sort((a, b) =>
    `${a.productId}:${a.variantId ?? ''}`.localeCompare(`${b.productId}:${b.variantId ?? ''}`),
  );
}

function movementType(type: StockOperationType): 'entrada' | 'saida' | 'ajuste' {
  if (type === 'restauracao') return 'entrada';
  return type;
}

function deltaFor(
  type: StockOperationType,
  quantity: number,
  previousStock: number,
  adjustmentMode: 'delta' | 'absolute',
): number {
  if (type === 'saida') return -Math.abs(quantity);
  if (type === 'ajuste') return adjustmentMode === 'absolute' ? quantity - previousStock : quantity;
  return Math.abs(quantity);
}

/** Executa uma operação completa de estoque em uma única transação Firestore. */
export async function applyStockOperationAdmin(
  db: Firestore,
  input: StockOperationInput,
): Promise<StockOperationResult> {
  validateInput(input);

  const operationHash = hash(`${input.businessId}:${input.idempotencyKey}`);
  const operationId = `stockop_${operationHash}`;
  const operationRef = db.collection('stockOperations').doc(operationId);
  const requestFingerprint = fingerprint(input);

  const result = await db.runTransaction(async (tx): Promise<StockOperationResult> => {
    const operationSnap = await tx.get(operationRef);
    if (operationSnap.exists) {
      const stored = operationSnap.data() as {
        businessId?: string;
        fingerprint?: string;
        result?: StoredStockOperationResult;
      };
      if (stored.businessId !== input.businessId || stored.fingerprint !== requestFingerprint || !stored.result) {
        throw new StockIdempotencyConflictError(input.idempotencyKey);
      }
      return { ...stored.result, replayed: true };
    }

    // Primeira leitura: produtos diretamente referenciados pelas linhas.
    const baseIds = [...new Set(input.lines.map((line) => line.productId))];
    const productIndex = new Map<string, Product>();
    for (const productId of baseIds) {
      const snap = await tx.get(db.collection('products').doc(productId));
      if (!snap.exists) throw new StockReferenceError(`Produto não encontrado: ${productId}.`);
      const data = snap.data() as Product;
      if (data.businessId !== input.businessId) {
        throw new StockReferenceError(`Produto ${productId} pertence a outro negócio.`);
      }
      if (input.requireActiveProducts && data.isActive === false) {
        throw new StockReferenceError(`Produto inativo: ${productId}.`);
      }
      productIndex.set(productId, { ...data, id: snap.id });
    }

    // Segunda leitura: folhas de BOM. Também são validadas pelo tenant dentro da tx.
    const componentIds = input.expandBom === false
      ? []
      : [...new Set(baseIds.flatMap((id) =>
          (productIndex.get(id)?.components ?? []).map((component) => component.productId),
        ))].filter((id) => !productIndex.has(id));
    for (const productId of componentIds) {
      const snap = await tx.get(db.collection('products').doc(productId));
      if (!snap.exists) throw new StockReferenceError(`Componente de BOM não encontrado: ${productId}.`);
      const data = snap.data() as Product;
      if (data.businessId !== input.businessId) {
        throw new StockReferenceError(`Componente ${productId} pertence a outro negócio.`);
      }
      productIndex.set(productId, { ...data, id: snap.id });
    }

    if (input.sourceDocument) {
      const sourceSnap = await tx.get(
        db.collection(input.sourceDocument.collection).doc(input.sourceDocument.id),
      );
      if (!sourceSnap.exists && input.sourceDocument.existence === 'required') {
        throw new StockReferenceError(`Documento de origem não encontrado: ${input.sourceDocument.id}.`);
      }
      if (sourceSnap.exists && sourceSnap.data()?.businessId !== input.businessId) {
        throw new StockReferenceError('O documento de origem pertence a outro negócio.');
      }
    }

    const aggregated = aggregateLines(input, productIndex);
    if (!aggregated.length) throw new InvalidStockOperationError('Nenhuma linha de estoque foi produzida.');

    const reads = aggregated.map((line) => {
      const product = productIndex.get(line.productId);
      if (!product) throw new StockReferenceError(`Produto expandido não encontrado: ${line.productId}.`);
      const variant = line.variantId
        ? product.variants?.find((item) => item.id === line.variantId)
        : undefined;
      if (line.variantId && !variant) {
        throw new StockReferenceError(`Variação não encontrada: ${product.name}/${line.variantId}.`);
      }
      if (variant && variant.isActive === false) {
        throw new StockReferenceError(`Variação inativa: ${product.name}/${variant.name}.`);
      }
      const productName = variant ? `${product.name} — ${variant.name}` : product.name;
      if (input.requireTrackedProducts && (variant ? variant.trackStock === false : product.trackStock === false)) {
        throw new StockReferenceError(`Controle de estoque desativado: ${productName}.`);
      }
      const previousStock = variant
        ? (Number.isFinite(variant.currentStock) ? variant.currentStock : 0)
        : (Number.isFinite(product.currentStock) ? product.currentStock : 0);
      if (line.expectedCurrentStock !== undefined && Math.abs(previousStock - line.expectedCurrentStock) > 1e-6) {
        throw new StockDependencyConflictError(`O saldo de ${productName} mudou após a compra.`);
      }
      const previousCost = variant
        ? (Number.isFinite(variant.costPrice) ? variant.costPrice : 0)
        : (Number.isFinite(product.costPrice) ? product.costPrice : 0);
      if (line.costRestoration && Math.abs(previousCost - line.costRestoration.expectedCurrentCost) > 0.0001) {
        throw new StockDependencyConflictError(`O custo de ${productName} mudou após a compra.`);
      }
      const delta = roundStock(deltaFor(
        input.type,
        line.quantity,
        previousStock,
        input.adjustmentMode ?? 'delta',
      ));
      const newStock = roundStock(previousStock + delta);
      const minStock = variant?.minStock ?? product.minStock ?? 0;
      const unitCost = line.costedQuantity > 0 && Math.abs(line.costedQuantity - line.quantity) <= 1e-6
        ? roundCost(line.incomingCostTotal / line.costedQuantity)
        : undefined;
      const newCost = line.costRestoration
        ? roundCost(line.costRestoration.targetCost)
        : unitCost === undefined ? previousCost
        : roundCost(previousStock > 0 && newStock > 0
          ? ((previousStock * previousCost) + (delta * unitCost)) / newStock
          : unitCost);
      const changesCost = unitCost !== undefined || Boolean(line.costRestoration);
      return { line, product, variant, productName, minStock, previousStock, delta, newStock, unitCost, previousCost, newCost, changesCost };
    });

    const effectiveReads = reads.filter(({ delta }) => delta !== 0);
    if (!effectiveReads.length) {
      throw new InvalidStockOperationError('A operação não altera o saldo atual.');
    }
    const shortages = effectiveReads
      .filter(({ line, newStock }) =>
        newStock < 0 &&
        (input.negativeStockPolicy === 'prevent' || line.strict),
      )
      .map(({ line, product, productName, previousStock, delta }) => ({
        productId: product.id,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        productName,
        requested: Math.abs(delta),
        available: previousStock,
      }));
    if (shortages.length) throw new InsufficientStockError(shortages);

    const now = new Date().toISOString();
    const today = brazilDateOnly();
    const lotAllocationsByTarget = new Map<string, StockLotAllocation[]>();
    const lotWrites = new Map<string, {
      ref: FirebaseFirestore.DocumentReference;
      data: StockLotDocument;
    }>();

    for (const { line, product, productName, delta } of effectiveReads) {
      if (product.trackLots !== true) continue;
      if (product.kind === 'composite') {
        throw new StockLotConflictError(`Produto composto ${productName} deve controlar lotes pelos componentes.`);
      }
      const targetKey = `${product.id}:${line.variantId ?? ''}`;
      const allocations: StockLotAllocation[] = [];

      if (input.type === 'entrada' || input.type === 'restauracao') {
        if (input.type === 'restauracao') {
          if (!input.sourceId) {
            throw new StockLotConflictError(`A restauração de ${productName} exige a origem da baixa original.`);
          }
          const originalSourceType = input.sourceDocument?.collection === 'sales'
            ? 'sale'
            : input.sourceDocument?.collection === 'deliveryOrders'
              ? 'order'
              : undefined;
          const movementQuery = db.collection('stockMovements')
            .where('businessId', '==', input.businessId)
            .where('sourceId', '==', input.sourceId);
          const movementSnapshot = await tx.get(movementQuery);
          const originalAllocations = movementSnapshot.docs
            .map((doc) => ({ ...doc.data(), id: doc.id }) as {
              id: string;
              businessId?: string;
              productId?: string;
              variantId?: string;
              sourceType?: string;
              type?: string;
              createdAt?: string;
              lotAllocations?: StockLotAllocation[];
            })
            .filter((movement) =>
              movement.businessId === input.businessId
              && movement.productId === product.id
              && (movement.variantId ?? '') === (line.variantId ?? '')
              && movement.type === 'saida'
              && (!originalSourceType || movement.sourceType === originalSourceType)
              && Array.isArray(movement.lotAllocations),
            )
            .sort((left, right) =>
              String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
              || left.id.localeCompare(right.id),
            )
            .flatMap((movement) => movement.lotAllocations ?? []);
          let remaining = Math.abs(delta);
          const restoreByLot = new Map<string, number>();
          const allocationMetadata = new Map<string, StockLotAllocation>();
          for (const allocation of originalAllocations) {
            if (remaining <= 0) break;
            const quantity = roundStock(Math.min(allocation.quantity, remaining));
            if (quantity <= 0) continue;
            restoreByLot.set(allocation.lotId, roundStock((restoreByLot.get(allocation.lotId) ?? 0) + quantity));
            allocationMetadata.set(allocation.lotId, allocation);
            remaining = roundStock(remaining - quantity);
          }
          if (remaining > 1e-6) {
            throw new StockLotConflictError(`A baixa original de ${productName} não possui lotes suficientes para restauração.`);
          }
          for (const [lotId, quantity] of restoreByLot) {
            const ref = db.collection('stockLots').doc(lotId);
            const snapshot = await tx.get(ref);
            if (!snapshot.exists) throw new StockLotConflictError(`O lote original de ${productName} não foi encontrado.`);
            const lot = snapshot.data() as StockLotDocument;
            if (
              lot.businessId !== input.businessId
              || lot.productId !== product.id
              || (lot.variantId ?? '') !== (line.variantId ?? '')
            ) {
              throw new StockLotConflictError(`O lote original de ${productName} pertence a outro saldo.`);
            }
            const nextQuantity = roundStock(lot.currentQuantity + quantity);
            lotWrites.set(lot.id, {
              ref,
              data: { ...lot, currentQuantity: nextQuantity, status: 'active', updatedAt: now },
            });
            const metadata = allocationMetadata.get(lotId)!;
            allocations.push({
              lotId,
              lotCode: lot.code ?? metadata.lotCode,
              quantity,
              ...(lot.expiresAt ? { expiresAt: lot.expiresAt } : {}),
            });
          }
          lotAllocationsByTarget.set(targetKey, allocations);
          continue;
        }
        const intents = line.lotIntents.filter((intent) => intent.quantity > 0);
        const describedQuantity = roundStock(intents.reduce((total, intent) => total + intent.quantity, 0));
        if (
          intents.length === 0
          || intents.some((intent) => !intent.lot)
          || Math.abs(describedQuantity - Math.abs(delta)) > 1e-6
        ) {
          throw new StockLotConflictError(`A entrada de ${productName} exige lote para toda a quantidade.`);
        }

        const grouped = new Map<string, {
          quantity: number;
          costTotal: number;
          costedQuantity: number;
          lot: StockLotEntry;
          sourceLineId?: string;
        }>();
        for (const intent of intents) {
          const lot = StockLotEntrySchema.parse(intent.lot);
          if (product.trackExpiry === true && !lot.expiresAt) {
            throw new StockLotConflictError(`A entrada de ${productName} exige data de validade.`);
          }
          const id = stockLotId(input.businessId, product.id, line.variantId, lot.code);
          const current = grouped.get(id);
          if (current && (
            current.lot.manufacturedAt !== lot.manufacturedAt
            || current.lot.expiresAt !== lot.expiresAt
          )) {
            throw new StockLotConflictError(`O lote ${lot.code} foi informado com datas divergentes na mesma operação.`);
          }
          grouped.set(id, {
            quantity: roundStock((current?.quantity ?? 0) + intent.quantity),
            costTotal: (current?.costTotal ?? 0) + (intent.unitCost === undefined ? 0 : intent.quantity * intent.unitCost),
            costedQuantity: roundStock((current?.costedQuantity ?? 0) + (intent.unitCost === undefined ? 0 : intent.quantity)),
            lot,
            sourceLineId: current?.sourceLineId ?? intent.sourceLineId,
          });
        }

        for (const [id, entry] of grouped) {
          const ref = db.collection('stockLots').doc(id);
          const snapshot = await tx.get(ref);
          const existing = snapshot.exists ? snapshot.data() as StockLotDocument : undefined;
          if (existing && (
            existing.businessId !== input.businessId
            || existing.productId !== product.id
            || (existing.variantId ?? '') !== (line.variantId ?? '')
          )) {
            throw new StockLotConflictError(`O lote ${entry.lot.code} pertence a outro saldo.`);
          }
          if (existing && (
            (existing.manufacturedAt && entry.lot.manufacturedAt && existing.manufacturedAt !== entry.lot.manufacturedAt)
            || (existing.expiresAt && entry.lot.expiresAt && existing.expiresAt !== entry.lot.expiresAt)
          )) {
            throw new StockLotConflictError(`O lote ${entry.lot.code} já existe com datas diferentes.`);
          }
          const previousQuantity = existing?.currentQuantity ?? 0;
          const nextQuantity = roundStock(previousQuantity + entry.quantity);
          const incomingUnitCost = entry.costedQuantity > 0
            ? roundCost(entry.costTotal / entry.costedQuantity)
            : undefined;
          const previousUnitCost = existing?.unitCost;
          const nextUnitCost = incomingUnitCost === undefined
            ? previousUnitCost
            : previousUnitCost !== undefined && previousQuantity > 0
              ? roundCost(((previousQuantity * previousUnitCost) + (entry.quantity * incomingUnitCost)) / nextQuantity)
              : incomingUnitCost;
          const purchaseNoteIds = [...new Set([
            ...(existing?.purchaseNoteIds ?? []),
            ...(input.sourceType === 'purchase' && input.sourceId ? [input.sourceId] : []),
          ])];
          const data: StockLotDocument = {
            id,
            schemaVersion: 1,
            businessId: input.businessId,
            productId: product.id,
            ...(line.variantId ? { variantId: line.variantId } : {}),
            productName,
            unit: product.unit,
            code: existing?.code ?? entry.lot.code.trim(),
            codeNormalized: normalizeLotCode(entry.lot.code),
            status: 'active',
            ...(existing?.manufacturedAt || entry.lot.manufacturedAt
              ? { manufacturedAt: existing?.manufacturedAt ?? entry.lot.manufacturedAt }
              : {}),
            ...(existing?.expiresAt || entry.lot.expiresAt
              ? { expiresAt: existing?.expiresAt ?? entry.lot.expiresAt }
              : {}),
            initialQuantity: roundStock((existing?.initialQuantity ?? 0) + entry.quantity),
            currentQuantity: nextQuantity,
            ...(nextUnitCost !== undefined ? { unitCost: nextUnitCost } : {}),
            expiryWarningDays: product.expiryWarningDays ?? 30,
            ...(existing?.supplierId || entry.lot.supplierId ? { supplierId: existing?.supplierId ?? entry.lot.supplierId } : {}),
            ...(existing?.supplierName || entry.lot.supplierName ? { supplierName: existing?.supplierName ?? entry.lot.supplierName } : {}),
            ...(existing?.supplierDocument || entry.lot.supplierDocument ? { supplierDocument: existing?.supplierDocument ?? entry.lot.supplierDocument } : {}),
            ...(purchaseNoteIds.length ? { purchaseNoteIds } : {}),
            ...(existing?.purchaseNoteNumber || entry.lot.purchaseNoteNumber
              ? { purchaseNoteNumber: existing?.purchaseNoteNumber ?? entry.lot.purchaseNoteNumber }
              : {}),
            ...(existing?.sourceLineId || entry.sourceLineId ? { sourceLineId: existing?.sourceLineId ?? entry.sourceLineId } : {}),
            createdBy: existing?.createdBy ?? input.operatorId,
            createdByName: existing?.createdByName ?? input.operatorName,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          lotWrites.set(id, { ref, data });
          allocations.push({
            lotId: id,
            lotCode: data.code,
            quantity: entry.quantity,
            ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
          });
        }
      } else {
        const query = db.collection('stockLots')
          .where('businessId', '==', input.businessId)
          .where('productId', '==', product.id);
        const snapshot = await tx.get(query);
        if (snapshot.docs.length > 450) {
          throw new StockLotConflictError(`O produto ${productName} excedeu o limite operacional de 450 lotes.`);
        }
        const lots = snapshot.docs
          .map((doc) => ({ ...doc.data(), id: doc.id }) as StockLotDocument)
          .filter((lot) => (lot.variantId ?? '') === (line.variantId ?? ''));
        const byId = new Map(lots.map((lot) => [lot.id, lot]));
        const plannedQuantity = new Map(lots.map((lot) => [lot.id, lot.currentQuantity]));
        const requested = Math.abs(delta);

        if (input.type === 'ajuste') {
          const lotIds = [...new Set(line.lotIntents.map((intent) => intent.lotId).filter(Boolean) as string[])];
          if (lotIds.length !== 1 || line.lotIntents.some((intent) => !intent.lotId)) {
            throw new StockLotConflictError(`O ajuste de ${productName} exige a seleção de um único lote.`);
          }
          const lot = byId.get(lotIds[0]);
          if (!lot) throw new StockLotConflictError(`Lote não encontrado para ${productName}.`);
          const nextQuantity = roundStock(lot.currentQuantity + delta);
          if (nextQuantity < 0) {
            throw new StockLotConflictError(`Saldo insuficiente no lote ${lot.code} de ${productName}.`);
          }
          lotWrites.set(lot.id, {
            ref: db.collection('stockLots').doc(lot.id),
            data: {
              ...lot,
              initialQuantity: delta > 0 ? roundStock(lot.initialQuantity + delta) : lot.initialQuantity,
              currentQuantity: nextQuantity,
              status: nextQuantity > 0 ? 'active' : 'depleted',
              updatedAt: now,
            },
          });
          allocations.push({
            lotId: lot.id,
            lotCode: lot.code,
            quantity: requested,
            ...(lot.expiresAt ? { expiresAt: lot.expiresAt } : {}),
          });
        } else {
          let explicitlyAllocated = 0;
          for (const intent of line.lotIntents.filter((item) => item.lotId)) {
            const lot = byId.get(intent.lotId!);
            if (!lot) throw new StockLotConflictError(`Lote selecionado não encontrado para ${productName}.`);
            if (lot.expiresAt && lot.expiresAt < today && !['manual', 'migration'].includes(input.sourceType)) {
              throw new StockLotConflictError(`O lote ${lot.code} de ${productName} está vencido.`);
            }
            const available = plannedQuantity.get(lot.id) ?? 0;
            if (available + 1e-6 < intent.quantity) {
              throw new StockLotConflictError(`Saldo insuficiente no lote ${lot.code} de ${productName}.`);
            }
            plannedQuantity.set(lot.id, roundStock(available - intent.quantity));
            explicitlyAllocated = roundStock(explicitlyAllocated + intent.quantity);
            allocations.push({
              lotId: lot.id,
              lotCode: lot.code,
              quantity: intent.quantity,
              ...(lot.expiresAt ? { expiresAt: lot.expiresAt } : {}),
            });
          }
          if (explicitlyAllocated > requested + 1e-6) {
            throw new StockLotConflictError(`A quantidade selecionada em lotes excede a saída de ${productName}.`);
          }
          let remaining = roundStock(requested - explicitlyAllocated);
          const fefo = lots
            .filter((lot) => (plannedQuantity.get(lot.id) ?? 0) > 0 && (!lot.expiresAt || lot.expiresAt >= today))
            .sort((a, b) => {
              const expiry = (a.expiresAt ?? '9999-12-31').localeCompare(b.expiresAt ?? '9999-12-31');
              return expiry || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
            });
          for (const lot of fefo) {
            if (remaining <= 0) break;
            const available = plannedQuantity.get(lot.id) ?? 0;
            const quantity = roundStock(Math.min(available, remaining));
            if (quantity <= 0) continue;
            plannedQuantity.set(lot.id, roundStock(available - quantity));
            remaining = roundStock(remaining - quantity);
            allocations.push({
              lotId: lot.id,
              lotCode: lot.code,
              quantity,
              ...(lot.expiresAt ? { expiresAt: lot.expiresAt } : {}),
            });
          }
          if (remaining > 1e-6) {
            throw new StockLotConflictError(`Lotes válidos insuficientes para a saída de ${productName}.`);
          }
          for (const [lotId, nextQuantity] of plannedQuantity) {
            const lot = byId.get(lotId)!;
            if (Math.abs(nextQuantity - lot.currentQuantity) <= 1e-6) continue;
            lotWrites.set(lot.id, {
              ref: db.collection('stockLots').doc(lot.id),
              data: {
                ...lot,
                currentQuantity: nextQuantity,
                status: nextQuantity > 0 ? 'active' : 'depleted',
                updatedAt: now,
              },
            });
          }
        }
      }
      lotAllocationsByTarget.set(targetKey, allocations);
    }

    const adjustments: StockOperationAdjustment[] = [];
    const productPatches = new Map<string, Record<string, unknown>>();
    for (const { line, product, variant, productName, minStock, previousStock, delta, newStock, unitCost, previousCost, newCost, changesCost } of effectiveReads) {
      const targetKey = `${product.id}:${line.variantId ?? ''}`;
      const movementId = `stockmv_${hash(`${operationId}:${targetKey}`).slice(0, 40)}`;
      const movementRef = db.collection('stockMovements').doc(movementId);
      const movementIdempotencyKey = `stock:${operationHash.slice(0, 32)}:${hash(targetKey).slice(0, 16)}`;
      const sourceLineId = line.sourceLineIds.size === 1 ? [...line.sourceLineIds][0] : undefined;
      const alert = detectStockCrossing(
        { id: product.id, name: productName, minStock },
        previousStock,
        newStock,
        line.variantId,
      );
      const lotAllocations = lotAllocationsByTarget.get(targetKey);

      const productPatch = productPatches.get(product.id) ?? { updatedAt: now };
      if (variant && line.variantId) {
        const variants = (productPatch.variants as Product['variants'] | undefined)
          ?? (product.variants ?? []).map((item) => ({ ...item }));
        const variantIndex = variants.findIndex((item) => item.id === line.variantId);
        if (variantIndex < 0) throw new StockReferenceError(`Variação não encontrada: ${line.variantId}.`);
        variants[variantIndex] = {
          ...variants[variantIndex],
          currentStock: newStock,
          ...(changesCost ? { costPrice: newCost } : {}),
        };
        productPatch.variants = variants;
      } else {
        productPatch.currentStock = newStock;
        if (changesCost) productPatch.costPrice = newCost;
      }
      productPatches.set(product.id, productPatch);

      tx.set(movementRef, {
        schemaVersion: 2,
        businessId: input.businessId,
        productId: product.id,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        productName,
        type: movementType(input.type),
        quantity: input.type === 'ajuste' ? delta : Math.abs(delta),
        previousStock,
        newStock,
        ...(unitCost !== undefined ? {
          unitCost,
          costTotal: roundCost(Math.abs(delta) * unitCost),
          previousCost,
          newCost,
          costMethod: 'moving_average',
        } : {}),
        ...(line.costRestoration ? {
          previousCost,
          newCost,
          costMethod: 'moving_average',
          costRestored: true,
        } : {}),
        ...(line.reversalOfMovementId ? { reversalOfMovementId: line.reversalOfMovementId } : {}),
        ...(lotAllocations?.length ? { lotAllocations } : {}),
        reason: input.reason.trim(),
        sourceType: input.sourceType,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        ...(sourceLineId ? { sourceLineId } : {}),
        ...sourceAliases(input.sourceType, input.sourceId),
        idempotencyKey: movementIdempotencyKey,
        correlationId: operationId,
        balanceAccuracy: 'exact',
        operatorId: input.operatorId,
        operatorName: input.operatorName,
        createdAt: now,
      });

      adjustments.push({
        productId: product.id,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        productName,
        movementId,
        delta,
        previousStock,
        newStock,
        ...(changesCost ? { ...(unitCost !== undefined ? { unitCost } : {}), previousCost, newCost } : {}),
        ...(lotAllocations?.length ? { lotAllocations } : {}),
        ...(alert ? { alert } : {}),
      });
    }

    for (const { ref, data } of lotWrites.values()) {
      tx.set(ref, data as unknown as Record<string, unknown>);
    }

    for (const [productId, patch] of productPatches) {
      tx.update(db.collection('products').doc(productId), patch);
    }

    const storedResult: StoredStockOperationResult = { operationId, adjustments };
    tx.set(operationRef, {
      schemaVersion: 1,
      businessId: input.businessId,
      idempotencyKey: input.idempotencyKey,
      correlationId: operationId,
      fingerprint: requestFingerprint,
      type: input.type,
      sourceType: input.sourceType,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      result: storedResult,
      createdAt: now,
      completedAt: now,
    });

    return { ...storedResult, replayed: false };
  });

  writeStructuredOperationLog('info', {
    event: 'stock.operation.completed',
    businessId: input.businessId,
    correlationId: result.operationId,
    operationId: result.operationId,
    idempotencyKey: input.idempotencyKey,
    status: result.replayed ? 'replayed' : 'completed',
    details: {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      type: input.type,
      adjustmentCount: result.adjustments.length,
    },
  });
  return result;
}
