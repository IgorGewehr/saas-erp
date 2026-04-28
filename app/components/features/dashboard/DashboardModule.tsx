'use client';

/**
 * Dashboard — command-center home
 *
 * Canva/Perplexity-inspired layout: centered hero with the Agente IA input
 * as the primary action, a row of colorful module circles for fast navigation,
 * and a small grid of smart cards surfacing only the most actionable data
 * (today's revenue, next event, alerts, team pulse). Use case (servicos /
 * pedidos / simples) drives which modules and cards appear.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { useTranslation } from 'react-i18next';
import type {
  Appointment,
  CRMContact,
  Sale,
  Transaction,
  DeliveryOrder,
  UseCase,
  User as UserType,
  UserRole,
} from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';
import {
  Users,
  Calendar,
  ShoppingCart,
  DollarSign,
  ClipboardCheck,
  ClipboardList,
  BarChart3,
  FileCheck2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CalendarClock,
  Bike,
  ArrowRight,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { enUS as enUSLocale } from 'date-fns/locale';
import { collection, query, where, orderBy, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { formatCurrency, getInitials } from '@/lib/utils/format';
import type { MenuPage } from '@/app/components/layout/Sidebar';
import AgentHeroInput from './AgentHeroInput';

// ─── Animation variants ──────────────────────────────────────────────────────
const stagger = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 14, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
};
const popIn = {
  hidden: { opacity: 0, scale: 0.9, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
};

// ─── Module catalog — only the principal modules, minimal style ──────────────
interface ModuleEntry {
  id: MenuPage;
  label: string;
  icon: React.ElementType;
  /** Tinted bg (light/dark) — e.g., 'bg-blue-50 dark:bg-blue-500/10'. */
  bg: string;
  /** Icon color — e.g., 'text-blue-600 dark:text-blue-400'. */
  iconColor: string;
  useCases?: UseCase[];
  minRole?: UserRole;
}

// Principais somente: Clientes, Agenda (serviços) / Pedidos (pedidos), PDV,
// Vendas, Financeiro, Relatórios, Fiscal. Cores alinhadas ao tema vermelho do
// app — todos os ícones partilham a mesma família red/rose para coerência.
const MODULES: ModuleEntry[] = [
  { id: 'Clientes',    label: 'Clientes',    icon: Users,           bg: 'bg-red-50 dark:bg-red-500/10',         iconColor: 'text-red-600 dark:text-red-400' },
  { id: 'Agenda',      label: 'Agenda',      icon: Calendar,        bg: 'bg-red-50 dark:bg-red-500/10',         iconColor: 'text-red-600 dark:text-red-400',   useCases: ['servicos'] },
  { id: 'Pedidos',     label: 'Pedidos',     icon: ClipboardCheck,  bg: 'bg-red-50 dark:bg-red-500/10',         iconColor: 'text-red-600 dark:text-red-400',   useCases: ['pedidos'] },
  { id: 'PDV',         label: 'PDV',         icon: ShoppingCart,    bg: 'bg-red-50 dark:bg-red-500/10',         iconColor: 'text-red-600 dark:text-red-400' },
  { id: 'Vendas',      label: 'Vendas',      icon: ClipboardList,   bg: 'bg-red-50 dark:bg-red-500/10',         iconColor: 'text-red-600 dark:text-red-400' },
  { id: 'Financeiro',  label: 'Financeiro',  icon: DollarSign,      bg: 'bg-red-50 dark:bg-red-500/10',         iconColor: 'text-red-600 dark:text-red-400' },
  { id: 'Relatórios',  label: 'Relatórios',  icon: BarChart3,       bg: 'bg-red-50 dark:bg-red-500/10',         iconColor: 'text-red-600 dark:text-red-400' },
  { id: 'NFSe',        label: 'Fiscal',      icon: FileCheck2,      bg: 'bg-red-50 dark:bg-red-500/10',         iconColor: 'text-red-600 dark:text-red-400' },
];

