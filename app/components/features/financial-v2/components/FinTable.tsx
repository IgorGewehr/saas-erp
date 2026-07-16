'use client';

/**
 * FinTable — a tabela genérica do módulo (espelha `table`/`thead`/`tbody` do
 * mockup: header uppercase discreto, hover de linha, coluna numérica alinhada
 * à direita, linha "cancelada" com strike). Column-based — cada aba declara
 * suas próprias colunas, o componente só formata a grade.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface FinTableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

interface FinTableProps<T> {
  columns: FinTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Marca a linha visualmente como "encerrada" (strike-through, ex: assinatura cancelada). */
  isRowMuted?: (row: T) => boolean;
  emptyMessage?: string;
  title?: string;
  hint?: string;
}

export function FinTable<T>({ columns, rows, rowKey, isRowMuted, emptyMessage, title, hint }: FinTableProps<T>) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      {title && (
        <h2 className="flex items-center justify-between gap-2 px-4.5 pt-3.5 text-[13px] font-bold text-gray-900 dark:text-gray-100">
          {title}
          {hint && <span className="text-xs font-medium text-gray-400 dark:text-gray-500">{hint}</span>}
        </h2>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800',
                    col.align === 'right' && 'text-right',
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                  {emptyMessage ?? 'Nenhum registro no período.'}
                </td>
              </tr>
            ) : (
              rows.map(row => {
                const muted = isRowMuted?.(row);
                return (
                  <tr
                    key={rowKey(row)}
                    className={cn(
                      'border-b border-gray-100 dark:border-gray-800/60 last:border-0',
                      'hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition-colors',
                      muted && 'text-gray-400 dark:text-gray-600',
                    )}
                  >
                    {columns.map(col => (
                      <td
                        key={col.key}
                        className={cn(
                          'px-4 py-3 text-[13.5px]',
                          col.align === 'right' && 'text-right',
                          muted && 'line-through decoration-gray-300 dark:decoration-gray-700',
                        )}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
