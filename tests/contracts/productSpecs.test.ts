import { describe, it, expect } from 'vitest';
import { ProductCatalogDataSchema, ProductCatalogPatchSchema } from '@/lib/contracts/api/product-catalog';
import { ProductSpecSchema, PRODUCT_SPECS_MAX } from '@/lib/contracts/domain/productV2';

const base = {
  name: 'Pacote Spot 30s',
  category: 'Pacotes',
  unit: 'UN',
  costPrice: 0,
  salePrice: 1500,
  minStock: 0,
  isActive: true,
};

describe('ProductSpecSchema', () => {
  it('aceita rótulo e valor e apara espaços', () => {
    expect(ProductSpecSchema.parse({ label: '  Duração ', value: ' 30 segundos ' })).toEqual({ label: 'Duração', value: '30 segundos' });
  });

  it.each([
    [{ label: '', value: 'x' }],
    [{ label: 'x', value: '' }],
    [{ label: '   ', value: 'x' }],
    [{ label: 'x'.repeat(61), value: 'x' }],
    [{ label: 'x', value: 'y'.repeat(201) }],
  ])('rejeita %j', (spec) => {
    expect(ProductSpecSchema.safeParse(spec).success).toBe(false);
  });
});

describe('specs no contrato do catálogo', () => {
  it('é opcional — produto sem specs continua válido', () => {
    expect(ProductCatalogDataSchema.safeParse(base).success).toBe(true);
  });

  it('aceita lista de specs no cadastro e no patch', () => {
    const specs = [{ label: 'Duração', value: '30 segundos' }, { label: 'Horário', value: 'nobre' }];
    expect(ProductCatalogDataSchema.parse({ ...base, specs }).specs).toEqual(specs);
    expect(ProductCatalogPatchSchema.parse({ specs }).specs).toEqual(specs);
  });

  it('lista vazia é válida (é como o update LIMPA as especificações)', () => {
    expect(ProductCatalogPatchSchema.parse({ specs: [] }).specs).toEqual([]);
  });

  it(`aceita até ${PRODUCT_SPECS_MAX} e recusa ${PRODUCT_SPECS_MAX + 1}`, () => {
    const make = (count: number) => Array.from({ length: count }, (_, index) => ({ label: `L${index}`, value: 'v' }));
    expect(ProductCatalogPatchSchema.safeParse({ specs: make(PRODUCT_SPECS_MAX) }).success).toBe(true);
    expect(ProductCatalogPatchSchema.safeParse({ specs: make(PRODUCT_SPECS_MAX + 1) }).success).toBe(false);
  });

  it('spec inválida no meio barra o pedido inteiro', () => {
    expect(ProductCatalogPatchSchema.safeParse({ specs: [{ label: 'ok', value: 'ok' }, { label: '', value: 'x' }] }).success).toBe(false);
  });
});
