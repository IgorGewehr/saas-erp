import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductInfo } from '@/app/components/features/vitrine/ProductInfo';
import { ProductCard } from '@/app/components/features/vitrine/ProductCard';
import type { Product, ProductVariant } from '@/lib/types';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    businessId: 'biz_1',
    name: 'Pacote Spot 30s',
    description: 'Duração: 30 segundos\nHorário: nobre\nInserções: 60 por mês',
    category: 'Pacotes',
    unit: 'UN',
    costPrice: 4321.09,
    salePrice: 1500,
    currentStock: 777,
    minStock: 13,
    isActive: true,
    trackStock: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'v1', name: '15 segundos', attributes: {}, salePrice: 900, costPrice: 333.33,
    currentStock: 555, minStock: 0, trackStock: false, isActive: true, ...overrides,
  };
}

describe('Vitrine — o que o cliente vê', () => {
  it('nunca vaza custo nem estoque (a tela é mostrada ao cliente do vendedor)', () => {
    const product = makeProduct({ variants: [variant()] });
    const html = renderToStaticMarkup(<ProductInfo product={product} />)
      + renderToStaticMarkup(<ProductCard product={product} onSelect={() => undefined} />);

    for (const secret of ['4321', '4.321', '333,33', '333.33', '777', '555']) {
      expect(html).not.toContain(secret);
    }
  });

  it('mostra nome, categoria, preço em reais e as especificações em tabela', () => {
    const html = renderToStaticMarkup(<ProductInfo product={makeProduct()} />);
    expect(html).toContain('Pacote Spot 30s');
    expect(html).toContain('Pacotes');
    expect(html).toMatch(/R\$\s?1\.500,00/);
    expect(html).toContain('Especificações');
    expect(html).toContain('Duração');
    expect(html).toContain('60 por mês');
  });

  it('descrição sem "Rótulo: valor" aparece como texto corrido, sem tabela', () => {
    const html = renderToStaticMarkup(
      <ProductInfo product={makeProduct({ description: 'Spot de 30 segundos em horário nobre.' })} />,
    );
    expect(html).toContain('Spot de 30 segundos em horário nobre.');
    expect(html).not.toContain('Especificações');
  });

  it('"Ocultar preços" some com o preço do produto e o das opções, mas mantém as opções', () => {
    const product = makeProduct({ variants: [variant({ id: 'a', name: '15s', salePrice: 900 }), variant({ id: 'b', name: '30s', salePrice: 1500 })] });
    const html = renderToStaticMarkup(<ProductInfo product={product} hidePrices />);
    expect(html).not.toMatch(/R\$/);
    expect(html).not.toContain('a partir de');
    expect(html).toContain('15s');
    expect(html).toContain('30s');
  });

  it('variações com preços diferentes mostram "a partir de" o menor e listam cada opção com o seu valor', () => {
    const product = makeProduct({ variants: [variant({ id: 'a', name: '15s', salePrice: 900 }), variant({ id: 'b', name: '30s', salePrice: 1500 })] });
    const html = renderToStaticMarkup(<ProductInfo product={product} />);
    expect(html).toContain('a partir de');
    expect(html).toMatch(/R\$\s?900,00/);
    expect(html).toMatch(/R\$\s?1\.500,00/);
  });

  it('preço zero vira "Sob consulta"', () => {
    const html = renderToStaticMarkup(<ProductInfo product={makeProduct({ salePrice: 0 })} />);
    expect(html).toContain('Sob consulta');
    expect(html).not.toMatch(/R\$\s?0,00/);
  });

  it('card sem foto usa o placeholder (não quebra) e mostra o preço', () => {
    const html = renderToStaticMarkup(<ProductCard product={makeProduct()} onSelect={() => undefined} />);
    expect(html).toContain('Pacote Spot 30s');
    expect(html).toMatch(/R\$\s?1\.500,00/);
    expect(html).not.toContain('<img');
  });
});
