'use client';

/**
 * ContasAbertoCard — "Contas em aberto" (mockup `relatorios.html`): A
 * receber/A pagar em aberto (mesmo critério `isOpenCommitment` do resto do
 * módulo — plano §"nunca duplica a lógica") + aging da parte atrasada dos
 * recebíveis (0-15/15-30/+30d), reuso de `resumo-abertos.ts`/`aging-recebiveis.ts`.
 */

import { useMemo } from 'react';
import { Receipt } from 'lucide-react';
import type { Transaction } from '@/lib/types';
import { DocCard } from './DocCard';
import { DocActions } from './DocActions';
import { exportTransactionsCSV, exportTransactionsPDF } from '@/lib/utils/financial-export';
import { computeResumoAbertos } from '../../read-models/resumo-abertos';
import { computeAgingRecebiveis, type AgingBucketKey } from '../../read-models/aging-recebiveis';
import { isOpenCommitment } from '../../read-models/recurrence-projection';
import { formatCurrency } from '@/lib/utils/format';

interface ContasAbertoCardProps {
  transactions: Transaction[];
  businessName: string;
}

const BUCKET_COLOR: Record<AgingBucketKey, string> = {
  '0-15': 'hsl(var(--fin-warn)/0.55)',
  '15-30': 'hsl(var(--fin-warn))',
  '30+': 'hsl(var(--fin-crit))',
};
const BUCKET_LABEL: Record<AgingBucketKey, string> = { '0-15': '0–15d', '15-30': '15–30d', '30+': '+30d' };
const BUCKET_ORDER: AgingBucketKey[] = ['0-15', '15-30', '30+'];

export function ContasAbertoCard({ transactions, businessName }: ContasAbertoCardProps) {
  const resumo = useMemo(() => computeResumoAbertos(transactions), [transactions]);
  const aging = useMemo(() => computeAgingRecebiveis(transactions), [transactions]);

  const openTransactions = useMemo(
    () => transactions.filter(t => isOpenCommitment(t)).sort((a, b) => (a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1),
    [transactions],
  );

  return (
    <DocCard
      icon={Receipt}
      title="Contas em aberto"
      subtitle="A pagar e a receber, com prazo"
      footer={
        <DocActions
          onPdf={() => exportTransactionsPDF(openTransactions, businessName, 'Contas em aberto')}
          onExcel={() => exportTransactionsCSV(openTransactions, `contas_em_aberto_${new Date().toISOString().slice(0, 10)}.csv`)}
        />
      }
    >
      <div className="flex items-baseline justify-between gap-2 py-1.5">
        <span className="text-[13px] text-gray-500 dark:text-gray-400">A receber em aberto</span>
        <span className="text-right">
          <span className="fin-num text-[15px] font-bold text-gray-900 dark:text-gray-100">{formatCurrency(resumo.receber.total)}</span>
          {aging.totalAtrasado > 0 && (
            <span className="ml-1.5 text-[11.5px] font-semibold text-[hsl(var(--fin-crit))]">
              {formatCurrency(aging.totalAtrasado)} atrasado
            </span>
          )}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2 py-1.5">
        <span className="text-[13px] text-gray-500 dark:text-gray-400">A pagar em aberto</span>
        <span className="fin-num text-[15px] font-bold text-gray-900 dark:text-gray-100">{formatCurrency(resumo.pagar.total)}</span>
      </div>

      {aging.totalAtrasado > 0 && (
        <>
          <div className="flex h-2 rounded-full overflow-hidden mt-2.5 mb-2 bg-gray-100 dark:bg-gray-800">
            {BUCKET_ORDER.map(key => {
              const bucket = aging.buckets[key];
              const pct = (bucket.total / aging.totalAtrasado) * 100;
              if (pct <= 0) return null;
              return <span key={key} style={{ width: `${pct}%`, background: BUCKET_COLOR[key] }} />;
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-gray-500 dark:text-gray-400">
            {BUCKET_ORDER.map(key => (
              <span key={key} className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-[2px] inline-block" style={{ background: BUCKET_COLOR[key] }} />
                {BUCKET_LABEL[key]} {formatCurrency(aging.buckets[key].total)}
              </span>
            ))}
          </div>
        </>
      )}
    </DocCard>
  );
}