// ─── Presence helper ────────────────────────────────────────────────────────
function memberDisplayStatus(member: UserType): 'online' | 'busy' | 'offline' {
  if (member.userStatus === 'invisible') return 'offline';
  if (!member.isOnline || !member.lastSeenAt) return 'offline';
  if (Date.now() - new Date(member.lastSeenAt).getTime() >= 3 * 60 * 1000) return 'offline';
  return member.userStatus === 'busy' ? 'busy' : 'online';
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function DashboardModule() {
  const { t, i18n } = useTranslation();
  const { user, business } = useAuth();
  const { setActivePage } = useAppContext();
  const dateLocale = i18n.language === 'en-US' ? enUSLocale : ptBR;

  const useCase: UseCase = (business?.settings?.useCase as UseCase) || 'servicos';
  const showAgenda = useCase === 'servicos';
  const showOrders = useCase === 'pedidos';
  const isAdmin = ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY.admin;

  // ── Data queries ─────────────────────────────────────────────────────────
  const { data: clients = [], isLoading: loadingClients } = useQuery({
    queryKey: ['clients', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'clients'), where('businessId', '==', business!.id));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as CRMContact))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
    },
    enabled: !!business?.id,
  });

  const { data: appointments = [], isLoading: loadingAppointments } = useQuery({
    queryKey: ['appointments', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'appointments'),
        where('businessId', '==', business!.id),
        orderBy('date', 'asc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Appointment));
    },
    enabled: !!business?.id && showAgenda,
  });

  const { data: sales = [], isLoading: loadingSales } = useQuery({
    queryKey: ['sales', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'sales'),
        where('businessId', '==', business!.id),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Sale));
    },
    enabled: !!business?.id,
  });

  const { data: transactions = [], isLoading: loadingTransactions } = useQuery({
    queryKey: ['transactions', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'transactions'),
        where('businessId', '==', business!.id),
        orderBy('dueDate', 'desc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Transaction));
    },
    enabled: !!business?.id,
  });

  const { data: deliveryOrders = [] } = useQuery({
    queryKey: ['delivery-orders-dashboard', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'deliveryOrders'),
        where('businessId', '==', business!.id),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as DeliveryOrder));
    },
    enabled: !!business?.id && showOrders,
    staleTime: 60 * 1000,
  });

  // ── Live team presence (real-time onSnapshot) ─────────────────────────────
  const [members, setMembers] = useState<UserType[]>([]);
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'users'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      setMembers(snap.docs.map((d) => ({ ...d.data(), id: d.id } as UserType)));
    });
    return () => unsub();
  }, [business?.id]);

  // ── Derived metrics ───────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split('T')[0];

  const todaySales = useMemo(
    () => sales.filter((s) => s.status === 'finalizada' && s.createdAt?.startsWith(todayStr)),
    [sales, todayStr],
  );
  const todayRevenue = useMemo(
    () => todaySales.reduce((sum, s) => sum + s.total, 0),
    [todaySales],
  );
  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }, []);
  const yesterdayRevenue = useMemo(
    () =>
      sales
        .filter((s) => s.status === 'finalizada' && s.createdAt?.startsWith(yesterdayStr))
        .reduce((sum, s) => sum + s.total, 0),
    [sales, yesterdayStr],
  );
  const revenueChange = useMemo(() => {
    if (yesterdayRevenue === 0) return todayRevenue > 0 ? 100 : 0;
    return Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100);
  }, [todayRevenue, yesterdayRevenue]);

  const nextAppointment = useMemo(() => {
    const nowStr = new Date().toTimeString().slice(0, 5);
    return (
      [...appointments]
        .filter((a) => a.status !== 'cancelado' && a.status !== 'concluido')
        .filter((a) => a.date > todayStr || (a.date === todayStr && a.startTime >= nowStr))
        .sort((a, b) =>
          a.date === b.date
            ? (a.startTime || '').localeCompare(b.startTime || '')
            : a.date.localeCompare(b.date),
        )[0] || null
    );
  }, [appointments, todayStr]);

  const ordersActive = useMemo(
    () => deliveryOrders.filter((o) => o.status !== 'entregue' && o.status !== 'cancelado'),
    [deliveryOrders],
  );
  const ordersUrgent = useMemo(
    () =>
      deliveryOrders.filter((o) => {
        if (o.status === 'entregue' || o.status === 'cancelado') return false;
        if (o.estimatedDeliveryAt) {
          const t = new Date(o.estimatedDeliveryAt).getTime();
          return !isNaN(t) && t < Date.now();
        }
        const created = new Date(o.createdAt).getTime();
        return !isNaN(created) && (Date.now() - created) / 60000 > 45;
      }),
    [deliveryOrders],
  );

  const overdueTransactions = useMemo(
    () => transactions.filter((t) => t.status === 'atrasado'),
    [transactions],
  );
  const pendingTransactions = useMemo(
    () => transactions.filter((t) => t.status === 'pendente'),
    [transactions],
  );
  const overdueAmount = useMemo(
    () => overdueTransactions.reduce((sum, t) => sum + t.amount, 0),
    [overdueTransactions],
  );
  const pendingAmount = useMemo(
    () => pendingTransactions.reduce((sum, t) => sum + t.amount, 0),
    [pendingTransactions],
  );

  // ── Team pulse ────────────────────────────────────────────────────────────
  const onlineMembers = useMemo(
    () => members.filter((m) => memberDisplayStatus(m) !== 'offline'),
    [members],
  );

  // ── Visible modules (filtered by use case + role) ────────────────────────
  const visibleModules = useMemo(
    () =>
      MODULES.filter((m) => !m.useCases || m.useCases.includes(useCase)).filter(
        (m) => !m.minRole || ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY[m.minRole],
      ),
    [useCase, user?.role],
  );

  // ── Greeting ─────────────────────────────────────────────────────────────
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t('dashboard.goodMorning', 'Bom dia')
      : hour < 18
        ? t('dashboard.goodAfternoon', 'Boa tarde')
        : t('dashboard.goodEvening', 'Boa noite');
  const firstName = user?.name?.split(' ')[0] || '';
  const subtitle = useMemo(() => {
    const parts = [
      i18n.language === 'en-US'
        ? format(new Date(), 'EEEE, MMMM d', { locale: dateLocale })
        : format(new Date(), "EEEE, d 'de' MMMM", { locale: dateLocale }),
    ];
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  }, [i18n.language, dateLocale]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="space-y-8 sm:space-y-10"
    >
      {/* ━━━ Hero with AI input ━━━ */}
      <motion.section variants={fadeUp} className="pt-2 sm:pt-6">
        <AgentHeroInput greeting={greeting} firstName={firstName} subtitle={subtitle} />
      </motion.section>

      {/* ━━━ Module circles — centered, no heading ━━━ */}
      <motion.section variants={fadeUp}>
        <div className="flex flex-wrap items-start justify-center gap-x-5 sm:gap-x-7 gap-y-4">
          {visibleModules.map((m, i) => (
            <ModuleCircle
              key={m.id}
              module={m}
              index={i}
              onClick={() => setActivePage(m.id)}
            />
          ))}
        </div>
      </motion.section>

      {/* ━━━ Smart cards — minimal, no heading ━━━ */}
      <motion.section variants={fadeUp}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Card 1: Revenue today */}
          <RevenueCard
            value={todayRevenue}
            count={todaySales.length}
            delta={revenueChange}
            loading={loadingSales}
            onClick={() => setActivePage('Financeiro')}
          />

          {/* Card 2: Mode-specific focus */}
          {showAgenda && (
            <FocusCard
              title="Próximo agendamento"
              icon={CalendarClock}
              loading={loadingAppointments}
              empty={!nextAppointment}
              emptyText="Agenda livre"
              emptyAction={{ label: 'Agendar agora', onClick: () => setActivePage('Agenda') }}
              onClick={() => setActivePage('Agenda')}
              primaryText={nextAppointment?.clientName}
              secondaryText={
                nextAppointment
                  ? `${nextAppointment.serviceName || '—'} · ${
                      nextAppointment.date === todayStr
                        ? `Hoje, ${nextAppointment.startTime}`
                        : `${format(new Date(nextAppointment.date + 'T12:00:00'), 'dd/MM')} ${nextAppointment.startTime}`
                    }`
                  : undefined
              }
              avatarText={nextAppointment ? getInitials(nextAppointment.clientName) : undefined}
            />
          )}

          {showOrders && (
            <FocusCard
              title="Pedidos ativos"
              icon={Bike}
              loading={false}
              empty={ordersActive.length === 0}
              emptyText="Sem pedidos ativos"
              emptyAction={{ label: 'Abrir gerenciador', onClick: () => setActivePage('Pedidos') }}
              onClick={() => setActivePage('Pedidos')}
              primaryText={`${ordersActive.length} ${ordersActive.length === 1 ? 'pedido' : 'pedidos'}`}
              secondaryText={
                ordersUrgent.length > 0
                  ? `${ordersUrgent.length} atrasado${ordersUrgent.length > 1 ? 's' : ''}`
                  : 'Todos no prazo'
              }
              tone={ordersUrgent.length > 0 ? 'alert' : 'default'}
              bigNumber={ordersActive.length}
            />
          )}

          {!showAgenda && !showOrders && (
            <FocusCard
              title="Clientes ativos"
              icon={Users}
              loading={loadingClients}
              empty={clients.length === 0}
              emptyText="Nenhum cliente ainda"
              emptyAction={{ label: 'Adicionar cliente', onClick: () => setActivePage('Clientes') }}
              onClick={() => setActivePage('Clientes')}
              primaryText={`${clients.length} ${clients.length === 1 ? 'cliente' : 'clientes'}`}
              secondaryText="Carteira total"
              bigNumber={clients.length}
            />
          )}

          {/* Card 3: Financial alerts */}
          <AlertsCard
            overdueCount={overdueTransactions.length}
            overdueAmount={overdueAmount}
            pendingCount={pendingTransactions.length}
            pendingAmount={pendingAmount}
            loading={loadingTransactions}
            onClick={() => setActivePage('Financeiro')}
          />

          {/* Card 4: Team pulse */}
          <TeamPulseCard
            members={members}
            onlineMembers={onlineMembers}
            onClick={() => setActivePage('Configurações')}
          />
        </div>
      </motion.section>
    </motion.div>
  );
}

