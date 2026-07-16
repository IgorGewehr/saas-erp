'use client';

/**
 * ExtratoTable — a "Linha do tempo" de Entradas & Saídas: extrato unificado
 * (passado realizado + futuro previsto) com o divisor "HOJE" e a ação de dar
 * baixa. Não reusa `FinTable` genérico porque precisa de 3 coisas que o
 * componente genérico não modela: (1) o divisor inserido na posição
 * cronológica certa mesmo com filtro ativo — iterando a lista COMPLETA e só
 * pulando a linha, nunca o divisor (mesma lógica do mockup `renderTabela`);
 * (2) 1-2 botões de ação por linha (baixa/cobrar) que dependem do status E da
 * direção; (3) linhas "pago" clicáveis pro detalhe, linhas de histórico não.
 *
 * Deviation consciente do mockup: lá, `atrasado` só mostra "Cobrar" (o dataset
 * de exemplo só tinha atrasado do lado receita). Aqui, despesa atrasada também
 * precisa de "Dar baixa" (pagar a conta atrasada é baixa, não cobrança) — os
 * dois botões convivem quando fizer sentido (atrasado + receita: cobrar E,
 * quando o cliente pagar, dar baixa).
 */

import type { ReactNode } from 'react';
import { StatusChip, type StatusChipVariant } from '../../components/StatusChip';
import { formatCurrency } from '@/lib/utils/format';
import { shortDayLabel } from '../../read-models/date-utils';
import { rowPassesFilter, type ExtratoRow, type ExtratoSegmento, type ExtratoActiveFilter } from '../../read-models/extrato-unificado';
import { cn } from '@/lib/utils';

interface ExtratoTableProps {
  rows: ExtratoRow[];
  todayStr: string;
  segmento: ExtratoSegmento;
  activeFilter: ExtratoActiveFilter | null;
  atrasadosCount: number;
  cobradosIds: ReadonlySet<string>;
  /** Chip removível "Filtrando por: X ✕" — slot pra manter a lógica de estado no orquestrador. */
  filterBar?: ReactNode;
  onDarBaixa: (row: ExtratoRow) => void;
  onCobrar: (row: ExtratoRow) => void;
  onVerDetalhe: (row: ExtratoRow) => void;
}

const STATUS_UI: Record<ExtratoRow['status'], { label: (r: ExtratoRow) => string; variant: StatusChipVariant }> = {
  pago: { label: () => 'Pago', variant: 'pos' },
  previsto: { label: () => 'Previsto', variant: 'neutral' },
  atrasado: { label: r => `Atrasado ${r.overdueDays ?? 0}d`, variant: 'crit' },
};

const thClass = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800';

