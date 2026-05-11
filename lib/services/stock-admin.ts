/**
 * Server-side (firebase-admin) counterpart of lib/services/stock.ts.
 *
 * Mirrors the client-side semantics — BOM expansion, atomic batch write of
 * product updates + stockMovements audit rows — but runs with the Admin SDK
 * for use inside API routes.
 *
 * Keep this module pure on admin-SDK types (firebase-admin/firestore) so it
 * can be safely imported from API routes without dragging in the client SDK.
 */

import type { Firestore } from 'firebase-admin/firestore';
import type { Product, StockMovement } from '@/lib/types';
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

export interface StockDeductionContextAdmin {
  businessId: string;
  operatorId: string;
  operatorName: string;
  /** Source doc id (saleId or orderId) — stored on each StockMovement */
  sourceId?: string;
  /** Free-form reason, e.g. "Venda #123" or "Pedido #45" */
  reason: string;
  /** Pre-fetched product map keyed by productId */
  productIndex: Map<string, Product>;
}

export interface StockAdjustmentAdmin {
  productId: string;
  productName: string;
  delta: number;
  previousStock: number;
  newStock: number;
}

/**
 * Fan out composite products into per-SKU quantities.
 *
 * SDD: delegates a `lib/contracts/_runtime/bom.ts`. Antes existia uma cópia
 * desta função em stock.ts e outra aqui — agora ambas chamam o mesmo helper
 * (fecha gap G4 do SDD audit).
 */
export function expandComponents(
  lines: StockDeductionLine[],
  productIndex: Map<string, Product>,
): StockDeductionLine[] {
  const filtered = lines.filter((l) => productIndex.has(l.productId));
  if (filtered.length === 0) return [];
  const expanded = _expandBomLines(filtered as BomLine[], productIndex as unknown as Map<string, BomProductLite>);
  const bucket = new Map<string, number>();
  for (const e of expanded) {
    bucket.set(e.productId, (bucket.get(e.productId) || 0) + e.quantity);
  }
  return Array.from(bucket.entries()).map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Non-destructive availability check. Returns lines que não podem ser
 * atendidas. SDD: wrapper sobre `checkBomAvailability` mantendo o shape
 * antigo (`requested` em vez de `required`).
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

/**
 * Fetch products for the given IDs, filtered by businessId. Silently skips
 * missing products and cross-tenant matches. Returns a map keyed by id.
 */
export async function loadProductIndex(
  db: Firestore,
  productIds: string[],
  businessId: string,
): Promise<Map<string, Product>> {
  const unique = [...new Set(productIds)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const refs = unique.map(id => db.collection('products').doc(id));
  const snaps = await db.getAll(...refs);
  const map = new Map<string, Product>();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() as Product;
    if (data.businessId !== businessId) continue;
    map.set(snap.id, { ...data, id: snap.id });
  }
  return map;
}

/**
 * Atomically deduct stock for a set of sale/order lines using the Admin SDK.
 * Expands composite products; writes one product update + one stockMovement
 * row per resulting leaf SKU, all in a single batch.
 */
export async function deductStockAdmin(
  db: Firestore,
  lines: StockDeductionLine[],
  ctx: StockDeductionContextAdmin,
): Promise<StockAdjustmentAdmin[]> {
  const expanded = expandComponents(lines, ctx.productIndex);
  if (expanded.length === 0) return [];

  const batch = db.batch();
  const now = new Date().toISOString();
  const adjustments: StockAdjustmentAdmin[] = [];

  for (const line of expanded) {
    const product = ctx.productIndex.get(line.productId);
    if (!product) continue;

    const previousStock = product.currentStock || 0;
    const newStock = previousStock - line.quantity;

    batch.update(db.collection('products').doc(product.id), {
      currentStock: newStock,
      updatedAt: now,
    });

    const movementRef = db.collection('stockMovements').doc();
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
