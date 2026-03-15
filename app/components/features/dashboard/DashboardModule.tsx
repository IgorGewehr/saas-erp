'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign,
  CalendarCheck,
  Users,
  CreditCard,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  ShieldAlert,
  PackageX,
  ChevronRight,
  BarChart3,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import type { AppointmentStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCurrency, getStatusColor, getStatusLabel } from '@/lib/utils/format';
import { useTheme } from '@/app/components/providers/ThemeProvider';

// ==============================================
// MOCK DATA
// ==============================================

const mockRevenueData = {
  '7d': [
    { period: 'Seg', receita: 1200, despesa: 400 },
    { period: 'Ter', receita: 1800, despesa: 550 },
    { period: 'Qua', receita: 900, despesa: 320 },
    { period: 'Qui', receita: 2400, despesa: 680 },
    { period: 'Sex', receita: 3100, despesa: 900 },
    { period: 'Sáb', receita: 2800, despesa: 450 },
    { period: 'Dom', receita: 600, despesa: 200 },
  ],
  '30d': [
    { period: 'Sem 1', receita: 8500, despesa: 3200 },
    { period: 'Sem 2', receita: 9200, despesa: 2800 },
    { period: 'Sem 3', receita: 7800, despesa: 3500 },
    { period: 'Sem 4', receita: 11200, despesa: 4100 },
  ],
  '90d': [
    { period: 'Jan', receita: 28500, despesa: 12400 },
    { period: 'Fev', receita: 32100, despesa: 11800 },
    { period: 'Mar', receita: 35600, despesa: 13200 },
  ],
  '12m': [
    { period: 'Abr', receita: 22400, despesa: 9800 },
    { period: 'Mai', receita: 24800, despesa: 10200 },
    { period: 'Jun', receita: 27600, despesa: 11500 },
    { period: 'Jul', receita: 25900, despesa: 10800 },
    { period: 'Ago', receita: 29300, despesa: 12100 },
    { period: 'Set', receita: 31200, despesa: 11400 },
    { period: 'Out', receita: 28700, despesa: 10900 },
    { period: 'Nov', receita: 33500, despesa: 12800 },
    { period: 'Dez', receita: 38200, despesa: 14500 },
    { period: 'Jan', receita: 28500, despesa: 12400 },
    { period: 'Fev', receita: 32100, despesa: 11800 },
    { period: 'Mar', receita: 35600, despesa: 13200 },
  ],
};

const mockAppointments: {
  id: string;
  clientName: string;
  serviceName: string;
  startTime: string;
  status: AppointmentStatus;
}[] = [
  { id: '1', clientName: 'Maria Silva', serviceName: 'Corte Feminino', startTime: '09:30', status: 'confirmado' },
  { id: '2', clientName: 'João Santos', serviceName: 'Barba Completa', startTime: '10:15', status: 'agendado' },
  { id: '3', clientName: 'Ana Oliveira', serviceName: 'Coloração', startTime: '11:00', status: 'em_andamento' },
  { id: '4', clientName: 'Carlos Mendes', serviceName: 'Corte Masculino', startTime: '14:00', status: 'agendado' },
  { id: '5', clientName: 'Fernanda Lima', serviceName: 'Hidratação', startTime: '15:30', status: 'confirmado' },
];

const mockTopServices = [
  { name: 'Corte Feminino', count: 142, revenue: 14200 },
  { name: 'Coloração', count: 98, revenue: 19600 },
  { name: 'Corte Masculino', count: 87, revenue: 5220 },
  { name: 'Hidratação', count: 65, revenue: 5850 },
  { name: 'Barba Completa', count: 53, revenue: 2650 },
];

const mockAlerts = [
  {
    id: '1',
    type: 'stock' as const,
    title: 'Shampoo Profissional',
    message: 'Estoque baixo: 3 unidades restantes',
    severity: 'warning' as const,
  },
  {
    id: '2',
    type: 'payment' as const,
    title: 'Pagamento atrasado',
    message: 'Fatura de João Santos - R$ 350,00 (5 dias)',
    severity: 'error' as const,
  },
  {
    id: '3',
    type: 'certificate' as const,
    title: 'Certificado Digital',
    message: 'Expira em 15 dias - renovar agora',
    severity: 'warning' as const,
  },
  {
    id: '4',
    type: 'stock' as const,
    title: 'Tintura Loiro 7.0',
    message: 'Estoque baixo: 2 unidades restantes',
    severity: 'warning' as const,
  },
];

// ==============================================
// ANIMATION VARIANTS
// ==============================================

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] },
  },
};

const chartVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number], delay: 0.3 },
  },
};

// ==============================================
// SUBCOMPONENTS
// ==============================================

type PeriodKey = '7d' | '30d' | '90d' | '12m';

