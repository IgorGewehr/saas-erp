import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('M01.8 — fronteiras de migração, segurança e custo', () => {
  it('mantém o migrador em dry-run por padrão e exige confirmação para escrita', () => {
    const script = source('scripts/migrate-m01-parity.ts');
    expect(script).toContain("--businessId=<id> é obrigatório");
    expect(script).toContain("options.confirm !== 'M01_PARITY_V2'");
    expect(script).toContain('dryRun: !options.apply');
    expect(script).toContain("--confirm=ROLLBACK_M01_PARITY_V2");
  });

  it('protege execução e backups e fecha escrita fiscal crítica no cliente', () => {
    const rules = source('firestore.rules');
    expect(rules).toContain('match /m01MigrationRuns/{runId}');
    expect(rules).toContain('match /m01MigrationBackups/{backupId}');
    expect(rules).toMatch(/match \/purchaseNotes\/\{noteId\}[\s\S]*allow create, update: if false;/);
  });

  it('pagina movimentos e notas sem listeners ilimitados nas telas administrativas', () => {
    const inventory = source('app/components/features/inventory/InventoryModule.tsx');
    const purchases = source('app/components/features/purchases/ComprasModule.tsx');
    const movementRoute = source('app/api/stock/movements/route.ts');
    const noteRoute = source('app/api/purchase-notes/route.ts');

    expect(inventory).toContain('listStockMovementsPage');
    expect(inventory).not.toContain("collection(db, 'stockMovements')");
    expect(purchases).toContain('listPurchaseNotesPage');
    expect(purchases).not.toContain("onSnapshot(");
    expect(movementRoute).toContain('listStockMovementsAdmin');
    expect(noteRoute).toContain('listPurchaseNotesAdmin');
  });

  it('declara índices de rastreabilidade e rollback', () => {
    const indexes = source('firestore.indexes.json');
    expect(indexes).toContain('"fieldPath": "correlationId"');
    expect(indexes).toContain('"collectionGroup": "m01MigrationBackups"');
    expect(indexes).toContain('"fieldPath": "rollbackStatus"');
  });
});
