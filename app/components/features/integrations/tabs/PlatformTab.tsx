'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Globe, Server, Database, Shield, Clock, RefreshCw,
  AlertTriangle, CheckCircle2, Activity, Layers,
  Lock, Unlock, ArrowUpRight, Calendar, MapPin,
  Pause, Play, ExternalLink,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IntegrationConfig } from '@/lib/types';
import KPICard from '../shared/KPICard';
import DemoDataBanner from '../shared/DemoDataBanner';
import IntegrationSkeleton from '../shared/IntegrationSkeleton';
import { formatNumber, timeAgo, getAuthHeaders } from '../shared/utils';

// ============================================
// TYPES
// ============================================
interface PlatformTabProps {
  supabaseConfig: IntegrationConfig | null;
  godaddyConfig: IntegrationConfig | null;
}

interface SupabaseProject {
  id: string;
  name: string;
  region: string;
  status: 'active' | 'paused' | 'inactive';
  createdAt: number;
  databaseSize?: string;
}

interface Domain {
  id: string;
  domain: string;
  status: 'active' | 'expired' | 'pending';
  expiresAt: number;
  autoRenew: boolean;
  privacy: boolean;
  registrar: string;
}

interface PlatformData {
  supabaseProjects: SupabaseProject[];
  healthyProjects: number;
  domains: Domain[];
  activeDomains: number;
  expiringIn30d: number;
}

