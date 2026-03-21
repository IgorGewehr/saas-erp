'use client';

import { Suspense, lazy } from 'react';
import { motion } from 'framer-motion';
import { useAppContext } from './AppContext';
import { cn } from '@/lib/utils';

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
const IntegrationsModule = lazy(() => import('@/app/components/features/integrations/IntegrationsModule'));

// ─── Full-height page loading fallback (Agenda, PDV, Kanban, Conversas) ───────
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
        <p className="text-[12.5px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">
          Carregando...
        </p>
      </motion.div>
    </div>
  );
}

// ─── Standard module loading fallback — animated content skeleton ─────────────
// Mirrors a typical module layout: header, KPI cards, main block, bottom row.
// Staggered entrance makes the skeleton feel alive and intentional.
function ModuleLoadingFallback() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="p-4 sm:p-6 lg:p-8 space-y-5"
    >
      {/* Page header */}
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

      {/* KPI / stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
            className="h-[100px] rounded-2xl shimmer"
          />
        ))}
      </div>

      {/* Main content block (table / chart) */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.24 }}
        className="h-72 rounded-2xl shimmer"
      />

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.32 + i * 0.07 }}
            className="h-48 rounded-2xl shimmer"
          />
        ))}
      </div>
    </motion.div>
  );
}

// ─── Full-height pages (use all vertical space, no padding wrapper) ───────────
const FULL_HEIGHT_PAGES = new Set(['Agenda', 'PDV', 'Kanban', 'Conversas', 'CRM']);

export default function AppPage() {
  const { activePage, sidebarCollapsed } = useAppContext();
  const isFullHeight = FULL_HEIGHT_PAGES.has(activePage);

  // Full-height pages (canvas UIs) get a centered spinner; standard pages get a content skeleton
  const fallback = isFullHeight ? <FullHeightFallback /> : <ModuleLoadingFallback />;

  const renderModule = () => {
    switch (activePage) {
      case 'Dashboard':    return <Suspense fallback={fallback}><DashboardModule /></Suspense>;
      case 'Clientes':     return <Suspense fallback={fallback}><ClientsModule /></Suspense>;
      case 'CRM':          return <Suspense fallback={fallback}><CRMModule /></Suspense>;
      case 'Agenda':       return <Suspense fallback={fallback}><AgendaModule /></Suspense>;
      case 'Conversas':    return <Suspense fallback={fallback}><ConversasModule /></Suspense>;
      case 'PDV':          return <Suspense fallback={fallback}><PDVModule /></Suspense>;
      case 'Kanban':       return <Suspense fallback={fallback}><KanbanModule /></Suspense>;
      case 'Financeiro':   return <Suspense fallback={fallback}><FinancialModule /></Suspense>;
      case 'Estoque':      return <Suspense fallback={fallback}><InventoryModule /></Suspense>;
      case 'NFSe':         return <Suspense fallback={fallback}><FiscalModule type="nfse" /></Suspense>;
      case 'NFCe':         return <Suspense fallback={fallback}><FiscalModule type="nfce" /></Suspense>;
      case 'NFe':          return <Suspense fallback={fallback}><FiscalModule type="nfe" /></Suspense>;
      case 'Integrações':   return <Suspense fallback={fallback}><IntegrationsModule /></Suspense>;
      case 'Configurações': return <Suspense fallback={fallback}><SettingsModule /></Suspense>;
      default:             return <Suspense fallback={fallback}><DashboardModule /></Suspense>;
    }
  };

  if (isFullHeight) {
    return <div className="h-full">{renderModule()}</div>;
  }

  return (
    <div className="p-4 sm:p-5 lg:p-7">
      {renderModule()}
    </div>
  );
}
