'use client';

/**
 * AssinaturasMrrCard — "Assinaturas / MRR" (mockup `relatorios.html`), a
 * versão-documento da joia do plano (`AssinaturasLens`, Recorrentes). Card
 * CONDICIONAL: só renderiza quando `computeAssinaturasOverview` acha eixo
 * (mesma regra de `RecorrentesTab`/`AssinaturasLens` — nunca duplica lógica
 * de visibilidade).
 */

import { TrendingUp } from 'lucide-react';
import { DocCard } from './DocCard';
import { DocActions } from './DocActions';
import { exportSubscriptionsCSV, exportSubscriptionsPDF, type SubscriptionExportRow } from '@/lib/utils/financial-export';
import type { AssinaturasOverview, SubscriptionRowStatus } from '../../read-models/assinaturas-overview';
import { formatCurrency } from '@/lib/utils/format';

interface AssinaturasMrrCardProps {
  overview: AssinaturasOverview;
  periodLabel: string;
  businessName: string;
}

const STATUS_LABEL: Record<SubscriptionRowStatus, string> = {
  ativa: 'Ativa',
  risco: 'Risco de churn',
  atraso: 'Atrasada',
  cancelada: 'Cancelada',
};

export function AssinaturasMrrCard({ overview, periodLabel, businessName }: AssinaturasMrrCardProps) {
  const exportRows: SubscriptionExportRow[] = overview.rows.map(r => ({
    serviceName: r.serviceName,
    clientLabel: r.clientLabel,
    monthlyValue: r.monthlyValue,
    cycleLabel: r.cycleLabel,
    nextBillingLabel: r.status === 'cancelada' ? undefined : r.nextBillingLabel,
    statusLabel: STATUS_LABEL[r.status],
  }));
  const summary = { mrr: overview.mrr, arr: overview.arr, churnMonthValue: overview.churnMonthValue };

  return (
    <DocCard
      icon={TrendingUp}
      title="Assinaturas / MRR"
      conditionNote={overview.axis === 'project' ? 'Visível porque organiza receita recorrente por projeto' : 'Visível porque vende serviço recorrente'}
      footer={
        <DocActions
          onPdf={() => exportSubscriptionsPDF(exportRows, summary, periodLabel, businessName)}
          onExcel={() => exportSubscriptionsCSV(exportRows, summary, periodLabel, businessName)}
        />
      }
    >
      <div className="flex items-baseline justify-between gap-2 py-1.5">
        <span className="text-[13px] text-gray-500 dark:text-gray-400">MRR</span>
        <span className="fin-num text-[17px] font-bold text-gray-900 dark:text-gray-100">{formatCurrency(overview.mrr)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 py-1.5">
        <span className="text-[13px] text-gray-500 dark:text-gray-400">Churn do mês</span>
        <span className="fin-num text-[13.5px] font-bold text-[hsl(var(--fin-crit))]">{formatCurrency(overview.churnMonthValue)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2 py-1.5">
        <span className="text-[13px] text-gray-500 dark:text-gray-400">ARR estimado</span>
        <span className="fin-num text-[13.5px] font-bold text-gray-900 dark:text-gray-100">{formatCurrency(overview.arr)}</span>
      </div>
    </DocCard>
  );
}