interface StatCardProps {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  subtitle: string;
  trend?: { value: number; isPositive: boolean };
}

function StatCard({ icon, iconBg, label, value, subtitle, trend }: StatCardProps) {
  return (
    <motion.div
      variants={itemVariants}
      className={cn(
        'group relative overflow-hidden rounded-xl surface stat-card-accent',
        'p-6 hover-lift cursor-default',
      )}
    >
      {/* Subtle shimmer on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/60 via-transparent to-transparent dark:from-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

      <div className="relative flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground mb-1">{label}</p>
          <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
          <div className="flex items-center gap-1.5 mt-2">
            {trend && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full',
                  trend.isPositive
                    ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10'
                    : 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-500/10',
                )}
              >
                {trend.isPositive ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {trend.value}%
              </span>
            )}
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          </div>
        </div>
        <div
          className={cn(
            'flex items-center justify-center w-11 h-11 rounded-xl',
            iconBg,
          )}
        >
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg dark:shadow-none border border-border/60 p-3 min-w-[160px]">
      <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">
              {entry.dataKey === 'receita' ? 'Receitas' : 'Despesas'}
            </span>
          </div>
          <span className="font-semibold text-foreground">{formatCurrency(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function AppointmentRow({
  appointment,
}: {
  appointment: (typeof mockAppointments)[number];
}) {
  const statusColor = getStatusColor(appointment.status);
  const statusLabel = getStatusLabel(appointment.status);

  return (
    <div className="flex items-center gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors group cursor-pointer">
      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-50 text-primary-600 font-semibold text-sm shrink-0">
        {appointment.startTime}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {appointment.clientName}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {appointment.serviceName}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full"
          style={{
            backgroundColor: `${statusColor}14`,
            color: statusColor,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          {statusLabel}
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

function ServiceRow({
  service,
  maxRevenue,
}: {
  service: (typeof mockTopServices)[number];
  maxRevenue: number;
}) {
  const proportion = maxRevenue > 0 ? (service.revenue / maxRevenue) * 100 : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{service.name}</p>
          <p className="text-xs text-muted-foreground">{service.count} atendimentos</p>
        </div>
        <span className="text-sm font-semibold text-foreground shrink-0 ml-3">
          {formatCurrency(service.revenue)}
        </span>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-400"
          initial={{ width: 0 }}
          animate={{ width: `${proportion}%` }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.5 }}
        />
      </div>
    </div>
  );
}

function AlertRow({ alert }: { alert: (typeof mockAlerts)[number] }) {
  const iconMap = {
    stock: <PackageX className="w-4 h-4" />,
    payment: <ShieldAlert className="w-4 h-4" />,
    certificate: <AlertTriangle className="w-4 h-4" />,
  };

  const severityStyles = {
    warning: {
      iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
      border: 'border-amber-100 dark:border-amber-500/20',
    },
    error: {
      iconBg: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
      border: 'border-red-100 dark:border-red-500/20',
    },
  };

  const styles = severityStyles[alert.severity];

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-muted/30',
        styles.border,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-lg shrink-0',
          styles.iconBg,
        )}
      >
        {iconMap[alert.type]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{alert.title}</p>
        <p className="text-xs text-muted-foreground truncate">{alert.message}</p>
      </div>
      <button className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 transition-colors shrink-0 px-2 py-1 rounded-md hover:bg-primary-50 dark:hover:bg-primary-500/10">
        Ver
      </button>
    </div>
  );
}

// ==============================================
// MAIN COMPONENT
// ==============================================

export default function DashboardModule() {
  const { isDark } = useTheme();
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey>('30d');

  const periodLabels: Record<PeriodKey, string> = {
    '7d': '7 dias',
    '30d': '30 dias',
    '90d': '90 dias',
    '12m': '12 meses',
  };

  const chartData = mockRevenueData[selectedPeriod];
  const maxServiceRevenue = Math.max(...mockTopServices.map((s) => s.revenue));

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Bom dia' : now.getHours() < 18 ? 'Boa tarde' : 'Boa noite';
  const todayLabel = format(now, "EEEE, d 'de' MMMM", { locale: ptBR });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Sparkles className="w-4 h-4 text-primary-500" />
            <p className="text-sm font-medium text-primary-600 capitalize">{todayLabel}</p>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-display">
            {greeting}! 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Aqui está o resumo do seu negócio hoje.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-primary-50 dark:bg-primary-500/10 border border-primary-100 dark:border-primary-500/20 text-primary-700 dark:text-primary-400">
          <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse-soft" />
          <span className="text-xs font-semibold">Ao vivo</span>
        </div>
      </div>

      {/* Stats Cards */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <StatCard
          icon={<DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
          iconBg="bg-emerald-50 dark:bg-emerald-500/10"
          label="Receita Hoje"
          value={formatCurrency(3847.5)}
          subtitle="vs. ontem"
          trend={{ value: 12.5, isPositive: true }}
        />
        <StatCard
          icon={<CalendarCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
          iconBg="bg-blue-50 dark:bg-blue-500/10"
          label="Agendamentos Hoje"
          value="14"
          subtitle="Proximo: 09:30"
          trend={{ value: 8, isPositive: true }}
        />
        <StatCard
          icon={<Users className="w-5 h-5 text-violet-600 dark:text-violet-400" />}
          iconBg="bg-violet-50 dark:bg-violet-500/10"
          label="Clientes Ativos"
          value="248"
          subtitle="+12 este mes"
        />
        <StatCard
          icon={<CreditCard className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
          iconBg="bg-amber-50 dark:bg-amber-500/10"
          label="Pagamentos Pendentes"
          value={formatCurrency(4320.0)}
          subtitle="6 pendentes"
          trend={{ value: 3.2, isPositive: false }}
        />
      </motion.div>

      {/* Revenue Chart */}
      <motion.div
        variants={chartVariants}
        initial="hidden"
        animate="visible"
        className="surface surface-hover rounded-xl p-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">Receitas vs Despesas</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Acompanhe o fluxo financeiro do periodo
            </p>
          </div>
          <div className="flex items-center gap-1 bg-muted/60 rounded-lg p-1">
            {(Object.keys(periodLabels) as PeriodKey[]).map((period) => (
              <button
                key={period}
                onClick={() => setSelectedPeriod(period)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200',
                  selectedPeriod === period
                    ? 'bg-white dark:bg-gray-800 text-foreground shadow-sm dark:shadow-none'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {periodLabels[period]}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="gradientReceita" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#DC2626" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#DC2626" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradientDespesa" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6B7280" stopOpacity={0.12} />
                  <stop offset="100%" stopColor="#6B7280" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={isDark ? '#374151' : '#E5E7EB'}
                vertical={false}
              />
              <XAxis
                dataKey="period"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: isDark ? '#6B7280' : '#9CA3AF' }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: isDark ? '#6B7280' : '#9CA3AF' }}
                tickFormatter={(value: number) =>
                  value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value)
                }
              />
              <RechartsTooltip
                content={<ChartTooltipContent />}
                cursor={{ stroke: isDark ? '#374151' : '#E5E7EB', strokeWidth: 1 }}
              />
              <Area
                type="monotone"
                dataKey="receita"
                stroke="#DC2626"
                strokeWidth={2}
                fill="url(#gradientReceita)"
                dot={false}
                activeDot={{ r: 4, fill: '#DC2626', stroke: '#fff', strokeWidth: 2 }}
              />
              <Area
                type="monotone"
                dataKey="despesa"
                stroke="#9CA3AF"
                strokeWidth={2}
                fill="url(#gradientDespesa)"
                dot={false}
                activeDot={{ r: 4, fill: '#9CA3AF', stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Chart Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-border/40">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#DC2626]" />
            <span className="text-xs text-muted-foreground font-medium">Receitas</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#9CA3AF]" />
            <span className="text-xs text-muted-foreground font-medium">Despesas</span>
          </div>
        </div>
      </motion.div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Upcoming Appointments */}
        <motion.div
          variants={chartVariants}
          initial="hidden"
          animate="visible"
          className="surface surface-hover rounded-xl p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">
                Proximos Agendamentos
              </h2>
            </div>
            <button className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 transition-colors px-2 py-1 rounded-md hover:bg-primary-50 dark:hover:bg-primary-500/10">
              Ver todos
            </button>
          </div>
          <div className="space-y-1">
            {mockAppointments.map((appointment) => (
              <AppointmentRow key={appointment.id} appointment={appointment} />
            ))}
          </div>
        </motion.div>

        {/* Right: Top Services */}
        <motion.div
          variants={chartVariants}
          initial="hidden"
          animate="visible"
          className="surface surface-hover rounded-xl p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">
                Top Servicos
              </h2>
            </div>
            <span className="text-xs text-muted-foreground">Este mes</span>
          </div>
          <div className="space-y-5">
            {mockTopServices.map((service) => (
              <ServiceRow
                key={service.name}
                service={service}
                maxRevenue={maxServiceRevenue}
              />
            ))}
          </div>
        </motion.div>
      </div>

      {/* Bottom Row: Alerts */}
      <motion.div
        variants={chartVariants}
        initial="hidden"
        animate="visible"
        className="surface surface-hover rounded-xl p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h2 className="text-base font-semibold text-foreground">Alertas</h2>
          </div>
          <span className="text-xs font-medium text-muted-foreground px-2 py-1 bg-muted/60 rounded-full">
            {mockAlerts.length} pendentes
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {mockAlerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </div>
      </motion.div>
    </div>
  );
}
