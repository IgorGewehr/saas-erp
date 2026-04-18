'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getInitials, formatCurrency } from '@/lib/utils/format';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import { collection, query, where, orderBy, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useQuery } from '@tanstack/react-query';
import type { User as UserType, Product, Appointment, CRMContact } from '@/lib/types';
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
  Users,
  Wifi,
  WifiOff,
  Clock,
  Check,
  Package,
  Calendar,
  Contact,
  DollarSign,
} from 'lucide-react';
import type { UserStatus } from '@/lib/types';
import type { MenuPage } from './Sidebar';
import { CachedImage } from '@/app/components/ui/CachedImage';

interface TopBarProps {
  activePage?: MenuPage;
  onMobileMenuToggle: () => void;
  onNavigate?: (page: MenuPage) => void;
}

// ─── Presence helpers ─────────────────────────────────

const STATUS_STYLE: Record<UserStatus, { dot: string; text: string; bg: string }> = {
  online:    { dot: 'bg-emerald-400', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  busy:      { dot: 'bg-amber-400',   text: 'text-amber-700 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-500/10'     },
  invisible: { dot: 'bg-gray-400',    text: 'text-gray-500 dark:text-gray-400',       bg: 'bg-gray-100 dark:bg-gray-700/40'      },
  offline:   { dot: 'bg-gray-400',    text: 'text-gray-500 dark:text-gray-400',       bg: 'bg-gray-100 dark:bg-gray-700/40'      },
};

// Returns the visible display status for a member (invisible = appears offline)
function getMemberDisplayStatus(member: UserType): 'online' | 'busy' | 'offline' {
  if (member.userStatus === 'invisible') return 'offline';
  if (!member.isOnline || !member.lastSeenAt) return 'offline';
  if (Date.now() - new Date(member.lastSeenAt).getTime() >= 3 * 60 * 1000) return 'offline';
  return member.userStatus === 'busy' ? 'busy' : 'online';
}

function isOnline(member: UserType): boolean {
  return getMemberDisplayStatus(member) !== 'offline';
}

function relativeTime(dateStr?: string | null, t?: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!dateStr) return t ? t('settings.users.never') : 'Nunca';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000)         return t ? t('settings.users.justNow') : 'Agora mesmo';
  if (diff < 3_600_000)      return t ? t('settings.users.minsAgo', { mins: Math.floor(diff / 60_000) }) : `${Math.floor(diff / 60_000)}min atrás`;
  if (diff < 86_400_000)     return t ? t('settings.users.hoursAgo', { hours: Math.floor(diff / 3_600_000) }) : `${Math.floor(diff / 3_600_000)}h atrás`;
  if (diff < 7 * 86_400_000) return t ? t('settings.users.daysAgo', { days: Math.floor(diff / 86_400_000) }) : `${Math.floor(diff / 86_400_000)}d atrás`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── Team Presence Panel ──────────────────────────────
