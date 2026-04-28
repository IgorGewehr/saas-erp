'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, Triangle, Mail, Bug, Shield, Cloud, Database, Globe,
  DollarSign, Users, Activity, RefreshCw, Rocket,
  TrendingUp, AlertTriangle, ChevronRight,
  Clock, Sun, Moon, Sunset,
  ArrowRight, Gauge,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { IntegrationConfig, IntegrationProvider, User as UserType } from '@/lib/types';
import { INTEGRATION_PROVIDERS, ROLE_LABELS } from '@/lib/types';
import { getInitials } from '@/lib/utils/format';
import KPICard from '../shared/KPICard';
import DemoDataBanner from '../shared/DemoDataBanner';
import IntegrationSkeleton from '../shared/IntegrationSkeleton';
import { formatCurrency, formatUSD, formatNumber, timeAgo, getGreeting, getAuthHeaders } from '../shared/utils';

// ============================================
// TYPES
// ============================================

interface OverviewTabProps {
  integrations: IntegrationConfig[];
  members: any[];
  onNavigate?: (tab: string) => void;
}

interface FeedItem {
  id: string;
  provider: IntegrationProvider;
  message: string;
  time: number;
  type: string;
  amount?: number;
}

interface OverviewData {
  stripe: {
    mrr: number;
    mrrChange: number;
    activeSubscriptions: number;
    recentEvents: { type: string; message: string; amount: number; time: number }[];
  };
  aws: {
    currentCost: number;
    costChange: number;
    forecastNext: number;
    topService: string;
    topServiceCost: number;
  };
  cloudflare: {
    totalRequests: number;
    cacheHitRate: number;
    threatsBlocked: number;
  };
  vercel: {
    successRate: number;
    deploysToday: number;
    recentEvents: { type: string; message: string; time: number }[];
  };
  sentry: {
    unresolvedIssues: number;
    eventsToday: number;
    crashFreeRate: number;
  };
}

// ============================================
// CONSTANTS
// ============================================

const DEMO_DATA: OverviewData = {
  stripe: {
    mrr: 28750, mrrChange: 12.5, activeSubscriptions: 142,
    recentEvents: [
      { type: 'subscription', message: 'Nova assinatura \u2014 Plano Pro', amount: 9900, time: Date.now() - 1800000 },
      { type: 'payment', message: 'Pagamento recebido', amount: 29900, time: Date.now() - 3600000 },
      { type: 'churn', message: 'Cancelamento \u2014 Plano Basic', amount: -4900, time: Date.now() - 7200000 },
    ],
  },
  aws: {
    currentCost: 1847.32, costChange: 8.2, forecastNext: 2105.00,
    topService: 'EC2', topServiceCost: 742.18,
  },
  cloudflare: {
    totalRequests: 12400000, cacheHitRate: 94.7, threatsBlocked: 3842,
  },
  vercel: {
    successRate: 96.9, deploysToday: 4,
    recentEvents: [
      { type: 'deploy', message: 'Deploy succeeded \u2014 saas-erp (main)', time: Date.now() - 900000 },
    ],
  },
  sentry: {
    unresolvedIssues: 7, eventsToday: 142, crashFreeRate: 99.4,
  },
};

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  stripe: CreditCard,
  vercel: Triangle,
  resend: Mail,
  sentry: Bug,
  cloudflare: Shield,
  aws: Cloud,
  supabase: Database,
  godaddy: Globe,
};

const PROVIDER_DOT_COLORS: Record<string, string> = {
  stripe: 'bg-[#635BFF]',
  vercel: 'bg-black dark:bg-white',
  resend: 'bg-gray-800 dark:bg-gray-300',
  sentry: 'bg-[#362D59]',
  cloudflare: 'bg-[#F6821F]',
  aws: 'bg-[#FF9900]',
  supabase: 'bg-[#3ECF8E]',
  godaddy: 'bg-[#1BDBDB]',
};

const STAGGER_CONTAINER = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const STAGGER_ITEM = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

