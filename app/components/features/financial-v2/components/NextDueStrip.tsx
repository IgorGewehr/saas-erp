'use client';

/**
 * NextDueStrip — bloco ④ do santo-graal: "Próximos 7 dias" (`.vencs`/`.venc`
 * do mockup). Cartões clicáveis por vencimento, cor semântica (entrada=pos,
 * saída=crit) — clique aponta pra Entradas & Saídas (a aba dona da parcela).
 */

import { ArrowUp, ArrowDown } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type { VencimentoProximo } from '../read-models/vencimentos-proximos';

interface NextDueStripProps {
  items: VencimentoProximo[];
  onSelect?: (item: VencimentoProximo) => void;
}

export function NextDueStrip({ items, onSelect }: NextDueStripProps) {
  if (items.length === 0) {
    return (
      <div className="px-4.5 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
        Nenhum vencimento nos próximos 7 dias.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2.5 px-4.5 pb-4.5 pt-2">
      {items.map(item => (
        <button
          key={`${item.id}-${item.date}`}
          onClick={() => onSelect?.(item)}
          className={cn(
            'flex-1 min-w-[150px] text-left rounded-xl px-3.5 py-3 bg-gray-50 dark:bg-gray-800/60 border-l-[3px]',
            'transition-transform hover:-translate-y-0.5 hover:shadow-lg',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--fin-primary))] focus-visible:outline-offset-2',
            item.tone === 'pos' ? 'border-l-[hsl(var(--fin-pos))]' : 'border-l-[hsl(var(--fin-crit))]',
          )}
        >
          <div className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{item.dayLabel}</div>
          <div
            className={cn(
              'fin-num mt-1.5 mb-0.5 flex items-center gap-1 text-[16px] sm:text-[17px] font-bold tracking-tight',
              item.tone === 'pos' ? 'text-[hsl(var(--fin-pos))]' : 'text-[hsl(var(--fin-crit))]',
            )}
          >
            {item.tone === 'pos' ? <ArrowUp className="w-3.5 h-3.5 flex-none" /> : <ArrowDown className="w-3.5 h-3.5 flex-none" />}
            {item.tone === 'pos' ? '+' : '−'}
            {formatCurrency(Math.abs(item.amountSigned))}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.label}</div>
        </button>
      ))}
    </div>
  );
}
