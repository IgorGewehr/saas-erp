'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type ModernPillTone = 'slate' | 'red' | 'emerald' | 'amber' | 'blue';

const TONE_CLASSES: Record<ModernPillTone, string> = {
  slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  red: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300',
  emerald: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300',
  blue: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300',
};

export function ModernPill({
  children,
  tone = 'slate',
  className,
}: {
  children: React.ReactNode;
  tone?: ModernPillTone;
  className?: string;
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold',
      TONE_CLASSES[tone],
      className,
    )}>
      {children}
    </span>
  );
}