// ============================================
// HELPERS
// ============================================

function getMemberDisplayStatus(member: any): 'online' | 'busy' | 'offline' {
  if (member.userStatus === 'invisible') return 'offline';
  if (!member.isOnline || !member.lastSeenAt) return 'offline';
  if (Date.now() - new Date(member.lastSeenAt).getTime() >= 3 * 60 * 1000) return 'offline';
  return member.userStatus === 'busy' ? 'busy' : 'online';
}

function getGreetingIcon(): React.ReactNode {
  const h = new Date().getHours();
  if (h < 12) return <Sun className="w-5 h-5 text-amber-400" />;
  if (h < 18) return <Sunset className="w-5 h-5 text-orange-400" />;
  return <Moon className="w-5 h-5 text-indigo-400" />;
}

function buildFeedItems(data: OverviewData, connectedProviders: Set<string>): FeedItem[] {
  const items: FeedItem[] = [];

  if (connectedProviders.has('stripe')) {
    data.stripe.recentEvents.forEach((e, i) => {
      items.push({
        id: `stripe-${i}`,
        provider: 'stripe',
        message: e.message,
        time: e.time,
        type: e.type,
        amount: e.amount,
      });
    });
  }

  if (connectedProviders.has('vercel')) {
    data.vercel.recentEvents.forEach((e, i) => {
      items.push({
        id: `vercel-${i}`,
        provider: 'vercel',
        message: e.message,
        time: e.time,
        type: e.type,
      });
    });
  }

  // Sentry synthetic events
  if (connectedProviders.has('sentry')) {
    if (data.sentry.unresolvedIssues > 0) {
      items.push({
        id: 'sentry-0',
        provider: 'sentry',
        message: `${data.sentry.unresolvedIssues} issues não resolvidas · ${data.sentry.eventsToday} eventos hoje`,
        time: Date.now() - 600000,
        type: 'error',
      });
    }
    items.push({
      id: 'sentry-1',
      provider: 'sentry',
      message: `Crash-free rate: ${data.sentry.crashFreeRate}%`,
      time: Date.now() - 3000000,
      type: 'health',
    });
  }

  // Resend synthetic event
  if (connectedProviders.has('resend')) {
    items.push({
      id: 'resend-0',
      provider: 'resend',
      message: '1.2K emails enviados hoje',
      time: Date.now() - 1200000,
      type: 'email',
    });
  }

  // Cloudflare synthetic events
  if (connectedProviders.has('cloudflare')) {
    if (data.cloudflare.threatsBlocked > 0) {
      items.push({
        id: 'cloudflare-0',
        provider: 'cloudflare',
        message: `${formatNumber(data.cloudflare.threatsBlocked)} ameaças bloqueadas · Cache hit ${data.cloudflare.cacheHitRate}%`,
        time: Date.now() - 1800000,
        type: 'security',
      });
    }
  }

  return items.sort((a, b) => b.time - a.time);
}

// ============================================
// SUB-COMPONENTS
// ============================================

function QuickStatsPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/50">
      <div className="text-gray-400 dark:text-gray-500">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wider truncate">{label}</p>
        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{value}</p>
      </div>
    </div>
  );
}

