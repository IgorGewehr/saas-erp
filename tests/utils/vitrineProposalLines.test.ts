import { describe, it, expect } from 'vitest';
import {
  MAX_LINE_QUANTITY,
  lineKey,
  addLine,
  setLineQuantity,
  removeLine,
  checkProductForProposal,
  toProposalLine,
  getStockShortfalls,
  computeProposalTotals,
  buildCreateOrderBody,
  type ProposalLine,
} from '@/lib/utils/vitrineProposal';
import type { BusinessPromotion, Product, ProductVariant } from '@/lib/types';

function line(overrides: Partial<ProposalLine> = {}): ProposalLine {
  return { productId: 'p1', name: 'Pacote Spot', unitPriceCents: 150_000, quantity: 1, ...overrides };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', businessId: 'biz_1', name: 'Pacote Spot', category: 'Pacotes', unit: 'UN',
    costPrice: 100, salePrice: 1500, currentStock: 0, minStock: 0, isActive: true, trackStock: false,
    createdAt: '', updatedAt: '', ...overrides,
  };
}

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'v30', name: '30s', attributes: {}, salePrice: 1200, costPrice: 0, currentStock: 0,
    minStock: 0, trackStock: false, isActive: true, ...overrides,
  };
}

function promo(overrides: Partial<BusinessPromotion> = {}): BusinessPromotion {
  return { id: 'promo1', name: 'Lançamento', type: 'percentage', value: 10, isActive: true, ...overrides };
}

const NOW = new Date('2026-09-18T12:00:00.000Z');

describe('linhas da proposta', () => {
  it('lineKey separa o mesmo produto com opções diferentes', () => {
    expect(lineKey({ productId: 'p1' })).toBe('p1::');
    expect(lineKey({ productId: 'p1', variantId: 'v15' })).not.toBe(lineKey({ productId: 'p1', variantId: 'v30' }));
  });

  it('addLine soma a quantidade do mesmo item em vez de duplicar a linha', () => {
    const once = addLine([], line({ quantity: 1 }));
    const twice = addLine(once, line({ quantity: 2 }));
    expect(twice).toHaveLength(1);
    expect(twice[0].quantity).toBe(3);
  });

  it('addLine mantém linhas de opções diferentes separadas', () => {
    const lines = addLine(addLine([], line({ variantId: 'v15' })), line({ variantId: 'v30' }));
    expect(lines).toHaveLength(2);
  });

  it('addLine limita a quantidade e ignora quantidade zero', () => {
    expect(addLine([], line({ quantity: 5000 }))[0].quantity).toBe(MAX_LINE_QUANTITY);
    expect(addLine([], line({ quantity: 0 }))).toEqual([]);
    expect(addLine([line({ quantity: MAX_LINE_QUANTITY })], line({ quantity: 5 }))[0].quantity).toBe(MAX_LINE_QUANTITY);
  });

  it('addLine não muda o array original', () => {
    const original = [line({ quantity: 1 })];
    addLine(original, line({ quantity: 4 }));
    expect(original[0].quantity).toBe(1);
  });

  it('setLineQuantity ajusta e remove quando chega a zero ou menos', () => {
    const lines = [line({ quantity: 2 })];
    expect(setLineQuantity(lines, 'p1::', 5)[0].quantity).toBe(5);
    expect(setLineQuantity(lines, 'p1::', 0)).toEqual([]);
    expect(setLineQuantity(lines, 'p1::', -3)).toEqual([]);
  });

  it('removeLine só tira a linha da chave', () => {
    const lines = [line(), line({ productId: 'p2' })];
    expect(removeLine(lines, 'p1::').map((l) => l.productId)).toEqual(['p2']);
  });
});

describe('checkProductForProposal', () => {
  it('produto simples com preço entra', () => {
    expect(checkProductForProposal(product())).toEqual({ ok: true });
  });

  it('sem preço não entra', () => {
    expect(checkProductForProposal(product({ salePrice: 0 }))).toMatchObject({ ok: false });
  });

  it('com opções exige escolher uma, ativa e com preço', () => {
    const withVariants = product({ variants: [variant()] });
    expect(checkProductForProposal(withVariants)).toEqual({ ok: false, reason: 'Escolha uma opção.' });
    expect(checkProductForProposal(withVariants, variant())).toEqual({ ok: true });
    expect(
      checkProductForProposal(product({ variants: [variant({ isActive: false })] }), variant({ isActive: false })),
    ).toMatchObject({ ok: false });
    expect(checkProductForProposal(withVariants, variant({ salePrice: 0 }))).toMatchObject({ ok: false });
  });

  it('kind=variant sem opção escolhida também exige escolha (servidor: VARIANT_REQUIRED)', () => {
    expect(checkProductForProposal(product({ kind: 'variant', variants: [] }))).toEqual({ ok: false, reason: 'Escolha uma opção.' });
  });

  it('personalização obrigatória não entra (a Vitrine não monta modificadores)', () => {
    const custom = product({
      modifierGroups: [{
        id: 'g1', name: 'Sabor', required: true, minSelections: 1, maxSelections: 1,
        selectionType: 'single', priceStrategy: 'sum', options: [], sortOrder: 0,
      }],
    });
    expect(checkProductForProposal(custom)).toMatchObject({ ok: false });
  });
});

describe('toProposalLine', () => {
  it('produto simples usa o preço do produto, em centavos', () => {
    expect(toProposalLine(product({ salePrice: 1234.56 }))).toEqual({
      productId: 'p1', name: 'Pacote Spot', unitPriceCents: 123_456, quantity: 1,
    });
  });

  it('com opção usa o preço e o nome da opção', () => {
    expect(toProposalLine(product(), variant({ salePrice: 800 }), 3)).toEqual({
      productId: 'p1', variantId: 'v30', variantName: '30s', name: 'Pacote Spot', unitPriceCents: 80_000, quantity: 3,
    });
  });
});

