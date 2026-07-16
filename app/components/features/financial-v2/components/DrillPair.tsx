'use client';

/**
 * DrillPair — o par `grid2` esq⇄dir do mockup: 2 cards lado a lado que trocam
 * de conteúdo juntos (overview ⇄ detalhe) com a animação `cardin` (220ms,
 * fade+translateY — SEM blur no exit, ver CLAUDE.md §6/instabilidade GPU).
 *
 * O componente é "burro": recebe `left`/`right` já resolvidos pro estado atual
 * e uma `drillKey` (ex: `selectedId ?? 'overview'`) — troca de key dispara a
 * animação. Quem decide O QUE mostrar em cada estado é a aba (StatTiles,
 * BarsIndex, DivergingChart etc.), este componente só orquestra a moldura.
 *
 * `useDrillState` é o hook mínimo de estado local que toda aba com drill usa.
 */

import { useState, useCallback, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export function useDrillState<T extends string = string>() {
  const [selectedId, setSelectedId] = useState<T | null>(null);
  const select = useCallback((id: T | null) => setSelectedId(id), []);
  return { selectedId, select, isDrilled: selectedId !== null };
}

interface DrillPairProps {
  left: ReactNode;
  right: ReactNode;
  drillKey: string;
  className?: string;
}

const cardMotion = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 }, // sem blur, sem scale — só fade (evita instabilidade de GPU)
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
};

export function DrillPair({ left, right, drillKey, className }: DrillPairProps) {
  return (
    <section className={cn('grid gap-3.5 lg:grid-cols-[1.15fr_1fr]', className)}>
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 min-h-[236px] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={drillKey} {...cardMotion}>
            {left}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 min-h-[236px] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={drillKey} {...cardMotion}>
            {right}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

interface DrillCardHeaderProps {
  title: ReactNode;
  hint?: string;
  onBack?: () => void;
}

/** Header `.sec` do mockup — com `←` opcional quando em modo detalhe. */
export function DrillCardHeader({ title, hint, onBack }: DrillCardHeaderProps) {
  return (
    <h2 className="flex items-center justify-between gap-2 px-4.5 pt-3.5 pb-2.5 text-[13px] font-bold text-gray-900 dark:text-gray-100">
      <span className="inline-flex items-center gap-2 min-w-0">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Voltar"
            className="flex-none w-7 h-7 rounded-lg grid place-items-center bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-[hsl(var(--fin-primary-soft))] hover:text-[hsl(var(--fin-primary))] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
        )}
        <span className="truncate">{title}</span>
      </span>
      {hint && <span className="flex-none text-xs font-medium text-gray-400 dark:text-gray-500">{hint}</span>}
    </h2>
  );
}
