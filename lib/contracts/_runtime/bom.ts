/**
 * lib/contracts/_runtime/bom.ts
 *
 * Helpers UNIFICADOS de BOM (Bill of Materials) + availability check.
 *
 * Antes existia duplicação:
 *   - lib/services/stock.ts (client SDK)
 *   - lib/services/stock-admin.ts (admin SDK)
 * Ambos tinham `expandComponents()` quase idêntico — bug em um não era
 * detectado até o outro falhar (gap G4 do SDD audit).
 *
 * Este módulo centraliza a LÓGICA PURA (sem dependência de SDK). Os adapters
 * de stock.ts e stock-admin.ts devem apenas passar o `productIndex` já
 * resolvido e consumir o resultado, sem reimplementar a expansão.
 */

import type { ProductComponent } from '../domain/product';

export interface BomProductLite {
  id: string;
  businessId: string;
  name: string;
  currentStock: number;
  components?: ProductComponent[];
}

export interface BomLine {
  productId: string;
  quantity: number;
}

export interface ExpandedBomLine extends BomLine {
  productName: string;
  /** True quando esta linha veio da expansão de um pai BOM. */
  fromBom?: boolean;
  /** ID do produto pai BOM (para auditoria). */
  parentProductId?: string;
}

/**
 * Expande linhas de venda/pedido aplicando BOM.
 * Produtos com `components[]` são SUBSTITUÍDOS pelas linhas de componentes
 * (multiplicando quantidades). Produtos sem BOM passam direto.
 *
 * Regra: BOM é 1 nível por design (ver invariante em domain/product.ts).
 * Tentativa de expansão recursiva NÃO ocorre.
 *
 * @throws Error se algum productId não existe no índice (caller deve garantir)
 */
export function expandBomLines(
  lines: BomLine[],
  productIndex: Map<string, BomProductLite>,
): ExpandedBomLine[] {
  const out: ExpandedBomLine[] = [];
  for (const line of lines) {
    const product = productIndex.get(line.productId);
    if (!product) {
      throw new Error(`expandBomLines: productId não encontrado no índice: ${line.productId}`);
    }
    if (product.components?.length) {
      // BOM: substitui pelo conjunto de componentes
      for (const comp of product.components) {
        out.push({
          productId: comp.productId,
          quantity: comp.quantity * line.quantity,
          productName: comp.productName,
          fromBom: true,
          parentProductId: product.id,
        });
      }
    } else {
      // Sem BOM: passa direto
      out.push({
        productId: product.id,
        quantity: line.quantity,
        productName: product.name,
      });
    }
  }
  return out;
}

export interface AvailabilityResult {
  available: boolean;
  shortages: Array<{
    productId: string;
    productName: string;
    required: number;
    available: number;
    /** Pai BOM caso a linha tenha vindo de expansão (rastreio). */
    parentProductId?: string;
  }>;
}

/**
 * Pré-checagem de disponibilidade SEM mutação. Use ANTES de tentar deductStock
 * para falhar rápido com mensagem amigável.
 *
 * Atenção: result.available=true não garante atomicidade contra concorrência.
 * A escrita real (deductStock) ainda deve usar Firestore batch/transaction.
 */
export function checkBomAvailability(
  lines: BomLine[],
  productIndex: Map<string, BomProductLite>,
): AvailabilityResult {
  const expanded = expandBomLines(lines, productIndex);
  // Agrega por produto (mesmo componente pode aparecer várias vezes)
  const required = new Map<string, number>();
  const parentBy = new Map<string, string>();
  for (const l of expanded) {
    required.set(l.productId, (required.get(l.productId) ?? 0) + l.quantity);
    if (l.parentProductId) parentBy.set(l.productId, l.parentProductId);
  }
  const shortages: AvailabilityResult['shortages'] = [];
  for (const [productId, requiredQty] of required.entries()) {
    const product = productIndex.get(productId);
    const available = product?.currentStock ?? 0;
    if (available < requiredQty) {
      shortages.push({
        productId,
        productName: product?.name ?? productId,
        required: requiredQty,
        available,
        parentProductId: parentBy.get(productId),
      });
    }
  }
  return { available: shortages.length === 0, shortages };
}

/**
 * Helper para construir productIndex a partir de uma lista plana de produtos.
 * Útil para testes e para callers que já carregaram produtos por outra razão.
 */
export function buildProductIndex(products: BomProductLite[]): Map<string, BomProductLite> {
  const idx = new Map<string, BomProductLite>();
  for (const p of products) idx.set(p.id, p);
  return idx;
}