describe('getStockShortfalls', () => {
  it('item sem controle de estoque nunca falta, mesmo com saldo 0 (serviço)', () => {
    expect(getStockShortfalls([line({ quantity: 5 })], [product({ trackStock: false, currentStock: 0 })])).toEqual([]);
  });

  it('trackStock ausente conta como controlado', () => {
    const tracked = product({ currentStock: 2 });
    delete (tracked as Partial<Product>).trackStock;
    expect(getStockShortfalls([line({ quantity: 5 })], [tracked])).toEqual([
      { key: 'p1::', name: 'Pacote Spot', requested: 5, available: 2 },
    ]);
  });

  it('saldo suficiente não acusa falta', () => {
    expect(getStockShortfalls([line({ quantity: 5 })], [product({ trackStock: true, currentStock: 5 })])).toEqual([]);
  });

  it('linha com opção segue a opção, e o nome inclui a opção', () => {
    const p = product({ trackStock: false, variants: [variant({ trackStock: true, currentStock: 1 })] });
    const result = getStockShortfalls([line({ variantId: 'v30', variantName: '30s', quantity: 4 })], [p]);
    expect(result).toEqual([{ key: 'p1::v30', name: 'Pacote Spot — 30s', requested: 4, available: 1 }]);
  });

  it('composto (BOM) e produto desconhecido ficam com o servidor', () => {
    const composite = product({ trackStock: true, currentStock: 0, components: [{ productId: 'x', productName: 'X', quantity: 1 }] });
    expect(getStockShortfalls([line()], [composite])).toEqual([]);
    expect(getStockShortfalls([line({ productId: 'fantasma' })], [])).toEqual([]);
  });
});

describe('computeProposalTotals', () => {
  const base = { lines: [line({ unitPriceCents: 150_000, quantity: 2 })], installments: 1, now: NOW };

  it('sem promoção nem negociação: total = subtotal, sem motivo de desconto', () => {
    const totals = computeProposalTotals({ ...base, promotion: null, negotiatedTotalCents: null });
    expect(totals).toMatchObject({ subtotalCents: 300_000, discountCents: 0, totalCents: 300_000, promotionApplies: true });
    expect(totals.discountReason).toBeUndefined();
  });

  it('total negociado vira desconto', () => {
    const totals = computeProposalTotals({ ...base, promotion: null, negotiatedTotalCents: 270_000 });
    expect(totals).toMatchObject({ discountCents: 30_000, totalCents: 270_000 });
  });

  it('promoção percentual aplica sobre o subtotal e dá o motivo', () => {
    const totals = computeProposalTotals({ ...base, promotion: promo({ value: 10 }), negotiatedTotalCents: null });
    expect(totals).toMatchObject({ discountCents: 30_000, totalCents: 270_000, discountReason: 'Promoção: Lançamento' });
  });

  it('promoção escolhida tem prioridade sobre o valor negociado', () => {
    const totals = computeProposalTotals({ ...base, promotion: promo({ value: 10 }), negotiatedTotalCents: 100_000 });
    expect(totals.totalCents).toBe(270_000);
  });

  it('promoção abaixo do pedido mínimo: sem desconto e sinaliza que não vale', () => {
    const totals = computeProposalTotals({ ...base, promotion: promo({ minOrderValue: 5000 }), negotiatedTotalCents: null });
    expect(totals).toMatchObject({ discountCents: 0, totalCents: 300_000, promotionApplies: false });
  });

  it('recalcula a promoção quando as linhas mudam (percentual sobre o novo subtotal)', () => {
    const totals = computeProposalTotals({
      lines: [line({ unitPriceCents: 150_000, quantity: 4 })],
      installments: 1,
      now: NOW,
      promotion: promo({ value: 10 }),
      negotiatedTotalCents: null,
    });
    expect(totals.discountCents).toBe(60_000);
  });

  it('cronograma: parcelas somam o total e vencem de 30 em 30 dias a partir de agora', () => {
    const totals = computeProposalTotals({ ...base, installments: 3, promotion: null, negotiatedTotalCents: 100_000 });
    expect(totals.schedule.map((s) => s.dueDate)).toEqual(['2026-09-18', '2026-10-18', '2026-11-17']);
    const sum = totals.schedule.reduce((acc, s) => acc + s.amount, 0);
    expect(Math.round(sum * 100)).toBe(totals.totalCents);
  });

  it('total negociado acima do subtotal não vira acréscimo', () => {
    const totals = computeProposalTotals({ ...base, promotion: null, negotiatedTotalCents: 999_999 });
    expect(totals).toMatchObject({ discountCents: 0, totalCents: 300_000 });
  });
});

describe('buildCreateOrderBody com opções', () => {
  it('manda variantId no item quando a linha tem opção', () => {
    const body = buildCreateOrderBody({
      businessId: 'biz_1',
      lines: [line({ variantId: 'v30', variantName: '30s', quantity: 2 }), line({ productId: 'p2', quantity: 1 })],
      clientId: 'cli_1',
      clientName: 'Zé',
      discountCents: 0,
      installments: 1,
      idempotencyKey: '5b3c0c9e-0000-4000-8000-000000000001',
    });
    expect(body.items).toEqual([
      { productId: 'p1', variantId: 'v30', quantity: 2 },
      { productId: 'p2', quantity: 1 },
    ]);
  });
});
