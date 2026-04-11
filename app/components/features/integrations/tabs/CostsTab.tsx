'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign, TrendingUp, TrendingDown, Cloud, Server,
  Database, Zap, RefreshCw, AlertTriangle, Activity,
  BarChart3, ArrowUpRight, Clock,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IntegrationConfig } from '@/lib/types';
import KPICard from '../shared/KPICard';
import DemoDataBanner from '../shared/DemoDataBanner';
import IntegrationSkeleton from '../shared/IntegrationSkeleton';
import { formatUSD, formatNumber, formatPercent, timeAgoShort } from '../shared/utils';

// ============================================
// TYPES
// ============================================
interface CostsTabProps {
  awsConfig: IntegrationConfig | null;
}

interface ServiceCost {
  name: string;
  cost: number;
  icon: React.ElementType;
  color: string;
}

interface DailyCost {
  date: string;
  label: string;
  cost: number;
}

interface ForecastPoint {
  label: string;
  months: number;
  value: number;
  active: boolean;
}

interface CostsData {
  currentMonth: number;
  previousMonth: number;
  monthlyChange: number;
  forecast: number;
  topService: { name: string; cost: number };
  services: ServiceCost[];
  dailyCosts: DailyCost[];
  forecastTimeline: ForecastPoint[];
}

// ============================================
// CONSTANTS
// ============================================
const SERVICE_ICON_MAP: Record<string, React.ElementType> = {
  'EC2': Server,
  'RDS': Database,
  'S3': Cloud,
  'Lambda': Zap,
  'CloudFront': Activity,
  'ECS': Server,
  'DynamoDB': Database,
  'SQS': BarChart3,
};

const SERVICE_COLOR_MAP: Record<string, string> = {
  'EC2': 'bg-orange-500',
  'RDS': 'bg-blue-500',
  'S3': 'bg-emerald-500',
  'Lambda': 'bg-amber-500',
  'CloudFront': 'bg-violet-500',
  'ECS': 'bg-cyan-500',
  'DynamoDB': 'bg-rose-500',
  'SQS': 'bg-indigo-500',
};

// ============================================
// DEMO DATA
// ============================================
const now = Date.now();
const DAY = 86_400_000;

const DEMO_SERVICES: ServiceCost[] = [
  { name: 'EC2', cost: 1800, icon: Server, color: 'bg-orange-500' },
  { name: 'RDS', cost: 950, icon: Database, color: 'bg-blue-500' },
  { name: 'S3', cost: 420, icon: Cloud, color: 'bg-emerald-500' },
  { name: 'Lambda', cost: 380, icon: Zap, color: 'bg-amber-500' },
  { name: 'CloudFront', cost: 280, icon: Activity, color: 'bg-violet-500' },
  { name: 'ECS', cost: 210, icon: Server, color: 'bg-cyan-500' },
  { name: 'DynamoDB', cost: 130, icon: Database, color: 'bg-rose-500' },
  { name: 'SQS', cost: 80, icon: BarChart3, color: 'bg-indigo-500' },
];

