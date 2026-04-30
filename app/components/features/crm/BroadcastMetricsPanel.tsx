'use client';

/**
 * BroadcastMetricsPanel — visualização das métricas agregadas de uma campanha.
 *
 * Componente puro: recebe `messages` (já trazidos de Firestore pelo parent
 * via onSnapshot) e calcula métricas client-side. Sem fetch próprio.
 *
 * Layout: barras de progresso (entrega/leitura/falha) + grid de tempos médios.
 *
 * Aparece com fundo neutro quando sem dados ainda — placeholder explicativo.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { CheckCheck, Clock, AlertTriangle, Eye } from 'lucide-react';
import type { BroadcastMessage } from '@/lib/types';
import {
  calculateBroadcastMetrics,
  formatDurationShort,
  formatRate,
} from '@/lib/utils/broadcastMetrics';

interface Props {
  messages: BroadcastMessage[];
  className?: string;
}

export default function BroadcastMetricsPanel({ messages, className }: Props) {
  const metrics = useMemo(() => calculateBroadcastMetrics(messages), [messages]);

  const hasData = metrics.total > 0;
  if (!hasData) {
    return (
      <div className={cn('rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-4 text-center', className)}>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          As métricas vão aparecer aqui quando a campanha começar a enviar.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/40 p-4 space-y-4', className)}>
      {/* Barras de taxas */}
      <div className="space-y-2.5">
        <RateBar
          icon={<CheckCheck size={13} />}
          label="Taxa de entrega"
          rate={metrics.deliveryRate}
          numerator={metrics.delivered}
          denominator={metrics.sent}
          denominatorLabel="enviadas"
          color="blue"
        />
        <RateBar
          icon={<Eye size={13} />}
          label="Taxa de leitura"
          rate={metrics.readRate}
          numerator={metrics.read}
          denominator={metrics.delivered}
          denominatorLabel="entregues"
          color="purple"
        />
        <RateBar
          icon={<AlertTriangle size={13} />}
          label="Taxa de falha"
          rate={metrics.failureRate}
          numerator={metrics.failed}
          denominator={metrics.sent + metrics.failed}
          denominatorLabel="processadas"
          color={metrics.failureRate && metrics.failureRate > 0.1 ? 'red' : 'gray'}
        />
      </div>

      {/* KPIs de tempos médios */}
      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
        <KPI
          icon={<Clock size={13} className="text-blue-500" />}
          label="Tempo até entrega"
          value={formatDurationShort(metrics.avgTimeToDeliveryMs)}
          hint={metrics.avgTimeToDeliveryMs === null ? 'sem dados' : 'média'}
        />
        <KPI
          icon={<Clock size={13} className="text-purple-500" />}
          label="Tempo até leitura"
          value={formatDurationShort(metrics.avgTimeToReadMs)}
          hint={metrics.avgTimeToReadMs === null ? 'sem dados' : 'média'}
        />
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

const COLOR_CFG = {
  blue: { bar: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-400' },
  purple: { bar: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-400' },
  red: { bar: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
  gray: { bar: 'bg-gray-400 dark:bg-gray-600', text: 'text-gray-600 dark:text-gray-400' },
};

function RateBar({
  icon, label, rate, numerator, denominator, denominatorLabel, color,
}: {
  icon: React.ReactNode;
  label: string;
  rate: number | null;
  numerator: number;
  denominator: number;
  denominatorLabel: string;
  color: keyof typeof COLOR_CFG;
}) {
  const cfg = COLOR_CFG[color];
  const pct = rate === null ? 0 : Math.max(0, Math.min(1, rate)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={cn('flex items-center gap-1.5 text-[11px] font-semibold', cfg.text)}>
          {icon}
          {label}
        </span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
          <span className={cn('font-bold', cfg.text)}>{formatRate(rate)}</span>
          <span className="ml-1">· {numerator}/{denominator} {denominatorLabel}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', cfg.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function KPI({ icon, label, value, hint }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-0.5">
        {icon}
        <span className="font-semibold">{label}</span>
      </div>
      <p className="text-base font-bold text-gray-900 dark:text-gray-100 tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}
