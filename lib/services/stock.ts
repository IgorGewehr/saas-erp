/**
 * Stock deduction service — centralized logic for PDV and Pedidos.
 *
 * Handles:
 *  - Simple products: decrement parent's currentStock
 *  - Composite products (with `components`): decrement each component's stock,
 *    parent stock untouched.
 *
 * Always records a StockMovement row for audit.
 */

import {
  collection,
  doc,
  increment,
  writeBatch,
  type Firestore,
  type WriteBatch,
} from 'firebase/firestore';
import type { Product, StockMovement, StockAlert } from '@/lib/types';
import {
  expandBomLines as _expandBomLines,
  checkBomAvailability as _checkBomAvailability,
  type BomLine,
  type BomProductLite,
} from '@/contracts/_runtime/bom';

export interface StockDeductionLine {
  productId: string;
  quantity: number;
}

export interface StockDeductionContext {
  businessId: string;
  operatorId: string;
  operatorName: string;
  /** Source doc id (saleId or orderId) — stored on each StockMovement */
  sourceId?: string;
  /** Free-form reason, e.g. "Venda #123" or "Pedido #45" */
  reason: string;
  /** If provided, skips reads and uses this map instead */
  productIndex?: Map<string, Product>;
}

export interface StockAdjustment {
  productId: string;
  productName: string;
  delta: number;       // negative for deduction
  previousStock: number;
  newStock: number;
  /** Setado quando a operação cruzou o minStock pra baixo. Caller usa pra
   *  toast/notif sem precisar recalcular. Apenas em deductStock — addStock
   *  e restoreStock não geram alertas (estoque subindo). */
  alert?: StockAlert;
}

/**
 * Detecta se a operação cruzou o limiar de estoque mínimo.
 * Só dispara em transição (acima → abaixo) — não re-dispara em vendas
 * subsequentes enquanto o estoque já tá baixo.
 */
function detectStockCrossing(
  product: Product,
  previousStock: number,
  newStock: number,
): StockAlert | undefined {
  const minStock = product.minStock ?? 0;
  // Sem limiar configurado, sem alerta. Evita ruído pra produtos
  // com gestão de estoque desativada (minStock=0).
  if (minStock <= 0) return undefined;
  // Transição: estava acima OU igual, agora tá abaixo OU igual.
  if (previousStock > minStock && newStock <= minStock) {
    return {
      productId: product.id,
      productName: product.name,
      previousStock,
      newStock,
      minStock,
      severity: newStock <= 0 ? 'zeroed' : 'min',
    };
  }
  return undefined;
}

/**
 * Expand sale/order lines into per-SKU quantities. Composite products
 * (with `components[]`) are fanned out by 1 level.
 *
 * SDD: delegates to `lib/contracts/_runtime/bom.ts` — keep the helper there
 * as fonte da verdade, no duplication. Unknown productIds are skipped
 * (caller decides on strict mode) — matches legacy behavior.
 */
