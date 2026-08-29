import { describe, expect, it } from 'vitest';
import pdvFixture from '@/tests/fixtures/m02/pdv-sale.json';
import publicFixture from '@/tests/fixtures/m02/public-menu-order.json';
import b2bFixture from '@/tests/fixtures/m02/b2b-order.json';
import {
  buildM02CommercialSnapshot,
  compareM02CommercialSnapshots,
  type M02AuditDocument,
  type M02CommercialAuditInput,
} from '@/lib/services/m02-commercial-audit';

const capturedAt = '2026-08-28T20:00:00.000Z';

function document(id: string, data: Record<string, unknown>): M02AuditDocument {
  return { id, data };
}

function validInput(): M02CommercialAuditInput {
  return {
    businessId: 'biz-m02',
    capturedAt,
    sales: [document(pdvFixture.document.id, pdvFixture.document)],
    deliveryOrders: [document(publicFixture.document.id, {
      ...publicFixture.document,
      status: 'entregue',
      deliveredAt: '2026-08-28T13:00:00.000Z',
      transactionId: 'delivery-public-1_revenue',
      fiscalDocId: 'fiscal-public-1',
    })],
    orders: [document(b2bFixture.document.id, b2bFixture.document)],
    transactions: [
      document('sale-pdv-1_revenue', {
        businessId: 'biz-m02', saleId: 'sale-pdv-1', type: 'receita', status: 'pago', amount: 30,
      }),
      document('delivery-public-1_revenue', {
        businessId: 'biz-m02', deliveryOrderId: 'delivery-public-1', type: 'receita', status: 'pago', amount: 45,
      }),
      document('unrelated-expense', {
        businessId: 'biz-m02', type: 'despesa', status: 'pago', amount: 9,
      }),
    ],
    stockMovements: [
      document('movement-public-1', {
        businessId: 'biz-m02', deliveryOrderId: 'delivery-public-1', productId: 'product-pizza', type: 'saida', quantity: 1,
      }),
      document('purchase-movement', {
        businessId: 'biz-m02', purchaseId: 'purchase-1', productId: 'product-pizza', type: 'entrada', quantity: 5,
      }),
    ],
    couponRedemptions: [document('coupon-redemption-1', {
      businessId: 'biz-m02', orderId: 'delivery-public-1', couponId: 'coupon-1', discount: 5,
    })],
    giftCardRedemptions: [document('gift-redemption-1', {
      businessId: 'biz-m02', orderId: 'delivery-public-1', giftCardId: 'gift-1', amount: 10,
    })],
    loyaltyTransactions: [document('loyalty-1', {
      businessId: 'biz-m02', sourceId: 'sale-pdv-1', sourceType: 'sale', points: 30,
    }), document('appointment-loyalty', {
      businessId: 'biz-m02', sourceId: 'appointment-1', sourceType: 'appointment', points: 10,
    })],
    fiscalDocuments: [
      document('fiscal-public-1', {
        businessId: 'biz-m02', orderId: 'delivery-public-1', status: 'autorizada', type: 'nfce',
      }),
      document('purchase-fiscal', {
        businessId: 'biz-m02', purchaseId: 'purchase-1', status: 'autorizada', type: 'nfe',
      }),
    ],
  };
}

