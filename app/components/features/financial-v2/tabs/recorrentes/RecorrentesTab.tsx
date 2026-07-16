'use client';

/**
 * RecorrentesTab — segmented "Contas fixas ⇄ Assinaturas" (a joia do plano).
 * A lente Assinaturas só aparece quando o negócio tem receita recorrente de
 * verdade (ClientMembership, ou Project + transações recorrentes na vertical
 * software house) — mesmo mecanismo de visibilidade condicional da aba Fluxo
 * de Caixa no shell (plano §1.1).
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useFinClientMemberships, useFinProjects } from '../../hooks/useFinancialData';
import { resolveSubscriptionAxis } from '../../read-models/assinaturas-overview';
import { ContasFixasLens } from './ContasFixasLens';
import { AssinaturasLens } from './AssinaturasLens';

type Lens = 'fixas' | 'assinaturas';

export function RecorrentesTab() {
  const { business } = useAuth();
  const [lens, setLens] = useState<Lens>('fixas');
  const { data: clientMemberships = [] } = useFinClientMemberships();
  const { data: projects = [] } = useFinProjects();

  const axis = useMemo(
    () => resolveSubscriptionAxis(clientMemberships, projects, !!business?.settings?.projectsEnabled),
    [clientMemberships, projects, business?.settings?.projectsEnabled],
  );
  const hasAssinaturas = axis !== null;
  const activeLens: Lens = hasAssinaturas ? lens : 'fixas';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[11px] p-0.5 gap-0.5">
          <button
            onClick={() => setLens('fixas')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors',
              activeLens === 'fixas' ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400',
            )}
          >
            Contas fixas <span className="opacity-60 font-medium">· luz, aluguel, salários</span>
          </button>
          {hasAssinaturas && (
            <button
              onClick={() => setLens('assinaturas')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors',
                activeLens === 'assinaturas' ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400',
              )}
            >
              Assinaturas
            </button>
          )}
        </div>
        {hasAssinaturas && (
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            Visível porque este negócio {axis === 'project' ? 'organiza receita recorrente por projeto' : 'vende serviço recorrente'}
          </span>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeLens}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          {activeLens === 'fixas' ? <ContasFixasLens /> : <AssinaturasLens />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
