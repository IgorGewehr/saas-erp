'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Shield, Globe, Activity, Rocket,
  CheckCircle2, XCircle, Loader2, Clock,
  BarChart3, Eye, Zap, Lock,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IntegrationConfig } from '@/lib/types';
import KPICard from '../shared/KPICard';
import DemoDataBanner from '../shared/DemoDataBanner';
import IntegrationSkeleton from '../shared/IntegrationSkeleton';
import { formatNumber, timeAgo } from '../shared/utils';

// ============================================
// TYPES
// ============================================
interface InfrastructureTabProps {
  cloudflareConfig: IntegrationConfig | null;
  vercelConfig: IntegrationConfig | null;
  members: any[];
}

interface DeployItem {
  id: string;
  project: string;
  branch: string;
  status: 'ready' | 'error' | 'building';
  buildTime: number;
  createdAt: number;
  commitMessage?: string;
}

interface CloudflareZone {
  name: string;
  status: 'active' | 'pending' | 'inactive';
  plan: string;
}

interface DailyTrafficStat {
  date: string;
  requests: number;
}

// ============================================
// DEMO DATA
// ============================================
const DEMO_DEPLOYS: DeployItem[] = [
  { id: 'd1', project: 'saas-erp', branch: 'main', status: 'ready', buildTime: 47, createdAt: Date.now() - 900_000, commitMessage: 'feat: integrations dashboard' },
  { id: 'd2', project: 'saas-erp', branch: 'feat/team-tab', status: 'ready', buildTime: 52, createdAt: Date.now() - 3_600_000, commitMessage: 'add team member cards' },
  { id: 'd3', project: 'landing-page', branch: 'main', status: 'ready', buildTime: 21, createdAt: Date.now() - 7_200_000, commitMessage: 'update hero section' },
  { id: 'd4', project: 'api-gateway', branch: 'fix/rate-limit', status: 'error', buildTime: 0, createdAt: Date.now() - 14_400_000, commitMessage: 'fix: edge case in rate limiter' },
  { id: 'd5', project: 'saas-erp', branch: 'feat/enterprise', status: 'building', buildTime: 0, createdAt: Date.now() - 600_000, commitMessage: 'wip: enterprise settings' },
  { id: 'd6', project: 'docs', branch: 'main', status: 'ready', buildTime: 18, createdAt: Date.now() - 28_800_000, commitMessage: 'update API reference' },
];

const DEMO_ZONES: CloudflareZone[] = [
  { name: 'servicepro.com.br', status: 'active', plan: 'Pro' },
  { name: 'servicepro.io', status: 'active', plan: 'Pro' },
  { name: 'api.servicepro.com.br', status: 'active', plan: 'Business' },
];

const DEMO_DAILY_STATS: DailyTrafficStat[] = [
  { date: 'Seg', requests: 312_000 },
  { date: 'Ter', requests: 348_000 },
  { date: 'Qua', requests: 295_000 },
  { date: 'Qui', requests: 410_000 },
  { date: 'Sex', requests: 389_000 },
  { date: 'Sab', requests: 274_000 },
  { date: 'Dom', requests: 371_000 },
];

