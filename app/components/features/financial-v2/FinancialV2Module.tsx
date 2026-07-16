'use client';

/**
 * FinancialV2Module — shell do financeiro v2 (Fase 0 do plano de transformação,
 * ver scratchpad/design/saas-erp-financeiro-plano.md). Header + 6 tabs +
 * seletor de mês (PeriodContext) + tab ativa + FAB "⊕ Lançar" global (Fase 3:
 * abre `LancarSheet` de qualquer aba, o lançamento sempre pousa na linha do
 * tempo de Entradas & Saídas). Aditivo: vive inteiramente em
 * `app/components/features/financial-v2/`, nada aqui importa ou modifica
 * `../financial/FinancialModule.tsx`.
 *
 * Montagem: `app/app/page.tsx` renderiza este módulo quando
 * `business.settings.financialV2Enabled === true` — ver `FinancialV2EntryBanner`
 * pro mecanismo de opt-in/opt-out (o "voltar ao clássico" fica aqui no header).
 */

import { useMemo, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { PeriodProvider } from './state/PeriodContext';
import { PeriodSwitcher } from './components/PeriodSwitcher';
import { PageHeader } from './components/PageHeader';
import { FinTabs, FIN2_TAB_IDS, type Fin2TabId } from './components/FinTabs';
import { LancarSheet } from './components/LancarSheet';
import { useFinBankAccounts } from './hooks/useFinancialData';
import { VisaoGeralTab } from './tabs/VisaoGeralTab';
import { EntradasSaidasTab } from './tabs/entradas-saidas/EntradasSaidasTab';
import { RecorrentesTab } from './tabs/recorrentes/RecorrentesTab';
import { BancarioTab } from './tabs/BancarioTab';
import { FluxoCaixaTab } from './tabs/FluxoCaixaTab';
import { RelatoriosTab } from './tabs/RelatoriosTab';
import './fin2.css';

const TAB_EYEBROW: Record<Fin2TabId, { eyebrow: string; title: string; subtitle: string }> = {
  'visao-geral': { eyebrow: 'Financeiro', title: 'Visão geral', subtitle: 'O que importa agora, sem planilha.' },
  'entradas-saidas': { eyebrow: 'Financeiro', title: 'Entradas & saídas', subtitle: 'O que entrou, o que saiu, o que vem por aí.' },
  'recorrentes': { eyebrow: 'Financeiro', title: 'Recorrentes', subtitle: 'O que se repete todo mês — contas fixas e assinaturas.' },
  'bancario': { eyebrow: 'Financeiro', title: 'Bancário', subtitle: 'Contas, saldos e conciliação.' },
  'fluxo-caixa': { eyebrow: 'Financeiro', title: 'Fluxo de caixa', subtitle: 'O dinheiro em espécie, dia a dia.' },
  'relatorios': { eyebrow: 'Financeiro', title: 'Relatórios', subtitle: 'DRE, exports e histórico.' },
};

function FinancialV2Content() {
  const { business } = useAuth();
  const [activeTab, setActiveTab] = useState<Fin2TabId>('visao-geral');
  const [lancarOpen, setLancarOpen] = useState(false);
  const { data: bankAccounts = [] } = useFinBankAccounts();

  const caixaAccounts = useMemo(
    () => bankAccounts.filter(a => a.isActive && a.accountType === 'caixa'),
    [bankAccounts],
  );

  const visibleTabs = useMemo(
    () => FIN2_TAB_IDS.filter(t => t !== 'fluxo-caixa' || caixaAccounts.length > 0),
    [caixaAccounts.length],
  );

  const handleNavigateToTab = useCallback((tab: string) => {
    if ((FIN2_TAB_IDS as readonly string[]).includes(tab)) setActiveTab(tab as Fin2TabId);
  }, []);

  const exitToClassic = useCallback(async () => {
    if (!business?.id) return;
    await updateDoc(doc(db, 'businesses', business.id), {
      'settings.financialV2Enabled': false,
      updatedAt: new Date().toISOString(),
    });
  }, [business?.id]);

  const meta = TAB_EYEBROW[activeTab];

  // Sem padding próprio de propósito: o roteador (app/app/page.tsx) já envolve
  // páginas não-full-height com `p-4 sm:p-5 lg:p-7` — dobrar aqui duplicaria
  // o respiro (mesma convenção do FinancialModule clássico).
  return (
    <div className="fin2 max-w-[1440px] mx-auto">
      <PageHeader
        eyebrow={meta.eyebrow}
        title={meta.title}
        subtitle={meta.subtitle}
        actions={
          <>
            <PeriodSwitcher />
            <button
              onClick={exitToClassic}
              className="text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 px-2.5 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Voltar para o Financeiro clássico"
            >
              ← Voltar ao clássico
            </button>
          </>
        }
      />

      <FinTabs active={activeTab} onChange={setActiveTab} visibleTabs={visibleTabs} />

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          {activeTab === 'visao-geral' && <VisaoGeralTab onNavigateToTab={handleNavigateToTab} />}
          {activeTab === 'entradas-saidas' && <EntradasSaidasTab />}
          {activeTab === 'recorrentes' && <RecorrentesTab />}
          {activeTab === 'bancario' && <BancarioTab />}
          {activeTab === 'fluxo-caixa' && <FluxoCaixaTab caixaAccounts={caixaAccounts} />}
          {activeTab === 'relatorios' && <RelatoriosTab />}
        </motion.div>
      </AnimatePresence>

      <button
        onClick={() => setLancarOpen(true)}
        aria-label="Lançar"
        title="Lançar"
        className="fixed right-6 bottom-6 z-40 w-[54px] h-[54px] rounded-full bg-[hsl(var(--fin-primary))] text-white grid place-items-center shadow-[0_8px_24px_hsl(var(--fin-primary)/0.45)] transition-transform hover:-translate-y-0.5 hover:brightness-[1.06]"
      >
        <Plus className="w-6 h-6" strokeWidth={2.4} />
      </button>
      <LancarSheet open={lancarOpen} onClose={() => setLancarOpen(false)} />
    </div>
  );
}

export default function FinancialV2Module() {
  return (
    <PeriodProvider>
      <FinancialV2Content />
    </PeriodProvider>
  );
}
