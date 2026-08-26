import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  preparePurchaseNoteAdmin,
  confirmPurchaseNoteAdmin,
  PurchaseNoteClaimConflictError,
  PurchaseNoteDuplicateError,
  PurchaseNoteNotReviewableError,
  reviewPurchaseNoteAdmin,
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
      const pending: Array<{ kind: 'create' | 'set' | 'update' | 'delete'; ref: Ref; value?: Record<string, unknown> }> = [];
      const result = await handler({
        get: async (target: Ref) => snapshot(target.collection, target.id),
        create: (target: Ref, value: Record<string, unknown>) => pending.push({ kind: 'create', ref: target, value: structuredClone(value) }),
        set: (target: Ref, value: Record<string, unknown>) => pending.push({ kind: 'set', ref: target, value: structuredClone(value) }),
        update: (target: Ref, value: Record<string, unknown>) => pending.push({ kind: 'update', ref: target, value: structuredClone(value) }),
        delete: (target: Ref) => pending.push({ kind: 'delete', ref: target }),
      });
      pending.forEach((write) => {
        const path = `${write.ref.collection}/${write.ref.id}`;
        if (write.kind === 'delete') data.delete(path);
        else if (write.kind === 'update') {
          if (!data.has(path)) throw new Error('document does not exist');
          data.set(path, { ...data.get(path), ...structuredClone(write.value!) });
        }
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

  it('salva a decisão de todos os itens sem movimentar estoque', async () => {
    const fake = fakeDb();
    seedSupplier(fake, 'biz-1');
    fake.seed('products', 'product-1', {
      id: 'product-1', businessId: 'biz-1', isActive: true, name: 'Café em grãos', sku: 'FORN-001',
      barcode: '7891234567895', ncm: '09012100', unit: 'G', purchaseUnit: 'KG', purchaseToStockFactor: 1000,
    });
    const prepared = await preparePurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: 'note-reviewed', parsed,
      xmlStoragePath: 'businesses/biz-1/purchase-notes/note-reviewed/original.xml', originalFileName: 'review.xml', actor,
    });

    const reviewed = await reviewPurchaseNoteAdmin({
      db: fake.db,
      businessId: 'biz-1',
      noteId: prepared.id,
      actor,
      notes: 'Revisão conferida',
      items: [
        {
          lineId: prepared.items[0].lineId,
          action: 'match',
          productId: 'product-1',
          conversionFactor: 1000,
          landedUnitCost: 0.0321,
          lot: { code: 'LOTE-CAFÉ', expiresAt: '2027-08-25' },
        },
        {
          lineId: prepared.items[1].lineId,
          action: 'create',
          conversionFactor: 10,
          landedUnitCost: 6,
          newProduct: { name: 'Caixa para transporte', category: 'Embalagens', unit: 'UN', sku: 'FORN-002' },
        },
      ],
    });

    expect(reviewed).toMatchObject({
      id: 'note-reviewed', status: 'pendente', reviewedBy: 'user-1', reviewedByName: 'Gestor',
      notes: 'Revisão conferida', stockMovementIds: [],
    });
    expect(reviewed.items[0]).toMatchObject({
      action: 'match', importAction: 'match', productId: 'product-1', stockUnit: 'G',
      conversionFactor: 1000, stockQuantity: 10000, importStatus: 'pending', lot: { code: 'LOTE-CAFÉ' },
    });
    expect(reviewed.items[1]).toMatchObject({
      action: 'create', importAction: 'create', stockUnit: 'UN', conversionFactor: 10,
      stockQuantity: 50, newProduct: { category: 'Embalagens' }, importStatus: 'pending',
    });
    expect(fake.list('stockMovements')).toHaveLength(0);
  });

  it('rejeita vínculo com produto de outro tenant', async () => {
    const fake = fakeDb();
    seedSupplier(fake, 'biz-1');
    const prepared = await preparePurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: 'note-tenant', parsed,
      xmlStoragePath: 'businesses/biz-1/purchase-notes/note-tenant/original.xml', originalFileName: 'tenant.xml', actor,
    });
    fake.seed('products', 'foreign-product', {
      id: 'foreign-product', businessId: 'biz-2', isActive: true, name: 'Produto externo', unit: 'UN',
    });

    await expect(reviewPurchaseNoteAdmin({
      db: fake.db,
      businessId: 'biz-1',
      noteId: prepared.id,
      actor,
      items: prepared.items.map((item, index) => index === 0
        ? { lineId: item.lineId, action: 'match' as const, productId: 'foreign-product', conversionFactor: 1, landedUnitCost: item.landedUnitCost }
        : { lineId: item.lineId, action: 'skip' as const, conversionFactor: 1, landedUnitCost: item.landedUnitCost }),
    })).rejects.toBeInstanceOf(PurchaseNoteNotReviewableError);
  });

  it('confirma itens revisados, cria produto e não duplica saldo ou movimento no replay', async () => {
    const fake = fakeDb();
    seedSupplier(fake, 'biz-1');
    fake.seed('products', 'product-1', {
      id: 'product-1', businessId: 'biz-1', isActive: true, name: 'Café em grãos', sku: 'FORN-001',
      barcode: '7891234567895', ncm: '09012100', unit: 'KG', purchaseUnit: 'KG', purchaseToStockFactor: 1,
      currentStock: 10, costPrice: 2, salePrice: 10, minStock: 0,
    });
    const prepared = await preparePurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: 'note-confirm', parsed,
      xmlStoragePath: 'businesses/biz-1/purchase-notes/note-confirm/original.xml', originalFileName: 'confirm.xml', actor,
    });
    await reviewPurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: prepared.id, actor,
      items: [
        { lineId: prepared.items[0].lineId, action: 'match', productId: 'product-1', conversionFactor: 1, landedUnitCost: 8 },
        {
          lineId: prepared.items[1].lineId, action: 'create', conversionFactor: 10, landedUnitCost: 6,
          newProduct: { name: 'Caixa para transporte', category: 'Embalagens', unit: 'UN', sku: 'CAIXA-NOVA' },
        },
      ],
    });

    const first = await confirmPurchaseNoteAdmin({ db: fake.db, businessId: 'biz-1', noteId: prepared.id, actor });
    const replay = await confirmPurchaseNoteAdmin({ db: fake.db, businessId: 'biz-1', noteId: prepared.id, actor });

    expect(first).toMatchObject({ replayed: false, importedCount: 2, skippedCount: 0, errorCount: 0 });
    expect(first.note).toMatchObject({ status: 'importada', importedBy: 'user-1' });
    expect(first.note.stockMovementIds).toHaveLength(2);
    expect(first.note.items.every((item) => item.importStatus === 'imported' && item.stockMovementId)).toBe(true);
    expect(replay).toMatchObject({ replayed: true, importedCount: 2, errorCount: 0 });
    expect(fake.list('stockMovements')).toHaveLength(2);
    expect(fake.list('stockOperations')).toHaveLength(2);
    expect(fake.list('products').find((item) => item.id === 'product-1')?.value).toMatchObject({ currentStock: 20, costPrice: 5 });
    const created = fake.list('products').find((item) => item.id.startsWith('purchase_product_'));
    expect(created?.value).toMatchObject({ name: 'Caixa para transporte', currentStock: 50, costPrice: 6, menuAvailable: false });
  });

  it('fecha como parcial quando uma linha falha e preserva o resultado importado', async () => {
    const fake = fakeDb();
    seedSupplier(fake, 'biz-1');
    fake.seed('products', 'product-1', {
      id: 'product-1', businessId: 'biz-1', isActive: true, name: 'Café em grãos', sku: 'FORN-001',
      unit: 'KG', currentStock: 0, costPrice: 0, salePrice: 10, minStock: 0,
    });
    const prepared = await preparePurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: 'note-partial', parsed,
      xmlStoragePath: 'businesses/biz-1/purchase-notes/note-partial/original.xml', originalFileName: 'partial.xml', actor,
    });
    await reviewPurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: prepared.id, actor,
      items: [
        { lineId: prepared.items[0].lineId, action: 'match', productId: 'product-1', conversionFactor: 1, landedUnitCost: 8 },
        {
          lineId: prepared.items[1].lineId, action: 'create', conversionFactor: 1, landedUnitCost: 6,
          newProduct: { name: 'Duplicado', category: 'Geral', unit: 'UN', sku: 'FORN-001' },
        },
      ],
    });

    const result = await confirmPurchaseNoteAdmin({ db: fake.db, businessId: 'biz-1', noteId: prepared.id, actor });

    expect(result).toMatchObject({ importedCount: 1, errorCount: 1 });
    expect(result.note.status).toBe('parcial');
    expect(result.note.stockMovementIds).toHaveLength(1);
    expect(result.note.items.map((item) => item.importStatus)).toEqual(['imported', 'error']);
  });

  it('bloqueia um segundo claim ativo da mesma nota', async () => {
    const fake = fakeDb();
    seedSupplier(fake, 'biz-1');
    const prepared = await preparePurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: 'note-claimed', parsed,
      xmlStoragePath: 'businesses/biz-1/purchase-notes/note-claimed/original.xml', originalFileName: 'claim.xml', actor,
    });
    const reviewed = await reviewPurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: prepared.id, actor,
      items: prepared.items.map((item) => ({ lineId: item.lineId, action: 'skip' as const, conversionFactor: 1, landedUnitCost: item.landedUnitCost })),
    });
    fake.seed('purchaseNotes', prepared.id, {
      ...reviewed,
      status: 'processando',
      importClaim: {
        token: 'active-token', claimedBy: 'other-user', claimedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    await expect(confirmPurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: prepared.id, actor,
    })).rejects.toBeInstanceOf(PurchaseNoteClaimConflictError);
  });

  it('recupera claim expirado e conclui nota com todos os itens ignorados sem criar movimento', async () => {
    const fake = fakeDb();
    seedSupplier(fake, 'biz-1');
    const prepared = await preparePurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: 'note-expired', parsed,
      xmlStoragePath: 'businesses/biz-1/purchase-notes/note-expired/original.xml', originalFileName: 'expired.xml', actor,
    });
    const reviewed = await reviewPurchaseNoteAdmin({
      db: fake.db, businessId: 'biz-1', noteId: prepared.id, actor,
      items: prepared.items.map((item) => ({ lineId: item.lineId, action: 'skip' as const, conversionFactor: 1, landedUnitCost: item.landedUnitCost })),
    });
    fake.seed('purchaseNotes', prepared.id, {
      ...reviewed,
      status: 'processando',
      importClaim: {
        token: 'expired-token', claimedBy: 'other-user', claimedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T00:05:00.000Z',
      },
    });

    const result = await confirmPurchaseNoteAdmin({ db: fake.db, businessId: 'biz-1', noteId: prepared.id, actor });

    expect(result).toMatchObject({ replayed: false, importedCount: 0, skippedCount: 2, errorCount: 0 });
    expect(result.note.status).toBe('importada');
    expect(result.note.stockMovementIds).toEqual([]);
    expect(fake.list('stockMovements')).toHaveLength(0);
  });
});