// ============================================
// COMPONENT
// ============================================
export default function InfrastructureTab({ cloudflareConfig, vercelConfig, members }: InfrastructureTabProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deploys, setDeploys] = useState<DeployItem[]>([]);
  const [zones, setZones] = useState<CloudflareZone[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyTrafficStat[]>([]);
  const [kpis, setKpis] = useState({
    totalRequests: 0,
    cacheHitRate: 0,
    threatsBlocked: 0,
    deploySuccessRate: 0,
  });
  const [cfStats, setCfStats] = useState({
    cached: 0,
    bandwidth: '',
    pageViews: 0,
    uniqueVisitors: 0,
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    let cfData: any = null;
    let vercelData: any = null;

    // Fetch Cloudflare data
    if (cloudflareConfig?.apiKey) {
      try {
        const res = await fetch('/api/integrations/cloudflare', { headers: { 'x-api-key': cloudflareConfig.apiKey } });
        if (res.ok) cfData = await res.json();
        else throw new Error('Cloudflare API error');
      } catch {
        // Will fall back to demo data
      }
    }

    // Fetch Vercel data
    if (vercelConfig?.apiKey) {
      try {
        const res = await fetch('/api/integrations/vercel', { headers: { 'x-api-key': vercelConfig.apiKey } });
        if (res.ok) vercelData = await res.json();
        else throw new Error('Vercel API error');
      } catch {
        // Will fall back to demo data
      }
    }

    const usingDemo = !cfData && !vercelData;
    if (usingDemo) {
      setError(t('integrations.infra.demoMessage', 'Usando dados de demonstração. Configure as integrações Cloudflare e Vercel nas configurações Enterprise.'));
    }

    // Cloudflare data or demo
    const totalReqs = cfData?.totalRequests ?? 2_400_000;
    const cacheRate = cfData?.cacheHitRate ?? 94.2;
    const threats = cfData?.threatsBlocked ?? 1_247;
    const cachedReqs = cfData?.cachedRequests ?? Math.round(totalReqs * (cacheRate / 100));
    const bw = cfData?.bandwidth ?? '45.3 GB';
    const pv = cfData?.pageViews ?? 892_000;
    const uv = cfData?.uniqueVisitors ?? 124_500;

    setCfStats({
      cached: cachedReqs,
      bandwidth: typeof bw === 'number' ? `${(bw / 1_000_000_000).toFixed(1)} GB` : bw,
      pageViews: pv,
      uniqueVisitors: uv,
    });

    setZones(cfData?.zones?.map((z: any) => ({
      name: z.name,
      status: z.status || 'active',
      plan: z.plan || 'Pro',
    })) || DEMO_ZONES);

    setDailyStats(cfData?.dailyStats?.map((d: any) => ({
      date: d.date,
      requests: d.requests,
    })) || DEMO_DAILY_STATS);

    // Vercel deploys
    setDeploys(vercelData?.recentDeploys?.map((d: any) => ({
      id: d.id,
      project: d.project || d.name || 'project',
      branch: d.branch || d.target || 'main',
      status: d.status === 'READY' || d.state === 'READY' ? 'ready' : d.status === 'ERROR' || d.state === 'ERROR' ? 'error' : 'building',
      buildTime: d.buildTime || 0,
      createdAt: typeof d.createdAt === 'string' ? new Date(d.createdAt).getTime() : d.createdAt,
      commitMessage: d.commitMessage || d.meta?.githubCommitMessage || '',
    })) || DEMO_DEPLOYS);

    // Compute KPIs
    const demoOrRealDeploys = vercelData?.recentDeploys || DEMO_DEPLOYS;
    const readyDeploys = demoOrRealDeploys.filter((d: any) => (d.status === 'READY' || d.status === 'ready' || d.state === 'READY'));
    const successRate = demoOrRealDeploys.length > 0 ? Math.round(readyDeploys.length / demoOrRealDeploys.length * 100 * 10) / 10 : 0;

    setKpis({
      totalRequests: totalReqs,
      cacheHitRate: cacheRate,
      threatsBlocked: threats,
      deploySuccessRate: successRate,
    });

    setLoading(false);
  };

  if (loading) return <IntegrationSkeleton rows={3} />;

  const deployStatusConfig: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
    ready: { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-400', label: t('integrations.infra.deployReady', 'Pronto'), icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
    error: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-400', label: t('integrations.infra.deployError', 'Erro'), icon: <XCircle className="w-3.5 h-3.5" /> },
    building: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-400', label: t('integrations.infra.deployBuilding', 'Building'), icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  };

  const zoneStatusConfig: Record<string, { bg: string; text: string }> = {
    active: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
    pending: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
    inactive: { bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-500 dark:text-gray-400' },
  };

  const maxDailyRequests = Math.max(...dailyStats.map(d => d.requests), 1);

  return (
    <div className="space-y-6">
      {error && <DemoDataBanner message={error} />}

      {/* Infrastructure KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title={t('integrations.kpi.requests30d', 'Requisições (30d)')}
          value={formatNumber(kpis.totalRequests)}
          icon={<Activity className="w-4 h-4" />}
          color="violet"
          delay={0}
        />
        <KPICard
          title={t('integrations.kpi.cacheHitRate', 'Cache Hit Rate')}
          value={`${kpis.cacheHitRate}%`}
          icon={<Zap className="w-4 h-4" />}
          color="emerald"
          delay={0.05}
        />
        <KPICard
          title={t('integrations.kpi.threatsBlocked', 'Threats Bloqueadas')}
          value={formatNumber(kpis.threatsBlocked)}
          icon={<Shield className="w-4 h-4" />}
          color="amber"
          delay={0.1}
          warning={kpis.threatsBlocked > 2000}
        />
        <KPICard
          title={t('integrations.kpi.deploySuccessRate', 'Deploy Success Rate')}
          value={`${kpis.deploySuccessRate}%`}
          icon={<Rocket className="w-4 h-4" />}
          color="blue"
          delay={0.15}
        />
      </div>

      {/* Trafego & CDN (Cloudflare) */}
      <div className="surface rounded-2xl p-5">
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Globe className="w-4 h-4 text-orange-500" />
          {t('integrations.infra.trafficCDN', 'Tráfego & CDN (Cloudflare)')}
        </h3>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {[
            { label: t('integrations.infra.totalRequests', 'Total Requests'), value: formatNumber(kpis.totalRequests) },
            { label: t('integrations.infra.cached', 'Cached'), value: formatNumber(cfStats.cached) },
            { label: t('integrations.infra.bandwidth', 'Bandwidth'), value: cfStats.bandwidth },
            { label: t('integrations.infra.pageViews', 'Page Views'), value: formatNumber(cfStats.pageViews) },
            { label: t('integrations.infra.uniqueVisitors', 'Visitantes Únicos'), value: formatNumber(cfStats.uniqueVisitors) },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 text-center"
            >
              <p className="text-lg font-bold text-gray-900 dark:text-white">{stat.value}</p>
              <p className="text-[11px] text-gray-400">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Daily Traffic Mini Bar Chart */}
        <div>
          <p className="text-[11px] text-gray-400 mb-3 font-medium">{t('integrations.infra.dailyTraffic', 'Tráfego diário (últimos 7 dias)')}</p>
          <div className="flex items-end gap-2 h-24">
            {dailyStats.map((day, i) => {
              const pct = maxDailyRequests > 0 ? (day.requests / maxDailyRequests * 100) : 0;
              return (
                <motion.div
                  key={day.date}
                  initial={{ height: 0 }}
                  animate={{ height: `${pct}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 + i * 0.06 }}
                  className="flex-1 flex flex-col items-center justify-end"
                >
                  <div
                    className="w-full rounded-t-lg bg-gradient-to-t from-orange-500 to-amber-400 dark:from-orange-600 dark:to-amber-500 min-h-[4px] relative group cursor-default"
                    style={{ height: `${pct}%`, minHeight: 4 }}
                  >
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">
                      {formatNumber(day.requests)}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
          <div className="flex gap-2 mt-1.5">
            {dailyStats.map(day => (
              <div key={day.date} className="flex-1 text-center text-[10px] text-gray-400">{day.date}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Deploy Pipeline (Vercel) */}
      <div className="surface rounded-2xl p-5">
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Rocket className="w-4 h-4" />
          {t('integrations.infra.deployPipeline', 'Deploy Pipeline')}
        </h3>
        <div className="space-y-1.5">
          {deploys.map((deploy, i) => {
            const status = deployStatusConfig[deploy.status];
            return (
              <motion.div
                key={deploy.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`w-2 h-2 rounded-full ${status.bg} flex-shrink-0`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{deploy.project}</span>
                      <span className="text-[11px] text-gray-400 font-mono">{deploy.branch}</span>
                    </div>
                    {deploy.commitMessage && (
                      <p className="text-[11px] text-gray-400 truncate mt-0.5">{deploy.commitMessage}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${status.color} bg-gray-50 dark:bg-gray-800`}>
                    {status.icon}
                    {status.label}
                  </span>
                  {deploy.buildTime > 0 && (
                    <span className="text-[11px] text-gray-400">{deploy.buildTime}s</span>
                  )}
                  <span className="text-[11px] text-gray-400">{timeAgo(deploy.createdAt)}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Zonas & Dominios */}
      <div className="surface rounded-2xl p-5">
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Lock className="w-4 h-4 text-orange-500" />
          {t('integrations.infra.zonesAndDomains', 'Zonas & Domínios')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {zones.map((zone, i) => {
            const statusCfg = zoneStatusConfig[zone.status] || zoneStatusConfig.inactive;
            return (
              <motion.div
                key={zone.name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{zone.name}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.text}`}>
                    {zone.status === 'active' ? t('integrations.infra.zoneActive', 'Ativo') : zone.status === 'pending' ? t('integrations.infra.zonePending', 'Pendente') : t('integrations.infra.zoneInactive', 'Inativo')}
                  </span>
                  <span className="text-[11px] text-gray-400">{t('integrations.infra.plan', 'Plano {{name}}', { name: zone.plan })}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
