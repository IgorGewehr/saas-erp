'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Bug, AlertTriangle, AlertCircle, CheckCircle2, Info,
  Activity, RefreshCw, Eye, Clock, Shield,
  BarChart3, ArrowUpRight, Layers, Smartphone,
  Globe, FileCode, Server,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IntegrationConfig } from '@/lib/types';
import KPICard from '../shared/KPICard';
import DemoDataBanner from '../shared/DemoDataBanner';
import IntegrationSkeleton from '../shared/IntegrationSkeleton';
import { formatNumber, timeAgo, timeAgoShort, getAuthHeaders } from '../shared/utils';

// ============================================
// TYPES
// ============================================
interface MonitoringTabProps {
  sentryConfig: IntegrationConfig | null;
}

interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  level: 'error' | 'warning' | 'info';
  count: number;
  firstSeen: number;
  lastSeen: number;
  project: string;
}

interface SentryProject {
  id: string;
  name: string;
  platform: string;
  eventCount: number;
  health: 'healthy' | 'warning' | 'critical';
  lastEvent: number;
}

interface EventOutcome {
  label: string;
  value: number;
  color: string;
  bg: string;
  text: string;
}

interface MonitoringData {
  errors24h: number;
  errorsChange: number;
  unresolvedIssues: number;
  projectCount: number;
  eventsAccepted30d: number;
  issues: SentryIssue[];
  projects: SentryProject[];
  outcomes: EventOutcome[];
}

// ============================================
// CONSTANTS
// ============================================
const LEVEL_CONFIG: Record<string, { dot: string; bg: string; text: string; label: string; icon: React.ElementType }> = {
  error: { dot: 'bg-red-400', bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-400', label: 'Erro', icon: AlertCircle },
  warning: { dot: 'bg-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', label: 'Warning', icon: AlertTriangle },
  info: { dot: 'bg-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', label: 'Info', icon: Info },
};

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  'javascript-nextjs': Globe,
  'node': Server,
  'react-native': Smartphone,
  'python': FileCode,
  'go': FileCode,
};

// Health labels are resolved dynamically using t() at render time via getHealthLabel()
const HEALTH_CONFIG: Record<string, { dot: string; labelKey: string }> = {
  healthy: { dot: 'bg-emerald-400', labelKey: 'integrations.monitoring.healthy' },
  warning: { dot: 'bg-amber-400', labelKey: 'integrations.monitoring.warning' },
  critical: { dot: 'bg-red-400', labelKey: 'integrations.monitoring.critical' },
};

