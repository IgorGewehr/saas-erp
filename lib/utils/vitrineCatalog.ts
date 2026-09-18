/**
 * lib/utils/vitrineCatalog.ts
 *
 * Regras puras do catálogo da Vitrine (tablet): quem aparece, quais imagens,
 * qual preço mostrar, categorias e busca. Sem React/Firebase — testável.
 * Nunca lê custo nem estoque: a Vitrine é mostrada ao CLIENTE do vendedor.
 */

import type { Product, ProductVariant } from '@/lib/types';

export const UNCATEGORIZED = 'Outros';

type CatalogVisibilityFields = Pick<Product, 'isActive' | 'archivedAt'>;

export function isCatalogProduct(product: CatalogVisibilityFields): boolean {
  return product.isActive !== false && !product.archivedAt;
}

/** Principal primeiro, depois por sortOrder; cai no `imageUrl` legado; sem duplicar. */
export function getProductImageUrls(product: Pick<Product, 'images' | 'imageUrl'>): string[] {
  const ordered = [...(product.images ?? [])]
    .filter((image) => typeof image.url === 'string' && image.url.trim() !== '')
    .sort((a, b) => Number(b.isPrimary === true) - Number(a.isPrimary === true) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((image) => image.url.trim());

  const legacy = product.imageUrl?.trim();
  if (legacy) ordered.push(legacy);

  return [...new Set(ordered)];
}

export function getActiveVariants(product: Pick<Product, 'variants'>): ProductVariant[] {
  return (product.variants ?? []).filter((variant) => variant.isActive);
}

export interface DisplayPrice {
  amount: number;
  /** true quando há variações com preços diferentes — mostra "a partir de". */
  isFrom: boolean;
}

export function getDisplayPrice(product: Pick<Product, 'salePrice' | 'variants'>): DisplayPrice {
  const variants = getActiveVariants(product);
  if (variants.length === 0) return { amount: product.salePrice, isFrom: false };

  const prices = variants.map((variant) => variant.salePrice);
  const lowest = Math.min(...prices);
  return { amount: lowest, isFrom: prices.some((price) => price !== lowest) };
}

export function productCategory(product: Pick<Product, 'category'>): string {
  return product.category?.trim() || UNCATEGORIZED;
}

/** Categorias em ordem alfabética (pt-BR); "Outros" sempre por último. */
export function getCatalogCategories(products: Array<Pick<Product, 'category'>>): string[] {
  const unique = [...new Set(products.map(productCategory))];
  return unique.sort((a, b) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b, 'pt-BR');
  });
}

/** Minúsculas e sem acento — "promoção" acha "Promocao". */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

type SearchableProduct = Pick<Product, 'name' | 'category' | 'description' | 'menuDescription' | 'sku'>;

export function filterCatalog<T extends SearchableProduct>(
  products: T[],
  filters: { search: string; category: string | null },
): T[] {
  const term = normalizeSearchText(filters.search);
  return products.filter((product) => {
    if (filters.category && productCategory(product) !== filters.category) return false;
    if (!term) return true;
    const haystack = normalizeSearchText(
      [product.name, product.category, product.description, product.menuDescription, product.sku].filter(Boolean).join(' '),
    );
    return haystack.includes(term);
  });
}

/** Texto de descrição pra exibir: `description` e, na falta, a do cardápio. */
export function getProductDescription(product: Pick<Product, 'description' | 'menuDescription'>): string {
  return product.description?.trim() || product.menuDescription?.trim() || '';
}
