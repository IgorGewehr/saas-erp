/**
 * Helpers puros de estoque para pré-visualização no browser.
 *
 * Escritas foram removidas deste módulo na M01.2. Toda mutação passa por
 * `/api/stock/operations` ou pelos serviços Admin SDK, que usam
 * `applyStockOperationAdmin` como autoridade transacional.
 *
 * A pré-checagem abaixo melhora a mensagem ao operador, mas não substitui o
 * guard de concorrência executado pelo servidor durante a escrita.
 */

import type { Product } from '@/lib/types';
import {
  expandBomLines,
  checkBomAvailability,
  type BomLine,
  type BomProductLite,
} from '@/contracts/_runtime/bom';

export interface StockDeductionLine {
  productId: string;
  quantity: number;
}

export function expandComponents(
  lines: StockDeductionLine[],
  productIndex: Map<string, Product>,
): StockDeductionLine[] {
  const filtered = lines.filter((line) => productIndex.has(line.productId));
  if (!filtered.length) return [];
  const expanded = expandBomLines(
    filtered as BomLine[],
    productIndex as unknown as Map<string, BomProductLite>,
  );
  const bucket = new Map<string, number>();
  for (const line of expanded) {
    bucket.set(line.productId, (bucket.get(line.productId) ?? 0) + line.quantity);
  }
  return [...bucket.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

export function checkStockAvailability(
  lines: StockDeductionLine[],
  productIndex: Map<string, Product>,
): Array<{ productId: string; productName: string; requested: number; available: number }> {
  const filtered = lines.filter((line) => productIndex.has(line.productId));
  if (!filtered.length) return [];
  const result = checkBomAvailability(
    filtered as BomLine[],
    productIndex as unknown as Map<string, BomProductLite>,
  );
  return result.shortages.map((shortage) => ({
    productId: shortage.productId,
    productName: shortage.productName,
    requested: shortage.required,
    available: shortage.available,
  }));
}
