'use client';

import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrency, type DisplayCurrency } from './CurrencyContext';

/**
 * Toggle BRL/USD para exibição de valores no Financeiro.
 *
 * Renderiza:
 *  - Pílula segmentada R$ / US$ (clicável)
 *  - Quando em USD: cotação atual + botão de refresh + idade do cache
 *  - Indicador de erro discreto se a última busca falhou
 */
export default function CurrencyToggle() {
  const { currency, setCurrency, rate, rateUpdatedAt, rateLoading, rateError, refreshRate } = useCurrency();

  const ageMin = rateUpdatedAt
    ? Math.max(0, Math.floor((Date.now() - rateUpdatedAt) / 60_000))
    : null;

  const options: { value: DisplayCurrency; label: string; aria: string }[] = [
    { value: 'BRL', label: 'R$', aria: 'Real (BRL)' },
    { value: 'USD', label: 'US$', aria: 'Dólar (USD)' },
  ];

  return (
    <div className="flex items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Moeda de exibição"
        className="inline-flex p-0.5 bg-gray-100 dark:bg-white/[0.06] rounded-lg border border-gray-200/60 dark:border-white/[0.08]"
      >
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={currency === opt.value}
            aria-label={opt.aria}
            onClick={() => setCurrency(opt.value)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-bold transition-colors min-w-[36px]',
              currency === opt.value
                ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {currency === 'USD' && (
        <button
          type="button"
          onClick={() => void refreshRate()}
          disabled={rateLoading}
          title={
            rate > 0
              ? `1 USD = R$ ${rate.toFixed(4)}${ageMin !== null ? ` · atualizado há ${ageMin}min` : ''}\nClique para atualizar`
              : 'Buscar cotação atual'
          }
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/[0.04] disabled:opacity-50 transition-colors"
        >
          {rateLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : rateError ? (
            <AlertTriangle className="w-3 h-3 text-amber-500" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {rate > 0 ? (
            <span className="tabular-nums">R$ {rate.toFixed(2)}</span>
          ) : (
            <span>Cotação</span>
          )}
        </button>
      )}
    </div>
  );
}
