'use client';

/**
 * StatTile — o bloco `.kpi` do mockup. `hero` ganha sparkline + gradiente
 * radial (o primeiro tile da fileira, sempre); os demais são "de apoio".
 * Delta é semântico (up=verde, down=vermelho) — nunca cor fixa por sinal
 * matemático (um "churn caiu" é bom mesmo sendo delta negativo, então quem
 * chama decide `direction`).
 */

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Sparkline } from './charts/Sparkline';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

export interface StatTileDelta {
  /** 'neutral' = informativo, sem juízo de valor (cinza, sem seta) — ex: "maior: Folha · 30/07". */
  direction: 'up' | 'down' | 'neutral';
  text: string;
}

export interface StatTileProps {
  label: ReactNode;
  value: string;
  hero?: boolean;
  delta?: StatTileDelta;
  footnote?: string;
  sparkValues?: number[];
  className?: string;
  onClick?: () => void;
}

export function StatTile({ label, value, hero, delta, footnote, sparkValues, className, onClick }: StatTileProps) {
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        'relative overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800',
        'bg-white dark:bg-gray-900 p-4 text-left w-full',
        onClick && 'cursor-pointer transition-colors hover:border-gray-300 dark:hover:border-gray-700',
        className,
      )}
    >
      {hero && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(120% 90% at 100% 0%, hsl(var(--fin-primary) / 0.10), transparent 60%)' }}
        />
      )}
      <div className="relative">
        <div className="fin-eyebrow text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">
          {label}
        </div>
        <div className="fin-num mt-2.5 text-[27px] font-bold tracking-tight text-gray-900 dark:text-gray-50">
          {value}
        </div>
        {delta && (
          <div
            className={cn(
              'mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold',
              delta.direction === 'up' && 'text-[hsl(var(--fin-pos))]',
              delta.direction === 'down' && 'text-[hsl(var(--fin-crit))]',
              delta.direction === 'neutral' && 'text-gray-500 dark:text-gray-400',
            )}
          >
            {delta.direction === 'up' && <ArrowUpRight className="w-3.5 h-3.5" />}
            {delta.direction === 'down' && <ArrowDownRight className="w-3.5 h-3.5" />}
            {delta.text}
          </div>
        )}
        {footnote && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{footnote}</div>}
        {hero && sparkValues && sparkValues.length > 1 && (
          <div className="mt-2.5 h-[34px] w-full">
            <Sparkline values={sparkValues} />
          </div>
        )}
      </div>
    </Wrapper>
  );
}

export interface StatTileGroupProps {
  children: ReactNode;
  className?: string;
}

/** Grid de 2-4 colunas (o `.kpis` do mockup) — anima entrada em stagger leve. */
export function StatTileGroup({ children, className }: StatTileGroupProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn('grid grid-cols-2 lg:grid-cols-4 gap-3.5', className)}
    >
      {children}
    </motion.section>
  );
}
