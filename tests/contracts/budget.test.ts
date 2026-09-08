import { describe, it, expect } from 'vitest';
import { BudgetCreateInputSchema, BudgetSchema, budgetDocId } from '@/lib/contracts/domain/budget';

describe('BudgetCreateInputSchema', () => {
  const base = {
    businessId: 'biz1',
    year: 2026,
    month: 9,
    category: 'Marketing',
    type: 'despesa' as const,
    amount: 1500,
  };

  it('aceita um input válido', () => {
    expect(BudgetCreateInputSchema.safeParse(base).success).toBe(true);
  });

  it('rejeita businessId vazio', () => {
    expect(BudgetCreateInputSchema.safeParse({ ...base, businessId: '' }).success).toBe(false);
  });

  it('rejeita mês fora de 1-12', () => {
    expect(BudgetCreateInputSchema.safeParse({ ...base, month: 0 }).success).toBe(false);
    expect(BudgetCreateInputSchema.safeParse({ ...base, month: 13 }).success).toBe(false);
  });

  it('rejeita valor negativo', () => {
    expect(BudgetCreateInputSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
  });

  it('aceita valor zero (meta "sem orçamento definido" removível)', () => {
    expect(BudgetCreateInputSchema.safeParse({ ...base, amount: 0 }).success).toBe(true);
  });

  it('rejeita type fora do enum', () => {
    expect(BudgetCreateInputSchema.safeParse({ ...base, type: 'transferencia' }).success).toBe(false);
  });
});

describe('BudgetSchema (persisted)', () => {
  it('exige id/createdAt/updatedAt além dos campos base', () => {
    const persisted = {
      id: 'biz1_202609_despesa_marketing',
      businessId: 'biz1',
      year: 2026,
      month: 9,
      category: 'Marketing',
      type: 'despesa' as const,
      amount: 1500,
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    };
    expect(BudgetSchema.safeParse(persisted).success).toBe(true);
  });
});

describe('budgetDocId', () => {
  it('é determinístico para a mesma chave composta', () => {
    const a = budgetDocId('biz1', 2026, 9, 'Marketing', 'despesa');
    const b = budgetDocId('biz1', 2026, 9, 'Marketing', 'despesa');
    expect(a).toBe(b);
  });

  it('normaliza categoria com espaço/acento/caixa pro mesmo slug', () => {
    const a = budgetDocId('biz1', 2026, 9, 'Taxas de pagamento', 'despesa');
    const b = budgetDocId('biz1', 2026, 9, '  TAXAS DE PAGAMENTO  ', 'despesa');
    expect(a).toBe(b);
  });

  it('categorias diferentes geram ids diferentes', () => {
    const a = budgetDocId('biz1', 2026, 9, 'Marketing', 'despesa');
    const b = budgetDocId('biz1', 2026, 9, 'Software', 'despesa');
    expect(a).not.toBe(b);
  });

  it('meses diferentes geram ids diferentes (zero-padded)', () => {
    const a = budgetDocId('biz1', 2026, 1, 'Marketing', 'despesa');
    const b = budgetDocId('biz1', 2026, 10, 'Marketing', 'despesa');
    expect(a).not.toBe(b);
    expect(a).not.toContain(b.slice(-20)); // não colide por concatenação sem padding
  });

  it('type diferente (mesma categoria) gera id diferente', () => {
    const a = budgetDocId('biz1', 2026, 9, 'Outros', 'despesa');
    const b = budgetDocId('biz1', 2026, 9, 'Outros', 'receita');
    expect(a).not.toBe(b);
  });

  it('tenants diferentes nunca colidem', () => {
    const a = budgetDocId('biz1', 2026, 9, 'Marketing', 'despesa');
    const b = budgetDocId('biz2', 2026, 9, 'Marketing', 'despesa');
    expect(a).not.toBe(b);
  });
});
