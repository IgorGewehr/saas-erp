'use client';

/**
 * BarsIndex — o índice de barras horizontais clicáveis do mockup (`.bars.sel`
 * / `.bar-click` / `.track` / `.fill`): nome + dot categórico, valor, barra de
 * proporção, %. Clique dispara o drill (quem decide o que mostrar do lado é o
 * DrillPair da aba, este componente só lista e emite o id selecionado).
 */

import { cn } from '@/lib/utils';
import { subscriptionDotClass, subscriptionFillClass } from './subscriptionPalette';

export interface BarsIndexItem {
  id: string;
  label: string;
  value: number;
  pct: number;
  colorRank: number;
  /** Selo opcional ao lado do nome (ex: "▲ 42%" quando a categoria destoa da média). */
  badge?: string;
}

interface BarsIndexProps {
  items: BarsIndexItem[];
  formatValue: (n: number) => string;
  onSelect: (id: string) => void;
  emptyMessage?: string;
}

export function BarsIndex({ items, formatValue, onSelect, emptyMessage }: BarsIndexProps) {
  if (items.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
        {emptyMessage ?? 'Nada para mostrar ainda.'}
      </div>
    );
  }

  return (
    <div className="px-2 pb-2.5 flex flex-col gap-0.5">
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-1 items-center w-full text-left px-2.5 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--fin-primary))] focus-visible:outline-offset-2"
        >
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-gray-800 dark:text-gray-200 min-w-0 truncate">
            <span className={cn('w-2 h-2 rounded-[3px] flex-none', subscriptionDotClass(item.colorRank))} />
            <span className="truncate">{item.label}</span>
            {item.badge && (
              <span className="flex-none rounded-md bg-[hsl(var(--fin-warn-soft))] px-1.5 py-0.5 text-[10px] font-bold text-[hsl(var(--fin-warn))]">
                {item.badge}
              </span>
            )}
          </span>
          <span className="fin-num text-[12.5px] text-gray-500 dark:text-gray-400">{formatValue(item.value)}</span>
          <div className="col-span-2 h-2 rounded-md bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className={cn('h-full rounded-md', subscriptionFillClass(item.colorRank))}
              style={{ width: `${Math.max(0, Math.min(100, item.pct))}%` }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}
