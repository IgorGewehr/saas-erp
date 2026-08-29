import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pdvFixture from '@/tests/fixtures/m02/pdv-sale.json';
import publicFixture from '@/tests/fixtures/m02/public-menu-order.json';
import manualFixture from '@/tests/fixtures/m02/manual-delivery-order.json';
import agentFixture from '@/tests/fixtures/m02/agent-order.json';
import b2bFixture from '@/tests/fixtures/m02/b2b-order.json';
import { SaleSchema } from '@/contracts/domain/sale';
import { DeliveryOrderSchema } from '@/contracts/domain/deliveryOrder';
import { OrderSchema } from '@/contracts/domain/order';
import { CreateSaleWithSideEffectsInputSchema } from '@/contracts/api/services/sale-server';
import { CreatePublicOrderBodySchema } from '@/contracts/api/orders/public';
import { OrdersToolRequestSchema } from '@/contracts/api/agent/orders';
import { canTransitionSale } from '@/contracts/fsm/sale';
import { canTransitionDeliveryOrder } from '@/contracts/fsm/deliveryOrder';
import { canTransitionOrder } from '@/contracts/fsm/order';
import { canTransitionPayment } from '@/contracts/fsm/payment';
import { buildExternalReference, parseExternalReference } from '@/contracts/domain/payment';
import { assertOrdersAcceptedNow } from '@/lib/services/orders/acceptance';
import { resolveDeliveryZone } from '@/lib/services/orders/deliveryZones';
import { computeModifierDelta, validateAndCleanModifiers } from '@/lib/services/orders/pricing';
import { buildComandaEscPos } from '@/lib/services/printing/comandaEscpos';
import type { DeliveryOrder, Product, SelectedModifier } from '@/lib/types';

describe('M02.0 — fixtures dos cinco canais comerciais', () => {
  it('caracteriza checkout do PDV com pagamento dividido', () => {
    expect(CreateSaleWithSideEffectsInputSchema.safeParse(pdvFixture.request).success).toBe(true);
    const sale = SaleSchema.parse(pdvFixture.document);
    expect(sale.payments.map((payment) => payment.amount)).toEqual([10, 20]);
    expect(sale.payments.reduce((sum, payment) => sum + payment.amount, 0)).toBe(sale.total);
  });

  it('registra que o serviço atual aceita preço de item informado pelo cliente', () => {
    const request = structuredClone(pdvFixture.request);
    request.items[0].unitPrice = 0.01;
    request.items[0].total = 0.01;
    request.payments = [{ method: 'pix', amount: 0.01 }];
    expect(CreateSaleWithSideEffectsInputSchema.safeParse(request).success).toBe(true);
  });

  it('caracteriza cardápio público e congela a divergência do contrato HTTP atual', () => {
    expect(DeliveryOrderSchema.safeParse(publicFixture.document).success).toBe(true);
    expect(CreatePublicOrderBodySchema.safeParse(publicFixture.request).success).toBe(false);
  });

  it('caracteriza pedido manual e registra que variantId ainda é descartado pelo contrato', () => {
    const parsed = DeliveryOrderSchema.parse(manualFixture.document);
    expect('variantId' in parsed.items[0]).toBe(false);
  });

  it('caracteriza criação pelo agente e o documento resultante', () => {
    expect(OrdersToolRequestSchema.safeParse(agentFixture.request).success).toBe(true);
    expect(DeliveryOrderSchema.safeParse(agentFixture.document).success).toBe(true);
  });

  it('caracteriza pedido B2B com desconto e condição de pagamento', () => {
    const order = OrderSchema.parse(b2bFixture.document);
    expect(order.subtotal - order.discount).toBe(order.total);
    expect(order.paymentMethod).toBe('boleto');
  });
});

describe('M02.0 — fronteira da auditoria', () => {
  it('exige tenant e não possui escrita no Firestore', () => {
    const script = readFileSync('scripts/audit-m02-commercial.ts', 'utf8');
    expect(script).toContain('--businessId=<id> é obrigatório');
    expect(script).toContain(".where('businessId', '==', businessId)");
    for (const collection of [
      'sales', 'deliveryOrders', 'orders', 'transactions', 'stockMovements',
      'couponRedemptions', 'giftCardRedemptions', 'loyaltyTransactions', 'fiscalDocuments',
    ]) {
      expect(script).toContain(`${collection}: '${collection}'`);
    }
    expect(script).not.toMatch(/adminDb\.(batch|runTransaction)/);
    expect(script).not.toMatch(/adminDb\.collection\([^)]*\)\.(add|set|update|delete)/);
  });
});

