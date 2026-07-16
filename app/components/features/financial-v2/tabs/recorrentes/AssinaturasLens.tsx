'use client';

/**
 * AssinaturasLens — a joia do plano: MRR/churn/concentração + o drill "MRR por
 * serviço" ⇄ "Novos × Churn + retenção daquele serviço", port fiel da
 * gramática do mockup aprovado (scratchpad/mockups/financeiro-assinaturas.html)
 * com dados reais (`ClientMembership`/`Membership`, ou `Project` na vertical
 * software house — ver `assinaturas-overview.ts`).
 */

import { useMemo } from 'react';
import { StatTile, StatTileGroup } from '../../components/StatTile';
import { ConsultorLine } from '../../components/ConsultorLine';
import { DrillPair, DrillCardHeader, useDrillState } from '../../components/DrillPair';
import { BarsIndex } from '../../components/BarsIndex';
import { StatTilesStack } from '../../components/StatTiles';
import { DivergingChart } from '../../components/charts/DivergingChart';
import { FinTable, type FinTableColumn } from '../../components/FinTable';
import { StatusChip, type StatusChipVariant } from '../../components/StatusChip';
import { subscriptionDotClass } from '../../components/subscriptionPalette';
import { useFinClientMemberships, useFinMemberships, useFinTransactions, useFinProjects } from '../../hooks/useFinancialData';
import { useConsultorInsight } from '../../hooks/useConsultorInsight';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { usePeriod } from '../../state/PeriodContext';
import { computeAssinaturasOverview, type SubscriptionTableRow, type SubscriptionRowStatus } from '../../read-models/assinaturas-overview';
import { pickAssinaturasInsight } from '../../read-models/consultor-rules';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils';

const ROW_STATUS_UI: Record<SubscriptionRowStatus, { label: (r: SubscriptionTableRow) => string; variant: StatusChipVariant }> = {
  ativa: { label: () => 'Ativa', variant: 'pos' },
  risco: { label: () => 'Risco de churn', variant: 'warn' },
  atraso: { label: r => `Atrasada ${r.overdueDays ?? 0}d`, variant: 'crit' },
  cancelada: { label: () => 'Cancelada', variant: 'neutral' },
};

