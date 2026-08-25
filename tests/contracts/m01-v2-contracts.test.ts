import { describe, expect, it } from 'vitest';
import { ProductV2Schema } from '@/lib/contracts/domain/productV2';
import {
  SupplierSchema,
  normalizeBrazilianDocument,
} from '@/lib/contracts/domain/supplier';
import { PurchaseNoteV2Schema } from '@/lib/contracts/domain/purchaseNoteV2';
import { StockMovementV2Schema } from '@/lib/contracts/domain/stockMovementV2';

const NOW = '2026-08-25T15:00:00.000Z';

function legacyProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    businessId: 'business-1',
    name: 'Produto legado',
    category: 'Produto',
    unit: 'UN',
    costPrice: 10,
    salePrice: 20,
    currentStock: 5,
    minStock: 1,
    maxStock: null,
    trackStock: false,
    menuAvailable: false,
    imageUrl: 'https://example.com/product.jpg',
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('M01.1 — ProductV2Schema', () => {
  it('normaliza produto legado sem perder trackStock/menuAvailable e promove imagem', () => {
    const parsed = ProductV2Schema.parse(legacyProduct());

    expect(parsed).toMatchObject({
      schemaVersion: 2,
      kind: 'simple',
      purchaseUnit: 'UN',
      purchaseToStockFactor: 1,
      costMethod: 'moving_average',
      trackStock: false,
      menuAvailable: false,
    });
    expect(parsed.maxStock).toBeUndefined();
    expect(parsed.images).toEqual([
      expect.objectContaining({
        id: 'legacy-primary',
        url: 'https://example.com/product.jpg',
        isPrimary: true,
      }),
    ]);
    expect(parsed.migration?.warnings).toContain('maxStock:null normalizado para ausência');
  });

  it('infere produto composto e desliga estoque próprio do pai', () => {
    const parsed = ProductV2Schema.parse(
      legacyProduct({
        id: 'combo',
        trackStock: true,
        components: [{ productId: 'insumo', productName: 'Insumo', quantity: 2 }],
      }),
    );

    expect(parsed.kind).toBe('composite');
    expect(parsed.trackStock).toBe(false);
  });

  it('exige variações em kind=variant e impede mistura com BOM', () => {
    expect(
      ProductV2Schema.safeParse(
        legacyProduct({ schemaVersion: 2, kind: 'variant', variants: [] }),
      ).success,
    ).toBe(false);

    expect(
      ProductV2Schema.safeParse(
        legacyProduct({
          schemaVersion: 2,
          kind: 'variant',
          variants: [
            {
              id: 'variant-1',
              name: 'Grande',
              attributes: { tamanho: 'G' },
              salePrice: 25,
              costPrice: 12,
              currentStock: 3,
            },
          ],
          components: [{ productId: 'insumo', productName: 'Insumo', quantity: 1 }],
        }),
      ).success,
    ).toBe(false);
  });
});
describe('M01.1 — SupplierSchema', () => {
  it('normaliza pontuação do CNPJ legado e preserva rastreabilidade', () => {
    const parsed = SupplierSchema.parse({
      id: 'supplier-1',
      businessId: 'business-1',
      razaoSocial: 'Fornecedor LTDA',
      cnpj: '12.345.678/0001-99',
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(parsed.document).toBe('12345678000199');
    expect(parsed.documentType).toBe('cnpj');
    expect(parsed.migration?.legacyCnpj).toBe('12.345.678/0001-99');
  });

  it('aceita fornecedor pessoa física e rejeita tipo incompatível', () => {
    const base = {
      schemaVersion: 2,
      id: 'supplier-2',
      businessId: 'business-1',
      razaoSocial: 'Fornecedor Autônomo',
      document: '12345678901',
      documentType: 'cpf',
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(SupplierSchema.safeParse(base).success).toBe(true);
    expect(SupplierSchema.safeParse({ ...base, documentType: 'cnpj' }).success).toBe(false);
  });

  it('normaliza somente dígitos sem alterar a responsabilidade de validar checksum', () => {
    expect(normalizeBrazilianDocument('12.345.678/0001-99')).toBe('12345678000199');
    expect(normalizeBrazilianDocument(undefined)).toBe('');
  });
});

describe('M01.1 — PurchaseNoteV2Schema', () => {
  const legacyUiNote = {
    id: 'note-1',
    businessId: 'business-1',
    accessKey: '3'.repeat(44),
    numero: '123',
    serie: '1',
    issueDate: NOW,
    supplierName: 'Fornecedor LTDA',
    supplierCnpj: '12345678000199',
    items: [
      {
        productId: 'product-1',
        productName: 'Produto legado',
        cProd: 'FORN-001',
        unit: 'CX',
        quantity: 2,
        unitPrice: 25,
        total: 50,
      },
    ],
    totalProducts: 50,
    totalTaxes: 0,
    totalValue: 50,
    status: 'pendente',
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('normaliza os totais e itens do shape usado pela UI atual', () => {
    const parsed = PurchaseNoteV2Schema.parse(legacyUiNote);

    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.totals).toMatchObject({ products: 50, invoice: 50 });
    expect(parsed.items[0]).toMatchObject({
      lineId: '1',
      supplierProductCode: 'FORN-001',
      purchaseUnit: 'CX',
      purchaseQuantity: 2,
      stockUnit: 'CX',
      conversionFactor: 1,
      stockQuantity: 2,
      action: 'match',
    });
  });

  it('lê nota legada importada sem IDs, marcando explicitamente auditoria incompleta', () => {
    const parsed = PurchaseNoteV2Schema.parse({
      ...legacyUiNote,
      status: 'importada',
      stockImportedAt: NOW,
    });

    expect(parsed.status).toBe('importada');
    expect(parsed.migration).toMatchObject({ sourceVersion: 1, auditIncomplete: true });
  });

  it('não aceita uma nova nota V2 importada sem movimentos', () => {
    const normalized = PurchaseNoteV2Schema.parse(legacyUiNote);
    const invalidNewNote = {
      ...normalized,
      schemaVersion: 2,
      migration: undefined,
      status: 'importada',
      stockImportedAt: NOW,
      stockMovementIds: [],
    };

    expect(PurchaseNoteV2Schema.safeParse(invalidNewNote).success).toBe(false);
  });

  it('status processando exige claim com expiração', () => {
    const normalized = PurchaseNoteV2Schema.parse(legacyUiNote);
    expect(
      PurchaseNoteV2Schema.safeParse({
        ...normalized,
        schemaVersion: 2,
        migration: undefined,
        status: 'processando',
      }).success,
    ).toBe(false);
  });
});

describe('M01.1 — StockMovementV2Schema', () => {
  it('mapeia origem legada e marca saldo como best-effort', () => {
    const parsed = StockMovementV2Schema.parse({
      id: 'movement-1',
      businessId: 'business-1',
      productId: 'product-1',
      productName: 'Produto',
      type: 'saida',
      quantity: 2,
      previousStock: 5,
      newStock: 3,
      reason: 'Venda',
      saleId: 'sale-1',
      operatorId: 'user-1',
      operatorName: 'Operador',
      createdAt: NOW,
    });

    expect(parsed).toMatchObject({
      schemaVersion: 2,
      sourceType: 'sale',
      sourceId: 'sale-1',
      idempotencyKey: 'legacy:movement-1',
      balanceAccuracy: 'legacy_best_effort',
    });
  });

  it('normaliza ajuste absoluto legado para delta assinado', () => {
    const parsed = StockMovementV2Schema.parse({
      id: 'movement-2',
      businessId: 'business-1',
      productId: 'product-1',
      productName: 'Produto',
      type: 'ajuste',
      quantity: 3,
      previousStock: 10,
      newStock: 3,
      reason: 'Contagem física',
      operatorId: 'api',
      operatorName: 'API',
      createdAt: NOW,
    });

    expect(parsed.quantity).toBe(-7);
  });

  it('exige sourceId para movimentos não manuais', () => {
    const result = StockMovementV2Schema.safeParse({
      schemaVersion: 2,
      id: 'movement-3',
      businessId: 'business-1',
      productId: 'product-1',
      productName: 'Produto',
      type: 'entrada',
      quantity: 1,
      previousStock: 0,
      newStock: 1,
      reason: 'Compra',
      sourceType: 'purchase',
      idempotencyKey: 'purchase:note-1:item-1',
      balanceAccuracy: 'exact',
      operatorId: 'user-1',
      operatorName: 'Operador',
      createdAt: NOW,
    });
    expect(result.success).toBe(false);
  });
});
