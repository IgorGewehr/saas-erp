'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign, TrendingUp, TrendingDown, Users, AlertTriangle,
  ArrowUpRight, ArrowDownRight, RefreshCw, CreditCard, Activity,
  ArrowRight, Clock, Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IntegrationConfig } from '@/lib/types';
import KPICard from '../shared/KPICard';
import DemoDataBanner from '../shared/DemoDataBanner';
import IntegrationSkeleton from '../shared/IntegrationSkeleton';
import ProgressBar from '../shared/ProgressBar';
import { formatCurrency, formatUSD, formatNumber, formatPercent, timeAgo, timeAgoShort } from '../shared/utils';

// ============================================
// TYPES
// ============================================
interface RevenueTabProps {
  stripeConfig: IntegrationConfig | null;
  members: any[];
}

interface ProductRevenue {
  name: string;
  subs: number;
  mrr: number;
  pct: number;
  growth: number;
}

interface ChargeEntry {
  customer: string;
  amount: number;
  status: string;
  time: number;
}

interface RefundEntry {
  customer: string;
  amount: number;
  reason: string;
  time: number;
}

interface RevenueData {
  mrr: number;
  mrrChange: number;
  arr: number;
  netRevenue: number;
  refunds: number;
  disputes: number;
  churnRate: number;
  churnChange: number;
  products: ProductRevenue[];
  subscriptions: { trialing: number; active: number; pastDue: number; canceled: number };
  recentCharges: ChargeEntry[];
  recentRefunds: RefundEntry[];
}

// ============================================
// DEMO DATA
// ============================================
const DEMO: RevenueData = {
  mrr: 28750, mrrChange: 12.5, arr: 345000,
  netRevenue: 32400, refunds: 1200, disputes: 450,
  churnRate: 2.1, churnChange: -0.3,
  products: [
    { name: 'Plano Pro', subs: 89, mrr: 17822, pct: 62, growth: 15.2 },
    { name: 'Plano Business', subs: 34, mrr: 8466, pct: 29, growth: 8.7 },
    { name: 'Plano Starter', subs: 19, mrr: 2462, pct: 9, growth: -2.1 },
  ],
  subscriptions: { trialing: 8, active: 142, pastDue: 3, canceled: 12 },
  recentCharges: [
    { customer: 'empresa@saas.com', amount: 29900, status: 'succeeded', time: Date.now() - 3600000 },
    { customer: 'startup@tech.io', amount: 9900, status: 'succeeded', time: Date.now() - 7200000 },
    { customer: 'dev@code.com', amount: 4900, status: 'succeeded', time: Date.now() - 14400000 },
    { customer: 'user@app.co', amount: 9900, status: 'succeeded', time: Date.now() - 28800000 },
  ],
  recentRefunds: [
    { customer: 'ex@user.com', amount: -4900, reason: 'Cancelamento', time: Date.now() - 86400000 },
    { customer: 'outro@user.com', amount: -9900, reason: 'Duplicado', time: Date.now() - 172800000 },
  ],
};

// ============================================
// PRODUCT COLORS
// ============================================
const PRODUCT_COLORS = [
  'bg-violet-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
];

const PRODUCT_GRADIENTS = [
  'from-violet-500 to-purple-500',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
];