export function ExtratoTable({
  rows,
  todayStr,
  segmento,
  activeFilter,
  atrasadosCount,
  cobradosIds,
  filterBar,
  onDarBaixa,
  onCobrar,
  onVerDetalhe,
}: ExtratoTableProps) {
  let dividerDone = false;
  const visibleRows = rows.filter(r => rowPassesFilter(r, segmento, activeFilter));

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <h2 className="flex items-center justify-between gap-2 flex-wrap px-4.5 pt-3.5 text-[13px] font-bold text-gray-900 dark:text-gray-100">
        Linha do tempo
        <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
          {rows.length} lançamento{rows.length !== 1 ? 's' : ''} · {atrasadosCount} atrasado{atrasadosCount !== 1 ? 's' : ''}
        </span>
      </h2>
      {filterBar && <div className="px-4.5 pt-2.5">{filterBar}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr>
              <th className={thClass}>Data</th>
              <th className={thClass}>Descrição</th>
              <th className={thClass}>Categoria</th>
              <th className={thClass}>Status</th>
              <th className={cn(thClass, 'text-right')}>Valor</th>
              <th className={cn(thClass, 'text-right')}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                  Nenhum lançamento encontrado para este negócio ainda.
                </td>
              </tr>
            )}
            {rows.map(row => {
              const showDivider = !dividerDone && row.date <= todayStr;
              if (showDivider) dividerDone = true;
              const passes = rowPassesFilter(row, segmento, activeFilter);
              return (
                <RowFragment
                  key={row.id}
                  row={row}
                  showDivider={showDivider}
                  todayStr={todayStr}
                  render={passes}
                  cobrado={cobradosIds.has(row.id)}
                  onDarBaixa={onDarBaixa}
                  onCobrar={onCobrar}
                  onVerDetalhe={onVerDetalhe}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {visibleRows.length === 0 && rows.length > 0 && (
        <p className="px-4.5 pb-4 text-sm text-gray-400 dark:text-gray-500">Nenhum lançamento bate com esse filtro.</p>
      )}
    </div>
  );
}

interface RowFragmentProps {
  row: ExtratoRow;
  showDivider: boolean;
  todayStr: string;
  render: boolean;
  cobrado: boolean;
  onDarBaixa: (row: ExtratoRow) => void;
  onCobrar: (row: ExtratoRow) => void;
  onVerDetalhe: (row: ExtratoRow) => void;
}

function RowFragment({ row, showDivider, todayStr, render, cobrado, onDarBaixa, onCobrar, onVerDetalhe }: RowFragmentProps) {
  return (
    <>
      {showDivider && (
        <tr>
          <td colSpan={6} className="bg-gray-50/60 dark:bg-gray-800/30 px-4 py-1.5">
            <div className="flex items-center gap-2.5">
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
              <span className="text-[11px] font-bold uppercase tracking-wide text-[hsl(var(--fin-primary))] whitespace-nowrap">
                Hoje · {shortDayLabel(todayStr)}
              </span>
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
            </div>
          </td>
        </tr>
      )}
      {render && <ExtratoRowLine row={row} cobrado={cobrado} onDarBaixa={onDarBaixa} onCobrar={onCobrar} onVerDetalhe={onVerDetalhe} />}
    </>
  );
}

function ExtratoRowLine({ row, cobrado, onDarBaixa, onCobrar, onVerDetalhe }: Omit<RowFragmentProps, 'showDivider' | 'todayStr' | 'render'>) {
  const isEntrada = row.direction === 'entrada';
  const clickable = row.status === 'pago' && !row.isHistoryEntry;
  const ui = STATUS_UI[row.status];
  const canBaixa = row.status !== 'pago' && !row.isHistoryEntry;
  const canCobrar = row.status === 'atrasado' && isEntrada;

  return (
    <tr
      onClick={clickable ? () => onVerDetalhe(row) : undefined}
      className={cn(
        'border-b border-gray-100 dark:border-gray-800/60 last:border-0 transition-colors',
        'hover:bg-gray-50/70 dark:hover:bg-gray-800/40',
        clickable && 'cursor-pointer',
      )}
    >
      <td className="fin-num px-4 py-3 text-[13.5px] text-gray-600 dark:text-gray-400">{shortDayLabel(row.date)}</td>
      <td className="px-4 py-3 text-[13.5px]">
        <span className="font-semibold text-gray-800 dark:text-gray-200">{row.description}</span>
        {row.sublabel && <span className="block text-[11.5px] font-medium text-gray-400 dark:text-gray-500">{row.sublabel}</span>}
      </td>
      <td className="px-4 py-3 text-[13px] text-gray-500 dark:text-gray-400">{row.category ?? 'Sem categoria'}</td>
      <td className="px-4 py-3">
        <StatusChip label={ui.label(row)} variant={ui.variant} />
        {row.status === 'pago' && row.accountLabel && (
          <span className="block mt-1 text-[11px] text-gray-400 dark:text-gray-500">· {row.accountLabel}</span>
        )}
      </td>
      <td className={cn('fin-num px-4 py-3 text-right text-[13.5px] font-bold', isEntrada ? 'text-[hsl(var(--fin-pos))]' : 'text-gray-800 dark:text-gray-200')}>
        {isEntrada ? '+' : '−'}
        {formatCurrency(row.amount)}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {canBaixa && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onDarBaixa(row); }}
              className="whitespace-nowrap rounded-lg border border-[hsl(var(--fin-primary)/0.35)] px-2.5 py-1 text-[11.5px] font-bold text-[hsl(var(--fin-primary))] transition-colors hover:bg-[hsl(var(--fin-primary-soft))]"
            >
              Dar baixa
            </button>
          )}
          {canCobrar && (
            <button
              type="button"
              disabled={cobrado}
              onClick={e => { e.stopPropagation(); onCobrar(row); }}
              className="whitespace-nowrap rounded-lg border border-[hsl(var(--fin-crit)/0.35)] px-2.5 py-1 text-[11.5px] font-bold text-[hsl(var(--fin-crit))] transition-colors hover:bg-[hsl(var(--fin-crit-soft))] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {cobrado ? 'Enviada ✓' : 'Cobrar'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