export function AssinaturasLens() {
  const { business } = useAuth();
  const { period } = usePeriod();
  const { data: clientMemberships, isLoading: loadingCm } = useFinClientMemberships();
  const { data: memberships } = useFinMemberships();
  const { data: transactions } = useFinTransactions();
  const { data: projects } = useFinProjects();

  const overview = useMemo(() => computeAssinaturasOverview({
    clientMemberships: clientMemberships ?? [],
    memberships: memberships ?? [],
    transactions: transactions ?? [],
    projects: projects ?? [],
    projectsEnabled: !!business?.settings?.projectsEnabled,
    period,
  }), [clientMemberships, memberships, transactions, projects, business?.settings?.projectsEnabled, period]);

  const { selectedId, select } = useDrillState<string>();
  const insight = useMemo(
    () => overview ? pickAssinaturasInsight(overview) : null,
    [overview],
  );
  const consultor = useConsultorInsight(insight ?? { tab: 'assinaturas', ruleId: 'sem-dados', facts: { ativas: 0 }, templateFallback: 'Nenhuma assinatura ativa ainda.' });

  if (loadingCm && !overview) {
    return <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-8 text-center text-sm text-gray-400 dark:text-gray-500">Carregando assinaturas…</div>;
  }
  if (!overview) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">
        Nenhuma assinatura recorrente encontrada para este negócio ainda.
      </div>
    );
  }

  const selectedGroup = overview.groups.find(g => g.id === selectedId) ?? null;
  const barsItems = overview.groups.map(g => ({ id: g.id, label: g.name, value: g.mrr, pct: g.pctOfMrr, colorRank: g.colorRank }));

  const columns: FinTableColumn<SubscriptionTableRow>[] = [
    {
      key: 'service',
      header: 'Serviço',
      render: r => (
        <span className="inline-flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-200">
          <span className={cn('w-2 h-2 rounded-[3px] flex-none', subscriptionDotClass(r.colorRank))} />
          {r.serviceName}
        </span>
      ),
    },
    { key: 'client', header: 'Cliente', render: r => <span className="text-gray-500 dark:text-gray-400">{r.clientLabel}</span> },
    { key: 'value', header: 'Valor/mês', align: 'right', render: r => <span className="fin-num font-semibold text-gray-800 dark:text-gray-200">{formatCurrency(r.monthlyValue)}</span> },
    { key: 'cycle', header: 'Ciclo', render: r => <span>{r.cycleLabel}</span> },
    { key: 'next', header: 'Próx. cobrança', render: r => <span className="fin-num">{r.status === 'cancelada' ? '—' : formatDate(r.nextBillingLabel)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: r => {
        const ui = ROW_STATUS_UI[r.status];
        return <StatusChip label={ui.label(r)} variant={ui.variant} />;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <StatTileGroup>
        <StatTile
          hero
          label="MRR · receita recorrente"
          value={formatCurrency(overview.mrr)}
          delta={overview.mrrDeltaValue !== 0 ? {
            direction: overview.mrrDeltaValue >= 0 ? 'up' : 'down',
            text: `${overview.mrrDeltaValue >= 0 ? '+' : '−'}${formatCurrency(Math.abs(overview.mrrDeltaValue))} (${overview.mrrDeltaPct >= 0 ? '+' : '−'}${Math.abs(overview.mrrDeltaPct).toFixed(1)}%) no mês`,
          } : undefined}
          sparkValues={overview.mrrSparkline6m}
        />
        <StatTile
          label="Churn do mês"
          value={formatCurrency(overview.churnMonthValue)}
          delta={overview.churnMonthCount > 0 ? { direction: 'down', text: `${overview.churnMonthCount} cliente${overview.churnMonthCount > 1 ? 's' : ''} · ${overview.activeCount > 0 ? ((overview.churnMonthCount / (overview.activeCount + overview.churnMonthCount)) * 100).toFixed(1) : '0'}% da base` } : undefined}
          footnote={overview.churnMonthNames.join(' · ') || (overview.churnMonthCount === 0 ? 'nenhum cancelamento' : undefined)}
        />
        <StatTile
          label="Novos + expansão"
          value={`+${formatCurrency(overview.newMonthValue)}`}
          delta={overview.newMonthCount > 0 ? { direction: 'up', text: `${overview.newMonthCount} cliente${overview.newMonthCount > 1 ? 's' : ''} novo${overview.newMonthCount > 1 ? 's' : ''}` } : undefined}
          footnote={overview.newMonthNames.join(' · ') || (overview.newMonthCount === 0 ? 'nenhum novo este mês' : undefined)}
        />
        <StatTile
          label="Valor estimado · ARR"
          value={formatCurrency(overview.arr)}
          footnote={`${overview.activeCount} assinatura${overview.activeCount !== 1 ? 's' : ''} ativa${overview.activeCount !== 1 ? 's' : ''} · ticket médio ${formatCurrency(overview.avgTicket)}`}
        />
      </StatTileGroup>

      <ConsultorLine data={consultor} facts={insight?.facts ?? { ativas: overview.activeCount }} />

      <DrillPair
        drillKey={selectedId ?? 'overview'}
        left={
          selectedGroup ? (
            <>
              <DrillCardHeader title={selectedGroup.name} hint="Novos × Churn, 6 meses" onBack={() => select(null)} />
              <div className="px-1 pb-1">
                <DivergingChart
                  data={selectedGroup.monthly6m.map(m => ({ label: m.label, positive: m.novos, negative: m.churn }))}
                  formatValue={formatCurrency}
                  positiveLabel="Novos"
                  negativeLabel="Churn"
                />
              </div>
            </>
          ) : (
            <>
              <DrillCardHeader title="MRR por serviço" hint="clique num serviço p/ churn e retenção →" />
              <BarsIndex items={barsItems} formatValue={formatCurrency} onSelect={select} emptyMessage="Nenhum serviço com assinatura ativa ainda." />
            </>
          )
        }
        right={
          selectedGroup ? (
            <>
              <DrillCardHeader
                title={`${selectedGroup.name} · retenção`}
                hint={`${selectedGroup.activeCount} cliente${selectedGroup.activeCount !== 1 ? 's' : ''} · ${selectedGroup.churnedThisMonthCount} churn no mês`}
              />
              <StatTilesStack
                items={[
                  { key: 'tempo', label: 'Tempo médio de casa', value: String(selectedGroup.tempoMedioMeses), suffix: 'meses', footnote: 'antes de cancelar' },
                  { key: 'ltv', label: 'LTV médio estimado', value: formatCurrency(selectedGroup.ltv), footnote: 'ticket × tempo de vida' },
                  {
                    key: 'retencao',
                    label: 'Retenção em 12 meses',
                    value: selectedGroup.retencao12mPct !== null ? selectedGroup.retencao12mPct.toFixed(0) : '—',
                    suffix: selectedGroup.retencao12mPct !== null ? '%' : undefined,
                    footnote: selectedGroup.retencao12mPct !== null ? 'seguem ativos após 1 ano' : 'nenhum cliente com 12m de casa ainda',
                  },
                ]}
              />
            </>
          ) : (
            <>
              <DrillCardHeader title="Retenção da carteira" hint="quanto tempo o cliente fica" />
              <StatTilesStack
                items={[
                  { key: 'tempo', label: 'Tempo médio de casa', value: String(overview.portfolio.tempoMedioMeses), suffix: 'meses', footnote: 'antes de cancelar' },
                  { key: 'ltv', label: 'LTV médio estimado', value: formatCurrency(overview.portfolio.ltv), footnote: 'ticket × tempo de vida' },
                  {
                    key: 'retencao',
                    label: 'Retenção em 12 meses',
                    value: overview.portfolio.retencao12mPct !== null ? overview.portfolio.retencao12mPct.toFixed(0) : '—',
                    suffix: overview.portfolio.retencao12mPct !== null ? '%' : undefined,
                    footnote: overview.portfolio.retencao12mPct !== null ? 'seguem ativos após 1 ano' : 'nenhum cliente com 12m de casa ainda',
                  },
                ]}
              />
            </>
          )
        }
      />

      <FinTable
        title="Todas as assinaturas"
        hint={`${overview.activeCount} ativas · ${overview.cancelledThisMonthCount} cancelada${overview.cancelledThisMonthCount !== 1 ? 's' : ''} no mês`}
        columns={columns}
        rows={overview.rows}
        rowKey={r => r.id}
        isRowMuted={r => r.status === 'cancelada'}
        emptyMessage="Nenhuma assinatura cadastrada ainda."
      />
    </div>
  );
}
