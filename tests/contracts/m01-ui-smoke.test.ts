import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('M01.9 — smoke estrutural das telas críticas', () => {
  it('mantém a auditoria de homologação limitada a um tenant e sem escrita no Firestore', () => {
    const script = read('scripts/audit-m01-homologation.ts');
    expect(script).toContain('--businessId=<id> é obrigatório');
    expect(script).toContain(".where('businessId', '==', businessId)");
    expect(script).not.toMatch(/adminDb\.(batch|runTransaction)/);
    expect(script).not.toMatch(/\.(create|set|update|delete)\(/);
  });

  it('mantém Catálogo/Estoque acessível e ligado aos serviços paginados e ao núcleo de saldo', () => {
    const shell = read('app/app/page.tsx');
    const inventory = read('app/components/features/inventory/InventoryModule.tsx');
    expect(shell).toContain("case 'Estoque'");
    expect(shell).toContain('<InventoryModule />');
    expect(inventory).toContain('listCatalogProductsPage');
    expect(inventory).toContain('listStockMovementsPage');
    expect(inventory).toContain('createCatalogProduct');
    expect(inventory).toContain('updateCatalogProduct');
    expect(inventory).toContain('applyStockOperation');
  });

  it('mantém Compras e Fornecedores no mesmo módulo e usando os serviços protegidos', () => {
    const shell = read('app/app/page.tsx');
    const purchases = read('app/components/features/purchases/ComprasModule.tsx');
    const suppliers = read('app/components/features/purchases/SuppliersPanel.tsx');
    expect(shell).toContain("case 'Compras'");
    expect(shell).toContain('<ComprasModule />');
    expect(purchases).toContain('<SuppliersPanel />');
    expect(purchases).toContain('listPurchaseNotesPage');
    expect(purchases).toContain('confirmPurchaseNote');
    expect(purchases).toContain('reversePurchaseNote');
    expect(suppliers).toContain('listSuppliersPage');
    expect(suppliers).toContain('createSupplier');
    expect(suppliers).toContain('updateSupplier');
    expect(suppliers).toContain('archiveSupplier');
  });

  it('mantém PDV acessível com baixa e restauração pelo núcleo autoritativo', () => {
    const shell = read('app/app/page.tsx');
    const pdv = read('app/components/features/pdv/PDVModule.tsx');
    expect(shell).toContain("case 'PDV'");
    expect(shell).toContain('<PDVModule />');
    expect(pdv).toContain("from '@/lib/services/stock-server-client'");
    expect(pdv).toContain('buildOrderStockLines');
    expect(pdv).toContain('applyStockOperation');
  });

  it('mantém Pedidos acessível, criando e transicionando status pelo núcleo comercial server-side (M02.5b/d)', () => {
    const shell = read('app/app/page.tsx');
    const orders = read('app/components/features/orders/OrdersModule.tsx');
    expect(shell).toContain("case 'Pedidos'");
    expect(shell).toContain('<OrdersModule />');
    // M02.5b: criação delega pra /api/orders/manual (núcleo comercial), não
    // grava mais deliveryOrders direto pelo SDK cliente.
    expect(orders).toContain("fetch('/api/orders/manual'");
    // M02.5d: transição de status delega pra /api/orders/[id]/transition
    // (FSM + estoque + receita server-side), não mais bookDeliveryRevenue/
    // restoreOrderStockOnce client-side.
    expect(orders).toContain('/transition');
    expect(orders).not.toContain('bookDeliveryRevenue');
    expect(orders).not.toContain('restoreOrderStockOnce');
  });
});
