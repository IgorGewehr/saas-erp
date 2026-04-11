'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, DollarSign, Cloud, Shield, Bug, Database,
  MessageSquare, Users, Settings, Plug, ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { doc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { EnterpriseSettings, IntegrationConfig, IntegrationProvider } from '@/lib/types';
import type { User } from '@/lib/types';

// Lazy load tabs for code splitting
import OverviewTab from './tabs/OverviewTab';
import RevenueTab from './tabs/RevenueTab';
import CostsTab from './tabs/CostsTab';
import InfrastructureTab from './tabs/InfrastructureTab';
import MonitoringTab from './tabs/MonitoringTab';
import PlatformTab from './tabs/PlatformTab';
import CommunicationTab from './tabs/CommunicationTab';
import TeamTab from './tabs/TeamTab';

// ─── Tab Configuration ──────────────────────────────────────────────────────────

type EnterpriseTab = 'overview' | 'receita' | 'custos' | 'infra' | 'monitoramento' | 'plataforma' | 'comunicacao' | 'equipe';

const TAB_ICONS: { id: EnterpriseTab; icon: React.ElementType }[] = [
  { id: 'overview',       icon: LayoutDashboard },
  { id: 'receita',        icon: DollarSign      },
  { id: 'custos',         icon: Cloud           },
  { id: 'infra',          icon: Shield          },
  { id: 'monitoramento',  icon: Bug             },
  { id: 'plataforma',     icon: Database        },
  { id: 'comunicacao',    icon: MessageSquare   },
  { id: 'equipe',         icon: Users           },
];

// ─── Helper ──────────────────────────────────────────────────────────────────────

function getConfig(integrations: IntegrationConfig[], provider: IntegrationProvider): IntegrationConfig | null {
  return integrations.find(i => i.provider === provider && i.isActive) || null;
}

// ─── Main Module ─────────────────────────────────────────────────────────────────

export default function IntegrationsModule() {
  const { t } = useTranslation();
  const { user, business } = useAuth();
  const { setActivePage } = useAppContext();
  const [enterprise, setEnterprise] = useState<EnterpriseSettings | null>(null);
  const [activeTab, setActiveTab] = useState<EnterpriseTab>('overview');
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<User[]>([]);

  // Listen to enterprise settings
  useEffect(() => {
    if (!business?.id) return;
    const unsub = onSnapshot(doc(db, 'businesses', business.id), (snap) => {
      const data = snap.data();
      setEnterprise(data?.enterprise as EnterpriseSettings || null);
      setLoading(false);
    });
    return () => unsub();
  }, [business?.id]);

  // Listen to team members (real-time)
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'users'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      setMembers(snap.docs.map(d => ({ ...d.data(), id: d.id } as User)));
    });
    return () => unsub();
  }, [business?.id]);

  // Active integrations
  const integrations = useMemo(() => {
    return enterprise?.integrations?.filter(i => i.isActive) || [];
  }, [enterprise]);

  const connectedCount = integrations.length;

  // ─── Loading State ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <div className="h-10 w-64 rounded-xl shimmer" />
        <div className="h-12 w-full rounded-xl shimmer" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-[110px] rounded-2xl shimmer" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map(i => <div key={i} className="h-[220px] rounded-2xl shimmer" />)}
        </div>
      </motion.div>
    );
  }

  // ─── Enterprise Not Enabled ────────────────────────────────────────────────

  if (!enterprise?.isEnabled) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center min-h-[60vh]"
      >
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', bounce: 0.4 }}
          className="w-24 h-24 rounded-3xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-8 shadow-2xl shadow-violet-500/30"
        >
          <Plug className="w-12 h-12 text-white" />
        </motion.div>
        <h2 className="text-3xl font-bold font-display text-gray-900 dark:text-white mb-3">
          {t('integrations.enterpriseMode.title', 'Modo Enterprise')}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-center max-w-lg mb-8 leading-relaxed">
          {t('integrations.enterpriseMode.description', 'Gerencie receita, custos cloud, infraestrutura, monitoramento e equipe em um único lugar. Integre Stripe, AWS, Cloudflare, Sentry, Supabase, Vercel e mais.')}
        </p>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setActivePage('Configurações')}
          className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold hover:from-violet-600 hover:to-purple-600 transition-all shadow-lg shadow-violet-500/25 flex items-center gap-2.5"
        >
          <Settings className="w-4.5 h-4.5" />
          {t('integrations.enterpriseMode.activateButton', 'Ativar nas Configurações')}
          <ChevronRight className="w-4 h-4 opacity-60" />
        </motion.button>
      </motion.div>
    );
  }

  // ─── No Integrations Connected ─────────────────────────────────────────────

  if (connectedCount === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center min-h-[60vh]"
      >
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center mb-6">
          <Plug className="w-10 h-10 text-gray-400 dark:text-gray-500" />
        </div>
        <h2 className="text-2xl font-bold font-display text-gray-900 dark:text-white mb-2">
          {t('integrations.noIntegrations.title', 'Nenhuma Integração Ativa')}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-center max-w-md mb-6">
          {t('integrations.noIntegrations.description', 'Configure suas API keys para começar a visualizar dados de receita, custos com IA, deploys e atividade da equipe.')}
        </p>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setActivePage('Configurações')}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold hover:from-violet-600 hover:to-purple-600 transition-all shadow-lg shadow-violet-500/25 flex items-center gap-2"
        >
          <Settings className="w-4 h-4" />
          {t('integrations.noIntegrations.configureButton', 'Configurar Integrações')}
        </motion.button>
      </motion.div>
    );
  }

  // ─── Active Dashboard ──────────────────────────────────────────────────────

  const renderTab = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewTab integrations={integrations} members={members} onNavigate={(tab: string) => setActiveTab(tab as EnterpriseTab)} />;
      case 'receita':
        return <RevenueTab stripeConfig={getConfig(integrations, 'stripe')} members={members} />;
      case 'custos':
        return <CostsTab awsConfig={getConfig(integrations, 'aws')} />;
      case 'infra':
        return (
          <InfrastructureTab
            cloudflareConfig={getConfig(integrations, 'cloudflare')}
            vercelConfig={getConfig(integrations, 'vercel')}
            members={members}
          />
        );
      case 'monitoramento':
        return <MonitoringTab sentryConfig={getConfig(integrations, 'sentry')} />;
      case 'plataforma':
        return (
          <PlatformTab
            supabaseConfig={getConfig(integrations, 'supabase')}
            godaddyConfig={getConfig(integrations, 'godaddy')}
          />
        );
      case 'comunicacao':
        return <CommunicationTab resendConfig={getConfig(integrations, 'resend')} />;
      case 'equipe':
        return <TeamTab integrations={integrations} members={members} />;
      default:
        return null;
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display text-gray-900 dark:text-white flex items-center gap-2.5">
            {t('integrations.header.title', 'Integrações')}
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 text-white uppercase tracking-wider">
              {t('integrations.header.badge', 'Enterprise')}
            </span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('integrations.header.subtitle', '{{count}} integraç{{suffix}} ativa{{plural}} · {{online}} membros online', {
              count: connectedCount,
              suffix: connectedCount !== 1 ? 'ões' : 'ão',
              plural: connectedCount !== 1 ? 's' : '',
              online: members.filter(m => m.isOnline).length,
            })}
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setActivePage('Configurações')}
          className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-2 border border-gray-200 dark:border-gray-700"
        >
          <Settings className="w-4 h-4" />
          <span className="hidden sm:inline">{t('integrations.header.configure', 'Configurar')}</span>
        </motion.button>
      </div>

      {/* ─── Category Tabs ───────────────────────────────────────────────── */}
      <div className="relative">
        <div className="flex gap-1 p-1 bg-gray-100/80 dark:bg-gray-800/80 rounded-2xl overflow-x-auto no-scrollbar">
          {TAB_ICONS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all min-w-0"
              >
                {isActive && (
                  <motion.div
                    layoutId="enterprise-tab-pill"
                    className="absolute inset-0 bg-white dark:bg-gray-900 rounded-xl shadow-sm"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <span className={`relative flex items-center gap-2 ${
                  isActive
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}>
                  <Icon className="w-4 h-4" />
                  <span className="hidden md:inline">{t(`integrations.tabs.${tab.id}`, tab.id)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Tab Content ─────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
        >
          {renderTab()}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
