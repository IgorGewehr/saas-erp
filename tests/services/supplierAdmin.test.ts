import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { SupplierCatalogData } from '@/lib/contracts/api/supplier-catalog';
import {
  archiveSupplierAdmin,
  createSupplierAdmin,
  getSupplierRelationsAdmin,
  normalizeSupplierDocument,
  SupplierDuplicateDocumentError,
  SupplierNotFoundError,
  updateSupplierAdmin,
} from '@/lib/services/supplier-admin';

interface FakeRef {
  id: string;
  _collection: string;
  get: () => Promise<FakeSnapshot>;
}

interface FakeSnapshot {
  id: string;
  exists: boolean;
  ref: FakeRef;
  data: () => Record<string, unknown> | undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function makeFakeDb() {
  const documents = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const makeRef = (collection: string, id?: string): FakeRef => {
    const resolved = id ?? `generated-${++sequence}`;
    return {
      id: resolved,
      _collection: collection,
      get: async () => makeSnapshot(collection, resolved),
    };
  };
  const makeSnapshot = (collection: string, id: string): FakeSnapshot => {
    const data = documents.get(`${collection}/${id}`);
    const ref = makeRef(collection, id);
    return { id, exists: Boolean(data), ref, data: () => data ? clone(data) : undefined };
  };

  const makeQuery = (
    collection: string,
    filters: Array<{ field: string; expected: unknown }> = [],
    cap?: number,
    cursor?: string,
  ): Record<string, unknown> => ({
    where(field: string, operator: string, expected: unknown) {
      if (operator !== '==') throw new Error(`Operador não suportado: ${operator}`);
      return makeQuery(collection, [...filters, { field, expected }], cap, cursor);
    },
    orderBy() { return makeQuery(collection, filters, cap, cursor); },
    limit(limit: number) { return makeQuery(collection, filters, limit, cursor); },
    startAfter(nextCursor: string) { return makeQuery(collection, filters, cap, nextCursor); },
    async get() {
      let rows = [...documents.entries()]
        .filter(([path, data]) => path.startsWith(`${collection}/`) && filters.every((filter) => data[filter.field] === filter.expected))
        .sort(([left], [right]) => left.localeCompare(right));
      if (cursor) rows = rows.filter(([path]) => path.slice(collection.length + 1) > cursor);
      if (cap !== undefined) rows = rows.slice(0, cap);
      const docs = rows.map(([path]) => makeSnapshot(collection, path.slice(collection.length + 1)));
      return { docs, empty: docs.length === 0 };
    },
  });

  const db = {
    collection(collection: string) {
      return {
        doc(id?: string) { return makeRef(collection, id); },
        ...makeQuery(collection),
      };
    },
    batch() {
      const updates: Array<{ ref: FakeRef; patch: Record<string, unknown> }> = [];
      return {
        update(ref: FakeRef, patch: Record<string, unknown>) { updates.push({ ref, patch: clone(patch) }); },
        async commit() {
          updates.forEach(({ ref, patch }) => {
            const path = `${ref._collection}/${ref.id}`;
            const current = documents.get(path);
            if (!current) throw new Error(`Documento ausente: ${path}`);
            documents.set(path, { ...current, ...patch });
          });
        },
      };
    },
    async runTransaction<T>(handler: (tx: Record<string, unknown>) => Promise<T>): Promise<T> {
      const pending: Array<{ kind: 'create' | 'set' | 'delete'; ref: FakeRef; data?: Record<string, unknown> }> = [];
      const result = await handler({
        get: async (ref: FakeRef) => makeSnapshot(ref._collection, ref.id),
        create: (ref: FakeRef, data: Record<string, unknown>) => pending.push({ kind: 'create', ref, data: clone(data) }),
        set: (ref: FakeRef, data: Record<string, unknown>) => pending.push({ kind: 'set', ref, data: clone(data) }),
        delete: (ref: FakeRef) => pending.push({ kind: 'delete', ref }),
      });
      pending.forEach((write) => {
        const path = `${write.ref._collection}/${write.ref.id}`;
        if (write.kind === 'delete') documents.delete(path);
        else {
          if (write.kind === 'create' && documents.has(path)) throw new Error(`Documento existente: ${path}`);
          documents.set(path, clone(write.data!));
        }
      });
      return result;
    },
  };

  return {
    db: db as unknown as Firestore,
    seed(collection: string, id: string, data: Record<string, unknown>) {
      documents.set(`${collection}/${id}`, clone(data));
    },
    list(collection: string) {
      return [...documents.entries()]
        .filter(([path]) => path.startsWith(`${collection}/`))
        .map(([path, data]) => ({ id: path.slice(collection.length + 1), data: clone(data) }));
    },
  };
}

const actor = { uid: 'user-1', name: 'Gestor' };
function supplierData(overrides: Partial<SupplierCatalogData> = {}): SupplierCatalogData {
  return {
    documentType: 'cnpj',
    document: '12.345.678/0001-99',
    razaoSocial: 'Fornecedor Exemplo LTDA',
    nomeFantasia: 'Fornecedor Exemplo',
    phone: '(11) 99999-9999',
    email: 'compras@fornecedor.test',
    paymentTerms: '30/60 dias',
    leadTimeDays: 7,
    minimumOrderValue: 500,
    orderMultiple: 6,
    isActive: true,
    ...overrides,
  };
}

describe('supplier admin core', () => {
  it('normaliza documento, cria claim/histórico e vincula nota legada do mesmo tenant', async () => {
    const fake = makeFakeDb();
    fake.seed('purchaseNotes', 'note-1', {
      businessId: 'biz-1', supplierCnpj: '12.345.678/0001-99', updatedAt: 'old',
    });
    fake.seed('purchaseNotes', 'note-other', {
      businessId: 'biz-2', supplierCnpj: '12345678000199', updatedAt: 'old',
    });
    const supplier = await createSupplierAdmin({ db: fake.db, businessId: 'biz-1', data: supplierData(), actor });

    expect(normalizeSupplierDocument('12.345.678/0001-99')).toBe('12345678000199');
    expect(supplier).toMatchObject({
      schemaVersion: 2,
      businessId: 'biz-1',
      documentType: 'cnpj',
      document: '12345678000199',
      cnpj: '12345678000199',
      isActive: true,
      leadTimeDays: 7,
    });
    expect(fake.list('supplierIdentifiers')).toHaveLength(1);
    expect(fake.list('supplierHistory')[0].data).toMatchObject({ supplierId: supplier.id, action: 'created' });
    expect(fake.list('purchaseNotes').find((row) => row.id === 'note-1')?.data.supplierId).toBe(supplier.id);
    expect(fake.list('purchaseNotes').find((row) => row.id === 'note-other')?.data.supplierId).toBeUndefined();
  });

  it('impede documento duplicado no tenant e permite o mesmo documento em outro tenant', async () => {
    const fake = makeFakeDb();
    await createSupplierAdmin({ db: fake.db, businessId: 'biz-1', data: supplierData(), actor });
    await expect(createSupplierAdmin({
      db: fake.db,
      businessId: 'biz-1',
      data: supplierData({ razaoSocial: 'Duplicado' }),
      actor,
    })).rejects.toBeInstanceOf(SupplierDuplicateDocumentError);
    await createSupplierAdmin({ db: fake.db, businessId: 'biz-2', data: supplierData(), actor });
    expect(fake.list('suppliers')).toHaveLength(2);
  });

  it('troca o claim ao editar documento e mantém trilha auditável', async () => {
    const fake = makeFakeDb();
    const supplier = await createSupplierAdmin({ db: fake.db, businessId: 'biz-1', data: supplierData(), actor });
    const updated = await updateSupplierAdmin({
      db: fake.db,
      businessId: 'biz-1',
      supplierId: supplier.id,
      patch: { document: '98765432000188', razaoSocial: 'Fornecedor Atualizado' },
      actor,
    });
    expect(updated).toMatchObject({ document: '98765432000188', cnpj: '98765432000188', razaoSocial: 'Fornecedor Atualizado' });
    expect(fake.list('supplierIdentifiers')).toHaveLength(1);
    expect(fake.list('supplierHistory').map((entry) => entry.data.action)).toEqual(['created', 'updated']);
  });

  it('inativa sem exclusão e nega acesso cruzado por businessId', async () => {
    const fake = makeFakeDb();
    const supplier = await createSupplierAdmin({ db: fake.db, businessId: 'biz-1', data: supplierData(), actor });
    const archived = await archiveSupplierAdmin({ db: fake.db, businessId: 'biz-1', supplierId: supplier.id, actor });
    expect(archived).toMatchObject({ isActive: false, archivedBy: actor.uid });
    expect(archived.archivedAt).toBeTruthy();
    expect(fake.list('suppliers')).toHaveLength(1);
    await expect(updateSupplierAdmin({
      db: fake.db,
      businessId: 'biz-2',
      supplierId: supplier.id,
      patch: { razaoSocial: 'Invasão' },
      actor,
    })).rejects.toBeInstanceOf(SupplierNotFoundError);
  });

  it('relaciona notas, movimentos e produtos sem atravessar tenants', async () => {
    const fake = makeFakeDb();
    const supplier = await createSupplierAdmin({ db: fake.db, businessId: 'biz-1', data: supplierData(), actor });
    fake.seed('purchaseNotes', 'note-1', {
      id: 'note-1', businessId: 'biz-1', supplierId: supplier.id, supplierName: supplier.razaoSocial,
      supplierCnpj: supplier.document, numero: '10', serie: '1', issueDate: '2026-08-20',
      accessKey: '', items: [], totalProducts: 100, totalTaxes: 0, totalValue: 100,
      status: 'importada', stockMovementIds: ['move-1', 'move-other'], createdAt: '2026-08-20', updatedAt: '2026-08-20',
    });
    fake.seed('stockMovements', 'move-1', { businessId: 'biz-1', productId: 'product-1', type: 'entrada' });
    fake.seed('stockMovements', 'move-other', { businessId: 'biz-2', productId: 'product-other', type: 'entrada' });
    fake.seed('products', 'product-1', { businessId: 'biz-1', name: 'Produto comprado' });
    fake.seed('products', 'product-other', { businessId: 'biz-2', name: 'Produto externo' });

    const relations = await getSupplierRelationsAdmin({ db: fake.db, businessId: 'biz-1', supplierId: supplier.id });
    expect(relations.purchaseNotes.map((note) => note.id)).toEqual(['note-1']);
    expect(relations.stockMovements.map((movement) => movement.id)).toEqual(['move-1']);
    expect(relations.products.map((product) => product.id)).toEqual(['product-1']);
  });
});
