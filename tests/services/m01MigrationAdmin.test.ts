import { describe, expect, it } from 'vitest';
import {
  planM01DocumentMigration,
} from '@/lib/services/m01-migration-admin';
import {
  decodeFirestorePageCursor,
  encodeFirestorePageCursor,
} from '@/lib/services/firestore-page-cursor';

const NOW = '2026-08-28T15:00:00.000Z';
const BUSINESS_ID = 'business-1';

describe('M01.8 — planejamento idempotente da migração', () => {
  it('preserva estoque e imageUrl ao promover produto legado e é idempotente', () => {
    const raw = {
      businessId: BUSINESS_ID,
      name: ' Café em grãos ',
      category: 'Mercearia',
      unit: 'UN',
      sku: ' cafe 001 ',
      barcode: '789-123',
      costPrice: 12,
      salePrice: 25,
      currentStock: 17,
      minStock: 2,
      maxStock: null,
      imageUrl: 'https://example.com/cafe.jpg',
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const first = planM01DocumentMigration({
      entity: 'products',
      documentId: 'product-1',
      businessId: BUSINESS_ID,
      raw,
      now: NOW,
    });

    expect(first.status).toBe('update');
    expect({ ...raw, ...first.patch }).toMatchObject({
      schemaVersion: 2,
      currentStock: 17,
      imageUrl: 'https://example.com/cafe.jpg',
      skuNormalized: 'CAFE 001',
      barcodeNormalized: '789123',
    });
    expect(first.patch.images).toEqual([
      expect.objectContaining({ url: 'https://example.com/cafe.jpg', isPrimary: true }),
    ]);
    expect(first.claims).toHaveLength(2);

    const second = planM01DocumentMigration({
      entity: 'products',
      documentId: 'product-1',
      businessId: BUSINESS_ID,
      raw: { ...raw, ...first.patch },
      now: NOW,
    });
    expect(second.status).toBe('unchanged');
    expect(second.patch).toEqual({});
  });

  it('normaliza fornecedor e gera claim determinístico do documento', () => {
    const plan = planM01DocumentMigration({
      entity: 'suppliers',
      documentId: 'supplier-1',
      businessId: BUSINESS_ID,
      now: NOW,
      raw: {
        businessId: BUSINESS_ID,
        razaoSocial: 'Fornecedor Ltda',
        cnpj: '12.345.678/0001-99',
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    expect(plan.status).toBe('update');
    expect(plan.patch).toMatchObject({
      schemaVersion: 2,
      documentType: 'cnpj',
      document: '12345678000199',
      cnpj: '12345678000199',
    });
    expect(plan.claims).toEqual([
      expect.objectContaining({
        collection: 'supplierIdentifiers',
        ownerField: 'supplierId',
        ownerId: 'supplier-1',
      }),
    ]);
  });

  it('mantém aliases V1 da nota ao gravar o contrato V2', () => {
    const plan = planM01DocumentMigration({
      entity: 'purchaseNotes',
      documentId: 'note-1',
      businessId: BUSINESS_ID,
      now: NOW,
      raw: {
        businessId: BUSINESS_ID,
        accessKey: '3'.repeat(44),
        numero: '123',
        serie: '1',
        issueDate: NOW,
        supplierName: 'Fornecedor Ltda',
        supplierCnpj: '12345678000199',
        items: [{
          productName: 'Café',
          cProd: 'CAFE-1',
          unit: 'CX',
          quantity: 2,
          unitPrice: 25,
          total: 50,
        }],
        totalProducts: 50,
        totalTaxes: 0,
        totalValue: 50,
        status: 'pendente',
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    expect(plan.status).toBe('update');
    expect({
      supplierName: 'Fornecedor Ltda',
      supplierCnpj: '12345678000199',
      totalProducts: 50,
      totalValue: 50,
      ...plan.patch,
    }).toMatchObject({
      schemaVersion: 2,
      supplierName: 'Fornecedor Ltda',
      supplierCnpj: '12345678000199',
      totalProducts: 50,
      totalValue: 50,
    });
    expect(plan.patch.items).toEqual([
      expect.objectContaining({
        purchaseQuantity: 2,
        quantity: 2,
        purchaseUnit: 'CX',
        unit: 'CX',
        productTotal: 50,
        total: 50,
      }),
    ]);
    expect(plan.claims[0]).toMatchObject({
      collection: 'purchaseNoteIdentifiers',
      ownerId: 'note-1',
    });
  });

  it('correlaciona movimento legado pela chave idempotente', () => {
    const plan = planM01DocumentMigration({
      entity: 'stockMovements',
      documentId: 'movement-1',
      businessId: BUSINESS_ID,
      now: NOW,
      raw: {
        businessId: BUSINESS_ID,
        productId: 'product-1',
        productName: 'Café',
        type: 'entrada',
        quantity: 3,
        previousStock: 2,
        newStock: 5,
        reason: 'Contagem',
        operatorId: 'user-1',
        operatorName: 'Operador',
        createdAt: NOW,
      },
    });
    expect(plan.patch).toMatchObject({
      schemaVersion: 2,
      idempotencyKey: 'legacy:movement-1',
      correlationId: 'legacy:movement-1',
      balanceAccuracy: 'legacy_best_effort',
    });
  });

  it('recusa documento de outro tenant', () => {
    const plan = planM01DocumentMigration({
      entity: 'products',
      documentId: 'product-1',
      businessId: BUSINESS_ID,
      now: NOW,
      raw: { businessId: 'business-2' },
    });
    expect(plan.status).toBe('invalid');
    expect(plan.errors[0]).toContain('diverge');
  });
});

describe('M01.8 — cursores opacos', () => {
  it('faz round-trip e rejeita cursores inválidos', () => {
    const encoded = encodeFirestorePageCursor({
      sortValue: '2026-08-28T15:00:00.000Z',
      documentId: 'document-1',
    });
    expect(decodeFirestorePageCursor(encoded)).toEqual({
      sortValue: '2026-08-28T15:00:00.000Z',
      documentId: 'document-1',
    });
    expect(decodeFirestorePageCursor('não-é-um-cursor')).toBeNull();
  });
});
