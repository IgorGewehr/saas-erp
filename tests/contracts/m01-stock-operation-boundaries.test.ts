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

  it('aceita ajuste absoluto auditável de uma variação', () => {
    const result = StockOperationRequestSchema.parse({
      businessId: 'biz1',
      type: 'ajuste',
      lines: [{ productId: 'camiseta', variantId: 'azul-p', quantity: 8 }],
      operatorName: 'Operador',
      reason: 'Inventário da grade',
      sourceType: 'manual',
      idempotencyKey: 'inventory:camiseta:azul-p:1',
      expandBom: false,
      adjustmentMode: 'absolute',
      negativeStockPolicy: 'prevent',
    });
    expect(result.lines[0].variantId).toBe('azul-p');
  });

  it('aceita metadados de lote na entrada e lote explícito na saída', () => {
    const entry = StockOperationRequestSchema.safeParse({
      businessId: 'biz1', type: 'entrada',
      lines: [{ productId: 'p1', quantity: 3, lot: { code: 'A-1', expiresAt: '2027-01-01' } }],
      operatorName: 'Operador', reason: 'Compra', sourceType: 'purchase', sourceId: 'note-1',
      idempotencyKey: 'purchase:note-1:lot', expandBom: false,
    });
    const output = StockOperationRequestSchema.safeParse({
      businessId: 'biz1', type: 'saida',
      lines: [{ productId: 'p1', quantity: 1, lotId: 'lot-1' }],
      operatorName: 'Operador', reason: 'Perda', sourceType: 'manual',
      idempotencyKey: 'manual:lot-1:output', expandBom: false,
    });
    expect(entry.success).toBe(true);
    expect(output.success).toBe(true);
  });

  it('rejeita metadados de criação de lote fora de uma entrada', () => {
    expect(StockOperationRequestSchema.safeParse({
      businessId: 'biz1', type: 'saida',
      lines: [{ productId: 'p1', quantity: 1, lot: { code: 'A-1' } }],
      operatorName: 'Operador', reason: 'Venda', sourceType: 'sale', sourceId: 'sale-1',
      idempotencyKey: 'sale:lot-invalid', expandBom: false,
    }).success).toBe(false);
  });
});
