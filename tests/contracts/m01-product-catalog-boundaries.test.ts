import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CreateProductCatalogRequestSchema,
  ProductCatalogDataSchema,
  UpdateProductCatalogRequestSchema,
} from '@/lib/contracts/api/product-catalog';

const baseProduct = {
  name: 'Produto teste',
  category: 'Produto',
  unit: 'UN',
  purchaseUnit: 'UN',
  purchaseToStockFactor: 1,
  costMethod: 'moving_average' as const,
  costPrice: 10,
  salePrice: 20,
  minStock: 2,
  isActive: true,
  images: [],
  variants: [],
  isDeliverable: false,
  menuAvailable: true,
  trackStock: true,
  components: [],
  modifierGroups: [],
};

describe('M01.3a — boundaries server-side do catálogo', () => {
  it('separa estoque inicial dos metadados do produto', () => {
    const parsed = CreateProductCatalogRequestSchema.parse({
      businessId: 'biz-1',
      data: baseProduct,
      initialStock: 12,
      idempotencyKey: 'product:create:123',
    });
    expect(parsed.initialStock).toBe(12);
    expect('currentStock' in parsed.data).toBe(false);

    expect(ProductCatalogDataSchema.safeParse({ ...baseProduct, currentStock: 99 }).success).toBe(false);
  });

  it('aceita alvo de estoque apenas no envelope autenticado de atualização', () => {
    const parsed = UpdateProductCatalogRequestSchema.parse({
      businessId: 'biz-1',
      productId: 'product-1',
      data: { salePrice: 22 },
      targetStock: 4,
      idempotencyKey: 'product:update:123',
    });
    expect(parsed.targetStock).toBe(4);
    expect(parsed.data.salePrice).toBe(22);
  });

  it('limita imagens e valida os contratos das variações', () => {
    const tooManyImages = Array.from({ length: 9 }, (_, index) => ({
      id: `img-${index}`,
      url: `https://example.com/${index}.jpg`,
      sortOrder: index,
    }));
    expect(ProductCatalogDataSchema.safeParse({ ...baseProduct, images: tooManyImages }).success).toBe(false);

    expect(ProductCatalogDataSchema.safeParse({
      ...baseProduct,
      variants: [{ id: 'v1', name: '', salePrice: -1 }],
    }).success).toBe(false);
  });

  it('remove persistência e upload direto do componente visual', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'app/components/features/inventory/InventoryModule.tsx'),
      'utf8',
    );
    expect(source).not.toContain("addDoc(collection(db, 'products')");
    expect(source).not.toContain("updateDoc(doc(db, 'products'");
    expect(source).not.toContain("deleteDoc(doc(db, 'products'");
    expect(source).not.toContain('uploadBytes(');
    expect(source).toContain('createCatalogProduct');
    expect(source).toContain('archiveCatalogProduct');
  });
});
