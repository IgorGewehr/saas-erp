'use client';

/**
 * PageHeader — eyebrow · h1 · sub (a pergunta da tela), com slot de ações à
 * direita (seletor de período, botão primário). Espelha `header.page` do
 * mockup.
 */

import type { ReactNode } from 'react';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-4 flex-wrap mb-5">
      <div>
        <div className="fin-eyebrow text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">
          {eyebrow}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50 mt-1 mb-0.5 font-display">
          {title}
        </h1>
        {subtitle && <div className="text-[13.5px] text-gray-500 dark:text-gray-400">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2.5 flex-wrap">{actions}</div>}
    </header>
  );
}
