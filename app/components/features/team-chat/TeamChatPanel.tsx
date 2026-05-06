'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, Users, Wifi, Clock, MessageCircle, Loader2, AlertTriangle } from 'lucide-react';
import { collection, query, where, getDocs, getDocsFromCache } from 'firebase/firestore';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { db } from '@/lib/config/firebase';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useTeamChat, useTeamChatMessages } from '@/lib/hooks/useTeamChat';
import { CachedImage } from '@/app/components/ui/CachedImage';
import { getInitials } from '@/lib/utils/format';
import type { User as UserType, TeamChat, TeamChatMessage } from '@/lib/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMemberDisplayStatus(member: UserType): 'online' | 'busy' | 'offline' {
  if (member.userStatus === 'invisible') return 'offline';
  if (!member.isOnline || !member.lastSeenAt) return 'offline';
  if (Date.now() - new Date(member.lastSeenAt).getTime() >= 3 * 60 * 1000) return 'offline';
  return member.userStatus === 'busy' ? 'busy' : 'online';
}

function isOnline(member: UserType): boolean {
  return getMemberDisplayStatus(member) !== 'offline';
}

type RelTime = (key: string, opts?: Record<string, unknown>) => string;

function relativeTime(dateStr: string | null | undefined, t: RelTime): string {
  if (!dateStr) return t('teamChat.never');
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000)         return t('teamChat.now');
  if (diff < 3_600_000)      return t('teamChat.minsAgo',  { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000)     return t('teamChat.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000) return t('teamChat.daysAgo',  { count: Math.floor(diff / 86_400_000) });
  return new Date(dateStr).toLocaleDateString();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Avatar ──────────────────────────────────────────────────────────────────

function Avatar({ name, photoURL, size = 32 }: { name: string; photoURL?: string | null; size?: number }) {
  const px = `${size}px`;
  return (
    <div
      className="rounded-full bg-gradient-to-br from-red-100 to-rose-100 dark:from-red-900/40 dark:to-rose-900/30 border border-red-200/60 dark:border-red-800/40 flex items-center justify-center font-bold text-red-700 dark:text-red-400 overflow-hidden flex-shrink-0"
      style={{ width: px, height: px, fontSize: size <= 28 ? 11 : 13 }}
    >
      {photoURL
        ? <CachedImage src={photoURL} alt={name} className="w-full h-full object-cover" />
        : getInitials(name)
      }
    </div>
  );
}

function GlobalAvatar({ size = 32 }: { size?: number }) {
  const px = `${size}px`;
  return (
    <div
      className="rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white flex-shrink-0 shadow-sm"
      style={{ width: px, height: px }}
    >
      <Users style={{ width: size * 0.5, height: size * 0.5 }} />
    </div>
  );
}

type View = { type: 'list' } | { type: 'chat'; chatId: string };

// `useTeamChat` retorna esse shape; reutilizamos pra passar como prop e evitar
// duplicar subscription.
type TeamChatBundle = ReturnType<typeof useTeamChat>;

// ─── Trigger + dropdown (substitui TeamPresencePanel original) ──────────────

export function TeamChatPanel() {
  const { t } = useTranslation();
  const { business } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const businessId = business?.id;

  // Membros do business. Cache-first pra paint instantâneo.
  const { data: members = [] } = useQuery({
    queryKey: ['team-presence', businessId],
    queryFn: async () => {
      const q = query(collection(db, 'users'), where('businessId', '==', businessId!));
      let snap;
      try {
        snap = await getDocsFromCache(q);
        if (snap.empty) snap = await getDocs(q);
      } catch {
        snap = await getDocs(q);
      }
      return snap.docs.map(d => ({ ...d.data(), id: d.id }) as UserType);
    },
    enabled: !!businessId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Single subscription — `teamChat` é compartilhado entre o badge e o dropdown.
  const teamChat = useTeamChat();
  const onlineCount = members.filter(isOnline).length;

  // Fecha no clique fora.
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        title={t('teamChat.buttonTitle')}
        className={cn(
          'relative flex items-center gap-1.5 h-9 px-2.5 rounded-xl',
          'text-gray-500 dark:text-gray-400 transition-all duration-150 active:scale-95',
          open
            ? 'bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-gray-200'
            : 'hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-700 dark:hover:text-gray-200',
        )}
      >
        <Users className="w-[17px] h-[17px]" />
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
        {/* Pulse de online */}
        {onlineCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400">
            <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
          </span>
        )}
        {/* Indicador de unread — sobrepõe o pulse com prioridade visual maior */}
        {teamChat.totalUnread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none"
            title={t('teamChat.unreadBadgeTitle', { count: teamChat.totalUnread })}
          >
            {teamChat.totalUnread > 99 ? '99+' : teamChat.totalUnread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && <TeamChatDropdown members={members} teamChat={teamChat} />}
      </AnimatePresence>
    </div>
  );
}

// ─── Dropdown (lista + view de chat) ────────────────────────────────────────

function TeamChatDropdown({ members, teamChat }: { members: UserType[]; teamChat: TeamChatBundle }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    chats,
    globalChat,
    error,
    ensureGlobalChat,
    ensureDM,
    markAsRead,
    sendMessage,
    hasUnread,
  } = teamChat;

  const [view, setView] = useState<View>({ type: 'list' });

  // Garante que o chat Geral exista — idempotente.
  useEffect(() => {
    void ensureGlobalChat().catch(err => console.warn('[TeamChat] ensureGlobalChat:', err));
  }, [ensureGlobalChat]);

  const onlineCount = members.filter(isOnline).length;

  const openChat = (chatId: string) => {
    setView({ type: 'chat', chatId });
    void markAsRead(chatId);
  };

  // Abre (criando se necessário) um DM com o membro clicado.
  const openDM = async (otherUid: string) => {
    if (!user || otherUid === user.uid) return;
    try {
      const chatId = await ensureDM(otherUid);
      setView({ type: 'chat', chatId });
      void markAsRead(chatId);
    } catch (err) {
      console.error('[TeamChat] openDM failed:', err);
    }
  };

  const goBack = () => setView({ type: 'list' });

  const renderHeader = () => {
    if (view.type === 'list') {
      return (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
          <div className="flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            <span className="text-[13px] font-semibold text-gray-700 dark:text-gray-200">{t('teamChat.panelTitle')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {onlineCount > 0 ? (
              <span className="flex items-center gap-1 text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {t('teamChat.onlineCount', { count: onlineCount })}
              </span>
            ) : (
              <span className="text-[11.5px] text-gray-400 dark:text-gray-500">{t('teamChat.noOneOnline')}</span>
            )}
          </div>
        </div>
      );
    }

    const chat = chats.find(c => c.id === view.chatId);
    if (!chat) {
      return (
        <ChatHeader
          title={t('teamChat.general')}
          subtitle=""
          onBack={goBack}
          left={<GlobalAvatar size={28} />}
          backLabel={t('teamChat.back')}
        />
      );
    }
    if (chat.type === 'global') {
      return (
        <ChatHeader
          title={t('teamChat.general')}
          subtitle={t('teamChat.membersAndOnline', {
            members: t('teamChat.membersCount', { count: members.length }),
            online: onlineCount,
          })}
          onBack={goBack}
          left={<GlobalAvatar size={28} />}
          backLabel={t('teamChat.back')}
        />
      );
    }
    // DM (Fase 2 — header já preparado pra quando habilitar)
    const otherUid = chat.memberIds.find(id => id !== user?.uid);
    const other = members.find(m => m.uid === otherUid);
    return (
      <ChatHeader
        title={other?.name ?? '—'}
        subtitle={other ? statusLabel(other, t) : ''}
        onBack={goBack}
        left={<Avatar name={other?.name ?? '?'} photoURL={other?.photoURL} size={28} />}
        backLabel={t('teamChat.back')}
      />
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.96 }}
      transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        'absolute right-0 top-full mt-2 z-50',
        'w-[380px] max-w-[calc(100vw_-_32px)]',
        'bg-white dark:bg-[#1e293b] rounded-2xl',
        'border border-gray-200/80 dark:border-gray-700/50',
        'shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]',
        'overflow-hidden flex flex-col',
      )}
      style={{ height: 'min(640px, calc(100vh - 100px))' }}
    >
      {renderHeader()}

      {/* Banner de erro — aparece quando subscriptions/ensure falham (típico:
          rules não publicadas). Some quando se recuperam. */}
      {error && view.type === 'list' && (
        <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200/60 dark:border-amber-500/20 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
            {t('teamChat.permissionError')}
          </p>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden relative">
        <AnimatePresence mode="wait" initial={false}>
          {view.type === 'list' ? (
            <motion.div
              key="list"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 flex flex-col"
            >
              <ListView
                chats={chats}
                globalChat={globalChat}
                members={members}
                userUid={user?.uid}
                totalUnread={teamChat.totalUnread}
                hasUnread={hasUnread}
                onSelect={openChat}
                onSelectMember={openDM}
              />
            </motion.div>
          ) : (
            <motion.div
              key={`chat-${view.chatId}`}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 flex flex-col"
            >
              <ChatView
                chatId={view.chatId}
                onSend={(text) => sendMessage(view.chatId, text)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── ChatHeader ──────────────────────────────────────────────────────────────

function ChatHeader({
  title, subtitle, onBack, left, backLabel,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  left: React.ReactNode;
  backLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-2.5 border-b border-gray-100 dark:border-gray-700/50">
      <button
        onClick={onBack}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
        title={backLabel}
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      {left}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-gray-900 dark:text-gray-100 truncate leading-tight">{title}</p>
        {subtitle && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate leading-tight">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// ─── ListView ────────────────────────────────────────────────────────────────

function ListView({
  chats,
  globalChat,
  members,
  userUid,
  totalUnread,
  hasUnread,
  onSelect,
  onSelectMember,
}: {
  chats: TeamChat[];
  globalChat: TeamChat | null;
  members: UserType[];
  userUid: string | undefined;
  totalUnread: number;
  hasUnread: (chatId: string) => boolean;
  onSelect: (chatId: string) => void;
  onSelectMember: (otherUid: string) => void;
}) {
  const { t } = useTranslation();

  // Geral fica sempre primeiro independente de lastMessageAt; pinned by design.
  const pinned = useMemo(() => (globalChat ? [globalChat] : []), [globalChat]);
  const others = useMemo(() => chats.filter(c => c.type !== 'global'), [chats]);

  const sortedMembers = useMemo(() => {
    const m = [...members];
    m.sort((a, b) => {
      const ao = isOnline(a) ? 1 : 0;
      const bo = isOnline(b) ? 1 : 0;
      if (ao !== bo) return bo - ao;
      return a.name.localeCompare(b.name);
    });
    return m;
  }, [members]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('teamChat.sectionConversations')}
          </span>
          {totalUnread > 0 && (
            <span className="text-[10px] font-bold text-red-500">
              {t('teamChat.newConversations', { count: totalUnread })}
            </span>
          )}
        </div>
        <div className="px-1.5 space-y-0.5">
          {pinned.map(c => (
            <ChatRow key={c.id} chat={c} members={members} userUid={userUid} unread={hasUnread(c.id)} onClick={() => onSelect(c.id)} />
          ))}
          {others.map(c => (
            <ChatRow key={c.id} chat={c} members={members} userUid={userUid} unread={hasUnread(c.id)} onClick={() => onSelect(c.id)} />
          ))}
        </div>

        <div className="px-3 pt-4 pb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t('teamChat.sectionMembers')}
          </span>
        </div>
        <div className="px-1.5 pb-2 space-y-0.5">
          {sortedMembers.map(member => (
            <MemberRow
              key={member.id}
              member={member}
              isSelf={member.uid === userUid}
              onSelect={onSelectMember}
            />
          ))}
        </div>
      </div>

      <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-white/[0.01]">
        <p className="text-[10.5px] text-gray-400 dark:text-gray-500 text-center">
          {t('teamChat.realTimeUpdate')}
        </p>
      </div>
    </div>
  );
}

// ─── Row de chat (lista) ─────────────────────────────────────────────────────

function ChatRow({
  chat, members, userUid, unread, onClick,
}: {
  chat: TeamChat;
  members: UserType[];
  userUid: string | undefined;
  unread: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const isGlobal = chat.type === 'global';
  const lastMsg = chat.lastMessage;

  // Resolve dados do "outro" para DMs. Pode ser undefined se o membro foi
  // removido do business — caímos no fallback "Usuário".
  const dmOther = !isGlobal
    ? members.find(m => m.uid === chat.memberIds.find(id => id !== userUid))
    : null;
  const dmDisplayName = dmOther?.name ?? t('teamChat.unknownUser');

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors text-left',
        'hover:bg-gray-50 dark:hover:bg-white/[0.04]',
      )}
    >
      {isGlobal
        ? <GlobalAvatar size={36} />
        : <Avatar name={dmDisplayName} photoURL={dmOther?.photoURL} size={36} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={cn(
            'text-[13px] truncate leading-tight',
            unread ? 'font-bold text-gray-900 dark:text-gray-100' : 'font-medium text-gray-800 dark:text-gray-100',
          )}>
            {isGlobal ? t('teamChat.general') : dmDisplayName}
          </p>
          {chat.lastMessageAt && (
            <span className="text-[10.5px] text-gray-400 dark:text-gray-500 flex-shrink-0">
              {formatTime(chat.lastMessageAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={cn(
            'text-[11.5px] truncate flex-1',
            unread ? 'text-gray-700 dark:text-gray-300 font-medium' : 'text-gray-500 dark:text-gray-400',
          )}>
            {lastMsg
              ? `${lastMsg.senderId === userUid ? t('teamChat.youPrefix') : ''}${lastMsg.text}`
              : t('teamChat.lastMessageEmpty')}
          </p>
          {unread && (
            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-red-500" />
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Row de membro (lista) ───────────────────────────────────────────────────

function MemberRow({
  member, isSelf, onSelect,
}: {
  member: UserType;
  isSelf: boolean;
  onSelect: (otherUid: string) => void;
}) {
  const { t } = useTranslation();
  const ms = getMemberDisplayStatus(member);
  const lastSeen = member.lastSeenAt || member.lastLoginAt;

  // Conteúdo é o mesmo pra self (div) e outros (button) — só o wrapper muda.
  const inner = (
    <>
      <div className="relative flex-shrink-0">
        <Avatar name={member.name} photoURL={member.photoURL} size={28} />
        <div className={cn(
          'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#1e293b]',
          ms === 'online' ? 'bg-emerald-400' : ms === 'busy' ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600',
        )} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-medium text-gray-800 dark:text-gray-100 truncate leading-tight">
          {member.name}
          {isSelf && <span className="text-gray-400 dark:text-gray-500 font-normal text-[11px]"> · {t('teamChat.you')}</span>}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          {ms === 'online' && (
            <>
              <Wifi className="w-2.5 h-2.5 text-emerald-500 flex-shrink-0" />
              <span className="text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">{t('teamChat.online')}</span>
            </>
          )}
          {ms === 'busy' && (
            <>
              <Clock className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />
              <span className="text-[10.5px] font-medium text-amber-600 dark:text-amber-400">{t('teamChat.busy')}</span>
            </>
          )}
          {ms === 'offline' && (
            <>
              <Clock className="w-2.5 h-2.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <span className="text-[10.5px] text-gray-400 dark:text-gray-500 truncate">{relativeTime(lastSeen, t)}</span>
            </>
          )}
        </div>
      </div>
    </>
  );

  if (isSelf) {
    return (
      <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl">
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(member.uid)}
      title={t('teamChat.startDM')}
      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
    >
      {inner}
    </button>
  );
}

function statusLabel(member: UserType, t: RelTime): string {
  const ms = getMemberDisplayStatus(member);
  if (ms === 'online') return t('teamChat.online');
  if (ms === 'busy') return t('teamChat.busy');
  return relativeTime(member.lastSeenAt || member.lastLoginAt, t);
}

// ─── ChatView ────────────────────────────────────────────────────────────────

function ChatView({
  chatId,
  onSend,
}: {
  chatId: string;
  onSend: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { messages, loading } = useTeamChatMessages(chatId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll quando novas mensagens chegam (e no mount).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Auto-resize do textarea: cresce até max-h, depois rola interno.
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  const handleSend = async () => {
    const v = text.trim();
    if (!v || sending) return;
    setSending(true);
    setText('');
    // Reseta altura do textarea após limpar.
    if (composerRef.current) composerRef.current.style.height = 'auto';
    try {
      await onSend(v);
    } catch (err) {
      console.error('[ChatView] send error:', err);
      setText(v); // restaura para o usuário tentar de novo
    } finally {
      setSending(false);
      composerRef.current?.focus();
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2" style={{ scrollbarWidth: 'thin' }}>
        {loading && messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-white/[0.04] flex items-center justify-center mb-3">
              <MessageCircle className="w-6 h-6 text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-[13px] font-medium text-gray-600 dark:text-gray-300">{t('teamChat.emptyTitle')}</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{t('teamChat.emptySubtitle')}</p>
          </div>
        ) : (
          groupByConsecutiveSender(messages).map((group, gi) => (
            <MessageGroup key={`${group[0].id}-${gi}`} group={group} myUid={user?.uid} />
          ))
        )}
      </div>

      <div className="border-t border-gray-100 dark:border-gray-700/50 px-2 py-2 bg-gray-50/40 dark:bg-white/[0.02]">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={composerRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKey}
            rows={1}
            placeholder={t('teamChat.messagePlaceholder')}
            className={cn(
              'flex-1 resize-none rounded-xl px-3 py-2 text-[13px] leading-relaxed',
              'bg-white dark:bg-[#0f172a] border border-gray-200 dark:border-gray-700/60',
              'text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500',
              'focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400',
              'max-h-32',
            )}
            style={{ minHeight: 38 }}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className={cn(
              'h-[38px] w-[38px] flex items-center justify-center rounded-xl flex-shrink-0',
              'bg-red-500 hover:bg-red-600 text-white transition-colors',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
            title={t('teamChat.sendButton')}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mensagens agrupadas por sender consecutivo ──────────────────────────────

function groupByConsecutiveSender(messages: TeamChatMessage[]): TeamChatMessage[][] {
  const out: TeamChatMessage[][] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last[0].senderId === m.senderId &&
        new Date(m.createdAt).getTime() - new Date(last[last.length - 1].createdAt).getTime() < 5 * 60_000) {
      last.push(m);
    } else {
      out.push([m]);
    }
  }
  return out;
}

function MessageGroup({ group, myUid }: { group: TeamChatMessage[]; myUid: string | undefined }) {
  const sender = group[0];
  const mine = sender.senderId === myUid;
  return (
    <div className={cn('flex gap-2', mine && 'flex-row-reverse')}>
      {!mine && <Avatar name={sender.senderName} photoURL={sender.senderPhotoURL} size={28} />}
      <div className={cn('flex flex-col gap-0.5 min-w-0 max-w-[78%]', mine && 'items-end')}>
        {!mine && (
          <span className="text-[10.5px] font-semibold text-gray-500 dark:text-gray-400 px-2">
            {sender.senderName}
          </span>
        )}
        {group.map((m, i) => (
          <div
            key={m.id}
            className={cn(
              'rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap',
              mine
                ? 'bg-red-500 text-white rounded-br-sm'
                : 'bg-gray-100 dark:bg-white/[0.06] text-gray-900 dark:text-gray-100 rounded-bl-sm',
              i === 0 && (mine ? 'rounded-tr-2xl' : 'rounded-tl-2xl'),
            )}
          >
            {m.text}
            <span className={cn(
              'ml-1.5 text-[9.5px] align-baseline',
              mine ? 'text-white/70' : 'text-gray-400 dark:text-gray-500',
            )}>
              {formatTime(m.createdAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
