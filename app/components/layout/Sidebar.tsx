'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import { useAuth } from '@/app/components/providers/AuthProvider';
import {
  LayoutDashboard,
  Users,
  Calendar,
  ShoppingCart,
  DollarSign,
  Package,
  FileCheck2,
  Receipt,
  FileText,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  Sparkles,
  Kanban,
  Target,
} from 'lucide-react';

export type MenuPage =
  | 'Dashboard'
  | 'Clientes'
  | 'CRM'
  | 'Agenda'
  | 'Kanban'
  | 'PDV'
  | 'Financeiro'
  | 'Estoque'
  | 'NFSe'
  | 'NFCe'
  | 'NFe'
  | 'Configurações'
  | 'Ajuda';

interface MenuItemConfig {
  id: MenuPage;
  label: string;
  icon: React.ElementType;
  comingSoon?: boolean;
}

interface MenuSection {
  title: string;
  items: MenuItemConfig[];
}

const menuSections: MenuSection[] = [
  {
    title: 'PRINCIPAL',
    items: [
      { id: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'Clientes', label: 'Clientes', icon: Users },
      { id: 'CRM', label: 'CRM', icon: Target },
      { id: 'Agenda', label: 'Agenda', icon: Calendar },
      { id: 'PDV', label: 'Ponto de Venda', icon: ShoppingCart },
    ],
  },
  {
    title: 'GESTÃO',
    items: [
      { id: 'Kanban', label: 'Kanban', icon: Kanban },
      { id: 'Financeiro', label: 'Financeiro', icon: DollarSign },
      { id: 'Estoque', label: 'Estoque', icon: Package },
    ],
  },
  {
    title: 'FISCAL',
    items: [
      { id: 'NFSe', label: 'NFSe', icon: FileCheck2, comingSoon: false },
      { id: 'NFCe', label: 'NFCe', icon: Receipt, comingSoon: false },
      { id: 'NFe', label: 'NFe', icon: FileText, comingSoon: false },
    ],
  },
  {
    title: 'SISTEMA',
    items: [
      { id: 'Configurações', label: 'Configurações', icon: Settings },
      { id: 'Ajuda', label: 'Central de Ajuda', icon: HelpCircle },
    ],
  },
];

interface SidebarProps {
  activePage: MenuPage;
  onMenuSelect: (page: MenuPage) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onMobileClose: () => void;
}

