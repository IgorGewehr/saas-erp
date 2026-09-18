import { describe, it, expect } from 'vitest';
import {
  UNCATEGORIZED,
  isCatalogProduct,
  getProductImageUrls,
  getActiveVariants,
  getDisplayPrice,
  productCategory,
  getCatalogCategories,
  normalizeSearchText,
  filterCatalog,
  getProductDescription,
} from '@/lib/utils/vitrineCatalog';
import type { ProductVariant } from '@/lib/types';

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'v1', name: '30s', attributes: {}, salePrice: 1000, costPrice: 400,
    currentStock: 0, minStock: 0, trackStock: false, isActive: true, ...overrides,
  };
}

describe('isCatalogProduct', () => {
  it('ativo e não arquivado aparece', () => {
    expect(isCatalogProduct({ isActive: true })).toBe(true);
  });

  it('isActive ausente conta como ativo (mesmo critério do PDV)', () => {
    expect(isCatalogProduct({} as never)).toBe(true);
  });

  it('inativo ou arquivado some', () => {
    expect(isCatalogProduct({ isActive: false })).toBe(false);
    expect(isCatalogProduct({ isActive: true, archivedAt: '2026-09-01T00:00:00.000Z' })).toBe(false);
  });
});

describe('getProductImageUrls', () => {
  it('principal primeiro, depois por sortOrder', () => {
    const urls = getProductImageUrls({
      images: [
        { id: 'a', url: 'https://x/a.jpg', sortOrder: 2 },
        { id: 'b', url: 'https://x/b.jpg', sortOrder: 1 },
        { id: 'c', url: 'https://x/c.jpg', sortOrder: 3, isPrimary: true },
      ],
    });
    expect(urls).toEqual(['https://x/c.jpg', 'https://x/b.jpg', 'https://x/a.jpg']);
  });

  it('cai no imageUrl legado quando não há images', () => {
    expect(getProductImageUrls({ imageUrl: 'https://x/legado.jpg' })).toEqual(['https://x/legado.jpg']);
  });

  it('não duplica quando o imageUrl legado já está em images', () => {
    const urls = getProductImageUrls({
      images: [{ id: 'a', url: 'https://x/a.jpg', sortOrder: 0 }],
      imageUrl: 'https://x/a.jpg',
    });
    expect(urls).toEqual(['https://x/a.jpg']);
  });

  it('ignora url vazia e devolve [] quando não há nada', () => {
    expect(getProductImageUrls({ images: [{ id: 'a', url: '  ', sortOrder: 0 }] })).toEqual([]);
    expect(getProductImageUrls({})).toEqual([]);
  });

  it('não altera o array original', () => {
    const images = [
      { id: 'a', url: 'https://x/a.jpg', sortOrder: 2 },
      { id: 'b', url: 'https://x/b.jpg', sortOrder: 1 },
    ];
    getProductImageUrls({ images });
    expect(images.map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('getDisplayPrice', () => {
  it('sem variações usa o preço do produto', () => {
    expect(getDisplayPrice({ salePrice: 1500, variants: [] })).toEqual({ amount: 1500, isFrom: false });
    expect(getDisplayPrice({ salePrice: 1500 })).toEqual({ amount: 1500, isFrom: false });
  });

  it('variações com preços diferentes: menor preço com "a partir de"', () => {
    const price = getDisplayPrice({
      salePrice: 0,
      variants: [variant({ id: 'a', salePrice: 1200 }), variant({ id: 'b', salePrice: 800 })],
    });
    expect(price).toEqual({ amount: 800, isFrom: true });
  });

  it('variações todas com o mesmo preço não mostram "a partir de"', () => {
    const price = getDisplayPrice({
      salePrice: 0,
      variants: [variant({ id: 'a', salePrice: 900 }), variant({ id: 'b', salePrice: 900 })],
    });
    expect(price).toEqual({ amount: 900, isFrom: false });
  });

  it('variação inativa não entra no cálculo', () => {
    const price = getDisplayPrice({
      salePrice: 0,
      variants: [variant({ id: 'a', salePrice: 100, isActive: false }), variant({ id: 'b', salePrice: 900 })],
    });
    expect(price).toEqual({ amount: 900, isFrom: false });
  });

  it('só variações inativas: volta pro preço do produto', () => {
    expect(getDisplayPrice({ salePrice: 700, variants: [variant({ isActive: false })] })).toEqual({ amount: 700, isFrom: false });
  });
});

describe('getActiveVariants', () => {
  it('filtra as inativas', () => {
    const result = getActiveVariants({ variants: [variant({ id: 'a' }), variant({ id: 'b', isActive: false })] });
    expect(result.map((v) => v.id)).toEqual(['a']);
  });
});

describe('categorias', () => {
  it('categoria vazia vira "Outros"', () => {
    expect(productCategory({ category: '' })).toBe(UNCATEGORIZED);
    expect(productCategory({ category: '   ' })).toBe(UNCATEGORIZED);
  });

  it('lista única, ordem pt-BR, "Outros" por último', () => {
    const categories = getCatalogCategories([
      { category: 'Pacotes' }, { category: '' }, { category: 'Ação' }, { category: 'Pacotes' }, { category: 'Eventos' },
    ]);
    expect(categories).toEqual(['Ação', 'Eventos', 'Pacotes', 'Outros']);
  });

  it('catálogo vazio não tem categorias', () => {
    expect(getCatalogCategories([])).toEqual([]);
  });
});

describe('normalizeSearchText', () => {
  it('ignora acento e caixa', () => {
    expect(normalizeSearchText('  PROMOÇÃO Áudio ')).toBe('promocao audio');
  });
});

describe('filterCatalog', () => {
  const products = [
    { name: 'Spot 30 segundos', category: 'Pacotes', description: 'Horário nobre', menuDescription: undefined, sku: 'SP30' },
    { name: 'Patrocínio de programa', category: 'Programas', description: undefined, menuDescription: 'Cota mensal', sku: undefined },
    { name: 'Menção ao vivo', category: '', description: undefined, menuDescription: undefined, sku: undefined },
  ];

  it('sem filtros devolve tudo', () => {
    expect(filterCatalog(products, { search: '', category: null })).toHaveLength(3);
  });

  it('busca por nome sem acento', () => {
    expect(filterCatalog(products, { search: 'patrocinio', category: null }).map((p) => p.name)).toEqual(['Patrocínio de programa']);
  });

  it('busca também em descrição, descrição do cardápio, categoria e sku', () => {
    expect(filterCatalog(products, { search: 'nobre', category: null })).toHaveLength(1);
    expect(filterCatalog(products, { search: 'cota', category: null })).toHaveLength(1);
    expect(filterCatalog(products, { search: 'programas', category: null })).toHaveLength(1);
    expect(filterCatalog(products, { search: 'sp30', category: null })).toHaveLength(1);
  });

  it('filtra por categoria (inclusive "Outros" para vazias)', () => {
    expect(filterCatalog(products, { search: '', category: 'Pacotes' })).toHaveLength(1);
    expect(filterCatalog(products, { search: '', category: UNCATEGORIZED }).map((p) => p.name)).toEqual(['Menção ao vivo']);
  });

  it('combina busca + categoria', () => {
    expect(filterCatalog(products, { search: 'spot', category: 'Programas' })).toEqual([]);
  });
});

describe('getProductDescription', () => {
  it('usa description; na falta, a do cardápio; senão vazio', () => {
    expect(getProductDescription({ description: ' Texto ', menuDescription: 'Outro' })).toBe('Texto');
    expect(getProductDescription({ description: '', menuDescription: 'Do cardápio' })).toBe('Do cardápio');
    expect(getProductDescription({})).toBe('');
  });
});
