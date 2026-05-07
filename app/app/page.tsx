'use client';

import { Suspense, lazy, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTabContext } from '@/app/components/layout/TabContext';
import type { MenuPage } from '@/app/components/layout/Sidebar';

// Lazy-loaded modules
const DashboardModule  = lazy(() => import('@/app/components/features/dashboard/DashboardModule'));
const ClientsModule    = lazy(() => import('@/app/components/features/clients/ClientsModule'));
const AgendaModule     = lazy(() => import('@/app/components/features/agenda/AgendaModule'));
const PDVModule        = lazy(() => import('@/app/components/features/pdv/PDVModule'));
const FinancialModule  = lazy(() => import('@/app/components/features/financial/FinancialModule'));
const InventoryModule  = lazy(() => import('@/app/components/features/inventory/InventoryModule'));
const FiscalModule     = lazy(() => import('@/app/components/features/fiscal/FiscalModule'));
const KanbanModule     = lazy(() => import('@/app/components/features/kanban/KanbanModule'));
const CRMModule        = lazy(() => import('@/app/components/features/crm/CRMModule'));
const SettingsModule   = lazy(() => import('@/app/components/features/settings/SettingsModule'));
const ConversasModule  = lazy(() => import('@/app/components/features/conversations/ConversasModule'));
const VendasModule     = lazy(() => import('@/app/components/features/sales/VendasModule'));
const ComprasModule    = lazy(() => import('@/app/components/features/purchases/ComprasModule'));
const OrdersModule     = lazy(() => import('@/app/components/features/orders/OrdersModule'));
const CardapioModule   = lazy(() => import('@/app/components/features/cardapio/CardapioModule'));
const ReportsModule    = lazy(() => import('@/app/components/features/reports/ReportsModule'));
const SenhasModule     = lazy(() => import('@/app/components/features/senhas/SenhasModule'));
const NotasModule      = lazy(() => import('@/app/components/features/notas/NotasModule'));
const SpreadsheetsModule = lazy(() => import('@/app/components/features/spreadsheets/SpreadsheetsModule'));

// Full-height pages — fill the viewport, no outer scroll (each manages its own scroll internally)
const FULL_HEIGHT_PAGES = new Set<MenuPage>(['Dashboard', 'Agenda', 'PDV', 'Kanban', 'Conversas', 'CRM', 'Pedidos', 'Planilhas']);

// ─── Full-height loading fallback ─────────────────────────────────────────────
function FullHeightFallback() {
  return (
    <div className="flex h-full min-h-[calc(100vh-10rem)] items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-3"
      >
        <div className="relative w-11 h-11">
          <div className="absolute inset-0 rounded-full border-2 border-red-100 dark:border-red-900/30" />
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-red-500"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.85, repeat: Infinity, ease: 'linear' }}
          />
          <div className="absolute inset-[5px] rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
            <motion.div
              className="w-2.5 h-2.5 rounded-full bg-red-400"
              animate={{ scale: [1, 1.35, 1], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </div>
        <p className="text-[12.5px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">Carregando...</p>
      </motion.div>
    </div>
  );
}

// ─── Standard loading skeleton ────────────────────────────────────────────────
function ModuleLoadingFallback() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="p-4 sm:p-6 lg:p-8 space-y-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-52 rounded-xl shimmer" />
          <div className="h-4 w-36 rounded-lg shimmer" />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="h-9 w-24 rounded-xl shimmer" />
          <div className="h-9 w-36 rounded-xl shimmer" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0,1,2,3].map(i => (
          <motion.div key={i} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.28, delay:i*0.07, ease:[0.22,1,0.36,1] }} className="h-[100px] rounded-2xl shimmer" />
        ))}
      </div>
      <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.3, delay:0.24 }} className="h-72 rounded-2xl shimmer" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0,1].map(i => (
          <motion.div key={i} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.28, delay:0.32+i*0.07 }} className="h-48 rounded-2xl shimmer" />
        ))}
      </div>
    </motion.div>
  );
}

