'use client';

/**
 * HeroDecomposition — bloco ① do santo-graal: "Você pode tirar até", com a
 * decomposição clicável (`.hero-num`/`.decomp`/`.drow`/`.drow.total` do
 * mockup scratchpad/mockups/visao-geral.html). Cada linha aponta pra aba
 * dona do número — o componente nunca decide o destino, só emite o clique.
 */

import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';

export interface DecompositionRow {
  key: string;
  label: string;
  sublabel?: string;
  /** Assinado — negativo renderiza com "−" e cor crítica. */
  value: number;
  navLabel?: string;
  onClick?: () => void;
}

interface HeroDecompositionProps {
  total: number;
  rows: DecompositionRow[];
  className?: string;
}

export function HeroDecomposition({ total, rows, className }: HeroDecompositionProps) {
  const positive = total >= 0;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 pb-4',
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(120% 90% at 100% 0%, hsl(var(--fin-primary) / 0.09), transparent 60%)' }}
      />
      <div className="relative">
        <div className="fin-eyebrow text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">
          Você pode tirar até
        </div>
        <div className="fin-num mt-2 mb-3.5 flex items-baseline gap-2.5 text-[38px] sm:text-[44px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
          {formatCurrency(total)}
          <span className={cn('text-lg font-bold', positive ? 'text-[hsl(var(--fin-pos))]' : 'text-[hsl(var(--fin-crit))]')}>
            {positive ? '✓' : '!'}
          </span>
        </div>

        <div className="border-t border-dashed border-gray-200 dark:border-gray-800 pt-1">
          {rows.map(row => {
            const clickable = !!row.onClick;
            const Wrapper = clickable ? 'button' : 'div';
            return (
              <Wrapper
                key={row.key}
                onClick={row.onClick}
                className={cn(
                  'group grid grid-cols-[1fr_auto_auto] items-center gap-x-3.5 gap-y-1 w-full text-left rounded-xl px-2.5 py-2.5',
                  clickable &&
                    'cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--fin-primary))] focus-visible:outline-offset-2',
                )}
              >
                <span className="text-[13.5px] font-medium text-gray-800 dark:text-gray-200">
                  {row.label}
                  {row.sublabel && <span className="ml-1 font-normal text-gray-500 dark:text-gray-400 text-xs">{row.sublabel}</span>}
                </span>
                <span className={cn('fin-num text-[15px] font-bold', row.value >= 0 ? 'text-[hsl(var(--fin-pos))]' : 'text-[hsl(var(--fin-crit))]')}>
                  {row.value >= 0 ? '' : '−'}
                  {formatCurrency(Math.abs(row.value))}
                </span>
                <span className="text-[11.5px] font-semibold text-[hsl(var(--fin-primary))] opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
                  {clickable ? row.navLabel : ''}
                </span>
              </Wrapper>
            );
          })}

          <div
            className={cn(
              'mt-0.5 grid grid-cols-[1fr_auto_auto] items-center gap-x-3.5 rounded-xl px-2.5 pt-3.5 pb-1.5 border-t border-gray-200 dark:border-gray-800',
              positive ? 'bg-[hsl(var(--fin-pos-soft)/0.5)]' : 'bg-[hsl(var(--fin-crit-soft)/0.5)]',
            )}
          >
            <span className="text-sm font-bold text-gray-900 dark:text-gray-50">Livre de verdade</span>
            <span className={cn('fin-num text-[19px] font-bold', positive ? 'text-[hsl(var(--fin-pos))]' : 'text-[hsl(var(--fin-crit))]')}>
              {formatCurrency(total)}
            </span>
            <span className={cn('text-[15px] font-bold', positive ? 'text-[hsl(var(--fin-pos))]' : 'text-[hsl(var(--fin-crit))]')}>
              {positive ? '✓' : '!'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
