'use client';

/**
 * Dashboard — command-center home
 *
 * Layout: hero centrado com greeting + Agente IA, linha única de módulos
 * principais para navegação rápida, e uma fileira de mini-cards compactos
 * com KPIs operacionais (Agenda/Pedidos, Conversas, CRM, Financeiro). A
 * fileira de mini-cards alinha em largura com a fileira de ícones acima.
 *
 * O caso de uso (servicos / pedidos / simples) decide quais módulos e qual
 * mini-card de operação aparecem (Agenda só em serviços, Pedidos só em
 * pedidos).
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { useTranslation } from 'react-i18next';
import type {
  Appointment,
  CRMContact,
  Conversation,
  DeliveryOrder,
  Transaction,
  UseCase,
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
  Target,
  MessageSquare,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { enUS as enUSLocale } from 'date-fns/locale';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
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

// ─── Module catalog ──────────────────────────────────────────────────────────
interface ModuleEntry {
  id: MenuPage;
  label: string;
  icon: React.ElementType;
  bg: string;
  iconColor: string;
  useCases?: UseCase[];
  minRole?: UserRole;
}

// Paleta majoritariamente quente (família red/rose/pink/amber/orange) com
// alguns acentos frios (cyan/violet/slate) só para devolver a navegação
// visual — todos os ícones em uma única linha (flex-nowrap centrado).
const MODULES: ModuleEntry[] = [
  { id: 'Clientes',    label: 'Clientes',    icon: Users,           bg: 'bg-red-50 dark:bg-red-500/10',          iconColor: 'text-red-600 dark:text-red-400' },
  { id: 'CRM',         label: 'CRM',         icon: Target,          bg: 'bg-rose-50 dark:bg-rose-500/10',        iconColor: 'text-rose-600 dark:text-rose-400' },
  { id: 'Conversas',   label: 'Conversas',   icon: MessageSquare,   bg: 'bg-pink-50 dark:bg-pink-500/10',        iconColor: 'text-pink-600 dark:text-pink-400' },
  { id: 'Agenda',      label: 'Agenda',      icon: Calendar,        bg: 'bg-amber-50/80 dark:bg-amber-500/10',   iconColor: 'text-amber-600 dark:text-amber-400',   useCases: ['servicos'] },
  { id: 'Pedidos',     label: 'Pedidos',     icon: ClipboardCheck,  bg: 'bg-orange-50 dark:bg-orange-500/10',    iconColor: 'text-orange-600 dark:text-orange-400', useCases: ['pedidos'] },
  { id: 'PDV',         label: 'PDV',         icon: ShoppingCart,    bg: 'bg-emerald-50 dark:bg-emerald-500/10',  iconColor: 'text-emerald-600 dark:text-emerald-400' },
  { id: 'Vendas',      label: 'Vendas',      icon: ClipboardList,   bg: 'bg-indigo-50 dark:bg-indigo-500/10',    iconColor: 'text-indigo-600 dark:text-indigo-400' },
  { id: 'Financeiro',  label: 'Financeiro',  icon: DollarSign,      bg: 'bg-cyan-50 dark:bg-cyan-500/10',        iconColor: 'text-cyan-600 dark:text-cyan-400' },
  { id: 'Relatórios',  label: 'Relatórios',  icon: BarChart3,       bg: 'bg-violet-50/80 dark:bg-violet-500/10', iconColor: 'text-violet-600 dark:text-violet-400' },
  { id: 'NFSe',        label: 'Fiscal',      icon: FileCheck2,      bg: 'bg-slate-100 dark:bg-slate-500/10',     iconColor: 'text-slate-600 dark:text-slate-400' },
];

// ─── Main component ─────────────────────────────────────────────────────────
export default function DashboardModule() {
  const { t, i18n } = useTranslation();
  const { user, business } = useAuth();
  const { setActivePage } = useAppContext();
  const dateLocale = i18n.language === 'en-US' ? enUSLocale : ptBR;

  const useCase: UseCase = (business?.settings?.useCase as UseCase) || 'servicos';
  const showAgenda = useCase === 'servicos';
  const showOrders = useCase === 'pedidos';

  // ── Data queries — pequenas, focadas só no que os mini-cards precisam ─────
  const todayStr = new Date().toISOString().split('T')[0];

  const { data: appointments = [], isLoading: loadingAppts } = useQuery({
    queryKey: ['dashboard-appointments', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'appointments'), where('businessId', '==', business!.id));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Appointment));
    },
    enabled: !!business?.id && showAgenda,
    staleTime: 60_000,
  });

  const { data: deliveryOrders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['dashboard-orders', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'deliveryOrders'), where('businessId', '==', business!.id));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as DeliveryOrder));
    },
    enabled: !!business?.id && showOrders,
    staleTime: 60_000,
  });

  const { data: transactions = [], isLoading: loadingTx } = useQuery({
    queryKey: ['dashboard-transactions', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'transactions'), where('businessId', '==', business!.id));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Transaction));
    },
    enabled: !!business?.id,
    staleTime: 60_000,
  });

  const { data: conversations = [], isLoading: loadingConvs } = useQuery({
    queryKey: ['dashboard-conversations', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'conversations'), where('businessId', '==', business!.id));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Conversation));
    },
    enabled: !!business?.id,
    staleTime: 60_000,
  });

  const { data: crmContacts = [], isLoading: loadingCrm } = useQuery({
    queryKey: ['dashboard-crm', business?.id],
    queryFn: async () => {
      const q = query(collection(db, 'crmContacts'), where('businessId', '==', business!.id));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as CRMContact));
    },
    enabled: !!business?.id,
    staleTime: 60_000,
  });

  // ── Derived KPIs ─────────────────────────────────────────────────────────
  const todayAppointmentsCount = useMemo(
    () => appointments.filter((a) => a.date === todayStr && a.status !== 'cancelado').length,
    [appointments, todayStr],
  );
  const activeOrdersCount = useMemo(
    () => deliveryOrders.filter((o) => o.status !== 'entregue' && o.status !== 'cancelado').length,
    [deliveryOrders],
  );
  const pendingTxCount = useMemo(
    () => transactions.filter((t) => t.status === 'pendente' || t.status === 'atrasado').length,
    [transactions],
  );
  const overdueTxCount = useMemo(
    () => transactions.filter((t) => t.status === 'atrasado').length,
    [transactions],
  );
  const unreadConvsTotal = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    [conversations],
  );
  const openLeadsCount = useMemo(
    () => crmContacts.filter((c) => c.status !== 'ganho' && c.status !== 'perdido').length,
    [crmContacts],
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
  // Title-case do primeiro nome — mesmo se o usuário cadastrou como "IGOR" ou
  // "igor", apresentamos como "Igor" para a saudação não soar agressiva.
  const firstName = useMemo(() => {
    const raw = user?.name?.split(' ')[0] || '';
    return raw ? raw[0].toUpperCase() + raw.slice(1).toLowerCase() : '';
  }, [user?.name]);
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
      className="max-w-6xl mx-auto space-y-6 sm:space-y-8"
    >
      {/* ━━━ Hero with AI input ━━━ */}
      <motion.section variants={fadeUp} className="pt-2 sm:pt-6">
        <AgentHeroInput greeting={greeting} firstName={firstName} subtitle={subtitle} />
      </motion.section>

      {/* ━━━ Module circles — single line, centered. pt-3 dá folga pro hover-lift ━━━ */}
      <motion.section variants={fadeUp}>
        <div className="flex flex-nowrap items-start justify-center gap-x-3 sm:gap-x-4 lg:gap-x-5 overflow-x-auto pt-3 pb-2 -mx-1 px-1 scrollbar-thin">
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

      {/* ━━━ Mini-cards: 4 KPIs operacionais alinhados com a linha de ícones ━━━ */}
      <motion.section variants={fadeUp}>
        <div className="flex justify-center gap-2.5 sm:gap-3 max-w-[920px] mx-auto">
          {/* Agenda (servicos) ou Pedidos (pedidos) */}
          {showAgenda && (
            <MiniCard
              label="Agenda hoje"
              icon={Calendar}
              accent="amber"
              loading={loadingAppts}
              value={todayAppointmentsCount}
              subtitle={
                todayAppointmentsCount === 0
                  ? 'Sem agendamentos'
                  : todayAppointmentsCount === 1
                    ? 'agendamento'
                    : 'agendamentos'
              }
              onClick={() => setActivePage('Agenda')}
            />
          )}
          {showOrders && (
            <MiniCard
              label="Pedidos ativos"
              icon={ClipboardCheck}
              accent="orange"
              loading={loadingOrders}
              value={activeOrdersCount}
              subtitle={
                activeOrdersCount === 0
                  ? 'Sem pedidos ativos'
                  : activeOrdersCount === 1
                    ? 'em andamento'
                    : 'em andamento'
              }
              onClick={() => setActivePage('Pedidos')}
            />
          )}

          {/* Conversas */}
          <MiniCard
            label="Conversas"
            icon={MessageSquare}
            accent="pink"
            loading={loadingConvs}
            value={unreadConvsTotal}
            subtitle={unreadConvsTotal === 0 ? 'Sem mensagens novas' : 'mensagens não lidas'}
            onClick={() => setActivePage('Conversas')}
          />

          {/* CRM */}
          <MiniCard
            label="CRM"
            icon={Target}
            accent="rose"
            loading={loadingCrm}
            value={openLeadsCount}
            subtitle={
              openLeadsCount === 0
                ? 'Sem leads abertos'
                : openLeadsCount === 1
                  ? 'lead aberto'
                  : 'leads abertos'
            }
            onClick={() => setActivePage('CRM')}
          />

          {/* Financeiro */}
          <MiniCard
            label="Financeiro"
            icon={DollarSign}
            accent={overdueTxCount > 0 ? 'red' : 'cyan'}
            loading={loadingTx}
            value={pendingTxCount}
            subtitle={
              pendingTxCount === 0
                ? 'Tudo em dia'
                : overdueTxCount > 0
                  ? `${overdueTxCount} atrasada${overdueTxCount > 1 ? 's' : ''}`
                  : pendingTxCount === 1
                    ? 'pendente'
                    : 'pendentes'
            }
            onClick={() => setActivePage('Financeiro')}
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
      className="group flex flex-col items-center gap-2 flex-shrink-0 w-[68px] sm:w-[76px] focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 rounded-2xl"
    >
      <div
        className={cn(
          'w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center',
          'border border-gray-200/60 dark:border-gray-700/40',
          'group-hover:border-gray-300 dark:group-hover:border-gray-600/60 transition-colors',
          module.bg,
        )}
      >
        <Icon className={cn('w-5 h-5 sm:w-[22px] sm:h-[22px]', module.iconColor)} strokeWidth={1.9} />
      </div>
      <span className="text-[10px] sm:text-xs font-medium text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200 transition-colors text-center leading-tight">
        {module.label}
      </span>
    </motion.button>
  );
}