function ActivityFeedItem({ item }: { item: FeedItem }) {
  const dotColor = PROVIDER_DOT_COLORS[item.provider] || 'bg-gray-400';
  const providerInfo = INTEGRATION_PROVIDERS[item.provider];
  const Icon = PROVIDER_ICONS[item.provider];

  return (
    <motion.div
      variants={STAGGER_ITEM}
      className="flex items-start gap-3 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0"
    >
      <div className="flex-shrink-0 mt-1.5">
        <div className={`w-2 h-2 rounded-full ${dotColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-snug">{item.message}</p>
        {item.amount !== undefined && (
          <p className={`text-xs font-semibold mt-0.5 ${
            item.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
          }`}>
            {item.amount >= 0 ? '+' : ''}{formatCurrency(item.amount / 100)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {Icon && (
          <Icon
            className="w-3.5 h-3.5"
            style={{ color: providerInfo?.color }}
          />
        )}
        <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">
          {timeAgo(item.time)}
        </span>
      </div>
    </motion.div>
  );
}

function TeamMemberCard({ member }: { member: any }) {
  const displayStatus = getMemberDisplayStatus(member);
  const dotClass = displayStatus === 'online'
    ? 'bg-emerald-400'
    : displayStatus === 'busy'
      ? 'bg-amber-400'
      : 'bg-gray-300 dark:bg-gray-600';

  const statusLabel = displayStatus === 'online'
    ? 'Online'
    : displayStatus === 'busy'
      ? 'Ocupado'
      : member.lastSeenAt
        ? timeAgo(new Date(member.lastSeenAt).getTime())
        : 'Offline';

  const roleLabel = ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] || member.role;

  return (
    <motion.div
      variants={STAGGER_ITEM}
      className="surface rounded-xl p-3.5 flex items-center gap-3"
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        {member.photoURL ? (
          <img
            src={member.photoURL}
            alt={member.name}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold">
            {getInitials(member.name || '')}
          </div>
        )}
        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${dotClass} transition-colors duration-300`} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{member.name}</p>
          <span className="flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400">
            {roleLabel}
          </span>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{statusLabel}</p>
      </div>
    </motion.div>
  );
}

