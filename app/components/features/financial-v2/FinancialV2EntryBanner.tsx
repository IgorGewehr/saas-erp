'use client';

/**
 * FinancialV2EntryBanner — a "entrada de navegação nova" pro financial-v2.
 *
 * Renderizado por `app/app/page.tsx` LOGO ACIMA do FinancialModule clássico
 * quando `business.settings.financialV2Enabled` ainda é false — nunca dentro
 * do arquivo clássico (que fica intocado). 1 clique grava o flag no doc do
 * negócio; o listener onSnapshot do AuthProvider já reflete a troca (o
 * `renderModule` de page.tsx passa a montar `FinancialV2Module` no próximo
 * render, sem reload de página).
 */

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { Sparkles, X } from 'lucide-react';

const DISMISS_KEY = 'fin2-entry-banner-dismissed';

export function FinancialV2EntryBanner() {
  const { business } = useAuth();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(DISMISS_KEY) === '1';
  });
  const [activating, setActivating] = useState(false);

  if (dismissed) return null;

  const activate = async () => {
    if (!business?.id || activating) return;
    setActivating(true);
    try {
      await updateDoc(doc(db, 'businesses', business.id), {
        'settings.financialV2Enabled': true,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setActivating(false);
    }
  };

  const dismiss = () => {
    window.sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="mx-4 sm:mx-5 lg:mx-7 mt-4 flex items-center justify-between gap-3 rounded-2xl border border-red-200/70 dark:border-red-900/40 bg-red-50/70 dark:bg-red-500/10 px-4 py-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex-none w-8 h-8 rounded-lg grid place-items-center bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400">
          <Sparkles className="w-4 h-4" />
        </div>
        <p className="text-[13px] text-gray-700 dark:text-gray-300 truncate">
          <span className="font-semibold text-gray-900 dark:text-gray-100">Novo Financeiro (beta)</span>
          {' — '}dataviz, drill e Super Consultor. Seus dados continuam os mesmos.
        </p>
      </div>
      <div className="flex-none flex items-center gap-2">
        <button
          onClick={activate}
          disabled={activating}
          className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors"
        >
          {activating ? 'Ativando…' : 'Experimentar'}
        </button>
        <button
          onClick={dismiss}
          aria-label="Dispensar"
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
