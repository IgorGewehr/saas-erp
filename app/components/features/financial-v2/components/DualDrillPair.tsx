'use client';

/**
 * DualDrillPair — variante do `DrillPair` pra pares esq⇄dir que drillam
 * INDEPENDENTEMENTE um do outro. `DrillPair` documenta que os dois lados
 * trocam JUNTOS por uma seleção única (Assinaturas: escolhe um serviço, os
 * dois cards mudam de estado ao mesmo tempo) — mas o mockup `bancario.html`
 * tem dois drills de verdade independentes lado a lado ("entrou×saiu por
 * semana" à esquerda, "conciliação em 3 baldes" à direita: clicar num não
 * afeta o outro). Mesma moldura visual e animação `cardin` (220ms, sem blur
 * no exit) — só que cada card anima na SUA própria `key`.
 */

import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const cardMotion = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
};

interface DualDrillPairProps {
  left: ReactNode;
  leftKey: string;
  right: ReactNode;
  rightKey: string;
  className?: string;
}

export function DualDrillPair({ left, leftKey, right, rightKey, className }: DualDrillPairProps) {
  return (
    <section className={cn('grid gap-3.5 lg:grid-cols-[1.15fr_1fr]', className)}>
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 min-h-[236px] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={leftKey} {...cardMotion}>
            {left}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 min-h-[236px] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={rightKey} {...cardMotion}>
            {right}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
