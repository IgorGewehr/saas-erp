/**
 * Contrato do Super Consultor (financial-v2) — trava as invariantes do schema
 * (lib/contracts/api/financial/consultor.ts): denylist de chaves de PII nos
 * facts, limite de 12 chaves, formato de período, e a chave de cache/
 * idempotência determinística (R3).
 */

import { describe, it, expect } from 'vitest';
import {
  ConsultorFactsSchema,
  FinancialConsultorRequestSchema,
  buildFinancialInsightCacheKey,
} from '@/lib/contracts/api/financial/consultor';

describe('ConsultorFactsSchema', () => {
  it('aceita facts numéricos/textuais agregados', () => {
    const result = ConsultorFactsSchema.safeParse({ total: 'R$ 1.200', count: 3 });
    expect(result.success).toBe(true);
  });

  it('rejeita facts vazio', () => {
    expect(ConsultorFactsSchema.safeParse({}).success).toBe(false);
  });

  it('rejeita mais de 12 chaves', () => {
    const facts = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, i]));
    expect(ConsultorFactsSchema.safeParse(facts).success).toBe(false);
  });

  it.each(['clientName', 'clientId', 'email', 'cpf', 'cnpj'])(
    'rejeita chave identificável "%s"',
    (key) => {
      const result = ConsultorFactsSchema.safeParse({ [key]: 'algo', total: 10 });
      expect(result.success).toBe(false);
    },
  );
});

describe('FinancialConsultorRequestSchema', () => {
  const base = {
    tab: 'visao-geral' as const,
    period: '2026-07',
    ruleId: 'vencimentos-proximos',
    facts: { total: 'R$ 500', count: 2 },
    templateFallback: 'Você tem R$ 500 a vencer em 2 lançamentos.',
  };

  it('aceita um request bem formado', () => {
    expect(FinancialConsultorRequestSchema.safeParse(base).success).toBe(true);
  });

  it('rejeita período fora do formato YYYY-MM', () => {
    expect(FinancialConsultorRequestSchema.safeParse({ ...base, period: '07/2026' }).success).toBe(false);
  });

  it('rejeita aba fora do enum (ex: relatorios, que não tem consultor)', () => {
    expect(FinancialConsultorRequestSchema.safeParse({ ...base, tab: 'relatorios' }).success).toBe(false);
  });

  it('businessId não faz parte do schema — vem do token verificado, nunca do body', () => {
    const withBusinessId = { ...base, businessId: 'outro-tenant' };
    const parsed = FinancialConsultorRequestSchema.parse(withBusinessId);
    expect(parsed).not.toHaveProperty('businessId');
  });
});

describe('buildFinancialInsightCacheKey', () => {
  it('é determinística para o mesmo input (idempotência R3)', () => {
    const params = { businessId: 'biz_1', tab: 'bancario' as const, period: '2026-07', ruleId: 'saldo-total', factsHash8: 'abc12345' };
    expect(buildFinancialInsightCacheKey(params)).toBe(buildFinancialInsightCacheKey(params));
    expect(buildFinancialInsightCacheKey(params)).toBe('biz_1_bancario_2026-07_saldo-total_abc12345');
  });

  it('muda se o tenant muda — nunca vaza cache entre businessId (R1)', () => {
    const a = buildFinancialInsightCacheKey({ businessId: 'biz_1', tab: 'bancario', period: '2026-07', ruleId: 'r', factsHash8: 'h' });
    const b = buildFinancialInsightCacheKey({ businessId: 'biz_2', tab: 'bancario', period: '2026-07', ruleId: 'r', factsHash8: 'h' });
    expect(a).not.toBe(b);
  });
});
