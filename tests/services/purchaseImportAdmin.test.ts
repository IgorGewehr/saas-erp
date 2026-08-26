import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  preparePurchaseNoteAdmin,
  PurchaseNoteDuplicateError,
} from '@/lib/services/purchase-import-admin';
import { parsePurchaseNFeXml } from '@/lib/services/purchase-xml-parser';

interface Ref { id: string; collection: string; get: () => Promise<Snapshot> }
interface Snapshot { id: string; exists: boolean; data: () => Record<string, unknown> | undefined }

function fakeDb() {
  const data = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  const snapshot = (collection: string, id: string): Snapshot => {
    const value = data.get(`${collection}/${id}`);
    return { id, exists: Boolean(value), data: () => value ? structuredClone(value) : undefined };
  };
  const ref = (collection: string, id?: string): Ref => ({
    id: id ?? `generated-${++sequence}`,
    collection,
    get: async function get() { return snapshot(this.collection, this.id); },
  });
  const query = (collection: string, filters: Array<[string, unknown]> = [], cap?: number): Record<string, unknown> => ({
    where(field: string, operator: string, value: unknown) {
      if (operator !== '==') throw new Error('unsupported operator');
      return query(collection, [...filters, [field, value]], cap);
    },
    limit(limit: number) { return query(collection, filters, limit); },
    async get() {
      const rows = [...data.entries()]
        .filter(([path, value]) => path.startsWith(`${collection}/`) && filters.every(([field, expected]) => value[field] === expected));
      const docs = (cap === undefined ? rows : rows.slice(0, cap))
        .map(([path]) => snapshot(collection, path.slice(collection.length + 1)));
      return { docs, empty: docs.length === 0 };
    },
  });
  const db = {
    collection(collection: string) { return { doc: (id?: string) => ref(collection, id), ...query(collection) }; },
    batch() {
      const updates: Array<{ target: Ref; value: Record<string, unknown> }> = [];
      return {
        update: (target: Ref, value: Record<string, unknown>) => updates.push({ target, value: structuredClone(value) }),
        async commit() {
          updates.forEach((write) => {
            const path = `${write.target.collection}/${write.target.id}`;
            data.set(path, { ...(data.get(path) ?? {}), ...write.value });
          });
        },
      };
    },
    async runTransaction<T>(handler: (tx: Record<string, unknown>) => Promise<T>): Promise<T> {
      const pending: Array<{ kind: 'create' | 'set' | 'delete'; ref: Ref; value?: Record<string, unknown> }> = [];
      const result = await handler({
        get: async (target: Ref) => snapshot(target.collection, target.id),
        create: (target: Ref, value: Record<string, unknown>) => pending.push({ kind: 'create', ref: target, value: structuredClone(value) }),
        set: (target: Ref, value: Record<string, unknown>) => pending.push({ kind: 'set', ref: target, value: structuredClone(value) }),
        delete: (target: Ref) => pending.push({ kind: 'delete', ref: target }),
      });
      pending.forEach((write) => {
        const path = `${write.ref.collection}/${write.ref.id}`;
        if (write.kind === 'delete') data.delete(path);
        else {
          if (write.kind === 'create' && data.has(path)) throw new Error('already exists');
          data.set(path, structuredClone(write.value!));
        }
      });
      return result;
    },
  };
  return {
    db: db as unknown as Firestore,
    seed(collection: string, id: string, value: Record<string, unknown>) { data.set(`${collection}/${id}`, structuredClone(value)); },
    list(collection: string) { return [...data.entries()].filter(([path]) => path.startsWith(`${collection}/`)).map(([path, value]) => ({ id: path.slice(collection.length + 1), value })); },
  };
}

const xml = readFileSync('tests/fixtures/m01/nfe-compra-caracterizacao.xml', 'utf8');
const parsed = parsePurchaseNFeXml({ xml, expectedRecipientDocument: '99876543000111' });
const actor = { uid: 'user-1', name: 'Gestor' };

function seedSupplier(fake: ReturnType<typeof fakeDb>, businessId: string) {
  fake.seed('suppliers', `supplier-${businessId}`, {
    schemaVersion: 2, id: `supplier-${businessId}`, businessId, documentType: 'cnpj',
    document: parsed.supplier.document, cnpj: parsed.supplier.document, razaoSocial: parsed.supplier.name,
    isActive: true, createdAt: '2026-08-25T10:00:00.000Z', updatedAt: '2026-08-25T10:00:00.000Z',
  });
}

describe('purchase import preparation core', () => {
  it('persiste nota V2 compatível, claim de chave e sugestões de produto', async () => {
    const fake = fakeDb();
    seedSupplier(fake, 'biz-1');
    fake.seed('products', 'product-1', {
      id: 'product-1', businessId: 'biz-1', isActive: true, name: 'Café em grãos', sku: 'FORN-001',
      barcode: '7891234567895', ncm: '09012100', unit: 'G', purchaseUnit: 'KG', purchaseToStockFactor: 1000,
    });
    const note = await preparePurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: 'note-1', parsed,
      xmlStoragePath: 'businesses/biz-1/purchase-notes/note-1/original.xml', originalFileName: 'compra.xml', actor,
    });
    expect(note).toMatchObject({
      schemaVersion: 2, id: 'note-1', businessId: 'biz-1', status: 'pendente',
      supplierId: 'supplier-biz-1', supplierCnpj: '12345678000199', totalValue: 375,
      xmlSha256: parsed.xmlSha256,
    });
    expect(note.items[0]).toMatchObject({
      matchSuggestions: [{ productId: 'product-1', confidence: 1 }],
      stockUnit: 'G', conversionFactor: 1000, stockQuantity: 10000,
    });
    expect(fake.list('purchaseNotes')).toHaveLength(1);
    expect(fake.list('purchaseNoteIdentifiers')).toHaveLength(1);
  });

  it('bloqueia a mesma chave no tenant e permite a chave em outro tenant', async () => {
    const fake = fakeDb();
    seedSupplier(fake, 'biz-1');
    seedSupplier(fake, 'biz-2');
    await preparePurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: 'note-1', parsed,
      xmlStoragePath: 'businesses/biz-1/purchase-notes/note-1/original.xml', originalFileName: 'a.xml', actor,
    });
    await expect(preparePurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: 'note-2', parsed,
      xmlStoragePath: 'businesses/biz-1/purchase-notes/note-2/original.xml', originalFileName: 'b.xml', actor,
    })).rejects.toBeInstanceOf(PurchaseNoteDuplicateError);
    await preparePurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-2', noteId: 'note-3', parsed,
      xmlStoragePath: 'businesses/biz-2/purchase-notes/note-3/original.xml', originalFileName: 'c.xml', actor,
    });
    expect(fake.list('purchaseNotes')).toHaveLength(2);
  });
});
