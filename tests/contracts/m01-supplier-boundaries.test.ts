import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SupplierCatalogDataSchema } from '@/lib/contracts/api/supplier-catalog';

describe('M01.4 supplier boundaries', () => {
  it('aceita dados comerciais opcionais e documentos CPF/CNPJ na entrada', () => {
    expect(SupplierCatalogDataSchema.safeParse({
      documentType: 'cpf', document: '123.456.789-00', razaoSocial: 'Fornecedor autônomo',
      paymentTerms: 'À vista', leadTimeDays: 2, minimumOrderValue: 100,
      minimumOrderQuantity: 5, orderMultiple: 5, isActive: true,
    }).success).toBe(true);
    expect(SupplierCatalogDataSchema.safeParse({
      documentType: 'cnpj', document: '123', razaoSocial: 'Inválido', isActive: true,
    }).success).toBe(false);
  });

  it('mantém UI e agente no mesmo núcleo server-side', () => {
    const uiClient = readFileSync('lib/services/supplier-client.ts', 'utf8');
    const api = readFileSync('app/api/suppliers/route.ts', 'utf8');
    const agent = readFileSync('app/api/agent/tools/suppliers/route.ts', 'utf8');
    const module = readFileSync('app/components/features/purchases/SuppliersPanel.tsx', 'utf8');
    expect(uiClient).toContain('/api/suppliers');
    expect(api).toContain('createSupplierAdmin');
    expect(api).toContain('updateSupplierAdmin');
    expect(agent).toContain('createSupplierAdmin');
    expect(agent).toContain('updateSupplierAdmin');
    expect(module).not.toContain("collection(db, 'suppliers')");
  });

  it('bloqueia escrita direta nas coleções canônicas e de auditoria', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    expect(rules).toMatch(/match \/suppliers\/\{supplierId\}[\s\S]*?allow read, create, update, delete: if false;/);
    expect(rules).toMatch(/match \/supplierIdentifiers\/\{identifierId\}[\s\S]*?allow read, write: if false;/);
    expect(rules).toMatch(/match \/supplierHistory\/\{historyId\}[\s\S]*?allow read, write: if false;/);
  });
});