// ============================================
// CONSTANTS
// ============================================
// Labels resolved at render time using t()
const PROJECT_STATUS_CONFIG: Record<string, { dot: string; bg: string; text: string; labelKey: string; icon: React.ElementType }> = {
  active: { dot: 'bg-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', labelKey: 'integrations.platform.projectActive', icon: Play },
  paused: { dot: 'bg-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', labelKey: 'integrations.platform.projectPaused', icon: Pause },
  inactive: { dot: 'bg-gray-400', bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400', labelKey: 'integrations.platform.projectInactive', icon: Pause },
};

const REGION_LABELS: Record<string, string> = {
  'us-east-1': 'US East (Virginia)',
  'us-west-1': 'US West (California)',
  'sa-east-1': 'South America (São Paulo)',
  'eu-west-1': 'EU West (Ireland)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
};

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

// ============================================
// HELPERS
// ============================================
function getDomainExpirationColor(expiresAt: number): { text: string; bg: string; dot: string } {
  const timeLeft = expiresAt - Date.now();
  if (timeLeft < 0) return { text: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', dot: 'bg-red-400' };
  if (timeLeft < THIRTY_DAYS) return { text: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', dot: 'bg-red-400' };
  if (timeLeft < NINETY_DAYS) return { text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', dot: 'bg-amber-400' };
  return { text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', dot: 'bg-emerald-400' };
}

function formatExpirationDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysUntil(timestamp: number): number {
  return Math.ceil((timestamp - Date.now()) / (24 * 60 * 60 * 1000));
}

// ============================================
// DEMO DATA
// ============================================
const DEMO_SUPABASE_PROJECTS: SupabaseProject[] = [
  { id: 'sp1', name: 'saas-erp-prod', region: 'sa-east-1', status: 'active', createdAt: Date.now() - 180 * 86_400_000, databaseSize: '2.4 GB' },
  { id: 'sp2', name: 'saas-erp-staging', region: 'sa-east-1', status: 'active', createdAt: Date.now() - 120 * 86_400_000, databaseSize: '890 MB' },
  { id: 'sp3', name: 'landing-analytics', region: 'us-east-1', status: 'paused', createdAt: Date.now() - 60 * 86_400_000, databaseSize: '156 MB' },
];

const DEMO_DOMAINS: Domain[] = [
  { id: 'd1', domain: 'servicepro.com.br', status: 'active', expiresAt: Date.now() + 245 * 86_400_000, autoRenew: true, privacy: true, registrar: 'GoDaddy' },
  { id: 'd2', domain: 'servicepro.io', status: 'active', expiresAt: Date.now() + 18 * 86_400_000, autoRenew: false, privacy: true, registrar: 'GoDaddy' },
  { id: 'd3', domain: 'api.servicepro.com.br', status: 'active', expiresAt: Date.now() + 245 * 86_400_000, autoRenew: true, privacy: true, registrar: 'GoDaddy' },
  { id: 'd4', domain: 'docs.servicepro.io', status: 'active', expiresAt: Date.now() + 72 * 86_400_000, autoRenew: true, privacy: false, registrar: 'GoDaddy' },
  { id: 'd5', domain: 'app.servicepro.com.br', status: 'active', expiresAt: Date.now() + 245 * 86_400_000, autoRenew: true, privacy: true, registrar: 'GoDaddy' },
  { id: 'd6', domain: 'staging.servicepro.io', status: 'active', expiresAt: Date.now() + 18 * 86_400_000, autoRenew: false, privacy: false, registrar: 'GoDaddy' },
];

const DEMO: PlatformData = {
  supabaseProjects: DEMO_SUPABASE_PROJECTS,
  healthyProjects: 2,
  domains: DEMO_DOMAINS,
  activeDomains: 6,
  expiringIn30d: 2,
};

// ============================================
// COMPONENT
// ============================================
export default function PlatformTab({ supabaseConfig, godaddyConfig }: PlatformTabProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<PlatformData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    let supabaseData: any = null;
    let godaddyData: any = null;

    // Fetch Supabase data
    if (supabaseConfig?.apiKey) {
      try {
        const res = await fetch('/api/integrations/supabase', {
          headers: { ...await getAuthHeaders(), 'x-api-key': supabaseConfig.apiKey },
        });
        if (res.ok) supabaseData = await res.json();
        else throw new Error('Supabase API error');
      } catch {
        // Will fall back to demo
      }
    }

    // Fetch GoDaddy data
    if (godaddyConfig?.apiKey) {
      try {
        const headers: Record<string, string> = {
          ...await getAuthHeaders(),
          'x-api-key': godaddyConfig.apiKey,
        };
        if (godaddyConfig.metadata?.apiSecret) {
          headers['x-api-secret'] = godaddyConfig.metadata.apiSecret as string;
        }

        const res = await fetch('/api/integrations/godaddy', { headers });
        if (res.ok) godaddyData = await res.json();
        else throw new Error('GoDaddy API error');
      } catch {
        // Will fall back to demo
      }
    }

    const usingDemo = !supabaseData && !godaddyData;
    if (usingDemo) {
      setError(t('integrations.platform.demoMessage', 'Usando dados de demonstração. Configure Supabase e GoDaddy nas configurações Enterprise.'));
    }

    // Parse Supabase projects
    const projects: SupabaseProject[] = (supabaseData?.projects || DEMO.supabaseProjects).map((p: any) => ({
      id: p.id,
      name: p.name,
      region: p.region || 'us-east-1',
      status: p.status === 'ACTIVE_HEALTHY' ? 'active' : p.status === 'INACTIVE' ? 'paused' : (p.status || 'active'),
      createdAt: p.createdAt ? new Date(p.createdAt).getTime() : Date.now(),
      databaseSize: p.databaseSize,
    }));

    const healthyCount = projects.filter(p => p.status === 'active').length;

    // Parse GoDaddy domains
    const domains: Domain[] = (godaddyData?.domains || DEMO.domains).map((d: any) => ({
      id: d.id || d.domain,
      domain: d.domain,
      status: d.status?.toLowerCase() === 'active' ? 'active' : d.status?.toLowerCase() === 'expired' ? 'expired' : (d.status || 'active'),
      expiresAt: d.expiresAt ? new Date(d.expiresAt).getTime() : (d.expires ? new Date(d.expires).getTime() : Date.now()),
      autoRenew: d.autoRenew ?? d.renewAuto ?? false,
      privacy: d.privacy ?? false,
      registrar: d.registrar || 'GoDaddy',
    }));

    const activeDomainCount = domains.filter(d => d.status === 'active').length;
    const expiringCount = domains.filter(d => {
      const timeLeft = d.expiresAt - Date.now();
      return timeLeft > 0 && timeLeft < THIRTY_DAYS;
    }).length;

    setData({
      supabaseProjects: projects,
      healthyProjects: healthyCount,
      domains,
      activeDomains: activeDomainCount,
      expiringIn30d: expiringCount,
    });

    setLoading(false);
    setRefreshing(false);
  }, [supabaseConfig, godaddyConfig]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <IntegrationSkeleton rows={3} />;
  if (!data) return null;

  const expirationAlerts = data.domains
    .filter(d => {
      const timeLeft = d.expiresAt - Date.now();
      return timeLeft > 0 && timeLeft < NINETY_DAYS;
    })
    .sort((a, b) => a.expiresAt - b.expiresAt);

  return (
    <div className="space-y-6">
      {/* Demo banner + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          {error && <DemoDataBanner message={error} />}
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="ml-3 p-2.5 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ========== 1. Platform KPIs ========== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title={t('integrations.kpi.supabaseProjects', 'Projetos Supabase')}
          value={data.supabaseProjects.length.toString()}
          icon={<Database className="w-4 h-4" />}
          color="emerald"
          delay={0}
        />
        <KPICard
          title={t('integrations.kpi.healthyProjects', 'Projetos Saudáveis')}
          value={`${data.healthyProjects}/${data.supabaseProjects.length}`}
          subtitle={data.healthyProjects === data.supabaseProjects.length
            ? t('integrations.kpi.allOperational', 'Todos operacionais')
            : t('integrations.kpi.withAlert', '{{count}} com alerta', { count: data.supabaseProjects.length - data.healthyProjects })}
          icon={<CheckCircle2 className="w-4 h-4" />}
          color="blue"
          delay={0.05}
        />
        <KPICard
          title={t('integrations.kpi.activeDomains', 'Domínios Ativos')}
          value={data.activeDomains.toString()}
          icon={<Globe className="w-4 h-4" />}
          color="violet"
          delay={0.1}
        />
        <KPICard
          title={t('integrations.kpi.expiringIn30d', 'Expirando em 30d')}
          value={data.expiringIn30d.toString()}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={data.expiringIn30d > 0 ? 'red' : 'gray'}
          delay={0.15}
          warning={data.expiringIn30d > 0}
        />
      </div>

      {/* ========== 2. Supabase Projects ========== */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="surface rounded-2xl p-5"
      >
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-500" />
          {t('integrations.platform.supabaseProjects', 'Projetos Supabase')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.supabaseProjects.map((project, i) => {
            const statusCfg = PROJECT_STATUS_CONFIG[project.status] || PROJECT_STATUS_CONFIG.active;
            const StatusIcon = statusCfg.icon;
            const regionLabel = REGION_LABELS[project.region] || project.region;
            return (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.06 }}
                className="p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-2.5 h-2.5 rounded-full ${statusCfg.dot}`} />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{project.name}</span>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md flex items-center gap-1 ${statusCfg.bg} ${statusCfg.text}`}>
                    <StatusIcon className="w-2.5 h-2.5" />
                    {t(statusCfg.labelKey, statusCfg.labelKey)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{regionLabel}</span>
                  </div>
                  {project.databaseSize && (
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                      <Server className="w-3 h-3 flex-shrink-0" />
                      <span>DB: {project.databaseSize}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <Calendar className="w-3 h-3 flex-shrink-0" />
                    <span>{t('integrations.platform.createdAgo', 'Criado {{time}}', { time: timeAgo(project.createdAt) })}</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* ========== 3. Domain Inventory ========== */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="surface rounded-2xl p-5"
      >
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Globe className="w-4 h-4 text-violet-500" />
          {t('integrations.platform.domainInventory', 'Inventário de Domínios')}
          <span className="text-[11px] font-normal text-gray-400 ml-auto">{t('integrations.platform.domains', '{{count}} domínio(s)', { count: data.domains.length })}</span>
        </h3>

        {/* Table header */}
        <div className="hidden sm:grid grid-cols-12 gap-3 px-3 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800 mb-1">
          <div className="col-span-4">{t('integrations.platform.domainColumn', 'Domínio')}</div>
          <div className="col-span-2">{t('integrations.platform.statusColumn', 'Status')}</div>
          <div className="col-span-3">{t('integrations.platform.expirationColumn', 'Expiração')}</div>
          <div className="col-span-1 text-center">{t('integrations.platform.renewColumn', 'Renov.')}</div>
          <div className="col-span-2 text-center">{t('integrations.platform.privacyColumn', 'Privacidade')}</div>
        </div>

        <div className="space-y-1">
          {data.domains.map((domain, i) => {
            const expColor = getDomainExpirationColor(domain.expiresAt);
            const days = daysUntil(domain.expiresAt);
            const isExpired = days < 0;

            return (
              <motion.div
                key={domain.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 + i * 0.04 }}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 items-center py-3 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                {/* Domain name */}
                <div className="sm:col-span-4 flex items-center gap-2.5 min-w-0">
                  <Globe className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{domain.domain}</span>
                </div>

                {/* Status */}
                <div className="sm:col-span-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                    domain.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                    domain.status === 'expired' ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400' :
                    'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  }`}>
                    {domain.status === 'active' ? t('integrations.platform.domainActive', 'Ativo') : domain.status === 'expired' ? t('integrations.platform.domainExpired', 'Expirado') : t('integrations.platform.domainPending', 'Pendente')}
                  </span>
                </div>

                {/* Expiration */}
                <div className="sm:col-span-3 flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${expColor.dot} flex-shrink-0`} />
                  <div className="min-w-0">
                    <span className={`text-xs font-medium ${expColor.text}`}>
                      {formatExpirationDate(domain.expiresAt)}
                    </span>
                    <span className="text-[10px] text-gray-400 ml-1.5">
                      {isExpired ? t('integrations.platform.expiredLabel', '(expirado)') : t('integrations.platform.daysLabel', '({{days}}d)', { days })}
                    </span>
                  </div>
                </div>

                {/* Auto-renew */}
                <div className="sm:col-span-1 flex justify-center">
                  {domain.autoRenew ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  )}
                </div>

                {/* Privacy */}
                <div className="sm:col-span-2 flex items-center justify-center gap-1.5">
                  {domain.privacy ? (
                    <>
                      <Lock className="w-3 h-3 text-emerald-500" />
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400">{t('integrations.platform.privacyActive', 'Ativa')}</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-3 h-3 text-amber-500" />
                      <span className="text-[11px] text-amber-600 dark:text-amber-400">{t('integrations.platform.privacyInactive', 'Inativa')}</span>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* ========== 4. Expiration Alerts ========== */}
      {expirationAlerts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="surface rounded-2xl p-5"
        >
          <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            {t('integrations.platform.expirationAlerts', 'Alertas de Expiração')}
            <span className="text-[11px] font-normal text-gray-400 ml-auto">{t('integrations.platform.next90days', 'próximos 90 dias')}</span>
          </h3>
          <div className="space-y-2.5">
            {expirationAlerts.map((domain, i) => {
              const days = daysUntil(domain.expiresAt);
              const isUrgent = days <= 30;
              const alertBg = isUrgent
                ? 'bg-red-50 dark:bg-red-500/10 border border-red-200/60 dark:border-red-500/20'
                : 'bg-amber-50 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/20';
              const alertText = isUrgent
                ? 'text-red-800 dark:text-red-300'
                : 'text-amber-800 dark:text-amber-300';
              const alertSub = isUrgent
                ? 'text-red-600 dark:text-red-400'
                : 'text-amber-600 dark:text-amber-400';
              const alertIcon = isUrgent
                ? 'text-red-600 dark:text-red-400'
                : 'text-amber-600 dark:text-amber-400';

              return (
                <motion.div
                  key={domain.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.45 + i * 0.06 }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl ${alertBg}`}
                >
                  <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${alertIcon}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${alertText}`}>
                      {domain.domain}
                    </p>
                    <p className={`text-xs mt-0.5 ${alertSub}`}>
                      {t('integrations.platform.expiresInDays', 'Expira em {{count}} dia(s)', { count: days })} — {formatExpirationDate(domain.expiresAt)}
                      {!domain.autoRenew && ` — ${t('integrations.platform.noAutoRenew', 'Renovação automática desativada')}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!domain.autoRenew && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                        isUrgent
                          ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300'
                          : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
                      }`}>
                        {t('integrations.platform.noAutoRenewBadge', 'Sem auto-renov.')}
                      </span>
                    )}
                    <span className={`text-lg font-bold tabular-nums ${
                      isUrgent ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'
                    }`}>
                      {days}d
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}
