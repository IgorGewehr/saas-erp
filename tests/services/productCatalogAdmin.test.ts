import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { ProductCatalogData } from '@/lib/contracts/api/product-catalog';
import {
  archiveProductCatalogAdmin,
  createProductCatalogAdmin,
  normalizeBarcode,
  normalizeSku,
  ProductCatalogDuplicateIdentifierError,
  ProductCatalogLotTrackingError,
  updateProductCatalogAdmin,
} from '@/lib/services/product-catalog-admin';

interface FakeRef {
  id: string;
  _collection: string;
  get: () => Promise<FakeSnapshot>;
  update: (patch: Record<string, unknown>) => Promise<void>;
}

interface FakeSnapshot {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function makeFakeDb() {
  const documents = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  let beforeTransaction: (() => void) | undefined;

  const snapshot = (collection: string, id: string): FakeSnapshot => {
    const data = documents.get(`${collection}/${id}`);
    return {
      id,
      exists: Boolean(data),
      data: () => (data ? clone(data) : undefined),
    };
  };

  const makeRef = (collection: string, id?: string): FakeRef => {
    const resolvedId = id ?? `generated-${++sequence}`;
    return {
      id: resolvedId,
      _collection: collection,
      get: async () => snapshot(collection, resolvedId),
      update: async (patch) => {
        const path = `${collection}/${resolvedId}`;
        const current = documents.get(path);
        if (!current) throw new Error(`Documento ausente: ${path}`);
        documents.set(path, { ...current, ...clone(patch) });
      },
    };
  };

  const db = {
    collection(collection: string) {
      return {
        doc(id?: string) {
          return makeRef(collection, id);
        },
        where(field: string, operator: string, expected: unknown) {
          if (operator !== '==') throw new Error(`Operador não suportado: ${operator}`);
          return {
            async get() {
              const docs = [...documents.entries()]
                .filter(([path, data]) => path.startsWith(`${collection}/`) && data[field] === expected)
                .map(([path]) => snapshot(collection, path.slice(collection.length + 1)));
              return { docs, empty: docs.length === 0 };
            },
          };
        },
      };
    },
    async runTransaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      beforeTransaction?.();
      beforeTransaction = undefined;
      const pending: Array<
        | { kind: 'set' | 'create'; ref: FakeRef; data: Record<string, unknown> }
        | { kind: 'delete'; ref: FakeRef }
      > = [];
      const tx = {
        get: async (ref: FakeRef) => snapshot(ref._collection, ref.id),
        set: (ref: FakeRef, data: Record<string, unknown>) => {
          pending.push({ kind: 'set', ref, data: clone(data) });
        },
        create: (ref: FakeRef, data: Record<string, unknown>) => {
          pending.push({ kind: 'create', ref, data: clone(data) });
        },
        delete: (ref: FakeRef) => pending.push({ kind: 'delete', ref }),
      };
      const result = await handler(tx);
      for (const write of pending) {
        const path = `${write.ref._collection}/${write.ref.id}`;
        if (write.kind === 'delete') {
          documents.delete(path);
        } else {
          if (write.kind === 'create' && documents.has(path)) throw new Error(`Documento existente: ${path}`);
          documents.set(path, clone(write.data));
        }
      }
      return result;
    },
  };

  return {
    db: db as unknown as Firestore,
    list(collection: string) {
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(`${collection}/`))
        .map(([path, data]) => ({ id: path.slice(collection.length + 1), data: clone(data) }));
    },
    patchBeforeNextTransaction(path: string, patch: Record<string, unknown>) {
      beforeTransaction = () => {
        const current = documents.get(path);
        if (!current) throw new Error(`Documento ausente: ${path}`);
        documents.set(path, { ...current, ...clone(patch) });
      };
    },
  };
}

