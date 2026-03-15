'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useTheme, type ThemeMode } from '@/app/components/providers/ThemeProvider';
import {
  Search,
  Bell,
  Menu,
  ChevronDown,
  LogOut,
  Settings,
  User as UserIcon,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import type { MenuPage } from './Sidebar';

const pageMeta: Record<MenuPage, { title: string; description: string; emoji: string }> = {
  Dashboard:    { title: 'Dashboard',                 description: 'Visão geral do negócio',         emoji: '📊' },
  Clientes:     { title: 'Clientes',                  description: 'Gerencie sua carteira',           emoji: '👥' },
  CRM:          { title: 'CRM',                       description: 'Relacionamento e vendas',         emoji: '🎯' },
  Agenda:       { title: 'Agenda',                    description: 'Agendamentos e horários',         emoji: '📅' },
  PDV:          { title: 'Ponto de Venda',            description: 'Vendas e cobranças',              emoji: '🛒' },
  Kanban:       { title: 'Kanban',                     description: 'Quadros e tarefas da equipe',      emoji: '📋' },
  Financeiro:   { title: 'Financeiro',                description: 'Fluxo de caixa e receitas',       emoji: '💰' },
  Estoque:      { title: 'Estoque',                   description: 'Produtos e movimentações',        emoji: '📦' },
  NFSe:         { title: 'Nota Fiscal de Serviço',   description: 'Emissão de NFSe',                emoji: '📄' },
  NFCe:         { title: 'Cupom Fiscal',              description: 'Emissão de NFCe',                emoji: '🧾' },
  NFe:          { title: 'Nota Fiscal Eletrônica',   description: 'Emissão de NFe',                 emoji: '📋' },
  Configurações: { title: 'Configurações',            description: 'Ajustes do sistema',             emoji: '⚙️' },
  Ajuda:        { title: 'Central de Ajuda',         description: 'Suporte e documentação',          emoji: '💡' },
};

interface TopBarProps {
  activePage: MenuPage;
  onMobileMenuToggle: () => void;
  onNavigate?: (page: MenuPage) => void;
}

// ─── Theme Toggle ─────────────────────────────────────
function ThemeToggle() {
  const { mode, setMode, isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const modes: { value: ThemeMode; label: string; icon: React.ElementType }[] = [
    { value: 'light', label: 'Claro', icon: Sun },
    { value: 'dark', label: 'Escuro', icon: Moon },
    { value: 'system', label: 'Sistema', icon: Monitor },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'relative flex items-center justify-center w-9 h-9 rounded-xl',
          'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
          'hover:bg-gray-100 dark:hover:bg-white/[0.06]',
          'transition-all duration-150 active:scale-95',
          open && 'bg-gray-100 dark:bg-white/[0.06]'
        )}
        title="Alternar tema"
      >
        <AnimatePresence mode="wait" initial={false}>
          {isDark ? (
            <motion.div
              key="moon"
              initial={{ rotate: -90, scale: 0, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{ rotate: 90, scale: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Moon className="w-[17px] h-[17px]" />
            </motion.div>
          ) : (
            <motion.div
              key="sun"
              initial={{ rotate: 90, scale: 0, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{ rotate: -90, scale: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Sun className="w-[17px] h-[17px]" />
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'absolute right-0 top-full mt-2 w-40',
              'bg-white dark:bg-[#1e293b] rounded-xl',
              'border border-gray-200/80 dark:border-gray-700/50',
              'shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]',
              'overflow-hidden z-50 p-1'
            )}
          >
            {modes.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => { setMode(value); setOpen(false); }}
                className={cn(
                  'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-colors duration-150',
                  mode === value
                    ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── TopBar ───────────────────────────────────────────
export default function TopBar({ activePage, onMobileMenuToggle, onNavigate }: TopBarProps) {
  const { user, signOut } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const userName = user?.name || 'Usuário';
  const meta = pageMeta[activePage];

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <header className={cn(
      'sticky top-0 z-30',
      'bg-white/80 dark:bg-[#0a0e17]/80 backdrop-blur-xl',
      'border-b border-gray-200/50 dark:border-gray-800/50',
      'shadow-[0_1px_0_0_rgba(0,0,0,0.04)] dark:shadow-none',
    )}>
      <div className="flex items-center justify-between h-[60px] px-4 sm:px-6">

        {/* ── Left: Mobile toggle + Page title ── */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onMobileMenuToggle}
            className="lg:hidden flex items-center justify-center w-9 h-9 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all duration-150 active:scale-95"
          >
            <Menu className="w-[18px] h-[18px]" />
          </button>

          {/* Animated page title */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activePage}
              initial={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0,  filter: 'blur(0px)' }}
              exit={  { opacity: 0, y:  6,  filter: 'blur(4px)' }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="min-w-0"
            >
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100 font-display truncate tracking-tight">
                  {meta.title}
                </h1>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block truncate">
                {meta.description}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ── Right: Search + Theme + Bell + User ── */}
        <div className="flex items-center gap-1.5 sm:gap-2">

          {/* Search bar */}
          <motion.div
            animate={{ width: isFocused ? 240 : 192 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="hidden md:block relative"
          >
            <Search className={cn(
              'absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none transition-colors duration-200',
              isFocused ? 'text-red-400' : 'text-gray-400 dark:text-gray-500'
            )} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              className={cn(
                'w-full pl-8 pr-10 py-2 rounded-xl text-sm',
                'bg-gray-50/80 dark:bg-white/[0.04] border text-gray-900 dark:text-gray-100',
                'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                'transition-all duration-200 focus:outline-none',
                isFocused
                  ? 'border-red-200 dark:border-red-500/30 bg-white dark:bg-white/[0.06] shadow-[0_0_0_3px_rgba(220,38,38,0.08)] dark:shadow-[0_0_0_3px_rgba(239,68,68,0.12)] ring-0'
                  : 'border-gray-200/80 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-white/[0.06]'
              )}
            />
            <div className={cn(
              'absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5',
              'text-[10px] font-medium text-gray-300 dark:text-gray-600 transition-opacity duration-200',
              isFocused && 'opacity-0'
            )}>
              <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 font-mono text-[10px]">⌘K</kbd>
            </div>
          </motion.div>

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Notification bell */}
          <button className={cn(
            'relative flex items-center justify-center w-9 h-9 rounded-xl',
            'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
            'transition-all duration-150 active:scale-95'
          )}>
            <Bell className="w-[17px] h-[17px]" />
            <span className="absolute top-2 right-2 flex items-center justify-center">
              <span className="absolute w-2 h-2 rounded-full bg-red-400 animate-ping opacity-60" />
              <span className="relative w-1.5 h-1.5 rounded-full bg-red-500" />
            </span>
          </button>

          {/* User dropdown */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
              className={cn(
                'flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-xl',
                'hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all duration-150 active:scale-[0.98]',
                isUserMenuOpen && 'bg-gray-100 dark:bg-white/[0.06]'
              )}
            >
              <div className={cn(
                'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0',
                'bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 text-red-700 dark:text-red-400',
                'border border-red-200/60 dark:border-red-800/40 shadow-sm'
              )}>
                {user?.photoURL ? (
                  <img src={user.photoURL} alt={userName} className="w-full h-full rounded-lg object-cover" />
                ) : (
                  getInitials(userName)
                )}
              </div>
              <span className="hidden sm:block text-sm font-medium text-gray-700 dark:text-gray-300 max-w-[100px] truncate">
                {userName.split(' ')[0]}
              </span>
              <ChevronDown className={cn(
                'hidden sm:block w-3.5 h-3.5 text-gray-400 dark:text-gray-500 transition-transform duration-200',
                isUserMenuOpen && 'rotate-180'
              )} />
            </button>

            <AnimatePresence>
              {isUserMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.96 }}
                  transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                  className={cn(
                    'absolute right-0 top-full mt-2 w-56',
                    'bg-white dark:bg-[#1e293b] rounded-2xl',
                    'border border-gray-200/80 dark:border-gray-700/50',
                    'shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]',
                    'overflow-hidden z-50'
                  )}
                >
                  <div className="px-4 pt-3.5 pb-2.5 border-b border-gray-100 dark:border-gray-700/50">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{userName}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{user?.email}</p>
                  </div>

                  <div className="p-1.5 space-y-0.5">
                    {[
                      { icon: UserIcon, label: 'Meu Perfil', page: 'Configurações' as MenuPage },
                      { icon: Settings, label: 'Configurações', page: 'Configurações' as MenuPage },
                    ].map(({ icon: Icon, label, page }) => (
                      <button
                        key={label}
                        onClick={() => { setIsUserMenuOpen(false); onNavigate?.(page); }}
                        className="group flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:text-gray-900 dark:hover:text-gray-100 transition-colors duration-150"
                      >
                        <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" />
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="p-1.5 border-t border-gray-100 dark:border-gray-700/50">
                    <button
                      onClick={() => { setIsUserMenuOpen(false); signOut(); }}
                      className="group flex items-center gap-3 w-full px-3 py-2 rounded-xl text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/[0.08] transition-colors duration-150"
                    >
                      <LogOut className="w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-150" />
                      Sair da conta
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
