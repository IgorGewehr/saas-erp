import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pdvFixture from '@/tests/fixtures/m02/pdv-sale.json';
import publicFixture from '@/tests/fixtures/m02/public-menu-order.json';
import manualFixture from '@/tests/fixtures/m02/manual-delivery-order.json';
import b2bFixture from '@/tests/fixtures/m02/b2b-order.json';
import { CreatePublicOrderBodySchema } from '@/contracts/api/orders/public';
import { CommercialDocumentV2Schema } from '@/contracts/domain/commercialV2';
import {
  adaptDeliveryOrderToCommercialV2,
  adaptOrderToCommercialV2,
  adaptSaleToCommercialV2,
} from '@/lib/services/commercial-adapters';

describe('M02.1 — compatibilidade comercial V2', () => {
  it('adapta Sale e preserva pagamentos divididos e efeitos', () => {
    const document = adaptSaleToCommercialV2(pdvFixture.document);
    expect(CommercialDocumentV2Schema.safeParse(document).success).toBe(true);
    expect(document.payments.map((payment) => payment.amountCents)).toEqual([1000, 2000]);
    expect(document.effects.transactionIds).toEqual(['sale-pdv-1_revenue']);
    expect(document.pricing.totalCents).toBe(3000);
  });

  it('adapta DeliveryOrder público e preserva estoque/modificadores', () => {
    const document = adaptDeliveryOrderToCommercialV2(publicFixture.document);
    expect(CommercialDocumentV2Schema.safeParse(document).success).toBe(true);
    expect(document.channel).toBe('site');
    expect(document.lines[0].selectedModifiers?.[0].selectedOptions[0].additionalPriceCents).toBe(400);
    expect(document.effects.stockMovementIds).toEqual(['movement-public-1']);
    expect(document.pricing).toMatchObject({ subtotalCents: 4400, deliveryFeeCents: 600, discountCents: 500, totalCents: 4500 });
  });

  it('recupera variantId do documento manual sem depender do schema legado', () => {
    const document = adaptDeliveryOrderToCommercialV2(manualFixture.document);
    expect(document.lines[0]).toMatchObject({ variantId: 'variant-blue-m', variantNameSnapshot: 'Camiseta Azul M' });
    expect(CommercialDocumentV2Schema.safeParse(document).success).toBe(true);
  });

  it('normaliza gift card legado como tender e ajuste de compatibilidade', () => {
    const raw = {
      ...publicFixture.document,
      giftCardId: 'gift-1',
      giftCardAmount: 10,
      total: 35,
    };
    const document = adaptDeliveryOrderToCommercialV2(raw);
    expect(document.pricing.totalCents).toBe(3500);
    expect(document.payments).toContainEqual(expect.objectContaining({ method: 'gift_card', amountCents: 1000 }));
    expect(document.pricing.discounts).toContainEqual(expect.objectContaining({ source: 'other', amountCents: 1000 }));
  });

  it('adapta Order B2B sem fundir a coleção legada', () => {
    const document = adaptOrderToCommercialV2(b2bFixture.document);
    expect(document).toMatchObject({ sourceType: 'order', sourceId: 'order-b2b-1', channel: 'b2b' });
    expect(document.payments[0]).toMatchObject({ method: 'boleto', amountCents: 22500, status: 'pending' });
    expect(document.pricing.totalCents).toBe(22500);
  });

  it('faz o contrato público corresponder ao payload que o cardápio já envia', () => {
    expect(CreatePublicOrderBodySchema.safeParse(publicFixture.request).success).toBe(true);
    const withoutAddress = structuredClone(publicFixture.request);
    delete (withoutAddress as { deliveryAddress?: unknown }).deliveryAddress;
    expect(CreatePublicOrderBodySchema.safeParse(withoutAddress).success).toBe(false);
  });
});

describe('M02.1 — fronteiras server-side', () => {
  it('protege a cotação por tenant/função e não realiza escrita', () => {
    const route = readFileSync('app/api/commercial/quote/route.ts', 'utf8');
    const service = readFileSync('lib/services/commercial-quote.ts', 'utf8');
    expect(route).toContain('CreateCommercialQuoteBodySchema.safeParse');
    expect(route).toContain('verifyAuth(request, parsed.data.businessId)');
    expect(route).toContain('ROLE_HIERARCHY.operator');
    expect(route).toContain('ROLE_HIERARCHY.manager');
    expect(service).toContain("loadDocuments(db, 'products'");
    expect(service).toContain("loadDocuments(db, 'services'");
    expect(service).not.toMatch(/\.doc\([^)]*\)\.(set|create|update|delete)\s*\(/);
    expect(service).not.toMatch(/\.ref\.(set|create|update|delete)\s*\(/);
    expect(service).not.toContain('.batch(');
    expect(service).not.toContain('runTransaction');
  });

  it('usa o contrato consolidado no boundary público', () => {
    const route = readFileSync('app/api/orders/public/route.ts', 'utf8');
    expect(route).toContain('CreatePublicOrderBodySchema.safeParse');
    expect(route).toContain('const body: CreatePublicOrderBody = parsedBody.data');
    expect(route).not.toContain('interface PublicOrderPayload');
  });
});
