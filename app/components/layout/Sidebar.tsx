'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Calendar,
  ShoppingCart,
  DollarSign,
  Package,
  FileCheck2,
  Receipt,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  Kanban,
  Target,
  MessageSquare,
  Users,
  ClipboardList,
  ShoppingBag,
  ClipboardCheck,
  UtensilsCrossed,
  BarChart3,
} from 'lucide-react';
import type { UseCase, UserRole } from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';

export type MenuPage =
  | 'Dashboard'
  | 'Clientes'
  | 'CRM'
  | 'Agenda'
  | 'Conversas'
  | 'Kanban'
  | 'PDV'
  | 'Vendas'
  | 'Compras'
  | 'Financeiro'
  | 'Estoque'
  | 'Pedidos'
  | 'Cardápio'
  | 'NFSe'
  | 'NFCe'
  | 'NFe'
  | 'Relatórios'
  | 'Configurações';

// Which use cases each module appears under. `undefined` means "always visible".
const ALL_USE_CASES: UseCase[] = ['pedidos', 'servicos', 'times', 'simples'];

interface MenuItemConfig {
  id: MenuPage;
  label: string;
  icon: React.ElementType;
  comingSoon?: boolean;
  enterpriseOnly?: boolean;
  useCases?: UseCase[];
  minRole?: UserRole;
}

interface MenuSection {
  title: string;
  items: MenuItemConfig[];
}

