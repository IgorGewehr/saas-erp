'use client';

/**
 * Histórico de movimentações de pontos do programa de fidelidade.
 *
 * Lê últimos 30 docs de `loyaltyHistory` filtrando por cliente + business e
 * ordena client-side (evita exigência de índice composto Firestore). Mostra
 * apenas os 15 mais recentes pra não inflar o painel — operador que precisa
 * histórico completo terá uma visão dedicada futura.
 */

import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, limit as firestoreLimit } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { db } from '@/lib/config/firebase';
import { formatDate } from '@/lib/utils/format';
import type { LoyaltyHistoryEntry } from '@/lib/types';

const HISTORY_TYPE_CFG: Record<LoyaltyHistoryEntry['type'], { label: string; color: string }> = {
  add:      { label: '+', color: 'text-emerald-600 dark:text-emerald-400' },
  subtract: { label: '−', color: 'text-red-500 dark:text-red-400' },
  sale:     { label: '+', color: 'text-emerald-600 dark:text-emerald-400' },
  redeem:   { label: '−', color: 'text-amber-600 dark:text-amber-400' },
  expire:   { label: '−', color: 'text-gray-400' },
  manual:   { label: '±', color: 'text-blue-500 dark:text-blue-400' },
};

export function LoyaltyHistorySection({ clientId, businessId }: { clientId: string; businessId: string }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['loyalty-history', clientId],
    queryFn: async (): Promise<LoyaltyHistoryEntry[]> => {
      // No orderBy to avoid requiring a composite Firestore index — sort client-side
      const snap = await getDocs(query(
        collection(db, 'loyaltyHistory'),
        where('businessId', '==', businessId),
        where('clientId', '==', clientId),
        firestoreLimit(30),
      ));
      return snap.docs
        .map(d => ({ ...d.data(), id: d.id } as LoyaltyHistoryEntry))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 15);
    },
    enabled: !!clientId && !!businessId,
    staleTime: 60 * 1000,
  });

  if (isLoading) return <div className="h-8 shimmer rounded-lg" />;
  if (!history.length) return (
    <p className="text-xs text-gray-400 italic">Nenhuma movimentação ainda</p>
  );

  return (
    <div className="space-y-1.5 mt-2">
      {history.map(h => {
        const cfg = HISTORY_TYPE_CFG[h.type];
        return (
          <div key={h.id} className="flex items-center gap-2">
            <span className={cn('text-xs font-bold w-4 text-center flex-shrink-0', cfg.color)}>
              {cfg.label}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-gray-700 dark:text-gray-300 truncate">{h.reason}</p>
              <p className="text-[9px] text-gray-400">{formatDate(h.createdAt)}</p>
            </div>
            <span className={cn('text-xs font-semibold flex-shrink-0', cfg.color)}>
              {h.amount > 0 ? '+' : ''}{h.amount} pts
            </span>
          </div>
        );
      })}
    </div>
  );
}
