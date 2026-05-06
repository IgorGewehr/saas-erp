'use client';

/**
 * BroadcastMetricsPanel — visualização das métricas agregadas de uma campanha.
 *
 * Componente puro: recebe `messages` (já trazidos de Firestore pelo parent
 * via onSnapshot) e calcula métricas client-side. Sem fetch próprio.
 *
 * Layout compacto: 3 barras finas (entrega/leitura/falha) com label, % e
 * fração na mesma linha + linha inline com tempos médios. Sem dados ainda
 * → componente não renderiza nada (parent decide o placeholder).
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
  if (!hasData) return null;

  const hasTimes = metrics.avgTimeToDeliveryMs !== null || metrics.avgTimeToReadMs !== null;

  return (
    <div className={cn('space-y-1.5', className)}>
      <RateBar
        icon={<CheckCheck size={11} />}
        label="Entrega"
        rate={metrics.deliveryRate}
        numerator={metrics.delivered}
        denominator={metrics.sent}
        denominatorLabel="enviadas"
        color="blue"
      />
      <RateBar
        icon={<Eye size={11} />}
        label="Leitura"
        rate={metrics.readRate}
        numerator={metrics.read}
        denominator={metrics.delivered}
        denominatorLabel="entregues"
        color="purple"
      />
      <RateBar
        icon={<AlertTriangle size={11} />}
        label="Falha"
        rate={metrics.failureRate}
        numerator={metrics.failed}
        denominator={metrics.sent + metrics.failed}
        denominatorLabel="processadas"
        color={metrics.failureRate && metrics.failureRate > 0.1 ? 'red' : 'gray'}
      />
      {/* Tempos médios — linha inline ao invés de cards grandes. Só renderiza
          quando há ao menos uma amostra (webhook delivered/read pingou). */}
      {hasTimes && (
        <div className="flex items-center gap-3 pt-1 text-[10px] text-gray-500 dark:text-gray-400">
          {metrics.avgTimeToDeliveryMs !== null && (
            <span className="inline-flex items-center gap-1">
              <Clock size={10} className="text-blue-500" />
              Tempo até entrega: <strong className="text-gray-700 dark:text-gray-200 tabular-nums">{formatDurationShort(metrics.avgTimeToDeliveryMs)}</strong>
            </span>
          )}
          {metrics.avgTimeToReadMs !== null && (
            <span className="inline-flex items-center gap-1">
              <Clock size={10} className="text-purple-500" />
              até leitura: <strong className="text-gray-700 dark:text-gray-200 tabular-nums">{formatDurationShort(metrics.avgTimeToReadMs)}</strong>
            </span>
          )}
        </div>
      )}
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
    <div className="flex items-center gap-2">
      <span className={cn('flex items-center gap-1 text-[10px] font-semibold w-14 flex-shrink-0', cfg.text)}>
        {icon}
        {label}
      </span>
      <div className="h-1 flex-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', cfg.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums flex-shrink-0">
        <span className={cn('font-bold', cfg.text)}>{formatRate(rate)}</span>
        <span className="ml-1">· {numerator}/{denominator} {denominatorLabel}</span>
      </span>
    </div>
  );
}