// ─── Module circle ──────────────────────────────────────────────────────────
function ModuleCircle({
  module,
  index,
  onClick,
}: {
  module: ModuleEntry;
  index: number;
  onClick: () => void;
}) {
  const Icon = module.icon;
  return (
    <motion.button
      variants={popIn}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      transition={{ duration: 0.25, delay: index * 0.025, ease: [0.22, 1, 0.36, 1] }}
      className="group flex flex-col items-center gap-2 flex-shrink-0 w-[80px] sm:w-auto"
    >
      <div
        className={cn(
          'w-14 h-14 sm:w-[60px] sm:h-[60px] rounded-2xl flex items-center justify-center',
          'border border-gray-200/60 dark:border-gray-700/40',
          'group-hover:border-gray-300 dark:group-hover:border-gray-600/60 transition-colors',
          module.bg,
        )}
      >
        <Icon className={cn('w-[22px] h-[22px] sm:w-6 sm:h-6', module.iconColor)} strokeWidth={1.9} />
      </div>
      <span className="text-[11px] sm:text-xs font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200 transition-colors text-center leading-tight">
        {module.label}
      </span>
    </motion.button>
  );
}

// ─── Smart cards ────────────────────────────────────────────────────────────
function CardShell({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      {...(onClick
        ? { onClick, whileHover: { y: -2 }, whileTap: { scale: 0.99 } }
        : {})}
      variants={popIn}
      className={cn(
        'group relative w-full text-left rounded-2xl p-4',
        'bg-white dark:bg-gray-800/40',
        'border border-gray-200/70 dark:border-gray-700/50',
        'border-l-2 border-l-red-500/70 dark:border-l-red-500/60',
        'hover:border-l-red-500 dark:hover:border-l-red-400',
        'hover:border-gray-300 dark:hover:border-gray-600/60 transition-colors duration-200',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </Comp>
  );
}

function RevenueCard({
  value,
  count,
  delta,
  loading,
  onClick,
}: {
  value: number;
  count: number;
  delta: number;
  loading: boolean;
  onClick: () => void;
}) {
  const positive = delta > 0;
  const negative = delta < 0;
  return (
    <CardShell onClick={onClick}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Receita hoje
        </p>
        <DollarSign className="w-4 h-4 text-gray-400 dark:text-gray-500" />
      </div>
      {loading ? (
        <div className="h-8 w-32 rounded-lg shimmer" />
      ) : (
        <p className="font-display text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">
          {formatCurrency(value)}
        </p>
      )}
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {count} {count === 1 ? 'venda' : 'vendas'}
        </p>
        {!loading && delta !== 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-[11px] font-medium',
              positive && 'text-emerald-600 dark:text-emerald-400',
              negative && 'text-red-600 dark:text-red-400',
            )}
          >
            {positive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            {positive ? '+' : ''}
            {delta}%
          </span>
        )}
      </div>
    </CardShell>
  );
}

