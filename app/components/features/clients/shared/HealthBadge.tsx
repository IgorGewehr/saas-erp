'use client';

/**
 * Badge compacto de saúde/risco de churn — usado no card da lista E no
 * detalhe do cliente. Renderiza vazio (null) se o cliente nunca teve scores
 * calculados, pra não poluir o layout com "?". Lê CHURN_CFG do shared/health.ts.
 */

import type { Client } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CHURN_CFG, getChurnLevel } from './health';

export function HealthBadge({ client }: { client: Client }) {
  const risk = client.scores?.churnRisk;
  if (risk == null) return null;
  const cfg = CHURN_CFG[getChurnLevel(risk)];
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium', cfg.bg, cfg.color)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
      {cfg.label}
    </span>
  );
}
