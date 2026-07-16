'use client';

/**
 * EntradasSaidasTab — Fase 3 do plano: o extrato unificado (passado realizado
 * + futuro previsto, divisor HOJE), o drill "Para onde foi o dinheiro ⇄
 * Raio-X do mês", e a ponte previsto→realizado (`BaixaDialog`, que obriga
 * `bankAccountId` e o movimento aparece em Bancário/Caixa — gap g2 do plano).
 *
 * Port fiel de `scratchpad/mockups/entradas-saidas.html`, dados reais do
 * tenant via `useFinancialData`. O FAB "⊕ Lançar" é global (vive no shell
 * `FinancialV2Module`, não aqui) — mas abrir/fechar `LancarSheet` a partir de
 * outra aba sempre pousa o novo lançamento nesta linha do tempo.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { usePeriod } from '../../state/PeriodContext';
import { useFinTransactions, useFinBankAccounts } from '../../hooks/useFinancialData';
import { useConsultorInsight } from '../../hooks/useConsultorInsight';
import { StatTile, StatTileGroup } from '../../components/StatTile';
import { ConsultorLine } from '../../components/ConsultorLine';
import { DrillPair, DrillCardHeader, useDrillState } from '../../components/DrillPair';
import { BarsIndex, type BarsIndexItem } from '../../components/BarsIndex';
import { StatTilesStack } from '../../components/StatTiles';
import { ColumnsChart } from '../../components/charts/ColumnsChart';
import { BridgeNote } from '../../components/BridgeNote';
import { BaixaDialog } from '../../components/BaixaDialog';
import { RaioXPanel } from './RaioXPanel';
import { ExtratoTable } from './ExtratoTable';
import { DetalheLancamentoModal } from './DetalheLancamentoModal';
import { computeExtratoUnificado, type ExtratoRow, type ExtratoSegmento, type ExtratoActiveFilter } from '../../read-models/extrato-unificado';
import { computeResumoPorCategoria } from '../../read-models/resumo-por-categoria';
import { computeAgingRecebiveis } from '../../read-models/aging-recebiveis';
import { computeResumoAbertos } from '../../read-models/resumo-abertos';
import { computeResultadoDoMes } from '../../read-models/resultado-do-mes';
import { computeFechamentoMes, computeBridgeCaixaCompetencia } from '../../read-models/projecao-mes';
import { pickEntradasSaidasInsight } from '../../read-models/consultor-rules';
import { startOfDay, toDateStr } from '../../read-models/date-utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';

const SEGMENTOS: { id: ExtratoSegmento; label: string }[] = [
  { id: 'tudo', label: 'Tudo' },
  { id: 'receber', label: 'A receber' },
  { id: 'pagar', label: 'A pagar' },
];

const CARD_SKELETON = 'rounded-2xl border border-gray-200 dark:border-gray-800 h-[220px] animate-pulse bg-gray-50 dark:bg-gray-800/40';

function previousMonthFullLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const d = new Date(year, month - 2, 1);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(d);
}

export function EntradasSaidasTab() {
  const { period, label: periodLabel } = usePeriod();
  const { data: transactions = [], isLoading: loadingTx } = useFinTransactions();
  const { data: bankAccounts = [], isLoading: loadingBa } = useFinBankAccounts();
  const isLoading = loadingTx || loadingBa;

  const [segmento, setSegmento] = useState<ExtratoSegmento>('tudo');
  const [activeFilter, setActiveFilter] = useState<ExtratoActiveFilter | null>(null);
  const [baixaRow, setBaixaRow] = useState<ExtratoRow | null>(null);
  const [detalheRow, setDetalheRow] = useState<ExtratoRow | null>(null);
  const [cobradosIds, setCobradosIds] = useState<ReadonlySet<string>>(new Set());
  const categoriaDrill = useDrillState<string>();
  const tableRef = useRef<HTMLDivElement>(null);

  const todayStr = useMemo(() => toDateStr(startOfDay(new Date())), []);
  const extrato = useMemo(() => computeExtratoUnificado(transactions, bankAccounts), [transactions, bankAccounts]);
  const resumoCategoria = useMemo(() => computeResumoPorCategoria(transactions, period), [transactions, period]);
  const aging = useMemo(() => computeAgingRecebiveis(transactions), [transactions]);
  const resumoAbertos = useMemo(() => computeResumoAbertos(transactions), [transactions]);
  const resultado = useMemo(() => computeResultadoDoMes(transactions, period), [transactions, period]);
  const fechamento = useMemo(() => computeFechamentoMes(transactions, bankAccounts, period), [transactions, bankAccounts, period]);
  const bridge = useMemo(() => computeBridgeCaixaCompetencia(resultado, fechamento), [resultado, fechamento]);
  const insight = useMemo(() => pickEntradasSaidasInsight(resumoCategoria), [resumoCategoria]);
  const consultor = useConsultorInsight(insight);

  const applyFilter = useCallback((filter: ExtratoActiveFilter) => {
    setActiveFilter(filter);
    requestAnimationFrame(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  const handleCobrar = useCallback((row: ExtratoRow) => {
    setCobradosIds(prev => new Set(prev).add(row.id));
    toast.success(`Cobrança marcada como enviada para ${row.description}. (Envio automático por WhatsApp ainda não está integrado aqui.)`);
  }, []);

  const handleConsultorCta = useCallback(() => {
    if (insight.ruleId === 'categoria-subiu' && resumoCategoria.topVariacao) {
      applyFilter({ type: 'categoria', value: resumoCategoria.topVariacao.label, label: resumoCategoria.topVariacao.label });
    }
  }, [insight.ruleId, resumoCategoria.topVariacao, applyFilter]);

  const selectedCategoria = resumoCategoria.rows.find(r => r.id === categoriaDrill.selectedId) ?? null;
  const barsItems: BarsIndexItem[] = resumoCategoria.rows.map(r => ({
    id: r.id,
    label: r.label,
    value: r.total,
    pct: resumoCategoria.totalDespesas > 0 ? (r.total / resumoCategoria.totalDespesas) * 100 : 0,
    colorRank: r.colorRank,
    badge: r.isAnomalia ? `▲ ${Math.round(r.variacaoPct)}%` : undefined,
  }));

  const monthLower = periodLabel.split(' ')[0]?.toLowerCase() ?? periodLabel;
  const fechamentoSign = fechamento.deltaAberto >= 0 ? '+' : '−';

  return (
    <div className="space-y-4">
      <div className="inline-flex bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[11px] p-0.5 gap-0.5">
        {SEGMENTOS.map(s => (
          <button
            key={s.id}
            onClick={() => setSegmento(s.id)}
            className={
              'px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ' +
              (segmento === s.id
                ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400')
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className={CARD_SKELETON} />)}
        </div>
      ) : (
        <StatTileGroup>
          <StatTile
            hero
            label="A receber em aberto"
            value={formatCurrency(resumoAbertos.receber.total)}
            delta={
              aging.totalAtrasado > 0
                ? { direction: 'down', text: `${formatCurrency(aging.totalAtrasado)} atrasado` }
                : { direction: 'neutral', text: 'nenhum atrasado' }
            }
            footnote={`${resumoAbertos.receber.count} parcela${resumoAbertos.receber.count !== 1 ? 's' : ''} em aberto`}
          />
          <StatTile
            label="A pagar em aberto"
            value={formatCurrency(resumoAbertos.pagar.total)}
            delta={
              resumoAbertos.pagar.maior
                ? { direction: 'neutral', text: `maior: ${resumoAbertos.pagar.maior.label} · ${formatDate(resumoAbertos.pagar.maior.date)}` }
                : undefined
            }
            footnote={`${resumoAbertos.pagar.count} lançamento${resumoAbertos.pagar.count !== 1 ? 's' : ''} aberto${resumoAbertos.pagar.count !== 1 ? 's' : ''}`}
          />
          <StatTile
            label={
              <span className="inline-flex items-center gap-1">
                Resultado do mês
                <span title="Competência: conta o que foi vendido/gasto, mesmo sem o dinheiro ter mudado de mão ainda.">
                  <Info className="w-3 h-3" />
                </span>
              </span>
            }
            value={formatCurrency(resultado.lucro)}
            delta={
              resultado.deltaPct !== null
                ? { direction: resultado.deltaPct >= 0 ? 'up' : 'down', text: `${Math.abs(resultado.deltaPct).toFixed(0)}% vs ${previousMonthFullLabel(period)}` }
                : undefined
            }
            footnote="regime de competência"
          />
          <StatTile
            label="Como fecha o mês"
            value={`${fechamentoSign}${formatCurrency(Math.abs(fechamento.deltaAberto))}`}
            delta={{ direction: 'neutral', text: 'projeção do caixa' }}
            footnote={`se tudo que vence em ${monthLower} for pago`}
          />
        </StatTileGroup>
      )}

      <BridgeNote note={bridge} />

      <ConsultorLine data={consultor} facts={insight.facts} onCtaClick={consultor.cta ? handleConsultorCta : undefined} />

      <DrillPair
        drillKey={categoriaDrill.selectedId ?? 'overview'}
        left={
          selectedCategoria ? (
            <>
              <DrillCardHeader title={selectedCategoria.label} hint="6 meses · sua média em tracejado" onBack={() => categoriaDrill.select(null)} />
              <div className="px-1 pb-3">
                <ColumnsChart
                  data={selectedCategoria.hist6m.map((v, i) => ({
                    label: selectedCategoria.monthLabels[i],
                    value: v,
                    highlight: i === selectedCategoria.hist6m.length - 1 && selectedCategoria.isAnomalia,
                  }))}
                  average={selectedCategoria.avg5mBefore}
                  formatValue={formatCurrency}
                />
              </div>
            </>
          ) : (
            <>
              <DrillCardHeader title="Para onde foi o dinheiro" hint="clique numa categoria p/ ver 6 meses →" />
              <BarsIndex items={barsItems} formatValue={formatCurrency} onSelect={categoriaDrill.select} emptyMessage="Nenhuma despesa lançada neste mês ainda." />
            </>
          )
        }
        right={
          selectedCategoria ? (
            <>
              <DrillCardHeader title={selectedCategoria.label} hint="raio-x da categoria" />
              <StatTilesStack
                items={[
                  { key: 'media', label: 'Média histórica (5 meses)', value: formatCurrency(selectedCategoria.avg5mBefore), footnote: 'antes deste mês' },
                  {
                    key: 'maior',
                    label: 'Maior lançamento do mês',
                    value: selectedCategoria.maiorLancamento ? formatCurrency(selectedCategoria.maiorLancamento.amount) : '—',
                    footnote: selectedCategoria.maiorLancamento?.description ?? 'nenhum lançamento este mês',
                  },
                  {
                    key: 'pct',
                    label: '% do total do mês',
                    value: resumoCategoria.totalDespesas > 0 ? (selectedCategoria.total / resumoCategoria.totalDespesas * 100).toFixed(0) : '0',
                    suffix: '%',
                    footnote: 'de tudo que saiu neste mês',
                  },
                ]}
              />
            </>
          ) : (
            <>
              <DrillCardHeader title="Raio-X do mês" />
              <RaioXPanel overview={resumoCategoria} aging={aging} onSelectAtrasados={() => applyFilter({ type: 'atrasados', label: 'Atrasados' })} />
            </>
          )
        }
      />

      <div ref={tableRef}>
        <ExtratoTable
          rows={extrato.rows}
          todayStr={todayStr}
          segmento={segmento}
          activeFilter={activeFilter}
          atrasadosCount={extrato.atrasadosCount}
          cobradosIds={cobradosIds}
          filterBar={
            activeFilter ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>Filtrando por:</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--fin-primary-soft))] py-1 pl-3 pr-1.5 text-xs font-bold text-[hsl(var(--fin-primary))]">
                  {activeFilter.label}
                  <button
                    onClick={() => setActiveFilter(null)}
                    aria-label="Limpar filtro"
                    className="grid place-items-center w-4 h-4 rounded-full hover:bg-[hsl(var(--fin-primary)/0.15)]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            ) : undefined
          }
          onDarBaixa={setBaixaRow}
          onCobrar={handleCobrar}
          onVerDetalhe={setDetalheRow}
        />
      </div>

      <BaixaDialog row={baixaRow} transactions={transactions} bankAccounts={bankAccounts} onClose={() => setBaixaRow(null)} />
      <DetalheLancamentoModal row={detalheRow} onClose={() => setDetalheRow(null)} />
    </div>
  );
}
