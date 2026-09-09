import { describe, it, expect } from 'vitest';
import { toPublicProduct } from '@/app/p/[slug]/page';
import type { Product } from '@/lib/types';

// M02.8 — regressão de segurança: o cardápio público (app/p/[slug]) nunca
// pode vazar custo/margem, identificadores internos ou classificação fiscal
// de um produto pra um visitante anônimo. Este teste garante que QUALQUER
// campo sensível adicionado no futuro a `Product` não vaza por acidente
// (checagem por lista negra de chaves, não só "os campos que eu lembrei").

const SENSITIVE_TOP_LEVEL_KEYS = [
  'businessId', 'costPrice', 'costMethod', 'sku', 'skuNormalized', 'barcode',
  'barcodeNormalized', 'ncm', 'cfop', 'cest', 'icmsOrigem', 'gtin', 'gtinTrib',
  'unidadeTrib', 'fiscalTax', 'purchaseUnit', 'purchaseToStockFactor',
  'minStock', 'maxStock', 'archivedBy', 'archivedAt',
];

function fullProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    businessId: 'biz1',
    name: 'Pizza Margherita',
    salePrice: 45,
    costPrice: 12.5,
    costMethod: 'average',
    category: 'Pizzas',
    sku: 'PZ-001',
    barcode: '7891234567890',
    ncm: '19022000',
    cfop: '5102',
    cest: '1706200',
    isActive: true,
    isDeliverable: true,
    minStock: 5,
    maxStock: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    modifierGroups: [{
      id: 'g1',
      name: 'Borda',
      required: false,
      minSelections: 0,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      sortOrder: 0,
      options: [{
        id: 'o1',
        name: 'Catupiry',
        additionalPrice: 8,
        available: true,
        sortOrder: 0,
        linkedProductId: 'insumo-catupiry',
        consumeQty: 1,
      }],
    }],
    variants: [{
      id: 'v1',
      name: 'Grande',
      attributes: { tamanho: 'G' },
      salePrice: 55,
      costPrice: 18,
      currentStock: 10,
      minStock: 2,
      trackStock: true,
      isActive: true,
    }],
    ...overrides,
  } as Product;
}

describe('toPublicProduct (M02.8 — allowlist de segurança do cardápio público)', () => {
  it('nunca inclui campos sensíveis no nível raiz', () => {
    const pub = toPublicProduct(fullProduct());
    const keys = Object.keys(pub);
    for (const forbidden of SENSITIVE_TOP_LEVEL_KEYS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('remove linkedProductId/consumeQty das opções de modificador', () => {
    const pub = toPublicProduct(fullProduct());
    const option = pub.modifierGroups![0].options[0] as unknown as Record<string, unknown>;
    expect(option).not.toHaveProperty('linkedProductId');
    expect(option).not.toHaveProperty('consumeQty');
    // mas preserva o que a UI precisa pra renderizar a opção
    expect(option.name).toBe('Catupiry');
    expect(option.additionalPrice).toBe(8);
  });

  it('remove costPrice das variantes', () => {
    const pub = toPublicProduct(fullProduct());
    const variant = pub.variants![0] as unknown as Record<string, unknown>;
    expect(variant).not.toHaveProperty('costPrice');
    expect(variant.salePrice).toBe(55);
    expect(variant.currentStock).toBe(10);
  });

  it('preserva os campos que o cardápio realmente usa pra renderizar', () => {
    const pub = toPublicProduct(fullProduct());
    expect(pub.id).toBe('p1');
    expect(pub.name).toBe('Pizza Margherita');
    expect(pub.salePrice).toBe(45);
    expect(pub.category).toBe('Pizzas');
  });
});
