import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ReviewPurchaseNoteRequestSchema } from '@/lib/contracts/api/purchase-note-review';

describe('M01.5 purchase import boundaries', () => {
  it('mantém parsing e persistência decisivos fora do componente visual', () => {
    const module = readFileSync('app/components/features/purchases/ComprasModule.tsx', 'utf8');
    const parser = readFileSync('lib/services/purchase-xml-parser.ts', 'utf8');
    const route = readFileSync('app/api/purchase-notes/prepare/route.ts', 'utf8');
    expect(parser).toContain('parsePurchaseNFeXml');
    expect(route).toContain('preparePurchaseNoteAdmin');
    expect(route).toContain('expectedRecipientDocument');
    expect(module).not.toContain('preparePurchaseNoteAdmin');
    expect(module).not.toContain('parseNFeXml');
    expect(module).not.toContain("addDoc(collection(db, 'purchaseNotes')");
    expect(module).toContain('PurchaseImportDialog');
  });

  it('salva a revisão integral por uma rota autenticada e um contrato estrito', () => {
    const dialog = readFileSync('app/components/features/purchases/PurchaseImportDialog.tsx', 'utf8');
    const route = readFileSync('app/api/purchase-notes/review/route.ts', 'utf8');
    const contract = readFileSync('lib/contracts/api/purchase-note-review.ts', 'utf8');
    expect(dialog).toContain("action: 'match'");
    expect(dialog).toContain("action: 'create'");
    expect(dialog).toContain("action: 'skip'");
    expect(route).toContain('verifyAuth(request, parsed.data.businessId)');
    expect(route).toContain('reviewPurchaseNoteAdmin');
    expect(contract).toContain("z.enum(['match', 'create', 'skip'])");
    expect(contract).toContain('Linha duplicada.');
  });

  it('confirma a revisão somente pela rota autenticada e pelo núcleo idempotente', () => {
    const route = readFileSync('app/api/purchase-notes/confirm/route.ts', 'utf8');
    const agentRoute = readFileSync('app/api/agent/tools/purchase-notes/route.ts', 'utf8');
    const core = readFileSync('lib/services/purchase-import-admin.ts', 'utf8');
    const stock = readFileSync('lib/services/stock-core-admin.ts', 'utf8');
    expect(route).toContain('verifyAuth(request, parsed.data.businessId)');
    expect(route).toContain('confirmPurchaseNoteAdmin');
    expect(core).toContain('PurchaseNoteClaimConflictError');
    expect(core).toContain('purchase:${params.noteId}:line:${item.lineId}:entry');
    expect(core).toContain('createProductCatalogAdmin');
    expect(stock).toContain('costMethod: \'moving_average\'');
    expect(agentRoute).toContain('confirmPurchaseNoteAdmin');
    expect(agentRoute).toContain('note.schemaVersion === 2');
  });

  it('recusa linhas duplicadas, combinações contraditórias e validade anterior à fabricação', () => {
    const base = {
      businessId: 'biz-1', noteId: 'note-1',
      items: [{ lineId: '1', action: 'skip', conversionFactor: 1, landedUnitCost: 10 }],
    };
    expect(ReviewPurchaseNoteRequestSchema.safeParse({ ...base, items: [...base.items, ...base.items] }).success).toBe(false);
    expect(ReviewPurchaseNoteRequestSchema.safeParse({
      ...base,
      items: [{ ...base.items[0], action: 'match', productId: 'product-1', newProduct: { name: 'Novo', category: 'Geral', unit: 'UN' } }],
    }).success).toBe(false);
    expect(ReviewPurchaseNoteRequestSchema.safeParse({
      ...base,
      items: [{ ...base.items[0], action: 'create', newProduct: { name: 'Novo', category: 'Geral', unit: 'UN' }, lot: { code: 'L1', manufacturedAt: '2027-01-01', expiresAt: '2026-01-01' } }],
    }).success).toBe(false);
  });

  it('protege XML por tenant e cria claim determinístico de chave', () => {
    const download = readFileSync('app/api/purchase-notes/xml/route.ts', 'utf8');
    const core = readFileSync('lib/services/purchase-import-admin.ts', 'utf8');
    const firestoreRules = readFileSync('firestore.rules', 'utf8');
    const storageRules = readFileSync('storage.rules', 'utf8');
    expect(download).toContain('verifyAuth(request, businessId)');
    expect(download).toContain('expectedPrefix');
    expect(core).toContain("collection('purchaseNoteIdentifiers')");
    expect(core).toContain('runTransaction');
    expect(firestoreRules).toMatch(/match \/purchaseNoteIdentifiers\/\{identifierId\}[\s\S]*?allow read, write: if false;/);
    expect(storageRules).toMatch(/match \/businesses\/\{businessId\}\/purchase-notes\/\{path=\*\*\}[\s\S]*?allow read, write: if false;/);
    expect(storageRules).toContain("category != 'purchase-notes'");
  });
});