const generateDailyLabel = (daysAgo: number): string => {
  const d = new Date(now - daysAgo * DAY);
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

const generateDateStr = (daysAgo: number): string => {
  return new Date(now - daysAgo * DAY).toISOString().slice(0, 10);
};

const DEMO_DAILY: DailyCost[] = [
  { date: generateDateStr(6), label: generateDailyLabel(6), cost: 128.40 },
  { date: generateDateStr(5), label: generateDailyLabel(5), cost: 142.80 },
  { date: generateDateStr(4), label: generateDailyLabel(4), cost: 135.20 },
  { date: generateDateStr(3), label: generateDailyLabel(3), cost: 158.90 },
  { date: generateDateStr(2), label: generateDailyLabel(2), cost: 147.60 },
  { date: generateDateStr(1), label: generateDailyLabel(1), cost: 139.30 },
  { date: generateDateStr(0), label: generateDailyLabel(0), cost: 98.50 },
];

const DEMO: CostsData = {
  currentMonth: 4250,
  previousMonth: 3920,
  monthlyChange: 8.4,
  forecast: 4580,
  topService: { name: 'EC2', cost: 1800 },
  services: DEMO_SERVICES,
  dailyCosts: DEMO_DAILY,
  forecastTimeline: [
    { label: 'Atual', months: 0, value: 4250, active: true },
    { label: '+1 mês', months: 1, value: 4580, active: false },
    { label: '+2 meses', months: 2, value: 4820, active: false },
    { label: '+3 meses', months: 3, value: 5050, active: false },
  ],
};

// ============================================
// COMPONENT
// ============================================
export default function CostsTab({ awsConfig }: CostsTabProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<CostsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      if (!awsConfig?.apiKey) throw new Error('AWS não configurada');

      const headers: Record<string, string> = {
        'x-api-key': awsConfig.apiKey,
      };
      if (awsConfig.metadata?.secretKey) {
        headers['x-secret-key'] = awsConfig.metadata.secretKey as string;
      }

      const res = await fetch('/api/integrations/aws', { headers });
      if (!res.ok) throw new Error('Falha ao buscar dados da AWS');
      const result = await res.json();

      const currentMonth = result.currentMonth ?? DEMO.currentMonth;
      const previousMonth = result.previousMonth ?? DEMO.previousMonth;
      const monthlyChange = previousMonth > 0
        ? ((currentMonth - previousMonth) / previousMonth) * 100
        : DEMO.monthlyChange;

      const services: ServiceCost[] = (result.services || DEMO.services).map((s: any) => ({
        name: s.name,
        cost: s.cost,
        icon: SERVICE_ICON_MAP[s.name] || Cloud,
        color: SERVICE_COLOR_MAP[s.name] || 'bg-gray-500',
      }));

      setData({
        currentMonth,
        previousMonth,
        monthlyChange,
        forecast: result.forecast ?? DEMO.forecast,
        topService: services.length > 0
          ? { name: services[0].name, cost: services[0].cost }
          : DEMO.topService,
        services: services.slice(0, 8),
        dailyCosts: result.dailyCosts?.map((d: any) => ({
          date: d.date,
          label: new Date(d.date).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
          cost: d.cost,
        })) || DEMO.dailyCosts,
        forecastTimeline: result.forecastTimeline || DEMO.forecastTimeline,
      });
    } catch (err: any) {
      setError(err.message);
      setData(DEMO);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [awsConfig]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <IntegrationSkeleton rows={3} />;
  if (!data) return null;

  const maxServiceCost = Math.max(...data.services.map(s => s.cost), 1);
  const maxDailyCost = Math.max(...data.dailyCosts.map(d => d.cost), 1);
  const variationColor = data.monthlyChange > 0 ? 'amber' : 'emerald';

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

      {/* ========== 1. Cost KPIs ========== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title={t('integrations.kpi.currentMonthlyCost', 'Custo Mensal Atual')}
          value={formatUSD(data.currentMonth)}
          change={data.monthlyChange}
          icon={<DollarSign className="w-4 h-4" />}
          color="violet"
          delay={0}
        />
        <KPICard
          title={t('integrations.kpi.forecastNextMonth', 'Forecast Próximo Mês')}
          value={formatUSD(data.forecast)}
          subtitle={t('integrations.costs.forecastVsCurrent', '{{diff}} vs atual', {
            diff: `${data.forecast > data.currentMonth ? '+' : ''}${formatUSD(data.forecast - data.currentMonth)}`,
          })}
          icon={<TrendingUp className="w-4 h-4" />}
          color="blue"
          delay={0.05}
        />
        <KPICard
          title={t('integrations.kpi.monthlyVariation', 'Variação Mensal')}
          value={`${data.monthlyChange >= 0 ? '+' : ''}${data.monthlyChange.toFixed(1)}%`}
          subtitle={t('integrations.kpi.previousMonth', '{{value}} mês anterior', { value: formatUSD(data.previousMonth) })}
          icon={data.monthlyChange > 0 ? <ArrowUpRight className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          color={variationColor}
          delay={0.1}
          warning={data.monthlyChange > 15}
        />
        <KPICard
          title={t('integrations.kpi.topService', 'Top Serviço')}
          value={data.topService.name}
          subtitle={formatUSD(data.topService.cost)}
          icon={<Server className="w-4 h-4" />}
          color="rose"
          delay={0.15}
        />
      </div>

      {/* ========== 2. Custos por Serviço ========== */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="surface rounded-2xl p-5"
      >
        <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-5 flex items-center gap-2">
          <Cloud className="w-4 h-4 text-violet-500" />
          {t('integrations.costs.costsByService', 'Custos por Serviço')}
          <span className="text-[11px] font-normal text-gray-400 ml-auto">{t('integrations.costs.thisMonth', 'este mês')}</span>
        </h3>
        <div className="space-y-3">
          {data.services.map((service, i) => {
            const pct = maxServiceCost > 0 ? (service.cost / maxServiceCost * 100) : 0;
            const ServiceIcon = service.icon;
            return (
              <motion.div
                key={service.name}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + i * 0.06 }}
                className="flex items-center gap-3"
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${service.color} text-white flex-shrink-0`}>
                  <ServiceIcon className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs text-gray-600 dark:text-gray-400 w-20 truncate font-medium">{service.name}</span>
                <div className="flex-1 h-5 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden relative">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 + i * 0.08 }}
                    className={`h-full rounded-lg ${service.color} opacity-80 min-w-[2px]`}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                    {formatUSD(service.cost)}
                  </span>
                </div>
                <span className="text-[11px] text-gray-400 w-10 text-right flex-shrink-0">
                  {data.currentMonth > 0 ? Math.round(service.cost / data.currentMonth * 100) : 0}%
                </span>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* ========== 3. Tendência Diária + Forecast ========== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tendência Diária */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="surface rounded-2xl p-5"
        >
          <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            {t('integrations.costs.dailyTrend', 'Tendência Diária')}
            <span className="text-[11px] font-normal text-gray-400 ml-auto">{t('integrations.costs.last7Days', 'últimos 7 dias')}</span>
          </h3>
          <div className="space-y-2.5">
            {data.dailyCosts.map((day, i) => {
              const pct = maxDailyCost > 0 ? (day.cost / maxDailyCost * 100) : 0;
              const isToday = i === data.dailyCosts.length - 1;
              return (
                <motion.div
                  key={day.date}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.05 }}
                  className={`flex items-center gap-3 py-1.5 px-2 rounded-lg ${isToday ? 'bg-blue-50 dark:bg-blue-500/10' : ''}`}
                >
                  <span className={`text-[11px] w-24 truncate flex-shrink-0 ${isToday ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}>
                    {day.label}
                  </span>
                  <div className="flex-1 h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut', delay: 0.45 + i * 0.06 }}
                      className={`h-full rounded-full ${isToday ? 'bg-blue-500' : 'bg-blue-400/70 dark:bg-blue-500/60'} min-w-[2px]`}
                    />
                  </div>
                  <span className={`text-[11px] font-semibold w-16 text-right flex-shrink-0 ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>
                    {formatUSD(day.cost)}
                  </span>
                </motion.div>
              );
            })}
          </div>

          {/* Daily average */}
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-[11px] text-gray-400">{t('integrations.costs.dailyAverage', 'Média diária')}</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">
              {formatUSD(data.dailyCosts.reduce((sum, d) => sum + d.cost, 0) / Math.max(data.dailyCosts.length, 1))}
            </span>
          </div>
        </motion.div>

        {/* Forecast Timeline */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="surface rounded-2xl p-5"
        >
          <h3 className="text-sm font-semibold font-display text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-violet-500" />
            {t('integrations.costs.costProjection', 'Projeção de Custos')}
          </h3>
          <p className="text-[12px] text-gray-400 mb-5">
            {t('integrations.costs.basedOnTrend', 'Baseado na tendência atual de {{rate}} ao mês', {
              rate: `${data.monthlyChange >= 0 ? '+' : ''}${data.monthlyChange.toFixed(1)}%`,
            })}
          </p>

          <div className="relative">
            {/* Timeline line */}
            <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-100 dark:bg-gray-800 rounded-full" />

            <div className="grid grid-cols-4 gap-2 relative">
              {data.forecastTimeline.map((point, i) => (
                <motion.div
                  key={point.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 + i * 0.08 }}
                  className="flex flex-col items-center text-center"
                >
                  <div className={`w-3 h-3 rounded-full z-10 mb-3 ${point.active ? 'bg-violet-500 ring-4 ring-violet-500/20' : 'bg-gray-300 dark:bg-gray-600'}`} />
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {formatUSD(point.value)}
                  </span>
                  <span className="text-[11px] text-gray-400 mt-0.5">{point.label}</span>
                  {point.months > 0 && (
                    <span className="text-[10px] text-violet-500 dark:text-violet-400 font-medium mt-0.5">
                      {formatPercent(((point.value / data.currentMonth) - 1) * 100)}
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          </div>

          {/* Cost alert */}
          {data.monthlyChange > 10 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="mt-5 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/20"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">
                {t('integrations.costs.costsGrowingAlert', 'Custos crescendo {{rate}} ao mês. Considere revisar os recursos EC2 e RDS.', {
                  rate: `${data.monthlyChange.toFixed(1)}%`,
                })}
              </p>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
