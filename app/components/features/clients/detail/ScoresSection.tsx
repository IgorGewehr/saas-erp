'use client';

/**
 * Painel de scores do cliente — exibido na aba "Perfil" do detalhe.
 *
 * Renderiza o overall (gauge circular) + 4 barras horizontais (fidelidade,
 * valor, engajamento, churn). Vazio quando o cliente nunca teve scores
 * calculados (`lastCalculatedAt == null`) — não polui o layout com placeholders.
 */

import { motion } from 'framer-motion';
import type { Client } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CHURN_CFG, getChurnLevel } from '../shared/health';

export function ScoresSection({ client }: { client: Client }) {
  const scores = client.scores;
  if (!scores || scores.lastCalculatedAt == null) return null;

  const bars = [
    { label: 'Fidelidade',   value: scores.loyalty ?? 0,    color: 'bg-purple-500' },
    { label: 'Valor',        value: scores.value ?? 0,      color: 'bg-blue-500' },
    { label: 'Engajamento',  value: scores.engagement ?? 0, color: 'bg-sky-500' },
    { label: 'Risco de churn', value: scores.churnRisk ?? 0, color: CHURN_CFG[getChurnLevel(scores.churnRisk ?? 0)].bar, invert: true },
  ];

  const overall = scores.overall ?? 0;
  const churnLvl = getChurnLevel(scores.churnRisk ?? 0);
  const churnCfg = CHURN_CFG[churnLvl];

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Saúde do cliente</p>

      {/* Overall gauge */}
      <div className="flex items-center gap-3">
        <div className="relative w-14 h-14 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="3.5"
              className="text-gray-100 dark:text-gray-800" />
            <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3.5"
              strokeDasharray={`${overall * 0.879} 87.9`}
              strokeLinecap="round"
              className={cn('transition-all duration-700', overall >= 60 ? 'text-emerald-500' : overall >= 40 ? 'text-amber-500' : 'text-red-500')}
              stroke="currentColor" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900 dark:text-white rotate-0">
            {overall}
          </span>
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Score geral: {overall}/100</p>
          <span className={cn('inline-flex items-center gap-1 text-xs font-medium mt-0.5', churnCfg.color)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', churnCfg.dot)} />
            {churnCfg.label}
          </span>
        </div>
      </div>

      {/* Individual bars */}
      <div className="space-y-2">
        {bars.map(b => (
          <div key={b.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-gray-500 dark:text-gray-400">{b.label}</span>
              <span className={cn('text-[10px] font-semibold', b.invert && b.value >= 60 ? 'text-red-500' : 'text-gray-600 dark:text-gray-300')}>
                {b.value}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <motion.div
                className={cn('h-full rounded-full', b.color)}
                initial={{ width: 0 }}
                animate={{ width: `${b.value}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