// ============================================
// COMPONENT
// ============================================
export default function RevenueTab({ stripeConfig, members }: RevenueTabProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      if (!stripeConfig?.apiKey) throw new Error('Stripe não configurada');

      const res = await fetch('/api/integrations/stripe', {
        headers: { 'x-api-key': stripeConfig.apiKey },
      });
      if (!res.ok) throw new Error('Falha ao buscar dados da Stripe');
      const result = await res.json();

      setData({
        mrr: result.mrr || DEMO.mrr,
        mrrChange: result.mrrGrowth || DEMO.mrrChange,
        arr: (result.mrr || DEMO.mrr) * 12,
        netRevenue: result.revenue?.thisMonth || DEMO.netRevenue,
        refunds: result.refunds || DEMO.refunds,
        disputes: result.disputes?.amount || DEMO.disputes,
        churnRate: result.churnRate || DEMO.churnRate,
        churnChange: result.churnChange || DEMO.churnChange,
        products: result.products || DEMO.products,
        subscriptions: result.subscriptions || DEMO.subscriptions,
        recentCharges: result.recentCharges?.map((c: any) => ({
          customer: c.customer,
          amount: c.amount,
          status: c.status,
          time: (c.created || c.time) * (c.created ? 1000 : 1),
        })) || DEMO.recentCharges,
        recentRefunds: result.recentRefunds || DEMO.recentRefunds,
      });
    } catch (err: any) {
      setError(err.message);
      setData(DEMO);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [stripeConfig]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <IntegrationSkeleton rows={3} />;
  if (!data) return null;

  const subTotal = data.subscriptions.trialing + data.subscriptions.active + data.subscriptions.pastDue + data.subscriptions.canceled;

  // Projection helper
  const monthlyGrowthRate = data.mrrChange / 100;
  const projectMRR = (months: number) => data.mrr * Math.pow(1 + monthlyGrowthRate, months);

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

      {/* ========== 1. Revenue KPIs ========== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title={t('integrations.kpi.mrr', 'MRR')}
          value={formatCurrency(data.mrr)}
          change={data.mrrChange}
          icon={<DollarSign className="w-4 h-4" />}
          color="violet"
          delay={0}
        />
        <KPICard
          title={t('integrations.kpi.arr', 'ARR')}
          value={formatCurrency(data.arr)}
          subtitle={t('integrations.kpi.arrSubtitle', 'MRR x 12')}
          icon={<TrendingUp className="w-4 h-4" />}
          color="blue"
          delay={0.05}
        />
        <KPICard
          title={t('integrations.kpi.netRevenue', 'Receita Liq. Mês')}
          value={formatCurrency(data.netRevenue - data.refunds - data.disputes)}
          subtitle={t('integrations.revenue.grossRevenue', 'Bruto {{value}} - devol. {{deductions}}', {
            value: formatCurrency(data.netRevenue),
            deductions: formatCurrency(data.refunds + data.disputes),
          })}
          icon={<CreditCard className="w-4 h-4" />}
          color="emerald"
          delay={0.1}
        />
        <KPICard
          title={t('integrations.kpi.churnRate', 'Churn Rate')}
          value={`${data.churnRate.toFixed(1)}%`}
          change={data.churnChange}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={data.churnRate > 5 ? 'red' : 'amber'}
          warning={data.churnRate > 5}
          delay={0.15}
        />
      </div>

      {/* ========== 2. Revenue by Product ========== */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="surface rounded-2xl p-5"
      >
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-5 flex items-center gap-2">
          <Activity className="w-4 h-4 text-violet-500" />
          {t('integrations.revenue.revenueByProduct', 'Receita por Produto')}
        </h3>

        {/* Stacked bar */}
        <div className="h-4 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex mb-5">
          {data.products.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ width: 0 }}
              animate={{ width: `${p.pct}%` }}
              transition={{ duration: 0.8, delay: 0.3 + i * 0.1, ease: 'easeOut' }}
              className={`h-full ${PRODUCT_COLORS[i % PRODUCT_COLORS.length]} ${i === 0 ? 'rounded-l-full' : ''} ${i === data.products.length - 1 ? 'rounded-r-full' : ''}`}
            />
          ))}
        </div>

        {/* Product rows */}
        <div className="space-y-3">
          {data.products.map((product, i) => (
            <motion.div
              key={product.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + i * 0.06 }}
              className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${PRODUCT_COLORS[i % PRODUCT_COLORS.length]}`} />
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{product.name}</span>
                  <span className="text-[11px] text-gray-400 ml-2">{t('integrations.revenue.subscriptions', '{{count}} assinaturas', { count: product.subs })}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(product.mrr)}</span>
                <span className="text-[11px] text-gray-400 w-10 text-right">{product.pct}%</span>
                <div className={`flex items-center gap-0.5 text-[11px] font-medium ${product.growth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  {product.growth >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {formatPercent(product.growth)}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ========== 3. Subscription Health Funnel ========== */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="surface rounded-2xl p-5"
      >
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-5 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-500" />
          {t('integrations.revenue.subscriptionHealth', 'Saúde das Assinaturas')}
        </h3>

        <div className="flex items-center gap-2 lg:gap-4 overflow-x-auto pb-2">
          {[
            { label: t('integrations.revenue.trialing', 'Trialing'), value: data.subscriptions.trialing, color: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400' },
            { label: t('integrations.revenue.active', 'Ativas'), value: data.subscriptions.active, color: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400' },
            { label: t('integrations.revenue.pastDue', 'Vencidas'), value: data.subscriptions.pastDue, color: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400' },
            { label: t('integrations.revenue.canceled', 'Canceladas'), value: data.subscriptions.canceled, color: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-400' },
          ].map((stage, i, arr) => {
            const pct = subTotal > 0 ? ((stage.value / subTotal) * 100) : 0;
            return (
              <React.Fragment key={stage.label}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.35 + i * 0.08 }}
                  className={`flex-1 min-w-[100px] rounded-2xl p-4 ${stage.bg}`}
                >
                  <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">{stage.label}</p>
                  <p className={`text-2xl font-bold ${stage.text}`}>{stage.value}</p>
                  <div className="mt-2 h-1.5 rounded-full bg-white/50 dark:bg-gray-800/50 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, delay: 0.45 + i * 0.1 }}
                      className={`h-full rounded-full ${stage.color}`}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">{pct.toFixed(1)}% do total</p>
                </motion.div>
                {i < arr.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-gray-300 dark:text-gray-600 flex-shrink-0 hidden lg:block" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </motion.div>

      {/* ========== 4. Cash Flow ========== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Entradas */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="surface rounded-2xl p-5"
        >
          <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <ArrowDownRight className="w-4 h-4 text-emerald-500" />
            {t('integrations.revenue.cashIn', 'Entradas')}
          </h3>
          <div className="space-y-2">
            {data.recentCharges.map((charge, i) => (
              <motion.div
                key={`${charge.customer}-${i}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.45 + i * 0.05 }}
                className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${charge.status === 'succeeded' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{charge.customer}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    +{formatCurrency(charge.amount / 100)}
                  </span>
                  <span className="text-[11px] text-gray-400">{timeAgoShort(charge.time)}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Saidas */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="surface rounded-2xl p-5"
        >
          <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-red-500" />
            {t('integrations.revenue.cashOut', 'Saídas')}
          </h3>
          <div className="space-y-2">
            {data.recentRefunds.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">{t('integrations.revenue.noRefunds', 'Nenhuma devolução recente')}</p>
            ) : (
              data.recentRefunds.map((refund, i) => (
                <motion.div
                  key={`${refund.customer}-${i}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.05 }}
                  className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-2 h-2 rounded-full flex-shrink-0 bg-red-400" />
                    <div className="min-w-0">
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate block">{refund.customer}</span>
                      <span className="text-[11px] text-gray-400">{refund.reason}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-semibold text-red-500 dark:text-red-400">
                      {formatCurrency(Math.abs(refund.amount) / 100)}
                    </span>
                    <span className="text-[11px] text-gray-400">{timeAgoShort(refund.time)}</span>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </motion.div>
      </div>

      {/* ========== 5. Revenue Projections ========== */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="surface rounded-2xl p-5"
      >
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-violet-500" />
          {t('integrations.revenue.revenueProjection', 'Projeção de Receita')}
        </h3>
        <p className="text-[12px] text-gray-400 mb-5">
          {t('integrations.revenue.ifGrowthMaintained', 'Se o crescimento atual de {{rate}} ao mês se mantiver...', { rate: formatPercent(data.mrrChange) })}
        </p>

        <div className="relative">
          {/* Timeline line */}
          <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-100 dark:bg-gray-800 rounded-full" />

          <div className="grid grid-cols-4 gap-2 relative">
            {[
              { label: t('integrations.revenue.today', 'Hoje'), months: 0, active: true },
              { label: t('integrations.revenue.months3', '3 meses'), months: 3, active: false },
              { label: t('integrations.revenue.months6', '6 meses'), months: 6, active: false },
              { label: t('integrations.revenue.months12', '12 meses'), months: 12, active: false },
            ].map((point, i) => (
              <motion.div
                key={point.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 + i * 0.08 }}
                className="flex flex-col items-center text-center"
              >
                <div className={`w-3 h-3 rounded-full z-10 mb-3 ${point.active ? 'bg-violet-500 ring-4 ring-violet-500/20' : 'bg-gray-300 dark:bg-gray-600'}`} />
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {formatCurrency(projectMRR(point.months))}
                </span>
                <span className="text-[11px] text-gray-400 mt-0.5">{point.label}</span>
                {point.months > 0 && (
                  <span className="text-[10px] text-violet-500 dark:text-violet-400 font-medium mt-0.5">
                    +{formatPercent(((projectMRR(point.months) / data.mrr) - 1) * 100)}
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