function TeamPresencePanel() {
  const { t } = useTranslation();
  const { user, business } = useAuth();
  const [open, setOpen]       = useState(false);
  const [members, setMembers] = useState<UserType[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Live subscription — updates in real-time
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'users'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id }) as UserType);
      // Sort: online first, then by name
      data.sort((a, b) => {
        const ao = isOnline(a) ? 1 : 0;
        const bo = isOnline(b) ? 1 : 0;
        if (ao !== bo) return bo - ao;
        return a.name.localeCompare(b.name);
      });
      setMembers(data);
    });
    return () => unsub();
  }, [business?.id]);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const onlineCount = members.filter(isOnline).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        title={t('topbar.teamOnline')}
        className={cn(
          'relative flex items-center gap-1.5 h-9 px-2.5 rounded-xl',
          'text-gray-500 dark:text-gray-400 transition-all duration-150 active:scale-95',
          open
            ? 'bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-gray-200'
            : 'hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-700 dark:hover:text-gray-200'
        )}
      >
        <Users className="w-[17px] h-[17px]" />
        {/* Online count badge */}
        <AnimatePresence>
          {onlineCount > 0 && (
            <motion.span
              key={onlineCount}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold leading-none"
            >
              {onlineCount}
            </motion.span>
          )}
        </AnimatePresence>
        {/* Live pulse when anyone is online */}
        {onlineCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400">
            <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className={cn(
              'absolute right-0 top-full mt-2 w-72 z-50',
              'bg-white dark:bg-[#1e293b] rounded-2xl',
              'border border-gray-200/80 dark:border-gray-700/50',
              'shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]',
              'overflow-hidden'
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                <span className="text-[13px] font-semibold text-gray-700 dark:text-gray-200">{t('topbar.team')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {onlineCount > 0 ? (
                  <span className="flex items-center gap-1 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {onlineCount} {t('topbar.online')}
                  </span>
                ) : (
                  <span className="text-[11.5px] text-gray-400 dark:text-gray-500">{t('topbar.noOneOnline')}</span>
                )}
              </div>
            </div>

            {/* Members list */}
            <div className="max-h-[320px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {members.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-gray-400 dark:text-gray-500">
                  {t('topbar.loadingTeam')}
                </div>
              ) : (
                <div className="p-1.5 space-y-0.5">
                  {members.map((member) => {
                    const online    = isOnline(member);
                    const isSelf    = member.uid === user?.uid;
                    const lastSeen  = member.lastSeenAt || member.lastLoginAt;
                    return (
                      <div
                        key={member.id}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors"
                      >
                        {/* Avatar */}
                        <div className="relative flex-shrink-0">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 border border-red-200/60 dark:border-red-800/40 flex items-center justify-center text-[11px] font-bold text-red-700 dark:text-red-400">
                            {member.photoURL
                              ? <CachedImage src={member.photoURL} alt={member.name} className="w-full h-full rounded-full object-cover" />
                              : getInitials(member.name)
                            }
                          </div>
                          {/* Presence dot */}
                          {(() => {
                            const ms = getMemberDisplayStatus(member);
                            return (
                              <div className={cn(
                                'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#1e293b] transition-colors duration-300',
                                ms === 'online' ? 'bg-emerald-400' : ms === 'busy' ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600'
                              )}>
                                {ms === 'online' && <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />}
                                {ms === 'busy'   && <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-75" />}
                              </div>
                            );
                          })()}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-gray-800 dark:text-gray-100 truncate leading-tight">
                            {member.name}
                            {isSelf && <span className="text-gray-400 dark:text-gray-500 font-normal text-[11px]"> · {t('topbar.you')}</span>}
                          </p>
                          {(() => {
                            const ms = getMemberDisplayStatus(member);
                            return (
                              <div className="flex items-center gap-1 mt-0.5">
                                {ms === 'online' && (
                                  <>
                                    <Wifi className="w-2.5 h-2.5 text-emerald-500 flex-shrink-0" />
                                    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{t('topbar.onlineNow')}</span>
                                  </>
                                )}
                                {ms === 'busy' && (
                                  <>
                                    <Clock className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />
                                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">{t('topbar.busy')}</span>
                                  </>
                                )}
                                {ms === 'offline' && (
                                  <>
                                    <Clock className="w-2.5 h-2.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                                    <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                                      {relativeTime(lastSeen, t)}
                                    </span>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        {/* Status pill */}
                        {(() => {
                          const ms = getMemberDisplayStatus(member);
                          return (
                            <div className={cn(
                              'flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md',
                              ms === 'online' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                : ms === 'busy' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                : 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400'
                            )}>
                              {ms === 'online' ? t('topbar.statusOnline') : ms === 'busy' ? t('topbar.statusBusy') : t('topbar.statusOffline')}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer note */}
            <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-white/[0.01]">
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 text-center">
                {t('topbar.realTimeUpdate')}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Theme Toggle ─────────────────────────────────────
function ThemeToggle() {
  const { t } = useTranslation();
  const { isDark, setMode } = useTheme();

  const toggle = () => setMode(isDark ? 'light' : 'dark');

  return (
    <button
      onClick={toggle}
      className={cn(
        'relative flex items-center justify-center w-9 h-9 rounded-xl',
        'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
        'hover:bg-gray-100 dark:hover:bg-white/[0.06]',
        'transition-all duration-150 active:scale-95',
      )}
      title={isDark ? t('topbar.lightMode') : t('topbar.darkMode')}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="moon"
            initial={{ rotate: -90, scale: 0, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <Moon className="w-[17px] h-[17px]" />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            initial={{ rotate: 90, scale: 0, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: -90, scale: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <Sun className="w-[17px] h-[17px]" />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

// ─── Search Result Types ──────────────────────────────
interface SearchResult {
  id: string;
  type: 'client' | 'product' | 'appointment' | 'contact';
  title: string;
  subtitle: string;
  page: MenuPage;
  icon: React.ElementType;
}

// ─── TopBar ───────────────────────────────────────────
export default function TopBar({ onMobileMenuToggle, onNavigate }: TopBarProps) {
  const { t } = useTranslation();
  const { user, business, signOut, updateUserProfile } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen]     = useState(false);
  const [isFocused, setIsFocused]           = useState(false);
  const [searchValue, setSearchValue]       = useState('');
  const [showResults, setShowResults]       = useState(false);
  const userMenuRef  = useRef<HTMLDivElement>(null);
  const searchRef    = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  const currentStatus = (user?.userStatus || 'online') as UserStatus;
  const statusCfg = STATUS_STYLE[currentStatus];

  const STATUS_CFG = useMemo(() => ({
    online:    { label: t('topbar.statusOnline'),    ...STATUS_STYLE.online    },
    busy:      { label: t('topbar.statusBusy'),      ...STATUS_STYLE.busy      },
    invisible: { label: t('topbar.statusInvisible'), ...STATUS_STYLE.invisible },
    offline:   { label: t('topbar.statusOffline'),   ...STATUS_STYLE.offline   },
  }), [t]);

  const handleSetStatus = async (status: UserStatus) => {
    setIsStatusOpen(false);
    await updateUserProfile({ userStatus: status });
  };

  const userName = user?.name || 'Usuário';

  // ── Unread conversation count (real-time badge) ──
  const businessId = business?.id;

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['unread-conversations', businessId],
    queryFn: async () => {
      const q = query(
        collection(db, 'conversations'),
        where('businessId', '==', businessId),
        where('unreadCount', '>', 0),
      );
      const snap = await getDocs(q);
      return snap.docs.reduce((sum, d) => sum + ((d.data().unreadCount as number) || 0), 0);
    },
    enabled: !!businessId,
    refetchInterval: 30000, // Refresh every 30s
  });

  // ── Global Search Data ──

  const { data: searchProducts = [] } = useQuery({
    queryKey: ['search-products', businessId],
    queryFn: async () => {
      const q = query(collection(db, 'products'), where('businessId', '==', businessId), orderBy('name', 'asc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Product));
    },
    enabled: !!businessId,
    staleTime: 2 * 60 * 1000,
  });

  const { data: searchAppointments = [] } = useQuery({
    queryKey: ['search-appointments', businessId],
    queryFn: async () => {
      const q = query(collection(db, 'appointments'), where('businessId', '==', businessId), orderBy('date', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Appointment));
    },
    enabled: !!businessId,
    staleTime: 2 * 60 * 1000,
  });

  const { data: searchContacts = [] } = useQuery({
    queryKey: ['search-clients', businessId],
    queryFn: async () => {
      const q = query(collection(db, 'clients'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as CRMContact));
    },
    enabled: !!businessId,
    staleTime: 2 * 60 * 1000,
  });

  const searchResults = useMemo<SearchResult[]>(() => {
    const term = searchValue.trim().toLowerCase();
    if (term.length < 2) return [];
    const results: SearchResult[] = [];
    const limit = 12;

    for (const p of searchProducts) {
      if (results.length >= limit) break;
      const match = p.name?.toLowerCase().includes(term)
        || p.sku?.toLowerCase().includes(term)
        || p.barcode?.includes(term)
        || p.category?.toLowerCase().includes(term);
      if (match) {
        results.push({ id: p.id, type: 'product', title: p.name, subtitle: formatCurrency(p.salePrice), page: 'Estoque', icon: Package });
      }
    }

    for (const a of searchAppointments) {
      if (results.length >= limit) break;
      const match = a.clientName?.toLowerCase().includes(term)
        || a.serviceName?.toLowerCase().includes(term);
      if (match) {
        results.push({ id: a.id, type: 'appointment', title: `${a.clientName} — ${a.serviceName}`, subtitle: `${a.date} ${a.startTime}`, page: 'Agenda', icon: Calendar });
      }
    }

    for (const ct of searchContacts) {
      if (results.length >= limit) break;
      const match = ct.name?.toLowerCase().includes(term)
        || ct.cpfCnpj?.includes(term)
        || ct.email?.toLowerCase().includes(term)
        || ct.phone?.includes(term)
        || ct.company?.toLowerCase().includes(term);
      if (match) {
        results.push({ id: ct.id, type: 'contact', title: ct.name, subtitle: ct.company || ct.cpfCnpj || ct.email || '', page: 'Clientes', icon: Contact });
      }
    }

    return results;
  }, [searchValue, searchProducts, searchAppointments, searchContacts]);

  const handleSelectResult = useCallback((result: SearchResult) => {
    setSearchValue('');
    setShowResults(false);
    searchRef.current?.blur();
    onNavigate?.(result.page);
  }, [onNavigate]);

  // Close results on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setShowResults(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setIsUserMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); setShowResults(true); }
      if (e.key === 'Escape') { setShowResults(false); searchRef.current?.blur(); }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  return (
    <header className={cn(
      'sticky top-0 z-30',
      'bg-white/80 dark:bg-[#0a0e17]/80 backdrop-blur-xl',
      'border-b border-gray-200/50 dark:border-gray-800/50',
      'shadow-[0_1px_0_0_rgba(0,0,0,0.04)] dark:shadow-none',
    )}>
      <div className="flex items-center justify-between h-[60px] px-4 sm:px-6">

        {/* ── Left: Mobile toggle + Search ── */}
        <div className="flex items-center gap-3">
          <button
            onClick={onMobileMenuToggle}
            className="lg:hidden flex items-center justify-center w-9 h-9 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all duration-150 active:scale-95 flex-shrink-0"
          >
            <Menu className="w-[18px] h-[18px]" />
          </button>

          {/* Search — global with results dropdown */}
          <div ref={searchBoxRef} className="hidden md:block relative">
            <motion.div
              animate={{ width: isFocused ? 360 : 240 }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              className="relative"
            >
              <Search className={cn(
                'absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none transition-colors duration-200',
                isFocused ? 'text-red-400' : 'text-gray-400 dark:text-gray-500'
              )} />
              <input
                ref={searchRef}
                type="text"
                placeholder={t('topbar.searchPlaceholder')}
                value={searchValue}
                onChange={(e) => { setSearchValue(e.target.value); setShowResults(true); }}
                onFocus={() => { setIsFocused(true); setShowResults(true); }}
                onBlur={() => setIsFocused(false)}
                className={cn(
                  'w-full pl-8 pr-10 py-2 rounded-xl text-sm',
                  'bg-gray-50/80 dark:bg-white/[0.04] border text-gray-900 dark:text-gray-100',
                  'placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  'transition-all duration-200 focus:outline-none',
                  isFocused
                    ? 'border-red-200 dark:border-red-500/30 bg-white dark:bg-white/[0.06] shadow-[0_0_0_3px_rgba(220,38,38,0.08)]'
                    : 'border-gray-200/80 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600'
                )}
              />
              <div className={cn(
                'absolute right-2.5 top-1/2 -translate-y-1/2',
                'text-[10px] font-medium transition-opacity duration-200',
                (isFocused || searchValue) && 'opacity-0'
              )}>
                <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 font-mono text-[10px]">⌘K</kbd>
              </div>
            </motion.div>

            {/* Search Results Dropdown */}
            <AnimatePresence>
              {showResults && searchValue.trim().length >= 2 && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    'absolute left-0 top-full mt-2 w-[400px] z-50',
                    'bg-white dark:bg-[#1e293b] rounded-2xl',
                    'border border-gray-200/80 dark:border-gray-700/50',
                    'shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]',
                    'overflow-hidden'
                  )}
                >
                  {searchResults.length === 0 ? (
                    <div className="py-8 px-4 text-center">
                      <Search className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                      <p className="text-sm text-gray-400 dark:text-gray-500">
                        {t('topbar.noResults')} &quot;{searchValue}&quot;
                      </p>
                      <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
                        {t('topbar.searchHint')}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700/50">
                        <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                          {t('topbar.results', { count: searchResults.length })}
                        </span>
                      </div>
                      <div className="max-h-[340px] overflow-y-auto p-1.5" style={{ scrollbarWidth: 'thin' }}>
                        {searchResults.map((result, idx) => {
                          const Icon = result.icon;
                          const typeColors = {
                            client: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400',
                            product: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                            appointment: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
                            contact: 'bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400',
                          };
                          const typeLabels = { client: t('topbar.typeClient'), product: t('topbar.typeProduct'), appointment: t('topbar.typeAppointment'), contact: t('topbar.typeContact') };
                          return (
                            <button
                              key={`${result.type}-${result.id}`}
                              onMouseDown={(e) => { e.preventDefault(); handleSelectResult(result); }}
                              className="flex items-center gap-3 w-full px-2.5 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors text-left"
                            >
                              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', typeColors[result.type])}>
                                <Icon className="w-4 h-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-medium text-gray-800 dark:text-gray-100 truncate">{result.title}</p>
                                <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{result.subtitle}</p>
                              </div>
                              <span className="text-[10px] font-medium text-gray-300 dark:text-gray-600 flex-shrink-0">
                                {typeLabels[result.type]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-white/[0.01]">
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center">
                          {t('topbar.pressEnter')}
                        </p>
                      </div>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Right: Presence + Theme + Bell + User ── */}
        <div className="flex items-center gap-1.5 sm:gap-2">

          {/* Team presence */}
          <TeamPresencePanel />

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Notification bell */}
          <button
            onClick={() => onNavigate?.('Conversas')}
            className={cn(
              'relative flex items-center justify-center w-9 h-9 rounded-xl',
              'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
              'transition-all duration-150 active:scale-95'
            )}
            title={unreadCount > 0 ? t('topbar.unreadMessages', { count: unreadCount }) : t('topbar.notifications')}
          >
            <Bell className="w-[17px] h-[17px]" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
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
              <div className="relative flex-shrink-0">
                <div className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold',
                  'bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 text-red-700 dark:text-red-400',
                  'border border-red-200/60 dark:border-red-800/40 shadow-sm'
                )}>
                  {user?.photoURL
                    ? <CachedImage src={user.photoURL} alt={userName} className="w-full h-full rounded-lg object-cover" />
                    : getInitials(userName)
                  }
                </div>
                {/* Status dot */}
                <div className={cn(
                  'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#0a0e17]',
                  statusCfg.dot
                )} />
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
                    'absolute right-0 top-full mt-2 w-56 z-50',
                    'bg-white dark:bg-[#1e293b] rounded-2xl',
                    'border border-gray-200/80 dark:border-gray-700/50',
                    'shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]',
                    'overflow-hidden'
                  )}
                >
                  <div className="px-4 pt-3.5 pb-2.5 border-b border-gray-100 dark:border-gray-700/50">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-shrink-0">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 text-red-700 dark:text-red-400 border border-red-200/60 dark:border-red-800/40">
                          {user?.photoURL
                            ? <CachedImage src={user.photoURL} alt={userName} className="w-full h-full rounded-lg object-cover" />
                            : getInitials(userName)
                          }
                        </div>
                        <div className={cn('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#1e293b]', statusCfg.dot)} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate">{userName}</p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{user?.email}</p>
                      </div>
                    </div>

                    {/* Status picker */}
                    <div className="mt-2 relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setIsStatusOpen(!isStatusOpen); }}
                        className={cn(
                          'flex items-center gap-1.5 w-full px-2 py-1.5 rounded-lg transition-colors duration-150',
                          statusCfg.bg, 'hover:opacity-80'
                        )}
                      >
                        <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusCfg.dot)} />
                        <span className={cn('text-[11px] font-medium flex-1 text-left', statusCfg.text)}>{STATUS_CFG[currentStatus].label}</span>
                        <ChevronDown className={cn('w-3 h-3 transition-transform duration-200', statusCfg.text, isStatusOpen && 'rotate-180')} />
                      </button>
                      <AnimatePresence>
                        {isStatusOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: 4, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 4, scale: 0.97 }}
                            transition={{ duration: 0.12 }}
                            className="mt-1 p-0.5 rounded-xl bg-white dark:bg-[#1e293b] border border-gray-200 dark:border-gray-700/50 shadow-lg dark:shadow-black/30 z-10"
                          >
                            {(Object.entries(STATUS_CFG) as [UserStatus, typeof STATUS_CFG[UserStatus]][]).map(([status, cfg]) => (
                              <button
                                key={status}
                                onClick={(e) => { e.stopPropagation(); handleSetStatus(status); }}
                                className={cn(
                                  'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-[12px] transition-colors duration-150',
                                  currentStatus === status
                                    ? `${cfg.bg} ${cfg.text} font-semibold`
                                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                                )}
                              >
                                <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', cfg.dot)} />
                                <span className="flex-1 text-left">{cfg.label}</span>
                                {currentStatus === status && <Check className="w-3 h-3" />}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  <div className="p-1.5 space-y-0.5">
                    {[
                      { icon: UserIcon, label: t('topbar.myProfile'),  page: 'Configurações' as MenuPage },
                      { icon: Settings, label: t('topbar.settings'),   page: 'Configurações' as MenuPage },
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
                      {t('topbar.signOut')}
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