function FocusCard({
  title,
  icon: Icon,
  loading,
  empty,
  emptyText,
  emptyAction,
  onClick,
  primaryText,
  secondaryText,
  avatarText,
  bigNumber,
  tone = 'default',
}: {
  title: string;
  icon: React.ElementType;
  loading: boolean;
  empty: boolean;
  emptyText: string;
  emptyAction?: { label: string; onClick: () => void };
  onClick: () => void;
  primaryText?: string;
  secondaryText?: string;
  avatarText?: string;
  bigNumber?: number;
  tone?: 'default' | 'alert';
}) {
  if (empty && !loading) {
    return (
      <CardShell>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {title}
            </p>
            <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          </div>
          <div className="flex-1 flex flex-col items-start gap-2 py-2">
            <p className="text-sm text-gray-500 dark:text-gray-400">{emptyText}</p>
            {emptyAction && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  emptyAction.onClick();
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                {emptyAction.label}
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell onClick={onClick}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {title}
        </p>
        <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
      </div>

      {loading ? (
        <>
          <div className="h-7 w-32 rounded-lg shimmer mb-2" />
          <div className="h-3.5 w-20 rounded shimmer" />
        </>
      ) : (
        <div className="flex items-end gap-3">
          {avatarText && (
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-semibold flex-shrink-0 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
              {avatarText}
            </div>
          )}
          <div className="flex-1 min-w-0">
            {typeof bigNumber === 'number' ? (
              <p className="font-display text-3xl font-semibold tracking-tight text-gray-900 dark:text-white leading-none">
                {bigNumber}
              </p>
            ) : (
              <p className="text-base font-semibold tracking-tight text-gray-900 dark:text-white truncate">
                {primaryText || '—'}
              </p>
            )}
            {secondaryText && (
              <p
                className={cn(
                  'text-xs truncate mt-1',
                  tone === 'alert'
                    ? 'text-red-600 dark:text-red-400 font-medium'
                    : 'text-gray-500 dark:text-gray-400',
                )}
              >
                {secondaryText}
              </p>
            )}
          </div>
        </div>
      )}
    </CardShell>
  );
}

function AlertsCard({
  overdueCount,
  overdueAmount,
  pendingCount,
  pendingAmount,
  loading,
  onClick,
}: {
  overdueCount: number;
  overdueAmount: number;
  pendingCount: number;
  pendingAmount: number;
  loading: boolean;
  onClick: () => void;
}) {
  const hasAlerts = overdueCount > 0 || pendingCount > 0;
  const isUrgent = overdueCount > 0;
  return (
    <CardShell onClick={onClick}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Alertas
        </p>
        {isUrgent ? (
          <AlertTriangle className="w-4 h-4 text-red-500 dark:text-red-400" />
        ) : (
          <Wallet className="w-4 h-4 text-gray-400 dark:text-gray-500" />
        )}
      </div>

      {loading ? (
        <>
          <div className="h-7 w-24 rounded-lg shimmer mb-2" />
          <div className="h-3.5 w-32 rounded shimmer" />
        </>
      ) : !hasAlerts ? (
        <div>
          <p className="font-display text-3xl font-semibold tracking-tight text-gray-900 dark:text-white leading-none">
            0
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Tudo em dia
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {overdueCount > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                {overdueCount} atrasada{overdueCount > 1 ? 's' : ''}
              </span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                {formatCurrency(overdueAmount)}
              </span>
            </div>
          )}
          {pendingCount > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
              </span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                {formatCurrency(pendingAmount)}
              </span>
            </div>
          )}
        </div>
      )}
    </CardShell>
  );
}

