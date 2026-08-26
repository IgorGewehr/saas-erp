import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('M01.5 purchase import boundaries', () => {
  it('mantém parsing e persistência decisivos fora do componente visual', () => {
    const module = readFileSync('app/components/features/purchases/ComprasModule.tsx', 'utf8');
    const parser = readFileSync('lib/services/purchase-xml-parser.ts', 'utf8');
    const route = readFileSync('app/api/purchase-notes/prepare/route.ts', 'utf8');
    expect(parser).toContain('parsePurchaseNFeXml');
    expect(route).toContain('preparePurchaseNoteAdmin');
    expect(route).toContain('expectedRecipientDocument');
    expect(module).not.toContain('preparePurchaseNoteAdmin');
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
