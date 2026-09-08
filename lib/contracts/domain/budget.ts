/**
 * lib/contracts/domain/budget.ts
 *
 * budgets/{id} — orçamento mensal por categoria financeira (M03.7). Meta
 * declarada pelo usuário, comparada contra o realizado calculado a partir de
 * `transactions` no mesmo regime de competência do DRE (ver
 * app/components/features/financial-v2/read-models/dre-mensal.ts — reusado,
 * não duplicado). `category`/`type` usam a MESMA taxonomia que
 * `FinancialModule.tsx` já usa pros lançamentos (INCOME_CATEGORIES/
 * EXPENSE_CATEGORIES) — sem lista paralela.
 *
 * Um doc por (businessId, year, month, category, type): `budgetDocId()`
 * deriva um ID determinístico a partir dessas 5 chaves, então "criar" e
 * "editar a meta" são o MESMO `setDoc` (upsert) — sem query de unicidade,
 * sem duplicata possível por definição de chave.
 */

import { z } from 'zod';

const BudgetBaseSchema = z.object({
  businessId: z.string().min(1, 'businessId obrigatório (multi-tenant)'),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  category: z.string().min(1).max(80),
  type: z.enum(['receita', 'despesa']),
  amount: z.number().nonnegative(),
});

export const BudgetSchema = BudgetBaseSchema.extend({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const BudgetCreateInputSchema = BudgetBaseSchema;
export type BudgetCreateInput = z.infer<typeof BudgetCreateInputSchema>;

export const BudgetUpdateInputSchema = z.object({ amount: z.number().nonnegative() });
export type BudgetUpdateInput = z.infer<typeof BudgetUpdateInputSchema>;

function slugifyCategory(category: string): string {
  return category.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sem-categoria';
}

/** ID determinístico — mesma (businessId,year,month,category,type) sempre mapeia pro mesmo doc. */
export function budgetDocId(
  businessId: string,
  year: number,
  month: number,
  category: string,
  type: 'receita' | 'despesa',
): string {
  return `${businessId}_${year}${String(month).padStart(2, '0')}_${type}_${slugifyCategory(category)}`;
}
