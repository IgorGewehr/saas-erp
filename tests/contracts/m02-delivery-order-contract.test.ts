import { describe, expect, it } from 'vitest';
import publicFixture from '@/tests/fixtures/m02/public-menu-order.json';
import { DeliveryOrderSchema } from '@/contracts/domain/deliveryOrder';

describe('M02.5a — contrato DeliveryOrder com campos aditivos do núcleo comercial', () => {
  it('aceita os campos aditivos de correlação com a operação comercial e benefícios', () => {
    const document = {
      ...structuredClone(publicFixture.document),
      commercialOperationId: 'commercial_abc123',
      commercialOperationStatus: 'completed',
      couponId: 'coupon-1',
      couponCode: 'BEMVINDO10',
      couponDiscount: 5,
      trackingToken: 'token-abc',
    };
    const result = DeliveryOrderSchema.safeParse(document);
    expect(result.success).toBe(true);
  });

  it('exige que total desconte giftCardAmount além de discount e deliveryFee', () => {
    const document = {
      ...structuredClone(publicFixture.document),
      giftCardId: 'gift-1',
      giftCardCode: 'GIFT1234',
      giftCardAmount: 10,
      // subtotal 44 + deliveryFee 6 - discount 5 - giftCardAmount 10 = 35
      total: 35,
    };
    const result = DeliveryOrderSchema.safeParse(document);
    expect(result.success).toBe(true);
  });

  it('rejeita total que ignora giftCardAmount (herança do bug anterior à correção)', () => {
    const document = {
      ...structuredClone(publicFixture.document),
      giftCardId: 'gift-1',
      giftCardCode: 'GIFT1234',
      giftCardAmount: 10,
      // total antigo (sem descontar giftCardAmount) deve falhar agora
      total: 45,
    };
    const result = DeliveryOrderSchema.safeParse(document);
    expect(result.success).toBe(false);
  });

  it('continua validando a fixture original sem giftCardAmount (retrocompatibilidade)', () => {
    const result = DeliveryOrderSchema.safeParse(publicFixture.document);
    expect(result.success).toBe(true);
  });

  it('aceita createdBy/createdByName (M02.5b — auditoria de criação)', () => {
    const document = {
      ...structuredClone(publicFixture.document),
      createdBy: 'user-1',
      createdByName: 'Atendente Teste',
    };
    const result = DeliveryOrderSchema.safeParse(document);
    expect(result.success).toBe(true);
  });

  it('aceita deliveryType=mesa com tableNumber, sem exigir endereço nem taxa de entrega', () => {
    const base = structuredClone(publicFixture.document);
    const document = {
      ...base,
      deliveryType: 'mesa',
      deliveryAddress: undefined,
      tableNumber: '12',
      deliveryFee: 0,
      total: base.subtotal - base.discount, // 44 - 5 = 39, sem deliveryFee
    };
    const result = DeliveryOrderSchema.safeParse(document);
    expect(result.success).toBe(true);
  });

  it('aceita deliveryType=mesa sem tableNumber (garçom pode esquecer de preencher)', () => {
    const base = structuredClone(publicFixture.document);
    const document = {
      ...base,
      deliveryType: 'mesa',
      deliveryAddress: undefined,
      deliveryFee: 0,
      total: base.subtotal - base.discount,
    };
    const result = DeliveryOrderSchema.safeParse(document);
    expect(result.success).toBe(true);
  });
});
