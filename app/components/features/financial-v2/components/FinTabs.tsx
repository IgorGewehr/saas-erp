'use client';

/**
 * FinTabs — as 6 abas canônicas (espelha `.tabs`/`.tab` do mockup). Fluxo de
 * Caixa é condicional (só aparece se existe BankAccount tipo 'caixa' — decisão
 * do shell, este componente só recebe a lista já filtrada).
 */

import { cn } from '@/lib/utils';

export const FIN2_TAB_IDS = [
  'visao-geral',
  'entradas-saidas',
  'recorrentes',
  'bancario',
  'fluxo-caixa',
  'relatorios',
] as const;
export type Fin2TabId = (typeof FIN2_TAB_IDS)[number];

export const FIN2_TAB_LABELS: Record<Fin2TabId, string> = {
  'visao-geral': 'Visão geral',
  'entradas-saidas': 'Entradas & saídas',
  'recorrentes': 'Recorrentes',
  'bancario': 'Bancário',
  'fluxo-caixa': 'Fluxo de caixa',
  'relatorios': 'Relatórios',
};

interface FinTabsProps {
  active: Fin2TabId;
  onChange: (tab: Fin2TabId) => void;
  /** Abas visíveis, na ordem canônica — já filtradas pelo shell (ex: sem 'fluxo-caixa' se não há conta caixa). */
  visibleTabs?: readonly Fin2TabId[];
}

export function FinTabs({ active, onChange, visibleTabs = FIN2_TAB_IDS }: FinTabsProps) {
  return (
    <nav aria-label="Seções do Financeiro" className="flex gap-0.5 border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
      {visibleTabs.map(tabId => (
        <button
          key={tabId}
          onClick={() => onChange(tabId)}
          className={cn(
            'px-3.5 py-2.5 text-[13.5px] font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors',
            active === tabId
              ? 'text-[hsl(var(--fin-primary))] border-[hsl(var(--fin-primary))]'
              : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-800 dark:hover:text-gray-200',
          )}
        >
          {FIN2_TAB_LABELS[tabId]}
        </button>
      ))}
    </nav>
  );
}
