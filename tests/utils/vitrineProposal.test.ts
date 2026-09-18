import { describe, it, expect } from 'vitest';
import {
  moneyToCents,
  centsToMoney,
  parseMoneyToCents,
  lineTotalCents,
  subtotalCents,
  negotiatedToDiscountCents,
  totalAfterDiscountCents,
  buildCreateOrderBody,
  describePaymentTerms,
  type ProposalLine,
} from '@/lib/utils/vitrineProposal';

function line(overrides: Partial<ProposalLine> = {}): ProposalLine {
  return { productId: 'p1', name: 'Pacote Spot 30s', unitPriceCents: 150_000, quantity: 1, ...overrides };
}

describe('moneyToCents / centsToMoney', () => {
  it('converte reais em centavos sem erro de ponto flutuante', () => {
    expect(moneyToCents(123.45)).toBe(12_345);
    expect(moneyToCents(0.1 + 0.2)).toBe(30);
    expect(moneyToCents(19.99)).toBe(1_999);
  });

  it('valores não finitos viram 0', () => {
    expect(moneyToCents(NaN)).toBe(0);
    expect(moneyToCents(Infinity)).toBe(0);
  });

  it('ida e volta preserva o valor', () => {
    expect(centsToMoney(moneyToCents(4321.09))).toBe(4321.09);
  });
});

describe('parseMoneyToCents (entrada pt-BR do vendedor)', () => {
  it.each([
    ['1.500,50', 150_050],
    ['1500,5', 150_050],
    ['1500.50', 150_050],
    ['1.500', 150_000],
    ['1500', 150_000],
    ['R$ 2.000', 200_000],
    ['R$2.000,00', 200_000],
    ['0,99', 99],
    ['10', 1_000],
    ['1.234.567,89', 123_456_789],
  ])('%s → %i', (text, cents) => {
    expect(parseMoneyToCents(text)).toBe(cents);
  });

  it.each(['', '   ', 'abc', '12a', '-100', 'R$', '1,2,3x'])('rejeita %j', (text) => {
    expect(parseMoneyToCents(text)).toBeNull();
  });
});

describe('subtotal e total', () => {
  it('lineTotalCents = preço × quantidade', () => {
    expect(lineTotalCents(line({ unitPriceCents: 25_000, quantity: 4 }))).toBe(100_000);
  });

  it('quantidade negativa ou fracionária não gera total negativo/quebrado', () => {
    expect(lineTotalCents(line({ quantity: -2 }))).toBe(0);
    expect(lineTotalCents(line({ unitPriceCents: 1_000, quantity: 2.9 }))).toBe(2_000);
  });

  it('subtotalCents soma as linhas', () => {
    expect(subtotalCents([line({ quantity: 2 }), line({ productId: 'p2', unitPriceCents: 50_000 })])).toBe(350_000);
  });

  it('proposta vazia soma zero', () => {
    expect(subtotalCents([])).toBe(0);
  });
});

describe('negotiatedToDiscountCents', () => {
  it('desconto = subtotal - total negociado', () => {
    expect(negotiatedToDiscountCents(300_000, 270_000)).toBe(30_000);
  });

  it('total negociado igual ao subtotal = sem desconto', () => {
    expect(negotiatedToDiscountCents(300_000, 300_000)).toBe(0);
  });

  it('total negociado ACIMA do subtotal não vira acréscimo (desconto 0)', () => {
    expect(negotiatedToDiscountCents(300_000, 350_000)).toBe(0);
  });

  it('total negociado zero dá desconto igual ao subtotal (nunca maior)', () => {
    expect(negotiatedToDiscountCents(300_000, 0)).toBe(300_000);
  });

  it('total negociado negativo fica preso no subtotal', () => {
    expect(negotiatedToDiscountCents(300_000, -50_000)).toBe(300_000);
  });
});

describe('totalAfterDiscountCents', () => {
  it('subtrai o desconto', () => {
    expect(totalAfterDiscountCents(300_000, 30_000)).toBe(270_000);
  });

  it('desconto acima do subtotal não deixa total negativo', () => {
    expect(totalAfterDiscountCents(100_000, 999_999)).toBe(0);
  });

  it('desconto negativo é ignorado', () => {
    expect(totalAfterDiscountCents(100_000, -500)).toBe(100_000);
  });
});

describe('describePaymentTerms', () => {
  it('à vista quando 1 parcela', () => {
    expect(describePaymentTerms(1)).toBe('À vista');
  });

  it('descreve parcelas mensais', () => {
    expect(describePaymentTerms(3)).toBe('3x a cada 30 dias');
  });
});

describe('buildCreateOrderBody', () => {
  const base = {
    businessId: 'biz_1',
    lines: [line({ quantity: 2 })],
    clientId: 'cli_1',
    clientName: 'Padaria do Zé',
    installments: 3,
    idempotencyKey: '5b3c0c9e-0000-4000-8000-000000000001',
  };

  it('monta só a INTENÇÃO de item (productId + quantity), sem preço', () => {
    const body = buildCreateOrderBody({ ...base, discountCents: 0 });
    expect(body.items).toEqual([{ productId: 'p1', quantity: 2 }]);
    expect(JSON.stringify(body.items)).not.toContain('Price');
  });

  it('sem desconto: não manda discount nem discountReason', () => {
    const body = buildCreateOrderBody({ ...base, discountCents: 0 });
    expect(body).not.toHaveProperty('discount');
    expect(body).not.toHaveProperty('discountReason');
    expect(body.expectedTotalCents).toBe(300_000);
  });

  it('com desconto: manda reais + motivo e o total esperado já descontado', () => {
    const body = buildCreateOrderBody({ ...base, discountCents: 30_000, discountReason: 'Promoção: Lançamento' });
    expect(body.discount).toBe(300);
    expect(body.discountReason).toBe('Promoção: Lançamento');
    expect(body.expectedTotalCents).toBe(270_000);
  });

  it('motivo ausente ou curto demais cai no motivo padrão (contrato exige ≥3 chars)', () => {
    expect(buildCreateOrderBody({ ...base, discountCents: 1_000 }).discountReason).toBe('Negociação comercial');
    expect(buildCreateOrderBody({ ...base, discountCents: 1_000, discountReason: 'ab' }).discountReason).toBe('Negociação comercial');
  });

  it('desconto maior que o subtotal fica preso ao subtotal', () => {
    const body = buildCreateOrderBody({ ...base, discountCents: 9_999_999 });
    expect(body.discount).toBe(3_000);
    expect(body.expectedTotalCents).toBe(0);
  });

  it('inclui idempotencyKey, tipo b2b e prazo descrito', () => {
    const body = buildCreateOrderBody({ ...base, discountCents: 0 });
    expect(body.idempotencyKey).toBe(base.idempotencyKey);
    expect(body.type).toBe('b2b');
    expect(body.paymentTerms).toBe('3x a cada 30 dias');
    expect(body.installments).toBe(3);
  });

  it('limita parcelas a 1..48', () => {
    expect(buildCreateOrderBody({ ...base, discountCents: 0, installments: 0 }).installments).toBe(1);
    expect(buildCreateOrderBody({ ...base, discountCents: 0, installments: 99 }).installments).toBe(48);
  });

  it('reais do desconto sobrevivem ao round-trip do servidor (Math.round(x*100))', () => {
    for (const cents of [12_345, 1, 99, 100_001, 7_777_777]) {
      const body = buildCreateOrderBody({ ...base, lines: [line({ unitPriceCents: 9_000_000 })], discountCents: cents });
      expect(Math.round((body.discount ?? 0) * 100)).toBe(cents);
    }
  });
});
