'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Rocket, Bug, Clock, DollarSign, Activity,
  Triangle, Mail, Cloud, Shield, CreditCard,
  ChevronDown, Crown, Star,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IntegrationConfig } from '@/lib/types';
import KPICard from '../shared/KPICard';
import DemoDataBanner from '../shared/DemoDataBanner';
import IntegrationSkeleton from '../shared/IntegrationSkeleton';
import { formatUSD, formatNumber, timeAgo, timeAgoShort } from '../shared/utils';
import { CachedImage } from '@/app/components/ui/CachedImage';

// ============================================
// TYPES
// ============================================
interface TeamTabProps {
  integrations: IntegrationConfig[];
  members: any[];
}

interface MemberCardData {
  id: string;
  name: string;
  role: string;
  photoURL?: string;
  isOnline: boolean;
  status: 'online' | 'busy' | 'offline';
  deploys: number;
  errorsResolved: number;
  lastActivity: string;
  lastActivityTime: number;
}

interface ActivityItem {
  id: string;
  memberName: string;
  memberAvatar?: string;
  action: string;
  integration: 'revenue' | 'cloud' | 'infra' | 'deploy' | 'monitoring' | 'email';
  timestamp: number;
}

interface CostRow {
  memberId: string;
  name: string;
  photoURL?: string;
  awsCost: number;
  vercelCost: number;
  total: number;
}

