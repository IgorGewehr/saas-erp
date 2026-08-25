import { describe, expect, it } from 'vitest';
import { StockOperationRequestSchema } from '@/lib/contracts/api/stock-operations';
import { CreateSaleWithSideEffectsInputSchema } from '@/lib/contracts/api/services/sale-server';

describe('M01.2 — boundaries server-side de estoque', () => {
  it('aceita saída idempotente com origem e política estrita', () => {
    const result = StockOperationRequestSchema.safeParse({
      businessId: 'biz1',
      type: 'saida',
      lines: [{ productId: 'p1', quantity: 2, sourceLineId: 'item-1' }],
      operatorName: 'Operador',
      reason: 'Venda #1',
      sourceType: 'sale',
      sourceId: 'sale-1',
      idempotencyKey: 'sale:sale-1:deduct',
      expandBom: true,
      negativeStockPolicy: 'prevent',
    });

    expect(result.success).toBe(true);
  });

  it('rejeita origem não manual sem sourceId', () => {
    const result = StockOperationRequestSchema.safeParse({
      businessId: 'biz1',
      type: 'entrada',
      lines: [{ productId: 'p1', quantity: 2 }],
      operatorName: 'Operador',
      reason: 'Compra',
      sourceType: 'purchase',
      idempotencyKey: 'purchase:1',
      expandBom: false,
    });

    expect(result.success).toBe(false);
  });

  it('preserva modificadores no checkout do PDV para consumo de insumos', () => {
    const result = CreateSaleWithSideEffectsInputSchema.parse({
      businessId: 'biz1',
      items: [{
        productId: 'pizza',
        description: 'Pizza',
        quantity: 1,
        unitPrice: 30,
        discount: 0,
        basePrice: 25,
        selectedModifiers: [{
          groupId: 'sabores',
          groupName: 'Sabores',
          priceStrategy: 'sum',
          selectedOptions: [{
            optionId: 'queijo-extra',
            optionName: 'Queijo extra',
            additionalPrice: 5,
            quantity: 1,
          }],
        }],
      }],
      payments: [{ method: 'pix', amount: 30 }],
      discount: 0,
      status: 'finalizada',
      operatorId: 'user-1',
      operatorName: 'Operador',
      idempotencyKey: 'pdv:1',
    });

    expect(result.items[0].selectedModifiers?.[0].selectedOptions[0].optionId).toBe('queijo-extra');
  });
});