function productData(overrides: Partial<ProductCatalogData> = {}): ProductCatalogData {
  return {
    name: 'Café Especial',
    sku: ' cafe-001 ',
    barcode: '789 123-456',
    category: 'Produto',
    unit: 'UN',
    purchaseUnit: 'CX',
    purchaseToStockFactor: 12,
    costMethod: 'moving_average',
    costPrice: 10,
    salePrice: 18,
    minStock: 3,
    isActive: true,
    images: [],
    variants: [],
    isDeliverable: false,
    menuAvailable: true,
    trackStock: true,
    components: [],
    modifierGroups: [],
    ...overrides,
  };
}

describe('product catalog admin core', () => {
  it('normaliza identificadores e persiste produto V2 com claims por tenant', async () => {
    const fake = makeFakeDb();
    const product = await createProductCatalogAdmin({
      db: fake.db,
      businessId: 'biz-1',
      data: productData(),
    });

    expect(normalizeSku(' cafe-001 ')).toBe('CAFE-001');
    expect(normalizeBarcode('789 123-456')).toBe('789123456');
    expect(product).toMatchObject({
      businessId: 'biz-1',
      schemaVersion: 2,
      kind: 'simple',
      skuNormalized: 'CAFE-001',
      barcodeNormalized: '789123456',
      currentStock: 0,
      purchaseUnit: 'CX',
      purchaseToStockFactor: 12,
    });
    expect(fake.list('productIdentifiers')).toHaveLength(2);
  });

  it('rejeita SKU repetido no mesmo tenant mesmo com caixa e espaços diferentes', async () => {
    const fake = makeFakeDb();
    await createProductCatalogAdmin({ db: fake.db, businessId: 'biz-1', data: productData() });

    await expect(createProductCatalogAdmin({
      db: fake.db,
      businessId: 'biz-1',
      data: productData({ name: 'Outro café', sku: 'CAFE-001', barcode: '999' }),
    })).rejects.toBeInstanceOf(ProductCatalogDuplicateIdentifierError);
    expect(fake.list('products')).toHaveLength(1);
  });

  it('permite o mesmo SKU em tenants diferentes', async () => {
    const fake = makeFakeDb();
    await createProductCatalogAdmin({ db: fake.db, businessId: 'biz-1', data: productData() });
    await createProductCatalogAdmin({ db: fake.db, businessId: 'biz-2', data: productData() });

    expect(fake.list('products')).toHaveLength(2);
    expect(fake.list('productIdentifiers')).toHaveLength(4);
  });

  it('troca os claims ao editar SKU e código de barras', async () => {
    const fake = makeFakeDb();
    const created = await createProductCatalogAdmin({ db: fake.db, businessId: 'biz-1', data: productData() });
    const updated = await updateProductCatalogAdmin({
      db: fake.db,
      businessId: 'biz-1',
      productId: created.id,
      patch: { sku: 'CAFE-002', barcode: '222333' },
    });

    expect(updated.skuNormalized).toBe('CAFE-002');
    expect(updated.barcodeNormalized).toBe('222333');
    expect(fake.list('productIdentifiers')).toHaveLength(2);
    expect(fake.list('productIdentifiers').every((claim) => claim.data.productId === created.id)).toBe(true);
  });

  it('reconstrói metadados dentro da transação sem sobrescrever saldo concorrente', async () => {
    const fake = makeFakeDb();
    const created = await createProductCatalogAdmin({ db: fake.db, businessId: 'biz-1', data: productData() });
    fake.patchBeforeNextTransaction(`products/${created.id}`, {
      currentStock: 7,
      updatedAt: '2026-08-25T18:00:00.000Z',
    });

    const updated = await updateProductCatalogAdmin({
      db: fake.db,
      businessId: 'biz-1',
      productId: created.id,
      patch: { salePrice: 21 },
    });
    expect(updated.currentStock).toBe(7);
    expect(updated.salePrice).toBe(21);
    expect(fake.list('products')[0].data.currentStock).toBe(7);
  });

  it('arquiva sem apagar produto nem liberar seus identificadores', async () => {
    const fake = makeFakeDb();
    const created = await createProductCatalogAdmin({ db: fake.db, businessId: 'biz-1', data: productData() });
    const archived = await archiveProductCatalogAdmin({
      db: fake.db,
      businessId: 'biz-1',
      productId: created.id,
      actor: { uid: 'user-1', name: 'Gestor' },
    });

    expect(archived).toMatchObject({ isActive: false, menuAvailable: false, archivedBy: 'user-1' });
    expect(archived.archivedAt).toBeTruthy();
    expect(fake.list('products')).toHaveLength(1);
    expect(fake.list('productIdentifiers')).toHaveLength(2);
  });

  it('reserva identificadores de variação e não aceita saldo aninhado fora do núcleo de estoque', async () => {
    const fake = makeFakeDb();
    const created = await createProductCatalogAdmin({
      db: fake.db,
      businessId: 'biz-1',
      data: productData({
        sku: undefined,
        barcode: undefined,
        variants: [{
          id: 'v1',
          name: 'Pacote 250g',
          attributes: { peso: '250g' },
          sku: 'CAFE-250',
          barcode: '250250',
          salePrice: 18,
          costPrice: 10,
          currentStock: 12,
          minStock: 2,
          trackStock: true,
          isActive: true,
        }],
      }),
    });
    expect(created.kind).toBe('variant');
    expect(created.trackStock).toBe(false);
    expect(created.variants?.[0].currentStock).toBe(0);
    expect(fake.list('productIdentifiers')).toHaveLength(2);

    const updated = await updateProductCatalogAdmin({
      db: fake.db,
      businessId: 'biz-1',
      productId: created.id,
      patch: { variants: [{ ...created.variants![0], currentStock: 99, salePrice: 20 }] },
    });
    expect(updated.variants?.[0]).toMatchObject({ currentStock: 0, salePrice: 20 });
  });

  it('rejeita colisão entre o SKU principal e uma variação', async () => {
    const fake = makeFakeDb();
    await expect(createProductCatalogAdmin({
      db: fake.db,
      businessId: 'biz-1',
      data: productData({
        variants: [{
          id: 'v1',
          name: '250g',
          attributes: { peso: '250g' },
          sku: 'CAFE-001',
          salePrice: 18,
          costPrice: 10,
          currentStock: 0,
          minStock: 0,
          trackStock: true,
          isActive: true,
        }],
      }),
    })).rejects.toBeInstanceOf(ProductCatalogDuplicateIdentifierError);
  });

  it('persiste configuração de lote e validade com padrões compatíveis', async () => {
    const fake = makeFakeDb();
    const regular = await createProductCatalogAdmin({ db: fake.db, businessId: 'biz-1', data: productData() });
    const tracked = await createProductCatalogAdmin({
      db: fake.db,
      businessId: 'biz-1',
      data: productData({ name: 'Leite', sku: 'LEITE-1', barcode: '111', trackLots: true, trackExpiry: true, expiryWarningDays: 20 }),
    });

    expect(regular).toMatchObject({ trackLots: false, trackExpiry: false, expiryWarningDays: 30 });
    expect(tracked).toMatchObject({ trackLots: true, trackExpiry: true, expiryWarningDays: 20 });
  });

  it('bloqueia alteração do rastreamento quando já existe saldo', async () => {
    const fake = makeFakeDb();
    const created = await createProductCatalogAdmin({ db: fake.db, businessId: 'biz-1', data: productData() });
    fake.patchBeforeNextTransaction(`products/${created.id}`, { currentStock: 4 });

    await expect(updateProductCatalogAdmin({
      db: fake.db,
      businessId: 'biz-1',
      productId: created.id,
      patch: { trackLots: true },
    })).rejects.toBeInstanceOf(ProductCatalogLotTrackingError);
  });
});
