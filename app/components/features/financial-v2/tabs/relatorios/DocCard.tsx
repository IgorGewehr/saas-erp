'use client';

/**
 * DocCard — a gramática `.doc-card` do mockup `relatorios.html`: cards de
 * DOCUMENTO, não KPI (ícone + título + subtítulo/condição, corpo livre,
 * ações no rodapé). Única tela do módulo sem hero+sparkline nem drill —
 * "aqui é papel, não insight" (plano §1.2, única aba sem Super Consultor).
 */

import type { LucideIcon } from 'lucide-react';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DocCardProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** Nota "Visível porque..." — mesma gramática do `ctx-note`/`doc-cond` do mockup. */
  conditionNote?: string;
  /** Ícone com fundo `primary-soft` (o card-estrela — Fechamento mensal). */
  star?: boolean;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function DocCard({ icon: Icon, title, subtitle, conditionNote, star, className, children, footer }: DocCardProps) {
  return (
    <div className={cn('rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4.5 flex flex-col', className)}>
      <div className="flex items-start gap-3 mb-3">
        <div
          className={cn(
            'w-9 h-9 rounded-[11px] grid place-items-center flex-none',
            star
              ? 'bg-[hsl(var(--fin-primary-soft))] text-[hsl(var(--fin-primary))]'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
          )}
        >
          <Icon className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-bold tracking-tight text-gray-900 dark:text-gray-100 truncate">{title}</h3>
          {subtitle && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</div>}
          {conditionNote && (
            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-[hsl(var(--fin-primary))] mt-0.5">
              <Info className="w-3 h-3" /> {conditionNote}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1">{children}</div>
      {footer && <div className="mt-3.5">{footer}</div>}
    </div>
  );
}
