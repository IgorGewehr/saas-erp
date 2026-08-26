import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/product-catalog-client', () => ({
  createCatalogProduct: vi.fn(),
}));

import { parseProductCsv } from '@/lib/services/product-csv-import';

describe('product CSV import', () => {
  it('aceita cabeçalhos em português e valores monetários brasileiros', () => {
    const [row] = parseProductCsv([
      'nome;sku;codigoBarras;categoria;unidade;precoCusto;precoVenda;estoque;estoqueMinimo',
      'Café Especial;CAFE-1;789123;Alimentos;UN;10,50;18,90;20;5',
    ].join('\n'));

    expect(row.error).toBeUndefined();
    expect(row.initialStock).toBe(20);
    expect(row.data).toMatchObject({
      name: 'Café Especial',
      sku: 'CAFE-1',
      barcode: '789123',
      category: 'Alimentos',
      costPrice: 10.5,
      salePrice: 18.9,
      minStock: 5,
    });
  });

  it('marca linha inválida sem impedir a caracterização das demais', () => {
    const rows = parseProductCsv([
      'nome,precoVenda,estoque',
      'Produto válido,15,2',
      ',-4,-1',
    ].join('\n'));

    expect(rows).toHaveLength(2);
    expect(rows[0].data?.name).toBe('Produto válido');
    expect(rows[1]).toMatchObject({ rowNumber: 3, error: 'Nome obrigatório.' });
  });

  it('limita o arquivo a mil produtos', () => {
    const lines = ['nome,precoVenda'];
    for (let index = 0; index < 1001; index++) lines.push(`Produto ${index},10`);
    expect(() => parseProductCsv(lines.join('\n'))).toThrow('1.000 produtos');
  });
});
