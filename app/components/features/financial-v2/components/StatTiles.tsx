'use client';

/**
 * StatTiles — a pilha vertical `.stats`/`.stat` do mockup: usada dentro do
 * card direito do DrillPair (retenção da carteira ⇄ retenção por serviço).
 * Diferente de `StatTile.tsx` (a fileira `.kpi` do topo da tela) — mesma
 * gramática de números, layout vertical compacto.
 */

import type { ReactNode } from 'react';

export interface StatTilesItem {
  key: string;
  label: string;
  value: ReactNode;
  suffix?: string;
  footnote?: string;
}

export function StatTilesStack({ items }: { items: StatTilesItem[] }) {
  return (
    <div className="px-4.5 pb-4.5 flex flex-col gap-2.5">
      {items.map(item => (
        <div key={item.key} className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3.5 py-3">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">{item.label}</div>
          <div className="fin-num mt-1 text-[22px] font-bold tracking-tight text-gray-900 dark:text-gray-50">
            {item.value}
            {item.suffix && <small className="ml-1 text-sm font-semibold text-gray-500 dark:text-gray-400">{item.suffix}</small>}
          </div>
          {item.footnote && <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{item.footnote}</div>}
        </div>
      ))}
    </div>
  );
}
