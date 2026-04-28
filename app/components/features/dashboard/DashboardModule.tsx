'use client';

/**
 * Dashboard — command-center home
 *
 * Layout enxuto: hero centrado com greeting + Agente IA, e logo abaixo uma
 * linha única de módulos principais para navegação rápida. Sem cards
 * informativos — o agente é o ponto de entrada para qualquer dado.
 *
 * O caso de uso (servicos / pedidos / simples) decide quais módulos aparecem
 * (Agenda só em serviços, Pedidos/Cardápio só em pedidos).
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { useTranslation } from 'react-i18next';
import type { UseCase, UserRole } from '@/lib/types';
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
  /** Tinted bg (light/dark) — e.g., 'bg-blue-50 dark:bg-blue-500/10'. */
  bg: string;
  /** Icon color — e.g., 'text-blue-600 dark:text-blue-400'. */
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
      className="max-w-6xl mx-auto space-y-8 sm:space-y-10"
    >
      {/* ━━━ Hero with AI input ━━━ */}
      <motion.section variants={fadeUp} className="pt-2 sm:pt-6">
        <AgentHeroInput greeting={greeting} firstName={firstName} subtitle={subtitle} />
      </motion.section>

      {/* ━━━ Module circles — single line, centered, scrolls if overflow ━━━ */}
      <motion.section variants={fadeUp}>
        <div className="flex flex-nowrap items-start justify-center gap-x-3 sm:gap-x-4 lg:gap-x-5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
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
      className="group flex flex-col items-center gap-2 flex-shrink-0 w-[68px] sm:w-[76px]"
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
