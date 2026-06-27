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

import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
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
}

/** Linha que não pôde ser atendida por falta de estoque. */
export interface StockShortage {
  productId: string;
  productName: string;
  requested: number;
  available: number;
}

/**
 * Lançado por `deductStockAdmin` quando `failOnInsufficientFor` está setado e
 * algum produto guardado ficaria negativo. Nenhuma escrita ocorre (lançado na
 * fase de leitura da tx). Caller deve mapear para 4xx amigável.
 */
export class InsufficientStockError extends Error {
  readonly code = 'INSUFFICIENT_STOCK' as const;
  constructor(public readonly shortages: StockShortage[]) {
    super(
      'Estoque insuficiente: ' +
        shortages
          .map((s) => `${s.productName} (disponível: ${s.available}, pedido: ${s.requested})`)
          .join(', '),
    );
    this.name = 'InsufficientStockError';
  }
}

export interface StockAdjustmentAdmin {
  productId: string;
  productName: string;
  delta: number;
  previousStock: number;
  newStock: number;
  /** Setado quando deductStockAdmin cruzou o minStock pra baixo. Espelha o
   *  campo de StockAdjustment client-side. Caller (API route) usa pra
   *  escrever em notifications + retornar pro client se quiser toast. */
  alert?: StockAlert;
}

/** Detecta cruzamento de minStock. Espelha stock.ts — duplicado pra evitar
 *  importar entre módulos client/admin SDK. */
function detectStockCrossing(
  product: Product,
  previousStock: number,
  newStock: number,
): StockAlert | undefined {
  const minStock = product.minStock ?? 0;
  if (minStock <= 0) return undefined;
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
 * de conflito. O productIndex (pré-carregado) ainda é usado para expandir BOM,
 * nome do produto e minStock; só o valor numérico de estoque vem da leitura tx.
 */
export async function deductStockAdmin(
  db: Firestore,
  lines: StockDeductionLine[],
  ctx: StockDeductionContextAdmin,
): Promise<StockAdjustmentAdmin[]> {
  const expanded = expandComponents(lines, ctx.productIndex);
  if (expanded.length === 0) return [];

  const now = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const adjustments: StockAdjustmentAdmin[] = [];

    // Fase de leitura: todas as leituras antes de qualquer escrita (exigência do
    // Firestore). Lê o estoque atual de cada SKU dentro da transação.
    const reads: Array<{ line: StockDeductionLine; product: Product; previousStock: number }> = [];
    for (const line of expanded) {
      const product = ctx.productIndex.get(line.productId);
      if (!product) continue;
      const snap = await tx.get(db.collection('products').doc(product.id));
      const previousStock = (snap.exists ? (snap.data()?.currentStock as number | undefined) : undefined) ?? 0;
      reads.push({ line, product, previousStock });
    }

    // Guard de oversell (P2.7): antes de escrever, valida que os produtos
    // marcados em `failOnInsufficientFor` não ficam negativos. Como o estoque
    // foi lido DENTRO da tx, duas vendas simultâneas do mesmo SKU não passam
    // ambas — a perdedora reexecuta, relê o saldo já debitado e aborta aqui.
    if (ctx.failOnInsufficientFor && ctx.failOnInsufficientFor.size > 0) {
      const shortages = reads
        .filter(
          (r) =>
            ctx.failOnInsufficientFor!.has(r.product.id) &&
            r.previousStock - r.line.quantity < 0,
        )
        .map((r) => ({
          productId: r.product.id,
          productName: r.product.name,
          requested: r.line.quantity,
          available: r.previousStock,
        }));
      if (shortages.length > 0) throw new InsufficientStockError(shortages);
    }

    // Fase de escrita.
    for (const { line, product, previousStock } of reads) {
      const newStock = previousStock - line.quantity;

      tx.update(db.collection('products').doc(product.id), {
        currentStock: FieldValue.increment(-line.quantity),
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
      tx.set(movementRef, movement);

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

    return adjustments;
  });
}

/**
 * Atomically RESTORE stock for a set of order lines (reverse of
 * deductStockAdmin). Expands composite products and writes one product update +
 * one `entrada` stockMovement per resulting leaf SKU, incrementing currentStock.
 *
 * Usado quando uma cobrança é desfeita (PIX expirado, estorno) e o estoque que
 * fora debitado na criação do pedido precisa voltar. A idempotência é
 * responsabilidade do CALLER (ex: guard `stockRestoredAt` no pedido) — chamar
 * esta função duas vezes incrementa o estoque duas vezes.
 */
export async function restoreStockAdmin(
  db: Firestore,
  lines: StockDeductionLine[],
  ctx: StockDeductionContextAdmin,
): Promise<StockAdjustmentAdmin[]> {
  const expanded = expandComponents(lines, ctx.productIndex);
  if (expanded.length === 0) return [];

  const now = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const reads: Array<{ line: StockDeductionLine; product: Product; previousStock: number }> = [];
    for (const line of expanded) {
      const product = ctx.productIndex.get(line.productId);
      if (!product) continue;
      const snap = await tx.get(db.collection('products').doc(product.id));
      const previousStock =
        (snap.exists ? (snap.data()?.currentStock as number | undefined) : undefined) ?? 0;
      reads.push({ line, product, previousStock });
    }

    const adjustments: StockAdjustmentAdmin[] = [];
    for (const { line, product, previousStock } of reads) {
      const newStock = previousStock + line.quantity;

      tx.update(db.collection('products').doc(product.id), {
        currentStock: FieldValue.increment(line.quantity),
        updatedAt: now,
      });

      const movementRef = db.collection('stockMovements').doc();
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
      tx.set(movementRef, movement);

      adjustments.push({
        productId: product.id,
        productName: product.name,
        delta: line.quantity,
        previousStock,
        newStock,
      });
    }

    return adjustments;
  });
}
