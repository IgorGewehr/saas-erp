'use client';

/**
 * CurrencyContext — provider de moeda de exibição do Financeiro.
 *
 * Por que existe:
 *  - Todos os valores são ARMAZENADOS em BRL (transactions.amount).
 *  - O operador pode querer ver os números em USD para reportar a investidor,
 *    comparar com benchmarks internacionais, etc.
 *
 * Como funciona:
 *  - Toggle BRL/USD persiste preferência em localStorage (per-device).
 *  - Cotação USD/BRL é buscada da awesomeapi e cacheada 1h.
 *  - Hook `useCurrencyFormat()` retorna função compatível com a antiga
 *    `formatCurrency(value)` — basta declarar dentro do componente para
 *    sombrear o import e converter automaticamente.
 *
 * Escopo: usado apenas dentro do FinancialModule. Outros módulos seguem
 * em BRL via `formatCurrency` direto de `@/lib/utils/format`.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchUsdBrlRate, readCachedRate } from '@/lib/utils/exchangeRate';
import { formatCurrency as formatBrlBase } from '@/lib/utils/format';

export type DisplayCurrency = 'BRL' | 'USD';

interface CurrencyCtx {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
  /** BRL por 1 USD. 0 quando ainda não consultado. */
  rate: number;
  rateUpdatedAt: number | null;
  rateLoading: boolean;
  rateError: string | null;
  refreshRate: () => Promise<void>;
  /** Formata um valor em BRL convertendo se necessário pra moeda atual. */
  format: (brlValue: number | null | undefined) => string;
}

const CurrencyContext = createContext<CurrencyCtx | null>(null);
const PREF_KEY = 'aevo:financial:currency';

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>('BRL');
  const [rate, setRate] = useState<number>(0);
  const [rateUpdatedAt, setRateUpdatedAt] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);

  // Carrega preferência + cotação cacheada no mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PREF_KEY);
      if (stored === 'BRL' || stored === 'USD') setCurrencyState(stored);
    } catch { /* ignore */ }
    const cached = readCachedRate();
    if (cached) {
      setRate(cached.rate);
      setRateUpdatedAt(cached.fetchedAt);
    }
  }, []);

  const setCurrency = useCallback((c: DisplayCurrency) => {
    setCurrencyState(c);
    try { localStorage.setItem(PREF_KEY, c); } catch { /* ignore */ }
  }, []);

  const refreshRate = useCallback(async () => {
    setRateLoading(true);
    setRateError(null);
    try {
      const result = await fetchUsdBrlRate(true);
      setRate(result.rate);
      setRateUpdatedAt(result.fetchedAt);
    } catch (err) {
      setRateError(err instanceof Error ? err.message : 'Erro ao buscar cotação');
    } finally {
      setRateLoading(false);
    }
  }, []);

  // Auto-fetch ao trocar pra USD se não temos cotação em cache
  useEffect(() => {
    if (currency === 'USD' && rate === 0 && !rateLoading) {
      void refreshRate();
    }
  }, [currency, rate, rateLoading, refreshRate]);

  const format = useCallback((brlValue: number | null | undefined): string => {
    const v = typeof brlValue === 'number' && Number.isFinite(brlValue) ? brlValue : 0;
    if (currency === 'BRL' || rate <= 0) {
      return formatBrlBase(v);
    }
    return formatUsd(v / rate);
  }, [currency, rate]);

  return (
    <CurrencyContext.Provider value={{
      currency, setCurrency,
      rate, rateUpdatedAt, rateLoading, rateError, refreshRate,
      format,
    }}>
      {children}
    </CurrencyContext.Provider>
  );
}

/**
 * Hook que retorna função compatível com a antiga `formatCurrency`.
 * Fora do provider, devolve formatador BRL puro (fallback seguro).
 */
export function useCurrencyFormat(): (v: number | null | undefined) => string {
  const ctx = useContext(CurrencyContext);
  if (!ctx) return (v) => formatBrlBase(typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return ctx.format;
}

export function useCurrency(): CurrencyCtx {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used inside CurrencyProvider');
  return ctx;
}