// ─── Mini card ──────────────────────────────────────────────────────────────
type AccentKey = 'amber' | 'orange' | 'pink' | 'rose' | 'cyan' | 'red';
const ACCENT: Record<AccentKey, { bg: string; icon: string; line: string }> = {
  amber:  { bg: 'bg-amber-50 dark:bg-amber-500/10',   icon: 'text-amber-600 dark:text-amber-400',   line: 'bg-amber-500 dark:bg-amber-400' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-500/10', icon: 'text-orange-600 dark:text-orange-400', line: 'bg-orange-500 dark:bg-orange-400' },
  pink:   { bg: 'bg-pink-50 dark:bg-pink-500/10',     icon: 'text-pink-600 dark:text-pink-400',     line: 'bg-pink-500 dark:bg-pink-400' },
  rose:   { bg: 'bg-rose-50 dark:bg-rose-500/10',     icon: 'text-rose-600 dark:text-rose-400',     line: 'bg-rose-500 dark:bg-rose-400' },
  cyan:   { bg: 'bg-cyan-50 dark:bg-cyan-500/10',     icon: 'text-cyan-600 dark:text-cyan-400',     line: 'bg-cyan-500 dark:bg-cyan-400' },
  red:    { bg: 'bg-red-50 dark:bg-red-500/10',       icon: 'text-red-600 dark:text-red-400',       line: 'bg-red-500 dark:bg-red-400' },
};

function MiniCard({
  label,
  icon: Icon,
  accent,
  loading,
  value,
  subtitle,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  accent: AccentKey;
  loading: boolean;
  value: number;
  subtitle: string;
  onClick: () => void;
}) {
  const a = ACCENT[accent];
  return (
    <motion.button
      variants={popIn}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'group relative flex-1 min-w-0 max-w-[220px] rounded-xl px-3 py-2.5 text-left',
        'bg-white/60 dark:bg-gray-800/30',
        'border border-gray-200/60 dark:border-gray-700/40',
        'hover:border-gray-300 dark:hover:border-gray-600/60',
        'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30',
      )}
    >
      {/* Top accent line — fica acima da borda, com cap rounded e inset dos lados */}
      <span
        className={cn(
          'absolute -top-px inset-x-3 h-[2px] rounded-full transition-all',
          a.line,
          'group-hover:inset-x-2',
        )}
        aria-hidden
      />

      <div className="flex items-center gap-2 mb-1">
        <div className={cn('w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0', a.bg)}>
          <Icon className={cn('w-3.5 h-3.5', a.icon)} strokeWidth={1.9} />
        </div>
        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">
          {label}
        </p>
      </div>
      {loading ? (
        <>
          <div className="h-5 w-10 rounded shimmer mb-1" />
          <div className="h-3 w-20 rounded shimmer" />
        </>
      ) : (
        <>
          <p className="font-display text-lg font-semibold text-gray-900 dark:text-white leading-none">
            {value}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 truncate">
            {subtitle}
          </p>
        </>
      )}
    </motion.button>
  );
}
