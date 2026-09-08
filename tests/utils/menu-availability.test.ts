import { describe, it, expect } from 'vitest';
import { isOutOfStock } from '@/lib/utils/menu-availability';
import type { Product } from '@/lib/types';

function baseProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    businessId: 'biz1',
    name: 'Pizza',
    salePrice: 30,
    costPrice: 10,
    category: 'Pizzas',
    isActive: true,
    isDeliverable: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Product;
}

describe('isOutOfStock — variantes (M02.5e)', () => {
  it('disponível quando ao menos uma variante ativa tem saldo', () => {
    const p = baseProduct({
      variants: [
        { id: 'v1', name: 'Pequena', attributes: {}, salePrice: 20, costPrice: 8, currentStock: 0, minStock: 0, trackStock: true, isActive: true },
        { id: 'v2', name: 'Grande', attributes: {}, salePrice: 30, costPrice: 12, currentStock: 5, minStock: 0, trackStock: true, isActive: true },
      ],
    });
    expect(isOutOfStock(p)).toBe(false);
  });

  it('esgotado quando TODAS as variantes ativas estão sem saldo', () => {
    const p = baseProduct({
      variants: [
        { id: 'v1', name: 'Pequena', attributes: {}, salePrice: 20, costPrice: 8, currentStock: 0, minStock: 0, trackStock: true, isActive: true },
        { id: 'v2', name: 'Grande', attributes: {}, salePrice: 30, costPrice: 12, currentStock: 0, minStock: 0, trackStock: true, isActive: true },
      ],
    });
    expect(isOutOfStock(p)).toBe(true);
  });

  it('variante com trackStock=false nunca conta como esgotada', () => {
    const p = baseProduct({
      variants: [
        { id: 'v1', name: 'Pequena', attributes: {}, salePrice: 20, costPrice: 8, currentStock: 0, minStock: 0, trackStock: false, isActive: true },
      ],
    });
    expect(isOutOfStock(p)).toBe(false);
  });

  it('variantes inativas não contam — sem nenhuma ativa, esgotado', () => {
    const p = baseProduct({
      variants: [
        { id: 'v1', name: 'Descontinuada', attributes: {}, salePrice: 20, costPrice: 8, currentStock: 10, minStock: 0, trackStock: true, isActive: false },
      ],
    });
    expect(isOutOfStock(p)).toBe(true);
  });

  it('ignora currentStock da raiz quando há variantes', () => {
    const p = baseProduct({
      currentStock: 0, // raiz zerada não deveria importar
      variants: [
        { id: 'v1', name: 'Única', attributes: {}, salePrice: 20, costPrice: 8, currentStock: 3, minStock: 0, trackStock: true, isActive: true },
      ],
    });
    expect(isOutOfStock(p)).toBe(false);
  });

  it('toggle manual menuAvailable=false vence mesmo com variante em estoque', () => {
    const p = baseProduct({
      menuAvailable: false,
      variants: [
        { id: 'v1', name: 'Única', attributes: {}, salePrice: 20, costPrice: 8, currentStock: 99, minStock: 0, trackStock: true, isActive: true },
      ],
    });
    expect(isOutOfStock(p)).toBe(true);
  });
});
