'use client';

/**
 * WeeklyFlowCard — card esquerdo de Bancário: "entrou × saiu por semana ⇄
 * dias + principais movimentos" (mockup bancario.html). Drill PRÓPRIO
 * (independente do card de conciliação à direita — ver `DualDrillPair`):
 * clicar numa semana no `DivergingChart` mostra os dias daquela semana + a
 * mini-lista dos movimentos reais que a compõem.
 */

import { DrillCardHeader } from '../../components/DrillPair';
import { DivergingChart } from '../../components/charts/DivergingChart';
import type { FluxoBancarioOverview, FluxoBancarioSemana } from '../../read-models/fluxo-semanal-bancario';
import { formatCurrency } from '@/lib/utils/format';

interface WeeklyFlowCardProps {
  overview: FluxoBancarioOverview;
  selectedWeekId: string | null;
  onSelectWeek: (id: string) => void;
  onBack: () => void;
}

export function WeeklyFlowCard({ overview, selectedWeekId, onSelectWeek, onBack }: WeeklyFlowCardProps) {
  const selectedWeek = overview.semanas.find(w => w.id === selectedWeekId) ?? null;

  if (selectedWeek) {
    return <WeekDetail week={selectedWeek} movimentos={overview.movimentos.filter(m => m.weekId === selectedWeek.id)} onBack={onBack} />;
  }

  return (
    <>
      <DrillCardHeader title="Entrou × saiu por semana" hint="clique numa semana p/ ver os dias →" />
      {overview.semanas.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
          Nenhum movimento bancário realizado neste mês ainda.
        </div>
      ) : (
        <div className="px-3.5 pb-3">
          <DivergingChart
            data={overview.semanas.map(w => ({ label: w.label, positive: w.entrou, negative: w.saiu, muted: w.partial }))}
            formatValue={formatCurrency}
            positiveLabel="Entrou"
            negativeLabel="Saiu"
            onSelect={(index) => onSelectWeek(overview.semanas[index].id)}
          />
          <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">* semana em andamento</div>
        </div>
      )}
    </>
  );
}

interface WeekDetailProps {
  week: FluxoBancarioSemana;
  movimentos: FluxoBancarioOverview['movimentos'];
  onBack: () => void;
}

function WeekDetail({ week, movimentos, onBack }: WeekDetailProps) {
  return (
    <>
      <DrillCardHeader title={week.label.replace('*', '')} hint="dias + principais movimentos" onBack={onBack} />
      <div className="px-3.5 pb-1">
        <DivergingChart
          data={week.dias.map(d => ({ label: d.label, positive: d.entrou, negative: d.saiu }))}
          formatValue={formatCurrency}
          positiveLabel="Entrou"
          negativeLabel="Saiu"
        />
      </div>
      <div className="px-4.5 pb-4 flex flex-col">
        {movimentos.length === 0 ? (
          <div className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">Nenhum movimento nesta semana.</div>
        ) : (
          movimentos.map(m => (
            <div key={m.id} className="flex items-center gap-2.5 py-2 border-b border-gray-100 dark:border-gray-800/60 last:border-0 text-[12.5px]">
              <span className="fin-num flex-none w-9 text-gray-400 dark:text-gray-500">{m.dateLabel.slice(0, 2)}</span>
              <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-300">{m.desc}</span>
              <span className={`fin-num flex-none font-bold ${m.valorSigned < 0 ? 'text-[hsl(var(--fin-crit))]' : 'text-[hsl(var(--fin-pos))]'}`}>
                {m.valorSigned < 0 ? '−' : '+'}{formatCurrency(Math.abs(m.valorSigned))}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