describe('M02.0 — regras puras preservadas do AEVO', () => {
  it('reconstrói modificadores usando nome e preço autoritativos do produto', () => {
    const product = publicFixture.product as unknown as Product;
    const incoming = publicFixture.request.items[0].selectedModifiers as SelectedModifier[];
    const result = validateAndCleanModifiers(product, incoming);
    expect(result).toEqual({
      clean: [{
        groupId: 'extras',
        groupName: 'Extras',
        priceStrategy: 'sum',
        selectedOptions: [{
          optionId: 'bacon', optionName: 'Bacon', additionalPrice: 4, quantity: 1,
        }],
      }],
    });
    if ('clean' in result) expect(computeModifierDelta(result.clean)).toBe(4);
  });

  it('mantém zona de entrega por bairro como taxa autoritativa', () => {
    const result = resolveDeliveryZone([
      { name: 'Centro', type: 'neighborhood', value: 'Centro', fee: 6, estimatedMinutes: 35 },
    ], { bairro: 'centro' });
    expect(result).toMatchObject({ status: 'matched', fee: 6, estimatedMinutes: 35, estimated: false });
  });

  it('mantém horário aberto, exceção off-hours e pausa manual', () => {
    const openingHours = Array.from({ length: 7 }, () => ({
      isOpen: true, openTime: '00:00', closeTime: '23:59',
    }));
    expect(() => assertOrdersAcceptedNow({ settings: { openingHours } }, new Date('2026-08-28T12:00:00.000Z')))
      .not.toThrow();
    expect(() => assertOrdersAcceptedNow({ settings: { aiAgent: { enabled: true, pedidos: { acceptOrdersOffHours: true } } } }))
      .not.toThrow();
    expect(() => assertOrdersAcceptedNow({ settings: { aiAgent: { enabled: true, pedidos: { acceptingOrders: false } } } }))
      .toThrow(/pausada/i);
  });

  it('mantém a comanda com número, modificador e observação', () => {
    const order = publicFixture.document as unknown as DeliveryOrder;
    order.items[0].notes = 'Bem assada';
    const bytes = buildComandaEscPos(order, 'AEVO Teste', 80, { cut: false });
    const printable = Array.from(bytes).map((byte) => String.fromCharCode(byte)).join('');
    expect(printable).toContain('#101');
    expect(printable).toContain('Bacon');
    expect(printable).toContain('Bem assada');
  });
});

describe('M02.0 — matrizes de estado atuais', () => {
  it('congela transições válidas de Sale', () => {
    expect(canTransitionSale('aberta', 'finalizada')).toBe(true);
    expect(canTransitionSale('finalizada', 'cancelada')).toBe(true);
    expect(canTransitionSale('cancelada', 'aberta')).toBe(false);
  });

  it('congela transições válidas de DeliveryOrder', () => {
    expect(canTransitionDeliveryOrder('recebido', 'preparando')).toBe(true);
    expect(canTransitionDeliveryOrder('pronto', 'entregue')).toBe(true);
    expect(canTransitionDeliveryOrder('recebido', 'entregue')).toBe(false);
    expect(canTransitionDeliveryOrder('entregue', 'cancelado')).toBe(false);
  });

  it('congela transições válidas de Order B2B/condicional', () => {
    expect(canTransitionOrder('pendente', 'condicional')).toBe(true);
    expect(canTransitionOrder('condicional', 'confirmado')).toBe(true);
    expect(canTransitionOrder('faturado', 'enviado')).toBe(true);
    expect(canTransitionOrder('entregue', 'cancelado')).toBe(false);
  });

  it('mantém pagamento Mercado Pago separado da fabricação', () => {
    expect(canTransitionPayment('pending', 'paid')).toBe(true);
    expect(canTransitionPayment('paid', 'refunded')).toBe(true);
    expect(canTransitionPayment('expired', 'paid')).toBe(false);
    const reference = buildExternalReference('biz-m02', 'delivery-public-1');
    expect(parseExternalReference(reference)).toEqual({ businessId: 'biz-m02', orderId: 'delivery-public-1' });
  });
});
