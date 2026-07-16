'use client';

/**
 * ProfitCard — bloco ③ do santo-graal: "Lucro do mês" (`.profit-card` do
 * mockup), com a margem traduzida em linguagem humana ("de cada R$1, sobram
 * X") e a frase-ponte competência×caixa: por que o lucro é diferente do
 * disponível pra retirada (bloco ①) — o dinheiro que ainda está pra receber.
 */

import { ArrowUpRight, ArrowDownRight, Info } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/format';
import type { ResultadoDoMesOverview } from '../read-models/resultado-do-mes';

interface ProfitCardProps {
  overview: ResultadoDoMesOverview;
  onSeeDetail?: () => void;
}

export function ProfitCard({ overview, onSeeDetail }: ProfitCardProps) {
  const { lucro, margemPct, deltaPct, deltaValue, receitaPendenteTotal } = overview;
  const up = deltaValue >= 0;
  const perReal = margemPct !== null ? margemPct / 100 : null;

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 flex flex-col h-full">
      <div className="fin-eyebrow flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold">
        Lucro do mês
        <span title="Competência: conta o que foi vendido/gasto neste mês, mesmo que o dinheiro ainda não tenha mudado de mão.">
          <Info className="w-3 h-3" />
        </span>
      </div>

      <div className="fin-num mt-2.5 text-[27px] sm:text-[30px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">
        {formatCurrency(lucro)}
      </div>

      {deltaPct !== null && (
        <div
          className={`mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold ${
            up ? 'text-[hsl(var(--fin-pos))]' : 'text-[hsl(var(--fin-crit))]'
          }`}
        >
          {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
          {Math.abs(deltaPct).toFixed(0)}% vs mês passado
        </div>
      )}

      {perReal !== null && (
        <div className="mt-3 text-[13px] text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 rounded-xl px-3 py-2.5 leading-relaxed">
          De cada <b className="font-bold">R$ 1</b> vendido, sobram <b className="fin-num font-bold">{formatCurrency(perReal)}</b>
        </div>
      )}

      {receitaPendenteTotal > 0 && (
        <div className="mt-2.5 text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
          Lucro é maior que o disponível porque{' '}
          <b className="text-gray-700 dark:text-gray-300 font-bold">{formatCurrency(receitaPendenteTotal)}</b> ainda estão pra receber.
        </div>
      )}

      {onSeeDetail && (
        <button
          onClick={onSeeDetail}
          className="mt-auto self-start pt-3.5 text-left text-[12.5px] font-semibold text-[hsl(var(--fin-primary))] hover:underline"
        >
          ver de onde veio →
        </button>
      )}
    </div>
  );
}
