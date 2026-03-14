'use client';

import { Suspense, lazy } from 'react';
import { motion } from 'framer-motion';
import { useAppContext } from './AppContext';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Construction,
  HelpCircle,
} from 'lucide-react';

// Lazy-loaded modules
const DashboardModule = lazy(
  () => import('@/app/components/features/dashboard/DashboardModule')
);
const ClientsModule = lazy(
  () => import('@/app/components/features/clients/ClientsModule')
);
const AgendaModule = lazy(
  () => import('@/app/components/features/agenda/AgendaModule')
);
const PDVModule = lazy(
  () => import('@/app/components/features/pdv/PDVModule')
);
const FinancialModule = lazy(
  () => import('@/app/components/features/financial/FinancialModule')
);
const InventoryModule = lazy(
  () => import('@/app/components/features/inventory/InventoryModule')
);
const FiscalModule = lazy(
  () => import('@/app/components/features/fiscal/FiscalModule')
);
const SettingsPlaceholder = lazy(
  () => import('@/app/components/features/shared/SettingsPlaceholder')
);

// Loading fallback
function ModuleLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-10rem)]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
        <p className="text-sm text-gray-500">Carregando módulo...</p>
      </div>
    </div>
  );
}

// Help placeholder
function HelpPlaceholder() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-10rem)]">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        className="text-center max-w-md mx-auto px-6"
      >
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-red-50 to-red-100 mb-6 border border-red-200/50">
          <HelpCircle className="w-9 h-9 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 font-display mb-2">Central de Ajuda</h2>
        <p className="text-gray-500 text-sm leading-relaxed mb-6">
          Em breve você terá acesso a tutoriais, FAQ e suporte técnico diretamente por aqui.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium">
          <Construction className="w-4 h-4" />
          Em desenvolvimento
        </div>
      </motion.div>
    </div>
  );
}

export default function AppPage() {
  const { activePage } = useAppContext();

  const renderModule = () => {
    switch (activePage) {
      case 'Dashboard':
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <DashboardModule />
          </Suspense>
        );

      case 'Clientes':
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <ClientsModule />
          </Suspense>
        );

      case 'Agenda':
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <AgendaModule />
          </Suspense>
        );

      case 'PDV':
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <PDVModule />
          </Suspense>
        );

      case 'Financeiro':
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <FinancialModule />
          </Suspense>
        );

      case 'Estoque':
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <InventoryModule />
          </Suspense>
        );

      case 'NFSe':
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <FiscalModule type="nfse" />
          </Suspense>
        );

      case 'NFCe':
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <FiscalModule type="nfce" />
          </Suspense>
        );

      case 'NFe':
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <FiscalModule type="nfe" />
          </Suspense>
        );

      case 'Configurações':
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <SettingsPlaceholder />
          </Suspense>
        );

      case 'Ajuda':
        return <HelpPlaceholder />;

      default:
        return (
          <Suspense fallback={<ModuleLoadingFallback />}>
            <DashboardModule />
          </Suspense>
        );
    }
  };

  return (
    <div className={cn('p-4 sm:p-6 lg:p-8')}>
      {renderModule()}
    </div>
  );
}
