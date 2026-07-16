/**
 * aging-recebiveis.ts — read-model `AgingRecebiveis` (financial-v2/§2.3):
 * receitas em aberto atrasadas, em buckets de 0-15/15-30/+30 dias. FUNÇÃO PURA.
 *
 * Usado hoje só pelo tile "Atrasados há mais de 30 dias" do Raio-X de
 * Entradas & Saídas (o clique aplica o filtro "atrasados" na linha do tempo);
 * os 3 buckets ficam prontos pra Bancário/Relatórios reusarem sem cálculo novo.
 */

import type { Transaction } from '@/lib/types';
import { effectiveDueDate, isOpenCommitment } from './recurrence-projection';
import { startOfDay, toDateStr, daysBetween } from './date-utils';

export type AgingBucketKey = '0-15' | '15-30' | '30+';

export interface AgingBucket {
  key: AgingBucketKey;
  total: number;
  count: number;
}

export interface AgingRecebiveisOverview {
  buckets: Record<AgingBucketKey, AgingBucket>;
  totalAtrasado: number;
  over30Total: number;
  over30ClientCount: number;
}

function bucketFor(days: number): AgingBucketKey {
  if (days <= 15) return '0-15';
  if (days <= 30) return '15-30';
  return '30+';
}

export function computeAgingRecebiveis(transactions: Transaction[], now: Date = new Date()): AgingRecebiveisOverview {
  const todayStr = toDateStr(startOfDay(now));
  const buckets: Record<AgingBucketKey, AgingBucket> = {
    '0-15': { key: '0-15', total: 0, count: 0 },
    '15-30': { key: '15-30', total: 0, count: 0 },
    '30+': { key: '30+', total: 0, count: 0 },
  };
  const over30Clients = new Set<string>();
  let totalAtrasado = 0;

  for (const t of transactions) {
    if (t.type !== 'receita' || !isOpenCommitment(t)) continue;
    const due = effectiveDueDate(t);
    if (!due || due >= todayStr) continue;

    const days = daysBetween(due, todayStr);
    const key = bucketFor(days);
    buckets[key].total += t.amount;
    buckets[key].count += 1;
    totalAtrasado += t.amount;

    if (key === '30+') over30Clients.add(t.clientId ?? t.clientName ?? t.description);
  }

  return {
    buckets,
    totalAtrasado,
    over30Total: buckets['30+'].total,
    over30ClientCount: over30Clients.size,
  };
}