// ============================================
// DEMO DATA
// ============================================
const DEMO_ISSUES: SentryIssue[] = [
  { id: 'i1', title: 'TypeError: Cannot read properties of undefined (reading \'map\')', culprit: 'DashboardModule.tsx', level: 'error', count: 47, firstSeen: Date.now() - 172_800_000, lastSeen: Date.now() - 1_200_000, project: 'saas-erp' },
  { id: 'i2', title: 'ChunkLoadError: Loading chunk 14 failed', culprit: 'app/page.tsx', level: 'error', count: 23, firstSeen: Date.now() - 86_400_000, lastSeen: Date.now() - 3_600_000, project: 'saas-erp' },
  { id: 'i3', title: 'FirebaseError: Missing or insufficient permissions', culprit: 'AuthProvider.tsx', level: 'error', count: 18, firstSeen: Date.now() - 604_800_000, lastSeen: Date.now() - 7_200_000, project: 'saas-erp' },
  { id: 'i4', title: 'Warning: Each child in a list should have a unique key prop', culprit: 'KanbanColumn.tsx', level: 'warning', count: 156, firstSeen: Date.now() - 2_592_000_000, lastSeen: Date.now() - 900_000, project: 'saas-erp' },
  { id: 'i5', title: 'RateLimitError: Too many requests', culprit: 'middleware.ts', level: 'error', count: 12, firstSeen: Date.now() - 259_200_000, lastSeen: Date.now() - 14_400_000, project: 'api-gateway' },
  { id: 'i6', title: 'ResizeObserver loop completed with undelivered notifications', culprit: 'Sidebar.tsx', level: 'warning', count: 89, firstSeen: Date.now() - 1_209_600_000, lastSeen: Date.now() - 600_000, project: 'saas-erp' },
  { id: 'i7', title: 'Hydration failed because the initial UI does not match', culprit: 'layout.tsx', level: 'warning', count: 34, firstSeen: Date.now() - 432_000_000, lastSeen: Date.now() - 28_800_000, project: 'landing-page' },
  { id: 'i8', title: 'Image optimization is not available', culprit: 'HeroSection.tsx', level: 'info', count: 5, firstSeen: Date.now() - 86_400_000, lastSeen: Date.now() - 43_200_000, project: 'landing-page' },
  { id: 'i9', title: 'Unhandled promise rejection in notification worker', culprit: 'push-worker.js', level: 'error', count: 8, firstSeen: Date.now() - 172_800_000, lastSeen: Date.now() - 86_400_000, project: 'mobile-app' },
  { id: 'i10', title: 'DNS resolution failed for api.servicepro.com.br', culprit: 'healthcheck.ts', level: 'info', count: 3, firstSeen: Date.now() - 43_200_000, lastSeen: Date.now() - 21_600_000, project: 'docs' },
  { id: 'i11', title: 'CORS policy blocked request from unknown origin', culprit: 'cors.ts', level: 'warning', count: 27, firstSeen: Date.now() - 345_600_000, lastSeen: Date.now() - 1_800_000, project: 'api-gateway' },
  { id: 'i12', title: 'AbortError: The user aborted a request', culprit: 'fetchClient.ts', level: 'info', count: 64, firstSeen: Date.now() - 2_592_000_000, lastSeen: Date.now() - 300_000, project: 'saas-erp' },
  { id: 'i13', title: 'Timeout: Firebase Auth token refresh exceeded 10s', culprit: 'AuthProvider.tsx', level: 'error', count: 6, firstSeen: Date.now() - 518_400_000, lastSeen: Date.now() - 172_800_000, project: 'saas-erp' },
  { id: 'i14', title: 'WebSocket connection to wss://realtime.supabase.co failed', culprit: 'realtimeClient.ts', level: 'warning', count: 11, firstSeen: Date.now() - 129_600_000, lastSeen: Date.now() - 57_600_000, project: 'saas-erp' },
  { id: 'i15', title: 'NotFoundError: Document not found in collection users', culprit: 'firebaseService.ts', level: 'info', count: 19, firstSeen: Date.now() - 864_000_000, lastSeen: Date.now() - 5_400_000, project: 'saas-erp' },
];

const DEMO_PROJECTS: SentryProject[] = [
  { id: 'p1', name: 'saas-erp', platform: 'javascript-nextjs', eventCount: 8_420, health: 'warning', lastEvent: Date.now() - 300_000 },
  { id: 'p2', name: 'api-gateway', platform: 'go', eventCount: 2_340, health: 'healthy', lastEvent: Date.now() - 1_800_000 },
  { id: 'p3', name: 'landing-page', platform: 'javascript-nextjs', eventCount: 890, health: 'healthy', lastEvent: Date.now() - 28_800_000 },
  { id: 'p4', name: 'mobile-app', platform: 'react-native', eventCount: 560, health: 'critical', lastEvent: Date.now() - 86_400_000 },
  { id: 'p5', name: 'docs', platform: 'javascript-nextjs', eventCount: 240, health: 'healthy', lastEvent: Date.now() - 43_200_000 },
];

