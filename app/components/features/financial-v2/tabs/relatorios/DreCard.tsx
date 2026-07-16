'use client';

/**
 * DreCard — "DRE do mês" (mockup `relatorios.html`): mini-DRE de 4 linhas +
 * delta + nota-ponte competência↔caixa. O REGIME (competência/caixa) é a
 * única configuração global e explícita desta tela (`RelatoriosTab`), lida
 * aqui só pra decidir qual metade do `DreMensalOverview` mostrar — os dois
 * já vêm calculados do read-model.
 */

import { ArrowDownRight, ArrowUpRight, FileText, Info } from 'lucide-react';
import { DocCard } from './DocCard';
import { DocActions } from './DocActions';
import { formatCurrency } from '@/lib/utils/format';
import { exportDRECSV, exportDREPDF } from '@/lib/utils/financial-export';
import { toDREData, type DreMensalOverview, type DreRegime } from '../../read-models/dre-mensal';

interface DreCardProps {
  overview: DreMensalOverview;
  regime: DreRegime;
  periodLabel: string;
  businessName: string;
}

export function DreCard({ overview, regime, periodLabel, businessName }: DreCardProps) {
  const isCompetencia = regime === 'competencia';
  const active = isCompetencia ? overview.competencia : overview.caixa;
  const regimeLabel = isCompetencia ? 'competência' : 'caixa';

  const deltaValue = isCompetencia
    ? overview.competencia.resultado - overview.competenciaAnterior.resultado
    : -overview.bridgeDiff;
  const deltaPct = isCompetencia && overview.competenciaAnterior.resultado !== 0
    ? (deltaValue / Math.abs(overview.competenciaAnterior.resultado)) * 100
    : null;
  const deltaUp = deltaValue >= 0;

  const bridgeAbs = formatCurrency(Math.abs(overview.bridgeDiff));
  const bridgeText = isCompetencia
    ? `${formatCurrency(overview.competencia.resultado)} de resultado (competência) — mas o caixa só moveu ${formatCurrency(overview.caixa.resultado)} este mês. ${bridgeAbs} ainda não virou dinheiro.`
    : `No regime de competência (o que seu contador normalmente pede), o resultado seria ${formatCurrency(overview.competencia.resultado)} — ${bridgeAbs} ${overview.bridgeDiff >= 0 ? 'ainda não entraram' : 'já saíram'} do caixa.`;

  return (
    <DocCard
      icon={FileText}
      title="DRE do mês"
      subtitle={`${periodLabel} · prévia · ${regimeLabel}`}
      footer={
        <DocActions
          onPdf={() => exportDREPDF(toDREData(active), `${periodLabel} (${regimeLabel})`, businessName)}
          onExcel={() => exportDRECSV(toDREData(active), `${periodLabel} (${regimeLabel})`, businessName)}
        />
      }
    >
      <div className="space-y-0">
        <Row label="Receita bruta" value={active.receitaBruta} />
        <Row label={isCompetencia ? '(–) Impostos' : '(–) Impostos pagos'} value={-active.impostos} />
        <Row label={isCompetencia ? '(–) Despesas e custos' : '(–) Pago no caixa'} value={-active.despesas} />
        <div className="flex items-center justify-between gap-2 pt-2.5 mt-1 border-t border-gray-200 dark:border-gray-800">
          <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
            {isCompetencia ? 'Resultado do mês' : 'Resultado no caixa'}
          </span>
          <span className="fin-num text-base font-bold text-gray-900 dark:text-gray-100">{formatCurrency(active.resultado)}</span>
        </div>
        {isCompetencia && deltaPct !== null && (
          <div className={'inline-flex items-center gap-1 text-xs font-semibold mt-2 ' + (deltaUp ? 'text-[hsl(var(--fin-pos))]' : 'text-[hsl(var(--fin-crit))]')}>
            {deltaUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            {Math.abs(deltaPct).toFixed(0)}% vs mês anterior ({formatCurrency(Math.abs(deltaValue))})
          </div>
        )}
        {!isCompetencia && (
          <div className={'inline-flex items-center gap-1 text-xs font-semibold mt-2 ' + (overview.bridgeDiff <= 0 ? 'text-[hsl(var(--fin-pos))]' : 'text-[hsl(var(--fin-crit))]')}>
            {overview.bridgeDiff <= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            {bridgeAbs} {overview.bridgeDiff <= 0 ? 'acima' : 'abaixo'} da competência
          </div>
        )}
        <div className="flex items-start gap-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 mt-3 text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
          <Info className="w-3.5 h-3.5 flex-none mt-0.5 text-[hsl(var(--fin-primary))]" />
          <span>{bridgeText}</span>
        </div>
      </div>
    </DocCard>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  const negative = value < 0;
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-[13px] border-b border-dashed border-gray-200 dark:border-gray-800">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={'fin-num font-semibold ' + (negative ? 'text-gray-500 dark:text-gray-400 font-medium' : 'text-gray-900 dark:text-gray-100')}>
        {formatCurrency(Math.abs(value))}
      </span>
    </div>
  );
}