describe('M02.0 — auditoria comercial read-only', () => {
  it('relaciona os três documentos comerciais a todos os efeitos conhecidos', () => {
    const snapshot = buildM02CommercialSnapshot(validInput());

    expect(snapshot.summary).toEqual({
      sales: 1,
      deliveryOrders: 1,
      orders: 1,
      grossTotal: 300,
      effects: {
        transactions: 2,
        stockMovements: 1,
        couponRedemptions: 1,
        giftCardRedemptions: 1,
        loyaltyTransactions: 1,
        fiscalDocuments: 1,
      },
      issues: 0,
    });
    expect(snapshot.entries.map((entry) => entry.key)).toEqual([
      'deliveryOrder:delivery-public-1',
      'order:order-b2b-1',
      'sale:sale-pdv-1',
    ]);
    expect(snapshot.entries[0].effects).toEqual({
      transactions: ['delivery-public-1_revenue'],
      stockMovements: ['movement-public-1'],
      couponRedemptions: ['coupon-redemption-1'],
      giftCardRedemptions: ['gift-redemption-1'],
      loyaltyTransactions: [],
      fiscalDocuments: ['fiscal-public-1'],
    });
  });

  it('denuncia pagamento divergente, referências ausentes, efeito órfão e outro tenant', () => {
    const input = validInput();
    input.sales[0] = document('sale-broken', {
      ...pdvFixture.document,
      id: 'sale-broken',
      transactionId: 'missing-revenue',
      payments: [{ method: 'pix', amount: 1 }],
    });
    input.transactions = [document('orphan-tx', {
      businessId: 'biz-m02', saleId: 'missing-sale', amount: 1,
    })];
    input.stockMovements.push(document('foreign', {
      businessId: 'biz-other', deliveryOrderId: 'delivery-public-1', quantity: 1,
    }));

    const snapshot = buildM02CommercialSnapshot(input);
    const codes = snapshot.issues.map((issue) => issue.code);
    expect(codes).toContain('PAYMENT_TOTAL_MISMATCH');
    expect(codes).toContain('MISSING_FINANCIAL_REFERENCE');
    expect(codes).toContain('ORPHAN_EFFECT');
    expect(codes).toContain('TENANT_MISMATCH');
  });

  it('preserva snapshot idêntico mesmo com ordem de leitura diferente', () => {
    const before = buildM02CommercialSnapshot(validInput());
    const afterInput = validInput();
    afterInput.capturedAt = '2026-08-28T21:00:00.000Z';
    afterInput.transactions.reverse();
    const after = buildM02CommercialSnapshot(afterInput);

    expect(compareM02CommercialSnapshots(before, after)).toMatchObject({
      preserved: true,
      healthy: true,
      comparedEntries: 3,
      unchangedEntries: 3,
      differences: [],
      newIssues: [],
    });
  });

  it('expõe alteração comercial e nova inconsistência sem ocultar problemas resolvidos', () => {
    const before = buildM02CommercialSnapshot(validInput());
    const afterInput = validInput();
    afterInput.capturedAt = '2026-08-28T21:00:00.000Z';
    afterInput.deliveryOrders[0] = document('delivery-public-1', {
      ...afterInput.deliveryOrders[0].data,
      total: 46,
      transactionId: 'missing-after',
    });
    const after = buildM02CommercialSnapshot(afterInput);
    const comparison = compareM02CommercialSnapshots(before, after);

    expect(comparison.preserved).toBe(false);
    expect(comparison.healthy).toBe(false);
    expect(comparison.differences).toEqual([
      expect.objectContaining({ key: 'deliveryOrder:delivery-public-1', status: 'changed' }),
    ]);
    expect(comparison.newIssues.some((issue) => issue.code === 'MISSING_FINANCIAL_REFERENCE')).toBe(true);
  });

  it('recusa comparação entre tenants diferentes', () => {
    const before = buildM02CommercialSnapshot(validInput());
    const otherInput = validInput();
    otherInput.businessId = 'biz-other';
    otherInput.sales = [];
    otherInput.deliveryOrders = [];
    otherInput.orders = [];
    otherInput.transactions = [];
    otherInput.stockMovements = [];
    otherInput.couponRedemptions = [];
    otherInput.giftCardRedemptions = [];
    otherInput.loyaltyTransactions = [];
    otherInput.fiscalDocuments = [];
    const after = buildM02CommercialSnapshot(otherInput);
    expect(() => compareM02CommercialSnapshots(before, after)).toThrow(/businessId diferentes/);
  });
});