function TeamPulseCard({
  members,
  onlineMembers,
  onClick,
}: {
  members: UserType[];
  onlineMembers: UserType[];
  onClick: () => void;
}) {
  const visible = onlineMembers.slice(0, 4);
  const extra = Math.max(0, onlineMembers.length - visible.length);
  return (
    <CardShell onClick={onClick}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Equipe
        </p>
        <Sparkles className="w-4 h-4 text-gray-400 dark:text-gray-500" />
      </div>

      <p className="font-display text-3xl font-semibold tracking-tight text-gray-900 dark:text-white leading-none">
        {onlineMembers.length}
        <span className="text-base text-gray-400 dark:text-gray-500 font-normal ml-1">
          / {members.length}
        </span>
      </p>

      <div className="flex items-center justify-between mt-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {onlineMembers.length === 0 ? 'Ninguém online' : 'Online agora'}
        </p>
        {visible.length > 0 && (
          <div className="flex -space-x-1.5">
            {visible.map((m) => {
              const status = memberDisplayStatus(m);
              const dot = status === 'busy' ? 'bg-amber-400' : 'bg-emerald-400';
              return (
                <div
                  key={m.id}
                  title={`${m.name} · ${status}`}
                  className="relative w-7 h-7 rounded-full ring-2 ring-white dark:ring-gray-800 bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-[10px] font-medium text-gray-600 dark:text-gray-200 overflow-hidden"
                >
                  {m.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.photoURL} alt={m.name} className="w-full h-full object-cover" />
                  ) : (
                    getInitials(m.name)
                  )}
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-white dark:ring-gray-800',
                      dot,
                    )}
                  />
                </div>
              );
            })}
            {extra > 0 && (
              <div className="relative w-7 h-7 rounded-full ring-2 ring-white dark:ring-gray-800 bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-[9px] font-medium text-gray-500 dark:text-gray-300">
                +{extra}
              </div>
            )}
          </div>
        )}
      </div>
    </CardShell>
  );
}