function SidebarMenuItem({
  item,
  isActive,
  isCollapsed,
  onSelect,
  index,
}: {
  item: MenuItemConfig;
  isActive: boolean;
  isCollapsed: boolean;
  onSelect: () => void;
  index: number;
}) {
  const Icon = item.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className="relative"
    >
      <button
        onClick={onSelect}
        title={isCollapsed ? item.label : undefined}
        className={cn(
          'group relative flex items-center w-full rounded-xl',
          'transition-all duration-200 focus-visible:outline-none',
          isCollapsed ? 'justify-center px-2.5 py-2.5' : 'gap-3 px-3 py-2.5',
          isActive
            ? 'text-white'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
        )}
      >
        {/* Active background pill with layoutId for smooth animation */}
        {isActive && (
          <motion.div
            layoutId="sidebar-active-pill"
            className="absolute inset-0 rounded-xl sidebar-item-active"
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          />
        )}

        {/* Hover ripple (non-active items) */}
        {!isActive && (
          <motion.div
            className="absolute inset-0 rounded-xl bg-gray-100 dark:bg-white/[0.04] opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          />
        )}

        <Icon
          className={cn(
            'relative z-10 flex-shrink-0 transition-all duration-200',
            isCollapsed ? 'w-[18px] h-[18px]' : 'w-[17px] h-[17px]',
            isActive
              ? 'text-white'
              : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 group-hover:scale-110'
          )}
        />

        {!isCollapsed && (
          <span className={cn(
            'relative z-10 text-sm font-medium truncate leading-none flex-1',
            isActive ? 'text-white' : ''
          )}>
            {item.label}
          </span>
        )}

        {!isCollapsed && item.comingSoon && (
          <span className={cn(
            'relative z-10 text-[10px] font-semibold px-1.5 py-0.5 rounded-md',
            isActive
              ? 'bg-white/20 text-white'
              : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200/80 dark:border-amber-500/20'
          )}>
            Beta
          </span>
        )}

        {/* Tooltip for collapsed */}
        {isCollapsed && (
          <div className="absolute left-full ml-3.5 px-2.5 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-700 text-white text-xs font-medium whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-all duration-150 z-50 shadow-xl translate-x-1 group-hover:translate-x-0">
            {item.label}
            <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900 dark:border-r-gray-700" />
          </div>
        )}
      </button>
    </motion.div>
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
  const { user, business, signOut } = useAuth();
  const userName = user?.name || 'Usuário';
  const businessName = business?.nomeFantasia || 'Meu Negócio';
  const collapsed = isCollapsed && !isMobile;

  return (
    <div
      className={cn(
        'flex flex-col h-full',
        'bg-white dark:bg-[#0a0e17]',
        'border-r border-gray-200/60 dark:border-gray-800/60',
        'transition-[width] duration-300 ease-in-out',
        collapsed ? 'w-[68px]' : 'w-[256px]'
      )}
    >
      {/* ── Logo Header ── */}
      <div className={cn(
        'flex items-center h-[60px] border-b border-gray-100 dark:border-gray-800/80 flex-shrink-0',
        collapsed ? 'justify-center px-3' : 'justify-between px-4',
      )}>
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              key="logo-full"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2.5 min-w-0"
            >
              <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center flex-shrink-0 shadow-md shadow-red-500/30">
                <span className="text-white font-bold text-sm font-display leading-none">S</span>
                <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/20 to-transparent" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100 font-display tracking-tight">ServicePro</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">Gestão Inteligente</p>
              </div>
            </motion.div>
          )}
          {collapsed && (
            <motion.div
              key="logo-collapsed"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2 }}
              className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-md shadow-red-500/30"
            >
              <span className="text-white font-bold text-sm font-display">S</span>
              <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/20 to-transparent" />
            </motion.div>
          )}
        </AnimatePresence>

        {isMobile && (
          <button
            onClick={onMobileClose}
            className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        )}
      </div>

      {/* ── User Profile ── */}
      <div className={cn(
        'border-b border-gray-100 dark:border-gray-800/80 flex-shrink-0',
        collapsed ? 'px-3 py-3' : 'px-3 py-3'
      )}>
        <motion.div
          layout
          className={cn(
            'flex items-center rounded-xl',
            collapsed ? 'justify-center' : 'gap-3 px-1 py-1',
          )}
        >
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <div className={cn(
              'rounded-full flex items-center justify-center text-xs font-bold',
              'bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 text-red-700 dark:text-red-400',
              'border-2 border-red-200/60 dark:border-red-800/40 shadow-sm',
              collapsed ? 'w-9 h-9' : 'w-9 h-9'
            )}>
              {user?.photoURL ? (
                <img src={user.photoURL} alt={userName} className="w-full h-full rounded-full object-cover" />
              ) : (
                getInitials(userName)
              )}
            </div>
            {/* Online indicator */}
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white dark:border-[#0a0e17]" />
          </div>

          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2 }}
                className="min-w-0 flex-1 overflow-hidden"
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-tight">{userName}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{businessName}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* ── Navigation ── */}
      <nav
        className={cn(
          'flex-1 overflow-y-auto overflow-x-hidden py-3',
          collapsed ? 'px-2' : 'px-2.5'
        )}
        style={{ scrollbarWidth: 'none' }}
      >
        {menuSections.map((section, sectionIdx) => (
          <div key={section.title} className={cn(sectionIdx > 0 && 'mt-4')}>
            {!collapsed && (
              <p className="px-3 mb-1.5 text-[10px] font-bold tracking-[0.08em] text-gray-300 dark:text-gray-600 uppercase select-none">
                {section.title}
              </p>
            )}
            {collapsed && sectionIdx > 0 && (
              <div className="mx-3 mb-3 border-t border-gray-100 dark:border-gray-800" />
            )}

            <div className="space-y-0.5">
              {section.items.map((item, itemIdx) => (
                <SidebarMenuItem
                  key={item.id}
                  item={item}
                  isActive={activePage === item.id}
                  isCollapsed={collapsed}
                  index={sectionIdx * 10 + itemIdx}
                  onSelect={() => {
                    onMenuSelect(item.id);
                    if (isMobile) onMobileClose();
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className={cn(
        'border-t border-gray-100 dark:border-gray-800/80 flex-shrink-0 p-2 space-y-0.5'
      )}>
        {/* Collapse toggle — desktop only */}
        {!isMobile && (
          <button
            onClick={onToggleCollapse}
            className={cn(
              'group flex items-center w-full rounded-xl px-3 py-2.5',
              'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04]',
              'transition-all duration-200',
              collapsed ? 'justify-center' : 'gap-3'
            )}
          >
            {collapsed ? (
              <ChevronRight className="w-[17px] h-[17px] group-hover:translate-x-0.5 transition-transform duration-150" />
            ) : (
              <>
                <ChevronLeft className="w-[17px] h-[17px] group-hover:-translate-x-0.5 transition-transform duration-150" />
                <span className="text-sm font-medium">Recolher</span>
              </>
            )}
          </button>
        )}

        {/* Sign out */}
        <button
          onClick={signOut}
          className={cn(
            'group flex items-center w-full rounded-xl px-3 py-2.5',
            'text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50/80 dark:hover:bg-red-500/[0.08]',
            'transition-all duration-200',
            collapsed ? 'justify-center' : 'gap-3'
          )}
          title={collapsed ? 'Sair' : undefined}
        >
          <LogOut className="w-[17px] h-[17px] group-hover:translate-x-0.5 transition-transform duration-150 flex-shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Sair</span>}
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
      {/* Desktop — sticky full-height */}
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