const DEMO_OUTCOMES: EventOutcome[] = [
  { label: 'Aceitos', value: 12_450, color: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400' },
  { label: 'Filtrados', value: 1_230, color: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400' },
  { label: 'Rate Limited', value: 320, color: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-400' },
];

const DEMO: MonitoringData = {
  errors24h: 42,
  errorsChange: -12.5,
  unresolvedIssues: 15,
  projectCount: 5,
  eventsAccepted30d: 12_450,
  issues: DEMO_ISSUES,
  projects: DEMO_PROJECTS,
  outcomes: DEMO_OUTCOMES,
};

// ============================================
// COMPONENT
// ============================================
export default function MonitoringTab({ sentryConfig }: MonitoringTabProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [issuesExpanded, setIssuesExpanded] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      if (!sentryConfig?.apiKey) throw new Error('Sentry não configurado');

      const headers: Record<string, string> = {
        ...await getAuthHeaders(),
        'x-api-key': sentryConfig.apiKey,
      };
      if (sentryConfig.metadata?.org) {
        headers['x-org-slug'] = sentryConfig.metadata.org as string;
      }

      const res = await fetch('/api/integrations/sentry', { headers });
      if (!res.ok) throw new Error('Falha ao buscar dados do Sentry');
      const result = await res.json();

      setData({
        errors24h: result.errors24h ?? DEMO.errors24h,
        errorsChange: result.errorsChange ?? DEMO.errorsChange,
        unresolvedIssues: result.unresolvedIssues ?? DEMO.unresolvedIssues,
        projectCount: result.projects?.length ?? DEMO.projectCount,
        eventsAccepted30d: result.eventsAccepted30d ?? DEMO.eventsAccepted30d,
        issues: (result.issues || DEMO.issues).map((issue: any) => ({
          id: issue.id,
          title: issue.title,
          culprit: issue.culprit,
          level: issue.level || 'error',
          count: issue.count || 0,
          firstSeen: issue.firstSeen ? new Date(issue.firstSeen).getTime() : Date.now(),
          lastSeen: issue.lastSeen ? new Date(issue.lastSeen).getTime() : Date.now(),
          project: issue.project || 'unknown',
        })),
        projects: (result.projects || DEMO.projects).map((p: any) => ({
          id: p.id,
          name: p.name || p.slug,
          platform: p.platform || 'javascript-nextjs',
          eventCount: p.eventCount || 0,
          health: p.health || 'healthy',
          lastEvent: p.lastEvent ? new Date(p.lastEvent).getTime() : Date.now(),
        })),
        outcomes: result.outcomes || DEMO.outcomes,
      });
    } catch (err: any) {
      setError(err.message);
      setData(DEMO);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sentryConfig]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <IntegrationSkeleton rows={3} />;
  if (!data) return null;

  const visibleIssues = issuesExpanded ? data.issues : data.issues.slice(0, 8);
  const outcomesTotal = data.outcomes.reduce((sum, o) => sum + o.value, 0);

  return (
    <div className="space-y-6">
      {/* Demo banner + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          {error && <DemoDataBanner message={`${t('integrations.demo.usingDemoPrefix', 'Usando dados de demonstração. ')}${error}`} />}
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="ml-3 p-2.5 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ========== 1. Monitoring KPIs ========== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title={t('integrations.kpi.errors24h', 'Erros (24h)')}
          value={data.errors24h.toString()}
          change={data.errorsChange}
          icon={<Bug className="w-4 h-4" />}
          color="red"
          delay={0}
          warning={data.errors24h > 50}
        />
        <KPICard
          title={t('integrations.kpi.unresolvedIssues', 'Issues Não Resolvidas')}
          value={data.unresolvedIssues.toString()}
          icon={<AlertCircle className="w-4 h-4" />}
          color="amber"
          delay={0.05}
          warning={data.unresolvedIssues > 20}
        />
        <KPICard
          title={t('integrations.kpi.monitoredProjects', 'Projetos Monitorados')}
          value={data.projectCount.toString()}
          icon={<Layers className="w-4 h-4" />}
          color="blue"
          delay={0.1}
        />
        <KPICard
          title={t('integrations.kpi.acceptedEvents30d', 'Eventos Aceitos (30d)')}
          value={formatNumber(data.eventsAccepted30d)}
          icon={<Activity className="w-4 h-4" />}
          color="emerald"
          delay={0.15}
        />
      </div>

      {/* ========== 2. Top Issues ========== */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="surface rounded-2xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white flex items-center gap-2">
            <Bug className="w-4 h-4 text-red-500" />
            {t('integrations.monitoring.topIssues', 'Top Issues')}
          </h3>
          <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">
            {t('integrations.monitoring.issues', '{{count}} issue(s)', { count: data.issues.length })}
          </span>
        </div>
        <div className="space-y-1.5">
          {visibleIssues.map((issue, i) => {
            const level = LEVEL_CONFIG[issue.level] || LEVEL_CONFIG.error;
            const LevelIcon = level.icon;
            return (
              <motion.div
                key={issue.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.25 + i * 0.04 }}
                className="flex items-start justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`w-2 h-2 rounded-full ${level.dot} flex-shrink-0 mt-1.5`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-700 dark:text-gray-300 truncate leading-snug">{issue.title}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md flex items-center gap-1 ${level.bg} ${level.text}`}>
                        <LevelIcon className="w-2.5 h-2.5" />
                        {level.label}
                      </span>
                      <span className="text-[11px] text-gray-400 font-mono">{issue.culprit}</span>
                      <span className="text-[11px] text-gray-300 dark:text-gray-600">|</span>
                      <span className="text-[11px] text-gray-400">{issue.project}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md tabular-nums">
                    {formatNumber(issue.count)}x
                  </span>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Eye className="w-2.5 h-2.5" />
                      {timeAgoShort(issue.lastSeen)}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {data.issues.length > 8 && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            onClick={() => setIssuesExpanded(!issuesExpanded)}
            className="w-full mt-3 py-2 rounded-xl text-xs font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors"
          >
            {issuesExpanded ? t('integrations.monitoring.showLess', 'Mostrar menos') : t('integrations.monitoring.showAll', 'Ver todas as {{count}} issues', { count: data.issues.length })}
          </motion.button>
        )}
      </motion.div>

      {/* ========== 3. Projects + Event Outcomes ========== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Projects Grid */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="surface rounded-2xl p-5"
        >
          <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-500" />
            {t('integrations.monitoring.projects', 'Projetos')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.projects.map((project, i) => {
              const healthCfg = HEALTH_CONFIG[project.health] || HEALTH_CONFIG.healthy;
              const PlatformIcon = PLATFORM_ICONS[project.platform] || Globe;
              return (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.05 }}
                  className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <PlatformIcon className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{project.name}</span>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${healthCfg.dot}`} title={t(healthCfg.labelKey, healthCfg.labelKey)} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span className="flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      {formatNumber(project.eventCount)} {t('integrations.monitoring.eventsLabel', 'eventos')}
                    </span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                      project.health === 'healthy' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                      project.health === 'warning' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                      'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                    }`}>
                      {t(healthCfg.labelKey, healthCfg.labelKey)}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {t('integrations.monitoring.lastEvent', 'Último evento {{time}}', { time: timeAgo(project.lastEvent) })}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* Event Outcomes */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="surface rounded-2xl p-5"
        >
          <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-5 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-500" />
            {t('integrations.monitoring.eventsByOutcome', 'Eventos por Outcome')}
            <span className="text-[11px] font-normal text-gray-400 ml-auto">{t('integrations.monitoring.last30days', '30 dias')}</span>
          </h3>

          {/* Segmented bar */}
          <div className="h-4 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex mb-5">
            {data.outcomes.map((outcome, i) => {
              const pct = outcomesTotal > 0 ? (outcome.value / outcomesTotal * 100) : 0;
              return (
                <motion.div
                  key={outcome.label}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: 0.45 + i * 0.1, ease: 'easeOut' }}
                  className={`h-full ${outcome.color} ${i === 0 ? 'rounded-l-full' : ''} ${i === data.outcomes.length - 1 ? 'rounded-r-full' : ''}`}
                />
              );
            })}
          </div>

          {/* Outcome breakdown cards */}
          <div className="space-y-3">
            {data.outcomes.map((outcome, i) => {
              const pct = outcomesTotal > 0 ? (outcome.value / outcomesTotal * 100) : 0;
              return (
                <motion.div
                  key={outcome.label}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.5 + i * 0.08 }}
                  className={`flex items-center justify-between p-3.5 rounded-xl ${outcome.bg}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${outcome.color}`} />
                    <div>
                      <p className={`text-sm font-medium ${outcome.text}`}>{outcome.label}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{pct.toFixed(1)}% do total</p>
                    </div>
                  </div>
                  <p className={`text-lg font-bold ${outcome.text}`}>{formatNumber(outcome.value)}</p>
                </motion.div>
              );
            })}
          </div>

          {/* Total */}
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-[11px] text-gray-400">{t('integrations.monitoring.totalEvents', 'Total de eventos')}</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">{formatNumber(outcomesTotal)}</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
