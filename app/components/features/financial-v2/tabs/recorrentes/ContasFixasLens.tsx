'use client';

/**
 * ContasFixasLens — a lente "Contas fixas" de Recorrentes (luz, aluguel,
 * salários). KPIs de custo de existir + drill 12m via `recurrence.history[]`
 * (o degrau já vem gravado a cada pagamento, nenhum dado novo precisa existir
 * — plano §1.2/§2.3).
 */

import { useMemo } from 'react';
import { StatTile, StatTileGroup } from '../../components/StatTile';
import { ConsultorLine } from '../../components/ConsultorLine';
import { DrillPair, DrillCardHeader, useDrillState } from '../../components/DrillPair';
import { BarsIndex } from '../../components/BarsIndex';
import { StatTilesStack } from '../../components/StatTiles';
import { ColumnsChart } from '../../components/charts/ColumnsChart';
import { FinTable, type FinTableColumn } from '../../components/FinTable';
import { StatusChip } from '../../components/StatusChip';
import { useFinRecurringTransactions } from '../../hooks/useFinancialData';
import { useConsultorInsight } from '../../hooks/useConsultorInsight';
import { computeCompromissosFixos, type FixedCommitmentRow } from '../../read-models/compromissos-fixos';
import { pickContasFixasInsight } from '../../read-models/consultor-rules';
import { formatCurrency, formatDate } from '@/lib/utils/format';

export function ContasFixasLens() {
  const { data: recurring, isLoading } = useFinRecurringTransactions();
  const { selectedId, select } = useDrillState<string>();

  const overview = useMemo(() => computeCompromissosFixos(recurring), [recurring]);
  const insight = useMemo(() => pickContasFixasInsight(overview), [overview]);
  const consultor = useConsultorInsight(insight);
  const selected = overview.rows.find(r => r.id === selectedId) ?? null;

  const barsItems = overview.rows.map(r => ({
    id: r.id,
    label: r.label,
    value: r.monthlyAmount,
    pct: overview.custoDeExistir > 0 ? (r.monthlyAmount / overview.custoDeExistir) * 100 : 0,
    colorRank: r.isDegrau ? 0 : 1,
  }));

  const columns: FinTableColumn<FixedCommitmentRow>[] = [
    { key: 'label', header: 'Conta', render: r => <span className="font-medium text-gray-800 dark:text-gray-200">{r.label}</span> },
    { key: 'category', header: 'Categoria', render: r => <span className="text-gray-500 dark:text-gray-400">{r.category ?? '—'}</span> },
    { key: 'monthly', header: 'Valor mensal', align: 'right', render: r => <span className="fin-num font-semibold text-gray-800 dark:text-gray-200">{formatCurrency(r.monthlyAmount)}</span> },
    { key: 'next', header: 'Próx. vencimento', render: r => <span className="fin-num">{formatDate(r.nextDueDate)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: r => r.isDegrau
        ? <StatusChip label={`Degrau +${r.degrauPct.toFixed(0)}%`} variant="warn" />
        : <StatusChip label="Estável" variant="pos" />,
    },
  ];

  return (
    <div className="space-y-4">
      <StatTileGroup>
        <StatTile
          hero
          label="Custo de existir"
          value={isLoading ? '—' : formatCurrency(overview.custoDeExistir)}
          footnote="soma mensalizada das despesas recorrentes ativas"
        />
        <StatTile
          label="Peso sobre a receita"
          value={overview.pesoSobreReceitaPct !== null ? `${overview.pesoSobreReceitaPct.toFixed(0)}%` : '—'}
          footnote="fixas ÷ receita média 3m"
        />
        <StatTile label="R$ / dia útil" value={formatCurrency(overview.perDiaUtil)} footnote="considerando 21 dias úteis" />
        <StatTile
          label="Maior compromisso"
          value={overview.maiorCompromisso ? formatCurrency(overview.maiorCompromisso.monthlyAmount) : '—'}
          footnote={overview.maiorCompromisso?.label ?? 'nenhuma conta fixa cadastrada'}
        />
      </StatTileGroup>

      <ConsultorLine
        data={consultor}
        facts={insight.facts}
      />

      <DrillPair
        drillKey={selectedId ?? 'overview'}
        left={
          selected ? (
            <>
              <DrillCardHeader title={selected.label} hint="histórico 12m" onBack={() => select(null)} />
              <div className="px-1 pb-3">
                <ColumnsChart
                  data={selected.history.map((h, i) => ({
                    label: formatDate(h.paidDate).slice(0, 5),
                    value: h.amount,
                    highlight: i === selected.history.length - 1 && selected.isDegrau,
                  }))}
                  average={selected.avg12m}
                  formatValue={formatCurrency}
                />
              </div>
            </>
          ) : (
            <>
              <DrillCardHeader title="Contas fixas por valor" hint="clique numa conta →" />
              <BarsIndex items={barsItems} formatValue={formatCurrency} onSelect={select} emptyMessage="Nenhuma conta fixa recorrente ainda." />
            </>
          )
        }
        right={
          selected ? (
            <>
              <DrillCardHeader title={`${selected.label} · detalhe`} hint={selected.category ?? undefined} />
              <StatTilesStack
                items={[
                  { key: 'monthly', label: 'Valor mensal', value: formatCurrency(selected.monthlyAmount) },
                  { key: 'avg', label: 'Média 12 meses', value: formatCurrency(selected.avg12m) },
                  {
                    key: 'variacao',
                    label: 'Última vs média',
                    value: `${selected.degrauPct >= 0 ? '+' : ''}${selected.degrauPct.toFixed(0)}%`,
                    footnote: selected.isDegrau ? 'acima do limite de 15% — degrau' : 'dentro do esperado',
                  },
                ]}
              />
            </>
          ) : (
            <>
              <DrillCardHeader title="Diagnóstico" hint={`${overview.degrauRows.length} com degrau`} />
              <StatTilesStack
                items={[
                  { key: 'count', label: 'Contas fixas ativas', value: String(overview.count) },
                  { key: 'degrau', label: 'Com degrau (>15% da média)', value: String(overview.degrauRows.length), footnote: overview.degrauRows.map(r => r.label).slice(0, 2).join(' · ') || 'nenhuma' },
                  { key: 'peso', label: 'Peso sobre receita média', value: overview.pesoSobreReceitaPct !== null ? `${overview.pesoSobreReceitaPct.toFixed(0)}%` : '—' },
                ]}
              />
            </>
          )
        }
      />

      <FinTable
        title="Todas as contas fixas"
        hint={`${overview.count} ativas`}
        columns={columns}
        rows={overview.rows}
        rowKey={r => r.id}
        emptyMessage="Nenhuma conta fixa recorrente cadastrada ainda."
      />
    </div>
  );
}
