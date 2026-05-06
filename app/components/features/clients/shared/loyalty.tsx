'use client';

/**
 * Helpers e badge do programa de fidelidade.
 *
 * Compartilhados entre o card da lista (ClientsModule) e o detalhe
 * (ClientDetailPanel) — TierBadge aparece nos dois lugares pra mostrar
 * a tier do cliente em cada visualização. Mantém a lógica num só sítio.
 */

import { Trophy } from 'lucide-react';
import type { LoyaltyTier } from '@/lib/types';

/**
 * Resolve a tier mais alta que o cliente atinge dado o ponto atual.
 * Ordena por minPoints desc e retorna a primeira que cabe — `null` quando
 * o cliente ainda não atingiu nem a tier base (ou quando o programa não
 * tem tiers configuradas).
 */
export function getClientTier(points: number, tiers: LoyaltyTier[]): LoyaltyTier | null {
  const sorted = [...tiers].sort((a, b) => b.minPoints - a.minPoints);
  return sorted.find(t => points >= t.minPoints) ?? null;
}

export function TierBadge({ points, tiers }: { points: number; tiers: LoyaltyTier[] }) {
  const tier = getClientTier(points, tiers);
  if (!tier) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border"
      style={{ color: tier.color, backgroundColor: tier.color + '18', borderColor: tier.color + '50' }}
    >
      <Trophy className="w-2.5 h-2.5" />
      {tier.name}
    </span>
  );
}
