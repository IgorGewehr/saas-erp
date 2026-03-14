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
} from 'lucide-react';

export type MenuPage =
  | 'Dashboard'
  | 'Clientes'
  | 'Agenda'
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
      { id: 'Agenda', label: 'Agenda', icon: Calendar },
      { id: 'PDV', label: 'PDV', icon: ShoppingCart },
    ],
  },
  {
    title: 'GESTÃO',
    items: [
      { id: 'Financeiro', label: 'Financeiro', icon: DollarSign },
      { id: 'Estoque', label: 'Estoque', icon: Package },
    ],
  },
  {
    title: 'FISCAL',
    items: [
      { id: 'NFSe', label: 'NFSe', icon: FileCheck2, comingSoon: true },
      { id: 'NFCe', label: 'NFCe', icon: Receipt, comingSoon: true },
      { id: 'NFe', label: 'NFe', icon: FileText, comingSoon: true },
    ],
  },
  {
    title: 'CONFIGURAÇÕES',
    items: [
      { id: 'Configurações', label: 'Configurações', icon: Settings },
      { id: 'Ajuda', label: 'Ajuda', icon: HelpCircle },
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
}: {
  item: MenuItemConfig;
  isActive: boolean;
  isCollapsed: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;

  return (
    <button
      onClick={onSelect}
      title={isCollapsed ? item.label : undefined}
      className={cn(
        'group relative flex items-center w-full rounded-xl transition-all duration-200',
        isCollapsed ? 'justify-center px-3 py-2.5' : 'gap-3 px-3 py-2.5',
        isActive
          ? 'bg-gradient-to-r from-red-600 to-red-500 text-white shadow-md shadow-red-500/20'
          : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900'
      )}
    >
      <Icon
        className={cn(
          'flex-shrink-0 transition-colors duration-200',
          isCollapsed ? 'w-5 h-5' : 'w-[18px] h-[18px]',
          isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-600'
        )}
      />

      {!isCollapsed && (
        <>
          <span className={cn('text-sm font-medium truncate', isActive ? 'text-white' : '')}>
            {item.label}
          </span>

          {item.comingSoon && (
            <span
              className={cn(
                'ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                isActive
                  ? 'bg-white/20 text-white'
                  : 'bg-amber-50 text-amber-600 border border-amber-200'
              )}
            >
              Em breve
            </span>
          )}
        </>
      )}

      {/* Tooltip for collapsed state */}
      {isCollapsed && (
        <div
          className={cn(
            'absolute left-full ml-3 px-2.5 py-1.5 rounded-lg',
            'bg-gray-900 text-white text-xs font-medium whitespace-nowrap',
            'opacity-0 pointer-events-none group-hover:opacity-100',
            'transition-opacity duration-200 z-50',
            'shadow-lg'
          )}
        >
          {item.label}
          {item.comingSoon && (
            <span className="ml-1.5 text-amber-300">(Em breve)</span>
          )}
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
        </div>
      )}
    </button>
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

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-white border-r border-gray-200/80',
        'transition-all duration-300 ease-in-out',
        isCollapsed && !isMobile ? 'w-[72px]' : 'w-[260px]'
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center h-16 border-b border-gray-100 flex-shrink-0',
          isCollapsed && !isMobile ? 'justify-center px-3' : 'justify-between px-5'
        )}
      >
        {(!isCollapsed || isMobile) && (
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-red-500/20">
              <span className="text-white font-bold text-sm font-display">S</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-gray-900 font-display truncate">ServicePro</h2>
            </div>
          </div>
        )}

        {isCollapsed && !isMobile && (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-red-500/20">
            <span className="text-white font-bold text-sm font-display">S</span>
          </div>
        )}

        {isMobile && (
          <button
            onClick={onMobileClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* User section */}
      <div
        className={cn(
          'border-b border-gray-100 flex-shrink-0',
          isCollapsed && !isMobile ? 'px-3 py-3' : 'px-4 py-3'
        )}
      >
        <div
          className={cn(
            'flex items-center',
            isCollapsed && !isMobile ? 'justify-center' : 'gap-3'
          )}
        >
          <div
            className={cn(
              'flex-shrink-0 rounded-full bg-gradient-to-br from-red-100 to-red-50',
              'flex items-center justify-center text-red-600 font-semibold border border-red-200/50',
              isCollapsed && !isMobile ? 'w-9 h-9 text-xs' : 'w-9 h-9 text-xs'
            )}
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={userName}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              getInitials(userName)
            )}
          </div>

          {(!isCollapsed || isMobile) && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 truncate">{userName}</p>
              <p className="text-xs text-gray-500 truncate">{businessName}</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav
        className={cn(
          'flex-1 overflow-y-auto overflow-x-hidden py-4',
          isCollapsed && !isMobile ? 'px-2' : 'px-3',
          // Auto-hiding scrollbar
          'scrollbar-thin scrollbar-thumb-gray-200 hover:scrollbar-thumb-gray-300'
        )}
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'transparent transparent',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget.style.scrollbarColor as string) = 'rgba(0,0,0,0.15) transparent';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget.style.scrollbarColor as string) = 'transparent transparent';
        }}
      >
        {menuSections.map((section, sectionIndex) => (
          <div key={section.title} className={cn(sectionIndex > 0 && 'mt-5')}>
            {(!isCollapsed || isMobile) && (
              <p className="px-3 mb-2 text-[10px] font-bold tracking-widest text-gray-400 uppercase">
                {section.title}
              </p>
            )}

            {isCollapsed && !isMobile && sectionIndex > 0 && (
              <div className="mx-3 mb-3 border-t border-gray-100" />
            )}

            <div className="space-y-0.5">
              {section.items.map((item) => (
                <SidebarMenuItem
                  key={item.id}
                  item={item}
                  isActive={activePage === item.id}
                  isCollapsed={isCollapsed && !isMobile}
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

      {/* Footer */}
      <div
        className={cn(
          'border-t border-gray-100 flex-shrink-0',
          isCollapsed && !isMobile ? 'p-2' : 'p-3'
        )}
      >
        {/* Collapse toggle (desktop only) */}
        {!isMobile && (
          <button
            onClick={onToggleCollapse}
            className={cn(
              'flex items-center w-full rounded-xl px-3 py-2.5',
              'text-gray-400 hover:text-gray-600 hover:bg-gray-100/80',
              'transition-all duration-200',
              isCollapsed ? 'justify-center' : 'gap-3'
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="w-4.5 h-4.5" />
            ) : (
              <>
                <ChevronLeft className="w-[18px] h-[18px]" />
                <span className="text-sm font-medium">Recolher</span>
              </>
            )}
          </button>
        )}

        {/* Sign out */}
        <button
          onClick={signOut}
          className={cn(
            'flex items-center w-full rounded-xl px-3 py-2.5',
            'text-gray-400 hover:text-red-600 hover:bg-red-50',
            'transition-all duration-200',
            isCollapsed && !isMobile ? 'justify-center' : 'gap-3'
          )}
          title={isCollapsed && !isMobile ? 'Sair' : undefined}
        >
          <LogOut className={cn('flex-shrink-0', isCollapsed && !isMobile ? 'w-5 h-5' : 'w-[18px] h-[18px]')} />
          {(!isCollapsed || isMobile) && <span className="text-sm font-medium">Sair</span>}
        </button>
      </div>
    </div>
  );
}

export default function Sidebar(props: SidebarProps) {
  const { isMobileOpen, onMobileClose } = props;

  // Lock body scroll on mobile when sidebar is open
  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileOpen]);

  return (
    <>
      {/* Desktop sidebar */}
      <div className="hidden lg:block flex-shrink-0 h-screen sticky top-0">
        <SidebarContent {...props} isMobile={false} />
      </div>

      {/* Mobile drawer overlay */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onMobileClose}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 lg:hidden shadow-2xl"
            >
              <SidebarContent {...props} isMobile={true} isCollapsed={false} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