// ─── Render a single module ───────────────────────────────────────────────────
function renderModule(page: MenuPage) {
  const isFullHeight = FULL_HEIGHT_PAGES.has(page);
  const fallback = isFullHeight ? <FullHeightFallback /> : <ModuleLoadingFallback />;

  const inner = (() => {
    switch (page) {
      case 'Dashboard':    return <Suspense fallback={fallback}><DashboardModule /></Suspense>;
      case 'Clientes':     return <Suspense fallback={fallback}><ClientsModule /></Suspense>;
      case 'CRM':          return <Suspense fallback={fallback}><CRMModule /></Suspense>;
      case 'Agenda':       return <Suspense fallback={fallback}><AgendaModule /></Suspense>;
      case 'Conversas':    return <Suspense fallback={fallback}><ConversasModule /></Suspense>;
      case 'PDV':          return <Suspense fallback={fallback}><PDVModule /></Suspense>;
      case 'Vendas':       return <Suspense fallback={fallback}><VendasModule /></Suspense>;
      case 'Compras':      return <Suspense fallback={fallback}><ComprasModule /></Suspense>;
      case 'Kanban':       return <Suspense fallback={fallback}><KanbanModule /></Suspense>;
      case 'Financeiro':   return <Suspense fallback={fallback}><FinancialModule /></Suspense>;
      case 'Estoque':      return <Suspense fallback={fallback}><InventoryModule /></Suspense>;
      case 'Pedidos':      return <Suspense fallback={fallback}><OrdersModule /></Suspense>;
      case 'Cardápio':     return <Suspense fallback={fallback}><CardapioModule /></Suspense>;
      case 'NFSe':         return <Suspense fallback={fallback}><FiscalModule type="nfse" /></Suspense>;
      case 'NFCe':         return <Suspense fallback={fallback}><FiscalModule type="nfce" /></Suspense>;
      case 'NFe':          return <Suspense fallback={fallback}><FiscalModule type="nfe" /></Suspense>;
      case 'Relatórios':   return <Suspense fallback={fallback}><ReportsModule /></Suspense>;
      case 'Senhas':       return <Suspense fallback={fallback}><SenhasModule /></Suspense>;
      case 'Planilhas':    return <Suspense fallback={fallback}><SpreadsheetsModule /></Suspense>;
      case 'Notas':        return <Suspense fallback={fallback}><NotasModule /></Suspense>;
      case 'Configurações':return <Suspense fallback={fallback}><SettingsModule /></Suspense>;
      default:             return <Suspense fallback={fallback}><DashboardModule /></Suspense>;
    }
  })();

  if (isFullHeight) return <div className="h-full">{inner}</div>;
  return <div className="p-4 sm:p-5 lg:p-7">{inner}</div>;
}

// ─── Multi-tab content area ───────────────────────────────────────────────────
// Renders all open tabs simultaneously. Inactive tabs are kept mounted (state
// preserved) but hidden via opacity + pointer-events, so switching tabs is
// instant and scroll positions / form state are not lost.
export default function AppPage() {
  const { tabs, activeTabId } = useTabContext();
  const [mountedTabs, setMountedTabs] = useState<Set<MenuPage>>(() => new Set());

  // Lazily mount: only render a tab when it first becomes active
  useEffect(() => {
    if (!activeTabId) return;
    setMountedTabs(prev => {
      if (prev.has(activeTabId as MenuPage)) return prev;
      const next = new Set(prev);
      next.add(activeTabId as MenuPage);
      return next;
    });
  }, [activeTabId]);

  return (
    <div className="relative h-full overflow-hidden">
      {tabs.map(tab => {
        if (!mountedTabs.has(tab.id)) return null;
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={cn(
              'absolute inset-0 will-change-transform',
              FULL_HEIGHT_PAGES.has(tab.id) ? 'overflow-hidden' : 'overflow-y-auto',
              isActive
                ? 'z-10 opacity-100 pointer-events-auto'
                : 'z-0 opacity-0 pointer-events-none'
            )}
            style={{ transition: 'opacity 0.18s ease' }}
          >
            {renderModule(tab.id)}
          </div>
        );
      })}
    </div>
  );
}
