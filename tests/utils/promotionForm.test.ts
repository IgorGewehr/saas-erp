import { describe, it, expect } from 'vitest';
import {
  parsePromotionForm,
  promotionStatus,
  describePromotionValue,
  describePromotionTerms,
  upsertPromotion,
  removePromotion,
  setPromotionActive,
  type PromotionFormInput,
} from '@/lib/utils/promotionForm';
import { getActivePromotions, applyPromotion } from '@/lib/utils/promotions';
import type { BusinessPromotion } from '@/lib/types';

const TODAY = '2026-09-18';
const NOW = new Date(2026, 8, 18, 15, 0);

function form(overrides: Partial<PromotionFormInput> = {}): PromotionFormInput {
  return { name: 'Lançamento', type: 'percentage', valueText: '10', minOrderText: '', validUntil: '', ...overrides };
}

function promo(overrides: Partial<BusinessPromotion> = {}): BusinessPromotion {
  return { id: 'p1', name: 'Lançamento', type: 'percentage', value: 10, isActive: true, ...overrides };
}

describe('parsePromotionForm', () => {
  it('percentual simples', () => {
    expect(parsePromotionForm(form(), TODAY)).toEqual({
      ok: true, value: { name: 'Lançamento', type: 'percentage', value: 10 },
    });
  });

  it('aceita vírgula e símbolo de %', () => {
    const result = parsePromotionForm(form({ valueText: '12,5%' }), TODAY);
    expect(result.ok && result.value.value).toBe(12.5);
  });

  it.each(['0', '-5', '101', 'abc', ''])('rejeita percentual %j', (valueText) => {
    const result = parsePromotionForm(form({ valueText }), TODAY);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.valueText).toBeDefined();
  });

  it('valor fixo em reais no formato pt-BR', () => {
    const result = parsePromotionForm(form({ type: 'fixed', valueText: '1.500,50' }), TODAY);
    expect(result.ok && result.value.value).toBe(1500.5);
  });

  it('valor fixo zero ou inválido é recusado', () => {
    expect(parsePromotionForm(form({ type: 'fixed', valueText: '0' }), TODAY).ok).toBe(false);
    expect(parsePromotionForm(form({ type: 'fixed', valueText: 'dez' }), TODAY).ok).toBe(false);
  });

  it('pedido mínimo e validade opcionais entram quando válidos', () => {
    const result = parsePromotionForm(form({ minOrderText: '1.000', validUntil: '2026-12-31' }), TODAY);
    expect(result).toEqual({
      ok: true,
      value: { name: 'Lançamento', type: 'percentage', value: 10, minOrderValue: 1000, validUntil: '2026-12-31' },
    });
  });

  it('pedido mínimo zero é o mesmo que sem mínimo', () => {
    const result = parsePromotionForm(form({ minOrderText: '0' }), TODAY);
    expect(result.ok && 'minOrderValue' in result.value).toBe(false);
  });

  it('validade de hoje vale; de ontem é recusada; formato ruim também', () => {
    expect(parsePromotionForm(form({ validUntil: TODAY }), TODAY).ok).toBe(true);
    expect(parsePromotionForm(form({ validUntil: '2026-09-17' }), TODAY)).toMatchObject({ ok: false, errors: { validUntil: 'Esta data já passou.' } });
    expect(parsePromotionForm(form({ validUntil: '18/12/2026' }), TODAY).ok).toBe(false);
  });

  it('nome obrigatório e com limite', () => {
    expect(parsePromotionForm(form({ name: ' ' }), TODAY).ok).toBe(false);
    expect(parsePromotionForm(form({ name: 'x'.repeat(81) }), TODAY).ok).toBe(false);
    expect(parsePromotionForm(form({ name: '  Black Friday  ' }), TODAY)).toMatchObject({ ok: true, value: { name: 'Black Friday' } });
  });

  it('junta todos os erros de uma vez', () => {
    const result = parsePromotionForm(form({ name: '', valueText: '0', minOrderText: 'x', validUntil: 'ontem' }), TODAY);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['minOrderText', 'name', 'validUntil', 'valueText']);
  });

  it('o que o formulário gera funciona ponta a ponta com o motor de promoções', () => {
    const parsed = parsePromotionForm(form({ valueText: '15', minOrderText: '1.000', validUntil: '2026-09-30' }), TODAY);
    if (!parsed.ok) throw new Error('form inválido');
    const saved: BusinessPromotion = { id: 'x', isActive: true, ...parsed.value };

    expect(getActivePromotions([saved], NOW)).toHaveLength(1);
    expect(applyPromotion(saved, 200_000)).toEqual({ discountCents: 30_000, reason: 'Promoção: Lançamento' });
    expect(applyPromotion(saved, 90_000)).toBeNull();
    expect(getActivePromotions([saved], new Date(2026, 9, 1))).toHaveLength(0);
  });
});

describe('promotionStatus', () => {
  it('ativa, inativa e vencida', () => {
    expect(promotionStatus(promo(), NOW)).toBe('active');
    expect(promotionStatus(promo({ isActive: false }), NOW)).toBe('inactive');
    expect(promotionStatus(promo({ validUntil: '2026-09-01' }), NOW)).toBe('expired');
    expect(promotionStatus(promo({ isActive: false, validUntil: '2026-09-01' }), NOW)).toBe('inactive');
  });
});

describe('descrições', () => {
  it('valor: percentual e fixo', () => {
    expect(describePromotionValue({ type: 'percentage', value: 10 })).toBe('10% de desconto');
    expect(describePromotionValue({ type: 'percentage', value: 12.5 })).toBe('12,5% de desconto');
    expect(describePromotionValue({ type: 'fixed', value: 200 })).toMatch(/R\$\s?200,00 de desconto/);
  });

  it('condições em uma linha, na ordem mínimo → validade', () => {
    expect(describePromotionTerms({})).toBe('');
    expect(describePromotionTerms({ validUntil: '2026-09-30' })).toBe('até 30/09/2026');
    expect(describePromotionTerms({ minOrderValue: 1500, validUntil: '2026-09-30' })).toMatch(/pedido mínimo R\$\s?1\.500,00 · até 30\/09\/2026/);
  });
});

describe('operações na lista', () => {
  const a = promo({ id: 'a' });
  const b = promo({ id: 'b', name: 'Outra' });

  it('upsert: troca a existente ou acrescenta a nova, sem mutar', () => {
    const list = [a, b];
    expect(upsertPromotion(list, promo({ id: 'a', value: 20 })).map((p) => p.value)).toEqual([20, 10]);
    expect(upsertPromotion(list, promo({ id: 'c' })).map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(list).toHaveLength(2);
    expect(list[0].value).toBe(10);
  });

  it('remove por id', () => {
    expect(removePromotion([a, b], 'a').map((p) => p.id)).toEqual(['b']);
    expect(removePromotion([a, b], 'zzz')).toHaveLength(2);
  });

  it('ativar/desativar só mexe na promoção escolhida', () => {
    const result = setPromotionActive([a, b], 'b', false);
    expect(result.map((p) => p.isActive)).toEqual([true, false]);
  });
});
