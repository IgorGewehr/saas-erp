import type { Product } from '@/lib/types';

/**
 * Disponibilidade de item de cardápio — FONTE ÚNICA.
 *
 * Espelha a regra do caminho público (`app/p/[slug]/CatalogClient.tsx`,
 * ProductCard) e a estende com a capacidade real de um produto composto (BOM).
 * O cardápio interno (CardapioModule) e o público devem concordar bit a bit,
 * senão um pedido é aceito num lado e recusado no outro (a rota
 * `orders/public` debita insumos e rejeita sem estoque).
 *
 * Regras:
 *  1. Produto com modificadores → montado sob demanda; NUNCA bloqueia pelo
 *     próprio `currentStock` (o preço/estoque final depende das opções).
 *  2. Produto composto (BOM, `components[]`) → não carrega estoque próprio;
 *     disponibilidade = min, entre os insumos, de floor(insumo.currentStock /
 *     quantidade consumida). Insumo com estoque desconhecido não bloqueia
 *     (mesmo comportamento do público, que trata composto como sempre montável
 *     quando não consegue resolver o insumo).
 *  3. `currentStock` indefinido → disponível (produto sem controle de estoque).
 *  4. Produto simples → esgotado quando `currentStock <= 0`.
 */

/** Resolve o estoque atual de um insumo pelo id; `undefined` quando desconhecido. */
export type StockResolver = (productId: string) => number | undefined;

function hasModifiers(product: Product): boolean {
  return Boolean(product.hasModifiers);
}

function hasComponents(product: Product): boolean {
  return Boolean(product.components && product.components.length > 0);
}

/**
 * Quantas unidades do produto composto dá para montar com o estoque dos insumos.
 * `undefined` quando não é composto ou quando nenhum insumo é resolvível
 * (nesse caso não há como bloquear — o público também não bloqueia).
 */
export function composedAvailableQty(product: Product, resolve?: StockResolver): number | undefined {
  const components = product.components;
  if (!components || components.length === 0) return undefined;
  if (!resolve) return undefined;

  let min = Infinity;
  for (const c of components) {
    const stock = resolve(c.productId);
    if (stock === undefined) continue; // insumo desconhecido → não bloqueia
    const per = c.quantity > 0 ? c.quantity : 1;
    const canMake = Math.floor(stock / per);
    if (canMake < min) min = canMake;
  }
  return min === Infinity ? undefined : min;
}

/** `true` quando o item NÃO pode ser pedido agora. */
export function isOutOfStock(product: Product, resolve?: StockResolver): boolean {
  if (hasModifiers(product)) return false;

  if (hasComponents(product)) {
    const qty = composedAvailableQty(product, resolve);
    return qty !== undefined && qty <= 0;
  }

  if (product.currentStock === undefined) return false;
  return product.currentStock <= 0;
}

/** Inverso de `isOutOfStock` — açúcar sintático para leitura. */
export function isProductAvailable(product: Product, resolve?: StockResolver): boolean {
  return !isOutOfStock(product, resolve);
}
