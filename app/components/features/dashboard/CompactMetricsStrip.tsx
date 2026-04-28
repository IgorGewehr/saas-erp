'use client';

/**
 * Compact horizontal metrics strip for the dashboard.
 *
 * Replaces the verbose Revenue Today + Monthly Revenue cards (which had
 * big numbers, progress bars and redundant labels) with a slim strip of
 * 4-6 micro KPIs. Saves ~250px of vertical space while surfacing MORE
 * metrics at a glance.
 *
 * Each cell shows: icon · label · value · optional delta %.
 * Hover lifts subtly. Click navigates to the relevant module when
 * `onClick` is provided.
 */

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Metric {
  key: string;
  icon: LucideIcon;
  label: string;
  value: string;
  /** Secondary detail under value (e.g., "3 vendas"). */
  subtext?: string;
  /** Optional +/- delta percent. Renders trend chip. */
  delta?: number;
  /** Tint the icon + accent. */
  tint?: 'emerald' | 'blue' | 'red' | 'amber' | 'violet' | 'orange' | 'slate';
  loading?: boolean;
  onClick?: () => void;
}

const TINT_CLASSES: Record<NonNullable<Metric['tint']>, { bg: string; text: string }> = {
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
  blue:    { bg: 'bg-blue-50 dark:bg-blue-500/10',       text: 'text-blue-600 dark:text-blue-400' },
  red:     { bg: 'bg-red-50 dark:bg-red-500/10',         text: 'text-red-600 dark:text-red-400' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-500/10',     text: 'text-amber-600 dark:text-amber-400' },
  violet:  { bg: 'bg-violet-50 dark:bg-violet-500/10',   text: 'text-violet-600 dark:text-violet-400' },
  orange:  { bg: 'bg-orange-50 dark:bg-orange-500/10',   text: 'text-orange-600 dark:text-orange-400' },
  slate:   { bg: 'bg-slate-100 dark:bg-slate-700/30',    text: 'text-slate-600 dark:text-slate-400' },
};

export default function CompactMetricsStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl bg-white dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700/50 overflow-hidden"
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y sm:divide-y-0 lg:divide-y-0 divide-gray-100 dark:divide-gray-700/40">
        {metrics.map((m) => (
          <MetricCell key={m.key} metric={m} />
        ))}
      </div>
    </motion.div>
  );
}

function MetricCell({ metric: m }: { metric: Metric }) {
  const tint = TINT_CLASSES[m.tint || 'slate'];
  const Comp = m.onClick ? motion.button : motion.div;
  return (
    <Comp
      {...(m.onClick ? { onClick: m.onClick, whileHover: { scale: 1.01 }, whileTap: { scale: 0.99 } } : {})}
      className={cn(
        'group relative flex items-center gap-3 px-4 py-3 text-left',
        m.onClick && 'hover:bg-gray-50 dark:hover:bg-gray-800/60 cursor-pointer',
      )}
    >
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', tint.bg)}>
        <m.icon className={cn('w-4 h-4', tint.text)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 truncate">{m.label}</p>
        {m.loading ? (
          <div className="h-5 w-20 rounded-md shimmer mt-0.5" />
        ) : (
          <div className="flex items-baseline gap-1.5">
            <p className="text-base font-bold text-gray-900 dark:text-white tracking-tight truncate">{m.value}</p>
            {typeof m.delta === 'number' && m.delta !== 0 && (
              <span className={cn(
                'inline-flex items-center gap-0.5 text-[10px] font-semibold px-1 py-0.5 rounded',
                m.delta > 0
                  ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
                  : 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10',
              )}>
                {m.delta > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {m.delta > 0 ? '+' : ''}{m.delta}%
              </span>
            )}
          </div>
        )}
        {m.subtext && !m.loading && (
          <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate mt-0.5">{m.subtext}</p>
        )}
      </div>
    </Comp>
  );
}
