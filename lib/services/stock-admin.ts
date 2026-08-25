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

import { randomUUID } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { Product, StockAlert } from '@/lib/types';
import {
  expandBomLines as _expandBomLines,
  checkBomAvailability as _checkBomAvailability,
  type BomLine,
  type BomProductLite,
} from '@/contracts/_runtime/bom';
import {
  applyStockOperationAdmin,
  InsufficientStockError,
  type StockSourceDocument,
  type StockSourceType,
} from '@/lib/services/stock-core-admin';

export {
  InsufficientStockError,
  InvalidStockOperationError,
  StockIdempotencyConflictError,
  StockReferenceError,
} from '@/lib/services/stock-core-admin';

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
  sourceType?: StockSourceType;
  sourceDocument?: StockSourceDocument;
  /** Chave estável por evento. Se ausente, wrappers legados geram uma chave descartável. */
  idempotencyKey?: string;
  /** Free-form reason, e.g. "Venda #123" or "Pedido #45" */
  reason: string;
  /** Pre-fetched product map keyed by productId */
  productIndex: Map<string, Product>;
  /**
   * IDs de produtos (já expandidos por BOM) que NÃO podem ficar negativos.
   * Quando uma linha desses produtos não tem estoque suficiente (lido DENTRO
   * da tx), a dedução inteira aborta com `InsufficientStockError` antes de
   * qualquer escrita — fecha oversell por concorrência (P2.7).
   *
   * Vazio/ausente = comportamento legado (debita mesmo indo negativo). O caller
   * decide o que guardar; o cardápio público guarda só itens simples com estoque
   * definido, espelhando a regra de "Esgotado" da UI (CatalogClient).
   */
  failOnInsufficientFor?: ReadonlySet<string>;
  /** `prevent` bloqueia negativo para todas as folhas; default preserva legado. */
  negativeStockPolicy?: 'allow' | 'prevent';
  /** Default true. false atua diretamente no SKU, sem expandir BOM. */
  expandBom?: boolean;
}

export interface StockAdjustmentAdmin {
  productId: string;
  productName: string;
  delta: number;
  previousStock: number;
  newStock: number;
  movementId?: string;
  /** Setado quando deductStockAdmin cruzou o minStock pra baixo. Espelha o
   *  campo de StockAdjustment client-side. Caller (API route) usa pra
   *  escrever em notifications + retornar pro client se quiser toast. */
  alert?: StockAlert;
}

function fallbackIdempotencyKey(
  operation: 'deduct' | 'restore' | 'add' | 'adjust',
  ctx: Pick<StockDeductionContextAdmin, 'sourceType' | 'sourceId' | 'idempotencyKey'>,
): string {
  if (ctx.idempotencyKey) return ctx.idempotencyKey;
  if (ctx.sourceId) return `${operation}:${ctx.sourceType ?? 'sale'}:${ctx.sourceId}`;
  return `legacy:${operation}:${randomUUID()}`;
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
 * row per resulting leaf SKU.
 *
 * P1.6: roda dentro de runTransaction e lê o currentStock real de cada produto
 * dentro da transação (em vez do snapshot pré-carregado). Assim previousStock/
 * newStock gravados no movimento refletem a realidade e duas vendas simultâneas
 * do mesmo SKU não causam lost-update/oversell — a transação reexecuta em caso
 * de conflito. O núcleo relê e valida também o BOM pelo tenant; productIndex
 * permanece no adapter apenas para compatibilidade e pré-checagens dos callers.
 */
export async function deductStockAdmin(
  db: Firestore,
  lines: StockDeductionLine[],
  ctx: StockDeductionContextAdmin,
): Promise<StockAdjustmentAdmin[]> {
  if (lines.length === 0) return [];
  const sourceType = ctx.sourceType ?? (ctx.sourceId ? 'sale' : 'manual');
  const result = await applyStockOperationAdmin(db, {
    businessId: ctx.businessId,
    type: 'saida',
    lines,
    operatorId: ctx.operatorId,
    operatorName: ctx.operatorName,
    reason: ctx.reason,
    sourceType,
    ...(ctx.sourceId ? { sourceId: ctx.sourceId } : {}),
    ...(ctx.sourceDocument ? { sourceDocument: ctx.sourceDocument } : {}),
    idempotencyKey: fallbackIdempotencyKey('deduct', { ...ctx, sourceType }),
    expandBom: ctx.expandBom !== false,
    negativeStockPolicy: ctx.negativeStockPolicy ?? 'allow',
    strictProductIds: ctx.failOnInsufficientFor,
  });
  return result.adjustments;
}

/**
 * Atomically RESTORE stock for a set of order lines (reverse of
 * deductStockAdmin). Expands composite products and writes one product update +
 * one `entrada` stockMovement per resulting leaf SKU, incrementing currentStock.
 *
 * Usado quando uma cobrança é desfeita (PIX expirado, estorno) e o estoque que
 * fora debitado na criação do pedido precisa voltar. A chave estável do caller
 * fecha a idempotência no próprio ledger; `stockRestoredAt` continua como estado
 * de domínio/recuperação do pedido.
 */
export async function restoreStockAdmin(
  db: Firestore,
  lines: StockDeductionLine[],
  ctx: StockDeductionContextAdmin,
): Promise<StockAdjustmentAdmin[]> {
  if (lines.length === 0) return [];
  const sourceType = ctx.sourceType ?? (ctx.sourceId ? 'refund' : 'manual');
  const result = await applyStockOperationAdmin(db, {
    businessId: ctx.businessId,
    type: 'restauracao',
    lines,
    operatorId: ctx.operatorId,
    operatorName: ctx.operatorName,
    reason: ctx.reason,
    sourceType,
    ...(ctx.sourceId ? { sourceId: ctx.sourceId } : {}),
    ...(ctx.sourceDocument ? { sourceDocument: ctx.sourceDocument } : {}),
    idempotencyKey: fallbackIdempotencyKey('restore', { ...ctx, sourceType }),
    expandBom: ctx.expandBom !== false,
  });
  return result.adjustments;
}
