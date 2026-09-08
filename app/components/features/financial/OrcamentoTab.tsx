'use client';

/**
 * OrcamentoTab — M03.7: orçamento mensal por categoria (meta declarada vs.
 * realizado). Realizado usa a MESMA regra de competência do DRE (dueDate,
 * não-cancelada) — sem taxonomia paralela: `categories` vem das constantes
 * INCOME_CATEGORIES/EXPENSE_CATEGORIES que `FinancialModule.tsx` já usa nos
 * lançamentos. Contrato: `lib/contracts/domain/budget.ts`.
 */

import { useMemo, useState } from 'react';
import { collection, query, where, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { useQuery as useTanstackQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/config/firebase';
import { formatCurrency } from '@/lib/utils/format';
import { maskMoney, unmaskMoney } from '@/lib/utils/masks';
import { BudgetCreateInputSchema, budgetDocId, type Budget } from '@/lib/contracts/domain/budget';
import { monthKeyOf, shiftMonthKey, shortMonthLabel } from '../financial-v2/read-models/date-utils';
import type { Transaction } from '@/lib/types';
import { toast } from 'react-toastify';
import { ChevronLeft, ChevronRight, Wallet, Trash2, Check } from 'lucide-react';

interface Props {
  businessId: string;
  transactions: Transaction[];
  incomeCategories: string[];
  expenseCategories: string[];
}

function currentPeriod(): string {
  return monthKeyOf(new Date().toISOString().slice(0, 10)) as string;
}

function periodLabel(period: string): string {
  return shortMonthLabel(period) + '/' + period.slice(0, 4).slice(2);
}

/** Realizado por categoria no período, regime competência — mesma regra do DRE (dueDate, não-cancelada). */
export function realizedByCategory(transactions: Transaction[], period: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of transactions) {
    if (t.status === 'cancelado' || monthKeyOf(t.dueDate) !== period) continue;
    const key = `${t.type}:${t.category || 'Outros'}`;
    map.set(key, (map.get(key) ?? 0) + t.amount);
  }
  return map;
}

export default function OrcamentoTab({ businessId, transactions, incomeCategories, expenseCategories }: Props) {
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [type, setType] = useState<'receita' | 'despesa'>('despesa');
  const queryClient = useQueryClient();

  const { data: budgets = [] } = useTanstackQuery({
    queryKey: ['budgets', businessId],
    queryFn: async () => {
      const q = query(collection(db, 'budgets'), where('businessId', '==', businessId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Budget));
    },
    enabled: !!businessId,
    staleTime: 60 * 1000,
  });

  const realized = useMemo(() => realizedByCategory(transactions, period), [transactions, period]);
  const [year, month] = period.split('-').map(Number);

  const budgetByCategory = useMemo(() => {
    const map = new Map<string, Budget>();
    for (const b of budgets) {
      if (b.year === year && b.month === month) map.set(`${b.type}:${b.category}`, b);
    }
    return map;
  }, [budgets, year, month]);

  const categories = type === 'receita' ? incomeCategories : expenseCategories;

  const totals = useMemo(() => {
    let planned = 0;
    let actual = 0;
    for (const cat of categories) {
      planned += budgetByCategory.get(`${type}:${cat}`)?.amount ?? 0;
      actual += realized.get(`${type}:${cat}`) ?? 0;
    }
    return { planned, actual };
  }, [categories, budgetByCategory, realized, type]);

  const [draft, setDraft] = useState<Record<string, string>>({});

  async function saveBudget(category: string) {
    const key = `${type}:${category}`;
    const raw = draft[key];
    if (raw === undefined) return;
    const amount = unmaskMoney(raw);
    const parsed = BudgetCreateInputSchema.safeParse({ businessId, year, month, category, type, amount });
    if (!parsed.success) {
      toast.error('Valor de orçamento inválido.');
      return;
    }
    const id = budgetDocId(businessId, year, month, category, type);
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'budgets', id), {
        ...parsed.data,
        id,
        createdAt: budgetByCategory.get(key)?.createdAt ?? now,
        updatedAt: now,
      });
      setDraft((d) => { const next = { ...d }; delete next[key]; return next; });
      queryClient.invalidateQueries({ queryKey: ['budgets', businessId] });
    } catch (err) {
      console.error('[Orcamento] Erro ao salvar meta:', err);
      toast.error('Erro ao salvar orçamento.');
    }
  }

  async function clearBudget(category: string) {
    const key = `${type}:${category}`;
    const existing = budgetByCategory.get(key);
    if (!existing) return;
    try {
      await deleteDoc(doc(db, 'budgets', existing.id));
      queryClient.invalidateQueries({ queryKey: ['budgets', businessId] });
    } catch (err) {
      console.error('[Orcamento] Erro ao remover meta:', err);
      toast.error('Erro ao remover orçamento.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-red-600 dark:text-red-400" />
          <h3 className="font-display font-bold text-gray-900 dark:text-gray-100 text-sm">Orçamento mensal</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPeriod((p) => shiftMonthKey(p, -1))}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 min-w-[64px] text-center">
            {periodLabel(period)}
          </span>
          <button onClick={() => setPeriod((p) => shiftMonthKey(p, 1))}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden ml-2">
            {(['despesa', 'receita'] as const).map((tp) => (
              <button key={tp} onClick={() => setType(tp)}
                className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  type === tp ? 'bg-red-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}>
                {tp === 'despesa' ? 'Despesas' : 'Receitas'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-white/[0.03] border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 text-left text-[11px] uppercase tracking-wider text-gray-400">
              <th className="px-4 py-2.5 font-semibold">Categoria</th>
              <th className="px-4 py-2.5 font-semibold text-right">Orçado</th>
              <th className="px-4 py-2.5 font-semibold text-right">Realizado</th>
              <th className="px-4 py-2.5 font-semibold text-right">%</th>
              <th className="px-4 py-2.5 font-semibold w-10" />
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const key = `${type}:${cat}`;
              const budget = budgetByCategory.get(key);
              const actual = realized.get(key) ?? 0;
              const planned = budget?.amount ?? 0;
              const pct = planned > 0 ? (actual / planned) * 100 : actual > 0 ? Infinity : 0;
              const overBudget = type === 'despesa' && planned > 0 && actual > planned;
              const draftValue = draft[key];
              return (
                <tr key={cat} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{cat}</td>
                  <td className="px-4 py-2 text-right">
                    <input
                      value={draftValue ?? (planned > 0 ? maskMoney(planned) : '')}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: maskMoney(e.target.value) }))}
                      onBlur={() => saveBudget(cat)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      placeholder="0,00"
                      className="w-24 text-right bg-transparent border-b border-dashed border-gray-200 dark:border-gray-700 focus:outline-none focus:border-red-400 text-gray-900 dark:text-gray-100 font-mono text-[13px]"
                    />
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-[13px] text-gray-900 dark:text-gray-100">
                    {formatCurrency(actual)}
                  </td>
                  <td className={`px-4 py-2 text-right text-[12px] font-semibold ${overBudget ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                    {planned > 0 ? `${Math.min(999, pct).toFixed(0)}%` : '—'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {budget && (
                      <button onClick={() => clearBudget(cat)} title="Remover meta"
                        className="text-gray-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 dark:bg-gray-800/50 font-bold text-[13px]">
              <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">Total</td>
              <td className="px-4 py-2.5 text-right font-mono text-gray-900 dark:text-gray-100">{formatCurrency(totals.planned)}</td>
              <td className="px-4 py-2.5 text-right font-mono text-gray-900 dark:text-gray-100">{formatCurrency(totals.actual)}</td>
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
        <Check className="w-3 h-3" /> Meta salva automaticamente ao sair do campo. Realizado = lançamentos não cancelados com vencimento no mês (mesma regra do DRE).
      </p>
    </div>
  );
}