export function expandComponents(
  lines: StockDeductionLine[],
  productIndex: Map<string, Product>,
): StockDeductionLine[] {
  // Filter out unknown productIds first (legacy lenient behavior)
  const filtered = lines.filter((l) => productIndex.has(l.productId));
  if (filtered.length === 0) return [];
  // Adapt Map<string, Product> → Map<string, BomProductLite>: same shape, types compatible.
  const expanded = _expandBomLines(filtered as BomLine[], productIndex as unknown as Map<string, BomProductLite>);
  // Aggregate duplicates (same productId across multiple parents)
  const bucket = new Map<string, number>();
  for (const e of expanded) {
    bucket.set(e.productId, (bucket.get(e.productId) || 0) + e.quantity);
  }
  return Array.from(bucket.entries()).map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Deduct stock via Firestore batch write. Creates one `products`
 * update + one `stockMovements` row per expanded line.
 *
 * If `externalBatch` is provided, writes are added to it (caller must commit).
 * Otherwise creates and commits its own batch.
 *
 * @returns the list of per-product adjustments that were applied
 */
export async function deductStock(
  db: Firestore,
  lines: StockDeductionLine[],
  ctx: StockDeductionContext,
  externalBatch?: WriteBatch,
): Promise<StockAdjustment[]> {
  if (!ctx.productIndex) {
    throw new Error('[stock.deductStock] productIndex is required. Pass a Map<productId, Product>.');
  }

  const expanded = expandComponents(lines, ctx.productIndex);
  if (expanded.length === 0) return [];

  const batch = externalBatch ?? writeBatch(db);
  const now = new Date().toISOString();
  const adjustments: StockAdjustment[] = [];

  for (const line of expanded) {
    const product = ctx.productIndex.get(line.productId);
    if (!product) continue;

    const previousStock = product.currentStock || 0;
    const newStock = previousStock - line.quantity;

    // P1.6: increment atômico evita lost-update/oversell sob concorrência.
    // O client SDK não lê dentro do batch, então previousStock/newStock no
    // movimento vêm do snapshot pré-carregado (best-effort) — o saldo real do
    // produto fica sempre correto via increment. Auditoria precisa do valor
    // exato → preferir o caminho admin (deductStockAdmin, com runTransaction).
    // TODO(auditoria P1.6): se este path passar a exigir previousStock/newStock
    // exatos, migrar PDV para chamar a rota server-side atômica.
    batch.update(doc(db, 'products', product.id), {
      currentStock: increment(-line.quantity),
      updatedAt: now,
    });

    const movementRef = doc(collection(db, 'stockMovements'));
    const movement: Omit<StockMovement, 'id'> = {
      businessId: ctx.businessId,
      productId: product.id,
      productName: product.name,
      type: 'saida',
      quantity: line.quantity,
      previousStock,
      newStock,
      reason: ctx.reason,
      ...(ctx.sourceId ? { saleId: ctx.sourceId } : {}),
      operatorId: ctx.operatorId,
      operatorName: ctx.operatorName,
      createdAt: now,
    };
    batch.set(movementRef, movement);

    const alert = detectStockCrossing(product, previousStock, newStock);
    adjustments.push({
      productId: product.id,
      productName: product.name,
      delta: -line.quantity,
      previousStock,
      newStock,
      ...(alert ? { alert } : {}),
    });
  }

  if (!externalBatch) await batch.commit();
  return adjustments;
}

/**
 * Restore stock — inverse of deductStock.
 * Used when cancelling a sale to return items to inventory.
 *
 * If `externalBatch` is provided, writes are added to it (caller must commit).
 * Otherwise creates and commits its own batch.
 *
 * @returns the list of per-product adjustments that were applied
 */
export async function restoreStock(
  db: Firestore,
  lines: StockDeductionLine[],
  ctx: StockDeductionContext,
  externalBatch?: WriteBatch,
): Promise<StockAdjustment[]> {
  if (!ctx.productIndex) {
    throw new Error('[stock.restoreStock] productIndex is required.');
  }

  const expanded = expandComponents(lines, ctx.productIndex);
  if (expanded.length === 0) return [];

  const batch = externalBatch ?? writeBatch(db);
  const now = new Date().toISOString();
  const adjustments: StockAdjustment[] = [];

  for (const line of expanded) {
    const product = ctx.productIndex.get(line.productId);
    if (!product) continue;

    const previousStock = product.currentStock || 0;
    const newStock = previousStock + line.quantity;

    batch.update(doc(db, 'products', product.id), {
      currentStock: newStock,
      updatedAt: now,
    });

    const movementRef = doc(collection(db, 'stockMovements'));
    const movement: Omit<StockMovement, 'id'> = {
      businessId: ctx.businessId,
      productId: product.id,
      productName: product.name,
      type: 'entrada',
      quantity: line.quantity,
      previousStock,
      newStock,
      reason: ctx.reason,
      ...(ctx.sourceId ? { saleId: ctx.sourceId } : {}),
      operatorId: ctx.operatorId,
      operatorName: ctx.operatorName,
      createdAt: now,
    };
    batch.set(movementRef, movement);

    adjustments.push({
      productId: product.id,
      productName: product.name,
      delta: line.quantity,
      previousStock,
      newStock,
    });
  }

  if (!externalBatch) await batch.commit();
  return adjustments;
}

/**
 * Add stock atomically (entrada). Does NOT expand components — callers pass
 * the exact product lines to increment (typically from a purchase note).
 * Writes one product update + one stockMovement per line in a single batch.
 */
export async function addStock(
  db: Firestore,
  lines: Array<{ productId: string; quantity: number }>,
  ctx: {
    businessId: string;
    operatorId: string;
    operatorName: string;
    purchaseId?: string;
    reason: string;
    productIndex: Map<string, Product>;
  },
): Promise<StockAdjustment[]> {
  if (lines.length === 0) return [];

  const batch = writeBatch(db);
  const now = new Date().toISOString();
  const adjustments: StockAdjustment[] = [];

  for (const line of lines) {
    const product = ctx.productIndex.get(line.productId);
    if (!product) continue;

    const previousStock = product.currentStock || 0;
    const newStock = previousStock + line.quantity;

    batch.update(doc(db, 'products', product.id), {
      currentStock: newStock,
      updatedAt: now,
    });

    const movementRef = doc(collection(db, 'stockMovements'));
    const movement: Omit<StockMovement, 'id'> = {
      businessId: ctx.businessId,
      productId: product.id,
      productName: product.name,
      type: 'entrada',
      quantity: line.quantity,
      previousStock,
      newStock,
      reason: ctx.reason,
      ...(ctx.purchaseId ? { purchaseId: ctx.purchaseId } : {}),
      operatorId: ctx.operatorId,
      operatorName: ctx.operatorName,
      createdAt: now,
    };
    batch.set(movementRef, movement);

    adjustments.push({
      productId: product.id,
      productName: product.name,
      delta: line.quantity,
      previousStock,
      newStock,
    });
  }

  await batch.commit();
  return adjustments;
}

/**
 * Non-destructive check: does stock on-hand cover the requested sale?
 * Returns the list of insufficient lines (empty = OK).
 *
 * SDD: delegates a `lib/contracts/_runtime/bom.ts`. Wrapper preserva o
 * shape antigo da resposta (`requested` em vez de `required`) pra não
 * quebrar callers existentes.
 */
export function checkStockAvailability(
  lines: StockDeductionLine[],
  productIndex: Map<string, Product>,
): Array<{ productId: string; productName: string; requested: number; available: number }> {
  const filtered = lines.filter((l) => productIndex.has(l.productId));
  if (filtered.length === 0) return [];
  const result = _checkBomAvailability(
    filtered as BomLine[],
    productIndex as unknown as Map<string, BomProductLite>,
  );
  return result.shortages.map((s) => ({
    productId: s.productId,
    productName: s.productName,
    requested: s.required,
    available: s.available,
  }));
}
