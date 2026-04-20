'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { useTranslation } from 'react-i18next';
import type { Appointment, CRMContact, Sale, Transaction, DeliveryOrder, KanbanCard, UseCase } from '@/lib/types';
import { DELIVERY_ORDER_STATUS_LABELS } from '@/lib/types';
import {
  Users,
  CalendarCheck,
  CalendarClock,
  Search,
  ChevronRight,
  User as UserIcon,
  MessageSquare,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
  UserPlus,
  CalendarPlus,
  ShoppingBag,
  Clock,
  Wallet,
  AlertTriangle,
  ClipboardCheck,
  Kanban as KanbanIcon,
  Bike,
  Timer,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { enUS as enUSLocale } from 'date-fns/locale';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { formatCurrency, formatPhone, getInitials } from '@/lib/utils/format';

// ─── Animation ─────────────────────────────────────────
const stagger = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 16, filter: 'blur(4px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] } },
};

// ─── Main Component ────────────────────────────────────
export default function DashboardModule() {
  const { t, i18n } = useTranslation();
  const { user, business } = useAuth();
  const { setActivePage } = useAppContext();
  const [clientSearch, setClientSearch] = useState('');
  const dateLocale = i18n.language === 'en-US' ? enUSLocale : ptBR;

  // ── Use case driven visibility ─────────────────────────
  const useCase: UseCase = (business?.settings?.useCase as UseCase) || 'servicos';
  const showAgenda = useCase === 'servicos';
  const showOrders = useCase === 'pedidos';
  const showTasks = useCase === 'times';
  const showRevenue = useCase !== 'times';
  const showFinancial = useCase !== 'times';

  // ── Firestore queries ──
  const { data: clients = [], isLoading: loadingClients } = useQuery({
    queryKey: ['clients', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'clients'), where('businessId', '==', business!.id), orderBy('name', 'asc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as CRMContact));
    },
    enabled: !!business?.id,
  });

  const { data: appointments = [], isLoading: loadingAppointments } = useQuery({
    queryKey: ['appointments', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'appointments'), where('businessId', '==', business!.id), orderBy('date', 'asc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Appointment));
    },
    enabled: !!business?.id,
  });

  const { data: sales = [], isLoading: loadingSales } = useQuery({
    queryKey: ['sales', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'sales'), where('businessId', '==', business!.id), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Sale));
    },
    enabled: !!business?.id,
  });

  const { data: transactions = [], isLoading: loadingTransactions } = useQuery({
    queryKey: ['transactions', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'transactions'), where('businessId', '==', business!.id), orderBy('dueDate', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Transaction));
    },
    enabled: !!business?.id,
  });

  const { data: deliveryOrders = [] } = useQuery({
    queryKey: ['delivery-orders-dashboard', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'deliveryOrders'), where('businessId', '==', business!.id), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as DeliveryOrder));
    },
    enabled: !!business?.id && showOrders,
    staleTime: 60 * 1000,
  });

  const { data: kanbanCards = [] } = useQuery({
    queryKey: ['kanban-cards-dashboard', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'kanbanCards'), where('businessId', '==', business!.id));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as KanbanCard));
    },
    enabled: !!business?.id && showTasks,
    staleTime: 60 * 1000,
  });

  // ── Computed data ──
  const todayStr = new Date().toISOString().split('T')[0];

  const todayAppointments = useMemo(
    () => appointments.filter(a => a.date === todayStr && a.status !== 'cancelado'),
    [appointments, todayStr]
  );

  const nextAppointment = useMemo(() => {
    const nowStr = new Date().toTimeString().slice(0, 5); // "HH:mm"
    return [...appointments]
      .filter(a => a.status !== 'cancelado' && a.status !== 'concluido')
      .filter(a => a.date > todayStr || (a.date === todayStr && a.startTime >= nowStr))
      .sort((a, b) => a.date === b.date ? (a.startTime || '').localeCompare(b.startTime || '') : a.date.localeCompare(b.date))
      [0] || null;
  }, [appointments, todayStr]);

  const upcomingCount = useMemo(
    () => appointments.filter(a =>
      a.date >= todayStr && a.status !== 'cancelado' && a.status !== 'concluido'
    ).length,
    [appointments, todayStr]
  );

  const activeClients = useMemo(
    () => clients.filter(c => c.isActive).length,
    [clients]
  );

  // ── Revenue KPIs ──
  const todaySales = useMemo(
    () => sales.filter(s => s.status === 'finalizada' && s.createdAt?.startsWith(todayStr)),
    [sales, todayStr]
  );

  const todayRevenue = useMemo(
    () => todaySales.reduce((sum, s) => sum + s.total, 0),
    [todaySales]
  );

  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }, []);

  const yesterdayRevenue = useMemo(
    () => sales
      .filter(s => s.status === 'finalizada' && s.createdAt?.startsWith(yesterdayStr))
      .reduce((sum, s) => sum + s.total, 0),
    [sales, yesterdayStr]
  );

  const revenueChange = useMemo(() => {
    if (yesterdayRevenue === 0) return todayRevenue > 0 ? 100 : 0;
    return Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100);
  }, [todayRevenue, yesterdayRevenue]);

  const ticketMedio = useMemo(
    () => todaySales.length > 0 ? todayRevenue / todaySales.length : 0,
    [todayRevenue, todaySales]
  );

  const dailyAvg = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const isoThirty = thirtyDaysAgo.toISOString().split('T')[0];
    const recentSales = sales.filter(s => s.status === 'finalizada' && s.createdAt && s.createdAt >= isoThirty);
    if (recentSales.length === 0) return 0;
    const total = recentSales.reduce((sum, s) => sum + s.total, 0);
    const uniqueDays = new Set(recentSales.map(s => s.createdAt.split('T')[0])).size;
    return uniqueDays > 0 ? total / uniqueDays : 0;
  }, [sales]);

  const goalProgress = useMemo(
    () => dailyAvg > 0 ? Math.min((todayRevenue / dailyAvg) * 100, 100) : 0,
    [todayRevenue, dailyAvg]
  );

  // ── Monthly Revenue ──
  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const lastMonth = useMemo(() => {
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const monthlySales = useMemo(
    () => sales.filter(s => s.status === 'finalizada' && s.createdAt?.startsWith(currentMonth)),
    [sales, currentMonth]
  );

  const monthlyRevenue = useMemo(
    () => monthlySales.reduce((sum, s) => sum + s.total, 0),
    [monthlySales]
  );

  const lastMonthRevenue = useMemo(
    () => sales
      .filter(s => s.status === 'finalizada' && s.createdAt?.startsWith(lastMonth))
      .reduce((sum, s) => sum + s.total, 0),
    [sales, lastMonth]
  );

  const monthlyRevenueChange = useMemo(() => {
    if (lastMonthRevenue === 0) return monthlyRevenue > 0 ? 100 : 0;
    return Math.round(((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100);
  }, [monthlyRevenue, lastMonthRevenue]);

  // ── Financial Health ──
  const pendingTransactions = useMemo(
    () => transactions.filter(t => t.status === 'pendente'),
    [transactions]
  );

  const overdueTransactions = useMemo(
    () => transactions.filter(t => t.status === 'atrasado'),
    [transactions]
  );

  const pendingAmount = useMemo(
    () => pendingTransactions.reduce((sum, t) => sum + t.amount, 0),
    [pendingTransactions]
  );

  const overdueAmount = useMemo(
    () => overdueTransactions.reduce((sum, t) => sum + t.amount, 0),
    [overdueTransactions]
  );

  // ── Delivery Orders metrics (pedidos mode) ──
  const ordersToday = useMemo(
    () => deliveryOrders.filter(o => o.createdAt?.startsWith(todayStr)),
    [deliveryOrders, todayStr]
  );
  const ordersActive = useMemo(
    () => deliveryOrders.filter(o => o.status !== 'entregue' && o.status !== 'cancelado'),
    [deliveryOrders]
  );
  const ordersRevenueToday = useMemo(
    () => ordersToday.filter(o => o.status !== 'cancelado').reduce((s, o) => s + o.total, 0),
    [ordersToday]
  );
  const ordersUrgent = useMemo(
    () => deliveryOrders.filter(o => {
      if (o.status === 'entregue' || o.status === 'cancelado') return false;
      if (o.estimatedDeliveryAt) {
        const t = new Date(o.estimatedDeliveryAt).getTime();
        return !isNaN(t) && t < Date.now();
      }
      const created = new Date(o.createdAt).getTime();
      return !isNaN(created) && (Date.now() - created) / 60000 > 45;
    }),
    [deliveryOrders]
  );
  const ordersAvgTime = useMemo(() => {
    const delivered = ordersToday.filter(o => o.status === 'entregue' && o.deliveredAt);
    if (delivered.length === 0) return 0;
    const total = delivered.reduce((s, o) => {
      const end = new Date(o.deliveredAt as string).getTime();
      const start = new Date(o.createdAt).getTime();
      return isNaN(end) || isNaN(start) ? s : s + (end - start);
    }, 0);
    return Math.round(total / delivered.length / 60000);
  }, [ordersToday]);

  // ── Task metrics (times mode) ──
  const tasksOpen = useMemo(
    () => kanbanCards,
    [kanbanCards]
  );
  const tasksAssignedToMe = useMemo(
    () => tasksOpen.filter(c => (c.assigneeIds || []).includes(user?.uid || '')),
    [tasksOpen, user?.uid]
  );
  const tasksOverdue = useMemo(
    () => tasksOpen.filter(c => c.dueDate && c.dueDate < todayStr),
    [tasksOpen, todayStr]
  );

  // ── Today's Schedule ──
  const todaySchedule = useMemo(
    () => appointments
      .filter(a => a.date === todayStr && a.status !== 'cancelado')
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [appointments, todayStr]
  );

  // ── Client search/filter ──
  const filteredClients = useMemo(() => {
    const term = clientSearch.toLowerCase().trim();
    const list = term.length >= 1
      ? clients.filter(c =>
          c.name?.toLowerCase().includes(term) ||
          c.cpfCnpj?.includes(term) ||
          c.email?.toLowerCase().includes(term) ||
          c.phone?.includes(term)
        )
      : clients;
    return list.slice(0, 8);
  }, [clients, clientSearch]);

  const clientNextAppointment = useMemo(() => {
    const map: Record<string, Appointment> = {};
    for (const a of appointments) {
      if (a.date >= todayStr && a.status !== 'cancelado' && a.status !== 'concluido') {
        if (!map[a.clientId] || a.date < map[a.clientId].date) {
          map[a.clientId] = a;
        }
      }
    }
    return map;
  }, [appointments, todayStr]);

  // ── Header data ──
  const hour = new Date().getHours();
  const greeting = hour < 12
    ? t('dashboard.goodMorning', 'Bom dia')
    : hour < 18
      ? t('dashboard.goodAfternoon', 'Boa tarde')
      : t('dashboard.goodEvening', 'Boa noite');
  const firstName = user?.name?.split(' ')[0] || '';
  const isLoading = loadingClients || loadingAppointments || loadingSales || loadingTransactions;

  // ── Render ──
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      {/* ━━━ Welcome Header + Quick Actions ━━━ */}
      <motion.div variants={fadeUp} className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white font-display">
            {greeting},{' '}
            <span className="bg-gradient-to-r from-red-600 to-red-500 bg-clip-text text-transparent">
              {firstName}
            </span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 capitalize">
            {i18n.language === 'en-US'
              ? format(new Date(), 'EEEE, MMMM d', { locale: dateLocale })
              : format(new Date(), "EEEE, d 'de' MMMM", { locale: dateLocale })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[
            { label: t('dashboard.newClient', 'Novo Cliente'), icon: UserPlus, page: 'CRM' as const },
            { label: t('dashboard.schedule', 'Agendar'), icon: CalendarPlus, page: 'Agenda' as const },
            { label: t('dashboard.newSale', 'Nova Venda'), icon: ShoppingBag, page: 'PDV' as const },
          ].map((action) => (
            <motion.button
              key={action.label}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setActivePage(action.page)}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium',
                'bg-white dark:bg-gray-800/60',
                'border border-gray-200 dark:border-gray-700/50',
                'text-gray-600 dark:text-gray-300',
                'hover:border-red-300 dark:hover:border-red-500/30',
                'hover:text-red-600 dark:hover:text-red-400',
                'shadow-sm hover:shadow',
                'transition-all duration-200',
              )}
            >
              <action.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{action.label}</span>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* ━━━ Hero Row: Revenue Today + Monthly Revenue + Mode-specific card ━━━ */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Revenue Today Card — oculto em modo times */}
        {showRevenue && (
        <motion.div
          variants={fadeUp}
          className={cn(
            'md:col-span-4 rounded-2xl p-5',
            'bg-white dark:bg-gray-800/60',
            'border border-gray-100 dark:border-gray-700/50',
            'shadow-sm',
          )}
        >
          {loadingSales ? (
            <div className="space-y-3">
              <div className="flex justify-between">
                <div className="h-4 w-24 rounded-md shimmer" />
                <div className="h-8 w-8 rounded-lg shimmer" />
              </div>
              <div className="h-10 w-28 rounded-md shimmer mt-2" />
              <div className="h-2 w-full rounded-full shimmer mt-3" />
              <div className="h-3 w-32 rounded-md shimmer" />
            </div>
          ) : (
            <div className="flex flex-col justify-between h-full">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('dashboard.revenueToday', 'Receita hoje')}</p>
                <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                  <DollarSign className="w-[18px] h-[18px] text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>

              <div className="mt-2">
                <div className="flex items-baseline gap-2.5">
                  <p className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                    {formatCurrency(todayRevenue)}
                  </p>
                  {revenueChange !== 0 && (
                    <span className={cn(
                      'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full',
                      revenueChange > 0
                        ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10'
                        : 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-500/10',
                    )}>
                      {revenueChange > 0
                        ? <TrendingUp className="w-3 h-3" />
                        : <TrendingDown className="w-3 h-3" />
                      }
                      {revenueChange > 0 ? '+' : ''}{revenueChange}%
                    </span>
                  )}
                </div>

                {dailyAvg > 0 && (
                  <div className="mt-3">
                    <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                        initial={{ width: 0 }}
                        animate={{ width: `${goalProgress}%` }}
                        transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.3 }}
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
                      {t('dashboard.dailyGoal', 'Meta diária')}: {formatCurrency(dailyAvg)}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/30">
                  <div className="flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {todaySales.length} {todaySales.length !== 1 ? t('dashboard.sales', 'vendas') : t('dashboard.sale', 'venda')}
                    </span>
                  </div>
                  {ticketMedio > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400 dark:text-gray-500">{t('dashboard.ticket', 'Ticket')}:</span>
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        {formatCurrency(ticketMedio)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </motion.div>
        )}

        {/* Monthly Revenue Card — oculto em modo times */}
        {showRevenue && (
        <motion.div
          variants={fadeUp}
          className={cn(
            'md:col-span-3 rounded-2xl p-5',
            'bg-white dark:bg-gray-800/60',
            'border border-gray-100 dark:border-gray-700/50',
            'shadow-sm',
          )}
        >
          {loadingSales ? (
            <div className="space-y-3">
              <div className="flex justify-between">
                <div className="h-4 w-24 rounded-md shimmer" />
                <div className="h-8 w-8 rounded-lg shimmer" />
              </div>
              <div className="h-8 w-24 rounded-md shimmer mt-2" />
              <div className="h-3 w-20 rounded-md shimmer mt-2" />
            </div>
          ) : (
            <div className="flex flex-col justify-between h-full">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('dashboard.revenueMonth', 'Receita do mês')}</p>
                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                  <Wallet className="w-[18px] h-[18px] text-blue-600 dark:text-blue-400" />
                </div>
              </div>

              <div className="mt-2">
                <div className="flex items-baseline gap-2.5">
                  <p className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
                    {formatCurrency(monthlyRevenue)}
                  </p>
                  {monthlyRevenueChange !== 0 && (
                    <span className={cn(
                      'inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full',
                      monthlyRevenueChange > 0
                        ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10'
                        : 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-500/10',
                    )}>
                      {monthlyRevenueChange > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {monthlyRevenueChange > 0 ? '+' : ''}{monthlyRevenueChange}%
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                  {t('dashboard.vsPrevMonth', 'vs. mês anterior')}
                </p>
              </div>

              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/30">
                <div className="flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {monthlySales.length} {monthlySales.length !== 1 ? t('dashboard.sales', 'vendas') : t('dashboard.sale', 'venda')}
                  </span>
                </div>
              </div>
            </div>
          )}
        </motion.div>
        )}

        {/* Next Appointment Card */}
        {showAgenda && (
        <motion.div
          variants={fadeUp}
          className={cn(
            'md:col-span-5 rounded-2xl p-5 relative overflow-hidden',
            'bg-gradient-to-br from-red-600 to-red-500',
            'shadow-red dark:shadow-none',
          )}
        >
          <div className="relative z-10">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white/80">{t('dashboard.nextAppointment', 'Próximo agendamento')}</p>
              {nextAppointment && (
                <span className="text-xs font-medium text-red-900 bg-white/90 px-2.5 py-1 rounded-full">
                  {nextAppointment.date === todayStr ? t('dashboard.today', 'Hoje') : format(new Date(nextAppointment.date + 'T12:00:00'), "dd/MM", { locale: dateLocale })}, {nextAppointment.startTime}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3.5 mt-4">
              <div className="w-11 h-11 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white text-sm font-bold border border-white/30">
                {nextAppointment
                  ? getInitials(nextAppointment.clientName)
                  : <UserIcon className="w-5 h-5" />
                }
              </div>
              <div>
                <p className="text-lg font-bold text-white">
                  {nextAppointment ? nextAppointment.clientName : t('dashboard.noUpcoming', 'Sem agendamentos próximos')}
                </p>
                <p className="text-sm text-white/70">
                  {nextAppointment
                    ? [nextAppointment.serviceName, nextAppointment.clientPhone || clients.find(c => c.id === nextAppointment.clientId)?.phone].filter(Boolean).join(' · ') || t('dashboard.noDetails', 'Sem detalhes')
                    : t('dashboard.calendarFree', 'Sua agenda está livre')}
                </p>
              </div>
            </div>

            {nextAppointment && (
              <div className="flex justify-end mt-3">
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setActivePage('Agenda')}
                  className="text-sm font-medium text-red-700 bg-white hover:bg-white/90 px-4 py-2 rounded-xl transition-colors duration-150"
                >
                  {t('dashboard.viewDetails', 'Ver Detalhes')}
                </motion.button>
              </div>
            )}
          </div>

          <div className="absolute -right-8 -bottom-8 w-40 h-40 rounded-full bg-white/[0.06]" />
          <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full bg-white/[0.04]" />
        </motion.div>
        )}

        {showOrders && (
          <motion.div
            variants={fadeUp}
            className="md:col-span-5 rounded-2xl p-5 relative overflow-hidden bg-gradient-to-br from-orange-600 via-red-500 to-red-600 shadow-red dark:shadow-none text-white"
          >
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-medium text-white/80">Pedidos em andamento</p>
                {ordersUrgent.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-red-700 text-[11px] font-bold">
                    <Timer className="w-3 h-3" />
                    {ordersUrgent.length} atrasado{ordersUrgent.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-end gap-6 mb-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-white/70">Ativos agora</p>
                  <p className="text-4xl font-black">{ordersActive.length}</p>
                </div>
                {ordersAvgTime > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-white/70">Tempo médio</p>
                    <p className="text-2xl font-bold">{ordersAvgTime} min</p>
                  </div>
                )}
              </div>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setActivePage('Pedidos')}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-red-700 bg-white hover:bg-white/90 px-4 py-2 rounded-xl transition-colors"
              >
                <ClipboardCheck className="w-4 h-4" />
                Abrir Gerenciador
              </motion.button>
            </div>
            <Bike className="absolute -right-6 -bottom-4 w-40 h-40 text-white/[0.08]" />
          </motion.div>
        )}

        {showTasks && (
          <motion.div
            variants={fadeUp}
            className="md:col-span-5 rounded-2xl p-5 relative overflow-hidden bg-gradient-to-br from-violet-600 to-purple-600 shadow-md shadow-violet-500/20 text-white"
          >
            <div className="relative z-10">
              <p className="text-sm font-medium text-white/80 mb-3">Produtividade do time</p>
              <div className="flex items-end gap-6 mb-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-white/70">Tarefas abertas</p>
                  <p className="text-4xl font-black">{tasksOpen.length}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-white/70">Minhas</p>
                  <p className="text-2xl font-bold">{tasksAssignedToMe.length}</p>
                </div>
                {tasksOverdue.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-amber-200">Atrasadas</p>
                    <p className="text-2xl font-bold text-amber-100">{tasksOverdue.length}</p>
                  </div>
                )}
              </div>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setActivePage('Kanban')}
                className="inline-flex items-center gap-1.5 text-sm font-bold text-violet-700 bg-white hover:bg-white/90 px-4 py-2 rounded-xl transition-colors"
              >
                <KanbanIcon className="w-4 h-4" />
                Abrir Kanban
              </motion.button>
            </div>
            <KanbanIcon className="absolute -right-6 -bottom-4 w-40 h-40 text-white/[0.08]" />
          </motion.div>
        )}

        {!showAgenda && !showOrders && !showTasks && (
          <motion.div
            variants={fadeUp}
            className="md:col-span-5 rounded-2xl p-6 bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md"
          >
            <p className="text-sm font-medium text-white/80 mb-2">Modo essencial</p>
            <p className="text-lg font-bold mb-3">Foco no que importa.</p>
            <p className="text-sm text-white/85">
              Gerencie seus clientes, conversas e financeiro sem distração. Mude o modo em Configurações a qualquer momento.
            </p>
          </motion.div>
        )}
      </div>

      {/* ━━━ KPI Cards (4 cards) ━━━ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Clientes */}
        <motion.div
          variants={fadeUp}
          className={cn(
            'rounded-2xl p-5',
            'bg-white dark:bg-gray-800/60',
            'border border-gray-100 dark:border-gray-700/50',
            'shadow-sm',
            'border-l-[3px] border-l-red-500',
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{t('dashboard.totalClients', 'Total Clientes')}</p>
              {isLoading ? (
                <div className="h-9 w-16 rounded-lg shimmer mt-1" />
              ) : (
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tracking-tight">{activeClients}</p>
              )}
            </div>
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-red-500 dark:text-red-400" />
            </div>
          </div>
        </motion.div>

        {/* Agendamentos Hoje — apenas no modo serviços */}
        {showAgenda && (
        <motion.div
          variants={fadeUp}
          className={cn(
            'rounded-2xl p-5',
            'bg-white dark:bg-gray-800/60',
            'border border-gray-100 dark:border-gray-700/50',
            'shadow-sm',
            'border-l-[3px] border-l-amber-500',
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('dashboard.todayAppointments', 'Agendamentos Hoje')}</p>
              {isLoading ? (
                <div className="h-9 w-16 rounded-lg shimmer mt-1" />
              ) : (
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tracking-tight">{todayAppointments.length}</p>
              )}
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
              <CalendarCheck className="w-5 h-5 text-amber-500 dark:text-amber-400" />
            </div>
          </div>
        </motion.div>
        )}

        {/* Próximos — apenas no modo serviços */}
        {showAgenda && (
        <motion.div
          variants={fadeUp}
          className={cn(
            'rounded-2xl p-5',
            'bg-white dark:bg-gray-800/60',
            'border border-gray-100 dark:border-gray-700/50',
            'shadow-sm',
            'border-l-[3px] border-l-emerald-500',
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{t('dashboard.upcoming', 'Próximos')}</p>
              {isLoading ? (
                <div className="h-9 w-16 rounded-lg shimmer mt-1" />
              ) : (
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tracking-tight">{upcomingCount}</p>
              )}
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
              <CalendarClock className="w-5 h-5 text-emerald-500 dark:text-emerald-400" />
            </div>
          </div>
        </motion.div>
        )}

        {/* Pedidos Hoje — apenas no modo pedidos */}
        {showOrders && (
          <motion.div variants={fadeUp}
            className="rounded-2xl p-5 bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/50 shadow-sm border-l-[3px] border-l-orange-500"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Pedidos Hoje</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tracking-tight">{ordersToday.length}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{formatCurrency(ordersRevenueToday)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center">
                <ClipboardCheck className="w-5 h-5 text-orange-500 dark:text-orange-400" />
              </div>
            </div>
          </motion.div>
        )}

        {showOrders && (
          <motion.div variants={fadeUp}
            className="rounded-2xl p-5 bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/50 shadow-sm border-l-[3px] border-l-amber-500"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Em andamento</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tracking-tight">{ordersActive.length}</p>
                {ordersUrgent.length > 0 && (
                  <p className="text-[11px] text-red-500 font-semibold mt-0.5">
                    {ordersUrgent.length} atrasado{ordersUrgent.length > 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                <Bike className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              </div>
            </div>
          </motion.div>
        )}

        {/* Tasks — apenas no modo times */}
        {showTasks && (
          <motion.div variants={fadeUp}
            className="rounded-2xl p-5 bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/50 shadow-sm border-l-[3px] border-l-violet-500"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Tarefas Abertas</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tracking-tight">{tasksOpen.length}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
                <KanbanIcon className="w-5 h-5 text-violet-500 dark:text-violet-400" />
              </div>
            </div>
          </motion.div>
        )}

        {showTasks && (
          <motion.div variants={fadeUp}
            className="rounded-2xl p-5 bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/50 shadow-sm border-l-[3px] border-l-amber-500"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Minhas Tarefas</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tracking-tight">{tasksAssignedToMe.length}</p>
                {tasksOverdue.length > 0 && (
                  <p className="text-[11px] text-red-500 font-semibold mt-0.5">
                    {tasksOverdue.length} atrasada{tasksOverdue.length > 1 ? 's' : ''}
                  </p>
                )}
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              </div>
            </div>
          </motion.div>
        )}

        {/* Financeiro — Pendências */}
        <motion.div
          variants={fadeUp}
          className={cn(
            'rounded-2xl p-5',
            'bg-white dark:bg-gray-800/60',
            'border border-gray-100 dark:border-gray-700/50',
            'shadow-sm',
            'border-l-[3px]',
            overdueTransactions.length > 0 ? 'border-l-red-500' : 'border-l-blue-500',
          )}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className={cn(
                'text-sm font-medium',
                overdueTransactions.length > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-600 dark:text-gray-400'
              )}>
                {overdueTransactions.length > 0 ? t('dashboard.overdueAccounts', 'Contas Atrasadas') : t('dashboard.pendingAccounts', 'Contas Pendentes')}
              </p>
              {isLoading ? (
                <div className="h-9 w-16 rounded-lg shimmer mt-1" />
              ) : (
                <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1 tracking-tight">
                  {overdueTransactions.length > 0 ? overdueTransactions.length : pendingTransactions.length}
                </p>
              )}
            </div>
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              overdueTransactions.length > 0
                ? 'bg-red-50 dark:bg-red-500/10'
                : 'bg-blue-50 dark:bg-blue-500/10',
            )}>
              {overdueTransactions.length > 0
                ? <AlertTriangle className="w-5 h-5 text-red-500 dark:text-red-400" />
                : <Wallet className="w-5 h-5 text-blue-500 dark:text-blue-400" />
              }
            </div>
          </div>
        </motion.div>
      </div>

      {/* ━━━ Bottom Section: Client Table + Sidebar ━━━ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Client Table (left) */}
        <motion.div
          variants={fadeUp}
          className={cn(
            'lg:col-span-7 rounded-2xl',
            'bg-white dark:bg-gray-800/60',
            'border border-gray-100 dark:border-gray-700/50',
            'shadow-sm overflow-hidden',
          )}
        >
          {/* Search Bar */}
          <div className="p-4 border-b border-gray-100 dark:border-gray-700/40">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
              <input
                type="text"
                placeholder={t('dashboard.searchClients', 'Buscar clientes por nome, e-mail ou CPF...')}
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className={cn(
                  'w-full pl-10 pr-4 py-2.5 rounded-xl text-sm',
                  'bg-gray-50/80 dark:bg-gray-900/40',
                  'border border-gray-200/80 dark:border-gray-700/50',
                  'text-gray-900 dark:text-gray-100',
                  'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  'focus:outline-none focus:border-red-200 dark:focus:border-red-500/30',
                  'focus:bg-white dark:focus:bg-gray-900/60',
                  'focus:shadow-[0_0_0_3px_rgba(220,38,38,0.06)]',
                  'transition-all duration-200',
                )}
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700/40">
                  <th className="text-left text-xs font-semibold text-red-600 dark:text-red-400 px-5 py-3">{t('dashboard.colClient', 'Cliente')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3 hidden sm:table-cell">{t('dashboard.colType', 'Tipo')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3 hidden md:table-cell">{t('dashboard.colPhone', 'Telefone')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3 hidden xl:table-cell">{t('dashboard.colNextAppt', 'Próx. Agend.')}</th>
                  <th className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 py-3">{t('dashboard.colStatus', 'Status')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-700/20">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full shimmer" />
                          <div className="h-4 w-28 rounded-md shimmer" />
                        </div>
                      </td>
                      <td className="px-4 py-3.5 hidden sm:table-cell"><div className="h-4 w-8 rounded-md shimmer" /></td>
                      <td className="px-4 py-3.5 hidden md:table-cell"><div className="h-4 w-24 rounded-md shimmer" /></td>
                      <td className="px-4 py-3.5 hidden xl:table-cell"><div className="h-4 w-16 rounded-md shimmer" /></td>
                      <td className="px-4 py-3.5"><div className="h-6 w-20 rounded-full shimmer" /></td>
                    </tr>
                  ))
                ) : filteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12">
                      <Users className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                      <p className="text-sm text-gray-400 dark:text-gray-500">
                        {clientSearch ? t('dashboard.noClientFound', 'Nenhum cliente encontrado') : t('dashboard.noClients', 'Nenhum cliente cadastrado')}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredClients.map((client) => {
                    const nextAppt = clientNextAppointment[client.id];
                    return (
                      <tr
                        key={client.id}
                        className="border-b border-gray-50 dark:border-gray-700/20 hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors group cursor-pointer"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[11px] font-bold text-gray-500 dark:text-gray-300 flex-shrink-0">
                              {getInitials(client.name)}
                            </div>
                            <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate max-w-[160px]">
                              {client.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium">
                            {client.tipo === 'pf' ? 'PF' : 'PJ'}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {client.phone ? formatPhone(client.phone) : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden xl:table-cell">
                          <span className="text-sm text-gray-500 dark:text-gray-400">
                            {nextAppt
                              ? `${format(new Date(nextAppt.date + 'T12:00:00'), 'dd/MM')} ${nextAppt.startTime}`
                              : '—'
                            }
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {nextAppt ? (
                            <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20">
                              {t('dashboard.scheduled', 'Agendado')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-gray-50 dark:bg-gray-700/40 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600/50">
                              {t('dashboard.noAppointment', 'Sem consulta')}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          {!isLoading && clients.length > 8 && (
            <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700/40 flex items-center justify-between">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {t('dashboard.showing', 'Mostrando')} {filteredClients.length} {t('dashboard.of', 'de')} {clients.length} {t('dashboard.clients', 'clientes')}
              </span>
              <button
                onClick={() => setActivePage('CRM')}
                className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
              >
                {t('dashboard.viewAll', 'Ver todos')}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </motion.div>

        {/* Right Sidebar */}
        <div className="lg:col-span-5 space-y-4">
          {/* Today's Schedule — apenas no modo serviços */}
          {showAgenda && (
          <motion.div
            variants={fadeUp}
            className={cn(
              'rounded-2xl',
              'bg-white dark:bg-gray-800/60',
              'border border-gray-100 dark:border-gray-700/50',
              'shadow-sm overflow-hidden',
            )}
          >
            <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700/40 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-red-500 dark:text-red-400" />
                {t('dashboard.todaySchedule', 'Agenda de Hoje')}
              </h3>
              <button
                onClick={() => setActivePage('Agenda')}
                className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
              >
                {t('dashboard.viewSchedule', 'Ver agenda')}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-3">
              {loadingAppointments ? (
                <div className="space-y-2 p-2">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-3 py-2">
                      <div className="h-4 w-11 rounded shimmer" />
                      <div className="w-0.5 h-8 rounded-full shimmer" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-4 w-24 rounded shimmer" />
                        <div className="h-3 w-16 rounded shimmer" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : todaySchedule.length === 0 ? (
                <div className="text-center py-8">
                  <CalendarCheck className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 dark:text-gray-500">{t('dashboard.noTodayAppts', 'Nenhum agendamento hoje')}</p>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setActivePage('Agenda')}
                    className="mt-3 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                  >
                    {t('dashboard.scheduleNow', 'Agendar agora')}
                  </motion.button>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {todaySchedule.slice(0, 6).map((appt, idx) => {
                    const isPast = appt.startTime < format(new Date(), 'HH:mm');
                    const statusColor = appt.status === 'concluido'
                      ? 'bg-emerald-400'
                      : appt.status === 'confirmado'
                        ? 'bg-blue-400'
                        : appt.status === 'em_andamento'
                          ? 'bg-violet-400'
                          : 'bg-amber-400';

                    return (
                      <motion.div
                        key={appt.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: idx * 0.05 }}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-xl',
                          'hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer',
                          isPast && appt.status !== 'em_andamento' && 'opacity-50',
                        )}
                      >
                        <span className={cn(
                          'text-xs font-mono font-semibold w-11 flex-shrink-0',
                          isPast && appt.status !== 'em_andamento'
                            ? 'text-gray-400 dark:text-gray-500'
                            : 'text-red-500 dark:text-red-400',
                        )}>
                          {appt.startTime}
                        </span>
                        <div className={cn('w-0.5 h-8 rounded-full flex-shrink-0', statusColor)} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                            {appt.clientName}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                            {appt.serviceName}
                          </p>
                        </div>
                        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', statusColor)} />
                      </motion.div>
                    );
                  })}
                  {todaySchedule.length > 6 && (
                    <div className="text-center pt-2 pb-1">
                      <button
                        onClick={() => setActivePage('Agenda')}
                        className="text-xs font-medium text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
                      >
                        +{todaySchedule.length - 6} mais
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
          )}

          {/* Pedidos Ativos (substitui Agenda de Hoje no modo pedidos) */}
          {showOrders && (
            <motion.div variants={fadeUp}
              className="rounded-2xl bg-white dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/50 shadow-sm overflow-hidden"
            >
              <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700/40 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-red-500" />
                  Pedidos em tempo real
                </h3>
                <button onClick={() => setActivePage('Pedidos')}
                  className="text-xs font-medium text-red-500 hover:text-red-600 inline-flex items-center gap-1">
                  Abrir <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              <div className="p-4">
                {ordersActive.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-6">Nenhum pedido ativo agora</p>
                ) : (
                  <div className="space-y-1.5">
                    {ordersActive.slice(0, 6).map(o => (
                      <button
                        key={o.id}
                        onClick={() => setActivePage('Pedidos')}
                        className="w-full text-left flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          #{o.number}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{o.clientName}</p>
                          <p className="text-[11px] text-gray-500 truncate">
                            {DELIVERY_ORDER_STATUS_LABELS[o.status]} · {o.items.length} {o.items.length === 1 ? 'item' : 'itens'}
                          </p>
                        </div>
                        <p className="text-sm font-bold text-gray-700 dark:text-gray-300">{formatCurrency(o.total)}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Financial Alerts — ocultos em modo times */}
          {showFinancial && !isLoading && (overdueTransactions.length > 0 || pendingTransactions.length > 0) && (
            <motion.div
              variants={fadeUp}
              className={cn(
                'rounded-2xl',
                'bg-white dark:bg-gray-800/60',
                'border border-gray-100 dark:border-gray-700/50',
                'shadow-sm overflow-hidden',
              )}
            >
              <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700/40 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  {t('dashboard.financialAlerts', 'Alertas Financeiros')}
                </h3>
                <button
                  onClick={() => setActivePage('Financeiro')}
                  className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                >
                  {t('dashboard.viewAll', 'Ver todos')}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-4 space-y-2.5">
                {overdueTransactions.length > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-red-50/60 dark:bg-red-500/5 border border-red-100 dark:border-red-500/10">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-sm font-medium text-red-700 dark:text-red-400">
                        {overdueTransactions.length} {overdueTransactions.length > 1 ? t('dashboard.overdueMulti', 'atrasadas') : t('dashboard.overdueSingle', 'atrasada')}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-red-700 dark:text-red-400">
                      {formatCurrency(overdueAmount)}
                    </span>
                  </div>
                )}
                {pendingTransactions.length > 0 && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50/60 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-500/10">
                    <div className="flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                        {pendingTransactions.length} {pendingTransactions.length > 1 ? t('dashboard.pendingMulti', 'pendentes') : t('dashboard.pendingSingle', 'pendente')}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {formatCurrency(pendingAmount)}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Quick Access */}
          <motion.div
            variants={fadeUp}
            className={cn(
              'rounded-2xl',
              'bg-white dark:bg-gray-800/60',
              'border border-gray-100 dark:border-gray-700/50',
              'shadow-sm overflow-hidden',
            )}
          >
            <div className="p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{t('dashboard.quickAccess', 'Acesso Rápido')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { label: t('sidebar.crm', 'CRM'), icon: Users, page: 'CRM' as const, color: 'text-red-500 dark:text-red-400' },
                  { label: t('sidebar.agenda', 'Agenda'), icon: CalendarCheck, page: 'Agenda' as const, color: 'text-amber-500 dark:text-amber-400' },
                  { label: t('sidebar.pdv', 'PDV'), icon: ShoppingBag, page: 'PDV' as const, color: 'text-emerald-500 dark:text-emerald-400' },
                  { label: t('sidebar.financeiro', 'Financeiro'), icon: Wallet, page: 'Financeiro' as const, color: 'text-blue-500 dark:text-blue-400' },
                  { label: t('sidebar.estoque', 'Estoque'), icon: Receipt, page: 'Estoque' as const, color: 'text-violet-500 dark:text-violet-400' },
                  { label: t('sidebar.conversas', 'Conversas'), icon: MessageSquare, page: 'Conversas' as const, color: 'text-pink-500 dark:text-pink-400' },
                ]).map((item) => (
                  <motion.button
                    key={item.page}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setActivePage(item.page)}
                    className={cn(
                      'flex items-center gap-2.5 p-3 rounded-xl text-sm font-medium',
                      'bg-gray-50/80 dark:bg-gray-700/30',
                      'text-gray-700 dark:text-gray-300',
                      'hover:bg-gray-100 dark:hover:bg-gray-700/50',
                      'border border-transparent hover:border-gray-200 dark:hover:border-gray-600/50',
                      'transition-all duration-200',
                    )}
                  >
                    <item.icon className={cn('w-4 h-4', item.color)} />
                    {item.label}
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