function useMenuSections(): MenuSection[] {
  const { t } = useTranslation();
  return [
    {
      title: t('sidebar.sections.principal'),
      items: [
        { id: 'Dashboard', label: t('sidebar.dashboard'), icon: LayoutDashboard },
        { id: 'Clientes', label: t('sidebar.clientes'), icon: Users },
        { id: 'CRM', label: t('sidebar.crm'), icon: Target, enterpriseOnly: true, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Agenda', label: t('sidebar.agenda'), icon: Calendar, useCases: ['servicos'] },
        { id: 'Conversas', label: t('sidebar.conversas'), icon: MessageSquare },
        { id: 'PDV', label: t('sidebar.pdv'), icon: ShoppingCart, useCases: ['pedidos', 'servicos', 'simples'] },
      ],
    },
    {
      title: t('sidebar.sections.gestao'),
      items: [
        { id: 'Pedidos', label: t('sidebar.pedidos', 'Pedidos'), icon: ClipboardCheck, useCases: ['pedidos'] },
        { id: 'Cardápio', label: t('sidebar.cardapio', 'Cardápio'), icon: UtensilsCrossed, useCases: ['pedidos'] },
        { id: 'Vendas', label: t('sidebar.vendas'), icon: ClipboardList, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Kanban', label: t('sidebar.kanban'), icon: Kanban, enterpriseOnly: true, useCases: ['times'] },
        { id: 'Financeiro', label: t('sidebar.financeiro'), icon: DollarSign, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Relatórios', label: t('sidebar.relatorios', 'Relatórios'), icon: BarChart3, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Estoque', label: t('sidebar.estoque'), icon: Package, useCases: ['pedidos', 'servicos', 'simples'] },
        { id: 'Compras', label: t('sidebar.compras'), icon: ShoppingBag, useCases: ['pedidos', 'servicos', 'simples'] },
      ],
    },
    {
      title: t('sidebar.sections.fiscal'),
      items: [
        { id: 'NFSe', label: t('sidebar.nfse'), icon: FileCheck2, useCases: ['pedidos', 'servicos', 'simples'], minRole: 'manager' },
        { id: 'NFCe', label: t('sidebar.nfce'), icon: Receipt, useCases: ['pedidos', 'servicos', 'simples'], minRole: 'manager' },
        { id: 'NFe', label: t('sidebar.nfe'), icon: FileText, useCases: ['pedidos', 'servicos', 'simples'], minRole: 'manager' },
      ],
    },
    {
      title: t('sidebar.sections.sistema'),
      items: [
        { id: 'Configurações', label: t('sidebar.configuracoes'), icon: Settings },
      ],
    },
  ];
}

interface SidebarProps {
  activePage: MenuPage;
  onMenuSelect: (page: MenuPage) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
}

function MenuItem({
  item,
  isActive,
  isCollapsed,
  onSelect,
}: {
  item: MenuItemConfig;
  isActive: boolean;
  isCollapsed: boolean;
  onSelect: () => void;
}) {
  const [clicked, setClicked] = useState(false);
  const Icon = item.icon;

  const handleClick = () => {
    setClicked(true);
    setTimeout(() => setClicked(false), 560);
    onSelect();
  };

  return (
    <div className="relative">
      <motion.button
        whileTap={{ scale: 0.93 }}
        onClick={handleClick}
        title={isCollapsed ? item.label : undefined}
        className={cn(
          'group relative flex items-center w-full rounded-xl transition-all duration-200 focus-visible:outline-none',
          isCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5',
          isActive
            ? 'text-white'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
        )}
      >
        {isActive && (
          <motion.div
            layoutId="sidebar-active-pill"
            className="absolute inset-0 rounded-xl bg-gradient-to-r from-red-600 to-red-500 shadow-md shadow-red-500/25"
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          />
        )}
        {!isActive && (
          <div className="absolute inset-0 rounded-xl bg-gray-100 dark:bg-white/[0.04] opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
        )}

        {/* Click ripple burst */}
        <AnimatePresence>
          {clicked && (
            <motion.span
              initial={{ opacity: 0.45, scale: 0.3 }}
              animate={{ opacity: 0, scale: 2.5 }}
              exit={{}}
              transition={{ duration: 0.52, ease: [0.2, 0, 0.3, 1] }}
              className="absolute inset-0 rounded-xl bg-red-400/20 pointer-events-none"
            />
          )}
        </AnimatePresence>

        <Icon
          className={cn(
            'relative z-10 flex-shrink-0 transition-all duration-200',
            isCollapsed ? 'w-[19px] h-[19px]' : 'w-[18px] h-[18px]',
            isActive
              ? 'text-white'
              : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 group-hover:scale-110'
          )}
        />

        <AnimatePresence initial={false}>
          {!isCollapsed && (
            <motion.span
              key="label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              className={cn(
                'relative z-10 text-[15px] font-medium truncate leading-none flex-1 text-left',
                isActive ? 'text-white' : ''
              )}
            >
              {item.label}
            </motion.span>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {!isCollapsed && item.comingSoon && (
            <motion.span
              key="badge"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              className={cn(
                'relative z-10 text-[10px] font-semibold px-1.5 py-0.5 rounded-md',
                isActive
                  ? 'bg-white/20 text-white'
                  : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200/80 dark:border-amber-500/20'
              )}
            >
              Beta
            </motion.span>
          )}
        </AnimatePresence>

        {/* Tooltip for collapsed state */}
        {isCollapsed && (
          <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-[13px] font-medium whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-all duration-150 z-50 shadow-xl translate-x-1 group-hover:translate-x-0">
            {item.label}
            <div className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-gray-900 dark:border-r-gray-700" />
          </div>
        )}
      </motion.button>
    </div>
  );
}

function SectionHeader({ title, isCollapsed }: { title: string; isCollapsed: boolean }) {
  return (
    <div className={cn(
      'flex items-center',
      isCollapsed ? 'mx-3 my-2' : 'gap-2.5 px-3 pt-1 pb-2'
    )}>
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.span
            key="title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="text-[11px] font-bold tracking-[0.1em] text-red-500 dark:text-red-400 uppercase select-none whitespace-nowrap"
          >
            {title}
          </motion.span>
        )}
      </AnimatePresence>
      <div
        className="flex-1 h-px"
        style={{
          background: isCollapsed
            ? 'linear-gradient(to right, transparent, rgba(239,68,68,0.22), transparent)'
            : 'linear-gradient(to right, rgba(239,68,68,0.38) 0%, rgba(239,68,68,0.1) 45%, transparent 100%)',
        }}
      />
    </div>
  );
}