// ============================================
// CONSTANTS
// ============================================
const ROLE_BADGE_CONFIG: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  founder: { color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', icon: <Crown className="w-3 h-3" /> },
  admin: { color: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10', icon: <Shield className="w-3 h-3" /> },
  manager: { color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-500/10', icon: <Star className="w-3 h-3" /> },
  operator: { color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: null },
  viewer: { color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-800', icon: null },
};

// ROLE_LABELS is built dynamically at render using t() — see getRoleLabel() call sites
const ROLE_LABEL_KEYS: Record<string, string> = {
  founder: 'integrations.team.founder',
  admin: 'integrations.team.admin',
  manager: 'integrations.team.manager',
  operator: 'integrations.team.operator',
  viewer: 'integrations.team.viewer',
};

const INTEGRATION_COLORS: Record<string, { dot: string; text: string; bg: string; icon: React.ReactNode }> = {
  revenue: { dot: 'bg-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10', icon: <CreditCard className="w-3.5 h-3.5" /> },
  cloud: { dot: 'bg-[#FF9900]', text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-500/10', icon: <Cloud className="w-3.5 h-3.5" /> },
  infra: { dot: 'bg-[#F6821F]', text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-500/10', icon: <Shield className="w-3.5 h-3.5" /> },
  deploy: { dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10', icon: <Triangle className="w-3.5 h-3.5" /> },
  monitoring: { dot: 'bg-[#362D59]', text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-500/10', icon: <Bug className="w-3.5 h-3.5" /> },
  email: { dot: 'bg-blue-400', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10', icon: <Mail className="w-3.5 h-3.5" /> },
};

// ============================================
// DEMO DATA
// ============================================
const DEMO_MEMBERS: MemberCardData[] = [
  { id: 'm1', name: 'Igor Gewehr', role: 'founder', isOnline: true, status: 'online', deploys: 8, errorsResolved: 12, lastActivity: 'Deploy saas-erp para produção', lastActivityTime: Date.now() - 1_200_000 },
  { id: 'm2', name: 'Lucas Mendes', role: 'admin', isOnline: true, status: 'busy', deploys: 4, errorsResolved: 7, lastActivity: 'Resolveu issue Sentry #241', lastActivityTime: Date.now() - 3_600_000 },
  { id: 'm3', name: 'Ana Costa', role: 'admin', isOnline: true, status: 'online', deploys: 3, errorsResolved: 5, lastActivity: 'Deploy landing-page', lastActivityTime: Date.now() - 7_200_000 },
  { id: 'm4', name: 'Rafael Santos', role: 'manager', isOnline: false, status: 'offline', deploys: 2, errorsResolved: 3, lastActivity: 'Configurou regra Cloudflare', lastActivityTime: Date.now() - 28_800_000 },
  { id: 'm5', name: 'Mariana Lima', role: 'operator', isOnline: false, status: 'offline', deploys: 1, errorsResolved: 2, lastActivity: 'Enviou email de relatório', lastActivityTime: Date.now() - 86_400_000 },
  { id: 'm6', name: 'Pedro Henrique', role: 'operator', isOnline: false, status: 'offline', deploys: 0, errorsResolved: 1, lastActivity: 'Review de custos AWS', lastActivityTime: Date.now() - 172_800_000 },
];

const DEMO_ACTIVITIES: ActivityItem[] = [
  { id: 'a1', memberName: 'Igor Gewehr', action: 'Deploy saas-erp para produção via Vercel', integration: 'deploy', timestamp: Date.now() - 1_200_000 },
  { id: 'a2', memberName: 'Lucas Mendes', action: 'Resolveu issue Sentry #241: TypeError em checkout', integration: 'monitoring', timestamp: Date.now() - 2_400_000 },
  { id: 'a3', memberName: 'Ana Costa', action: 'Configurou nova regra WAF no Cloudflare', integration: 'infra', timestamp: Date.now() - 3_600_000 },
  { id: 'a4', memberName: 'Igor Gewehr', action: 'Analisou aumento de custos EC2 na AWS', integration: 'cloud', timestamp: Date.now() - 5_400_000 },
  { id: 'a5', memberName: 'Lucas Mendes', action: 'Deploy api-gateway hotfix', integration: 'deploy', timestamp: Date.now() - 7_200_000 },
  { id: 'a6', memberName: 'Rafael Santos', action: 'Enviou email: Relatório Semanal via Resend', integration: 'email', timestamp: Date.now() - 10_800_000 },
  { id: 'a7', memberName: 'Ana Costa', action: 'Deploy landing-page v2.3 via Vercel', integration: 'deploy', timestamp: Date.now() - 14_400_000 },
  { id: 'a8', memberName: 'Mariana Lima', action: 'Revisou custos Lambda na AWS', integration: 'cloud', timestamp: Date.now() - 21_600_000 },
  { id: 'a9', memberName: 'Igor Gewehr', action: 'Assinatura Stripe recebida: R$99/mês', integration: 'revenue', timestamp: Date.now() - 28_800_000 },
  { id: 'a10', memberName: 'Pedro Henrique', action: 'Revisou alertas de custo AWS', integration: 'cloud', timestamp: Date.now() - 43_200_000 },
  { id: 'a11', memberName: 'Lucas Mendes', action: 'Resolveu 3 issues no Sentry em batch', integration: 'monitoring', timestamp: Date.now() - 57_600_000 },
  { id: 'a12', memberName: 'Ana Costa', action: 'Atualizou DNS no Cloudflare para novo domínio', integration: 'infra', timestamp: Date.now() - 72_000_000 },
  { id: 'a13', memberName: 'Igor Gewehr', action: 'Deploy fix: auth token refresh', integration: 'deploy', timestamp: Date.now() - 86_400_000 },
  { id: 'a14', memberName: 'Rafael Santos', action: 'Deploy api-gateway fix/rate-limit', integration: 'deploy', timestamp: Date.now() - 100_800_000 },
  { id: 'a15', memberName: 'Mariana Lima', action: 'Enviou email: Nota Fiscal #1247 via Resend', integration: 'email', timestamp: Date.now() - 115_200_000 },
];

const DEMO_COSTS: CostRow[] = [
  { memberId: 'm1', name: 'Igor Gewehr', awsCost: 385.20, vercelCost: 32.00, total: 417.20 },
  { memberId: 'm2', name: 'Lucas Mendes', awsCost: 272.50, vercelCost: 18.00, total: 290.50 },
  { memberId: 'm3', name: 'Ana Costa', awsCost: 195.80, vercelCost: 12.00, total: 207.80 },
  { memberId: 'm4', name: 'Rafael Santos', awsCost: 142.20, vercelCost: 8.00, total: 150.20 },
  { memberId: 'm5', name: 'Mariana Lima', awsCost: 87.60, vercelCost: 4.00, total: 91.60 },
  { memberId: 'm6', name: 'Pedro Henrique', awsCost: 45.10, vercelCost: 2.00, total: 47.10 },
];

// ============================================
// COMPONENT
// ============================================
export default function TeamTab({ integrations, members }: TeamTabProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memberCards, setMemberCards] = useState<MemberCardData[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [showAllActivities, setShowAllActivities] = useState(false);
  const VISIBLE_ACTIVITIES = 8;

  useEffect(() => {
    fetchData();
  }, [members]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    // Try to merge real member data with demo activity data
    const hasRealMembers = members && members.length > 0;

    if (!hasRealMembers && integrations.length === 0) {
      setError(t('integrations.team.demoMessage', 'Usando dados de demonstração. Adicione membros à equipe e configure integrações para dados reais.'));
    }

    // Build member cards from real members or demo
    if (hasRealMembers) {
      const cards: MemberCardData[] = members.map((m: any, i: number) => {
        const demoFallback = DEMO_MEMBERS[i % DEMO_MEMBERS.length];
        // Determine display status
        let displayStatus: 'online' | 'busy' | 'offline' = 'offline';
        if (m.userStatus === 'invisible') {
          displayStatus = 'offline';
        } else if (m.isOnline && m.lastSeenAt) {
          const diff = Date.now() - new Date(m.lastSeenAt).getTime();
          if (diff < 3 * 60 * 1000) {
            displayStatus = m.userStatus === 'busy' ? 'busy' : 'online';
          }
        }

        return {
          id: m.id || m.uid,
          name: m.name || 'Membro',
          role: m.role || 'viewer',
          photoURL: m.photoURL,
          isOnline: displayStatus !== 'offline',
          status: displayStatus,
          deploys: demoFallback.deploys,
          errorsResolved: demoFallback.errorsResolved,
          lastActivity: demoFallback.lastActivity,
          lastActivityTime: demoFallback.lastActivityTime,
        };
      });
      setMemberCards(cards);

      // Update costs with real names
      const costRows: CostRow[] = cards.map((card, i) => {
        const demoCost = DEMO_COSTS[i % DEMO_COSTS.length];
        return {
          ...demoCost,
          memberId: card.id,
          name: card.name,
          photoURL: card.photoURL,
        };
      });
      setCosts(costRows);

      // Update activities with real names
      const updatedActivities = DEMO_ACTIVITIES.map((activity, i) => ({
        ...activity,
        memberName: cards[i % cards.length].name,
      }));
      setActivities(updatedActivities);
    } else {
      setMemberCards(DEMO_MEMBERS);
      setActivities(DEMO_ACTIVITIES);
      setCosts(DEMO_COSTS);
    }

    setLoading(false);
  };

  // Compute KPIs
  const kpis = useMemo(() => {
    const activeMembers = memberCards.filter(m => m.status !== 'offline').length;
    const totalDeploys = memberCards.reduce((sum, m) => sum + m.deploys, 0);
    const totalErrorsResolved = memberCards.reduce((sum, m) => sum + m.errorsResolved, 0);

    return {
      activeMembers,
      totalDeploys,
      totalErrorsResolved,
      avgResponseTime: '4.2min',
    };
  }, [memberCards]);

  if (loading) return <IntegrationSkeleton rows={3} />;

  const statusDotClass: Record<string, string> = {
    online: 'bg-emerald-400',
    busy: 'bg-amber-400',
    offline: 'bg-gray-300 dark:bg-gray-600',
  };

  const statusLabel: Record<string, string> = {
    online: t('integrations.team.online', 'Online'),
    busy: t('integrations.team.busy', 'Ocupado'),
    offline: t('integrations.team.offline', 'Offline'),
  };

  const visibleActivities = showAllActivities ? activities : activities.slice(0, VISIBLE_ACTIVITIES);
  const totalCosts = costs.reduce((sum, c) => sum + c.total, 0);

  return (
    <div className="space-y-6">
      {error && <DemoDataBanner message={error} />}

      {/* Team Health KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title={t('integrations.kpi.activeMembers', 'Membros Ativos')}
          value={kpis.activeMembers.toString()}
          subtitle={t('integrations.kpi.ofTotal', 'de {{count}} total', { count: memberCards.length })}
          icon={<Users className="w-4 h-4" />}
          color="emerald"
          delay={0}
        />
        <KPICard
          title={t('integrations.kpi.deploysWeek', 'Deploys (Semana)')}
          value={kpis.totalDeploys.toString()}
          subtitle={t('integrations.kpi.viaVercel', 'via Vercel')}
          icon={<Rocket className="w-4 h-4" />}
          color="blue"
          delay={0.05}
        />
        <KPICard
          title={t('integrations.kpi.errorsResolved', 'Erros Resolvidos')}
          value={kpis.totalErrorsResolved.toString()}
          subtitle={t('integrations.kpi.viaSentry', 'via Sentry')}
          icon={<Bug className="w-4 h-4" />}
          color="violet"
          delay={0.1}
        />
        <KPICard
          title={t('integrations.kpi.responseTime', 'Tempo de Resposta')}
          value={kpis.avgResponseTime}
          subtitle={t('integrations.kpi.avgSupport', 'média suporte')}
          icon={<Clock className="w-4 h-4" />}
          color="amber"
          delay={0.15}
        />
      </div>

      {/* Member Cards Grid */}
      <div>
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-500" />
          {t('integrations.team.teamSection', 'Equipe')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {memberCards.map((member, i) => {
            const roleCfg = ROLE_BADGE_CONFIG[member.role] || ROLE_BADGE_CONFIG.viewer;
            const initials = (member.name || '?').split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

            return (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.06 }}
                whileHover={{ y: -3, transition: { duration: 0.2 } }}
                className="surface rounded-2xl overflow-hidden"
              >
                {/* Header */}
                <div className="p-4 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      {member.photoURL ? (
                        <img
                          src={member.photoURL}
                          alt={member.name}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-sm font-bold">
                          {initials}
                        </div>
                      )}
                      <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-900 ${statusDotClass[member.status]}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">{member.name}</span>
                        <span className="text-[10px] text-gray-400">{statusLabel[member.status]}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md flex items-center gap-1 ${roleCfg.bg} ${roleCfg.color}`}>
                          {roleCfg.icon}
                          {ROLE_LABEL_KEYS[member.role] ? t(ROLE_LABEL_KEYS[member.role], member.role) : member.role}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-[11px] text-gray-400 mb-2 font-medium">{t('integrations.team.thisWeek', 'Esta Semana')}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Rocket className="w-3 h-3 text-amber-400" />
                      <span className="text-xs text-gray-600 dark:text-gray-400">{t('integrations.team.deploys', '{{count}} deploys', { count: member.deploys })}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Bug className="w-3 h-3 text-violet-400" />
                      <span className="text-xs text-gray-600 dark:text-gray-400">{t('integrations.team.errorsFixed', '{{count}} erros fix', { count: member.errorsResolved })}</span>
                    </div>
                  </div>
                </div>

                {/* Last Activity */}
                <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-gray-400" />
                    <span className="text-[11px] text-gray-400 truncate">
                      {member.lastActivity} · {timeAgoShort(member.lastActivityTime)}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="surface rounded-2xl p-5">
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-500" />
          {t('integrations.team.activityTimeline', 'Timeline de Atividades')}
        </h3>
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gray-200 dark:bg-gray-700" />

          <div className="space-y-1">
            {visibleActivities.map((activity, i) => {
              const integrationCfg = INTEGRATION_COLORS[activity.integration];
              return (
                <motion.div
                  key={activity.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-start gap-3 py-2 pl-0 pr-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors relative"
                >
                  {/* Timeline dot */}
                  <div className={`w-[30px] flex-shrink-0 flex items-center justify-center relative z-10`}>
                    <div className={`w-[30px] h-[30px] rounded-full flex items-center justify-center ${integrationCfg.bg}`}>
                      <span className={integrationCfg.text}>{integrationCfg.icon}</span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{activity.memberName}</span>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">{activity.action}</p>
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 pt-0.5">{timeAgoShort(activity.timestamp)}</span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {activities.length > VISIBLE_ACTIVITIES && (
          <motion.button
            onClick={() => setShowAllActivities(!showAllActivities)}
            className="mt-3 w-full py-2.5 rounded-xl text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5"
            whileTap={{ scale: 0.98 }}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAllActivities ? 'rotate-180' : ''}`} />
            {showAllActivities ? t('integrations.team.showLess', 'Mostrar menos') : t('integrations.team.loadMore', 'Carregar mais ({{count}})', { count: activities.length - VISIBLE_ACTIVITIES })}
          </motion.button>
        )}
      </div>

      {/* Cost Attribution Table */}
      <div className="surface rounded-2xl p-5">
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-500" />
          {t('integrations.team.costAttribution', 'Atribuição de Custos')}
          <span className="text-[11px] font-normal text-gray-400 ml-auto">{t('integrations.team.thisMonth', 'este mês')}</span>
        </h3>

        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                <th className="text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400 pb-3 pr-4">{t('integrations.team.memberColumn', 'Membro')}</th>
                <th className="text-right text-[11px] font-semibold text-gray-500 dark:text-gray-400 pb-3 px-3">
                  <span className="flex items-center justify-end gap-1">
                    <Cloud className="w-3 h-3 text-[#FF9900]" />
                    AWS
                  </span>
                </th>
                <th className="text-right text-[11px] font-semibold text-gray-500 dark:text-gray-400 pb-3 px-3">
                  <span className="flex items-center justify-end gap-1">
                    <Triangle className="w-3 h-3" />
                    Vercel
                  </span>
                </th>
                <th className="text-right text-[11px] font-bold text-gray-700 dark:text-gray-300 pb-3 pl-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((row, i) => {
                const initials = (row.name || '?').split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
                return (
                  <motion.tr
                    key={row.memberId}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2.5">
                        {row.photoURL ? (
                          <CachedImage src={row.photoURL} alt={row.name} className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-700 flex items-center justify-center text-white text-[10px] font-bold">
                            {initials}
                          </div>
                        )}
                        <span className="text-sm text-gray-800 dark:text-gray-200 font-medium">{row.name}</span>
                      </div>
                    </td>
                    <td className="text-right text-xs text-gray-600 dark:text-gray-400 py-3 px-3">{formatUSD(row.awsCost)}</td>
                    <td className="text-right text-xs text-gray-600 dark:text-gray-400 py-3 px-3">{formatUSD(row.vercelCost)}</td>
                    <td className="text-right text-sm font-bold text-gray-900 dark:text-white py-3 pl-3">{formatUSD(row.total)}</td>
                  </motion.tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 dark:border-gray-700">
                <td className="py-3 pr-4">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{t('integrations.team.total', 'Total')}</span>
                </td>
                <td className="text-right text-xs font-semibold text-gray-700 dark:text-gray-300 py-3 px-3">
                  {formatUSD(costs.reduce((s, c) => s + c.awsCost, 0))}
                </td>
                <td className="text-right text-xs font-semibold text-gray-700 dark:text-gray-300 py-3 px-3">
                  {formatUSD(costs.reduce((s, c) => s + c.vercelCost, 0))}
                </td>
                <td className="text-right text-sm font-bold text-gray-900 dark:text-white py-3 pl-3">
                  {formatUSD(totalCosts)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
