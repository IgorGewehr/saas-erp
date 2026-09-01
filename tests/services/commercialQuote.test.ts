import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { ProductV2Schema, type ProductV2 } from '@/contracts/domain/productV2';
import { ServiceSchema, type Service } from '@/contracts/domain/service';
import { CommercialQuoteSchema } from '@/contracts/domain/commercialV2';
import {
  buildCommercialQuote,
  quoteCommercialCartAdmin,
  CommercialQuoteError,
  reaisToCents,
  type CommercialQuoteResources,
} from '@/lib/services/commercial-quote';

const NOW = '2026-08-29T12:00:00.000Z';

function product(overrides: Record<string, unknown> = {}): ProductV2 {
  return ProductV2Schema.parse({
    schemaVersion: 2,
    id: 'product-burger',
    businessId: 'biz-m02',
    kind: 'simple',
    name: 'Hambúrguer',
    category: 'Lanches',
    unit: 'UN',
    purchaseUnit: 'UN',
    purchaseToStockFactor: 1,
    costMethod: 'moving_average',
    costPrice: 12,
    salePrice: 30,
    currentStock: 10,
    minStock: 0,
    trackStock: true,
    trackLots: false,
    trackExpiry: false,
    expiryWarningDays: 30,
    isActive: true,
    images: [],
    variants: [],
    isDeliverable: true,
    menuAvailable: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function service(overrides: Record<string, unknown> = {}): Service {
  return ServiceSchema.parse({
    id: 'service-cut',
    businessId: 'biz-m02',
    name: 'Corte',
    duration: 30,
    price: 49.9,
    color: '#000000',
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function resources(products: ProductV2[], services: Service[] = [], overrides: Partial<CommercialQuoteResources> = {}): CommercialQuoteResources {
  return {
    products: new Map(products.map((item) => [item.id, item])),
    services: new Map(services.map((item) => [item.id, item])),
    canApplyManualDiscount: false,
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    businessId: 'biz-m02',
    channel: 'pdv',
    lines: [{ productId: 'product-burger', quantity: 1 }],
    tipCents: 0,
    ...overrides,
  };
}

describe('M02.1 — cotação comercial autoritativa', () => {
  it('usa uma única política de arredondamento em centavos', () => {
    expect(reaisToCents(10.004)).toBe(1000);
    expect(reaisToCents(10.005)).toBe(1001);
    expect(reaisToCents(0.1 + 0.2)).toBe(30);
  });

  it('produz o mesmo total para a mesma cesta nos canais internos', () => {
    const catalog = resources([product()]);
    const totals = ['pdv', 'manual', 'b2b', 'api_v1'].map((channel) =>
      buildCommercialQuote(request({ channel }), catalog, new Date(NOW)).pricing.totalCents,
    );
    expect(totals).toEqual([3000, 3000, 3000, 3000]);
  });

  it('ignora preço e nome adulterados e relê modificadores pelo ID', () => {
    const bacon = product({
      id: 'ingredient-bacon',
      name: 'Bacon em estoque',
      salePrice: 0,
      costPrice: 1,
      currentStock: 5,
      isDeliverable: false,
    });
    const burger = product({
      modifierGroups: [{
        id: 'extras',
        name: 'Extras',
        required: false,
        minSelections: 0,
        maxSelections: 3,
        selectionType: 'quantity',
        priceStrategy: 'sum',
        sortOrder: 0,
        options: [{
          id: 'bacon',
          name: 'Bacon',
          additionalPrice: 4,
          available: true,
          maxQuantity: 2,
          sortOrder: 0,
          linkedProductId: bacon.id,
          consumeQty: 0.5,
        }],
      }],
    });
    const quote = buildCommercialQuote(request({
      channel: 'site',
      lines: [{
        productId: burger.id,
        quantity: 2,
        selectedModifiers: [{
          groupId: 'extras',
          selectedOptions: [{
            optionId: 'bacon',
            quantity: 1,
            optionName: 'Nome adulterado',
            additionalPriceCents: 1,
          }],
        }],
      }],
    }), resources([burger, bacon]), new Date(NOW));

    expect(quote.pricing.subtotalCents).toBe(6800);
    expect(quote.lines[0].selectedModifiers?.[0].selectedOptions[0]).toMatchObject({
      optionName: 'Bacon',
      additionalPriceCents: 400,
    });
    expect(quote.lines[0].stockRequirements).toContainEqual(expect.objectContaining({
      productId: bacon.id,
      quantity: 1,
      available: 5,
    }));
  });

  it('precifica a variação e agrega disputa pelo mesmo estoque', () => {
    const shirt = product({
      id: 'product-shirt',
      kind: 'variant',
      name: 'Camiseta',
      salePrice: 40,
      variants: [{
        id: 'blue-m',
        name: 'Azul M',
        attributes: { cor: 'Azul', tamanho: 'M' },
        sku: 'SHIRT-BLUE-M',
        salePrice: 52.9,
        costPrice: 20,
        currentStock: 3,
        minStock: 0,
        trackStock: true,
        isActive: true,
      }],
    });
    const quote = buildCommercialQuote(request({
      lines: [
        { productId: shirt.id, variantId: 'blue-m', quantity: 2 },
        { productId: shirt.id, variantId: 'blue-m', quantity: 2 },
      ],
    }), resources([shirt]), new Date(NOW));

    expect(quote.pricing.totalCents).toBe(21_160);
    expect(quote.lines[0]).toMatchObject({
      variantId: 'blue-m', variantNameSnapshot: 'Azul M', skuSnapshot: 'SHIRT-BLUE-M', unitAmountCents: 5290,
    });
    expect(quote.availability).toEqual({
      available: false,
      shortages: [expect.objectContaining({ productId: shirt.id, variantId: 'blue-m', quantity: 4, available: 3 })],
    });
  });

  it('cota serviço e os insumos consumidos pelo operador permitido', () => {
    const towel = product({ id: 'towel', name: 'Toalha', currentStock: 2, salePrice: 0 });
    const cut = service({
      operatorIds: ['operator-1'],
      consumedComponents: [{ productId: towel.id, productName: towel.name, quantity: 1 }],
    });
    const quote = buildCommercialQuote(request({
      lines: [{ serviceId: cut.id, quantity: 3 }],
    }), resources([towel], [cut], { operatorId: 'operator-1' }), new Date(NOW));

    expect(quote.pricing.totalCents).toBe(14_970);
    expect(quote.availability.available).toBe(false);
    expect(quote.availability.shortages[0]).toMatchObject({ productId: towel.id, quantity: 3, available: 2 });
  });

  it('aplica desconto manual somente com permissão e rejeita total obsoleto', () => {
    const catalog = resources([product()], [], { canApplyManualDiscount: true });
    const quote = buildCommercialQuote(request({
      manualDiscount: { kind: 'percent', basisPoints: 1_250, reason: 'Negociação autorizada' },
    }), catalog, new Date(NOW));
    expect(quote.pricing).toMatchObject({ subtotalCents: 3000, discountCents: 375, totalCents: 2625 });

    expect(() => buildCommercialQuote(request({
      manualDiscount: { kind: 'fixed', amountCents: 100, reason: 'Sem permissão' },
    }), resources([product()]), new Date(NOW))).toThrowError(CommercialQuoteError);

    expect(() => buildCommercialQuote(request({ expectedTotalCents: 2999 }), catalog, new Date(NOW)))
      .toThrowError(/total foi atualizado/i);
  });

  it('valida tenant, estado ativo, disponibilidade do cardápio e variação obrigatória', () => {
    expect(() => buildCommercialQuote(request(), resources([product({ businessId: 'other-biz' })]), new Date(NOW)))
      .toThrowError(/não pertence/i);
    expect(() => buildCommercialQuote(request(), resources([product({ isActive: false })]), new Date(NOW)))
      .toThrowError(/inativo/i);
    expect(() => buildCommercialQuote(request({ channel: 'site' }), resources([product({ menuAvailable: false })]), new Date(NOW)))
      .toThrowError(/indisponível hoje/i);
    const variantProduct = product({
      kind: 'variant',
      variants: [{ id: 'v1', name: 'V1', attributes: {}, salePrice: 30, costPrice: 1, currentStock: 1, minStock: 0, trackStock: true, isActive: true }],
    });
    expect(() => buildCommercialQuote(request(), resources([variantProduct]), new Date(NOW)))
      .toThrowError(/escolha uma variação/i);
  });

  it('sempre entrega um documento que satisfaz o contrato V2', () => {
    const quote = buildCommercialQuote(request({
      delivery: { type: 'entrega', bairro: 'Centro' },
      tipCents: 123,
    }), resources([product()], [], {
      delivery: { feeCents: 650, resolution: 'matched', zoneName: 'Centro', estimatedMinutes: 30 },
    }), new Date(NOW));
    expect(CommercialQuoteSchema.safeParse(quote).success).toBe(true);
    expect(quote.pricing.totalCents).toBe(3773);
  });
});

function fakeReadOnlyDb(docs: Record<string, Record<string, unknown>>): Firestore {
  const ref = (coll: string, id: string) => ({
    id,
    async get() {
      const data = docs[`${coll}/${id}`];
      return { exists: Boolean(data), id, data: () => data };
    },
  });
  return {
    collection(coll: string) {
      return { doc: (id: string) => ref(coll, id) };
    },
    async getAll(...refs: Array<{ get: () => Promise<unknown> }>) {
      return Promise.all(refs.map((r) => r.get()));
    },
  } as unknown as Firestore;
}

describe('M02.5b — resolução de zona em quoteCommercialCartAdmin', () => {
  const NOW2 = new Date('2026-09-01T12:00:00.000Z');
  function docs(overrides: { deliveryZones?: unknown[]; flatFee?: number } = {}) {
    return {
      'products/product-burger': { ...product(), id: undefined },
      'businesses/biz-m02': {
        id: 'biz-m02',
        settings: {
          aiAgent: {
            deliveryZones: overrides.deliveryZones,
            pedidos: { deliveryFee: overrides.flatFee },
          },
        },
      },
    };
  }
  function deliveryRequest(overrides: Record<string, unknown> = {}) {
    return request({
      delivery: { type: 'entrega', bairro: 'Bairro Desconhecido', ...overrides },
    });
  }

  it('zona casada é autoritativa mesmo com override manual enviado', async () => {
    const db = fakeReadOnlyDb(docs({
      deliveryZones: [{ id: 'z1', name: 'Centro', type: 'neighborhood', value: 'Bairro Desconhecido', fee: 7 }],
    }));
    const quote = await quoteCommercialCartAdmin({
      db,
      input: deliveryRequest({ manualFeeCents: 99999 }),
      canApplyManualDiscount: false,
      canOverrideDeliveryFee: true,
      quotedAt: NOW2,
    });
    expect(quote.delivery).toMatchObject({ resolution: 'matched', feeCents: 700 });
  });

  it('fora de área sem override continua bloqueando', async () => {
    const db = fakeReadOnlyDb(docs({
      deliveryZones: [{ id: 'z1', name: 'Centro', type: 'neighborhood', value: 'Outro Bairro', fee: 7 }],
    }));
    await expect(quoteCommercialCartAdmin({
      db, input: deliveryRequest(), canApplyManualDiscount: false, quotedAt: NOW2,
    })).rejects.toThrowError(/fora da área/i);
  });

  it('fora de área com override e permissão usa a taxa proposta', async () => {
    const db = fakeReadOnlyDb(docs({
      deliveryZones: [{ id: 'z1', name: 'Centro', type: 'neighborhood', value: 'Outro Bairro', fee: 7 }],
    }));
    const quote = await quoteCommercialCartAdmin({
      db,
      input: deliveryRequest({ manualFeeCents: 1200 }),
      canApplyManualDiscount: false,
      canOverrideDeliveryFee: true,
      quotedAt: NOW2,
    });
    expect(quote.delivery).toMatchObject({ resolution: 'manual', feeCents: 1200 });
  });

  it('fora de área com override mas sem permissão rejeita', async () => {
    const db = fakeReadOnlyDb(docs({
      deliveryZones: [{ id: 'z1', name: 'Centro', type: 'neighborhood', value: 'Outro Bairro', fee: 7 }],
    }));
    await expect(quoteCommercialCartAdmin({
      db,
      input: deliveryRequest({ manualFeeCents: 1200 }),
      canApplyManualDiscount: false,
      canOverrideDeliveryFee: false,
      quotedAt: NOW2,
    })).rejects.toThrowError(/não permite definir a taxa/i);
  });

  it('sem zonas configuradas cai na taxa plana quando não há override', async () => {
    const db = fakeReadOnlyDb(docs({ flatFee: 5 }));
    const quote = await quoteCommercialCartAdmin({
      db, input: deliveryRequest(), canApplyManualDiscount: false, quotedAt: NOW2,
    });
    expect(quote.delivery).toMatchObject({ resolution: 'flat', feeCents: 500 });
  });

  it('sem zonas configuradas com override e permissão usa a taxa proposta em vez da plana', async () => {
    const db = fakeReadOnlyDb(docs({ flatFee: 5 }));
    const quote = await quoteCommercialCartAdmin({
      db,
      input: deliveryRequest({ manualFeeCents: 800 }),
      canApplyManualDiscount: false,
      canOverrideDeliveryFee: true,
      quotedAt: NOW2,
    });
    expect(quote.delivery).toMatchObject({ resolution: 'manual', feeCents: 800 });
  });
});
