'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getInitials } from '@/lib/utils/format';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import { collection, query, where, orderBy, limit, onSnapshot, updateDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { AppNotification } from '@/lib/types';
import {
  Search,
  Bell,
  BellOff,
  Menu,
  ChevronDown,
  LogOut,
  Settings,
  User as UserIcon,
  Sun,
  Moon,
  Check,
  Clock,
  Calendar,
  CheckSquare,
  MessageSquare,
  AlertTriangle,
  CheckCheck,
  Trash2,
  Volume2,
  VolumeX,
  MessageCircle,
  MessageCircleOff,
} from 'lucide-react';
import { useNotificationPrefs } from '@/lib/utils/notification-prefs';
import { getDesktopPermission, requestDesktopPermission } from '@/lib/utils/notification-alerts';
import type { UserStatus } from '@/lib/types';
import type { MenuPage } from './Sidebar';
import { CachedImage } from '@/app/components/ui/CachedImage';
import { TeamChatPanel } from '@/app/components/features/team-chat/TeamChatPanel';

interface TopBarProps {
  activePage?: MenuPage;
  onMobileMenuToggle: () => void;
  onNavigate?: (page: MenuPage) => void;
}

// ─── Status style (user's own status — picker no dropdown do avatar) ──

const STATUS_STYLE: Record<UserStatus, { dot: string; text: string; bg: string }> = {
  online:    { dot: 'bg-emerald-400', text: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  busy:      { dot: 'bg-amber-400',   text: 'text-amber-700 dark:text-amber-400',     bg: 'bg-amber-50 dark:bg-amber-500/10'     },
  invisible: { dot: 'bg-gray-400',    text: 'text-gray-500 dark:text-gray-400',       bg: 'bg-gray-100 dark:bg-gray-700/40'      },
  offline:   { dot: 'bg-gray-400',    text: 'text-gray-500 dark:text-gray-400',       bg: 'bg-gray-100 dark:bg-gray-700/40'      },
};

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

// ─── TopBar ───────────────────────────────────────────
export default function TopBar({ onMobileMenuToggle, onNavigate }: TopBarProps) {
  const { t } = useTranslation();
  const { user, business, signOut, updateUserProfile } = useAuth();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen]     = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  // ── Unread conversation count (real-time badge via onSnapshot) ──
  // ANTES: useQuery + getDocs com refetchInterval 30s. Comentário dizia
  // "real-time badge" mas era polling — atendente recebia mensagem nova
  // e o badge demorava até 30s pra atualizar.
  // AGORA: onSnapshot single-field (businessId) + filter client-side.
  // Tentei usar where('unreadCount', '>', 0) server-side mas Firestore
  // exige composite index (businessId, unreadCount) — gera link dinâmico
  // que exige user clicar. Volume típico < 1k conversations por tenant,
  // filter client-side é trivial em termos de CPU e remove fricção de
  // setup. Mesmo padrão usado em outros listeners do projeto.
  const businessId = business?.id;
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (!businessId) { setUnreadCount(0); return; }
    const q = query(
      collection(db, 'conversations'),
      where('businessId', '==', businessId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const total = snap.docs.reduce((sum, d) => {
          const data = d.data();
          const n = (data.unreadCount as number) || 0;
          return n > 0 ? sum + n : sum;
        }, 0);
        setUnreadCount(total);
      },
      (err) => console.error('[TopBar] unread count snapshot error:', err),
    );
    return () => unsub();
  }, [businessId]);

  // ── In-app notifications (real-time) ──
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // ── Alerts: sound + desktop notifications. Hook em `useNotificationAlerts`
  //    no layout consome essas prefs e dispara os alerts. Aqui é só o toggle UI.
  const [notifPrefs, setNotifPrefs] = useNotificationPrefs();
  const [desktopPerm, setDesktopPerm] = useState<NotificationPermission | 'unsupported'>('default');
  useEffect(() => {
    setDesktopPerm(getDesktopPermission());
  }, [isNotifOpen]); // re-checa quando abre dropdown (após user clicar em "permitir")

  const handleToggleSound = useCallback(() => {
    setNotifPrefs({ ...notifPrefs, soundEnabled: !notifPrefs.soundEnabled });
  }, [notifPrefs, setNotifPrefs]);

  const handleToggleConvoSound = useCallback(() => {
    setNotifPrefs({ ...notifPrefs, conversationsSoundEnabled: !notifPrefs.conversationsSoundEnabled });
  }, [notifPrefs, setNotifPrefs]);

  const handleToggleDesktop = useCallback(async () => {
    if (desktopPerm === 'unsupported') return;
    if (desktopPerm === 'denied') {
      // Browser bloqueou — usuário precisa habilitar manualmente nas settings.
      // Mostramos toast/alert leve. Sem janela de toast aqui; usar alert nativo.
      alert(t('topbar.notif.desktopDenied', 'Notificações bloqueadas. Habilite nas configurações do navegador.'));
      return;
    }
    if (desktopPerm === 'default') {
      const result = await requestDesktopPermission();
      setDesktopPerm(result);
      if (result === 'granted') {
        setNotifPrefs({ ...notifPrefs, desktopEnabled: true });
      }
      return;
    }
    // granted — só alterna a pref
    setNotifPrefs({ ...notifPrefs, desktopEnabled: !notifPrefs.desktopEnabled });
  }, [desktopPerm, notifPrefs, setNotifPrefs, t]);

  useEffect(() => {
    if (!user?.uid || !businessId) return;
    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      where('businessId', '==', businessId),
      orderBy('createdAt', 'desc'),
      limit(30),
    );
    const unsub = onSnapshot(q, snap => {
      setNotifications(snap.docs.map(d => ({ ...d.data(), id: d.id } as AppNotification)));
    });
    return () => unsub();
  }, [user?.uid, businessId]);

  const unreadNotifCount = notifications.filter(n => !n.isRead).length;
  const totalBadge = unreadCount + unreadNotifCount;

  const handleMarkRead = useCallback(async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { isRead: true });
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    const unread = notifications.filter(n => !n.isRead);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    for (const n of unread) batch.update(doc(db, 'notifications', n.id), { isRead: true });
    await batch.commit();
  }, [notifications]);

  const handleClearAll = useCallback(async () => {
    if (notifications.length === 0) return;
    const batch = writeBatch(db);
    for (const n of notifications) batch.delete(doc(db, 'notifications', n.id));
    await batch.commit();
  }, [notifications]);

  const handleDeleteNotif = useCallback(async (id: string) => {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'notifications', id));
    await batch.commit();
  }, []);

  // Close notif dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setIsNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const NOTIF_ICON: Record<string, React.ElementType> = {
    task_assigned: CheckSquare,
    task_due_soon: Clock,
    task_overdue: AlertTriangle,
    task_mentioned: MessageSquare,
    appointment_reminder: Calendar,
    review_received: Check,
    conversation_assigned: MessageSquare,
    chat_mentioned: MessageSquare,
  };

  const NOTIF_COLOR: Record<string, string> = {
    task_assigned: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10',
    task_due_soon: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10',
    task_overdue: 'text-red-500 bg-red-50 dark:bg-red-500/10',
    task_mentioned: 'text-purple-500 bg-purple-50 dark:bg-purple-500/10',
    appointment_reminder: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10',
    review_received: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10',
    conversation_assigned: 'text-red-500 bg-red-50 dark:bg-red-500/10',
    chat_mentioned: 'text-purple-500 bg-purple-50 dark:bg-purple-500/10',
  };

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('topbar.notif.justNow', 'agora');
    if (mins < 60) return `${mins}min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  }

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setIsUserMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <header className={cn(
      // TabBar é z-[40]; TopBar precisa ficar acima pra dropdowns (equipe,
      // notificações, user menu) não serem cobertos pelas tabs.
      'sticky top-0 z-50',
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

          {/* Search — opens Command Palette (Cmd+K) */}
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
            className={cn(
              'hidden md:flex items-center gap-2.5 h-9 px-3 rounded-xl min-w-[220px]',
              'bg-gray-50/80 dark:bg-white/[0.04] border border-gray-200/80 dark:border-gray-700/50',
              'text-gray-400 dark:text-gray-500',
              'hover:bg-white dark:hover:bg-white/[0.07] hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-600 dark:hover:text-gray-400',
              'transition-all duration-150 active:scale-[0.98]',
            )}
          >
            <Search className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-sm flex-1 text-left">{t('topbar.searchPlaceholder')}</span>
            <kbd className="flex items-center gap-0.5 text-[10px] font-medium text-gray-300 dark:text-gray-600 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* ── Right: Presence + Theme + Bell + User ── */}
        <div className="flex items-center gap-1.5 sm:gap-2">

          {/* Equipe + chat interno */}
          <TeamChatPanel />

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Notification bell + dropdown */}
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className={cn(
                'relative flex items-center justify-center w-9 h-9 rounded-xl',
                'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                'transition-all duration-150 active:scale-95',
                isNotifOpen && 'bg-gray-100 dark:bg-white/[0.06]'
              )}
              title={t('topbar.notifications', 'Notificações')}
            >
              <Bell className="w-[17px] h-[17px]" />
              {totalBadge > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
                  {totalBadge > 99 ? '99+' : totalBadge}
                </span>
              )}
            </button>

            <AnimatePresence>
              {isNotifOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.96 }}
                  transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
                  className={cn(
                    'absolute right-0 top-full mt-2 w-80 sm:w-96 z-50',
                    'bg-white dark:bg-[#1e293b] rounded-2xl',
                    'border border-gray-200/80 dark:border-gray-700/50',
                    'shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]',
                    'overflow-hidden'
                  )}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {t('topbar.notif.title', 'Notificações')}
                    </h3>
                    <div className="flex items-center gap-1">
                      {/* Toggle de som — notificações do sistema (atribuição,
                          mention, lembrete) */}
                      <button
                        onClick={handleToggleSound}
                        className={cn(
                          'px-2 py-1 rounded-lg transition-colors',
                          notifPrefs.soundEnabled
                            ? 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
                            : 'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                        )}
                        title={notifPrefs.soundEnabled
                          ? t('topbar.notif.soundOn', 'Som de notificações: ligado — clique pra desativar')
                          : t('topbar.notif.soundOff', 'Som de notificações: desligado — clique pra ativar')}
                      >
                        {notifPrefs.soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                      </button>
                      {/* Toggle de som — mensagens novas em Conversas */}
                      <button
                        onClick={handleToggleConvoSound}
                        className={cn(
                          'px-2 py-1 rounded-lg transition-colors',
                          notifPrefs.conversationsSoundEnabled
                            ? 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
                            : 'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                        )}
                        title={notifPrefs.conversationsSoundEnabled
                          ? t('topbar.notif.convoSoundOn', 'Som de conversas: ligado — clique pra desativar')
                          : t('topbar.notif.convoSoundOff', 'Som de conversas: desligado — clique pra ativar')}
                      >
                        {notifPrefs.conversationsSoundEnabled ? <MessageCircle className="w-4 h-4" /> : <MessageCircleOff className="w-4 h-4" />}
                      </button>
                      {/* Toggle de desktop notifications. Estado depende da permissão. */}
                      {desktopPerm !== 'unsupported' && (
                        <button
                          onClick={handleToggleDesktop}
                          className={cn(
                            'px-2 py-1 rounded-lg transition-colors',
                            desktopPerm === 'granted' && notifPrefs.desktopEnabled
                              ? 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
                              : 'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                          )}
                          title={
                            desktopPerm === 'denied'
                              ? t('topbar.notif.desktopBlocked', 'Bloqueado pelo navegador')
                              : desktopPerm === 'default'
                                ? t('topbar.notif.desktopAsk', 'Clique pra permitir notificações no desktop')
                                : notifPrefs.desktopEnabled
                                  ? t('topbar.notif.desktopOn', 'Notificações desktop ligadas')
                                  : t('topbar.notif.desktopOff', 'Notificações desktop desligadas')
                          }
                        >
                          {desktopPerm === 'granted' && notifPrefs.desktopEnabled
                            ? <Bell className="w-4 h-4" />
                            : <BellOff className="w-4 h-4" />}
                        </button>
                      )}
                      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700/60 mx-0.5" />
                      {unreadNotifCount > 0 && (
                        <button
                          onClick={handleMarkAllRead}
                          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                          title={t('topbar.notif.markAllRead', 'Marcar todas como lidas')}
                        >
                          <CheckCheck className="w-4 h-4" />
                        </button>
                      )}
                      {notifications.length > 0 && (
                        <button
                          onClick={handleClearAll}
                          className="text-xs text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                          title={t('topbar.notif.clearAll', 'Limpar todas')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Unread conversations shortcut */}
                  {unreadCount > 0 && (
                    <button
                      onClick={() => { onNavigate?.('Conversas'); setIsNotifOpen(false); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors border-b border-gray-100 dark:border-gray-700/50"
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-blue-500 bg-blue-50 dark:bg-blue-500/10 shrink-0">
                        <MessageSquare className="w-4 h-4" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {unreadCount} {unreadCount === 1 ? t('topbar.notif.unreadMsg', 'mensagem não lida') : t('topbar.notif.unreadMsgs', 'mensagens não lidas')}
                        </p>
                      </div>
                      <ChevronDown className="w-3.5 h-3.5 text-gray-400 -rotate-90" />
                    </button>
                  )}

                  {/* Notification list */}
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 && unreadCount === 0 ? (
                      <div className="py-10 text-center">
                        <Bell className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {t('topbar.notif.empty', 'Nenhuma notificação')}
                        </p>
                      </div>
                    ) : (
                      notifications.map(n => {
                        const Icon = NOTIF_ICON[n.type] || Bell;
                        const colorCls = NOTIF_COLOR[n.type] || 'text-gray-500 bg-gray-50 dark:bg-gray-500/10';
                        return (
                          <div
                            key={n.id}
                            onClick={() => {
                              if (!n.isRead) handleMarkRead(n.id);
                              if (n.link) { onNavigate?.(n.link as MenuPage); setIsNotifOpen(false); }
                            }}
                            className={cn(
                              'group relative w-full flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors',
                              'hover:bg-gray-50 dark:hover:bg-white/[0.04]',
                              !n.isRead && 'bg-blue-50/40 dark:bg-blue-500/[0.05]'
                            )}
                          >
                            <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5', colorCls)}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={cn('text-sm text-gray-900 dark:text-gray-100', !n.isRead && 'font-semibold')}>
                                {n.title}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                                {n.body}
                              </p>
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                {timeAgo(n.createdAt)}
                              </p>
                            </div>
                            {/* right: dot when idle, action buttons on hover */}
                            <div className="shrink-0 flex items-start pt-1.5">
                              {!n.isRead && (
                                <div className="w-2 h-2 rounded-full bg-blue-500 group-hover:hidden mt-0.5" />
                              )}
                              <div className="hidden group-hover:flex items-center gap-0.5">
                                {!n.isRead && (
                                  <button
                                    onClick={e => { e.stopPropagation(); handleMarkRead(n.id); }}
                                    title="Marcar como lida"
                                    className={cn(
                                      'w-6 h-6 flex items-center justify-center rounded-md transition-colors',
                                      'text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-500/20'
                                    )}
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={e => { e.stopPropagation(); handleDeleteNotif(n.id); }}
                                  title="Excluir notificação"
                                  className={cn(
                                    'w-6 h-6 flex items-center justify-center rounded-md transition-colors',
                                    'text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20'
                                  )}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

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
