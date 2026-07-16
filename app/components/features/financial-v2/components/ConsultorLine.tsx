'use client';

/**
 * ConsultorLine — a "linha do Super Consultor" (`.consultor` do mockup): borda
 * gradiente, ícone, ≤2 frases, 1 CTA opcional + "ver como calculamos ⌄" que
 * expande os facts brutos (auditoria do conselho, sem rede).
 *
 * Recebe `ConsultorLineData` já resolvida (ver useConsultorInsight) — este
 * componente só formata/anima, nunca decide o texto nem a navegação.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConsultorLineData } from '../hooks/useConsultorInsight';
import type { ConsultorInsight } from '../read-models/consultor-rules';

interface ConsultorLineProps {
  data: ConsultorLineData;
  facts: ConsultorInsight['facts'];
  onCtaClick?: () => void;
  className?: string;
}

export function ConsultorLine({ data, facts, onCtaClick, className }: ConsultorLineProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'relative rounded-2xl p-4 flex gap-3.5 items-start',
        'bg-white dark:bg-gray-900',
        'border border-[hsl(var(--fin-primary)/0.35)] dark:border-[hsl(var(--fin-primary)/0.4)]',
        'shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-18px_hsl(var(--fin-shadow)/0.5)]',
        className,
      )}
    >
      <div className="flex-none w-9 h-9 rounded-[11px] grid place-items-center bg-[hsl(var(--fin-primary-soft))] text-[hsl(var(--fin-primary))]">
        <Sparkles className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 mb-1">Super Consultor</h3>
        <p className="text-[13.5px] leading-relaxed text-gray-700 dark:text-gray-300">{data.phrase}</p>
        <div className="mt-2 flex items-center gap-4 flex-wrap">
          {data.cta && onCtaClick && (
            <button
              onClick={onCtaClick}
              className="text-xs font-semibold text-[hsl(var(--fin-primary))] hover:underline"
            >
              {data.cta.label}
            </button>
          )}
          <button
            onClick={() => setExpanded(v => !v)}
            className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Ver como calculamos
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        </div>
        <AnimatePresence mode="wait">
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <dl className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-xl bg-gray-50 dark:bg-gray-800/60 p-3">
                {Object.entries(facts).map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-[10.5px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{key}</dt>
                    <dd className="fin-num text-[13px] font-semibold text-gray-800 dark:text-gray-200 truncate">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
