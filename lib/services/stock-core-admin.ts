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
import { expandBomLines, type BomProductLite } from '@/contracts/_runtime/bom';
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
}

export type StockSourceCollection =
  | 'sales'
  | 'deliveryOrders'
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
      const previousCost = variant
        ? (Number.isFinite(variant.costPrice) ? variant.costPrice : 0)
        : (Number.isFinite(product.costPrice) ? product.costPrice : 0);
      const newCost = unitCost === undefined
        ? previousCost
        : roundCost(previousStock > 0 && newStock > 0
          ? ((previousStock * previousCost) + (delta * unitCost)) / newStock
          : unitCost);
      return { line, product, variant, productName, minStock, previousStock, delta, newStock, unitCost, previousCost, newCost };
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
    const adjustments: StockOperationAdjustment[] = [];
    const productPatches = new Map<string, Record<string, unknown>>();
    for (const { line, product, variant, productName, minStock, previousStock, delta, newStock, unitCost, previousCost, newCost } of effectiveReads) {
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

      const productPatch = productPatches.get(product.id) ?? { updatedAt: now };
      if (variant && line.variantId) {
        const variants = (productPatch.variants as Product['variants'] | undefined)
          ?? (product.variants ?? []).map((item) => ({ ...item }));
        const variantIndex = variants.findIndex((item) => item.id === line.variantId);
        if (variantIndex < 0) throw new StockReferenceError(`Variação não encontrada: ${line.variantId}.`);
        variants[variantIndex] = {
          ...variants[variantIndex],
          currentStock: newStock,
          ...(unitCost !== undefined ? { costPrice: newCost } : {}),
        };
        productPatch.variants = variants;
      } else {
        productPatch.currentStock = newStock;
        if (unitCost !== undefined) productPatch.costPrice = newCost;
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
        reason: input.reason.trim(),
        sourceType: input.sourceType,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        ...(sourceLineId ? { sourceLineId } : {}),
        ...sourceAliases(input.sourceType, input.sourceId),
        idempotencyKey: movementIdempotencyKey,
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
        ...(unitCost !== undefined ? { unitCost, previousCost, newCost } : {}),
        ...(alert ? { alert } : {}),
      });
    }

    for (const [productId, patch] of productPatches) {
      tx.update(db.collection('products').doc(productId), patch);
    }

    const storedResult: StoredStockOperationResult = { operationId, adjustments };
    tx.set(operationRef, {
      schemaVersion: 1,
      businessId: input.businessId,
      idempotencyKey: input.idempotencyKey,
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

  return result;
}