function SidebarContent({
  activePage,
  onMenuSelect,
  isCollapsed,
  onToggleCollapse,
  isMobile,
  onMobileClose,
}: SidebarProps & { isMobile?: boolean }) {
  const { signOut, business, user } = useAuth();
  const { t } = useTranslation();
  const menuSections = useMenuSections();
  const collapsed = isCollapsed && !isMobile;
  const isEnterprise = !!business?.enterprise?.isEnabled;
  const currentUseCase: UseCase = (business?.settings?.useCase as UseCase) || 'servicos';
  const userRoleValue = ROLE_HIERARCHY[user?.role ?? 'viewer'];

  const filterItems = (items: MenuItemConfig[]) =>
    items.filter((item) => {
      if (item.enterpriseOnly && !isEnterprise) return false;
      if (item.useCases && !item.useCases.includes(currentUseCase)) return false;
      if (item.minRole && userRoleValue < ROLE_HIERARCHY[item.minRole]) return false;
      return true;
    });

  return (
    <div
      className={cn(
        'flex flex-col h-full',
        'bg-white dark:bg-[#0a0e17]',
        'border-r border-gray-200/60 dark:border-gray-800/60',
        'transition-[width] duration-300 ease-in-out',
        collapsed ? 'w-[64px]' : 'w-[264px]'
      )}
    >
      {/* ── Header ── */}
      {collapsed ? (
        /* Collapsed: full-area expand button */
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={onToggleCollapse}
          className="group flex items-center justify-center h-[60px] w-full border-b border-gray-100 dark:border-gray-800/80 flex-shrink-0 hover:bg-red-50/60 dark:hover:bg-red-500/[0.07] transition-all duration-200"
          title={t('sidebar.expandMenu')}
        >
          <ChevronRight className="w-5 h-5 text-red-500 dark:text-red-400 group-hover:translate-x-0.5 transition-transform duration-200" />
        </motion.button>
      ) : (
        /* Expanded: logo + collapse button */
        <div className="flex items-center justify-between h-[60px] px-4 border-b border-gray-100 dark:border-gray-800/80 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/icon.png" alt="Aevo" className="w-8 h-8 rounded-xl object-contain flex-shrink-0" />
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className="min-w-0"
            >
              <p className="text-[14px] font-bold text-gray-900 dark:text-gray-100 font-display tracking-tight leading-tight">Aevo</p>
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 font-medium leading-tight">{t('sidebar.smartManagement')}</p>
            </motion.div>
          </div>

          <div className="flex items-center gap-1">
            {isMobile ? (
              <button
                onClick={onMobileClose}
                className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={onToggleCollapse}
                className="group p-1.5 rounded-lg hover:bg-red-50/60 dark:hover:bg-red-500/[0.07] transition-all duration-150"
                title={t('sidebar.collapseMenu')}
              >
                <ChevronLeft className="w-4 h-4 text-red-500 dark:text-red-400 group-hover:-translate-x-0.5 transition-transform duration-200" />
              </motion.button>
            )}
          </div>
        </div>
      )}

      {/* ── Navigation ── */}
      <nav
        className={cn(
          'flex-1 overflow-y-auto overflow-x-hidden py-3',
          collapsed ? 'px-1.5' : 'px-2.5'
        )}
        style={{ scrollbarWidth: 'none' }}
      >
        {menuSections.map((section, sectionIdx) => {
          const visibleItems = filterItems(section.items);
          if (visibleItems.length === 0) return null;
          return (
          <div key={section.title} className={cn(sectionIdx > 0 && 'mt-1')}>
            <SectionHeader title={section.title} isCollapsed={collapsed} />

            <div className="space-y-0.5">
              {visibleItems
                .map((item) => (
                <MenuItem
                  key={item.id}
                  item={item}
                  isActive={activePage === item.id}
                  isCollapsed={collapsed}
                  onSelect={() => {
                    onMenuSelect(item.id);
                    if (isMobile) onMobileClose();
                  }}
                />
              ))}
            </div>
          </div>
          );
        })}
      </nav>

      {/* ── Footer ── */}
      <div className={cn(
        'border-t border-gray-100 dark:border-gray-800/80 flex-shrink-0 p-2'
      )}>
        <button
          onClick={signOut}
          className={cn(
            'group flex items-center w-full rounded-xl px-3 py-2.5',
            'text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50/80 dark:hover:bg-red-500/[0.08]',
            'transition-all duration-200',
            collapsed ? 'justify-center' : 'gap-3'
          )}
          title={collapsed ? t('sidebar.logout') : undefined}
        >
          <LogOut className="w-[17px] h-[17px] group-hover:translate-x-0.5 transition-transform duration-150 flex-shrink-0" />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                key="sair"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
                className="text-[15px] font-medium"
              >
                {t('sidebar.logout')}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </div>
  );
}

export default function Sidebar(props: SidebarProps) {
  const { isMobileOpen, onMobileClose } = props;

  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMobileOpen]);

  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:block flex-shrink-0 h-screen sticky top-0">
        <SidebarContent {...props} isMobile={false} />
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={onMobileClose}
              className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-[2px] z-40 lg:hidden"
            />
            <motion.div
              key="drawer"
              initial={{ x: -280, opacity: 0.5 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              className="fixed inset-y-0 left-0 z-50 lg:hidden shadow-2xl"
            >
              <SidebarContent
                {...props}
                isMobile={true}
                isCollapsed={false}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
