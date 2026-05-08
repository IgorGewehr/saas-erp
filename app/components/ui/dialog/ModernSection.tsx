'use client';

import React from 'react';
import { motion } from 'framer-motion';

/**
 * Section card padronizado dos dialogs modernos.
 * Header com icon vermelho + título display + meta opcional (geralmente um ModernPill).
 * Conteúdo recebe padding e space-y entre filhos.
 */
export function ModernSection({
  icon: Icon,
  title,
  meta,
  children,
}: {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/70 shadow-sm shadow-slate-200/50 dark:shadow-black/10 overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-white/[0.025]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
            <Icon size={16} />
          </span>
          <h4 className="text-sm font-display font-bold text-slate-950 dark:text-slate-50 truncate">{title}</h4>
        </div>
        {meta && <div className="shrink-0">{meta}</div>}
      </div>
      <div className="p-4 space-y-4">
        {children}
      </div>
    </motion.section>
  );
}