function BudgetAlert({
  label,
  used,
  limit,
  color,
  onAction,
  viewDetailsLabel = 'Ver detalhes',
}: {
  label: string;
  used: number;
  limit: number;
  color: string;
  onAction?: () => void;
  viewDetailsLabel?: string;
}) {
  return (
    <motion.div
      variants={STAGGER_ITEM}
      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/20"
    >
      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">
          {label}
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
          {formatUSD(used)} / {formatUSD(limit)}
        </p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${color}`} />
        {onAction && (
          <button
            onClick={onAction}
            className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
          >
            {viewDetailsLabel}
          </button>
        )}
      </div>
    </motion.div>
  );
}

function QuickActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl surface hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 group"
    >
      <span className="text-violet-500 dark:text-violet-400">{icon}</span>
      <span>{label}</span>
      <ArrowRight className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 group-hover:text-violet-500 dark:group-hover:text-violet-400 transition-colors ml-auto" />
    </motion.button>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function OverviewTab({ integrations, members, onNavigate }: OverviewTabProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedExpanded, setFeedExpanded] = useState(false);

  const connectedProviders = useMemo(() => {
    return new Set(integrations.filter(i => i.isActive).map(i => i.provider));
  }, [integrations]);

  const fetchAllData = useCallback(async () => {
    const results: Partial<OverviewData> = {};
    let anySuccess = false;

    const fetchProviderData = async (
      provider: string,
      config: IntegrationConfig | undefined,
    ) => {
      if (!config?.apiKey) return null;
      try {
        const res = await fetch(`/api/integrations/${provider}`, {
          headers: { ...await getAuthHeaders(), 'x-api-key': config.apiKey },
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    const stripeConfig = integrations.find(i => i.provider === 'stripe');
    const awsConfig = integrations.find(i => i.provider === 'aws');
    const cloudflareConfig = integrations.find(i => i.provider === 'cloudflare');
    const vercelConfig = integrations.find(i => i.provider === 'vercel');
    const sentryConfig = integrations.find(i => i.provider === 'sentry');

    const [stripeData, awsData, cloudflareData, vercelData, sentryData] = await Promise.all([
      fetchProviderData('stripe', stripeConfig),
      fetchProviderData('aws', awsConfig),
      fetchProviderData('cloudflare', cloudflareConfig),
      fetchProviderData('vercel', vercelConfig),
      fetchProviderData('sentry', sentryConfig),
    ]);

    // Build stripe overview
    if (stripeData) {
      anySuccess = true;
      results.stripe = {
        mrr: stripeData.mrr || 0,
        mrrChange: stripeData.mrrGrowth || 0,
        activeSubscriptions: stripeData.subscriptions?.active || 0,
        recentEvents: (stripeData.recentCharges || []).slice(0, 3).map((c: any, i: number) => ({
          type: c.status === 'refunded' ? 'churn' : 'payment',
          message: c.status === 'refunded'
            ? `Reembolso \u2014 ${c.customer}`
            : `Pagamento de ${c.customer}`,
          amount: c.amount,
          time: (c.created || Date.now() / 1000) * 1000,
        })),
      };
    }

    // Build AWS overview
    if (awsData) {
      anySuccess = true;
      results.aws = {
        currentCost: awsData.currentCost || 0,
        costChange: awsData.costChange || 0,
        forecastNext: awsData.forecastNext || 0,
        topService: awsData.topService?.name || 'N/A',
        topServiceCost: awsData.topService?.cost || 0,
      };
    }

    // Build Cloudflare overview
    if (cloudflareData) {
      anySuccess = true;
      results.cloudflare = {
        totalRequests: cloudflareData.totalRequests || 0,
        cacheHitRate: cloudflareData.cacheHitRate || 0,
        threatsBlocked: cloudflareData.threatsBlocked || 0,
      };
    }

    // Build Vercel overview
    if (vercelData) {
      anySuccess = true;
      results.vercel = {
        successRate: vercelData.successRate || 0,
        deploysToday: vercelData.deploysToday || 0,
        recentEvents: (vercelData.recentDeploys || []).slice(0, 2).map((d: any, i: number) => ({
          type: 'deploy',
          message: `Deploy ${d.state === 'READY' ? 'succeeded' : d.state?.toLowerCase() || 'unknown'} \u2014 ${d.name || 'project'} (${d.target || 'production'})`,
          time: d.createdAt ? new Date(d.createdAt).getTime() : Date.now() - i * 1800000,
        })),
      };
    }

    // Build Sentry overview
    if (sentryData) {
      anySuccess = true;
      results.sentry = {
        unresolvedIssues: sentryData.unresolvedIssues || 0,
        eventsToday: sentryData.eventsToday || 0,
        crashFreeRate: sentryData.crashFreeRate || 0,
      };
    }

    if (anySuccess) {
      setData({
        stripe: results.stripe || DEMO_DATA.stripe,
        aws: results.aws || DEMO_DATA.aws,
        cloudflare: results.cloudflare || DEMO_DATA.cloudflare,
        vercel: results.vercel || DEMO_DATA.vercel,
        sentry: results.sentry || DEMO_DATA.sentry,
      });
      setIsDemo(false);
    } else {
      setData(DEMO_DATA);
      setIsDemo(true);
    }
  }, [integrations]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      await fetchAllData();
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [fetchAllData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchAllData();
    setRefreshing(false);
  };

  const navigate = (tab: string) => {
    onNavigate?.(tab);
  };

  // Computed values
  const teamOnline = useMemo(() => {
    return members.filter(m => getMemberDisplayStatus(m) !== 'offline').length;
  }, [members]);

  const feedItems = useMemo(() => {
    if (!data) return [];
    return buildFeedItems(data, connectedProviders);
  }, [data, connectedProviders]);

  const visibleFeed = feedExpanded ? feedItems : feedItems.slice(0, 8);

  const budgetAlerts = useMemo(() => {
    if (!data) return [];
    const alerts: { label: string; used: number; limit: number; color: string; tab: string }[] = [];

    // AWS cost budget alert (threshold: $2,500/month)
    const awsBudget = 2500;
    if (data.aws.currentCost / awsBudget > 0.8) {
      alerts.push({
        label: 'Custos AWS',
        used: data.aws.currentCost,
        limit: awsBudget,
        color: 'bg-[#FF9900]',
        tab: 'custos',
      });
    }

    return alerts;
  }, [data]);

  const todayStr = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // Loading state
  if (loading) {
    return <IntegrationSkeleton rows={3} />;
  }

  if (!data) return null;

  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Demo Banner */}
      {isDemo && (
        <motion.div variants={STAGGER_ITEM}>
          <DemoDataBanner message={t('integrations.demo.connectMessage', 'Conecte suas integrações nas Configurações Enterprise para ver dados reais.')} />
        </motion.div>
      )}

      {/* ============================================ */}
      {/* 1. GREETING + QUICK STATS BAR */}
      {/* ============================================ */}
      <motion.div variants={STAGGER_ITEM}>
        <div className="surface rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {getGreetingIcon()}
              <div>
                <h2 className="text-lg font-bold font-display text-gray-900 dark:text-white">
                  {getGreeting()}, {user?.name?.split(' ')[0] || 'time'}
                </h2>
                <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">{todayStr}</p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 rounded-xl text-gray-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </motion.button>
          </div>

          {/* Quick Stats Row */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
            <QuickStatsPill
              icon={<DollarSign className="w-3.5 h-3.5" />}
              label={t('integrations.overview.totalRevenue', 'Receita Total')}
              value={formatCurrency(data.stripe.mrr)}
            />
            <QuickStatsPill
              icon={<Cloud className="w-3.5 h-3.5" />}
              label={t('integrations.overview.awsCosts', 'Custos AWS')}
              value={formatUSD(data.aws.currentCost)}
            />
            <QuickStatsPill
              icon={<Shield className="w-3.5 h-3.5" />}
              label={t('integrations.kpi.cacheHitRate', 'Cache Hit Rate')}
              value={`${data.cloudflare.cacheHitRate}%`}
            />
            <QuickStatsPill
              icon={<Gauge className="w-3.5 h-3.5" />}
              label={t('integrations.kpi.deploySuccessRate', 'Deploy Success Rate')}
              value={`${data.vercel.successRate}%`}
            />
            <QuickStatsPill
              icon={<Bug className="w-3.5 h-3.5" />}
              label={t('integrations.overview.activeErrors', 'Erros Ativos')}
              value={formatNumber(data.sentry.unresolvedIssues)}
            />
          </div>
        </div>
      </motion.div>

      {/* ============================================ */}
      {/* 2. CROSS-INTEGRATION KPI ROW */}
      {/* ============================================ */}
      <motion.div variants={STAGGER_ITEM}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title={t('integrations.kpi.mrr', 'MRR')}
            value={formatCurrency(data.stripe.mrr)}
            change={data.stripe.mrrChange}
            icon={<DollarSign className="w-4 h-4" />}
            color="violet"
            delay={0.05}
            budget={{ used: data.stripe.mrr, limit: 50000 }}
          />
          <KPICard
            title={t('integrations.kpi.cloudCost', 'Custo Cloud (mês)')}
            value={formatUSD(data.aws.currentCost)}
            change={data.aws.costChange}
            icon={<Cloud className="w-4 h-4" />}
            color="emerald"
            delay={0.1}
            budget={{ used: data.aws.currentCost, limit: 2500 }}
            warning={data.aws.currentCost / 2500 > 0.8}
          />
          <KPICard
            title={t('integrations.kpi.threatsBlocked', 'Threats Bloqueadas')}
            value={formatNumber(data.cloudflare.threatsBlocked)}
            subtitle={`Cache hit: ${data.cloudflare.cacheHitRate}%`}
            icon={<Shield className="w-4 h-4" />}
            color="blue"
            delay={0.15}
          />
          <KPICard
            title={t('integrations.kpi.teamOnline', 'Equipe Online')}
            value={`${teamOnline}/${members.length}`}
            subtitle={t('integrations.kpi.offlineNow', '{{count}} offline agora', { count: members.length - teamOnline })}
            icon={<Users className="w-4 h-4" />}
            color="amber"
            delay={0.2}
          />
        </div>
      </motion.div>

      {/* ============================================ */}
      {/* 3. TWO-COLUMN: FEED + TEAM */}
      {/* ============================================ */}
      <motion.div variants={STAGGER_ITEM} className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: Activity Feed (3/5) */}
        <div className="lg:col-span-3 surface rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-500" />
              {t('integrations.overview.activityFeed', 'Feed de Atividades')}
            </h3>
            <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">
              {t('integrations.overview.events', '{{count}} evento(s)', { count: feedItems.length })}
            </span>
          </div>

          {feedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Clock className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-400 dark:text-gray-500">{t('integrations.overview.noRecentActivity', 'Nenhuma atividade recente')}</p>
            </div>
          ) : (
            <motion.div
              variants={STAGGER_CONTAINER}
              initial="hidden"
              animate="visible"
            >
              <AnimatePresence mode="wait">
                {visibleFeed.map((item) => (
                  <ActivityFeedItem key={item.id} item={item} />
                ))}
              </AnimatePresence>

              {feedItems.length > 8 && (
                <motion.button
                  variants={STAGGER_ITEM}
                  onClick={() => setFeedExpanded(!feedExpanded)}
                  className="w-full mt-3 py-2 rounded-xl text-xs font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors flex items-center justify-center gap-1.5"
                >
                  {feedExpanded ? t('integrations.overview.showLess', 'Ver menos') : t('integrations.overview.showMore', 'Ver mais')}
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${feedExpanded ? 'rotate-90' : ''}`} />
                </motion.button>
              )}
            </motion.div>
          )}
        </div>

        {/* Right: Team Snapshot (2/5) */}
        <div className="lg:col-span-2 surface rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-500" />
              {t('integrations.overview.teamSection', 'Equipe')}
            </h3>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
              teamOnline > 0
                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}>
              {t('integrations.overview.onlineCount', '{{count}} online', { count: teamOnline })}
            </span>
          </div>

          {members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Users className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-400 dark:text-gray-500">{t('integrations.overview.noMembersFound', 'Nenhum membro encontrado')}</p>
            </div>
          ) : (
            <motion.div
              variants={STAGGER_CONTAINER}
              initial="hidden"
              animate="visible"
              className="space-y-2"
            >
              {members.map((member) => (
                <TeamMemberCard key={member.id || member.uid} member={member} />
              ))}
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* ============================================ */}
      {/* 4. BUDGET ALERTS */}
      {/* ============================================ */}
      {budgetAlerts.length > 0 && (
        <motion.div variants={STAGGER_ITEM}>
          <motion.div
            variants={STAGGER_CONTAINER}
            initial="hidden"
            animate="visible"
            className="space-y-2"
          >
            {budgetAlerts.map((alert) => (
              <BudgetAlert
                key={alert.label}
                label={t('integrations.overview.budgetAlert', '{{label}} atingiu {{pct}}% do budget mensal', {
                  label: alert.label,
                  pct: Math.round(alert.used / alert.limit * 100),
                })}
                used={alert.used}
                limit={alert.limit}
                color={alert.color}
                onAction={() => navigate(alert.tab)}
                viewDetailsLabel={t('integrations.overview.viewDetails', 'Ver detalhes')}
              />
            ))}
          </motion.div>
        </motion.div>
      )}

      {/* ============================================ */}
      {/* 5. QUICK ACTIONS */}
      {/* ============================================ */}
      <motion.div variants={STAGGER_ITEM}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <QuickActionButton
            label={t('integrations.overview.viewRevenue', 'Ver Receita')}
            icon={<TrendingUp className="w-4 h-4" />}
            onClick={() => navigate('receita')}
          />
          <QuickActionButton
            label={t('integrations.tabs.custos', 'Custos Cloud')}
            icon={<Cloud className="w-4 h-4" />}
            onClick={() => navigate('custos')}
          />
          <QuickActionButton
            label={t('integrations.overview.viewInfra', 'Infraestrutura')}
            icon={<Shield className="w-4 h-4" />}
            onClick={() => navigate('infra')}
          />
          <QuickActionButton
            label={t('integrations.overview.viewMonitoring', 'Monitoramento')}
            icon={<Bug className="w-4 h-4" />}
            onClick={() => navigate('monitoramento')}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
