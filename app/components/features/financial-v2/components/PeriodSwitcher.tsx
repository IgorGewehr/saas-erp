'use client';

/**
 * PeriodSwitcher — o pill `.period` do mockup, com setas ‹ › ligadas ao
 * PeriodContext global (a única "configuração" da Visão Geral, plano §4).
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePeriod } from '../state/PeriodContext';

export function PeriodSwitcher() {
  const { label, goToPreviousMonth, goToNextMonth } = usePeriod();

  return (
    <div className="inline-flex items-center gap-1 rounded-[10px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 pl-1 pr-2 py-1">
      <button
        onClick={goToPreviousMonth}
        aria-label="Mês anterior"
        className="w-7 h-7 rounded-lg grid place-items-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-200 px-1 min-w-[92px] text-center">
        {label}
      </span>
      <button
        onClick={goToNextMonth}
        aria-label="Próximo mês"
        className="w-7 h-7 rounded-lg grid place-items-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
