import { describe, expect, it } from 'vitest';
import {
  ProductSchema,
  type Product as ContractProduct,
} from '@/lib/contracts/domain/product';
import {
  PURCHASE_NOTE_STATUSES,
  PurchaseNoteSchema,
  type PurchaseNote,
} from '@/lib/contracts/domain/purchaseNote';
import { StockMovementSchema } from '@/lib/contracts/domain/stockMovement';
import {
  PURCHASE_NOTE_TRANSITIONS,
  assertTransitionPurchaseNote,
  canTransitionPurchaseNote,
} from '@/lib/contracts/fsm/purchaseNote';
import {
  buildProductIndex,
  checkBomAvailability,
  expandBomLines,
  type BomProductLite,
} from '@/lib/contracts/_runtime/bom';

const NOW = '2026-08-25T12:00:00.000Z';

function product(overrides: Partial<ContractProduct> = {}): ContractProduct {
  return {
    id: 'product-1',
    businessId: 'business-1',
    name: 'Produto de teste',
    category: 'Produto',
    unit: 'UN',
    costPrice: 10,
    salePrice: 20,
    currentStock: 8,
    minStock: 2,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function purchaseNote(overrides: Partial<PurchaseNote> = {}): PurchaseNote {
  return {
    id: 'purchase-note-1',
    businessId: 'business-1',
    accessKey: '1'.repeat(44),
    numero: '123',
    serie: '1',
    issueDate: NOW,
    supplierName: 'Fornecedor de teste',
    supplierCnpj: '12345678000199',
    items: [
      {
        productName: 'Produto de teste',
        cProd: 'FORN-001',
        unit: 'UN',
        quantity: 2,
        unitPrice: 10,
        total: 20,
      },
    ],
    total: 20,
    status: 'pendente',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('M01 baseline — ProductSchema', () => {
  it('aceita o produto simples canônico atual', () => {
    expect(ProductSchema.safeParse(product()).success).toBe(true);
  });

  it('aceita BOM de um nível e rejeita autorreferência', () => {
    const valid = product({
      id: 'combo',
      components: [{ productId: 'insumo-1', productName: 'Insumo 1', quantity: 2 }],
    });
    expect(ProductSchema.safeParse(valid).success).toBe(true);

    const selfReference = product({
      id: 'combo',
      components: [{ productId: 'combo', productName: 'O próprio combo', quantity: 1 }],
    });
    expect(ProductSchema.safeParse(selfReference).success).toBe(false);
  });

  it('registra o gap atual: maxStock=null persistido pela UI não passa no contrato', () => {
    const persistedUiShape = { ...product(), maxStock: null };
    expect(ProductSchema.safeParse(persistedUiShape).success).toBe(false);
  });

  it('registra o gap atual: trackStock existe no produto de UI, mas é removido pelo contrato', () => {
    const parsed = ProductSchema.parse({ ...product(), trackStock: false });
    expect('trackStock' in parsed).toBe(false);
  });
});

describe('M01 baseline — BOM e disponibilidade', () => {
  const products: BomProductLite[] = [
    {
      id: 'combo-a',
      businessId: 'business-1',
      name: 'Combo A',
      currentStock: 0,
      components: [
        { productId: 'insumo', productName: 'Insumo', quantity: 2 },
        { productId: 'embalagem', productName: 'Embalagem', quantity: 1 },
      ],
    },
    {
      id: 'combo-b',
      businessId: 'business-1',
      name: 'Combo B',
      currentStock: 0,
      components: [{ productId: 'insumo', productName: 'Insumo', quantity: 1 }],
    },
    { id: 'insumo', businessId: 'business-1', name: 'Insumo', currentStock: 5 },
    { id: 'embalagem', businessId: 'business-1', name: 'Embalagem', currentStock: 10 },
  ];

  it('substitui o produto composto pelos componentes multiplicados', () => {
    const expanded = expandBomLines(
      [{ productId: 'combo-a', quantity: 3 }],
      buildProductIndex(products),
    );

    expect(expanded).toEqual([
      {
        productId: 'insumo',
        productName: 'Insumo',
        quantity: 6,
        fromBom: true,
        parentProductId: 'combo-a',
      },
      {
        productId: 'embalagem',
        productName: 'Embalagem',
        quantity: 3,
        fromBom: true,
        parentProductId: 'combo-a',
      },
    ]);
  });

  it('agrega o mesmo insumo exigido por linhas diferentes antes de validar saldo', () => {
    const availability = checkBomAvailability(
      [
        { productId: 'combo-a', quantity: 2 },
        { productId: 'combo-b', quantity: 2 },
      ],
      buildProductIndex(products),
    );

    expect(availability.available).toBe(false);
    expect(availability.shortages).toEqual([
      expect.objectContaining({ productId: 'insumo', required: 6, available: 5 }),
    ]);
  });

  it('falha explicitamente quando uma linha referencia produto ausente', () => {
    expect(() =>
      expandBomLines(
        [{ productId: 'nao-existe', quantity: 1 }],
        buildProductIndex(products),
      ),
    ).toThrow(/productId não encontrado/);
  });
});

describe('M01 baseline — PurchaseNoteSchema e FSM', () => {
  it('aceita nota pendente canônica e valida total de cada item', () => {
    expect(PurchaseNoteSchema.safeParse(purchaseNote()).success).toBe(true);

    const inconsistentItemTotal = purchaseNote({
      items: [
        {
          productName: 'Produto de teste',
          unit: 'UN',
          quantity: 2,
          unitPrice: 10,
          total: 19,
        },
      ],
    });
    expect(PurchaseNoteSchema.safeParse(inconsistentItemTotal).success).toBe(false);
  });

  it('exige carimbo e IDs de movimentos quando a nota está importada', () => {
    expect(
      PurchaseNoteSchema.safeParse(purchaseNote({ status: 'importada' })).success,
    ).toBe(false);

    expect(
      PurchaseNoteSchema.safeParse(
        purchaseNote({ status: 'importada', stockImportedAt: NOW }),
      ).success,
    ).toBe(false);

    expect(
      PurchaseNoteSchema.safeParse(
        purchaseNote({
          status: 'importada',
          stockImportedAt: NOW,
          stockMovementIds: ['movement-1'],
        }),
      ).success,
    ).toBe(true);
  });

  it('registra o gap atual: shape totalProducts/totalTaxes/totalValue da UI não satisfaz o contrato', () => {
    const uiShape = {
      ...purchaseNote(),
      totalProducts: 20,
      totalTaxes: 0,
      totalValue: 20,
    } as Record<string, unknown>;
    delete uiShape.total;

    expect(PurchaseNoteSchema.safeParse(uiShape).success).toBe(false);
  });

  it('só permite pendente → importada/cancelada; estados finais não reabrem', () => {
    expect(canTransitionPurchaseNote('pendente', 'importada')).toBe(true);
    expect(canTransitionPurchaseNote('pendente', 'cancelada')).toBe(true);
    expect(canTransitionPurchaseNote('importada', 'pendente')).toBe(false);
    expect(canTransitionPurchaseNote('cancelada', 'pendente')).toBe(false);
    expect(() => assertTransitionPurchaseNote('importada', 'pendente')).toThrow(
      /transição inválida/,
    );

    expect(Object.keys(PURCHASE_NOTE_TRANSITIONS).sort()).toEqual(
      [...PURCHASE_NOTE_STATUSES].sort(),
    );
  });
});

describe('M01 baseline — StockMovementSchema', () => {
  const base = {
    id: 'movement-1',
    businessId: 'business-1',
    productId: 'product-1',
    productName: 'Produto de teste',
    reason: 'Caracterização',
    operatorId: 'user-1',
    operatorName: 'Usuário de teste',
    createdAt: NOW,
  };

  it('aceita entrada, saída e ajuste quando os saldos fecham', () => {
    expect(
      StockMovementSchema.safeParse({
        ...base,
        type: 'entrada',
        quantity: 3,
        previousStock: 2,
        newStock: 5,
      }).success,
    ).toBe(true);

    expect(
      StockMovementSchema.safeParse({
        ...base,
        type: 'saida',
        quantity: 3,
        previousStock: 5,
        newStock: 2,
      }).success,
    ).toBe(true);

    expect(
      StockMovementSchema.safeParse({
        ...base,
        type: 'ajuste',
        quantity: -2,
        previousStock: 5,
        newStock: 3,
      }).success,
    ).toBe(true);
  });

  it('rejeita movimento cujo saldo final não corresponde à operação', () => {
    expect(
      StockMovementSchema.safeParse({
        ...base,
        type: 'saida',
        quantity: 3,
        previousStock: 5,
        newStock: 4,
      }).success,
    ).toBe(false);
  });
});
