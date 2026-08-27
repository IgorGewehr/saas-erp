import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ReviewPurchaseNoteRequestSchema } from '@/lib/contracts/api/purchase-note-review';
import { ConfirmPurchaseNoteRequestSchema } from '@/lib/contracts/api/purchase-note-confirm';
import { ReversePurchaseNoteRequestSchema } from '@/lib/contracts/api/purchase-note-reverse';
import { LinkPurchaseFinancialRequestSchema } from '@/lib/contracts/api/purchase-note-financial';
import { PurchaseNoteExternalActionSchema } from '@/lib/contracts/api/purchase-note-external';
import { DomainEventSchema } from '@/lib/contracts/events';
import { PurchaseNotesToolRequestSchema } from '@/lib/contracts/api/agent/purchase-notes';

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

  it('reprocessa somente erros e reverte por rota autenticada com ledger compensatório', () => {
    const confirmRoute = readFileSync('app/api/purchase-notes/confirm/route.ts', 'utf8');
    const reverseRoute = readFileSync('app/api/purchase-notes/reverse/route.ts', 'utf8');
    const core = readFileSync('lib/services/purchase-import-admin.ts', 'utf8');
    const stock = readFileSync('lib/services/stock-core-admin.ts', 'utf8');
    const module = readFileSync('app/components/features/purchases/ComprasModule.tsx', 'utf8');
    expect(ConfirmPurchaseNoteRequestSchema.parse({ businessId: 'biz-1', noteId: 'note-1', retryFailed: true }).retryFailed).toBe(true);
    expect(ReversePurchaseNoteRequestSchema.safeParse({ businessId: 'biz-1', noteId: 'note-1', reason: 'Duplicidade' }).success).toBe(true);
    expect(ReversePurchaseNoteRequestSchema.safeParse({ businessId: 'biz-1', noteId: 'note-1', reason: 'x', extra: true }).success).toBe(false);
    expect(confirmRoute).toContain('retryFailed: parsed.data.retryFailed');
    expect(reverseRoute).toContain('verifyAuth(request, parsed.data.businessId)');
    expect(reverseRoute).toContain('reversePurchaseNoteAdmin');
    expect(core).toContain('purchase:${params.noteId}:line:${item.lineId}:reversal');
    expect(core).toContain('PurchaseNoteReversalBlockedError');
    expect(stock).toContain('reversalOfMovementId');
    expect(stock).toContain('costRestored: true');
    expect(module).toContain('Tentar novamente itens com erro');
    expect(module).toContain('Reverter entrada no estoque');
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

  it('vincula o financeiro por contrato estrito e núcleo transacional idempotente', () => {
    const route = readFileSync('app/api/purchase-notes/financial/route.ts', 'utf8');
    const core = readFileSync('lib/services/purchase-financial-admin.ts', 'utf8');
    const reversal = readFileSync('lib/services/purchase-import-admin.ts', 'utf8');
    const module = readFileSync('app/components/features/purchases/ComprasModule.tsx', 'utf8');

    expect(LinkPurchaseFinancialRequestSchema.safeParse({
      businessId: 'biz-1', noteId: 'note-1', mode: 'payable', dueDate: '2026-09-25', paymentMethod: 'boleto',
    }).success).toBe(true);
    expect(LinkPurchaseFinancialRequestSchema.safeParse({
      businessId: 'biz-1', noteId: 'note-1', mode: 'paid', paymentDate: '2026-08-26',
    }).success).toBe(false);
    expect(LinkPurchaseFinancialRequestSchema.safeParse({
      businessId: 'biz-1', noteId: 'note-1', mode: 'payable', dueDate: '2026-09-25', amount: 1,
    }).success).toBe(false);
    expect(route).toContain('verifyAuth(request, parsed.data.businessId)');
    expect(route).toContain('linkPurchaseFinancialAdmin');
    expect(core).toContain('deterministicTransactionId');
    expect(core).toContain('note.totals.invoice');
    expect(core).toContain('tx.create(transactionRef');
    expect(core).toContain('bankAccount.balance - amount');
    expect(reversal).toContain("status: 'cancelado'");
    expect(reversal).toContain("status: 'reversed'");
    expect(module).toContain('PurchaseFinancialDialog');
    expect(module).toContain('Organizar financeiro da compra');
  });

  it('registra eventos determinísticos e expõe o mesmo núcleo ao agente e à API v1', () => {
    const events = readFileSync('lib/services/purchase-domain-events.ts', 'utf8');
    const importCore = readFileSync('lib/services/purchase-import-admin.ts', 'utf8');
    const financialCore = readFileSync('lib/services/purchase-financial-admin.ts', 'utf8');
    const queryCore = readFileSync('lib/services/purchase-query-admin.ts', 'utf8');
    const agentRoute = readFileSync('app/api/agent/tools/purchase-notes/route.ts', 'utf8');
    const apiRoute = readFileSync('app/api/v1/purchase-notes/route.ts', 'utf8');

    const envelope = { businessId: 'biz-1', purchaseNoteId: 'note-1', occurredAt: '2026-08-27T10:00:00.000Z' };
    expect(DomainEventSchema.safeParse({
      ...envelope, type: 'purchase.financialLinked', transactionId: 'tx-1', financialStatus: 'paid', amount: 100,
    }).success).toBe(true);
    expect(DomainEventSchema.safeParse({
      ...envelope, type: 'purchase.reverted', movementsReversed: 1, amountRestored: 100, reason: 'Compra duplicada',
    }).success).toBe(true);
    expect(events).toContain('purchaseDomainEventId');
    expect(events).toContain('params.tx.create(eventRef');
    expect(importCore).toContain('ensurePurchaseAuditEvent');
    expect(financialCore).toContain('ensurePurchaseAuditEvent');
    expect(queryCore).toContain("where('businessId', '==', params.businessId)");
    expect(agentRoute).toContain("'link_financial'");
    expect(agentRoute).toContain('linkPurchaseFinancialAdmin');
    expect(agentRoute).toContain('listPurchaseNotesAdmin');
    expect(PurchaseNotesToolRequestSchema.safeParse({
      action: 'link_financial',
      params: { id: 'note-1', mode: 'paid', bankAccountId: 'bank-1', paymentMethod: 'pix' },
    }).success).toBe(true);
    expect(apiRoute).toContain("verifyApiKey(request, ['read:purchases'])");
    expect(apiRoute).toContain("['write:purchases', 'write:products', 'write:financial']");
    expect(apiRoute).toContain('confirmPurchaseNoteAdmin');
    expect(apiRoute).toContain('linkPurchaseFinancialAdmin');
    expect(apiRoute).toContain('reversePurchaseNoteAdmin');
  });

  it('mantém as ações externas estritas e nunca aceita o valor financeiro do cliente', () => {
    expect(PurchaseNoteExternalActionSchema.safeParse({
      action: 'link_financial', noteId: 'note-1', intent: { mode: 'payable', dueDate: '2026-09-27' },
    }).success).toBe(true);
    expect(PurchaseNoteExternalActionSchema.safeParse({
      action: 'link_financial', noteId: 'note-1', intent: { mode: 'paid', bankAccountId: 'bank-1', amount: 0.01 },
    }).success).toBe(false);
    expect(PurchaseNoteExternalActionSchema.safeParse({
      action: 'reverse', noteId: 'note-1', reason: 'x', businessId: 'biz-2',
    }).success).toBe(false);
  });
});
