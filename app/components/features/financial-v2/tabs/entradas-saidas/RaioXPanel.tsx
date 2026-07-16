'use client';

/**
 * RaioXPanel — o card direito do `grid2` de Entradas & Saídas quando NENHUMA
 * categoria está selecionada ("Raio-X do mês" do mockup): fixo × variável
 * (SplitBar), quem mais subiu vs a média de 5 meses, e o tile clicável de
 * atrasados 30+ que aplica o filtro "atrasados" na linha do tempo.
 *
 * Diferente de `StatTilesStack` (pilha genérica label/value/footnote): aqui
 * cada stat tem forma própria (barra bicolor, delta colorido, botão) — por
 * isso é um componente bespoke desta tela, não uma reaproveitação forçada.
 */

import { ArrowUp } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/format';
import { SplitBar } from '../../components/SplitBar';
import type { ResumoPorCategoriaOverview } from '../../read-models/resumo-por-categoria';
import type { AgingRecebiveisOverview } from '../../read-models/aging-recebiveis';

interface RaioXPanelProps {
  overview: ResumoPorCategoriaOverview;
  aging: AgingRecebiveisOverview;
  onSelectAtrasados: () => void;
}

const statClass = 'rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3.5 py-3';

export function RaioXPanel({ overview, aging, onSelectAtrasados }: RaioXPanelProps) {
  const { fixoPct, varPct, topVariacao } = overview;

  return (
    <div className="px-4.5 pb-4.5 flex flex-col gap-2.5">
      <div className={statClass}>
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Fixo × variável</div>
        <div className="fin-num mt-1 flex items-baseline gap-1.5 text-[22px] font-bold tracking-tight text-gray-900 dark:text-gray-50">
          {fixoPct !== null ? fixoPct.toFixed(0) : '—'}
          <small className="text-sm font-semibold text-gray-500 dark:text-gray-400">%</small>
          <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
            · {varPct !== null ? varPct.toFixed(0) : '—'}
            <small>%</small>
          </span>
        </div>
        <SplitBar leftPct={fixoPct ?? 0} />
        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">fixo · variável do mês</div>
      </div>

      <div className={statClass}>
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Quem mais subiu</div>
        {topVariacao ? (
          <>
            <div className="mt-1 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-gray-50">
              {topVariacao.label}
              <span className="fin-num inline-flex items-center gap-0.5 text-[13px] font-bold text-[hsl(var(--fin-warn))]">
                <ArrowUp className="w-3 h-3" />+{Math.round(topVariacao.variacaoPct)}%
              </span>
            </div>
            <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">vs a média dos últimos 5 meses</div>
          </>
        ) : (
          <div className="mt-1 text-[13.5px] text-gray-500 dark:text-gray-400">Nenhuma categoria destoando este mês.</div>
        )}
      </div>

      <button
        type="button"
        onClick={onSelectAtrasados}
        disabled={aging.over30Total <= 0}
        className="rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3.5 py-3 text-left transition-colors enabled:hover:brightness-[0.97] dark:enabled:hover:brightness-125 disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--fin-primary))] focus-visible:outline-offset-2"
      >
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">Atrasados há mais de 30 dias</div>
        <div className="fin-num mt-1 text-[22px] font-bold tracking-tight text-[hsl(var(--fin-crit))]">
          {formatCurrency(aging.over30Total)}
          <small className="ml-1.5 text-sm font-semibold text-gray-500 dark:text-gray-400">
            · {aging.over30ClientCount} cliente{aging.over30ClientCount !== 1 ? 's' : ''}
          </small>
        </div>
        <div className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
          {aging.over30Total > 0 ? 'clique para ver na linha do tempo →' : 'nenhum atrasado com mais de 30 dias'}
        </div>
      </button>
    </div>
  );
}
