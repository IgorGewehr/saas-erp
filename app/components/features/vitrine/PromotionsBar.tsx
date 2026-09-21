'use client';

import { Settings2, Tag } from 'lucide-react';
import { describePromotionTerms, describePromotionValue } from '@/lib/utils/promotionForm';
import type { BusinessPromotion } from '@/lib/types';

interface PromotionsBarProps {
  /** Só as vigentes (`getActivePromotions`) — é o que o vendedor pode oferecer agora. */
  promotions: BusinessPromotion[];
  /** admin+: cria, ativa/desativa e exclui. */
  canManage: boolean;
  onManage: () => void;
}

export function PromotionsBar({ promotions, canManage, onManage }: PromotionsBarProps) {
  if (promotions.length === 0 && !canManage) return null;

  return (
    <section
      aria-label="Promoções"
      className="mb-4 flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-3 py-2 dark:border-red-500/20 dark:bg-red-500/10"
    >
      <Tag className="h-5 w-5 flex-shrink-0 text-red-500" aria-hidden />

      {promotions.length > 0 ? (
        <ul className="flex min-w-0 flex-1 gap-2 overflow-x-auto scrollbar-hide">
          {promotions.map((promotion) => {
            const terms = describePromotionTerms(promotion);
            return (
              <li key={promotion.id} className="flex-shrink-0 rounded-xl bg-white px-3 py-1.5 shadow-sm dark:bg-gray-900">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{promotion.name}</p>
                <p className="text-xs text-red-600 dark:text-red-400">
                  {describePromotionValue(promotion)}
                  {terms && <span className="text-gray-500 dark:text-gray-400"> · {terms}</span>}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="min-w-0 flex-1 text-sm text-red-700 dark:text-red-300">Nenhuma promoção ativa.</p>
      )}

      {canManage && (
        <button
          type="button"
          onClick={onManage}
          className="flex h-11 flex-shrink-0 touch-manipulation items-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-red-600 shadow-sm active:bg-red-100 dark:bg-gray-900 dark:text-red-400 dark:active:bg-gray-800"
        >
          <Settings2 className="h-4 w-4" />
          {promotions.length > 0 ? 'Gerenciar' : 'Criar promoção'}
        </button>
      )}
    </section>
  );
}
