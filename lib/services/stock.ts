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
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Product, StockMovement } from '@/lib/types';

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
}

/**
 * Expand a list of sale/order lines into the actual per-SKU adjustments
 * that need to hit the DB. Composite products are expanded recursively
 * (one-level — we don't support nested compositions).
 *
 * Returns the list grouped by productId (sums quantities when the same
 * component appears in multiple parents).
 */
export function expandComponents(
  lines: StockDeductionLine[],
  productIndex: Map<string, Product>,
): StockDeductionLine[] {
  const bucket = new Map<string, number>();
  for (const line of lines) {
    const product = productIndex.get(line.productId);
    if (!product) {
      // Unknown product — skip silently (caller decides on strict mode)
      continue;
    }
    if (product.components && product.components.length > 0) {
      // Composite: fan out into components, multiplied by qty sold
      for (const comp of product.components) {
        const qty = comp.quantity * line.quantity;
        bucket.set(comp.productId, (bucket.get(comp.productId) || 0) + qty);
      }
    } else {
      bucket.set(product.id, (bucket.get(product.id) || 0) + line.quantity);
    }
  }
  return Array.from(bucket.entries()).map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Deduct stock atomically via Firestore batch write. Creates one `products`
 * update + one `stockMovements` row per expanded line.
 *
 * @returns the list of per-product adjustments that were applied
 */
export async function deductStock(
  db: Firestore,
  lines: StockDeductionLine[],
  ctx: StockDeductionContext,
): Promise<StockAdjustment[]> {
  if (!ctx.productIndex) {
    throw new Error('[stock.deductStock] productIndex is required. Pass a Map<productId, Product>.');
  }

  const expanded = expandComponents(lines, ctx.productIndex);
  if (expanded.length === 0) return [];

  const batch = writeBatch(db);
  const now = new Date().toISOString();
  const adjustments: StockAdjustment[] = [];

  for (const line of expanded) {
    const product = ctx.productIndex.get(line.productId);
    if (!product) continue;

    const previousStock = product.currentStock || 0;
    const newStock = previousStock - line.quantity;

    batch.update(doc(db, 'products', product.id), {
      currentStock: newStock,
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

    adjustments.push({
      productId: product.id,
      productName: product.name,
      delta: -line.quantity,
      previousStock,
      newStock,
    });
  }

  await batch.commit();
  return adjustments;
}

/**
 * Restore stock atomically — inverse of deductStock.
 * Used when cancelling a sale to return items to inventory.
 *
 * @returns the list of per-product adjustments that were applied
 */
export async function restoreStock(
  db: Firestore,
  lines: StockDeductionLine[],
  ctx: StockDeductionContext,
): Promise<StockAdjustment[]> {
  if (!ctx.productIndex) {
    throw new Error('[stock.restoreStock] productIndex is required.');
  }

  const expanded = expandComponents(lines, ctx.productIndex);
  if (expanded.length === 0) return [];

  const batch = writeBatch(db);
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

  await batch.commit();
  return adjustments;
}

/**
 * Non-destructive check: does stock on-hand cover the requested sale?
 * Returns the list of insufficient lines (empty = OK).
 */
export function checkStockAvailability(
  lines: StockDeductionLine[],
  productIndex: Map<string, Product>,
): Array<{ productId: string; productName: string; requested: number; available: number }> {
  const expanded = expandComponents(lines, productIndex);
  const short: Array<{ productId: string; productName: string; requested: number; available: number }> = [];
  for (const line of expanded) {
    const product = productIndex.get(line.productId);
    if (!product) continue;
    if ((product.currentStock || 0) < line.quantity) {
      short.push({
        productId: product.id,
        productName: product.name,
        requested: line.quantity,
        available: product.currentStock || 0,
      });
    }
  }
  return short;
}
