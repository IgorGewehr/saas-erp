'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import { useAuth } from '@/app/components/providers/AuthProvider';
import {
  Search,
  Bell,
  Menu,
  ChevronDown,
  LogOut,
  Settings,
  User as UserIcon,
} from 'lucide-react';
import type { MenuPage } from './Sidebar';

const pageTitles: Record<MenuPage, string> = {
  Dashboard: 'Dashboard',
  Clientes: 'Clientes',
  Agenda: 'Agenda',
  PDV: 'Ponto de Venda',
  Financeiro: 'Financeiro',
  Estoque: 'Estoque',
  NFSe: 'Nota Fiscal de Serviço',
  NFCe: 'Nota Fiscal ao Consumidor',
  NFe: 'Nota Fiscal Eletrônica',
  Configurações: 'Configurações',
  Ajuda: 'Central de Ajuda',
};

const pageDescriptions: Record<MenuPage, string> = {
  Dashboard: 'Visão geral do seu negócio',
  Clientes: 'Gerencie seus clientes',
  Agenda: 'Seus agendamentos',
  PDV: 'Vendas e cobranças',
  Financeiro: 'Controle financeiro',
  Estoque: 'Gestão de produtos',
  NFSe: 'Emissão de notas de serviço',
  NFCe: 'Emissão de cupons fiscais',
  NFe: 'Emissão de notas fiscais',
  Configurações: 'Ajustes do sistema',
  Ajuda: 'Suporte e documentação',
};

interface TopBarProps {
  activePage: MenuPage;
  onMobileMenuToggle: () => void;
  onNavigate?: (page: MenuPage) => void;
}

export default function TopBar({ activePage, onMobileMenuToggle, onNavigate }: TopBarProps) {
  const { user, signOut } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const userMenuRef = useRef<HTMLDivElement>(null);

  const userName = user?.name || 'Usuário';

  // Close user menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-lg border-b border-gray-200/60">
      <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
        {/* Left section */}
        <div className="flex items-center gap-4">
          {/* Mobile menu button */}
          <button
            onClick={onMobileMenuToggle}
            className="lg:hidden p-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Page title */}
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-gray-900 font-display truncate">
              {pageTitles[activePage]}
            </h1>
            <p className="text-xs text-gray-500 hidden sm:block">
              {pageDescriptions[activePage]}
            </p>
          </div>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Search bar */}
          <div className="hidden md:flex items-center relative">
            <Search className="absolute left-3 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className={cn(
                'w-56 lg:w-64 pl-9 pr-4 py-2 rounded-xl',
                'bg-gray-50 border border-gray-200/80 text-sm text-gray-900',
                'placeholder:text-gray-400',
                'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-300 focus:bg-white',
                'transition-all duration-200'
              )}
            />
          </div>

          {/* Notification bell */}
          <button
            className={cn(
              'relative p-2.5 rounded-xl text-gray-500',
              'hover:text-gray-700 hover:bg-gray-100',
              'transition-colors duration-200'
            )}
          >
            <Bell className="w-[18px] h-[18px]" />
            {/* Notification dot */}
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
          </button>

          {/* User avatar dropdown */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className={cn(
                'flex items-center gap-2 p-1.5 pr-3 rounded-xl',
                'hover:bg-gray-100 transition-colors duration-200',
                isUserMenuOpen && 'bg-gray-100'
              )}
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-100 to-red-50 flex items-center justify-center text-red-600 text-xs font-semibold border border-red-200/50 flex-shrink-0">
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={userName}
                    className="w-full h-full rounded-lg object-cover"
                  />
                ) : (
                  getInitials(userName)
                )}
              </div>
              <span className="hidden sm:block text-sm font-medium text-gray-700 max-w-[100px] truncate">
                {userName.split(' ')[0]}
              </span>
              <ChevronDown
                className={cn(
                  'hidden sm:block w-3.5 h-3.5 text-gray-400 transition-transform duration-200',
                  isUserMenuOpen && 'rotate-180'
                )}
              />
            </button>

            {/* Dropdown menu */}
            <AnimatePresence>
              {isUserMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    'absolute right-0 mt-2 w-56 rounded-xl',
                    'bg-white border border-gray-200 shadow-xl shadow-gray-200/50',
                    'py-1.5 z-50'
                  )}
                >
                  <div className="px-4 py-2.5 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-900 truncate">{userName}</p>
                    <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                  </div>

                  <div className="py-1">
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onNavigate?.('Configurações');
                      }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <UserIcon className="w-4 h-4 text-gray-400" />
                      Meu Perfil
                    </button>
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onNavigate?.('Configurações');
                      }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Settings className="w-4 h-4 text-gray-400" />
                      Configurações
                    </button>
                  </div>

                  <div className="border-t border-gray-100 pt-1">
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        signOut();
                      }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Sair
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}
