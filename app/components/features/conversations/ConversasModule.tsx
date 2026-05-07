'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useImperativeHandle, forwardRef, memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { setActiveConversation } from '@/lib/utils/active-conversation';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { getInitials } from '@/lib/utils/format';
import {
  collection,
  query,
  where,
  and,
  or,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  limit,
  startAfter,
  writeBatch,
  arrayUnion,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { db, storage } from '@/lib/config/firebase';
import { notifyUsers } from '@/lib/services/notifications';
import debounce from 'lodash.debounce';
import {
  MessageSquare,
  Search,
  Send,
  Phone,
  MoreVertical,
  Trash2,
  User as UserIcon,
  Building2,
  Smartphone,
  Check,
  CheckCheck,
  Smile,
  Paperclip,
  X,
  ArrowLeft,
  Settings,
  Instagram,
  Facebook,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  UserPlus,
  FileText,
  Headphones,
  Video,
  RotateCcw,
  BadgeCheck,
  Lock,
  Clock,
  StickyNote,
  Hash,
  Tag,
  Layers,
  ArrowRightLeft,
  Flag,
  Slash,
  ChevronUp,
  Loader2,
  Save,
  ClipboardCheck,
  Sparkles,
  SparklesIcon,
  Activity,
  Bot,
  BotOff,
  BarChart3,
  TrendingUp,
  Timer,
  ThumbsUp,
  MessageSquareOff,
  SlidersHorizontal,
  Bookmark,
  BookmarkCheck,
  History,
  CheckSquare,
  Square,
  UserCheck,
  CheckCircle,
  TagIcon,
  MailOpen,
  Pencil,
  Inbox,
  UserX,
  CornerDownLeft,
  ArrowDownUp,
  Moon,
  BellOff,
  Mail,
} from 'lucide-react';
import { getDocs } from 'firebase/firestore';
import type {
  Conversation,
  ConversationMessage,
  ConversationChannel,
  ConversationStatus,
  ConversationView,
  CSATResponse,
  RoutingRule,
  Sector,
  Snippet,
  User,
  AgentRun,
  Client,
  BusinessSettings,
} from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';
import { CachedImage } from '@/app/components/ui/CachedImage';

// ─── Timestamp helpers ───────────────────────────────────────────────────────

function relativeTime(isoStr: string, t?: (key: string, fallback: string) => string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60_000) return t ? t('conversations.timeNow', 'agora') : 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`;
  const now = new Date();
  const date = new Date(isoStr);
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (isToday) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return t ? t('conversations.timeYesterday', 'Ontem') : 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function fullTime(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dateSeparatorLabel(isoStr: string, t?: (key: string, fallback: string) => string): string {
  const now = new Date();
  const date = new Date(isoStr);
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (isToday) return t ? t('conversations.timeToday', 'Hoje') : 'Hoje';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return t ? t('conversations.timeYesterday', 'Ontem') : 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const dateB = new Date(b);
  return (
    da.getDate() === dateB.getDate() &&
    da.getMonth() === dateB.getMonth() &&
    da.getFullYear() === dateB.getFullYear()
  );
}

// ─── SLA helpers ─────────────────────────────────────────────────────────────

type ConvSLAConfig = NonNullable<BusinessSettings['conversationSLA']>;

const SLA_DEFAULT_CONFIG: ConvSLAConfig = { enabled: false, urgentMinutes: 30, highMinutes: 60, mediumMinutes: 240, lowMinutes: 480, warningPercent: 20 };

function getSLAMinutes(priority: string | undefined, cfg: ConvSLAConfig): number {
  if (priority === 'urgent') return cfg.urgentMinutes;
  if (priority === 'high') return cfg.highMinutes;
  if (priority === 'low') return cfg.lowMinutes;
  return cfg.mediumMinutes;
}

interface SLAInfo {
  status: 'ok' | 'warning' | 'breached' | 'responded';
  remainingMs: number;
  totalMs: number;
}

function getSLAInfo(conv: Pick<Conversation, 'createdAt' | 'status' | 'priority' | 'firstResponseAt'>, cfg?: ConvSLAConfig): SLAInfo | null {
  if (!cfg?.enabled || conv.status === 'resolved') return null;
  const minutes = getSLAMinutes(conv.priority, cfg);
  const totalMs = minutes * 60_000;
  const deadlineMs = new Date(conv.createdAt).getTime() + totalMs;
  if (conv.firstResponseAt) return { status: 'responded', remainingMs: 0, totalMs };
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) return { status: 'breached', remainingMs: 0, totalMs };
  const pct = remainingMs / totalMs;
  return { status: pct <= cfg.warningPercent / 100 ? 'warning' : 'ok', remainingMs, totalMs };
}

function formatSLARemaining(ms: number): string {
  if (ms <= 0) return 'Vencido';
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h${m}min` : `${h}h`;
}

// ─── SLA Settings Dialog ──────────────────────────────────────────────────────

function SLASettingsDialog({ current, businessId, onClose, onSaved }: {
  current?: ConvSLAConfig;
  businessId: string;
  onClose: () => void;
  onSaved: (cfg: ConvSLAConfig) => void;
}) {
  const cfg = current ?? SLA_DEFAULT_CONFIG;
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [urgent, setUrgent] = useState(cfg.urgentMinutes);
  const [high, setHigh] = useState(cfg.highMinutes);
  const [medium, setMedium] = useState(cfg.mediumMinutes);
  const [low, setLow] = useState(cfg.lowMinutes);
  const [warn, setWarn] = useState(cfg.warningPercent);
  const [saving, setSaving] = useState(false);

  const rows: { label: string; color: string; val: number; set: (v: number) => void }[] = [
    { label: 'Urgente', color: 'text-red-600 dark:text-red-400', val: urgent, set: setUrgent },
    { label: 'Alta', color: 'text-orange-600 dark:text-orange-400', val: high, set: setHigh },
    { label: 'Média', color: 'text-amber-600 dark:text-amber-400', val: medium, set: setMedium },
    { label: 'Baixa', color: 'text-blue-600 dark:text-blue-400', val: low, set: setLow },
  ];

  const handleSave = async () => {
    setSaving(true);
    const next: ConvSLAConfig = { enabled, urgentMinutes: urgent, highMinutes: high, mediumMinutes: medium, lowMinutes: low, warningPercent: warn };
    try {
      await updateDoc(doc(db, 'businesses', businessId), { 'settings.conversationSLA': next, updatedAt: new Date().toISOString() });
      onSaved(next);
      onClose();
    } catch (err) {
      console.error('[SLA] Save error:', err);
      toast.error('Erro ao salvar configurações de SLA');
    } finally { setSaving(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 8 }}
        className="w-full max-w-sm bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
              <Clock className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <h2 className="font-semibold text-sm text-gray-900 dark:text-white">Configurar SLA</h2>
              <p className="text-[10px] text-gray-400">Tempo máximo de primeira resposta</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Enable toggle */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Ativar SLA</span>
            <button onClick={() => setEnabled(v => !v)}
              className={cn('relative w-10 h-5.5 rounded-full transition-colors', enabled ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600')} style={{ height: 22 }}>
              <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', enabled ? 'translate-x-5' : 'translate-x-0.5')} />
            </button>
          </label>

          {/* Per-priority minutes */}
          <div className={cn('space-y-2.5 transition-opacity', !enabled && 'opacity-40 pointer-events-none')}>
            {rows.map(row => (
              <div key={row.label} className="flex items-center gap-3">
                <span className={cn('text-xs font-semibold w-14 flex-shrink-0', row.color)}>{row.label}</span>
                <input type="number" min={1} max={1440} value={row.val} onChange={e => row.set(Math.max(1, Number(e.target.value)))}
                  className="w-20 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none text-center" />
                <span className="text-xs text-gray-400">min</span>
                <span className="text-[10px] text-gray-400 ml-auto">
                  {row.val < 60 ? `${row.val}min` : `${Math.floor(row.val / 60)}h${row.val % 60 > 0 ? `${row.val % 60}min` : ''}`}
                </span>
              </div>
            ))}
            <div className="flex items-center gap-3 pt-1 border-t border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-500 w-14 flex-shrink-0">Alertar em</span>
              <input type="number" min={5} max={50} value={warn} onChange={e => setWarn(Math.max(5, Math.min(50, Number(e.target.value))))}
                className="w-20 text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none text-center" />
              <span className="text-xs text-gray-400">% restante</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Channel config helpers ───────────────────────────────────────────────────

interface ChannelConfig {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  dotColor: string;
  avatarBg: string;
}

// Default config per canonical channel — WhatsApp oficial (Cloud API / Embedded Signup)
const CHANNEL_CONFIG: Record<ConversationChannel, ChannelConfig> = {
  whatsapp: {
    label: 'WhatsApp Business',
    color: '#25D366',
    bgColor: 'bg-[#25D366]/10',
    borderColor: 'border-[#25D366]/30',
    textColor: 'text-[#25D366]',
    dotColor: 'bg-[#25D366]',
    avatarBg: 'bg-[#25D366]/20',
  },
  facebook: {
    label: 'Messenger',
    color: '#0866FF',
    bgColor: 'bg-[#0866FF]/10',
    borderColor: 'border-[#0866FF]/30',
    textColor: 'text-[#0866FF]',
    dotColor: 'bg-[#0866FF]',
    avatarBg: 'bg-[#0866FF]/20',
  },
  instagram: {
    label: 'Instagram',
    color: '#E1306C',
    bgColor: 'bg-[#E1306C]/10',
    borderColor: 'border-[#E1306C]/30',
    textColor: 'text-[#E1306C]',
    dotColor: 'bg-[#E1306C]',
    avatarBg: 'bg-[#E1306C]/20',
  },
};

/**
 * Variação do WhatsApp quando a conexão é via celular do dono (Baileys).
 * Tem verde mais escuro + label distinto — para o operador entender que essa
 * conversa tem limitações (status de entrega parcial, templates não aplicam, etc.)
 */
const WHATSAPP_WEB_CONFIG: ChannelConfig = {
  label: 'WhatsApp Web',
  color: '#128C7E',
  bgColor: 'bg-[#128C7E]/10',
  borderColor: 'border-[#128C7E]/30',
  textColor: 'text-[#128C7E]',
  dotColor: 'bg-[#128C7E]',
  avatarBg: 'bg-[#128C7E]/20',
};

/**
 * Resolve a configuração visual de uma conversa considerando a variante do WhatsApp.
 * Usar este helper em qualquer lugar que acesse `CHANNEL_CONFIG[conv.channel]`.
 */
function getConvConfig(conv: Pick<Conversation, 'channel' | 'connectedVia'>): ChannelConfig {
  if (conv.channel === 'whatsapp' && conv.connectedVia === 'baileys') {
    return WHATSAPP_WEB_CONFIG;
  }
  return CHANNEL_CONFIG[conv.channel];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function ChannelIcon({
  channel,
  size = 'sm',
}: {
  channel: ConversationChannel;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  if (channel === 'whatsapp')
    return <WhatsAppIcon className={cn(dim, 'text-[#25D366]')} />;
  if (channel === 'facebook')
    return <Facebook className={cn(dim, 'text-[#0866FF]')} />;
  return <Instagram className={cn(dim, 'text-[#E1306C]')} />;
}

function StatusDot({ status }: { status: ConversationStatus }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full flex-shrink-0',
        // Aberta: sky (azul claro) — antes era emerald, mas conflitava com a
        // identidade verde do WhatsApp (canal verde + bubble verde + dot verde
        // visualmente competindo). Sky destaca o status sem briga de cor.
        status === 'open' && 'bg-sky-500 dark:bg-sky-400',
        status === 'waiting' && 'bg-amber-400',
        // Resolvida: cinza azulado (slate) com brilho compatível em dark mode
        status === 'resolved' && 'bg-slate-400 dark:bg-slate-300',
      )}
    />
  );
}

function MessageStatusIcon({
  status,
}: {
  status: ConversationMessage['status'];
}) {
  if (status === 'sending')
    return <Check className="w-3.5 h-3.5 text-white/50" />;
  if (status === 'sent')
    return <Check className="w-3.5 h-3.5 text-white/70" />;
  if (status === 'delivered')
    return <CheckCheck className="w-3.5 h-3.5 text-white/70" />;
  if (status === 'read')
    return <CheckCheck className="w-3.5 h-3.5 text-sky-300" />;
  if (status === 'failed')
    return <AlertCircle className="w-3.5 h-3.5 text-red-300" />;
  return null;
}

// ─── Conversation Item ───────────────────────────────────────────────────────

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
  slaInfo?: SLAInfo | null;
  batchMode?: boolean;
  isBatchSelected?: boolean;
  onBatchToggle?: () => void;
  /** Phase 2: label da channelConnection que recebeu a conversa. Vazio se
   *  é canal-empresa primary (não polui a UI quando todo mundo usa o mesmo). */
  connectionLabel?: string;
  /** Phase 2: true se a conexão é pessoal do operador atual ('user' + ownerId=self).
   *  Usado pra estilizar o badge diferentemente. */
  isMineConnection?: boolean;
}

function ConversationItem({ conversation, isSelected, onClick, slaInfo, batchMode, isBatchSelected, onBatchToggle, connectionLabel, isMineConnection }: ConversationItemProps) {
  const { t } = useTranslation();
  const cfg = getConvConfig(conversation);
  const displayName = conversation.customContactName ?? conversation.contactName;
  const initials = getInitials(displayName);

  return (
    <motion.div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      whileHover={{ x: 2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(
        'w-full text-left px-3 py-3 flex items-start gap-3 transition-colors duration-150 relative cursor-pointer select-none',
        isSelected
          ? 'bg-red-50 dark:bg-red-500/[0.08] border-l-2 border-red-500'
          : 'border-l-2 border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.03]',
      )}
    >
      {/* Batch checkbox — div para evitar button-dentro-de-button */}
      {batchMode && (
        <div
          role="checkbox"
          aria-checked={isBatchSelected}
          tabIndex={0}
          onClick={e => { e.stopPropagation(); onBatchToggle?.(); }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onBatchToggle?.(); } }}
          className="flex-shrink-0 mt-0.5 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
        >
          {isBatchSelected
            ? <CheckSquare className="w-5 h-5 text-red-500" />
            : <Square className="w-5 h-5" />}
        </div>
      )}

      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="relative w-10 h-10">
          {/* Fallback iniciais — sempre renderizado embaixo */}
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm absolute inset-0',
              cfg.avatarBg,
              cfg.textColor,
            )}
          >
            {initials}
          </div>
          {/* Foto do contato — sobreposta; some no erro sem precisar de state */}
          {conversation.contactAvatarUrl && (
            <CachedImage
              src={conversation.contactAvatarUrl}
              alt={displayName}
              className="w-10 h-10 rounded-full object-cover absolute inset-0"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
        </div>
        {/* Channel badge */}
        <div
          className={cn(
            'absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center',
            'bg-white dark:bg-[#111827] border border-white dark:border-[#111827]',
          )}
        >
          <ChannelIcon channel={conversation.channel} size="sm" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <StatusDot status={conversation.status} />
            <span
              className={cn(
                'font-semibold text-sm truncate',
                isSelected
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-900 dark:text-gray-100',
              )}
            >
              {displayName}
            </span>
          </div>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 whitespace-nowrap">
            {relativeTime(conversation.lastMessageAt, t)}
          </span>
        </div>
        {connectionLabel && (
          <div className="mb-0.5">
            <span className={cn(
              'inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide',
              isMineConnection
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
            )}>
              {isMineConnection
                ? <UserIcon className="w-2.5 h-2.5" />
                : <Building2 className="w-2.5 h-2.5" />}
              {connectionLabel}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate leading-relaxed">
            {conversation.lastMessageDirection === 'outbound' ? (
              <span className="text-gray-400 dark:text-gray-500 mr-1">{t('conversations.you', 'Você:')}</span>
            ) : (
              // Indicador "msg do cliente" — seta sutil em sky pra escanear
              // sem ler. Sky combina com StatusDot 'open' nova e não compete
              // com o verde do WhatsApp. Só renderiza quando inbound — outbound
              // já tem o "Você:" como sinal claro de que operador respondeu.
              <CornerDownLeft
                className="inline-block w-3 h-3 mr-1 -mt-0.5 text-sky-500 dark:text-sky-400"
                aria-label="Mensagem do cliente"
              />
            )}
            {conversation.lastMessage}
          </p>
          {slaInfo && slaInfo.status !== 'ok' && slaInfo.status !== 'responded' && (
            <span className={cn('flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full',
              slaInfo.status === 'breached'
                ? 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400'
                : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'
            )}>
              {slaInfo.status === 'breached' ? 'VENC.' : formatSLARemaining(slaInfo.remainingMs)}
            </span>
          )}
          {conversation.unreadCount > 0 && (
            <span className="flex-shrink-0 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
              {conversation.unreadCount}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Settings Dialog ─────────────────────────────────────────────────────────

function IntegrationSettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { business } = useAuth();
  const { setActivePage } = useAppContext();

  const channels = business?.channels as (NonNullable<typeof business>['channels'] & {
    whatsappCloud?: { isConnected?: boolean; phoneNumberId?: string; displayPhoneNumber?: string };
    whatsappBaileys?: { isConnected?: boolean; phoneNumber?: string; displayPhoneNumber?: string };
  }) | undefined;
  // Considera conectado se qualquer um dos campos (novo ou legado) está ativo
  const waCloud = channels?.whatsappCloud;
  const waBaileys = channels?.whatsappBaileys;
  const waLegacy = channels?.whatsapp;
  const waConnected = !!(waCloud?.isConnected || waBaileys?.isConnected || waLegacy?.isConnected);
  const waDisplayName = waCloud?.displayPhoneNumber || waCloud?.phoneNumberId
    || waBaileys?.displayPhoneNumber || waBaileys?.phoneNumber
    || waLegacy?.displayPhoneNumber || waLegacy?.phoneNumberId || '';
  const integrations = [
    {
      channel: 'whatsapp' as ConversationChannel,
      name: 'WhatsApp Business',
      description: waConnected
        ? `Conectado: ${waDisplayName}`
        : 'Receba e envie mensagens via API oficial do WhatsApp Business',
      isConnected: waConnected,
    },
    {
      channel: 'facebook' as ConversationChannel,
      name: 'Facebook Page',
      description: channels?.facebook?.isConnected
        ? `Conectado: ${channels.facebook.pageName || channels.facebook.pageId || ''}`
        : 'Integre com sua Página do Facebook para gerenciar mensagens',
      isConnected: channels?.facebook?.isConnected || false,
    },
    {
      channel: 'instagram' as ConversationChannel,
      name: 'Instagram Business',
      description: channels?.instagram?.isConnected
        ? `Conectado: ${channels.instagram.accountName || channels.instagram.accountId || ''}`
        : 'Responda DMs do Instagram direto pelo Aevo',
      isConnected: channels?.instagram?.isConnected || false,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="relative z-10 w-full max-w-md bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-black/[0.06] dark:border-white/[0.08] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
          <div>
            <h2 className="font-display font-bold text-gray-900 dark:text-white text-lg">
              {t('conversations.integrationsTitle', 'Integrações de Mensagens')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t('conversations.integrationsDesc', 'Configure os canais de comunicação')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Integrations list */}
        <div className="p-4 space-y-3">
          {integrations.map((item) => {
            const cfg = getConvConfig(item);
            return (
              <div
                key={item.channel}
                className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-100 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.02]"
              >
                <div
                  className={cn(
                    'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
                    cfg.bgColor,
                  )}
                >
                  <ChannelIcon channel={item.channel} size="md" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-gray-900 dark:text-white">
                      {item.name}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0',
                        item.isConnected
                          ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                          : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400',
                      )}
                    >
                      {item.isConnected ? t('conversations.connected', 'Conectado') : t('conversations.notConfigured', 'Não configurado')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                    {item.description}
                  </p>
                  <button
                    onClick={() => { onClose(); setActivePage('Configurações'); }}
                    className={cn(
                      'mt-2 text-xs font-semibold px-3 py-1 rounded-lg transition-colors',
                      cfg.bgColor,
                      cfg.textColor,
                      'hover:opacity-80',
                    )}
                  >
                    {item.isConnected ? t('conversations.manage', 'Gerenciar') : t('conversations.configure', 'Configurar')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {integrations.some((i) => !i.isConnected) && (
          <div className="px-6 pb-5">
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                {t('conversations.metaWarning', 'Para conectar os canais você precisará de uma conta Meta Business Suite e configurar as credenciais da API no painel de Configurações.')}
              </p>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Thread Header ────────────────────────────────────────────────────────────

function ThreadHeader({
  conversation,
  onBack,
  onStatusChange,
  onSectorAssign,
  onCreateOrder,
  onToggleAi,
  onGoToAgentSettings,
  onOpenAgentDebug,
  onOpenContact,
  onLinkClient,
  linkedClientName,
  onDeleteConversation,
  onMarkUnread,
  onTogglePrivate,
  onExport,
  onMerge,
  onRename,
  onSnooze,
  onUnsnooze,
  aiEnabledBusinessWide,
  sectors: sectorsList,
  slaInfo,
  onToggleAssignHistory,
  channelConnection,
  isMineConnection,
  onTransferChannel,
}: {
  conversation: Conversation;
  onBack: () => void;
  onStatusChange: (status: ConversationStatus) => void;
  onSectorAssign?: () => void;
  onCreateOrder?: () => void;
  onToggleAi?: () => void;
  onGoToAgentSettings?: () => void;
  onOpenAgentDebug?: () => void;
  onOpenContact?: () => void;
  onLinkClient?: () => void;
  linkedClientName?: string;
  onDeleteConversation?: () => void;
  onMarkUnread?: () => void;
  onTogglePrivate?: () => void;
  onExport?: () => void;
  onMerge?: () => void;
  onRename?: (name: string) => Promise<void>;
  /** Soneca: silencia a conversa por X horas (some das views ativas até lá). */
  onSnooze?: (untilIso: string) => void;
  /** Tira da soneca antes do tempo (limpa snoozedUntil). */
  onUnsnooze?: () => void;
  aiEnabledBusinessWide?: boolean;
  sectors?: Sector[];
  slaInfo?: SLAInfo | null;
  onToggleAssignHistory?: () => void;
  /** Phase 2: connection que recebeu/envia esta conversa. Usado pra mostrar
   *  "via @CanalNome" no header quando relevante (canal não-default). */
  channelConnection?: import('@/lib/types').ChannelConnection;
  /** True quando channelConnection é pessoal do operador atual. */
  isMineConnection?: boolean;
  /** Phase 3.3: transferir conversa pra outro canal. Quando undefined,
   *  esconde a opção (ex: operador sem outros canais acessíveis). */
  onTransferChannel?: () => void;
}) {
  const { t } = useTranslation();
  const cfg = getConvConfig(conversation);
  const displayName = conversation.customContactName ?? conversation.contactName;
  const initials = getInitials(displayName);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [savingName, setSavingName] = useState(false);
  const isCommittingRef = useRef(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);

  // Reset edit state when conversation changes
  useEffect(() => {
    setIsEditingName(false);
    setEditNameValue('');
    setSavingName(false);
    isCommittingRef.current = false;
    // Submenu de soneca também reseta — sem isso, mudar de conversa
    // mantinha o menu aberto da anterior em estado inconsistente.
    setShowSnoozeMenu(false);
  }, [conversation.id]);

  // Quando overflow menu fecha (ex: click-outside), o submenu de soneca
  // que estava aberto ficaria órfão. Sincronizar fechamentos.
  useEffect(() => {
    if (!showOverflowMenu) setShowSnoozeMenu(false);
  }, [showOverflowMenu]);

  const startEditName = () => {
    setEditNameValue(displayName);
    setIsEditingName(true);
  };

  const commitEditName = async () => {
    if (isCommittingRef.current) return; // guard against Enter + onBlur double-fire
    const trimmed = editNameValue.trim();
    if (!trimmed || trimmed === displayName) { setIsEditingName(false); return; }
    isCommittingRef.current = true;
    setSavingName(true);
    try {
      await onRename?.(trimmed);
    } catch (err) {
      console.error('Rename failed:', err);
      toast.error('Erro ao renomear contato');
    } finally {
      isCommittingRef.current = false;
      setSavingName(false);
      setIsEditingName(false);
    }
  };

  useEffect(() => {
    if (!showOverflowMenu) return;
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOverflowMenu]);

  const statusOptions: { value: ConversationStatus; label: string; color: string }[] = [
    // Aberta: sky em vez de emerald — alinha com StatusDot e evita choque
    // visual com a paleta verde do WhatsApp (bubbles, badges, marca).
    { value: 'open', label: t('conversations.statusOpen', 'Aberta'), color: 'text-sky-600 dark:text-sky-400' },
    { value: 'waiting', label: t('conversations.statusWaiting2', 'Aguardando'), color: 'text-amber-600 dark:text-amber-400' },
    { value: 'resolved', label: t('conversations.statusResolved2', 'Resolvida'), color: 'text-gray-500 dark:text-gray-400' },
  ];

  return (
    <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-white dark:bg-[#111827] border-b border-gray-100 dark:border-white/[0.06] shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile back */}
        <button
          onClick={onBack}
          className="md:hidden w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-600 dark:text-gray-300 flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div className="relative w-9 h-9">
            {/* Fallback iniciais — sempre renderizado embaixo */}
            <div
              className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm absolute inset-0',
                cfg.avatarBg,
                cfg.textColor,
              )}
            >
              {initials}
            </div>
            {/* Foto do contato — sobreposta; some no erro sem precisar de state */}
            {conversation.contactAvatarUrl && (
              <CachedImage
                src={conversation.contactAvatarUrl}
                alt={displayName}
                className="w-9 h-9 rounded-full object-cover absolute inset-0"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
          </div>
          <div
            className={cn(
              'absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center',
              'bg-white dark:bg-[#111827] border border-white dark:border-[#111827]',
            )}
          >
            <ChannelIcon channel={conversation.channel} size="sm" />
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isEditingName ? (
              <input
                autoFocus
                value={editNameValue}
                onChange={e => setEditNameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEditName(); }
                  if (e.key === 'Escape') { setIsEditingName(false); setEditNameValue(''); }
                }}
                onBlur={commitEditName}
                disabled={savingName}
                maxLength={80}
                className="font-semibold text-sm bg-transparent border-b border-red-400 focus:outline-none text-gray-900 dark:text-white w-40 max-w-[200px] disabled:opacity-50"
              />
            ) : (
              <div className="flex items-center gap-1 group/name min-w-0">
                <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                  {displayName}
                </span>
                {onRename && (
                  <button
                    onClick={startEditName}
                    title="Renomear contato"
                    className="opacity-0 group-hover/name:opacity-100 transition-opacity p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
            <span
              className={cn(
                'hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0',
                cfg.bgColor,
                cfg.textColor,
              )}
            >
              <ChannelIcon channel={conversation.channel} size="sm" />
              {cfg.label}
            </span>
            {/* Phase 2: badge "via @CanalNome" — esconde em business primary
                (default, não polui) e em conexões inexistentes. */}
            {channelConnection && !(channelConnection.ownerType === 'business' && channelConnection.isPrimary) && (
              <span
                title={`Conexão: ${channelConnection.displayName}${channelConnection.phoneNumber ? ` · +${channelConnection.phoneNumber}` : ''}`}
                className={cn(
                  'hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0',
                  isMineConnection
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
                )}
              >
                {isMineConnection ? <UserIcon className="w-2.5 h-2.5" /> : <Building2 className="w-2.5 h-2.5" />}
                via {channelConnection.displayName}
              </span>
            )}
            {onLinkClient && (
              <button
                type="button"
                onClick={onLinkClient}
                className={cn(
                  'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors',
                  linkedClientName
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                    : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-500/20',
                )}
                title={linkedClientName ? `Cliente: ${linkedClientName}` : 'Contato não vinculado a cliente'}
              >
                {linkedClientName ? <UserIcon className="w-2.5 h-2.5" /> : <UserPlus className="w-2.5 h-2.5" />}
                <span className="max-w-[12ch] truncate">
                  {linkedClientName || 'Vincular cliente'}
                </span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <StatusDot status={conversation.status} />
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {conversation.status === 'open' && t('conversations.inAttendance', 'Em atendimento')}
              {conversation.status === 'waiting' && t('conversations.waiting', 'Aguardando')}
              {conversation.status === 'resolved' && t('conversations.resolved', 'Resolvida')}
            </span>
            {conversation.contactPhone && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="hidden sm:block text-[11px] text-gray-400 dark:text-gray-500">
                  {conversation.contactPhone}
                </span>
              </>
            )}
            {/* Sector badge */}
            {conversation.assignedToSectorId && sectorsList && (() => {
              const sector = sectorsList.find(s => s.id === conversation.assignedToSectorId);
              return sector ? (
                <>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: sector.color }}
                  >
                    {sector.name}
                  </span>
                </>
              ) : null;
            })()}
            {/* Priority badge */}
            {conversation.priority && conversation.priority !== 'medium' && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className={cn(
                  'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                  conversation.priority === 'urgent' && 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400',
                  conversation.priority === 'high' && 'bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400',
                  conversation.priority === 'low' && 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400',
                )}>
                  {conversation.priority === 'urgent' ? t('kanban.priority.urgent', 'Urgente') : conversation.priority === 'high' ? t('kanban.priority.high', 'Alta') : t('kanban.priority.low', 'Baixa')}
                </span>
              </>
            )}
            {conversation.isPrivate && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <Lock className="w-3 h-3 text-amber-500" />
              </>
            )}
            {/* SLA chip */}
            {slaInfo && slaInfo.status !== 'ok' && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-1',
                  slaInfo.status === 'responded' && 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
                  slaInfo.status === 'warning' && 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400',
                  slaInfo.status === 'breached' && 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400',
                )}>
                  <Clock className="w-2.5 h-2.5" />
                  {slaInfo.status === 'responded' && 'SLA atendido'}
                  {slaInfo.status === 'warning' && `${formatSLARemaining(slaInfo.remainingMs)} restantes`}
                  {slaInfo.status === 'breached' && 'SLA vencido'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* AI toggle — sempre visível; estado reflete business-wide + conversation-level */}
        {onToggleAi && (() => {
          const aiOn = aiEnabledBusinessWide && conversation.aiEnabled !== false;
          const disabled = !aiEnabledBusinessWide;
          return (
            <motion.button
              whileHover={!disabled ? { scale: 1.05 } : {}}
              whileTap={!disabled ? { scale: 0.95 } : {}}
              onClick={disabled ? onGoToAgentSettings : onToggleAi}
              className={cn(
                'relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-colors border',
                aiOn
                  ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white border-violet-500 shadow-sm shadow-violet-500/20'
                  : disabled
                    ? 'bg-gray-50 dark:bg-white/[0.03] text-gray-400 border-dashed border-gray-300 dark:border-gray-700 cursor-help'
                    : 'bg-gray-100 dark:bg-white/[0.06] text-gray-400 border-gray-200 dark:border-gray-700',
              )}
              title={
                disabled
                  ? 'Agente IA desativado em nível de empresa. Clique para ir para Configurações.'
                  : aiOn
                    ? 'Agente IA ativo nesta conversa — clique para desligar só aqui'
                    : 'Agente IA desligado nesta conversa — clique para ligar'
              }
            >
              {aiOn ? <Bot className="w-3.5 h-3.5" /> : <BotOff className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">
                {disabled ? 'IA —' : aiOn ? 'IA ON' : 'IA OFF'}
              </span>
              {aiOn && (
                <motion.span
                  className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-400 rounded-full"
                  animate={{ scale: [1, 1.3, 1], opacity: [0.8, 1, 0.8] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
            </motion.button>
          );
        })()}
        {/* Debug agente */}
        {aiEnabledBusinessWide && onOpenAgentDebug && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onOpenAgentDebug}
            className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-violet-500 transition-colors"
            title="Inspecionar runs do agente"
          >
            <Activity className="w-4 h-4" />
          </motion.button>
        )}
        {/* Criar pedido — modo pedidos */}
        {onCreateOrder && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onCreateOrder}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm shadow-red-600/20 transition-colors"
            title="Criar pedido a partir desta conversa"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            Criar Pedido
          </motion.button>
        )}
        {/* Sector assign button */}
        {onSectorAssign && sectorsList && sectorsList.length > 0 && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onSectorAssign}
            className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title={t('conversations.assignSector', 'Atribuir setor')}
          >
            <Layers className="w-4 h-4" />
          </motion.button>
        )}
        {/* Status change */}
        <div className="relative">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowStatusMenu((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors',
              'bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100',
            )}
          >
            <StatusDot status={conversation.status} />
            <span className="hidden sm:block">
              {statusOptions.find((s) => s.value === conversation.status)?.label}
            </span>
            <ChevronDown className="w-3 h-3" />
          </motion.button>

          <AnimatePresence>
            {showStatusMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -5 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-[#1e293b] rounded-xl shadow-xl border border-gray-100 dark:border-white/[0.08] overflow-hidden z-20"
              >
                {statusOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      onStatusChange(opt.value);
                      setShowStatusMenu(false);
                    }}
                    className={cn(
                      'w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors text-xs font-medium',
                      conversation.status === opt.value
                        ? opt.color
                        : 'text-gray-600 dark:text-gray-300',
                    )}
                  >
                    <StatusDot status={opt.value} />
                    {opt.label}
                    {conversation.status === opt.value && (
                      <Check className="w-3 h-3 ml-auto" />
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Overflow menu */}
        <div className="relative" ref={overflowRef}>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowOverflowMenu(v => !v)}
            className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title="Mais opções"
          >
            <MoreVertical className="w-4 h-4" />
          </motion.button>

          <AnimatePresence>
            {showOverflowMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -5 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-[#1e293b] rounded-xl shadow-xl border border-gray-100 dark:border-white/[0.08] overflow-hidden z-30 py-1"
              >
                {onOpenContact && (
                  <button
                    onClick={() => { onOpenContact(); setShowOverflowMenu(false); }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-xs text-gray-700 dark:text-gray-300"
                  >
                    <UserIcon className="w-3.5 h-3.5 text-gray-400" />
                    Ver/editar contato
                  </button>
                )}
                {onMarkUnread && (
                  <button
                    onClick={() => { onMarkUnread(); setShowOverflowMenu(false); }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-xs text-gray-700 dark:text-gray-300"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
                    Marcar como não lida
                  </button>
                )}
                {/* Soneca: se já está silenciada, mostra "Tirar da soneca";
                    senão, abre submenu de quick-pick (1h / 4h / amanhã 9h /
                    custom). Estados controlados pelo pai — handler grava
                    snoozedUntil + snoozedBy + snoozedByName. */}
                {(() => {
                  const now = Date.now();
                  const currentlySnoozed = isSnoozed(conversation, now);
                  if (currentlySnoozed && onUnsnooze) {
                    const until = new Date(conversation.snoozedUntil!);
                    const untilLabel = until.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
                    return (
                      <button
                        onClick={() => { onUnsnooze(); setShowOverflowMenu(false); }}
                        className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-xs text-gray-700 dark:text-gray-300"
                      >
                        <BellOff className="w-3.5 h-3.5 text-amber-500" />
                        <span className="flex-1">Tirar da soneca</span>
                        <span className="text-[10px] text-gray-400">até {untilLabel}</span>
                      </button>
                    );
                  }
                  if (!onSnooze) return null;
                  return (
                    <div className="relative">
                      <button
                        onClick={() => setShowSnoozeMenu(v => !v)}
                        className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-xs text-gray-700 dark:text-gray-300"
                      >
                        <Moon className="w-3.5 h-3.5 text-gray-400" />
                        <span className="flex-1">Soneca</span>
                        <ChevronRight className="w-3 h-3 text-gray-400" />
                      </button>
                      <AnimatePresence>
                        {showSnoozeMenu && (
                          <motion.div
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -4 }}
                            transition={{ duration: 0.12 }}
                            className="absolute left-full top-0 ml-1 w-44 bg-white dark:bg-[#1a2030] border border-gray-200 dark:border-white/[0.08] rounded-xl shadow-lg overflow-hidden z-50"
                          >
                            {(() => {
                              // Quick-pick presets. Cálculo de "amanhã 9h" e
                              // "próx. segunda 9h" usa Date local pra respeitar
                              // o fuso do operador, depois converte pra ISO.
                              const tomorrow9 = new Date(now);
                              tomorrow9.setDate(tomorrow9.getDate() + 1);
                              tomorrow9.setHours(9, 0, 0, 0);
                              const nextMonday9 = new Date(now);
                              const day = nextMonday9.getDay(); // 0=dom, 1=seg...
                              const daysToMonday = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
                              nextMonday9.setDate(nextMonday9.getDate() + daysToMonday);
                              nextMonday9.setHours(9, 0, 0, 0);
                              const presets: { label: string; hint: string; iso: string }[] = [
                                { label: '1 hora',           hint: 'agora + 1h',   iso: new Date(now + 60 * 60 * 1000).toISOString() },
                                { label: '4 horas',          hint: 'agora + 4h',   iso: new Date(now + 4 * 60 * 60 * 1000).toISOString() },
                                { label: 'Amanhã 9h',        hint: tomorrow9.toLocaleDateString('pt-BR', { weekday: 'short' }), iso: tomorrow9.toISOString() },
                                { label: 'Próx. segunda 9h', hint: nextMonday9.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), iso: nextMonday9.toISOString() },
                              ];
                              return presets.map(p => (
                                <button
                                  key={p.label}
                                  onClick={() => { onSnooze(p.iso); setShowSnoozeMenu(false); setShowOverflowMenu(false); }}
                                  className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-xs text-gray-700 dark:text-gray-300"
                                >
                                  <span>{p.label}</span>
                                  <span className="text-[10px] text-gray-400">{p.hint}</span>
                                </button>
                              ));
                            })()}
                            <div className="border-t border-gray-100 dark:border-white/[0.06]" />
                            {/* Personalizado: input datetime-local nativo. Não
                                quero peso de DatePicker MUI só pra isso. */}
                            <label className="block px-3 py-2 text-[10px] text-gray-400 uppercase tracking-wider">
                              Personalizado
                            </label>
                            <input
                              type="datetime-local"
                              min={new Date(now + 60 * 1000).toISOString().slice(0, 16)}
                              onChange={e => {
                                if (!e.target.value) return;
                                const picked = new Date(e.target.value);
                                if (!Number.isFinite(picked.getTime()) || picked.getTime() <= now) return;
                                onSnooze(picked.toISOString());
                                setShowSnoozeMenu(false);
                                setShowOverflowMenu(false);
                              }}
                              className="w-[calc(100%-1.5rem)] mx-3 mb-2 px-2 py-1.5 text-xs bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-lg text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-red-400"
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })()}
                {onTogglePrivate && (
                  <button
                    onClick={() => { onTogglePrivate(); setShowOverflowMenu(false); }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-xs text-gray-700 dark:text-gray-300"
                  >
                    <Lock className="w-3.5 h-3.5 text-gray-400" />
                    {conversation.isPrivate ? 'Tornar pública' : 'Tornar privada'}
                  </button>
                )}
                {onExport && (
                  <button
                    onClick={() => { onExport(); setShowOverflowMenu(false); }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-xs text-gray-700 dark:text-gray-300"
                  >
                    <FileText className="w-3.5 h-3.5 text-gray-400" />
                    Exportar PDF
                  </button>
                )}
                {onMerge && (
                  <button onClick={() => { onMerge(); setShowOverflowMenu(false); }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-xs text-gray-700 dark:text-gray-300">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-gray-400" />
                    Unificar com outra conversa
                  </button>
                )}
                {onTransferChannel && (
                  <button onClick={() => { onTransferChannel(); setShowOverflowMenu(false); }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-xs text-gray-700 dark:text-gray-300">
                    <Smartphone className="w-3.5 h-3.5 text-gray-400" />
                    Transferir para outro canal
                  </button>
                )}
                {(conversation.assignmentHistory?.length ?? 0) > 0 && onToggleAssignHistory && (
                  <button onClick={() => { onToggleAssignHistory(); setShowOverflowMenu(false); }}
                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-xs text-gray-700 dark:text-gray-300">
                    <History className="w-3.5 h-3.5" />
                    Histórico de atribuições ({conversation.assignmentHistory!.length})
                  </button>
                )}
                {onDeleteConversation && (
                  <>
                    <div className="border-t border-gray-100 dark:border-white/[0.06] my-1" />
                    <button
                      onClick={() => { onDeleteConversation(); setShowOverflowMenu(false); }}
                      className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-red-50 dark:hover:bg-red-500/10 text-xs text-red-600 dark:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Excluir conversa
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ─── Media Attachment Renderer ────────────────────────────────────────────────

/** Heurística: o `content` é só o filename do arquivo? Usado pra esconder a
 *  bolha de texto que duplicaria o nome quando ele já está no card do
 *  documento. Cobre mensagens legadas (gravadas antes da Phase X, quando
 *  setávamos content=file.name) sem precisar migração de dados. */
function looksLikeFilename(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed || trimmed.length > 200) return false;
  return /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z|jpg|jpeg|png|gif|webp|mp4|mov|avi|mp3|m4a|aac|amr|ogg|opus|wav|webm)$/i.test(trimmed);
}

function MediaAttachment({
  mediaUrl,
  mediaType,
  fileName,
}: {
  mediaUrl: string;
  mediaType?: ConversationMessage['mediaType'];
  fileName?: string;
}) {
  const { t } = useTranslation();

  if (mediaType === 'image') {
    return (
      <div className="mb-1.5 rounded-xl overflow-hidden max-w-[240px]">
        <img
          src={mediaUrl}
          alt={t('conversations.mediaImage', 'Imagem')}
          className="w-full h-auto object-cover rounded-xl"
          loading="lazy"
        />
      </div>
    );
  }

  if (mediaType === 'video') {
    return (
      <div className="mb-1.5 rounded-xl overflow-hidden max-w-[280px]">
        <video
          controls
          preload="metadata"
          className="w-full rounded-xl bg-black"
          style={{ maxHeight: '200px' }}
        >
          <source src={mediaUrl} />
        </video>
      </div>
    );
  }

  if (mediaType === 'audio') {
    return (
      <div className="mb-1.5 min-w-[240px] max-w-[300px]">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls preload="metadata" className="w-full block">
          <source src={mediaUrl} />
        </audio>
      </div>
    );
  }

  if (mediaType === 'document') {
    const label = fileName || t('conversations.mediaDocument', 'Documento');
    return (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={label}
        className="mb-1.5 flex items-center gap-2 px-3 py-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors min-w-[160px] max-w-[280px]"
      >
        <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{label}</span>
      </a>
    );
  }

  return null;
}

// ─── Transport Badge ──────────────────────────────────────────────────────────

/**
 * Indica visualmente em CADA bolha por qual transporte WhatsApp a mensagem
 * trafegou: Cloud API (oficial Meta) vs Baileys (WhatsApp Web). Crítico quando
 * a empresa tem ambos os canais ativos — operador identifica de relance.
 *
 * Renderizado discretamente na linha do timestamp (não compete com o conteúdo).
 */
function TransportBadge({ connectedVia }: { connectedVia: 'embedded_signup' | 'baileys' }) {
  const isBaileys = connectedVia === 'baileys';
  const Icon = isBaileys ? Smartphone : BadgeCheck;
  const label = isBaileys ? 'Web' : 'Oficial';
  const tooltip = isBaileys
    ? 'WhatsApp Web (Baileys) — conexão via celular do dono do número'
    : 'WhatsApp Business (Meta Cloud API, oficial)';

  return (
    <span
      title={tooltip}
      className={cn(
        'inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-none',
        isBaileys
          ? 'bg-[#128C7E]/10 text-[#128C7E] dark:bg-[#128C7E]/20 dark:text-[#25D366]'
          : 'bg-[#0A7CFF]/10 text-[#0A7CFF] dark:bg-[#0A7CFF]/20 dark:text-[#4DA3FF]',
      )}
    >
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

/**
 * Cor do balão de mensagem outbound por canal — usa as cores oficiais de
 * cada plataforma pra que o operador identifique de relance qual canal
 * a thread está usando, em vez do vermelho-Aevo genérico em todos.
 *
 *   • WhatsApp Cloud (Meta):    verde signature #25D366
 *   • WhatsApp Web (Baileys):   verde escuro #128C7E (mesmo tom do app desktop)
 *   • Facebook Messenger:       azul #0866FF
 *   • Instagram:                gradient rosa→roxo (paleta oficial)
 *   • Email / desconhecido:     fallback pro vermelho da marca Aevo
 *
 * Notas internas e mensagens inbound NÃO usam essa coloração — internas
 * são amber, inbound mantém branco/cinza neutro.
 */
function getOutboundBubbleClass(message: ConversationMessage): string {
  const base = 'text-white rounded-2xl rounded-tr-sm';
  if (message.channel === 'whatsapp') {
    if (message.connectedVia === 'baileys') {
      return `${base} bg-gradient-to-br from-[#128C7E] to-[#0e6f63]`;
    }
    return `${base} bg-gradient-to-br from-[#25D366] to-[#1ebd5b]`;
  }
  if (message.channel === 'facebook') {
    return `${base} bg-gradient-to-br from-[#0866FF] to-[#0a5ad9]`;
  }
  if (message.channel === 'instagram') {
    // Gradient oficial Instagram (rosa → roxo). Cobre o "vermelho" que
    // operador associa à marca, mas com a tonalidade real (pink-magenta).
    return `${base} bg-gradient-to-br from-[#E1306C] to-[#833AB4]`;
  }
  // Email ou canal desconhecido — mantém identidade Aevo
  return `${base} bg-gradient-to-br from-red-600 to-red-500`;
}

function MessageBubble({
  message,
  isGrouped,
  channel,
  onRetry,
}: {
  message: ConversationMessage;
  isGrouped: boolean;
  channel: ConversationChannel;
  onRetry?: (msg: ConversationMessage) => void;
}) {
  const { t } = useTranslation();
  const isOut = message.direction === 'outbound';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(
        'flex',
        isOut ? 'justify-end' : 'justify-start',
        isGrouped ? 'mt-0.5' : 'mt-3',
      )}
    >
      {/* Largura dual: percentual em telas estreitas (mobile bonito) + cap
          absoluto em telas largas (espelha WhatsApp Web — bolha não estica
          o texto até a metade do monitor em mensagens longas). 600px é
          ~80 chars de texto, ponto de leitura confortável. */}
      <div className={cn('max-w-[85%] sm:max-w-[min(75%,600px)] flex flex-col', isOut ? 'items-end' : 'items-start')}>
        {/* Media attachment */}
        {message.mediaUrl && message.mediaType && (
          <MediaAttachment mediaUrl={message.mediaUrl} mediaType={message.mediaType} fileName={message.fileName} />
        )}

        {/* Text content — esconde bolha de texto que duplicaria o card de mídia:
            (1) placeholders genéricos "[Documento]"/"[Imagem]" gravados no
            inbound quando não há caption real;
            (2) filename como content (legado pré-fix gravava file.name aqui)
            ou content == fileName (UI nova com fileName explícito). */}
        {message.content
          && !(message.mediaType
            && /^\[(Imagem|Audio|Áudio|Video|Vídeo|Sticker|Documento|Midia|Mídia)\]$/i.test(message.content))
          && !(message.mediaType === 'document'
            && (message.content === message.fileName || looksLikeFilename(message.content)))
          && (
          <div
            className={cn(
              'relative px-3.5 py-2.5 text-sm leading-relaxed shadow-sm',
              message.isInternal
                ? 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-100 rounded-2xl'
                : isOut
                  ? getOutboundBubbleClass(message)
                  : 'bg-white dark:bg-[#1e293b] border border-gray-100 dark:border-gray-700/50 text-gray-800 dark:text-gray-100 rounded-2xl rounded-tl-sm',
            )}
          >
            {message.isInternal && (
              <div className="flex items-center gap-1 mb-1">
                <Lock className="w-3 h-3 text-amber-500" />
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">{t('conversations.internalNote', 'Nota interna')}</span>
                {message.senderName && (
                  <span className="text-[10px] text-amber-500 dark:text-amber-400/70">· {message.senderName}</span>
                )}
              </div>
            )}
            {message.content}
          </div>
        )}

        {/* Time + status + transport badge */}
        <div
          className={cn(
            'flex items-center gap-1.5 mt-1 px-1',
            isOut ? 'flex-row-reverse' : 'flex-row',
          )}
        >
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {fullTime(message.sentAt)}
          </span>
          {isOut && <MessageStatusIcon status={message.status} />}
          {/* Transport indicator: só pra WhatsApp, distingue Cloud (oficial Meta)
              de Baileys (WhatsApp Web). Notas internas não têm transporte —
              nunca saíram pelo canal — então não mostramos badge nelas. */}
          {message.channel === 'whatsapp' && !message.isInternal && message.connectedVia && (
            <TransportBadge connectedVia={message.connectedVia} />
          )}
        </div>

        {/* Retry button for failed messages */}
        {message.status === 'failed' && message.direction === 'outbound' && onRetry && (
          <button
            onClick={() => onRetry(message)}
            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 mt-1 px-1 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            {t('conversations.tryAgain', 'Tentar novamente')}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Message List ─────────────────────────────────────────────────────────────

function MessageList({
  messages,
  conversation,
  messagesEndRef,
  onRetry,
  hasMoreMessages,
  loadingMoreMessages,
  onLoadMore,
}: {
  messages: ConversationMessage[];
  conversation: Conversation;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onRetry?: (msg: ConversationMessage) => void;
  hasMoreMessages?: boolean;
  loadingMoreMessages?: boolean;
  onLoadMore?: () => void;
}) {
  const { t } = useTranslation();
  const items: Array<
    | { type: 'separator'; label: string }
    | { type: 'message'; msg: ConversationMessage; isGrouped: boolean }
  > = [];

  messages.forEach((msg, idx) => {
    // Date separator
    const prev = messages[idx - 1];
    if (!prev || !isSameDay(prev.sentAt, msg.sentAt)) {
      items.push({ type: 'separator', label: dateSeparatorLabel(msg.sentAt, t) });
    }
    // Group with previous?
    const isGrouped =
      !!prev &&
      prev.direction === msg.direction &&
      isSameDay(prev.sentAt, msg.sentAt) &&
      new Date(msg.sentAt).getTime() - new Date(prev.sentAt).getTime() < 5 * 60_000;
    items.push({ type: 'message', msg, isGrouped });
  });

  return (
    <>
      {hasMoreMessages && (
        <div className="flex justify-center py-3">
          <button
            onClick={onLoadMore}
            disabled={loadingMoreMessages}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
          >
            {loadingMoreMessages ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> {t('conversations.loadingMore', 'Carregando...')}</>
            ) : (
              <><ChevronUp className="w-3 h-3" /> {t('conversations.loadMoreMessages', 'Carregar mensagens anteriores')}</>
            )}
          </button>
        </div>
      )}
      {items.map((item, idx) => {
        if (item.type === 'separator') {
          return (
            <motion.div
              key={`sep-${idx}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center py-2"
            >
              <span className="px-3 py-1 rounded-full bg-gray-200 dark:bg-white/[0.06] text-[11px] font-medium text-gray-500 dark:text-gray-400">
                {item.label}
              </span>
            </motion.div>
          );
        }
        return (
          <MessageBubble
            key={item.msg.id}
            message={item.msg}
            isGrouped={item.isGrouped}
            channel={conversation.channel}
            onRetry={onRetry}
          />
        );
      })}
      <div ref={messagesEndRef} />
    </>
  );
}

// ─── Composer ────────────────────────────────────────────────────────────────

/**
 * API imperativa do Composer — usada pelo pai pra ler/escrever o texto sem
 * controlar o estado externamente. Antes o `value` vivia em useState do
 * ConversasModule (~8000 linhas), e cada tecla disparava re-render do
 * módulo inteiro: lista de 177 conversas, painel de mensagens, sidebar,
 * tudo. Latência de ~30-50ms por tecla → segurar 'a' travava a UI.
 *
 * Agora o estado fica LOCAL ao Composer (componente pequeno). Pai lê/escreve
 * via ref imperativa em momentos pontuais (send, snippet, retry).
 */
export interface ComposerHandle {
  /** Lê o texto atual — chamado por handleSend antes de mandar. */
  getText: () => string;
  /** Define o texto — usado em retry (restore após erro), insert de snippet/template. */
  setText: (s: string) => void;
  /** Foca a textarea — usado após send/snippet pra cursor voltar pro input. */
  focus: () => void;
}

interface ComposerProps {
  /** Recebe o texto atual via parâmetro — pai NÃO precisa rastrear estado. */
  onSend: (text: string) => void;
  /** Chamado quando user digita "/" com texto vazio — pai abre popover de snippets. */
  onSlashWhenEmpty?: () => void;
  /** Disparado a cada keystroke (debounced internamente em sendTypingIndicator). */
  onTyping?: () => void;
  channel: ConversationChannel;
  connectedVia?: string;
  isSending: boolean;
  attachment: File | null;
  onAttachmentSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAttachmentRemove: () => void;
  disabled?: boolean;
  onTemplateClick?: () => void;
  isInternalNote?: boolean;
  onToggleInternalNote?: () => void;
  onSnippetClick?: () => void;
  /**
   * Setado quando o canal da conversa pertence a OUTRO operador (canal pessoal
   * de Igor, e estou logado como Maria/admin). A mensagem que eu enviar vai
   * sair do número do Igor — operador precisa ter ciência. Banner âmbar.
   */
  crossOperatorWarning?: { ownerName: string };
}

const Composer = memo(forwardRef<ComposerHandle, ComposerProps>(function Composer({
  onSend,
  onSlashWhenEmpty,
  onTyping,
  channel,
  connectedVia,
  isSending,
  attachment,
  onAttachmentSelect,
  onAttachmentRemove,
  disabled,
  onTemplateClick,
  isInternalNote,
  onToggleInternalNote,
  onSnippetClick,
  crossOperatorWarning,
}, ref) {
  const { t } = useTranslation();
  const cfg = getConvConfig({ channel, connectedVia: connectedVia as 'baileys' | 'embedded_signup' | undefined });

  // Estado local — re-renders ficam contidos no Composer.
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // textRef serve pro getText() do imperative handle ler valor sem closure stale.
  const textRef = useRef('');
  textRef.current = text;

  useImperativeHandle(ref, () => ({
    getText: () => textRef.current,
    setText: (s: string) => {
      setText(s);
      textRef.current = s;
      // Sync de altura (auto-resize) acontece no useEffect [text] abaixo.
    },
    focus: () => taRef.current?.focus(),
  }), []);

  const hasContent = text.trim().length > 0 || !!attachment;
  const isDisabled = disabled || false;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate thumbnail preview for images
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showEmojiPicker) return;
    const h = (e: MouseEvent) => { if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) setShowEmojiPicker(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showEmojiPicker]);

  const EMOJIS = ['😀','😂','😍','🥰','😊','😎','😭','😤','🙏','👍','👎','❤️','🔥','✅','⚠️','🎉','💡','📌','🕐','💰','📞','📧','🤝','👋','😅','🤔','💪','🎯','📢','🚀'];

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (attachment && attachment.type.startsWith('image/')) {
      const url = URL.createObjectURL(attachment);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [attachment]);

  // Sincroniza altura da textarea com text — resetar pra 1 linha após send,
  // restore em retry, ou insert de snippet/template (cenários onde setText
  // é chamado externamente via imperative handle).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 144)}px`;
  }, [text]);

  // Handler de Enter (send) e "/" (open snippets) — agora vive dentro do
  // Composer pra ter acesso direto ao text local. Antes o pai precisava
  // recriar handleKeyDown a cada mudança de messageInput (dep no useCallback).
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (hasContent && !isSending) {
        onSend(textRef.current);
      }
      return;
    }
    if (e.key === '/' && textRef.current === '') {
      onSlashWhenEmpty?.();
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className={cn(
      'flex-shrink-0 px-4 py-3 border-t transition-colors',
      isInternalNote
        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-500/20'
        : 'bg-white dark:bg-[#111827] border-gray-100 dark:border-white/[0.06]'
    )}>
      {/* Cross-operator warning: conversa pertence ao canal pessoal de OUTRO
          operador. Mensagens enviadas aqui saem do NÚMERO dele, não do meu —
          contato vai ver "Igor" no remetente, mesmo eu (admin/Maria) tendo
          digitado. UI deixa explícito pra evitar surpresas. */}
      {crossOperatorWarning && !isInternalNote && (
        <div className="flex items-start gap-2 mb-2 px-2 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
          <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <span className="text-xs text-amber-800 dark:text-amber-300 leading-snug">
            Você está respondendo pelo <strong>canal pessoal de {crossOperatorWarning.ownerName}</strong>.
            A mensagem sairá do número dele — o cliente verá como se {crossOperatorWarning.ownerName} respondeu.
          </span>
        </div>
      )}
      {/* Internal Note Banner */}
      {isInternalNote && (
        <div className="flex items-center gap-2 mb-2 px-2">
          <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            {t('conversations.internalNoteHint', 'Nota interna — não será enviada ao contato')}
          </span>
          <button
            onClick={onToggleInternalNote}
            className="ml-auto text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 font-medium"
          >
            {t('conversations.backToMessage', 'Voltar para mensagem')}
          </button>
        </div>
      )}
      {isDisabled ? (
        /* Template-only mode (24h window expired) */
        <div className="flex items-center gap-3">
          <div className="flex-1 px-4 py-2.5 rounded-2xl bg-gray-100 dark:bg-white/[0.04] border border-transparent dark:border-white/[0.06] text-sm text-gray-400 dark:text-gray-500">
            {t('conversations.windowExpiredInline', 'Janela de 24h expirada. Use um template para retomar a conversa.')}
          </div>
          <motion.button
            onClick={onTemplateClick}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-br from-[#25D366] to-[#128C7E] text-white text-sm font-semibold shadow-sm shadow-[#25D366]/30 hover:shadow-md transition-all"
          >
            <FileText className="w-4 h-4" />
            {t('conversations.sendTemplate', 'Enviar Template')}
          </motion.button>
        </div>
      ) : (
      <>
      {/* Attachment preview */}
      <AnimatePresence>
        {attachment && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 overflow-hidden"
          >
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50 dark:bg-white/[0.04] border border-gray-200/60 dark:border-white/[0.08]">
              {previewUrl ? (
                <img src={previewUrl} alt="Preview" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center flex-shrink-0">
                  {attachment.type.startsWith('video/') && <Video className="w-5 h-5 text-gray-400" />}
                  {attachment.type.startsWith('audio/') && <Headphones className="w-5 h-5 text-gray-400" />}
                  {(!attachment.type.startsWith('video/') && !attachment.type.startsWith('audio/')) && <FileText className="w-5 h-5 text-gray-400" />}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{attachment.name}</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500">{formatFileSize(attachment.size)}</p>
              </div>
              <button
                onClick={onAttachmentRemove}
                className="w-6 h-6 rounded-lg bg-gray-200 dark:bg-white/[0.08] flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2">
        {/* Left actions */}
        <div className="flex items-center gap-1 pb-1.5">
          <div className="relative" ref={emojiPickerRef}>
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={() => setShowEmojiPicker(v => !v)}
              className={cn('w-8 h-8 rounded-xl flex items-center justify-center transition-colors',
                showEmojiPicker
                  ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-500'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
              )}>
              <Smile className="w-4 h-4" />
            </motion.button>
            <AnimatePresence>
              {showEmojiPicker && (
                <motion.div initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.97 }}
                  className="absolute bottom-full mb-2 left-0 z-20 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-2.5 w-56">
                  <div className="grid grid-cols-6 gap-1">
                    {EMOJIS.map(e => (
                      <button key={e} onClick={() => {
                        setText(prev => {
                          const next = prev + e;
                          textRef.current = next;
                          return next;
                        });
                        setShowEmojiPicker(false);
                        taRef.current?.focus();
                      }}
                        className="w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                        {e}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => fileInputRef.current?.click()}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
            title={t('conversations.attachFile', 'Anexar arquivo')}
          >
            <Paperclip className="w-4 h-4" />
          </motion.button>
          {onToggleInternalNote && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onToggleInternalNote}
              className={cn(
                'w-8 h-8 rounded-xl flex items-center justify-center transition-colors',
                isInternalNote
                  ? 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/20'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
              )}
              title={t('conversations.internalNoteButton', 'Nota interna')}
            >
              <StickyNote className="w-4 h-4" />
            </motion.button>
          )}
          {onSnippetClick && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onSnippetClick}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
              title={t('conversations.quickReplies', 'Respostas rápidas')}
            >
              <Slash className="w-4 h-4" />
            </motion.button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={onAttachmentSelect}
            className="hidden"
          />
        </div>

        {/* Textarea */}
        <div className="flex-1 relative">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              textRef.current = v;
              // Notifica pai pra disparar typing indicator (debounced internamente).
              onTyping?.();
              // Auto-resize estilo WhatsApp Web: cresce conforme texto, capa
              // em max-h-36 (144px ~6 linhas) onde o overflow-y entra. O reset
              // pra 'auto' antes é necessário pra encolher quando user apaga.
              const ta = e.currentTarget;
              ta.style.height = 'auto';
              ta.style.height = `${Math.min(ta.scrollHeight, 144)}px`;
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t('conversations.messagePlaceholder', 'Digite uma mensagem...')}
            disabled={isSending}
            className="w-full resize-none bg-gray-100 dark:bg-white/[0.04] border border-transparent dark:border-white/[0.06] rounded-2xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:bg-white dark:focus:bg-white/[0.06] transition-colors leading-relaxed max-h-36 overflow-y-auto disabled:opacity-50"
            style={{ minHeight: '42px' }}
          />
          {text.length > 200 && (
            <span className="absolute bottom-1 right-3 text-[10px] text-gray-400 dark:text-gray-600">
              {text.length}/1000
            </span>
          )}
        </div>

        {/* Send button */}
        <motion.button
          onClick={() => onSend(textRef.current)}
          whileHover={hasContent && !isSending ? { scale: 1.05 } : undefined}
          whileTap={hasContent && !isSending ? { scale: 0.95 } : undefined}
          disabled={!hasContent || isSending}
          className={cn(
            'w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all duration-200 shadow-sm mb-0.5',
            hasContent && !isSending
              ? 'bg-gradient-to-br from-red-600 to-red-500 text-white shadow-red-500/30 shadow-md'
              : 'bg-gray-100 dark:bg-white/[0.06] text-gray-400 dark:text-gray-600 cursor-not-allowed',
          )}
        >
          <Send className={cn('w-4 h-4', hasContent && !isSending && 'translate-x-0.5 -translate-y-0.5')} />
        </motion.button>
      </div>
      </>
      )}

      {/* Channel hint */}
      <div className="flex items-center justify-between mt-1.5 px-1">
        <div className={cn('flex items-center gap-1', cfg.textColor)}>
          <ChannelIcon channel={channel} size="sm" />
          <span className="text-[10px] font-medium opacity-70">
            {t('conversations.sendingVia', 'Enviando via {{channel}}', { channel: cfg.label })}
          </span>
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">
          {isDisabled ? t('conversations.onlyTemplatesAvailable', 'Apenas templates disponíveis') : t('conversations.enterToSend', 'Enter para enviar · Shift+Enter para nova linha')}
        </span>
      </div>
    </div>
  );
}));
Composer.displayName = 'Composer';

// ─── Advanced Filters ────────────────────────────────────────────────────────

interface AdvancedFilters {
  assignedTo: string;
  priority: string;
  label: string;
  slaStatus: '' | 'warning' | 'breached';
  unreadOnly: boolean;
}

const EMPTY_ADV_FILTERS: AdvancedFilters = { assignedTo: '', priority: '', label: '', slaStatus: '', unreadOnly: false };

function countActiveFilters(f: AdvancedFilters): number {
  return [f.assignedTo, f.priority, f.label, f.slaStatus, f.unreadOnly].filter(Boolean).length;
}

function AdvancedFilterPanel({ filters, onChange, members, allLabels, slaEnabled, onSaveView }: {
  filters: AdvancedFilters;
  onChange: (f: AdvancedFilters) => void;
  members: User[];
  allLabels: string[];
  slaEnabled: boolean;
  onSaveView: () => void;
}) {
  const set = <K extends keyof AdvancedFilters>(key: K, val: AdvancedFilters[K]) =>
    onChange({ ...filters, [key]: val });

  const selClass = 'text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-red-400 w-full';

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.18 }} className="overflow-hidden border-b border-gray-100 dark:border-white/[0.06]">
      <div className="px-4 py-3 space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          {/* Assigned to */}
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Responsável</p>
            <select value={filters.assignedTo} onChange={e => set('assignedTo', e.target.value)} className={selClass}>
              <option value="">Todos</option>
              {members.map(m => <option key={m.id} value={m.uid}>{m.name}</option>)}
            </select>
          </div>
          {/* Priority */}
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Prioridade</p>
            <select value={filters.priority} onChange={e => set('priority', e.target.value)} className={selClass}>
              <option value="">Todas</option>
              <option value="urgent">Urgente</option>
              <option value="high">Alta</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {/* Label */}
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Label / Tag</p>
            <select value={filters.label} onChange={e => set('label', e.target.value)} className={selClass}>
              <option value="">Todas</option>
              {allLabels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          {/* SLA status */}
          {slaEnabled && (
            <div>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Status SLA</p>
              <select value={filters.slaStatus} onChange={e => set('slaStatus', e.target.value as AdvancedFilters['slaStatus'])} className={selClass}>
                <option value="">Todos</option>
                <option value="warning">Em alerta</option>
                <option value="breached">Vencido</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          {/* Unread only */}
          <label className="flex items-center gap-2 cursor-pointer">
            <button onClick={() => set('unreadOnly', !filters.unreadOnly)}
              className={cn('w-8 h-4 rounded-full transition-colors relative', filters.unreadOnly ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600')}>
              <span className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform', filters.unreadOnly ? 'translate-x-4' : 'translate-x-0.5')} />
            </button>
            <span className="text-xs text-gray-600 dark:text-gray-400">Não lidas</span>
          </label>

          <button onClick={onSaveView}
            className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:text-red-700 transition-colors">
            <Bookmark className="w-3 h-3" /> Salvar view
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Saved Views Bar ─────────────────────────────────────────────────────────

function SavedViewsBar({ views, activeViewId, onSelect, onEdit, onDelete }: {
  views: ConversationView[];
  activeViewId: string | null;
  onSelect: (view: ConversationView) => void;
  /** Edit reusa o SaveViewModal com prefill (nome+emoji). Filtros atuais
   *  da UI podem ou não substituir os da view — ver handleEditView no parent. */
  onEdit: (view: ConversationView) => void;
  onDelete: (viewId: string) => void;
}) {
  if (views.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 px-4 pb-2 overflow-x-auto scrollbar-none flex-shrink-0">
      {views.map(view => {
        const isActive = activeViewId === view.id;
        return (
          <div key={view.id} className={cn('flex items-center rounded-lg border text-[10px] font-semibold whitespace-nowrap transition-all',
            isActive
              ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400'
              : 'bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600')}>
            <button onClick={() => onSelect(view)} className="flex items-center gap-1 pl-2.5 py-1.5">
              {view.emoji && <span>{view.emoji}</span>}
              <BookmarkCheck className="w-2.5 h-2.5 opacity-60" />
              {view.name}
            </button>
            <button
              onClick={() => onEdit(view)}
              title="Editar view"
              className="px-1 py-1.5 opacity-40 hover:opacity-100 transition-opacity"
            >
              <Pencil className="w-2.5 h-2.5" />
            </button>
            <button onClick={() => onDelete(view.id)}
              title="Apagar view"
              className="pr-1.5 py-1.5 opacity-40 hover:opacity-100 transition-opacity">
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Save View Modal ─────────────────────────────────────────────────────────

function SaveViewModal({ onSave, onClose, initialName, initialEmoji, mode = 'create' }: {
  onSave: (name: string, emoji: string) => Promise<void>;
  onClose: () => void;
  initialName?: string;
  initialEmoji?: string;
  /** 'create' (default) abre vazio; 'edit' prefilla nome+emoji existentes
   *  e troca os labels de UI ("Editar view" / "Atualizar"). O save handler
   *  do parent decide se cria novo doc ou atualiza o existente. */
  mode?: 'create' | 'edit';
}) {
  const [name, setName] = useState(initialName ?? '');
  const [emoji, setEmoji] = useState(initialEmoji ?? '🔖');
  const [saving, setSaving] = useState(false);
  const EMOJIS = ['🔖', '⭐', '🔥', '📌', '💼', '🎯', '📋', '🚨', '💬', '✅'];

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave(name.trim(), emoji); onClose(); }
    finally { setSaving(false); }
  };

  const isEdit = mode === 'edit';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-xs bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">{isEdit ? 'Editar view' : 'Salvar view'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-3.5 h-3.5" /></button>
        </div>
        {isEdit && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed -mt-1">
            Os filtros atuais da tela serão salvos como o novo conteúdo desta view.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {EMOJIS.map(e => (
            <button key={e} onClick={() => setEmoji(e)}
              className={cn('w-8 h-8 text-base rounded-lg transition-all', emoji === e ? 'bg-red-100 dark:bg-red-500/20 ring-2 ring-red-400' : 'hover:bg-gray-100 dark:hover:bg-gray-800')}>
              {e}
            </button>
          ))}
        </div>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="Nome da view (ex: Urgentes sem resposta)"
          className="w-full px-3 py-2.5 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={!name.trim() || saving}
            className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50">
            {saving ? 'Salvando...' : (isEdit ? 'Atualizar' : 'Salvar')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Batch Action Bar ─────────────────────────────────────────────────────────

function BatchActionBar({ count, onAssign, onStatus, onTag, onMarkRead, onCancel }: {
  count: number;
  onAssign: () => void;
  onStatus: (s: ConversationStatus) => void;
  onTag: () => void;
  onMarkRead: () => void;
  onCancel: () => void;
}) {
  const [showStatus, setShowStatus] = useState(false);

  return (
    <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="absolute bottom-0 left-0 right-0 z-20 px-3 pb-3">
      <div className="bg-gray-900 dark:bg-gray-800 rounded-2xl shadow-2xl p-3 flex items-center gap-2">
        <span className="text-xs font-bold text-white bg-red-500 rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5">
          {count}
        </span>
        <span className="text-xs text-gray-300 flex-1 min-w-0 truncate">selecionada{count !== 1 ? 's' : ''}</span>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onMarkRead} title="Marcar como lida"
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
            <MailOpen className="w-3.5 h-3.5" />
          </button>
          <button onClick={onAssign} title="Atribuir"
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
            <UserCheck className="w-3.5 h-3.5" />
          </button>
          <div className="relative">
            <button onClick={() => setShowStatus(v => !v)} title="Mudar status"
              className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
              <CheckCircle className="w-3.5 h-3.5" />
            </button>
            <AnimatePresence>
              {showStatus && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                  className="absolute bottom-full mb-1.5 left-0 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden w-36">
                  {(['open', 'waiting', 'resolved'] as ConversationStatus[]).map(s => (
                    <button key={s} onClick={() => { onStatus(s); setShowStatus(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
                      <StatusDot status={s} />
                      {s === 'open' ? 'Aberta' : s === 'waiting' ? 'Aguardando' : 'Resolvida'}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button onClick={onTag} title="Adicionar tag"
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
            <TagIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        <button onClick={onCancel} title="Cancelar seleção" className="w-8 h-8 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

function BatchTagInput({ onAdd, existingTags }: { onAdd: (tag: string) => void; existingTags: string[] }) {
  const [val, setVal] = useState('');
  const filtered = existingTags.filter(t => val ? t.toLowerCase().includes(val.toLowerCase()) : true).slice(0, 8);
  return (
    <div className="space-y-2">
      <input autoFocus value={val} onChange={e => setVal(e.target.value)} placeholder="Nome da tag..."
        onKeyDown={e => e.key === 'Enter' && val.trim() && onAdd(val.trim())}
        className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400" />
      {filtered.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filtered.map(t => (
            <button key={t} onClick={() => onAdd(t)}
              className="px-2.5 py-1 text-xs font-medium bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-400 rounded-full hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-colors">
              {t}
            </button>
          ))}
        </div>
      )}
      {val.trim() && !existingTags.includes(val.trim()) && (
        <button onClick={() => onAdd(val.trim())}
          className="w-full py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors">
          + Criar tag "{val.trim()}"
        </button>
      )}
    </div>
  );
}

// ─── Routing Rules Dialog ─────────────────────────────────────────────────────

function RoutingRulesDialog({ rules: initial, businessId, members, sectors: sectorsList, onClose, onSaved }: {
  rules: RoutingRule[];
  businessId: string;
  members: User[];
  sectors: Sector[];
  onClose: () => void;
  onSaved: (rules: RoutingRule[]) => void;
}) {
  const [rules, setRules] = useState<RoutingRule[]>(initial);
  const [saving, setSaving] = useState(false);

  const newRule = (): RoutingRule => ({
    id: crypto.randomUUID(), name: 'Nova regra', enabled: true, order: rules.length,
    conditions: {}, action: { type: 'assign_sector' },
  });

  const update = (id: string, patch: Partial<RoutingRule>) =>
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

  const remove = (id: string) => setRules(prev => prev.filter(r => r.id !== id));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'businesses', businessId), { 'settings.routingRules': rules, updatedAt: new Date().toISOString() });
      onSaved(rules);
      onClose();
      toast.success('Regras de roteamento salvas');
    } catch { toast.error('Erro ao salvar'); } finally { setSaving(false); }
  };

  const selClass = 'text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none flex-1';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-lg bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div>
            <h2 className="font-bold text-sm text-gray-900 dark:text-white">Regras de Roteamento</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">Atribua conversas automaticamente ao chegar</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {rules.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <p className="text-sm">Nenhuma regra configurada</p>
              <p className="text-xs mt-1 text-gray-300">Crie regras para atribuir conversas automaticamente</p>
            </div>
          )}
          {rules.map((rule, i) => (
            <div key={rule.id} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/60">
                <button onClick={() => update(rule.id, { enabled: !rule.enabled })}
                  className={cn('w-9 rounded-full transition-colors flex-shrink-0 relative overflow-hidden', rule.enabled ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600')} style={{ width: 36, height: 20, minWidth: 36 }}>
                  <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', rule.enabled ? 'translate-x-[18px]' : 'translate-x-0.5')} />
                </button>
                <input value={rule.name} onChange={e => update(rule.id, { name: e.target.value })}
                  className="flex-1 text-xs font-semibold bg-transparent text-gray-700 dark:text-gray-300 focus:outline-none" />
                <button onClick={() => remove(rule.id)} className="p-1 text-gray-300 hover:text-red-500 transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="p-3 space-y-2.5">
                <div>
                  <p className="text-[9px] font-bold text-gray-400 uppercase mb-1.5">Condições (E)</p>
                  <div className="flex flex-wrap gap-2">
                    <select value={rule.conditions.channel ?? ''} onChange={e => update(rule.id, { conditions: { ...rule.conditions, channel: e.target.value } })} className={selClass}>
                      <option value="">Qualquer canal</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="facebook">Facebook</option>
                      <option value="instagram">Instagram</option>
                    </select>
                    <select value={rule.conditions.priority ?? ''} onChange={e => update(rule.id, { conditions: { ...rule.conditions, priority: e.target.value } })} className={selClass}>
                      <option value="">Qualquer prioridade</option>
                      <option value="urgent">Urgente</option>
                      <option value="high">Alta</option>
                      <option value="medium">Média</option>
                      <option value="low">Baixa</option>
                    </select>
                    <input placeholder="Palavra-chave (opcional)" value={rule.conditions.keyword ?? ''}
                      onChange={e => update(rule.id, { conditions: { ...rule.conditions, keyword: e.target.value } })}
                      className={selClass} />
                  </div>
                </div>
                <div>
                  <p className="text-[9px] font-bold text-gray-400 uppercase mb-1.5">Ação</p>
                  <div className="flex gap-2 flex-wrap">
                    <select value={rule.action.type} onChange={e => update(rule.id, { action: { type: e.target.value as RoutingRule['action']['type'] } })} className={selClass}>
                      <option value="assign_sector">Atribuir ao setor</option>
                      <option value="assign_user">Atribuir ao agente</option>
                      <option value="set_priority">Definir prioridade</option>
                    </select>
                    {rule.action.type === 'assign_sector' && (
                      <select value={rule.action.sectorId ?? ''} onChange={e => {
                        const s = sectorsList.find(x => x.id === e.target.value);
                        update(rule.id, { action: { ...rule.action, sectorId: e.target.value, sectorName: s?.name } });
                      }} className={selClass}>
                        <option value="">Selecionar setor</option>
                        {sectorsList.filter(s => s.isActive).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                    {rule.action.type === 'assign_user' && (
                      <select value={rule.action.userId ?? ''} onChange={e => {
                        const m = members.find(x => x.uid === e.target.value);
                        update(rule.id, { action: { ...rule.action, userId: e.target.value, userName: m?.name } });
                      }} className={selClass}>
                        <option value="">Selecionar agente</option>
                        {members.map(m => <option key={m.uid} value={m.uid}>{m.name}</option>)}
                      </select>
                    )}
                    {rule.action.type === 'set_priority' && (
                      <select value={rule.action.priority ?? ''} onChange={e => update(rule.id, { action: { ...rule.action, priority: e.target.value } })} className={selClass}>
                        <option value="">Selecionar</option>
                        <option value="urgent">Urgente</option>
                        <option value="high">Alta</option>
                        <option value="medium">Média</option>
                        <option value="low">Baixa</option>
                      </select>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <button onClick={() => setRules(r => [...r, newRule()])}
            className="w-full py-2.5 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-400 hover:border-red-400 hover:text-red-500 transition-colors flex items-center justify-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Nova regra
          </button>
        </div>

        <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar regras'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── CSAT Dashboard ──────────────────────────────────────────────────────────

function CSATDashboard({ businessId, onClose }: { businessId: string; onClose: () => void }) {
  const [responses, setResponses] = useState<CSATResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    getDocs(query(collection(db, 'csatResponses'), where('businessId', '==', businessId), orderBy('respondedAt', 'desc'), limit(100)))
      .then(snap => { setResponses(snap.docs.map(d => ({ ...d.data(), id: d.id } as CSATResponse))); setLoading(false); })
      .catch(() => setLoading(false));
  }, [businessId]);

  const avg = responses.length > 0 ? (responses.reduce((s, r) => s + r.rating, 0) / responses.length).toFixed(1) : '-';
  const dist = [5, 4, 3, 2, 1].map(n => ({ n, count: responses.filter(r => r.rating === n).length }));
  const max = Math.max(...dist.map(d => d.count), 1);
  const COLORS = ['text-emerald-600', 'text-emerald-500', 'text-amber-500', 'text-orange-500', 'text-red-500'];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-sm bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="font-bold text-sm text-gray-900 dark:text-white">Satisfação dos Clientes</h2>
            <p className="text-[10px] text-gray-400">{responses.length} avaliação(ões) recebida(s)</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {loading ? (
            <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-8 rounded-lg shimmer" />)}</div>
          ) : responses.length === 0 ? (
            <div className="text-center py-6 text-gray-400">
              <p className="text-2xl mb-1">⭐</p>
              <p className="text-sm">Nenhuma avaliação ainda</p>
              <p className="text-xs mt-1 text-gray-300">Ative o CSAT e resolva conversas para receber avaliações</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <p className="text-4xl font-bold text-gray-900 dark:text-white">{avg}</p>
                <div className="flex justify-center gap-0.5 mt-1">
                  {[1,2,3,4,5].map(n => (
                    <span key={n} className={parseFloat(avg) >= n ? 'text-amber-400' : 'text-gray-200 dark:text-gray-700'} style={{ fontSize: 18 }}>★</span>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">média geral</p>
              </div>
              <div className="space-y-1.5">
                {dist.map(({ n, count }, i) => (
                  <div key={n} className="flex items-center gap-2">
                    <span className={cn('text-xs font-bold w-3', COLORS[i])}>{n}</span>
                    <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${(count / max) * 100}%` }} transition={{ duration: 0.5, delay: i * 0.06 }}
                        className={cn('h-full rounded-full', i === 0 ? 'bg-emerald-500' : i === 1 ? 'bg-emerald-400' : i === 2 ? 'bg-amber-400' : i === 3 ? 'bg-orange-400' : 'bg-red-400')} />
                    </div>
                    <span className="text-xs text-gray-400 w-4 text-right">{count}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {responses.filter(r => r.comment).slice(0, 5).map(r => (
                  <div key={r.id} className="p-2.5 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-amber-400 text-xs">{'★'.repeat(r.rating)}</span>
                      <span className="text-[10px] text-gray-400">{r.contactName}</span>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{r.comment}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── New Conversation Dialog ──────────────────────────────────────────────────

interface WaTemplate {
  name: string;
  language: string;
  category: string;
  preview: string;
  hasVariables: boolean;
}

function NewConversationDialog({
  open,
  onClose,
  onCreated,
  clients,
  clientsLoadError,
  connections,
  myConnectionIds,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (conversation: Conversation) => void;
  clients: Client[];
  /** Mensagem de erro quando o snapshot de clientes falha (rules, index, etc). */
  clientsLoadError?: string | null;
  /** Phase 3.2: connections visíveis pro user (business + próprias 'user').
   *  Usado pra montar dropdown "Enviar de" quando há múltiplas. */
  connections: import('@/lib/types').ChannelConnection[];
  /** IDs das connections 'user' do operador atual — pra exibir badge. */
  myConnectionIds: Set<string>;
  /** Pré-preenche o dialog com cliente + canal/modo escolhidos.
   *  Vem do AppContext.pendingNewConversation quando ChannelsTab do detalhe
   *  do cliente aciona "Iniciar conversa". null = abre vazio (botão "+" do header). */
  prefill?: {
    client: Client;
    channel: 'whatsapp' | 'facebook' | 'instagram';
    whatsappMode?: 'cloud' | 'baileys';
  } | null;
}) {
  const { business, user } = useAuth();
  const channels = business?.channels as (NonNullable<typeof business>['channels'] & {
    whatsappCloud?: { isConnected?: boolean; accessToken?: string };
    whatsappBaileys?: { isConnected?: boolean };
  }) | undefined;
  // Novo modelo: campos isolados whatsappCloud + whatsappBaileys.
  // Cada canal cai no fallback legado SÓ se o seu próprio campo novo estiver ausente —
  // assim Cloud e Baileys podem coexistir mesmo durante a migração de dados legados.
  const cloudCfg = channels?.whatsappCloud;
  const baileysCfg = channels?.whatsappBaileys;
  const legacyWa = channels?.whatsapp as ((NonNullable<typeof channels>['whatsapp']) & { connectedVia?: string }) | undefined;
  const baileysAvailable = !!baileysCfg?.isConnected
    || (!baileysCfg && !!legacyWa?.isConnected && legacyWa.connectedVia === 'baileys');
  const cloudAvailable = !!(cloudCfg?.isConnected && cloudCfg.accessToken)
    || (!cloudCfg && !!legacyWa?.isConnected && legacyWa.connectedVia !== 'baileys' && !!legacyWa.accessToken);
  const fbConnected = !!channels?.facebook?.isConnected;
  const igConnected = !!channels?.instagram?.isConnected;

  const [channelMode, setChannelMode] = useState<'baileys' | 'cloud'>('baileys');
  // Phase 3.2: ID da channelConnection escolhida pra "Enviar de". Quando há
  // 1 só, auto-seleciona. Quando há N, dropdown deixa user escolher.
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [messageMode, setMessageMode] = useState<'text' | 'template'>('text');
  const [messageText, setMessageText] = useState('');
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WaTemplate | null>(null);
  const [templateVars, setTemplateVars] = useState<string[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [sending, setSending] = useState(false);

  // Phase 3.2: connections disponíveis pra "Enviar de" — só Baileys (Cloud
  // é sempre 1 por business via Embedded Signup, escolha trivial).
  // Filtra: ativas + connected + tipo correto. Sort: business primary primeiro,
  // depois business secundárias, depois user (pessoais).
  const availableBaileysConnections = useMemo(() => {
    return connections
      .filter(c => c.type === 'whatsapp_baileys' && c.isActive && c.isConnected)
      .sort((a, b) => {
        if (a.ownerType === 'business' && b.ownerType !== 'business') return -1;
        if (a.ownerType !== 'business' && b.ownerType === 'business') return 1;
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [connections]);

  // Reset everything on open. Quando há `prefill` (ChannelsTab do detalhe do
  // cliente acionou "Iniciar conversa"), pré-popula client + phone + canal/modo.
  // Caso contrário, abre vazio com defaults inteligentes (Baileys preferido).
  useEffect(() => {
    if (!open) return;
    setMessageText('');
    setSelectedTemplate(null);
    setTemplateVars([]);

    if (prefill) {
      // Pré-fill: phone do client + selectedClient setado + mode escolhido.
      const phone = prefill.client.whatsapp || prefill.client.phone || '';
      setPhoneInput(phone);
      setNameInput(prefill.client.name || '');
      setClientSearch(prefill.client.name || '');
      setSelectedClient(prefill.client);
      // FB/IG não tem opção de modo — channelMode é só pra WA. Pra simplicidade
      // mantemos cloud como default em FB/IG (tanto faz, a UI esconde a toggle).
      if (prefill.channel === 'whatsapp' && prefill.whatsappMode) {
        setChannelMode(prefill.whatsappMode);
        setMessageMode(prefill.whatsappMode === 'baileys' ? 'text' : 'template');
      } else if (prefill.channel === 'whatsapp') {
        // Sem modo explícito — escolhe o disponível.
        if (baileysAvailable) { setChannelMode('baileys'); setMessageMode('text'); }
        else if (cloudAvailable) { setChannelMode('cloud'); setMessageMode('template'); }
      }
      return;
    }

    setPhoneInput('');
    setNameInput('');
    setClientSearch('');
    setSelectedClient(null);
    if (baileysAvailable) {
      setChannelMode('baileys');
      setMessageMode('text');
    } else if (cloudAvailable) {
      setChannelMode('cloud');
      setMessageMode('template');
    }
  }, [open, prefill, baileysAvailable, cloudAvailable]);

  // Phase 3 audit P1.4: revalida selectedConnectionId quando channelMode muda
  // OU quando a lista de connections atualiza (ex: admin adicionou outra
  // entre o open e o submit). Sem isso, ID stale dum canal removido pode
  // ser submetido e criar conv com vínculo quebrado.
  useEffect(() => {
    if (!open) return;
    if (channelMode !== 'baileys') {
      setSelectedConnectionId(null);
      return;
    }
    setSelectedConnectionId(prev => {
      // Mantém seleção atual se ainda válida; senão escolhe primary/primeira
      if (prev && availableBaileysConnections.some(c => c.id === prev)) return prev;
      return availableBaileysConnections[0]?.id ?? null;
    });
  }, [open, channelMode, availableBaileysConnections]);

  // When switching to cloud+template, fetch templates
  useEffect(() => {
    if (!open || channelMode !== 'cloud' || messageMode !== 'template' || !business?.id) return;
    if (templates.length > 0) return;
    let cancelled = false;
    (async () => {
      setLoadingTemplates(true);
      // hello_world is auto-created by Meta in every new WABA — sempre disponível como fallback
      const helloWorldFallback: WaTemplate = {
        name: 'hello_world',
        language: 'en_US',
        category: 'UTILITY',
        preview: 'Hello World',
        hasVariables: false,
      };
      try {
        const token = await getAuth().currentUser?.getIdToken();
        const res = await fetch(`/api/channels/whatsapp-templates?businessId=${business.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Falha ao carregar templates');
        const data = await res.json();
        if (!cancelled) {
          const fetched: WaTemplate[] = data.templates ?? [];
          // Inject hello_world se não estiver presente — garante que sempre há ao menos 1 template usável
          const hasHelloWorld = fetched.some(t => t.name.toLowerCase() === 'hello_world');
          setTemplates(hasHelloWorld ? fetched : [helloWorldFallback, ...fetched]);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[NewConversation] Failed to load templates:', err);
          // Mesmo em erro, oferece hello_world para o usuário poder iniciar conversa
          setTemplates([helloWorldFallback]);
          toast.warn('Lista de templates indisponível — usando hello_world como fallback');
        }
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channelMode, messageMode, business?.id]);

  // When template is selected, init variable inputs
  useEffect(() => {
    if (!selectedTemplate) { setTemplateVars([]); return; }
    const matches = (selectedTemplate.preview || '').match(/\{\{(\d+)\}\}/g) ?? [];
    const count = new Set(matches.map(m => m.replace(/[{}]/g, ''))).size;
    setTemplateVars(Array(count).fill(''));
  }, [selectedTemplate]);

  // Filter clients for search.
  // Exclui merged secondaries e soft-deleted (mesma regra do ClientsModule)
  // pra não poluir busca com registros que o operador não deveria ver.
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return [];
    const q = clientSearch.trim().toLowerCase();
    const qDigits = clientSearch.replace(/\D/g, '');
    return clients.filter(c => {
      if (!c) return false;
      if ((c as { mergedInto?: string }).mergedInto) return false;
      if ((c as { deletedAt?: string }).deletedAt) return false;
      if (c.name?.toLowerCase().includes(q)) return true;
      if (qDigits && (c.phone || '').replace(/\D/g, '').includes(qDigits)) return true;
      if (qDigits && (c.whatsapp || '').replace(/\D/g, '').includes(qDigits)) return true;
      // Match também por email se a busca tem '@'
      if (q.includes('@') && c.email?.toLowerCase().includes(q)) return true;
      return false;
    }).slice(0, 6);
  }, [clientSearch, clients]);

  // Normalize phone to digits-only E.164 (Brazilian default if no country code)
  const normalizePhone = (raw: string): string | null => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length >= 12 && digits.length <= 15) return digits; // already has country code
    if (digits.length === 10 || digits.length === 11) return '55' + digits; // BR default
    return null;
  };

  const pickClient = (c: Client) => {
    setSelectedClient(c);
    setNameInput(c.name);
    const ph = c.whatsapp || c.phone || '';
    setPhoneInput(ph);
    setClientSearch('');
  };

  const renderedTemplatePreview = useMemo(() => {
    if (!selectedTemplate) return '';
    let preview = selectedTemplate.preview || '';
    templateVars.forEach((v, i) => {
      preview = preview.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), v || `{{${i + 1}}}`);
    });
    return preview;
  }, [selectedTemplate, templateVars]);

  const canSend = useMemo(() => {
    if (sending) return false;
    if (!normalizePhone(phoneInput)) return false;
    // Phase 3 audit P1.5: bloqueia envio Baileys quando não há canal disponível.
    // Antes o submit prosseguia e caía no fallback do send/route.ts retornando
    // erro genérico. Agora botão fica disabled até o user reconectar/aguardar.
    if (channelMode === 'baileys' && availableBaileysConnections.length === 0) return false;
    if (channelMode === 'baileys' && !selectedConnectionId) return false;
    if (channelMode === 'cloud' && messageMode === 'template') {
      if (!selectedTemplate) return false;
      if (templateVars.some(v => !v.trim())) return false;
      return true;
    }
    return messageText.trim().length > 0;
  }, [sending, phoneInput, channelMode, messageMode, selectedTemplate, templateVars, messageText, availableBaileysConnections.length, selectedConnectionId]);

  const handleSend = async () => {
    if (!business?.id || !user) return;
    const phoneE164 = normalizePhone(phoneInput);
    if (!phoneE164) { toast.error('Telefone inválido'); return; }

    setSending(true);
    try {
      // Check for existing conversation with same number on whatsapp
      const dupQ = query(
        collection(db, 'conversations'),
        where('businessId', '==', business.id),
        where('channel', '==', 'whatsapp'),
        where('contactExternalId', '==', phoneE164),
      );
      const dupSnap = await getDocs(dupQ);
      if (!dupSnap.empty) {
        const existing = dupSnap.docs[0];
        toast.info('Conversa já existe — abrindo');
        onCreated({ ...(existing.data() as Conversation), id: existing.id });
        onClose();
        return;
      }

      // Build message content + send params
      let content: string;
      let sendType: 'text' | 'template' = 'text';
      let templateName: string | undefined;
      let templateLanguage: string | undefined;
      let templateParams: string[] = [];

      if (channelMode === 'cloud' && messageMode === 'template' && selectedTemplate) {
        sendType = 'template';
        templateName = selectedTemplate.name;
        templateLanguage = selectedTemplate.language;
        templateParams = templateVars;
        content = renderedTemplatePreview;
      } else {
        content = messageText.trim();
        if (!content) { toast.error('Digite a mensagem'); return; }
      }

      const now = new Date().toISOString();
      const displayName = (selectedClient?.name) || nameInput.trim() || phoneE164;

      // Phase 3.2: vincula a conversa à channelConnection escolhida — essencial
      // pra que send/route.ts use a sessão correta no reply (especialmente
      // quando há múltiplas Baileys-empresa ou quando user escolhe pessoal).
      const effectiveConnectionId = channelMode === 'baileys' ? selectedConnectionId : null;
      // Denormaliza ownership da connection escolhida pra fallar em queries/rules
      // sem precisar de get(). Cloud (channelMode!=='baileys') é sempre 'business'.
      const selectedConn = effectiveConnectionId
        ? connections.find(c => c.id === effectiveConnectionId)
        : null;
      const channelOwnerType: 'business' | 'user' = selectedConn?.ownerType === 'user' ? 'user' : 'business';
      const channelOwnerId = selectedConn?.ownerType === 'user' ? selectedConn.ownerId : undefined;

      // Create conversation document
      const convData: Record<string, unknown> = {
        businessId: business.id,
        channel: 'whatsapp',
        connectedVia: channelMode === 'baileys' ? 'baileys' : 'embedded_signup',
        ...(effectiveConnectionId ? { channelConnectionId: effectiveConnectionId } : {}),
        channelOwnerType,
        ...(channelOwnerId ? { channelOwnerId } : {}),
        contactName: displayName,
        contactPhone: phoneE164,
        contactExternalId: phoneE164,
        status: 'open',
        lastMessage: content,
        lastMessageAt: now,
        lastMessageDirection: 'outbound',
        unreadCount: 0,
        firstResponseAt: now,
        assignedTo: user.uid,
        assignedToName: user.name,
        createdAt: now,
        updatedAt: now,
      };
      if (selectedClient) convData.crmContactId = selectedClient.id;

      const convRef = await addDoc(collection(db, 'conversations'), convData);

      // Create first outbound message
      const msgData: Record<string, unknown> = {
        conversationId: convRef.id,
        businessId: business.id,
        channel: 'whatsapp',
        // Marca o transporte pra UI distinguir Cloud vs Baileys nas bolhas.
        connectedVia: channelMode === 'baileys' ? 'baileys' : 'embedded_signup',
        direction: 'outbound',
        content,
        status: 'sending',
        senderName: user.name,
        senderId: user.uid,
        sentAt: now,
        createdAt: now,
      };
      if (sendType === 'template' && templateName) {
        msgData.templateName = templateName;
        msgData.templateLanguage = templateLanguage;
      }
      const msgRef = await addDoc(collection(db, 'conversationMessages'), msgData);

      // Send via API
      const token = await getAuth().currentUser?.getIdToken();
      const sendBody: Record<string, unknown> = {
        businessId: business.id,
        conversationId: convRef.id,
        messageDocId: msgRef.id,
        channel: 'whatsapp',
        recipientId: phoneE164,
        content,
        type: sendType,
      };
      if (sendType === 'template') {
        sendBody.templateName = templateName;
        sendBody.templateLanguage = templateLanguage;
        sendBody.templateParams = templateParams;
      }

      const res = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(sendBody),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Falha no envio (${res.status})`);
      }

      toast.success('Conversa iniciada!');
      // Pass full conversation object so the parent doesn't have to wait for onSnapshot
      onCreated({ ...convData, id: convRef.id } as unknown as Conversation);
      onClose();
    } catch (err) {
      console.error('[NewConversation] Failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao iniciar conversa');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const noWhatsapp = !baileysAvailable && !cloudAvailable;
  const inputCls = 'w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div>
            <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">Nova conversa</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Inicie uma conversa com um contato novo ou existente</p>
          </div>
          <button onClick={onClose} disabled={sending} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 disabled:opacity-50"><X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          {noWhatsapp ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-amber-500" />
              </div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Nenhum canal WhatsApp conectado</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-[260px] mx-auto leading-relaxed">
                Conecte o WhatsApp em Configurações → Enterprise antes de iniciar conversas.
              </p>
            </div>
          ) : (
            <>
              {/* Channel selector */}
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Canal</p>
                <div className="grid grid-cols-1 gap-2">
                  {baileysAvailable && (
                    <button
                      type="button"
                      onClick={() => { setChannelMode('baileys'); setMessageMode('text'); }}
                      className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-all text-left',
                        channelMode === 'baileys'
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                          : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300')}>
                      <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white">
                        <ChannelIcon channel="whatsapp" size="sm" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-900 dark:text-gray-100">WhatsApp Web</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">Sem limites de janela ou template</p>
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">SEM LIMITES</span>
                    </button>
                  )}
                  {cloudAvailable && (
                    <button
                      type="button"
                      onClick={() => { setChannelMode('cloud'); setMessageMode('template'); }}
                      className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-all text-left',
                        channelMode === 'cloud'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300')}>
                      <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white">
                        <ChannelIcon channel="whatsapp" size="sm" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-900 dark:text-gray-100">WhatsApp Business (Meta)</p>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">Requer template fora da janela de 24h</p>
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">OFICIAL</span>
                    </button>
                  )}
                  {(fbConnected || igConnected) && (
                    <div className="px-3 py-2 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-white/[0.02]">
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
                        <Lock className="w-3 h-3 inline mr-1 -mt-0.5" />
                        <strong>Facebook</strong> e <strong>Instagram</strong> não permitem iniciar conversas. O contato deve enviar a primeira mensagem.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Phase 3.2: dropdown "Enviar de" — só aparece se Baileys e há
                  >1 connection disponível. Quando 1 só, é trivial e auto-selecionada. */}
              {channelMode === 'baileys' && availableBaileysConnections.length > 1 && (
                <div>
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Enviar de</p>
                  <div className="relative">
                    <select
                      value={selectedConnectionId || ''}
                      onChange={(e) => setSelectedConnectionId(e.target.value || null)}
                      className={cn(inputCls, 'appearance-none pr-8 cursor-pointer')}
                    >
                      {availableBaileysConnections.map(c => {
                        const prefix = c.ownerType === 'user'
                          ? '[Pessoal] '
                          : c.isPrimary ? '[Principal] ' : '[Empresa] ';
                        return (
                          <option key={c.id} value={c.id}>
                            {prefix}{c.displayName}
                            {c.phoneNumber ? ` · +${c.phoneNumber}` : ''}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                    O contato verá o número escolhido como remetente.
                  </p>
                </div>
              )}

              {/* Contact section */}
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Contato</p>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    placeholder="Buscar cliente existente..."
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    className={cn(inputCls, 'pl-8')}
                  />
                  {filteredClients.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-10 overflow-hidden">
                      {filteredClients.map(c => (
                        <button key={c.id} type="button" onClick={() => pickClient(c)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.04] text-left">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[10px] font-bold text-gray-700 dark:text-gray-200">
                            {getInitials(c.name)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{c.name}</p>
                            <p className="text-[10px] text-gray-400 truncate">{c.whatsapp || c.phone || '—'}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Feedback quando user digitou mas não há match.
                      Antes a busca era silenciosa — sem nenhum hint do que tava errado. */}
                  {clientSearch.trim() && filteredClients.length === 0 && !clientsLoadError && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-10 px-3 py-2.5">
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {clients.length === 0
                          ? 'Nenhum cliente cadastrado ainda. Use os campos abaixo para criar.'
                          : `Nenhum match em ${clients.length} cliente(s). Tente outro termo ou preencha nome+telefone abaixo pra criar novo.`}
                      </p>
                    </div>
                  )}
                </div>
                {clientsLoadError && (
                  <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-[10px] text-red-700 dark:text-red-400">
                    Falha ao carregar clientes: {clientsLoadError}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <input placeholder="Nome (opcional)" value={nameInput} onChange={e => setNameInput(e.target.value)} className={inputCls} />
                  <input placeholder="(11) 99999-9999" value={phoneInput} onChange={e => setPhoneInput(e.target.value)} className={inputCls} />
                </div>
                {selectedClient && (
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1.5 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Vinculado a {selectedClient.name}
                  </p>
                )}
              </div>

              {/* Message section */}
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Mensagem</p>
                {channelMode === 'cloud' && (
                  <div className="flex gap-1 mb-2 p-0.5 bg-gray-100 dark:bg-white/[0.04] rounded-lg">
                    <button type="button" onClick={() => setMessageMode('template')}
                      className={cn('flex-1 text-[11px] py-1.5 rounded-md font-semibold transition-colors',
                        messageMode === 'template' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
                      Template (recomendado)
                    </button>
                    <button type="button" onClick={() => setMessageMode('text')}
                      className={cn('flex-1 text-[11px] py-1.5 rounded-md font-semibold transition-colors',
                        messageMode === 'text' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400')}>
                      Texto livre
                    </button>
                  </div>
                )}

                {channelMode === 'cloud' && messageMode === 'text' && (
                  <div className="mb-2 px-2.5 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                      <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
                      Texto livre só funciona dentro da janela de 24h após resposta do cliente. Se este for o primeiro contato, o envio falhará.
                    </p>
                  </div>
                )}

                {channelMode === 'cloud' && messageMode === 'template' ? (
                  <div className="space-y-2">
                    {loadingTemplates ? (
                      <div className="flex items-center gap-2 text-xs text-gray-400 py-3 justify-center">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando templates...
                      </div>
                    ) : templates.length === 0 ? (
                      <p className="text-xs text-gray-400 py-3 text-center">Nenhum template aprovado encontrado</p>
                    ) : (
                      <>
                        <select value={selectedTemplate?.name ?? ''}
                          onChange={e => setSelectedTemplate(templates.find(t => t.name === e.target.value) ?? null)}
                          className={inputCls}>
                          <option value="">Selecione um template...</option>
                          {templates.map(t => (
                            <option key={`${t.name}-${t.language}`} value={t.name}>
                              {t.name} ({t.language}) — {t.category}
                            </option>
                          ))}
                        </select>
                        {selectedTemplate && templateVars.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] text-gray-500 dark:text-gray-400">Variáveis</p>
                            {templateVars.map((v, i) => (
                              <input key={i} placeholder={`Valor para {{${i + 1}}}`}
                                value={v}
                                onChange={e => setTemplateVars(prev => prev.map((p, idx) => idx === i ? e.target.value : p))}
                                className={inputCls} />
                            ))}
                          </div>
                        )}
                        {selectedTemplate && (
                          <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700">
                            <p className="text-[9px] font-bold text-gray-400 uppercase mb-1">Preview</p>
                            <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{renderedTemplatePreview}</p>
                          </div>
                        )}
                        {selectedTemplate?.name === 'hello_world' && (
                          <div className="px-2.5 py-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
                            <p className="text-[10px] text-blue-700 dark:text-blue-300 leading-relaxed">
                              <Sparkles className="w-3 h-3 inline mr-1 -mt-0.5" />
                              <strong>hello_world</strong> é um template padrão da Meta, sempre disponível em qualquer WABA. Use como icebreaker — assim que o cliente responder, a janela de 24h abre e você pode mandar texto livre normalmente.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <textarea
                    placeholder="Digite a mensagem..."
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    rows={3}
                    className={cn(inputCls, 'resize-none')}
                  />
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          <button onClick={onClose} disabled={sending}
            className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSend} disabled={!canSend || noWhatsapp}
            className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
            {sending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...</> : <><Send className="w-3.5 h-3.5" /> Enviar</>}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Transfer Channel Dialog (Phase 3.3) ────────────────────────────────────

/**
 * Permite operador transferir uma conversa pra outro canal Baileys/Cloud.
 * Lista canais alternativos do mesmo type que o user pode acessar.
 */
function TransferChannelDialog({
  conversation,
  connections,
  myConnectionIds,
  onClose,
  onTransferred,
}: {
  conversation: Conversation;
  connections: import('@/lib/types').ChannelConnection[];
  myConnectionIds: Set<string>;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const { firebaseUser } = useAuth();
  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [sendNotice, setSendNotice] = useState(true);
  const [noticeText, setNoticeText] = useState('Olá! A partir de agora vou te atender por este número.');
  const [transferring, setTransferring] = useState(false);

  // Type da conversa atual define os candidatos compatíveis (Baileys vs Cloud)
  const convType = conversation.connectedVia === 'baileys' ? 'whatsapp_baileys' : 'whatsapp_cloud';
  const candidates = useMemo(() => {
    return connections
      .filter(c =>
        c.id !== conversation.channelConnectionId
        && c.type === convType
        && c.isActive
        && c.isConnected,
      )
      .sort((a, b) => {
        if (a.ownerType === 'business' && b.ownerType !== 'business') return -1;
        if (a.ownerType !== 'business' && b.ownerType === 'business') return 1;
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [connections, conversation.channelConnectionId, convType]);

  useEffect(() => {
    if (candidates.length > 0 && !selectedTargetId) {
      setSelectedTargetId(candidates[0].id);
    }
  }, [candidates, selectedTargetId]);

  const handleTransfer = async () => {
    if (!selectedTargetId || !firebaseUser) return;
    setTransferring(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/conversations/${conversation.id}/transfer-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          businessId: conversation.businessId,
          targetConnectionId: selectedTargetId,
          sendNotice,
          noticeText: noticeText.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(data.message || 'Conversa transferida.');
      if (sendNotice && data.notice && !data.notice.sent) {
        toast.warn(`Aviso ao contato falhou: ${data.notice.error || 'desconhecido'}`);
      }
      onTransferred();
    } catch (err) {
      console.error('[transfer] Failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao transferir');
    } finally {
      setTransferring(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div onClick={(e) => e.stopPropagation()}
          initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
          className="w-full max-w-sm bg-white dark:bg-[#111827] rounded-2xl p-6 text-center"
        >
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Sem canais compatíveis</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Não há outros canais {convType === 'whatsapp_baileys' ? 'WhatsApp Web' : 'WhatsApp Cloud'} conectados pra receber a transferência.
          </p>
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg bg-gray-100 dark:bg-white/[0.06] text-xs font-semibold">Fechar</button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 8 }}
        className="w-full max-w-md bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h3 className="font-bold text-base text-gray-900 dark:text-gray-100">Transferir canal</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              A conversa passa a ser respondida pelo canal escolhido.
            </p>
          </div>
          <button onClick={onClose} disabled={transferring}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              Canal destino
            </label>
            <div className="space-y-2">
              {candidates.map(c => {
                const isMine = myConnectionIds.has(c.id);
                const isSelected = selectedTargetId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedTargetId(c.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-all',
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                        : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300',
                    )}
                  >
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                      isMine
                        ? 'bg-violet-100 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400'
                        : 'bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400',
                    )}>
                      {isMine ? <UserIcon className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">
                        {c.displayName}
                        {c.isPrimary && (
                          <span className="ml-1.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">PRINCIPAL</span>
                        )}
                      </p>
                      {c.phoneNumber && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">+{c.phoneNumber}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sendNotice}
                onChange={(e) => setSendNotice(e.target.checked)}
                className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-400"
              />
              <div>
                <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                  Avisar contato com mensagem
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Enviada pelo canal NOVO — o contato vê o número diferente. Sem isso, ele pode estranhar a próxima resposta.
                </p>
              </div>
            </label>
            {sendNotice && (
              <textarea
                value={noticeText}
                onChange={(e) => setNoticeText(e.target.value)}
                rows={3}
                className="mt-2 w-full px-3 py-2 text-xs bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                placeholder="Mensagem de aviso..."
              />
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={transferring}
            className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.04] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleTransfer}
            disabled={transferring || !selectedTargetId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
          >
            {transferring ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightLeft className="w-3 h-3" />}
            Transferir
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Merge Conversations Dialog ───────────────────────────────────────────────

function MergeConversationsDialog({ source, conversations, onClose, onMerge }: {
  source: Conversation;
  conversations: Conversation[];
  onClose: () => void;
  onMerge: (targetId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [merging, setMerging] = useState(false);
  const candidates = conversations.filter(c =>
    c.id !== source.id &&
    c.status !== 'resolved' &&
    ((c.customContactName ?? c.contactName).toLowerCase().includes(search.toLowerCase()) ||
     (c.contactPhone && c.contactPhone.includes(search)))
  ).slice(0, 15);

  const handleMerge = async (targetId: string) => {
    setMerging(true);
    try { await onMerge(targetId); onClose(); }
    finally { setMerging(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-sm bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">Unificar conversa</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Mover mensagens de <span className="font-semibold text-gray-600 dark:text-gray-300">{source.customContactName ?? source.contactName}</span> para:</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-3.5 h-3.5" /></button>
        </div>
        <div className="p-3 space-y-2">
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou telefone..."
            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400" />
          <div className="max-h-64 overflow-y-auto space-y-1">
            {candidates.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-4">Nenhuma conversa encontrada</p>
            )}
            {candidates.map(c => {
              const cfg = CHANNEL_CONFIG[c.channel];
              return (
                <button key={c.id} onClick={() => handleMerge(c.id)} disabled={merging}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors text-left group">
                  <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0', cfg.avatarBg, cfg.textColor)}>
                    {getInitials(c.customContactName ?? c.contactName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate group-hover:text-red-600 dark:group-hover:text-red-400">{c.customContactName ?? c.contactName}</p>
                    <p className="text-[10px] text-gray-400 truncate">{c.lastMessage}</p>
                  </div>
                  <ChannelIcon channel={c.channel} size="sm" />
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-3 pb-3">
          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
            <p className="text-[10px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              As mensagens serão movidas para a conversa destino. A conversa atual será encerrada.
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Conversation Analytics Panel ────────────────────────────────────────────

function AnalyticsBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 dark:text-gray-400 truncate max-w-[70%]">{label}</span>
        <span className="font-semibold text-gray-800 dark:text-gray-200">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }}
          className="h-full rounded-full" style={{ backgroundColor: color }} />
      </div>
    </div>
  );
}

function ConversationAnalyticsPanel({ conversations, members, onClose }: {
  conversations: Conversation[];
  members: User[];
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<7 | 30 | 90>(30);

  const since = useMemo(() => Date.now() - period * 86_400_000, [period]);
  const inPeriod = useMemo(() => conversations.filter(c => new Date(c.createdAt).getTime() >= since), [conversations, since]);

  // KPIs
  const total = inPeriod.length;
  const resolved = inPeriod.filter(c => c.status === 'resolved').length;
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

  const avgFirstResponseMin = useMemo(() => {
    const withResponse = inPeriod.filter(c => c.firstResponseAt && c.createdAt);
    if (!withResponse.length) return null;
    const totalMin = withResponse.reduce((s, c) => s + (new Date(c.firstResponseAt!).getTime() - new Date(c.createdAt).getTime()) / 60_000, 0);
    return Math.round(totalMin / withResponse.length);
  }, [inPeriod]);

  // Volume by channel
  const byChannel = useMemo(() => {
    const map: Record<string, number> = {};
    inPeriod.forEach(c => { map[c.channel] = (map[c.channel] ?? 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [inPeriod]);

  // Volume by day (last 7 days)
  const byDay = useMemo(() => {
    const days: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const label = d.toLocaleDateString('pt-BR', { weekday: 'short' });
      const dayStr = d.toISOString().slice(0, 10);
      const count = conversations.filter(c => c.createdAt?.startsWith(dayStr)).length;
      days.push({ label, count });
    }
    return days;
  }, [conversations]);
  const maxDay = Math.max(...byDay.map(d => d.count), 1);

  // By agent
  const byAgent = useMemo(() => {
    const map: Record<string, { name: string; count: number; resolved: number }> = {};
    inPeriod.forEach(c => {
      if (!c.assignedTo) return;
      if (!map[c.assignedTo]) map[c.assignedTo] = { name: c.assignedToName ?? 'Desconhecido', count: 0, resolved: 0 };
      map[c.assignedTo].count++;
      if (c.status === 'resolved') map[c.assignedTo].resolved++;
    });
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count).slice(0, 5);
  }, [inPeriod]);
  const maxAgent = Math.max(...byAgent.map(([, v]) => v.count), 1);

  const CHANNEL_COLORS: Record<string, string> = { whatsapp: '#25D366', facebook: '#0866FF', instagram: '#E1306C' };

  return (
    <motion.div initial={{ opacity: 0, x: 320 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 320 }}
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className="fixed inset-y-0 right-0 w-full max-w-sm bg-white dark:bg-[#0a0e17] border-l border-gray-100 dark:border-white/[0.06] shadow-2xl z-40 flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="w-4 h-4 text-red-500" />
          <h2 className="font-display font-bold text-sm text-gray-900 dark:text-white">Analytics</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-white/[0.06] rounded-lg p-0.5">
            {([7, 30, 90] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={cn('px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all',
                  period === p ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-400')}>
                {p}d
              </button>
            ))}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: 'Total', value: total, icon: <MessageSquare className="w-4 h-4" />, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10' },
            { label: 'Resolvidas', value: resolved, icon: <CheckCircle className="w-4 h-4" />, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
            { label: 'Taxa resolução', value: `${resolutionRate}%`, icon: <TrendingUp className="w-4 h-4" />, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-500/10' },
            { label: 'Tempo 1ª resp.', value: avgFirstResponseMin != null ? `${avgFirstResponseMin}min` : '-', icon: <Timer className="w-4 h-4" />, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
          ].map(k => (
            <div key={k.label} className="p-3 rounded-xl bg-white dark:bg-white/[0.03] border border-gray-100 dark:border-gray-700/50">
              <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center mb-2', k.bg, k.color)}>{k.icon}</div>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">{k.label}</p>
              <p className={cn('text-lg font-bold', k.color)}>{k.value}</p>
            </div>
          ))}
        </div>

        {/* Volume últimos 7 dias */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Volume / dia (7d)</p>
          <div className="flex items-end gap-1.5 h-16">
            {byDay.map(({ label, count }) => (
              <div key={label} className="flex-1 flex flex-col items-center gap-1">
                <motion.div initial={{ height: 0 }} animate={{ height: `${(count / maxDay) * 52}px` }}
                  transition={{ duration: 0.5 }} className="w-full bg-red-500/70 dark:bg-red-400/60 rounded-t-sm min-h-[2px]" />
                <span className="text-[9px] text-gray-400">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Por canal */}
        {byChannel.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">Por canal</p>
            <div className="space-y-2">
              {byChannel.map(([ch, count]) => (
                <AnalyticsBar key={ch} label={ch.charAt(0).toUpperCase() + ch.slice(1)} value={count}
                  max={total} color={CHANNEL_COLORS[ch] ?? '#6B7280'} />
              ))}
            </div>
          </div>
        )}

        {/* Por agente */}
        {byAgent.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2.5">Por agente</p>
            <div className="space-y-2">
              {byAgent.map(([uid, { name, count, resolved: res }]) => (
                <div key={uid} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-400 truncate max-w-[60%]">{name}</span>
                    <span className="text-gray-400">{res}/{count} resolvidas</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${(count / maxAgent) * 100}%` }}
                      transition={{ duration: 0.5 }} className="h-full bg-violet-500/70 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {inPeriod.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-300 dark:text-gray-600">
            <BarChart3 size={32} strokeWidth={1.5} className="mb-2" />
            <p className="text-sm">Sem dados no período</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Smart Views ─────────────────────────────────────────────────────────────
//
// Substitui o filtro antigo "Aberta/Aguardando/Resolvida" (que respondia
// "qual o status do ticket?") por views acionáveis ("o que precisa de
// resposta agora?", "o que é meu?", "o que tá esquecido?"). Os campos
// status/lastMessageDirection/assignedTo/lastMessageAt/updatedAt já existem
// no doc — nenhum schema novo necessário.

export type SmartViewId =
  // ── Status (linha sempre visível no topo) ──
  | 'all'               // qualquer status (mantém soneca escondida)
  | 'all_open'          // status='open' — DEFAULT
  | 'waiting_client'    // status='waiting' (operador esperando o cliente)
  | 'all_resolved'      // status='resolved' (todas, sem corte temporal)
  // ── Ações (dropdown "Mais views") ──
  | 'awaiting_reply'    // open + último msg do cliente (precisa resposta)
  | 'mine'              // open + assignedTo == eu
  | 'unassigned'        // open + sem assignee
  | 'unread'            // unreadCount > 0 (qualquer status, exceto soneca)
  | 'stale'             // open + último msg do cliente + >1h sem resposta
  | 'resolved_today'    // status='resolved' fechado hoje
  | 'snoozed';          // soneca ativa (snoozedUntil > now)

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1h sem resposta vira "esquecida"

/**
 * True quando a conversa está em soneca ativa neste momento. Soneca é
 * "esconde-me até X" — operador disse "não agora" deliberadamente. Todas as
 * views (exceto 'snoozed') filtram com !isSnoozed pra respeitar isso.
 */
function isSnoozed(conv: Conversation, now: number): boolean {
  if (!conv.snoozedUntil) return false;
  const until = new Date(conv.snoozedUntil).getTime();
  return Number.isFinite(until) && until > now;
}

function matchesSmartView(
  conv: Conversation,
  view: SmartViewId,
  currentUserUid: string,
  now: number,
): boolean {
  // Soneca ativa: aparece SÓ na view 'snoozed', some das outras. Operador
  // já disse "ignore por enquanto" — não polui o radar.
  if (view !== 'snoozed' && isSnoozed(conv, now)) return false;

  switch (view) {
    case 'all':
      // "Todas" — qualquer status; soneca já filtrada acima. Equivale ao
      // antigo activeStatus='all' que mostrava o universo todo.
      return true;
    case 'awaiting_reply':
      return conv.status === 'open' && conv.lastMessageDirection === 'inbound';
    case 'mine':
      return conv.status === 'open' && conv.assignedTo === currentUserUid;
    case 'unassigned':
      return conv.status === 'open' && !conv.assignedTo;
    case 'unread':
      // Não lidas: qualquer status com unreadCount > 0. Soneca já foi
      // descartada pelo guard universal acima. Útil pra operador escanear
      // tudo que tem "bolinha" sem importar de quem é.
      return (conv.unreadCount ?? 0) > 0;
    case 'stale': {
      if (conv.status !== 'open' || conv.lastMessageDirection !== 'inbound') return false;
      const last = new Date(conv.lastMessageAt).getTime();
      if (!Number.isFinite(last)) return false;
      return now - last > STALE_THRESHOLD_MS;
    }
    case 'all_open':
      return conv.status === 'open';
    case 'waiting_client':
      return conv.status === 'waiting';
    case 'resolved_today': {
      if (conv.status !== 'resolved') return false;
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const updated = new Date(conv.updatedAt).getTime();
      return Number.isFinite(updated) && updated >= startOfDay.getTime();
    }
    case 'all_resolved':
      return conv.status === 'resolved';
    case 'snoozed':
      // Já filtrado acima — aqui chega só se tiver soneca ativa.
      return isSnoozed(conv, now);
  }
}

interface SmartViewDef {
  id: SmartViewId;
  label: string;
  /** Mostra ícone à esquerda do label no dropdown. Status pills usam só texto. */
  icon?: React.ReactNode;
}

/**
 * Mensagens de empty state customizadas por smart view ativa.
 * "Nenhuma aguardando resposta" e "Nenhuma esquecida" são sinais POSITIVOS —
 * o operador deve sentir conquista. "Sem dono" sendo zero também é bom (todo
 * ticket atribuído). Mensagens neutras são pra views de navegação. Sem isso,
 * todas as views vazias mostram o mesmo "Nenhuma conversa encontrada", que
 * confunde porque não diferencia conquista de busca infrutífera.
 */
const SMART_VIEW_EMPTY_STATE: Record<SmartViewId, { title: string; subtitle: string }> = {
  all:             { title: 'Sem conversas',                  subtitle: 'Nenhuma conversa registrada — conecte um canal para começar.' },
  all_open:        { title: 'Nenhuma conversa aberta',        subtitle: 'Todas estão resolvidas ou aguardando o cliente.' },
  waiting_client:  { title: 'Ninguém aguardando cliente',     subtitle: 'Nenhuma conversa marcada como "aguardando".' },
  all_resolved:    { title: 'Sem conversas resolvidas',       subtitle: 'Nenhuma conversa foi marcada como resolvida ainda.' },
  awaiting_reply:  { title: '🎉 Tudo respondido!',           subtitle: 'Nenhum cliente esperando resposta agora.' },
  mine:            { title: 'Nada atribuído a você',          subtitle: 'Você está zerado. Use "Sem dono" pra puxar conversas novas.' },
  unassigned:      { title: 'Tudo atribuído',                 subtitle: 'Todas as conversas abertas têm dono.' },
  unread:          { title: 'Tudo lido!',                     subtitle: 'Nenhuma conversa com mensagens não lidas.' },
  stale:           { title: 'Sem conversas esquecidas',       subtitle: 'Nenhuma resposta pendente há mais de 1h.' },
  resolved_today:  { title: 'Nenhuma resolvida hoje',         subtitle: 'O fechamento de tickets ainda não começou hoje.' },
  snoozed:         { title: 'Sem conversas em soneca',        subtitle: 'Use "Soneca" no menu de uma conversa pra silenciá-la temporariamente.' },
};

/**
 * Status pills sempre visíveis (linha única). Labels curtos (Abertas /
 * Aguardando / Resolvidas) pra caberem em sidebar estreita sem wrap —
 * descrição completa fica nos tooltips.
 */
const STATUS_VIEWS: { id: SmartViewId; label: string; title?: string }[] = [
  { id: 'all',            label: 'Todas',      title: 'Todas as conversas (qualquer status)' },
  { id: 'all_open',       label: 'Abertas',    title: 'Conversas abertas (em atendimento)' },
  { id: 'waiting_client', label: 'Aguardando', title: 'Aguardando o cliente' },
  { id: 'all_resolved',   label: 'Resolvidas', title: 'Conversas resolvidas (todas)' },
];

/**
 * Views acionáveis no dropdown "Mais views". São lentes complementares ao
 * status — quando uma é ativa, ela substitui a status pill (operador vê
 * exatamente uma view por vez).
 */
const ACTION_VIEWS: SmartViewDef[] = [
  { id: 'awaiting_reply', label: 'Aguardando resposta', icon: <Inbox size={13} /> },
  { id: 'unread',         label: 'Não lidas',           icon: <Mail size={13} /> },
  { id: 'mine',           label: 'Atribuídas a mim',    icon: <UserCheck size={13} /> },
  { id: 'unassigned',     label: 'Sem dono',            icon: <UserX size={13} /> },
  { id: 'stale',          label: 'Esquecidas (>1h)',    icon: <Clock size={13} /> },
  { id: 'snoozed',        label: 'Em soneca',           icon: <Moon size={13} /> },
  { id: 'resolved_today', label: 'Resolvidas hoje',     icon: <CheckCircle size={13} /> },
];

function SmartViewsBar({
  activeView,
  onViewChange,
  counts,
}: {
  activeView: SmartViewId;
  onViewChange: (id: SmartViewId) => void;
  counts: Record<SmartViewId, number>;
}) {
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const activeAction = ACTION_VIEWS.find(v => v.id === activeView);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Wheel-to-horizontal scroll — espelha o padrão de SettingsModule e
  // FinancialModule pras tabs do top. Operadores rolam a roda do mouse
  // sobre as pills e a barra desliza lateralmente em vez de rolar a página.
  // passive: false é obrigatório pra preventDefault funcionar.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    // Layout em 2 partes:
    //   1. Container das STATUS pills com overflow-x-auto + scrollbar-hide:
    //      pills rolam horizontal se não couberem, scrollbar invisível.
    //   2. Dropdown FORA do container de overflow — sem isso, o popover
    //      absoluto ficava clipado verticalmente (overflow-x-auto força
    //      overflow-y também, browser spec).
    <div className="px-3 pb-2 flex items-center gap-1">
      <div
        ref={scrollRef}
        className="flex items-center gap-1 flex-nowrap overflow-x-auto scrollbar-hide flex-1 min-w-0"
      >
        {STATUS_VIEWS.map(s => {
        const isActive = activeView === s.id;
        const count = counts[s.id] ?? 0;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onViewChange(s.id)}
            title={s.title}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold transition-all duration-150 whitespace-nowrap flex-shrink-0',
              isActive
                ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:text-gray-700 dark:hover:text-gray-300',
            )}
          >
            {s.label}
            <span className={cn(
              'text-[9px] min-w-[13px] h-[13px] rounded-full flex items-center justify-center px-0.5 tabular-nums',
              isActive
                ? 'bg-red-500/20 text-red-700 dark:text-red-300'
                : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500',
            )}>
              {count}
            </span>
          </button>
        );
      })}
      </div>

      {/* Dropdown "Mais views" — quando uma view de ação está ativa, o botão
          mostra o nome dela em vermelho (sinaliza estado ativo sem precisar
          abrir o dropdown pra descobrir qual). */}
      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setShowActionsMenu(v => !v)}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold transition-all duration-150 whitespace-nowrap',
            activeAction
              ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:text-gray-700 dark:hover:text-gray-300',
          )}
        >
          {activeAction ? activeAction.icon : <SlidersHorizontal size={10} />}
          {activeAction ? activeAction.label : 'Mais views'}
          {activeAction && (
            <span className="text-[9px] min-w-[13px] h-[13px] rounded-full flex items-center justify-center px-0.5 tabular-nums bg-red-500/20 text-red-700 dark:text-red-300">
              {counts[activeAction.id] ?? 0}
            </span>
          )}
          <ChevronDown size={10} className={cn('transition-transform', showActionsMenu && 'rotate-180')} />
        </button>
        <AnimatePresence>
          {showActionsMenu && (
            <>
              {/* Click-outside catcher */}
              <div className="fixed inset-0 z-30" onClick={() => setShowActionsMenu(false)} />
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.12 }}
                // right-0: popover abre alinhado à direita do botão e
                // expande pra esquerda (dentro do bar, onde tem espaço).
                // Inverso causaria off-screen em viewports estreitos.
                className="absolute right-0 top-full mt-1.5 z-40 min-w-[220px] rounded-xl bg-white dark:bg-[#1a2030] border border-gray-200 dark:border-white/[0.08] shadow-lg overflow-hidden"
              >
                {ACTION_VIEWS.map(v => {
                  const isActive = activeView === v.id;
                  const count = counts[v.id] ?? 0;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => { onViewChange(v.id); setShowActionsMenu(false); }}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                        isActive
                          ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04]',
                      )}
                    >
                      {v.icon}
                      <span className="flex-1 text-xs font-semibold">{v.label}</span>
                      <span className={cn(
                        'text-[10px] min-w-[16px] h-[16px] rounded-full flex items-center justify-center px-1 tabular-nums',
                        isActive
                          ? 'bg-red-500/20 text-red-700 dark:text-red-300'
                          : count > 0
                            ? 'bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-gray-400'
                            : 'bg-transparent text-gray-400 dark:text-gray-500',
                      )}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function ConversationListSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: i * 0.07 }}
          className="flex items-start gap-3 px-3 py-3"
        >
          <div className="w-10 h-10 rounded-full shimmer flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-28 rounded-lg shimmer" />
              <div className="h-3 w-10 rounded-lg shimmer" />
            </div>
            <div className="h-3 w-full rounded-lg shimmer" />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Link Contact Drawer ─────────────────────────────────────────────────────

const digits = (s: string | undefined | null) => (s || '').replace(/\D/g, '');

function scoreMatch(conv: Conversation, client: Client): number {
  // Higher = better. 0 means no signal, we don't show.
  let score = 0;
  const convPhone = digits(conv.contactPhone || conv.contactExternalId);
  if (convPhone) {
    if (digits(client.phone) === convPhone) score += 100;
    if (digits(client.whatsapp) === convPhone) score += 100;
    // Partial suffix (same last 8 digits handles +55 variance)
    if (convPhone.length >= 8) {
      const suf = convPhone.slice(-8);
      if (digits(client.phone).endsWith(suf)) score += 60;
      if (digits(client.whatsapp).endsWith(suf)) score += 60;
    }
  }
  const convName = ((conv.customContactName ?? conv.contactName) || '').toLowerCase().trim();
  const clientName = (client.name || '').toLowerCase().trim();
  if (convName && clientName) {
    if (clientName === convName) score += 40;
    else {
      const convTokens = convName.split(/\s+/).filter(Boolean);
      const clientTokens = clientName.split(/\s+/).filter(Boolean);
      for (const t of convTokens) {
        if (t.length >= 3 && clientTokens.includes(t)) score += 12;
      }
    }
  }
  return score;
}

function LinkContactDrawer({
  conversation,
  clients,
  businessId,
  onClose,
  onLinked,
}: {
  conversation: Conversation;
  clients: Client[];
  businessId: string;
  onClose: () => void;
  onLinked: (clientId: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const linkedClient = useMemo(
    () => conversation.crmContactId ? clients.find(c => c.id === conversation.crmContactId) : undefined,
    [conversation.crmContactId, clients],
  );

  // Suggestions: matches + general search
  const { suggestions, searchResults } = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      const filtered = clients
        .filter(c => c.id !== linkedClient?.id)
        .filter(c =>
          (c.name || '').toLowerCase().includes(q) ||
          digits(c.phone).includes(digits(q)) ||
          digits(c.whatsapp).includes(digits(q)) ||
          c.email?.toLowerCase().includes(q),
        )
        .slice(0, 10);
      return { suggestions: [], searchResults: filtered };
    }
    const scored = clients
      .filter(c => c.id !== linkedClient?.id)
      .map(c => ({ client: c, score: scoreMatch(conversation, c) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(s => s.client);
    return { suggestions: scored, searchResults: [] };
  }, [clients, search, conversation, linkedClient?.id]);

  const link = async (clientId: string | null) => {
    setLinkingId(clientId || '__unlink');
    try {
      const now = new Date().toISOString();
      // On unlink: clear lastConversationId on the previously linked client
      if (!clientId && conversation.crmContactId) {
        await updateDoc(doc(db, 'clients', conversation.crmContactId), {
          lastConversationId: null,
          lastConversationAt: null,
          updatedAt: now,
        }).catch(err => console.warn('[Conversations] Could not clear client lastConversationId:', err));
      }
      await updateDoc(doc(db, 'conversations', conversation.id), {
        crmContactId: clientId || null,
        updatedAt: now,
      });
      if (clientId) {
        // Mirror onto Client for future auto-link
        const client = clients.find(c => c.id === clientId);
        if (client) {
          const convExternal = digits(conversation.contactExternalId);
          const patch: Record<string, unknown> = {
            lastConversationId: conversation.id,
            lastConversationAt: now,
            updatedAt: now,
          };
          // Save the channel identity so future inbound messages auto-link
          if (convExternal) {
            const key = conversation.channel === 'whatsapp' ? 'channelIdentities.whatsapp'
              : conversation.channel === 'facebook' ? 'channelIdentities.facebook'
              : 'channelIdentities.instagram';
            patch[key] = convExternal;
          }
          if (conversation.contactAvatarUrl && !client.avatarUrl) {
            patch.avatarUrl = conversation.contactAvatarUrl;
          }
          await updateDoc(doc(db, 'clients', clientId), patch);
        }
      }
      onLinked(clientId);
    } catch (err) {
      console.error('[Conversations] Link failed:', err);
    } finally {
      setLinkingId(null);
    }
  };

  const quickCreate = async () => {
    setCreating(true);
    try {
      const now = new Date().toISOString();
      const phoneDigits = digits(conversation.contactPhone || conversation.contactExternalId);

      // Antes de criar: verifica se já existe cliente com mesmo telefone
      // (compara últimos 8 dígitos com DDD batendo — cobre variação BR de
      // 9º dígito e código do país). Sem isso, conversa criava Client novo
      // mesmo se o operador já tinha cadastrado o mesmo humano antes.
      if (phoneDigits) {
        const existing = clients.find(c => {
          const candidates = [c.phone, c.whatsapp].filter(Boolean) as string[];
          for (const cand of candidates) {
            const candDigits = digits(cand);
            if (!candDigits) continue;
            const candLast8 = candDigits.slice(-8);
            const newLast8 = phoneDigits.slice(-8);
            if (candLast8 && candLast8 === newLast8) {
              // Confere DDD bate (evita falso positivo entre cidades)
              const candDdd = candDigits.replace(/^55/, '').slice(0, 2);
              const newDdd = phoneDigits.replace(/^55/, '').slice(0, 2);
              if (candDdd === newDdd) return true;
            }
          }
          return false;
        });
        if (existing && !existing.mergedInto && !(existing as { deletedAt?: string }).deletedAt) {
          console.log('[Conversations] Quick-create: cliente existente encontrado, linkando em vez de criar:', existing.id);
          await link(existing.id);
          return;
        }
      }

      const payload: Record<string, unknown> = {
        businessId,
        name: (conversation.customContactName ?? conversation.contactName) || 'Novo contato',
        tipo: 'pf',
        source: conversation.channel,
        status: 'ganho',
        score: 0,
        isActive: true,
        totalSpent: 0,
        visitCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      if (phoneDigits) {
        if (conversation.channel === 'whatsapp') payload.whatsapp = phoneDigits;
        else payload.phone = phoneDigits;
        payload.channelIdentities = { [conversation.channel]: phoneDigits };
      }
      if (conversation.contactAvatarUrl) payload.avatarUrl = conversation.contactAvatarUrl;
      const { addDoc, collection } = await import('firebase/firestore');
      const ref = await addDoc(collection(db, 'clients'), payload);
      queryClient.invalidateQueries({ queryKey: ['clients', businessId] });
      await link(ref.id);
    } catch (err) {
      console.error('[Conversations] Quick-create failed:', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed top-0 right-0 bottom-0 z-40 w-full max-w-md bg-white dark:bg-[#0f172a] border-l border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col"
    >
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Vincular cliente</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            Associe este contato a um cliente cadastrado
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Already linked */}
        {linkedClient && (
          <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">
              Cliente vinculado
            </p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
                {linkedClient.avatarUrl ? (
                  <img src={linkedClient.avatarUrl} alt={linkedClient.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-white font-bold text-sm">
                    {(linkedClient.name?.[0] || '?').toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{linkedClient.name}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  {linkedClient.phone || linkedClient.whatsapp || linkedClient.email || 'Sem contato'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => link(null)}
                disabled={linkingId === '__unlink'}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-red-500 hover:border-red-300 disabled:opacity-50"
              >
                {linkingId === '__unlink' ? '...' : 'Desvincular'}
              </button>
            </div>
          </div>
        )}

        {/* Quick create — always offered unless already linked */}
        {!linkedClient && (
          <button
            type="button"
            onClick={quickCreate}
            disabled={creating}
            className="w-full group bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-500/10 dark:to-orange-500/5 border border-red-200 dark:border-red-500/30 rounded-xl p-4 text-left hover:shadow-md transition-all disabled:opacity-50"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-900 flex items-center justify-center shadow-sm flex-shrink-0">
                {creating ? <Loader2 className="w-5 h-5 animate-spin text-red-500" /> : <Plus className="w-5 h-5 text-red-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {creating ? 'Criando...' : 'Criar novo cliente'}
                </p>
                <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                  Cria <strong>{(conversation.customContactName ?? conversation.contactName) || 'este contato'}</strong>
                  {conversation.contactPhone && <> com telefone <strong>{conversation.contactPhone}</strong></>}
                  {' '}e vincula automaticamente.
                </p>
              </div>
            </div>
          </button>
        )}

        {/* Suggestions — exibido quando sem busca e sem cliente vinculado */}
        {!linkedClient && !search && suggestions.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
              Possíveis correspondências
            </p>
            <div className="space-y-1.5">
              {suggestions.map(c => (
                <ClientResultRow key={c.id} client={c} loading={linkingId === c.id}
                  onLink={() => link(c.id)} highlighted />
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, telefone ou e-mail..."
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
              autoFocus
            />
          </div>
          {search && (
            <div className="mt-2 space-y-1">
              {searchResults.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-6">Nenhum cliente encontrado</p>
              ) : (
                searchResults.map(c => (
                  <ClientResultRow key={c.id} client={c} loading={linkingId === c.id}
                    onLink={() => link(c.id)} />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ClientResultRow({
  client, loading, highlighted, onLink,
}: {
  client: Client;
  loading: boolean;
  highlighted?: boolean;
  onLink: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onLink}
      disabled={loading}
      className={cn(
        'w-full text-left p-2.5 rounded-xl border transition-all flex items-center gap-3 hover:shadow-sm disabled:opacity-50',
        highlighted
          ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-red-300',
      )}
    >
      <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0">
        {client.avatarUrl ? (
          <img src={client.avatarUrl} alt={client.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white font-bold text-xs">
            {(client.name?.[0] || '?').toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{client.name}</p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
          {client.phone || client.whatsapp || client.email || '—'}
        </p>
      </div>
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin text-red-500 flex-shrink-0" />
        : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
    </button>
  );
}

// ─── Agent Debug Drawer ──────────────────────────────────────────────────────

const RUN_STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  success: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-400', label: 'Sucesso' },
  error:   { bg: 'bg-red-100 dark:bg-red-500/20',         text: 'text-red-700 dark:text-red-400',         label: 'Erro' },
  running: { bg: 'bg-amber-100 dark:bg-amber-500/20',     text: 'text-amber-700 dark:text-amber-400',     label: 'Executando' },
  skipped: { bg: 'bg-gray-100 dark:bg-gray-700',          text: 'text-gray-600 dark:text-gray-300',       label: 'Pulado' },
};

function AgentDebugDrawer({
  businessId,
  conversationId,
  onClose,
}: {
  businessId: string;
  conversationId: string;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId || !conversationId) return;
    setLoading(true);
    // Bug anterior: o `return () => unsub()` ficava DENTRO do .then(), o que
    // significa que o useEffect síncrono não retornava cleanup function.
    // Listener acumulava a cada abertura do painel. Captura `unsub` em escopo
    // externo via let; a cleanup retornada AGORA é do useEffect.
    let unsub: (() => void) | null = null;
    let cancelled = false;
    import('firebase/firestore').then(({ collection, query, where, orderBy, limit, onSnapshot }) => {
      if (cancelled) return; // se desmontou antes do import resolver
      const q = query(
        collection(db, 'agentRuns'),
        where('businessId', '==', businessId),
        where('conversationId', '==', conversationId),
        orderBy('createdAt', 'desc'),
        limit(10),
      );
      unsub = onSnapshot(q,
        (snap) => {
          setRuns(snap.docs.map(d => ({ ...(d.data() as AgentRun), id: d.id })));
          setLoading(false);
        },
        () => setLoading(false),
      );
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [businessId, conversationId]);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed top-0 right-0 bottom-0 z-40 w-full max-w-md bg-white dark:bg-[#0f172a] border-l border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col"
    >
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-500/10 dark:to-purple-500/5">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-violet-500" />
            Execuções do Agente IA
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            Últimas 10 runs desta conversa
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/70 dark:hover:bg-black/20 text-gray-500">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl shimmer" />)}
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-10">
            <Bot className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma execução ainda</p>
            <p className="text-xs text-gray-400 mt-1">Runs aparecem aqui em tempo real</p>
          </div>
        ) : (
          runs.map(run => {
            const cfg = RUN_STATUS_CONFIG[run.status || 'success'] || RUN_STATUS_CONFIG.success;
            const isExpanded = expandedId === run.id;
            return (
              <motion.div
                key={run.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : run.id)}
                  className="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', cfg.bg, cfg.text)}>
                      {cfg.label}
                    </span>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                      {run.intent && <span className="px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 font-semibold uppercase">{run.intent}</span>}
                      <span>{run.totalLatencyMs}ms</span>
                      <span>·</span>
                      <span>${run.costUsd?.toFixed(4) || '0.0000'}</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-700 dark:text-gray-300 font-medium truncate">
                    <span className="text-gray-400">↳</span> {run.userMessage}
                  </p>
                  {run.finalResponse && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                      <span className="text-emerald-500">→</span> {run.finalResponse}
                    </p>
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 p-3 space-y-3">
                    {/* Node trace */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Pipeline</p>
                      <div className="flex items-center gap-1 flex-wrap">
                        {(run.nodes || []).map((n, i) => (
                          <div key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[10px]">
                            <span className="font-semibold text-violet-600 dark:text-violet-400">{n.node}</span>
                            <span className="text-gray-400">{n.latencyMs}ms</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Tool calls */}
                    {run.tools && run.tools.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">Ferramentas chamadas</p>
                        <div className="space-y-1">
                          {run.tools.map((t, i) => (
                            <div key={i} className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-mono font-semibold text-gray-900 dark:text-gray-100">{t.name}</span>
                                <span className="text-[9px] text-gray-400">{t.latencyMs}ms</span>
                              </div>
                              {t.error ? (
                                <p className="text-[10px] text-red-500 mt-1">{t.error}</p>
                              ) : (
                                <pre className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 overflow-x-auto whitespace-pre-wrap max-h-24">
                                  {JSON.stringify(t.arguments, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Token stats */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                        <p className="text-[10px] text-gray-400">Tokens in</p>
                        <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{run.totalTokensIn || 0}</p>
                      </div>
                      <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                        <p className="text-[10px] text-gray-400">Tokens out</p>
                        <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{run.totalTokensOut || 0}</p>
                      </div>
                      <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                        <p className="text-[10px] text-gray-400">Iter.</p>
                        <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{run.iterations || 0}</p>
                      </div>
                    </div>
                    {run.errorMessage && (
                      <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg p-2 text-[11px] text-red-700 dark:text-red-400">
                        {run.errorMessage}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConversasModule() {
  const { t } = useTranslation();
  const { user, business, sectors, userSectorIds, firebaseUser } = useAuth();
  const {
    setActivePage,
    pendingOpenConversationId,
    setPendingOpenConversationId,
    pendingNewConversation,
    setPendingNewConversation,
  } = useAppContext();

  const isPedidosMode = business?.settings?.useCase === 'pedidos';
  const aiAgentEnabled = !!business?.settings?.aiAgent?.enabled;

  // ── SLA config ────────────────────────────────────────────────────────────
  const [slaConfig, setSLAConfig] = useState<ConvSLAConfig>(
    business?.settings?.conversationSLA ?? SLA_DEFAULT_CONFIG
  );
  useEffect(() => { setSLAConfig(business?.settings?.conversationSLA ?? SLA_DEFAULT_CONFIG); }, [business?.settings?.conversationSLA]);
  const [showSLASettings, setShowSLASettings] = useState(false);
  const [showCSATDashboard, setShowCSATDashboard] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showRoutingRules, setShowRoutingRules] = useState(false);
  const [showHeaderMore, setShowHeaderMore] = useState(false);
  const headerMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showHeaderMore) return;
    const handler = (e: MouseEvent) => {
      if (headerMoreRef.current && !headerMoreRef.current.contains(e.target as Node)) {
        setShowHeaderMore(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHeaderMore]);
  const [showAssignHistory, setShowAssignHistory] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showTransferChannelDialog, setShowTransferChannelDialog] = useState(false);
  const [showNewConversation, setShowNewConversation] = useState(false);
  // Prefill consumido do AppContext.pendingNewConversation — ChannelsTab do
  // detalhe do cliente seta isso ao clicar "Iniciar conversa" no card de WA.
  // null = dialog abriu sem prefill (botão genérico "+" no header).
  const [newConvPrefill, setNewConvPrefill] = useState<{
    client: Client;
    channel: 'whatsapp' | 'facebook' | 'instagram';
    whatsappMode?: 'cloud' | 'baileys';
  } | null>(null);
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>(business?.settings?.routingRules ?? []);
  useEffect(() => { setRoutingRules(business?.settings?.routingRules ?? []); }, [business?.settings?.routingRules]);
  const csatEnabled = !!business?.settings?.csatEnabled;
  const [members, setMembers] = useState<User[]>([]);
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'users'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, snap => setMembers(snap.docs.map(d => ({ ...d.data(), id: d.id } as User))));
    return () => unsub();
  }, [business?.id]);

  // Tick every 30s to refresh SLA countdowns without re-fetching data
  const [slaTick, setSLATick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSLATick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const notifiedBreachIdsRef = useRef<Set<string>>(new Set());
  const [agentDebugOpen, setAgentDebugOpen] = useState(false);
  const [linkContactOpen, setLinkContactOpen] = useState(false);
  const [clientsList, setClientsList] = useState<Client[]>([]);
  const [clientsLoadError, setClientsLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'clients'), where('businessId', '==', business.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setClientsList(snap.docs.map(d => ({ ...(d.data() as Client), id: d.id })));
        setClientsLoadError(null);
      },
      (err) => {
        // Antes não havia error handler — falhas (rules, index ausente) eram
        // silenciosas e clientsList ficava vazio sem o user saber por quê.
        console.error('[Conversations] Failed to load clients:', err);
        setClientsLoadError(err.message || 'Erro ao carregar clientes');
      },
    );
    return () => unsub();
  }, [business?.id]);

  const handleToggleAi = useCallback(async (conv: Conversation) => {
    if (!business?.id) return;
    const nextValue = conv.aiEnabled === false ? true : false;
    try {
      await updateDoc(doc(db, 'conversations', conv.id), {
        aiEnabled: nextValue,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Conversations] Toggle AI failed:', err);
    }
  }, [business?.id]);

  const handleGoToAgentSettings = useCallback(() => {
    setActivePage('Configurações');
  }, [setActivePage]);

  const [deleteConfirmConv, setDeleteConfirmConv] = useState<Conversation | null>(null);

  const handleDeleteConversation = useCallback((conv: Conversation) => {
    setDeleteConfirmConv(conv);
  }, []);

  const executeDeleteConversation = useCallback(async () => {
    if (!deleteConfirmConv || !business?.id) return;
    try {
      // Zerar unreadCount junto com soft-delete: defesa em profundidade contra
      // badge fantasma no sidebar. O Sidebar já filtra isDeleted, mas se essa
      // checagem falhar no futuro (ex: refactor que remove o filtro), o doc
      // residual no Firestore não deveria poder inflar contadores. Custo zero.
      await updateDoc(doc(db, 'conversations', deleteConfirmConv.id), {
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        unreadCount: 0,
        updatedAt: new Date().toISOString(),
      });
      setSelectedConversation(null);
      setShowMobileThread(false);
      setDeleteConfirmConv(null);
    } catch (err) {
      console.error('[Conversations] Delete failed:', err);
      toast.error('Erro ao excluir conversa. Tente novamente.');
      setDeleteConfirmConv(null);
    }
  }, [deleteConfirmConv, business?.id]);

  const handleMarkUnread = useCallback(async (conv: Conversation) => {
    if (!business?.id) return;
    try {
      await updateDoc(doc(db, 'conversations', conv.id), {
        unreadCount: Math.max(1, conv.unreadCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Conversations] Mark unread failed:', err);
    }
  }, [business?.id]);

  const handleSnooze = useCallback(async (conv: Conversation, untilIso: string) => {
    if (!business?.id || !user) return;
    try {
      await updateDoc(doc(db, 'conversations', conv.id), {
        snoozedUntil: untilIso,
        snoozedBy: user.uid,
        snoozedByName: user.name,
        updatedAt: new Date().toISOString(),
      });
      const until = new Date(untilIso);
      toast.success(`Conversa em soneca até ${until.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`);
    } catch (err) {
      console.error('[Conversations] Snooze failed:', err);
      toast.error('Falha ao silenciar conversa.');
    }
  }, [business?.id, user]);

  const handleUnsnooze = useCallback(async (conv: Conversation) => {
    if (!business?.id) return;
    try {
      // Limpa os 3 campos de soneca. deleteField evita deixar a chave com
      // valor stale; updatedAt move o item pro topo da lista (operador acabou
      // de tomar uma ação, conversa volta a ser relevante).
      const { deleteField } = await import('firebase/firestore');
      await updateDoc(doc(db, 'conversations', conv.id), {
        snoozedUntil: deleteField(),
        snoozedBy: deleteField(),
        snoozedByName: deleteField(),
        updatedAt: new Date().toISOString(),
      });
      toast.success('Conversa retomada.');
    } catch (err) {
      console.error('[Conversations] Unsnooze failed:', err);
      toast.error('Falha ao tirar conversa da soneca.');
    }
  }, [business?.id]);

  const handleOpenContact = useCallback((conv: Conversation) => {
    // Se conversa está vinculada a um cliente CRM, marca o ID em sessionStorage
    // para que ClientsModule abra o detalhe ao montar. Sem vínculo, redireciona
    // para Clientes mostrando toast com instrução pra vincular antes.
    if (conv.crmContactId) {
      try {
        sessionStorage.setItem('aevo:preselectClientId', conv.crmContactId);
      } catch { /* sessionStorage indisponível — degradação graciosa */ }
      setActivePage('Clientes');
    } else {
      toast.info('Este contato ainda não está vinculado a um cliente. Use "Vincular cliente" no header.');
    }
  }, [setActivePage]);

  const handleExportHistory = useCallback(async (conv: Conversation) => {
    try {
      const { getDocs: gd, query: q, collection: col, where: wh, orderBy: ob } = await import('firebase/firestore');
      const snap = await gd(q(col(db, 'conversationMessages'), wh('conversationId', '==', conv.id), ob('sentAt', 'asc')));
      const msgs = snap.docs.map(d => d.data());

      // Generate PDF with jsPDF
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const margin = 14;
      let y = 20;

      // Header
      pdf.setFontSize(16); pdf.setFont('helvetica', 'bold');
      const pdfDisplayName = conv.customContactName ?? conv.contactName;
      pdf.text(`Conversa: ${pdfDisplayName}`, margin, y); y += 8;
      pdf.setFontSize(9); pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(120);
      pdf.text(`Canal: ${conv.channel} · Exportado em: ${new Date().toLocaleString('pt-BR')} · Status: ${conv.status}`, margin, y); y += 6;
      pdf.setDrawColor(220); pdf.line(margin, y, pageW - margin, y); y += 6;
      pdf.setTextColor(0);

      for (const m of msgs) {
        if (m.isInternal) continue; // Skip internal notes
        const time = m.sentAt ? new Date(m.sentAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const who = m.direction === 'inbound' ? pdfDisplayName : (m.senderName || 'Equipe');
        const text = typeof m.content === 'string' ? m.content : '[mídia]';

        // Check page break
        if (y > 270) { pdf.addPage(); y = 20; }

        pdf.setFontSize(8); pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(m.direction === 'outbound' ? 60 : 0);
        pdf.text(`${who}  `, margin, y);
        pdf.setFont('helvetica', 'normal'); pdf.setTextColor(150);
        pdf.text(time, margin + pdf.getTextWidth(`${who}  `), y);
        y += 4.5;

        pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(40);
        const lines = pdf.splitTextToSize(text, pageW - margin * 2 - 4);
        for (const line of lines) {
          if (y > 272) { pdf.addPage(); y = 20; }
          pdf.text(line, margin + 2, y);
          y += 4.5;
        }
        y += 1.5;
      }

      pdf.save(`conversa-${pdfDisplayName.replace(/\s+/g, '_')}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success('PDF exportado!');
    } catch (err) {
      console.error('[Conversations] Export failed:', err);
      toast.error('Erro ao exportar');
    }
  }, []);

  const handleCreateOrderFromConversation = useCallback((conv: Conversation) => {
    // Stash prefill for OrdersModule to pick up on mount.
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('pendingOrderPrefill', JSON.stringify({
        clientId: conv.crmContactId || '',
        clientName: conv.customContactName ?? conv.contactName,
        clientPhone: conv.contactPhone || '',
        channel: conv.channel,
        conversationId: conv.id,
        contactExternalId: conv.contactExternalId || '',
      }));
    }
    setActivePage('Pedidos');
  }, [setActivePage]);

  /**
   * Tab de canal expandida pra distinguir transporte WhatsApp:
   *   - 'all', 'whatsapp', 'facebook', 'instagram' — comportamento padrão
   *   - 'whatsapp_cloud'   → só conversas WhatsApp via Cloud API (Meta oficial)
   *   - 'whatsapp_baileys' → só conversas WhatsApp via Baileys (Web)
   * O split em Cloud/Baileys aparece automaticamente quando o business tem
   * conversas dos dois transportes; senão fica só "WhatsApp" pra evitar ruído.
   */
  type ChannelTabId = ConversationChannel | 'all' | 'whatsapp_cloud' | 'whatsapp_baileys';
  const [activeChannel, setActiveChannel] = useState<ChannelTabId>('all');
  // Smart view. Default 'all_open' = "Todas abertas" — preserva mental model
  // do filtro antigo (Aberta/Aguardando/Resolvida) que operadores estavam
  // acostumados. Views acionáveis (awaiting_reply / mine / etc) ficam em
  // dropdown "Mais views" pra liberar espaço vertical.
  const [activeView, setActiveView] = useState<SmartViewId>('all_open');
  // Ordenação client-side. 'recent' (default) preserva o comportamento antigo
  // — Firestore já vem ordenado por lastMessageAt desc. As outras opções fazem
  // re-sort em memória sobre o array já filtrado.
  type SortMode = 'recent' | 'oldest' | 'priority';
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [activeSectorFilter, setActiveSectorFilter] = useState<string | 'all'>('all');
  // Phase 2: filtro por escopo de canal — 'all' (sem filtro), 'business'
  // (só conversas de canal-empresa), 'mine' (só conversas em canais
  // pessoais do operador atual).
  const [activeChannelScope, setActiveChannelScope] = useState<'all' | 'business' | 'mine'>('all');
  const [channelConnections, setChannelConnections] = useState<import('@/lib/types').ChannelConnection[]>([]);
  const [advFilters, setAdvFilters] = useState<AdvancedFilters>(EMPTY_ADV_FILTERS);
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  const [savedViews, setSavedViews] = useState<ConversationView[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchAssign, setShowBatchAssign] = useState(false);
  const [showBatchTag, setShowBatchTag] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);
  // editingView !== null → modal está em modo "Editar". O save handler do
  // modal recebe (name, emoji); o handler do parent decide se cria novo doc
  // (se editingView for null) ou atualiza o existente (id de editingView).
  const [editingView, setEditingView] = useState<ConversationView | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // messageInput removido: vive agora dentro do Composer (perf — antes
  // cada keystroke causava re-render do módulo inteiro). Pai lê/escreve
  // via composerRef.
  const composerRef = useRef<ComposerHandle | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileThread, setShowMobileThread] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [templateList, setTemplateList] = useState<Array<{ name: string; language: string; category: string; preview: string; hasVariables: boolean }>>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);

  // Internal notes mode
  const [isInternalNote, setIsInternalNote] = useState(false);

  // Quick replies / snippets
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [showSnippets, setShowSnippets] = useState(false);
  const [snippetSearch, setSnippetSearch] = useState('');
  // Modo "criar atalho rápido" inline no popup — operador pode criar uma
  // resposta sem sair de Conversas. Quando true, popup mostra form curto
  // (atalho + mensagem) em vez da lista. Permissão = manager+.
  const [snippetCreateMode, setSnippetCreateMode] = useState(false);
  const [snippetDraftContent, setSnippetDraftContent] = useState('');
  const [snippetSaving, setSnippetSaving] = useState(false);
  // Ref pro outside-click handler — fechar popup ao clicar fora dele.
  const snippetsPopupRef = useRef<HTMLDivElement>(null);

  // Sector assignment
  const [showSectorAssign, setShowSectorAssign] = useState(false);

  // Real-time data from Firestore
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [oldestMessageTimestamp, setOldestMessageTimestamp] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingOlderRef = useRef(false);
  // inputRef removido — Composer agora gerencia sua própria textarea internamente
  // e expõe focus()/setText()/getText() via composerRef (ComposerHandle).
  // Ref pra barra de tabs de canal (Todos / WA Oficial / WA Web / Messenger /
  // Instagram). Sem scroll-wheel handler, o operador só conseguia scroll
  // horizontal via shift+wheel ou trackpad — quebrava o comentário
  // existente que prometia "funcional via mouse-wheel".
  const channelTabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = channelTabsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const isAdmin = ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY['admin'];

  // ── SLA breach notifications ───────────────────────────────────────────────
  useEffect(() => {
    if (!slaConfig.enabled) return;
    for (const conv of conversations) {
      const info = getSLAInfo(conv, slaConfig);
      if (info?.status === 'breached' && !notifiedBreachIdsRef.current.has(conv.id)) {
        notifiedBreachIdsRef.current.add(conv.id);
        toast.warn(`⏱ SLA vencido: ${conv.customContactName ?? conv.contactName}`, { toastId: `sla-${conv.id}`, autoClose: 8000 });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, slaTick, slaConfig.enabled]);

  // ── Routing rules engine ─────────────────────────────────────────────────
  const appliedRoutingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!business?.id || !routingRules.length) return;
    const enabled = routingRules.filter(r => r.enabled).sort((a, b) => a.order - b.order);
    for (const conv of conversations) {
      if (conv.assignedTo || conv.status === 'resolved' || appliedRoutingRef.current.has(conv.id)) continue;
      for (const rule of enabled) {
        const { conditions, action } = rule;
        if (conditions.channel && conv.channel !== conditions.channel) continue;
        if (conditions.keyword && !conv.lastMessage.toLowerCase().includes(conditions.keyword.toLowerCase())) continue;
        if (conditions.priority && conv.priority !== conditions.priority) continue;
        appliedRoutingRef.current.add(conv.id);
        const now = new Date().toISOString();
        if (action.type === 'assign_sector' && action.sectorId) {
          const historyEntry = {
            assignedToSectorId: action.sectorId,
            sectorName: action.sectorName ?? action.sectorId,
            changedBy: 'routing',
            changedByName: 'Roteamento automático',
            changedAt: now,
          };
          updateDoc(doc(db, 'conversations', conv.id), {
            assignedToSectorId: action.sectorId,
            sectorIds: [action.sectorId],
            assignmentHistory: arrayUnion(historyEntry),
            updatedAt: now,
          }).catch(console.error);
          const sectorData = sectors.find(s => s.id === action.sectorId);
          const memberIds = sectorData?.memberIds ?? [];
          if (memberIds.length > 0 && business?.id) {
            notifyUsers(db, memberIds, {
              businessId: business.id,
              type: 'conversation_assigned',
              title: 'Conversa atribuída ao seu setor',
              body: `Roteamento automático atribuiu uma conversa ao setor ${action.sectorName ?? action.sectorId}`,
              link: 'Conversas',
              relatedId: conv.id,
              actorId: 'routing',
              actorName: 'Roteamento automático',
            }).catch(console.error);
          }
        } else if (action.type === 'assign_user' && action.userId) {
          const historyEntry = {
            assignedTo: action.userId,
            assignedToName: action.userName,
            changedBy: 'routing',
            changedByName: 'Roteamento automático',
            changedAt: now,
          };
          updateDoc(doc(db, 'conversations', conv.id), {
            assignedTo: action.userId,
            assignedToName: action.userName,
            assignmentHistory: arrayUnion(historyEntry),
            updatedAt: now,
          }).catch(console.error);
          if (business?.id) {
            notifyUsers(db, [action.userId], {
              businessId: business.id,
              type: 'conversation_assigned',
              title: 'Conversa atribuída',
              body: `Roteamento automático atribuiu uma conversa a você`,
              link: 'Conversas',
              relatedId: conv.id,
              actorId: 'routing',
              actorName: 'Roteamento automático',
            }).catch(console.error);
          }
        } else if (action.type === 'set_priority' && action.priority) {
          updateDoc(doc(db, 'conversations', conv.id), { priority: action.priority, updatedAt: now }).catch(console.error);
        }
        break; // First matching rule wins
      }
    }
  }, [conversations, routingRules, business, sectors]);

  // ── Cross-module intents (do AppContext) ───────────────────────────────────
  // ChannelsTab do detalhe do cliente seta intents pra abrir conversa específica
  // ou iniciar nova com pré-fill. Consumimos one-shot e limpamos o pending pra
  // não re-disparar em re-renders.

  // Abrir conversa existente quando o ID chega via pending. Aguarda a lista
  // carregar (find retorna match) — se não está na lista (filtrada por ownership
  // ou ainda hidratando), o effect re-roda quando `conversations` atualiza.
  // Timeout de 5s evita pending pendurado pra sempre se a conversa for
  // invisível pro user (ex: filtrada por ownership de canal pessoal).
  useEffect(() => {
    if (!pendingOpenConversationId) return;
    const conv = conversations.find(c => c.id === pendingOpenConversationId);
    if (conv) {
      setSelectedConversation(conv);
      setShowMobileThread(true);
      setPendingOpenConversationId(null);
      return;
    }
    // Não achou ainda — agenda cleanup defensivo.
    const t = setTimeout(() => {
      toast.warn('Conversa não encontrada. Pode ter sido deletada ou pertencer a outro canal.');
      setPendingOpenConversationId(null);
    }, 5000);
    return () => clearTimeout(t);
  }, [pendingOpenConversationId, conversations, setPendingOpenConversationId]);

  // Iniciar conversa nova com pré-fill — abre NewConversationDialog populado
  // com client/channel/modo. clientsList precisa ter carregado pra resolver
  // o client por ID. Timeout 5s pra liberar pending caso o cliente esteja
  // filtrado por sector/visibility e nunca apareça em clientsList.
  useEffect(() => {
    if (!pendingNewConversation) return;
    const client = clientsList.find(c => c.id === pendingNewConversation.clientId);
    if (client) {
      setNewConvPrefill({
        client,
        channel: pendingNewConversation.channel,
        whatsappMode: pendingNewConversation.whatsappMode,
      });
      setShowNewConversation(true);
      setPendingNewConversation(null);
      return;
    }
    const t = setTimeout(() => {
      toast.warn('Cliente não encontrado na sua visualização. Verifique se está em um setor que você acessa.');
      setPendingNewConversation(null);
    }, 5000);
    return () => clearTimeout(t);
  }, [pendingNewConversation, clientsList, setPendingNewConversation]);

  // ── Real-time: Conversations list ──────────────────────────────────────────

  useEffect(() => {
    if (!business?.id) return;
    if (!user?.uid) return;

    setIsLoadingConversations(true);

    // Timeout de segurança: se o snapshot não responder em 12s, libera o loading
    // (evita tela branca infinita em falha de rede ou permissão)
    const loadingTimeout = setTimeout(() => {
      setIsLoadingConversations(false);
    }, 12_000);

    // Isolamento server-side de canais pessoais (ownerType='user'):
    //   - Admin/Founder vê tudo (rules + query irrestrita).
    //   - Operador/Manager vê: canais 'business' + canais 'user' que ele é dono.
    // O `or()` aqui combina (channelOwnerType=='business' || channelOwnerId==me).
    // Conversas legadas sem channelOwnerType denormalizado NÃO casam com nenhuma
    // das branches — por isso depende do backfill (`backfill-conversation-ownership`)
    // ter rodado antes do deploy desta versão. Até lá, conversas legadas ficam
    // invisíveis pra non-admin (efeito conservador, não vaza nada).
    const q = isAdmin
      ? query(
          collection(db, 'conversations'),
          where('businessId', '==', business.id),
          orderBy('lastMessageAt', 'desc'),
        )
      : query(
          collection(db, 'conversations'),
          // Firestore v10+: composite OR exige and() wrapper quando combinado
          // com outros where(). Senão TS reclama (QueryCompositeFilterConstraint
          // ≠ QueryConstraint) e runtime rejeita a query.
          and(
            where('businessId', '==', business.id),
            or(
              where('channelOwnerType', '==', 'business'),
              where('channelOwnerId', '==', user.uid),
            ),
          ),
          orderBy('lastMessageAt', 'desc'),
        );

    let unsub: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;

    const subscribe = () => {
      unsub = onSnapshot(q, (snap) => {
        clearTimeout(loadingTimeout);
        retryCount = 0; // reset on success
        const data = snap.docs
          .map((d) => ({ ...d.data(), id: d.id } as Conversation & { isDeleted?: boolean }))
          .filter((c) => !c.isDeleted);
        setConversations(data);
        setIsLoadingConversations(false);

        setSelectedConversation((prev) => {
          if (!prev) return prev;
          const updated = data.find((c) => c.id === prev.id);
          return updated || prev;
        });
      }, (err) => {
        clearTimeout(loadingTimeout);
        console.error('[Conversations] onSnapshot error:', err);
        setIsLoadingConversations(false);
        // Reinicia o listener automaticamente — erros transitórios (índice ainda
        // construindo, rede instável) matam o listener; retry garante que ele
        // volte assim que o problema resolver.
        const delay = Math.min(3000 * Math.pow(2, retryCount), 30_000);
        retryCount++;
        retryTimer = setTimeout(subscribe, delay);
      });
    };

    subscribe();

    return () => {
      clearTimeout(loadingTimeout);
      if (retryTimer) clearTimeout(retryTimer);
      unsub?.();
    };
  }, [business?.id, user?.uid, isAdmin]);

  // ── Load channel connections (Phase 2: badges + filter) ───────────────────
  // Fetch via API pra usar a sanitização (sem tokens) + filtragem por role
  // (operator vê só business + suas próprias 'user'; admin vê tudo).
  useEffect(() => {
    if (!business?.id || !firebaseUser) return;
    let cancelled = false;
    const load = async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch(`/api/channels/connections?businessId=${encodeURIComponent(business.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setChannelConnections((data.connections || []) as import('@/lib/types').ChannelConnection[]);
      } catch (err) {
        console.warn('[Conversations] Failed to load channelConnections:', err);
      }
    };
    void load();
    // Refetch a cada 30s pra capturar conexões adicionadas via Settings
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [business?.id, firebaseUser]);

  // Map: connectionId → connection (pra lookup rápido em ConversationItem)
  const connectionsById = useMemo(() => {
    const m = new Map<string, import('@/lib/types').ChannelConnection>();
    for (const c of channelConnections) m.set(c.id, c);
    return m;
  }, [channelConnections]);

  // Set: IDs de connections que pertencem ao operador atual (pro filtro 'mine')
  const myConnectionIds = useMemo(() => {
    const s = new Set<string>();
    if (!user?.uid) return s;
    for (const c of channelConnections) {
      if (c.ownerType === 'user' && c.ownerId === user.uid) s.add(c.id);
    }
    return s;
  }, [channelConnections, user?.uid]);

  // ── Load snippets ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!business?.id) return;
    const q = query(
      collection(db, 'snippets'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      setSnippets(snap.docs.map((d) => ({ ...d.data(), id: d.id } as Snippet)));
    });
    return () => unsub();
  }, [business?.id]);

  // ── Load saved views ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!business?.id) return;
    // Single-field query — sort client-side por createdAt asc (evita
    // composite index conversationViews/businessId+createdAt).
    const q = query(collection(db, 'conversationViews'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs
        .map(d => ({ ...d.data(), id: d.id } as ConversationView))
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      setSavedViews(list);
    });
    return () => unsub();
  }, [business?.id]);

  const handleSaveView = async (name: string, emoji: string) => {
    if (!business?.id || !user) return;
    // Salva a smart view atual em `filters.smartView` (nova). Mantém também
    // `filters.status` para views mapeáveis 1:1 (all_open/waiting_client/
    // resolved_today) — assim views novas continuam legíveis pra qualquer
    // código legado que ainda olhe pelo campo antigo.
    const statusFromView: ConversationStatus | undefined =
      activeView === 'all_open'        ? 'open' :
      activeView === 'waiting_client'  ? 'waiting' :
      activeView === 'resolved_today'  ? 'resolved' :
      activeView === 'all_resolved'    ? 'resolved' :
      undefined;
    const filters = {
      channel: activeChannel !== 'all' ? activeChannel : undefined,
      smartView: activeView,
      status: statusFromView,
      sectorId: activeSectorFilter !== 'all' ? activeSectorFilter : undefined,
      assignedTo: advFilters.assignedTo || undefined,
      priority: advFilters.priority || undefined,
      label: advFilters.label || undefined,
      slaStatus: advFilters.slaStatus || undefined,
      unreadOnly: advFilters.unreadOnly || undefined,
    };
    // Edição: sobrescreve nome/emoji/filtros do doc existente. Filtros
    // refletem o snapshot atual da UI — comportamento ergonômico esperado
    // ("editei minha view com a config atual"). Operador que abriu o edit
    // sem mudar filtros vê só nome/emoji mudarem.
    if (editingView) {
      await updateDoc(doc(db, 'conversationViews', editingView.id), {
        name, emoji, filters,
        updatedAt: new Date().toISOString(),
      });
      setEditingView(null);
      return;
    }
    await addDoc(collection(db, 'conversationViews'), {
      businessId: business.id, name, emoji,
      filters,
      createdBy: user.uid, createdByName: user.name,
      createdAt: new Date().toISOString(),
    });
  };

  const handleEditView = (view: ConversationView) => {
    // Abre o modal em modo edit. Marca a view como ativa para que se o
    // operador não tocar em nada e clicar Atualizar, os filtros salvos no
    // doc reflitam a view original. NÃO chamo handleSelectView pq ele faz
    // toggle — clicar edit numa view já ativa deselecionaria.
    if (activeViewId !== view.id) {
      setActiveViewId(view.id);
      setActiveChannel((view.filters.channel as ChannelTabId) ?? 'all');
      const savedSmart = view.filters.smartView as SmartViewId | undefined;
      if (savedSmart) {
        setActiveView(savedSmart);
      } else {
        const legacyStatus = view.filters.status as ConversationStatus | 'all' | undefined;
        setActiveView(
          legacyStatus === 'open'     ? 'all_open' :
          legacyStatus === 'waiting'  ? 'waiting_client' :
          legacyStatus === 'resolved' ? 'all_resolved' :
          'all',
        );
      }
      setActiveSectorFilter(view.filters.sectorId ?? 'all');
      setAdvFilters({
        assignedTo: view.filters.assignedTo ?? '',
        priority: view.filters.priority ?? '',
        label: view.filters.label ?? '',
        slaStatus: (view.filters.slaStatus as AdvancedFilters['slaStatus']) ?? '',
        unreadOnly: view.filters.unreadOnly ?? false,
      });
    }
    setEditingView(view);
    setShowSaveViewModal(true);
  };

  const handleDeleteView = async (viewId: string) => {
    try {
      await deleteDoc(doc(db, 'conversationViews', viewId));
      if (activeViewId === viewId) { setActiveViewId(null); }
    } catch (err) { console.error('[Views] Delete error:', err); }
  };

  const handleSelectView = (view: ConversationView) => {
    if (activeViewId === view.id) {
      // Deselect — volta pra default 'all_open' (mesma do reload do app).
      setActiveViewId(null);
      setActiveChannel('all'); setActiveView('all_open'); setActiveSectorFilter('all');
      setAdvFilters(EMPTY_ADV_FILTERS);
      return;
    }
    setActiveViewId(view.id);
    // Aceita os ids estendidos de transporte WhatsApp (whatsapp_cloud / whatsapp_baileys)
    // pra views salvas com filtro mais granular não regredirem pra "all".
    setActiveChannel((view.filters.channel as ChannelTabId) ?? 'all');
    // Migração: views novas trazem `smartView`; legadas só têm `status`.
    // Mapeia o status antigo pra equivalente smart view.
    const savedSmart = view.filters.smartView as SmartViewId | undefined;
    if (savedSmart) {
      setActiveView(savedSmart);
    } else {
      const legacyStatus = view.filters.status as ConversationStatus | 'all' | undefined;
      setActiveView(
        legacyStatus === 'open'     ? 'all_open' :
        legacyStatus === 'waiting'  ? 'waiting_client' :
        legacyStatus === 'resolved' ? 'all_resolved' :
        'all',  // sem status salvo (legado) = "Todas", preserva intenção do antigo activeStatus='all'
      );
    }
    setActiveSectorFilter(view.filters.sectorId ?? 'all');
    setAdvFilters({
      assignedTo: view.filters.assignedTo ?? '',
      priority: view.filters.priority ?? '',
      label: view.filters.label ?? '',
      slaStatus: (view.filters.slaStatus as AdvancedFilters['slaStatus']) ?? '',
      unreadOnly: view.filters.unreadOnly ?? false,
    });
  };

  // ── Batch actions ─────────────────────────────────────────────────────────

  const toggleBatchSelect = useCallback((id: string) => {
    setBatchSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const exitBatchMode = useCallback(() => {
    setBatchMode(false);
    setBatchSelectedIds(new Set());
  }, []);

  const handleBatchStatus = useCallback(async (status: ConversationStatus) => {
    if (!business?.id || batchSelectedIds.size === 0) return;
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    for (const id of batchSelectedIds) batch.update(doc(db, 'conversations', id), { status, updatedAt: now });
    await batch.commit();
    // Send CSAT survey to each resolved conversation if enabled
    if (status === 'resolved' && business.settings?.csatEnabled) {
      const toSurvey = conversations.filter(c => batchSelectedIds.has(c.id) && !c.csatSentAt);
      const csatMsg = '⭐ Como foi seu atendimento? Responda com um número de 1 a 5.\n1 = Péssimo  2 = Ruim  3 = Regular  4 = Bom  5 = Excelente';
      for (const conv of toSurvey) {
        await addDoc(collection(db, 'conversationMessages'), {
          conversationId: conv.id, businessId: business.id, channel: conv.channel,
          // Herda o transporte da conversation pra preservar histórico fiel
          ...(conv.connectedVia ? { connectedVia: conv.connectedVia } : {}),
          direction: 'outbound', content: csatMsg,
          status: 'sending', senderName: 'Sistema', isCsat: true, sentAt: now,
        });
        await updateDoc(doc(db, 'conversations', conv.id), {
          lastMessage: csatMsg, lastMessageAt: now, lastMessageDirection: 'outbound', csatSentAt: now, updatedAt: now,
        });
      }
    }
    toast.success(`${batchSelectedIds.size} conversa(s) atualizada(s)`);
    exitBatchMode();
  }, [business?.id, business?.settings?.csatEnabled, batchSelectedIds, conversations, exitBatchMode]);

  const handleBatchMarkRead = useCallback(async () => {
    if (!business?.id || batchSelectedIds.size === 0) return;
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    for (const id of batchSelectedIds) batch.update(doc(db, 'conversations', id), { unreadCount: 0, updatedAt: now });
    await batch.commit();
    toast.success(`${batchSelectedIds.size} conversa(s) marcada(s) como lida(s)`);
    exitBatchMode();
  }, [business?.id, batchSelectedIds, exitBatchMode]);

  const handleBatchAssign = useCallback(async (userId: string, userName: string) => {
    if (!business?.id || batchSelectedIds.size === 0 || !user) return;
    const now = new Date().toISOString();
    const historyEntry = { assignedTo: userId, assignedToName: userName, changedBy: user.uid, changedByName: user.name, changedAt: now };
    const batch = writeBatch(db);
    for (const id of batchSelectedIds) {
      batch.update(doc(db, 'conversations', id), {
        assignedTo: userId, assignedToName: userName, updatedAt: now,
        assignmentHistory: arrayUnion(historyEntry),
      });
    }
    await batch.commit();
    const count = batchSelectedIds.size;
    notifyUsers(db, [userId], {
      businessId: business.id,
      type: 'conversation_assigned',
      title: 'Conversa atribuída',
      body: `${user.name} atribuiu ${count === 1 ? 'uma conversa' : `${count} conversas`} a você`,
      link: 'Conversas',
      actorId: user.uid,
      actorName: user.name,
    }).catch(err => console.warn('Notification dispatch failed:', err));
    toast.success(`${count} conversa(s) atribuída(s) a ${userName}`);
    setShowBatchAssign(false);
    exitBatchMode();
  }, [business?.id, business, batchSelectedIds, user, exitBatchMode]);

  const handleBatchTag = useCallback(async (tag: string) => {
    if (!business?.id || batchSelectedIds.size === 0) return;
    const now = new Date().toISOString();
    const convs = conversations.filter(c => batchSelectedIds.has(c.id));
    const batch = writeBatch(db);
    for (const c of convs) {
      const tags = Array.from(new Set([...(c.tags ?? []), tag]));
      batch.update(doc(db, 'conversations', c.id), { tags, updatedAt: now });
    }
    await batch.commit();
    toast.success(`Tag "${tag}" adicionada a ${batchSelectedIds.size} conversa(s)`);
    setShowBatchTag(false);
    exitBatchMode();
  }, [business?.id, batchSelectedIds, conversations, exitBatchMode]);

  // ── Merge conversations ────────────────────────────────────────────────────

  const handleMergeConversations = useCallback(async (sourceConvId: string, targetConvId: string) => {
    if (!business?.id) return;
    const now = new Date().toISOString();
    try {
      // Move all messages from source → target
      const msgsSnap = await getDocs(query(collection(db, 'conversationMessages'), where('conversationId', '==', sourceConvId)));
      const batch = writeBatch(db);
      msgsSnap.docs.forEach(d => batch.update(d.ref, { conversationId: targetConvId, updatedAt: now }));
      // Resolve source conversation with a merge note
      batch.update(doc(db, 'conversations', sourceConvId), { status: 'resolved', mergedInto: targetConvId, updatedAt: now });
      await batch.commit();
      // Update target's last message snapshot
      const targetSnap = await getDocs(query(collection(db, 'conversationMessages'), where('conversationId', '==', targetConvId), orderBy('sentAt', 'desc'), limit(1)));
      if (!targetSnap.empty) {
        const last = targetSnap.docs[0].data();
        await updateDoc(doc(db, 'conversations', targetConvId), { lastMessage: last.content ?? '[mídia]', lastMessageAt: last.sentAt ?? now, updatedAt: now });
      }
      toast.success('Conversas unificadas com sucesso');
      setSelectedConversation(null); setShowMobileThread(false);
    } catch (err) { console.error('[Merge] Error:', err); toast.error('Erro ao unificar conversas'); }
  }, [business?.id]);

  // ── Sector visibility filter ──────────────────────────────────────────────

  const getVisibleConversations = useCallback(
    (convs: Conversation[]) => {
      if (!user) return convs;
      // Admins see everything
      if (isAdmin) return convs;

      return convs.filter((conv) => {
        // No sector restriction = visible to all
        if (!conv.sectorIds?.length && !conv.isPrivate) return true;
        // Assigned to this user = always visible
        if (conv.assignedTo === user.uid) return true;
        // Private = only visible to members of assigned sectors
        if (conv.isPrivate) {
          return conv.sectorIds?.some((s) => userSectorIds.includes(s)) || false;
        }
        // Has sectors = check intersection
        if (conv.sectorIds?.length) {
          return conv.sectorIds.some((s) => userSectorIds.includes(s));
        }
        return true;
      });
    },
    [user, isAdmin, userSectorIds],
  );

  // ── Real-time: Messages for selected conversation (paginated) ───────────────

  useEffect(() => {
    if (!selectedConversation?.id || !business?.id) return;

    // Reset state ao trocar de conversa — sem isso, mensagens da conv anterior
    // (especialmente quando "ver mais" tinha sido usado e prev.length > 50)
    // misturavam com as 50 da nova conversa via o branch de merge abaixo.
    setMessages([]);
    setIsLoadingMessages(true);
    setHasMoreMessages(false);
    setOldestMessageTimestamp(null);

    // Load latest 50 messages in real-time
    const activeConvId = selectedConversation.id;
    const q = query(
      collection(db, 'conversationMessages'),
      where('businessId', '==', business.id),
      where('conversationId', '==', activeConvId),
      orderBy('sentAt', 'desc'),
      limit(50),
    );

    let unsub: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;

    const subscribe = () => {
      unsub = onSnapshot(
        q,
        (snap) => {
          retryCount = 0;
          const data = snap.docs
            .map((d) => ({ ...d.data(), id: d.id } as ConversationMessage))
            .reverse(); // Reverse to show oldest first (chronological order)

          setMessages((prev) => {
            // Guard adicional: se algum msg de prev não é desta conv (ex: race
            // durante troca de conversa), descarta tudo e usa só o novo batch.
            const prevIsForThisConv = prev.length === 0 || prev[0]?.conversationId === activeConvId;
            if (!prevIsForThisConv) return data;
            // Se loadOlder havia sido usado, preserva os anciões + novos 50.
            if (prev.length > 50) {
              const olderMessages = prev.slice(0, prev.length - 50);
              const newIds = new Set(data.map((m) => m.id));
              const filteredOlder = olderMessages.filter((m) => !newIds.has(m.id));
              return [...filteredOlder, ...data];
            }
            return data;
          });
          setIsLoadingMessages(false);
          setHasMoreMessages(snap.docs.length >= 50);

          if (data.length > 0) {
            // Only update oldest timestamp if we haven't loaded older messages yet
            setOldestMessageTimestamp((prev) => prev ?? data[0].sentAt);
          }
        },
        (err) => {
          // Sem este handler, qualquer erro (rules denial, índice em build, rede)
          // matava o listener silenciosamente — mensagens recém-enviadas paravam
          // de aparecer mesmo persistindo no Firestore. Toast só na primeira
          // tentativa pra não spammar; retry com backoff segue como na lista
          // de conversas.
          console.error('[Messages] onSnapshot error:', err);
          if (retryCount === 0) {
            const code = (err as { code?: string }).code || '';
            if (code === 'permission-denied') {
              toast.error('Sem permissão para ler mensagens desta conversa. Atualize a página.');
            } else {
              toast.warn('Conexão de mensagens caiu — tentando reconectar.');
            }
          }
          setIsLoadingMessages(false);
          const delay = Math.min(3000 * Math.pow(2, retryCount), 30_000);
          retryCount++;
          retryTimer = setTimeout(subscribe, delay);
        },
      );
    };

    subscribe();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      unsub?.();
    };
  }, [selectedConversation?.id, business?.id]);

  // ── Auto-scroll to bottom ──────────────────────────────────────────────────

  // Força o scroll do messagesContainerRef pro fundo. Usa scrollHeight direto
  // — mais confiável que scrollIntoView quando há ancestors animados (Framer
  // Motion no shell + transição de conversa) que podem confundir o "nearest
  // scrollable parent" do scrollIntoView nativo.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (behavior === 'instant' || behavior === 'auto') {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior });
    }
  }, []);

  // Detecta se o user está dentro de ~150px do bottom — se sim, auto-scroll
  // ao receber novas msgs/mídia carregando é desejado. Se está scrollado bem
  // pra cima (lendo histórico), respeitamos a posição dele.
  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    return container.scrollHeight - container.scrollTop - container.clientHeight < 150;
  }, []);

  // Track the conversation ID for which we've already done the initial instant scroll
  const initialScrollDoneRef = useRef<string | null>(null);
  // Flag setada quando o operador scrolla pra CIMA (lendo histórico). Auto-
  // scrolls programáticos só vão pra BAIXO, então direção upward distingue
  // sem ambiguidade. Cooldown-based detection era frágil: timers de retry
  // disparam a cada 50-1200ms, criando janelas onde scrolls genuínos do
  // user caíam dentro da cooldown e eram ignorados.
  const userHasScrolledRef = useRef(false);
  // Última posição de scroll observada — usada pra detectar direção.
  const lastScrollTopRef = useRef(0);

  // Reset flags when conversation changes
  useEffect(() => {
    if (selectedConversation?.id) {
      initialScrollDoneRef.current = null;
      userHasScrolledRef.current = false;
      lastScrollTopRef.current = 0;
    }
  }, [selectedConversation?.id]);

  // Detecta scroll UPWARD (operador lendo histórico). Programmatic scrolls
  // sempre vão downward (rumo ao bottom), então qualquer redução de
  // scrollTop > 40px é necessariamente intencional do operador.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const current = container.scrollTop;
      if (current < lastScrollTopRef.current - 40) {
        userHasScrolledRef.current = true;
      }
      lastScrollTopRef.current = current;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [selectedConversation?.id]);

  // Scroll to bottom when messages finish loading for the first time in a conversation.
  //
  // Por que useLayoutEffect ao invés de useEffect: o useLayoutEffect roda
  // SÍNCRONO depois do DOM update mas ANTES do paint. Isso garante que o
  // scroll é aplicado antes do user ver o conteúdo no estado errado (sem
  // flicker) e evita race com a animação de entrada do painel direito
  // (AnimatePresence + Framer Motion) que pode interferir com scrollIntoView.
  //
  // Multi-pass + ResizeObserver: 1 attempt síncrono + vários attempts
  // assíncronos (até 3.5s) pra cobrir imagens/áudio/vídeo que carregam após
  // DOM paint. ResizeObserver re-scrolla automaticamente sempre que altura
  // do container muda nos primeiros 5s, MAS só se user ainda está near-bottom
  // (se ele scrollou pra cima manualmente, respeitamos).
  useLayoutEffect(() => {
    if (
      !isLoadingMessages &&
      selectedConversation?.id &&
      messages.length > 0 &&
      initialScrollDoneRef.current !== selectedConversation.id
    ) {
      const convId = selectedConversation.id;
      initialScrollDoneRef.current = convId;

      // Pass síncrono (antes do paint) — funciona pra texto puro
      scrollToBottom('instant');

      const timers: ReturnType<typeof setTimeout>[] = [];

      // Passes assíncronos pra mídia que carrega depois — checam
      // userHasScrolledRef em vez de isNearBottom(). isNearBottom falhava
      // quando mídia carregava e empurrava o conteúdo (scrollTop ficava
      // >150px do bottom mesmo sem ação do usuário), causando os timers a
      // desistirem e a conversa ficar parada no meio. userHasScrolled é
      // setada SÓ quando o operador realmente scrolla — robusto contra
      // crescimento do container.
      requestAnimationFrame(() => {
        if (initialScrollDoneRef.current === convId && !userHasScrolledRef.current) {
          scrollToBottom('instant');
        }
      });
      [50, 150, 350, 700, 1200, 2000, 3500].forEach((ms) => {
        timers.push(setTimeout(() => {
          if (initialScrollDoneRef.current === convId && !userHasScrolledRef.current) {
            scrollToBottom('instant');
          }
        }, ms));
      });

      // ResizeObserver: durante 5s, sempre que altura muda, re-scrolla SE
      // user ainda não scrollou manualmente. Pega lazy load de mídia sem
      // bater contra o scroll manual do user.
      const container = messagesContainerRef.current;
      let stopObserving = false;
      let observer: ResizeObserver | null = null;
      if (container && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => {
          if (stopObserving) return;
          if (initialScrollDoneRef.current !== convId) return;
          if (userHasScrolledRef.current) return; // user scrollou — respeita
          scrollToBottom('instant');
        });
        observer.observe(container);
        timers.push(setTimeout(() => {
          stopObserving = true;
          observer?.disconnect();
        }, 5000));
      }

      return () => {
        timers.forEach(clearTimeout);
        observer?.disconnect();
      };
    }
  }, [isLoadingMessages, selectedConversation?.id, messages.length, scrollToBottom, isNearBottom]);

  // Smooth scroll when a new message arrives after the initial load —
  // respeita posição do usuário (se ele scrollou pra cima lendo histórico,
  // não puxa de volta quando msg nova chega). Sem o check, chegada de
  // inbound durante leitura de histórico tirava o user da posição.
  useEffect(() => {
    if (
      selectedConversation &&
      messages.length > 0 &&
      !isLoadingOlderRef.current &&
      initialScrollDoneRef.current === selectedConversation.id &&
      isNearBottom()
    ) {
      scrollToBottom('smooth');
    }
  }, [messages.length, selectedConversation, scrollToBottom, isNearBottom]);

  // ── Load more (older) messages ────────────────────────────────────────────

  const loadMoreMessages = useCallback(async () => {
    if (!selectedConversation?.id || !business?.id || !oldestMessageTimestamp || loadingMoreMessages) return;

    setLoadingMoreMessages(true);
    isLoadingOlderRef.current = true;

    try {
      const container = messagesContainerRef.current;
      const previousScrollHeight = container?.scrollHeight || 0;

      const q = query(
        collection(db, 'conversationMessages'),
        where('businessId', '==', business.id),
        where('conversationId', '==', selectedConversation.id),
        orderBy('sentAt', 'desc'),
        startAfter(oldestMessageTimestamp),
        limit(50),
      );

      const snap = await getDocs(q);
      const olderMessages = snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as ConversationMessage))
        .reverse();

      if (olderMessages.length > 0) {
        setMessages((prev) => [...olderMessages, ...prev]);
        setOldestMessageTimestamp(olderMessages[0].sentAt);

        // After DOM updates, restore scroll position
        requestAnimationFrame(() => {
          if (container) {
            const newScrollHeight = container.scrollHeight;
            container.scrollTop = newScrollHeight - previousScrollHeight;
          }
          isLoadingOlderRef.current = false;
        });
      } else {
        isLoadingOlderRef.current = false;
      }

      setHasMoreMessages(snap.docs.length >= 50);
    } catch (err) {
      console.error('Error loading more messages:', err);
      isLoadingOlderRef.current = false;
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [selectedConversation?.id, business?.id, oldestMessageTimestamp, loadingMoreMessages]);

  // ── WhatsApp 24h window check ──────────────────────────────────────────────

  const isWindowExpired = useCallback(
    (conversation: Conversation): boolean => {
      if (conversation.channel !== 'whatsapp') return false;
      // Janela de 24h é regra exclusiva da Cloud API da Meta. Baileys
      // (WhatsApp Web) não tem essa restrição — aceita texto livre a qualquer
      // momento. Sem este short-circuit, conversas Baileys travavam exigindo
      // template após 24h de silêncio do contato.
      if (conversation.connectedVia === 'baileys') return false;
      if (!conversation.lastMessageAt) return true;
      // Check if last INBOUND message was more than 24h ago
      const lastInbound = messages
        .filter((m) => m.direction === 'inbound')
        .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
      if (!lastInbound) return true;
      const elapsed = Date.now() - new Date(lastInbound.sentAt).getTime();
      return elapsed > 24 * 60 * 60 * 1000;
    },
    [messages],
  );

  // ── WhatsApp templates — fetched from Meta API on demand ─────────────────────

  const fetchWhatsappTemplates = useCallback(async () => {
    if (!business?.id || templatesLoading) return;
    setTemplatesLoading(true);
    setTemplatesError(null);
    // hello_world é auto-aprovado pela Meta em toda WABA — sempre disponível como fallback.
    // Garante que o usuário sempre tem ao menos UM template para abrir janela de 24h.
    const helloWorldFallback = {
      name: 'hello_world',
      language: 'en_US',
      category: 'UTILITY',
      preview: 'Hello World',
      hasVariables: false,
    };
    const ensureHelloWorld = (list: Array<{ name: string; language: string; category: string; preview: string; hasVariables: boolean }>) => {
      const has = list.some(t => t.name.toLowerCase() === 'hello_world');
      return has ? list : [helloWorldFallback, ...list];
    };
    try {
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        setTemplatesError('Sessão expirada. Faça login novamente.');
        setTemplateList([helloWorldFallback]);
        return;
      }
      const res = await fetch(`/api/channels/whatsapp-templates?businessId=${business.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error || `Falha ao carregar templates (HTTP ${res.status}).`;
        console.error('[Conversations] Templates fetch failed:', { status: res.status, body: data });
        // Mesmo em erro, oferece hello_world para o usuário poder reengajar
        setTemplateList([helloWorldFallback]);
        setTemplatesError(`${msg} Você ainda pode usar hello_world.`);
        return;
      }
      const data = await res.json();
      setTemplateList(ensureHelloWorld(data.templates || []));
    } catch (err) {
      console.error('[Conversations] Templates fetch threw:', err);
      const msg = err instanceof Error ? `Erro: ${err.message}` : 'Erro ao carregar templates.';
      setTemplateList([helloWorldFallback]);
      setTemplatesError(`${msg} Você ainda pode usar hello_world.`);
    } finally {
      setTemplatesLoading(false);
    }
  }, [business?.id, templatesLoading]);

  // ── Send template message ─────────────────────────────────────────────────

  const handleSendTemplate = useCallback(
    async (templateName: string, templateLanguage: string) => {
      if (!selectedConversation || !business?.id || !user || isSending) return;

      setIsSending(true);
      setShowTemplateSelector(false);
      const now = new Date().toISOString();

      // Tenta usar o preview do template (texto real renderizado) em vez do
      // placeholder cru "[Template: nome]". Cai pro placeholder se não achar
      // (ex: hello_world fallback antes do fetch).
      const tpl = templateList.find(t => t.name === templateName);
      const displayContent = tpl?.preview && tpl.preview.trim()
        ? tpl.preview
        : `[Template: ${templateName}]`;

      try {
        // 1. Save template message to Firestore (otimista). Templates SEMPRE
        //    saem via Cloud (Baileys não suporta templates), então marcamos
        //    connectedVia='embedded_signup' independente do canal da conv —
        //    sem isso a UI mostrava badge "Web" durante o sending de uma
        //    mensagem que iria sair como "Oficial".
        const msgRef = await addDoc(collection(db, 'conversationMessages'), {
          conversationId: selectedConversation.id,
          businessId: business.id,
          channel: selectedConversation.channel,
          connectedVia: 'embedded_signup' as const,
          direction: 'outbound' as const,
          content: displayContent,
          // Mantém o nome do template como metadado pra debug/audit
          templateName,
          templateLanguage,
          status: 'sending' as const,
          senderName: user.name,
          sentAt: now,
        });

        // 2. Update conversation metadata (set firstResponseAt if this is the first reply)
        await updateDoc(doc(db, 'conversations', selectedConversation.id), {
          lastMessage: displayContent.slice(0, 100),
          lastMessageAt: now,
          lastMessageDirection: 'outbound',
          updatedAt: now,
          ...(!selectedConversation.firstResponseAt ? { firstResponseAt: now } : {}),
        });

        // 3. Send via API as template — passa messageDocId pra que o backend
        //    atualize o doc otimista (sending → sent) em vez de criar um
        //    SEGUNDO doc via saveAgentMessage. Sem isso, o operador via
        //    duplicatas de cada template no histórico (uma "Web" em sending
        //    eterno + uma "Oficial" sent).
        try {
          const auth = getAuth();
          const token = await auth.currentUser?.getIdToken();
          const res = await fetch('/api/conversations/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              businessId: business.id,
              conversationId: selectedConversation.id,
              messageDocId: msgRef.id,
              channel: selectedConversation.channel,
              recipientId: selectedConversation.contactExternalId,
              // Mandamos o conteúdo renderizado pra UI da outra ponta também
              // ver o texto real, não o placeholder.
              content: displayContent,
              type: 'template',
              templateName,
              templateLanguage,
            }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
            toast.error(`Falha ao enviar template "${templateName}": ${errBody.error || 'erro desconhecido'}${errBody.metaCode ? ` (Meta #${errBody.metaCode})` : ''}`);
            console.warn('[SendTemplate] API error:', errBody);
            // Marca como falhou — sem isso, o doc otimista fica em 'sending'
            // pra sempre e o operador não sabe que precisa retentar.
            await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' })
              .catch(e => console.warn('[SendTemplate] Failed to mark template as failed:', e));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(`Erro de conexão ao enviar template: ${msg}`);
          await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' })
            .catch(e => console.warn('[SendTemplate] Failed to mark template as failed:', e));
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string }).code || '';
        console.error('Error sending template message:', err);
        if (code === 'permission-denied') {
          toast.error('Sem permissão para enviar template nesta conversa.');
        } else {
          toast.error(`Falha ao salvar template: ${errMsg}`);
        }
      } finally {
        setIsSending(false);
      }
    },
    [selectedConversation, business?.id, user, isSending, templateList],
  );

  // ── Mark as read ───────────────────────────────────────────────────────────

  const markAsRead = useCallback(async (conversationId: string) => {
    try {
      await updateDoc(doc(db, 'conversations', conversationId), {
        unreadCount: 0,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error marking conversation as read:', err);
    }
  }, []);

  // ── Signal de conversa ativa (consumido por useConversationsAlerts) ────────
  // Registra/desregistra o ID da conversa atualmente aberta. Hook global
  // checa esse signal pra suprimir o beep de uma msg que chega numa conversa
  // que o operador já está vendo.
  useEffect(() => {
    setActiveConversation(selectedConversation?.id ?? null);
    return () => setActiveConversation(null);
  }, [selectedConversation?.id]);

  // ── Auto-markAsRead em mensagens novas ──────────────────────────────────────
  // Quando uma msg nova chega (snapshot atualiza unreadCount > 0) numa
  // conversa que está ATUALMENTE selecionada e a aba está visível, marca
  // como lida automaticamente. Antes precisava do user clicar de novo na
  // conversa pra resetar — UX confusa em multi-user com cliente em rajada.
  // Lê unreadCount direto do array `conversations` (atualizado via snapshot)
  // pra evitar staleness do `selectedConversation` state.
  //
  // Também re-roda quando a aba volta a ficar visível (user troca pra essa
  // aba e a conversa selecionada acumulou unread enquanto estava no fundo).
  useEffect(() => {
    const id = selectedConversation?.id;
    if (!id) return;

    const tryMark = () => {
      const fresh = conversations.find(c => c.id === id);
      if (!fresh || (fresh.unreadCount ?? 0) === 0) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void markAsRead(id);
    };

    tryMark();

    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', tryMark);
    return () => document.removeEventListener('visibilitychange', tryMark);
  }, [conversations, selectedConversation?.id, markAsRead]);

  // ── Send read receipt to platform (Task 3) ─────────────────────────────────

  const sendReadReceipt = useCallback(async (conversation: Conversation, lastMessageExternalId?: string) => {
    if (!lastMessageExternalId || !conversation.contactExternalId || !business?.id) return;
    try {
      await fetch('/api/conversations/read-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          channel: conversation.channel,
          messageId: lastMessageExternalId,
          recipientId: conversation.contactExternalId,
        }),
      });
    } catch {
      // Silent fail - read receipts are non-critical
    }
  }, [business?.id]);

  const handleSelectConversation = useCallback(
    (conv: Conversation) => {
      setSelectedConversation(conv);
      setShowMobileThread(true);
      setAttachment(null);
      if (conv.unreadCount > 0) {
        markAsRead(conv.id);
        // Read receipt is sent in the messages useEffect once the new conversation's
        // messages load — using `messages` here would reference the previous conv's data.
      }
    },
    [markAsRead],
  );

  // ── Typing indicator (Task 4) ─────────────────────────────────────────────

  // Snapshot via ref evita recriar o debounce a cada render. Antes a dep era
  // o objeto `selectedConversation` inteiro — toda vez que o snapshot do
  // listener re-emitia a conversa, ganhava nova referência, useMemo refazia
  // a função, e `leading: true` disparava fetch de novo. Resultado prático:
  // CADA tecla pressionada = 1 fetch HTTP no main thread, freeze ao segurar
  // tecla. Com ref, o debounce instance vive estável e o leading-true só
  // dispara 1x por janela de 3s.
  const typingTargetRef = useRef<{ channel: ConversationChannel; recipientId?: string } | null>(null);
  typingTargetRef.current = selectedConversation
    ? { channel: selectedConversation.channel, recipientId: selectedConversation.contactExternalId }
    : null;

  const sendTypingIndicator = useMemo(
    () => debounce(async () => {
      const target = typingTargetRef.current;
      if (!target || !business?.id) return;
      try {
        const token = await getAuth().currentUser?.getIdToken();
        if (!token) return;
        await fetch('/api/conversations/typing', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            businessId: business.id,
            channel: target.channel,
            recipientId: target.recipientId,
          }),
        });
      } catch {
        // Silent fail - typing indicators are non-critical
      }
    }, 3000, { leading: true, trailing: false }),
    [business?.id],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => { sendTypingIndicator.cancel(); };
  }, [sendTypingIndicator]);

  // ── File attachment handling (Task 1) ──────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Limites por tipo — alinhados com WhatsApp Cloud API.
    // Documento: 100MB (Cloud); imagem 5MB; áudio/vídeo 16MB. Baileys aceita
    // até ~50MB no pipeline atual mas o Cloud é mais restrito, então usamos
    // os limites Cloud como ceiling pra UX consistente entre canais.
    const mt: 'image' | 'video' | 'audio' | 'document' = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio'
      : 'document';
    const limits = { image: 5, video: 16, audio: 16, document: 100 } as const;
    const limitMb = limits[mt];
    if (file.size > limitMb * 1024 * 1024) {
      const labels = { image: 'imagem', video: 'vídeo', audio: 'áudio', document: 'documento' } as const;
      alert(`Arquivo de ${labels[mt]} muito grande (máximo ${limitMb}MB).`);
      return;
    }

    // Validate audio format for WhatsApp (Cloud API requires specific MIME types)
    const channel = selectedConversation?.channel;
    if (file.type.startsWith('audio/') && channel === 'whatsapp') {
      const WA_SUPPORTED_AUDIO = ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/opus'];
      if (!WA_SUPPORTED_AUDIO.includes(file.type)) {
        alert(`Formato de áudio não suportado pelo WhatsApp (${file.type}).\nUse MP3, M4A, AAC, AMR ou OGG/Opus.`);
        return;
      }
    }

    setAttachment(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [selectedConversation]);

  const handleRemoveAttachment = useCallback(() => {
    setAttachment(null);
  }, []);

  const sendMediaMessage = useCallback(async (file: File, asInternal = false) => {
    if (!selectedConversation || !business?.id || !user) return;

    const mediaType: 'image' | 'video' | 'audio' | 'document' = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio'
      : 'document';
    const now = new Date().toISOString();
    // Caption sempre vazio: o nome do arquivo NÃO deve virar texto da bolha.
    // Pra documento, o filename real vai no campo dedicado `fileName`, que o
    // renderer mostra no card e a API repassa via document.filename (Cloud)
    // ou fileName (Baileys). Pra outras mídias, sem texto = sem caption.
    const messageContent = '';

    let msgRef: Awaited<ReturnType<typeof addDoc>> | null = null;

    try {
      // 1. Upload to Firebase Storage with explicit content-type so Meta APIs receive
      //    the correct MIME header when fetching the file.
      const storageRef = ref(storage, `conversations/${business.id}/${selectedConversation.id}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });
      const mediaUrl = await getDownloadURL(storageRef);

      // 2. Save to Firestore — internal notes never go via API, marked 'delivered'
      //    diretamente. Externos ficam 'sending' e mudam pra 'sent' após API ok.
      msgRef = await addDoc(collection(db, 'conversationMessages'), {
        conversationId: selectedConversation.id,
        businessId: business.id,
        channel: selectedConversation.channel,
        ...(selectedConversation.connectedVia ? { connectedVia: selectedConversation.connectedVia } : {}),
        direction: 'outbound' as const,
        content: messageContent,
        mediaUrl,
        mediaType,
        ...(mediaType === 'document' ? { fileName: file.name } : {}),
        status: asInternal ? 'delivered' as const : 'sending' as const,
        senderName: user.name,
        ...(asInternal ? { isInternal: true } : {}),
        sentAt: now,
      });

      // 3. Atualização de preview da conversa — só pra mensagens externas.
      //    Notas internas não devem virar "última mensagem" do contato (não foi
      //    nada que o cliente viu) nem aparecer na lista lateral.
      if (!asInternal) {
        const mediaLabel = mediaType === 'image' ? t('conversations.mediaImage', 'Imagem')
          : mediaType === 'video' ? t('conversations.mediaVideo', 'Vídeo')
          : mediaType === 'audio' ? t('conversations.mediaAudio', 'Áudio')
          : t('conversations.mediaDocument', 'Documento');
        await updateDoc(doc(db, 'conversations', selectedConversation.id), {
          lastMessage: `[${mediaLabel}] ${file.name}`,
          lastMessageAt: now,
          lastMessageDirection: 'outbound',
          updatedAt: now,
        });
      } else {
        // Internal notes só atualizam contagem; arquivo fica visível só pra equipe.
        await updateDoc(doc(db, 'conversations', selectedConversation.id), {
          internalNotes: (selectedConversation.internalNotes || 0) + 1,
          updatedAt: now,
        });
        return; // PULA chamada à Meta API — bug crítico era enviar mesmo como nota interna
      }

      // 4. Send via Meta API (apenas mensagens externas)
      const authInstance = getAuth();
      const token = await authInstance.currentUser?.getIdToken();
      const sendRes = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          businessId: business.id,
          conversationId: selectedConversation.id,
          // CRÍTICO: passa messageDocId pro backend ATUALIZAR a mensagem que
          // o frontend já criou (com mediaUrl/mediaType). Sem isso, o backend
          // cai no branch saveAgentMessage e cria uma SEGUNDA mensagem (sem
          // mediaUrl, só content) — operador via duas bolhas/dois timestamps
          // pro mesmo envio. Outros paths (text/template/retry) já passavam.
          messageDocId: msgRef.id,
          channel: selectedConversation.channel,
          recipientId: selectedConversation.contactExternalId,
          // Sem caption automática — o filename real vai em fileName separado.
          content: '',
          type: 'media',
          mediaUrl,
          mediaType,
          ...(mediaType === 'document' ? { fileName: file.name } : {}),
        }),
      });

      if (sendRes.ok) {
        // Backend já marca status='sent' + externalMessageId em
        // updateMessageAfterSend. Esta linha vira no-op, mas deixamos como
        // belt-and-suspenders pra UI atualizar antes do snapshot do Firestore.
        await updateDoc(msgRef, { status: 'sent' });
      } else {
        const errData = await sendRes.json().catch(() => ({})) as { error?: string };
        const errMsg = errData.error || `HTTP ${sendRes.status}`;
        console.error('[Media] API send failed:', sendRes.status, errData);
        await updateDoc(msgRef, { status: 'failed', errorMessage: errMsg });
        toast.error(`Falha ao enviar mídia: ${errMsg}`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[Media] Error during send:', errMsg);
      toast.error(`Falha ao enviar mídia: ${errMsg}`);
      if (msgRef) {
        await updateDoc(msgRef, { status: 'failed', errorMessage: errMsg }).catch(() => {});
      }
    }
  }, [selectedConversation, business?.id, user]);

  // ── Retry failed message (Task 5) ─────────────────────────────────────────

  const retryMessage = useCallback(async (msg: ConversationMessage) => {
    if (!selectedConversation || !business?.id) return;

    // Update status back to 'sending'
    await updateDoc(doc(db, 'conversationMessages', msg.id), { status: 'sending' });

    const markFailed = () =>
      updateDoc(doc(db, 'conversationMessages', msg.id), { status: 'failed' })
        .catch(e => console.warn('[Conversations] Failed to mark message as failed:', e));

    // Re-send via API — mirrors handleSend error handling so a failed retry
    // surfaces the toast and flips the bubble back to 'failed' (re-exposes the
    // "Tentar novamente" affordance). Without this, HTTP 4xx leaves the message
    // stuck in 'sending' and the UI silently looks sent.
    try {
      const authInstance = getAuth();
      const token = await authInstance.currentUser?.getIdToken();
      const res = await fetch('/api/conversations/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          businessId: business.id,
          conversationId: msg.conversationId,
          channel: msg.channel,
          recipientId: selectedConversation.contactExternalId,
          content: msg.content,
          messageDocId: msg.id,
          ...(msg.mediaUrl ? { type: 'media', mediaUrl: msg.mediaUrl, mediaType: msg.mediaType } : {}),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ code: 'unknown', error: 'Erro desconhecido' }));
        const chNames: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Facebook Messenger', instagram: 'Instagram' };
        const chName = chNames[msg.channel] || 'Canal';
        if (errBody.code === 'disconnected' || errBody.code === 'token_expired') {
          toast.warn(`${chName} desconectado — reconecte em Configurações → Canais.\n${errBody.error || ''}`);
        } else if (errBody.code === 'send_failed') {
          toast.error(`Falha ao enviar pelo ${chName}: ${errBody.error || 'erro desconhecido'}${errBody.metaCode ? ` (Meta #${errBody.metaCode})` : ''}`);
        } else {
          toast.error(`Erro ao reenviar mensagem [${res.status}]: ${errBody.error || 'erro desconhecido'}`);
        }
        console.warn('[Retry] API error:', errBody);
        await markFailed();
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      toast.error(`Erro de conexão ao reenviar mensagem: ${m}`);
      await markFailed();
    }
  }, [selectedConversation, business?.id]);

  // ── Update conversation status ─────────────────────────────────────────────

  const updateConversationStatus = useCallback(async (conversationId: string, status: ConversationStatus) => {
    const now = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'conversations', conversationId), { status, updatedAt: now });

      // Send CSAT survey when resolving, if enabled and not already sent
      if (status === 'resolved' && business?.settings?.csatEnabled) {
        const conv = conversations.find(c => c.id === conversationId);
        if (conv && !conv.csatSentAt) {
          const csatMsg = '⭐ Como foi seu atendimento? Responda com um número de 1 a 5.\n1 = Péssimo  2 = Ruim  3 = Regular  4 = Bom  5 = Excelente';
          await addDoc(collection(db, 'conversationMessages'), {
            conversationId, businessId: business.id, channel: conv.channel,
            ...(conv.connectedVia ? { connectedVia: conv.connectedVia } : {}),
            direction: 'outbound', content: csatMsg,
            status: 'sending', senderName: 'Sistema', isCsat: true, sentAt: now,
          });
          await updateDoc(doc(db, 'conversations', conversationId), {
            lastMessage: csatMsg, lastMessageAt: now, lastMessageDirection: 'outbound', csatSentAt: now, updatedAt: now,
          });
        }
      }
    } catch (err) {
      console.error('Error updating conversation status:', err);
    }
  }, [business?.id, business?.settings?.csatEnabled, conversations]);

  // ── Send message ───────────────────────────────────────────────────────────

  const handleSend = useCallback(async (rawText?: string) => {
    // rawText vem do Composer (Enter ou click no botão). Pra cenários onde
    // o pai chama handleSend() sem arg, lê via ref como fallback.
    const sourceText = rawText ?? composerRef.current?.getText() ?? '';
    const hasText = sourceText.trim().length > 0;
    const hasFile = !!attachment;
    if ((!hasText && !hasFile) || !selectedConversation || !business?.id || !user || isSending) return;

    const content = sourceText.trim();
    const currentAttachment = attachment;
    composerRef.current?.setText('');
    setAttachment(null);
    setIsSending(true);

    // If there is a media attachment, send it (errors are handled + toasted inside sendMediaMessage).
    // Propaga `isInternalNote` — anexo de nota interna NUNCA vai pelo Meta API.
    if (currentAttachment) {
      await sendMediaMessage(currentAttachment, isInternalNote);
    }

    // If no text, just finish
    if (!hasText) {
      setIsSending(false);
      composerRef.current?.focus();
      return;
    }

    const now = new Date().toISOString();

    try {
      // Internal notes are saved locally only — not sent to the contact
      if (isInternalNote) {
        await addDoc(collection(db, 'conversationMessages'), {
          conversationId: selectedConversation.id,
          businessId: business.id,
          channel: selectedConversation.channel,
          // Notas internas herdam o transporte da conversation pra coerência visual.
          ...(selectedConversation.connectedVia ? { connectedVia: selectedConversation.connectedVia } : {}),
          direction: 'outbound' as const,
          content,
          status: 'delivered' as const,
          senderName: user.name,
          isInternal: true,
          sentAt: now,
        });
        // Update internal notes count
        await updateDoc(doc(db, 'conversations', selectedConversation.id), {
          internalNotes: (selectedConversation.internalNotes || 0) + 1,
          updatedAt: now,
        });
      } else {
        // 1. Save message to Firestore — capture doc ID
        const msgRef = await addDoc(collection(db, 'conversationMessages'), {
          conversationId: selectedConversation.id,
          businessId: business.id,
          channel: selectedConversation.channel,
          // Marca o transporte aqui — backend do send/route.ts confirma/sobrescreve
          // se necessário (updateMessageAfterSend faz backfill defensivo).
          ...(selectedConversation.connectedVia ? { connectedVia: selectedConversation.connectedVia } : {}),
          direction: 'outbound' as const,
          content,
          status: 'sending' as const,
          senderName: user.name,
          sentAt: now,
        });

        // 2. Update conversation metadata (set firstResponseAt if this is the first reply)
        await updateDoc(doc(db, 'conversations', selectedConversation.id), {
          lastMessage: content,
          lastMessageAt: now,
          lastMessageDirection: 'outbound',
          updatedAt: now,
          ...(!selectedConversation.firstResponseAt ? { firstResponseAt: now } : {}),
        });

        // 3. Send via Meta API — pass messageDocId so backend updates sending → sent
        try {
          const auth = getAuth();
          const token = await auth.currentUser?.getIdToken();
          const res = await fetch('/api/conversations/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              businessId: business.id,
              conversationId: selectedConversation.id,
              messageDocId: msgRef.id,
              channel: selectedConversation.channel,
              recipientId: selectedConversation.contactExternalId,
              content,
            }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ code: 'unknown', error: 'Erro desconhecido' }));
            const chNames: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Facebook Messenger', instagram: 'Instagram' };
            const chName = chNames[selectedConversation.channel] || 'Canal';
            if (errBody.code === 'disconnected' || errBody.code === 'token_expired') {
              toast.warn(`${chName} desconectado — reconecte em Configurações → Canais.\n${errBody.error || ''}`);
            } else if (errBody.code === 'send_failed') {
              toast.error(`Falha ao enviar pelo ${chName}: ${errBody.error || 'erro desconhecido'}${errBody.metaCode ? ` (Meta #${errBody.metaCode})` : ''}`);
            } else {
              toast.error(`Erro ao enviar mensagem [${res.status}]: ${errBody.error || 'erro desconhecido'}`);
            }
            // Tratado (toast + status:'failed') — usa warn pra não disparar o overlay
            // de erro do Next.js dev. console.error fica reservado pro catch abaixo.
            console.warn('[Send] API error:', errBody);
            await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' }).catch(e => console.warn('[Conversations] Failed to mark message as failed:', e));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(`Erro de conexão ao enviar mensagem: ${msg}`);
          await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' }).catch(e => console.warn('[Conversations] Failed to mark message as failed:', e));
        }
      }
    } catch (err) {
      // Falha na escrita otimista (rules denial, falta de campos denormalizados,
      // ou rede). Antes ficava só no console e o usuário não tinha feedback —
      // a mensagem sumia sem aviso. Agora restaura o input e mostra toast.
      const errMsg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code || '';
      console.error('Error sending message:', err);
      if (code === 'permission-denied') {
        toast.error('Sem permissão para enviar mensagem nesta conversa. Verifique se você tem acesso ao canal.');
      } else {
        toast.error(`Falha ao salvar mensagem: ${errMsg}`);
      }
      composerRef.current?.setText(content);
    } finally {
      setIsSending(false);
      composerRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment, selectedConversation, business?.id, user, isSending, sendMediaMessage, isInternalNote]);

  // handleKeyDown removido daqui — Enter e "/" agora são tratados dentro do
  // próprio Composer, com acesso direto ao text local. Pai só recebe via
  // callback `onSlashWhenEmpty` quando precisa abrir o popover de snippets.
  const handleSlashWhenEmpty = useCallback(() => {
    setShowSnippets(true);
    setSnippetSearch('');
    setSnippetCreateMode(false);
    setSnippetDraftContent('');
  }, []);

  const closeSnippetsPopup = useCallback(() => {
    setShowSnippets(false);
    setSnippetCreateMode(false);
    setSnippetDraftContent('');
    setSnippetSearch('');
  }, []);

  // Outside-click: fecha popup quando user clica fora (padrão dropdown).
  // Antes só fechava no X. Mesmo padrão do emoji picker do Composer.
  useEffect(() => {
    if (!showSnippets) return;
    const handler = (e: MouseEvent) => {
      const popup = snippetsPopupRef.current;
      if (popup && !popup.contains(e.target as Node)) {
        closeSnippetsPopup();
      }
    };
    // mousedown (não click) pra capturar antes do focus/blur do input;
    // delay 0 evita disparo imediato pelo próprio click que abriu o popup.
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [showSnippets, closeSnippetsPopup]);

  // ── Snippet quick-create (inline no popup, sem sair de Conversas) ──────────
  // Permissão idêntica à QuickRepliesTab: manager+ pode criar/editar.
  const canCreateSnippet = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['manager'];

  const handleQuickCreateSnippet = useCallback(async () => {
    if (!canCreateSnippet || !business?.id || !user) return;
    // Sanitiza atalho: lowercase, sem espaços, só [a-z0-9_-]
    const shortcode = snippetSearch.trim().toLowerCase().replace(/\s+/g, '_');
    const content = snippetDraftContent.trim();
    if (!shortcode) { toast.error('Digite o atalho na busca pra criar'); return; }
    if (!/^[a-z0-9_-]+$/.test(shortcode)) {
      toast.error('Atalho aceita só letras minúsculas, números, _ e -');
      return;
    }
    if (shortcode.length > 32) { toast.error('Atalho excede 32 caracteres'); return; }
    if (!content) { toast.error('Mensagem obrigatória'); return; }
    if (content.length > 2000) { toast.error('Mensagem excede 2000 caracteres'); return; }

    // Dedup com snippets existentes
    if (snippets.some(s => s.shortcode.toLowerCase() === shortcode)) {
      toast.error(`Atalho "/${shortcode}" já existe`);
      return;
    }

    setSnippetSaving(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'snippets'), {
        businessId: business.id,
        shortcode,
        content,
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now,
      });
      toast.success(`Atalho /${shortcode} criado`);
      setSnippetCreateMode(false);
      setSnippetDraftContent('');
      // Mantém o popup aberto pra user inserir o snippet recém-criado.
      // onSnapshot vai trazer ele na lista filtrada em <100ms.
    } catch (err) {
      console.error('[Snippet quick-create] error:', err);
      toast.error('Erro ao criar atalho');
    } finally {
      setSnippetSaving(false);
    }
  }, [canCreateSnippet, business?.id, user, snippetSearch, snippetDraftContent, snippets]);

  // ── Snippet insertion ──────────────────────────────────────────────────────

  const handleInsertSnippet = useCallback((snippet: Snippet) => {
    let content = snippet.content;
    // Replace {{contact.name}} with actual contact name
    if (selectedConversation) {
      content = content.replace(/\{\{contact\.name\}\}/g, selectedConversation.customContactName ?? selectedConversation.contactName);
    }
    composerRef.current?.setText(content);
    setShowSnippets(false);
    composerRef.current?.focus();
  }, [selectedConversation]);

  // ── Sector assignment ──────────────────────────────────────────────────────

  const handleAssignSector = useCallback(async (sectorId: string) => {
    if (!selectedConversation || !business?.id || !user) return;
    const sector = sectors.find(s => s.id === sectorId);
    const now = new Date().toISOString();
    const historyEntry = {
      assignedToSectorId: sectorId, sectorName: sector?.name ?? sectorId,
      changedBy: user.uid, changedByName: user.name, changedAt: now,
    };
    try {
      await updateDoc(doc(db, 'conversations', selectedConversation.id), {
        assignedToSectorId: sectorId, sectorIds: [sectorId], updatedAt: now,
        assignmentHistory: arrayUnion(historyEntry),
      });
      const memberIds = sector?.memberIds ?? [];
      if (memberIds.length > 0) {
        notifyUsers(db, memberIds, {
          businessId: business.id,
          type: 'conversation_assigned',
          title: 'Conversa atribuída ao seu setor',
          body: `${user.name} atribuiu uma conversa ao setor ${sector?.name ?? sectorId}`,
          link: 'Conversas',
          relatedId: selectedConversation.id,
          actorId: user.uid,
          actorName: user.name,
        }).catch(err => console.warn('Notification dispatch failed:', err));
      }
      setShowSectorAssign(false);
    } catch (err) { console.error('Error assigning sector:', err); }
  }, [selectedConversation, business, user, sectors]);

  const handleRenameContact = useCallback(async (name: string) => {
    if (!selectedConversation || !business?.id) return;
    await updateDoc(doc(db, 'conversations', selectedConversation.id), {
      customContactName: name,
      updatedAt: new Date().toISOString(),
    });
  }, [selectedConversation, business?.id]);

  const handleTogglePrivate = useCallback(async () => {
    if (!selectedConversation || !business?.id) return;
    try {
      await updateDoc(doc(db, 'conversations', selectedConversation.id), {
        isPrivate: !selectedConversation.isPrivate,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error toggling privacy:', err);
    }
  }, [selectedConversation, business?.id]);

  // ── Filtered snippets ──────────────────────────────────────────────────────

  const filteredSnippets = useMemo(() => {
    return snippets.filter(s => {
      // Filter by sector if user is not admin
      if (s.sectorId && !isAdmin && !userSectorIds.includes(s.sectorId)) return false;
      if (!snippetSearch) return true;
      return s.shortcode.toLowerCase().includes(snippetSearch.toLowerCase()) ||
             s.content.toLowerCase().includes(snippetSearch.toLowerCase());
    });
  }, [snippets, snippetSearch, isAdmin, userSectorIds]);

  // ── Filtered conversations ─────────────────────────────────────────────────

  // `now` é fixado dentro do useMemo pra que o cálculo seja determinístico
  // dentro de uma render — evita drift quando matchesSmartView é chamada
  // múltiplas vezes ('stale' e 'resolved_today' dependem do tempo). Re-render
  // periódico não é necessário pra esta versão (operador re-abre/recarrega).
  const filteredConversations = useMemo(() => {
    const now = Date.now();
    const currentUid = user?.uid ?? '';
    return getVisibleConversations(conversations).filter((c) => {
      // Match canal — 'whatsapp_cloud' / 'whatsapp_baileys' são sub-filtros que
      // aplicam sobre c.channel === 'whatsapp' E o c.connectedVia correspondente.
      let matchesChannel: boolean;
      if (activeChannel === 'all') {
        matchesChannel = true;
      } else if (activeChannel === 'whatsapp_cloud') {
        matchesChannel = c.channel === 'whatsapp' && c.connectedVia === 'embedded_signup';
      } else if (activeChannel === 'whatsapp_baileys') {
        matchesChannel = c.channel === 'whatsapp' && c.connectedVia === 'baileys';
      } else {
        matchesChannel = c.channel === activeChannel;
      }
      const matchesView = matchesSmartView(c, activeView, currentUid, now);
      const matchesSector = activeSectorFilter === 'all' || c.sectorIds?.includes(activeSectorFilter) || c.assignedToSectorId === activeSectorFilter;
      // Phase 2: filtro por escopo de canal
      let matchesScope = true;
      if (activeChannelScope === 'mine') {
        matchesScope = !!(c.channelConnectionId && myConnectionIds.has(c.channelConnectionId));
      } else if (activeChannelScope === 'business') {
        // 'business': pertence a connection cuja ownerType seja 'business' OU
        // não tem connectionId (legado). User sem connection ainda aparece em
        // 'business' por default.
        const conn = c.channelConnectionId ? connectionsById.get(c.channelConnectionId) : null;
        matchesScope = !conn || conn.ownerType === 'business';
      }
      const matchesSearch =
        !searchQuery ||
        (c.customContactName ?? c.contactName).toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.contactPhone && c.contactPhone.includes(searchQuery));
      const matchesAssigned = !advFilters.assignedTo || c.assignedTo === advFilters.assignedTo;
      const matchesPriority = !advFilters.priority || c.priority === advFilters.priority;
      const matchesLabel = !advFilters.label || c.labels?.includes(advFilters.label) || c.tags?.includes(advFilters.label);
      const matchesUnread = !advFilters.unreadOnly || (c.unreadCount ?? 0) > 0;
      const matchesSLAStatus = !advFilters.slaStatus || getSLAInfo(c, slaConfig)?.status === advFilters.slaStatus;
      return matchesChannel && matchesView && matchesSector && matchesScope && matchesSearch && matchesAssigned && matchesPriority && matchesLabel && matchesUnread && matchesSLAStatus;
    });
  }, [getVisibleConversations, conversations, activeChannel, activeView, activeSectorFilter, activeChannelScope, myConnectionIds, connectionsById, searchQuery, advFilters, slaConfig, user?.uid]);

  // Re-sort client-side. 'recent' não toca a ordem (Firestore já desc por
  // lastMessageAt). 'oldest' inverte. 'priority' ranqueia urgent>high>med>low,
  // empate desempata por lastMessageAt mais recente. Sem re-sort, operador
  // que escolhe "Mais antigas" continuaria vendo as recentes no topo.
  //
  // Comparação por string em lastMessageAt: ISO 8601 em UTC (ex:
  // "2026-05-04T18:45:00.000Z") é lexicograficamente ordenável, então
  // localeCompare equivale a comparar como Date. Quebraria se algum site
  // gravasse data sem timezone normalizado — todos os pontos de criação
  // usam new Date().toISOString() que sempre produz UTC.
  const sortedConversations = useMemo(() => {
    if (sortMode === 'recent') return filteredConversations;
    const arr = [...filteredConversations];
    if (sortMode === 'oldest') {
      arr.sort((a, b) => (a.lastMessageAt || '').localeCompare(b.lastMessageAt || ''));
    } else if (sortMode === 'priority') {
      const rank: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
      arr.sort((a, b) => {
        const pa = rank[a.priority || ''] ?? 0;
        const pb = rank[b.priority || ''] ?? 0;
        if (pb !== pa) return pb - pa;
        return (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '');
      });
    }
    return arr;
  }, [filteredConversations, sortMode]);

  const activeFilterCount = countActiveFilters(advFilters);

  // Collect all unique labels/tags from conversations for the filter dropdown
  const allLabels = useMemo(() => {
    const s = new Set<string>();
    for (const c of conversations) {
      c.labels?.forEach(l => s.add(l));
      c.tags?.forEach(t => s.add(t));
    }
    return Array.from(s).sort();
  }, [conversations]);

  // ── Unread counts per channel ──────────────────────────────────────────────
  // Conta também os ids estendidos (whatsapp_cloud / whatsapp_baileys) baseado
  // em conv.connectedVia, pra que cada sub-tab tenha seu próprio contador.

  const unreadByChannel = conversations.reduce(
    (acc, c) => {
      acc[c.channel] = (acc[c.channel] ?? 0) + c.unreadCount;
      acc.all = (acc.all ?? 0) + c.unreadCount;
      if (c.channel === 'whatsapp') {
        if (c.connectedVia === 'embedded_signup') {
          acc.whatsapp_cloud = (acc.whatsapp_cloud ?? 0) + c.unreadCount;
        } else if (c.connectedVia === 'baileys') {
          acc.whatsapp_baileys = (acc.whatsapp_baileys ?? 0) + c.unreadCount;
        }
      }
      return acc;
    },
    {} as Record<string, number>,
  );

  // ── Counts per status ──────────────────────────────────────────────────────
  // Filtra pelo canal ativo — incluindo os sub-tabs Cloud/Baileys.

  const matchesActiveChannel = (c: Conversation): boolean => {
    if (activeChannel === 'all') return true;
    if (activeChannel === 'whatsapp_cloud') return c.channel === 'whatsapp' && c.connectedVia === 'embedded_signup';
    if (activeChannel === 'whatsapp_baileys') return c.channel === 'whatsapp' && c.connectedVia === 'baileys';
    return c.channel === activeChannel;
  };

  // Contagem por smart view — calculada sobre o universo já filtrado pelo
  // canal ativo (chips de cima). Assim os badges das views refletem o que o
  // operador veria se clicasse, considerando o canal que ele já selecionou.
  // Note: getVisibleConversations já aplica isolamento de canal pessoal.
  const countsByView = useMemo(() => {
    const now = Date.now();
    const currentUid = user?.uid ?? '';
    const out: Record<SmartViewId, number> = {
      all: 0, all_open: 0, waiting_client: 0, all_resolved: 0,
      awaiting_reply: 0, mine: 0, unassigned: 0, unread: 0, stale: 0,
      resolved_today: 0, snoozed: 0,
    };
    for (const c of getVisibleConversations(conversations)) {
      if (!matchesActiveChannel(c)) continue;
      (Object.keys(out) as SmartViewId[]).forEach(v => {
        if (matchesSmartView(c, v, currentUid, now)) out[v]++;
      });
    }
    return out;
  }, [conversations, getVisibleConversations, user?.uid, activeChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tabs ────────────────────────────────────────────────────────────────────
  // Split automático WhatsApp Cloud × Baileys quando o business tem volume nos
  // dois transportes. Se só um existe, mostra "WhatsApp" único pra evitar ruído.

  const hasWhatsAppCloud = useMemo(
    () => conversations.some(c => c.channel === 'whatsapp' && c.connectedVia === 'embedded_signup'),
    [conversations],
  );
  const hasWhatsAppBaileys = useMemo(
    () => conversations.some(c => c.channel === 'whatsapp' && c.connectedVia === 'baileys'),
    [conversations],
  );
  const splitWhatsApp = hasWhatsAppCloud && hasWhatsAppBaileys;

  const tabs: { id: ChannelTabId; label: string }[] = splitWhatsApp
    ? [
        { id: 'all', label: t('conversations.tabAll', 'Todos') },
        { id: 'whatsapp_cloud', label: t('conversations.tabWhatsAppCloud', 'WA Oficial') },
        { id: 'whatsapp_baileys', label: t('conversations.tabWhatsAppWeb', 'WA Web') },
        { id: 'facebook', label: t('conversations.tabMessenger', 'Messenger') },
        { id: 'instagram', label: t('conversations.tabInstagram', 'Instagram') },
      ]
    : [
        { id: 'all', label: t('conversations.tabAll', 'Todos') },
        { id: 'whatsapp', label: t('conversations.tabWhatsApp', 'WhatsApp') },
        { id: 'facebook', label: t('conversations.tabMessenger', 'Messenger') },
        { id: 'instagram', label: t('conversations.tabInstagram', 'Instagram') },
      ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left Panel ─────────────────────────────────────────────────────── */}
        <div
          className={cn(
            'flex flex-col bg-white dark:bg-[#0a0e17] border-r border-gray-100 dark:border-white/[0.06]',
            'w-full md:w-[340px] md:flex-shrink-0',
            showMobileThread ? 'hidden md:flex' : 'flex',
          )}
        >
          {/* Panel Header */}
          <div className="px-4 pt-4 pb-2 flex-shrink-0">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center shadow-lg shadow-red-500/25 flex-shrink-0">
                  <MessageSquare className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="font-display font-bold text-gray-900 dark:text-white text-base leading-tight truncate">
                    {t('conversations.title', 'Conversas')}
                  </h1>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                    {isLoadingConversations
                      ? t('conversations.loading', 'Carregando...')
                      : t(filteredConversations.length === 1 ? 'conversations.conversationCount_one' : 'conversations.conversationCount_other', filteredConversations.length === 1 ? '{{count}} conversa' : '{{count}} conversas', { count: filteredConversations.length })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => { setBatchMode(v => !v); if (batchMode) exitBatchMode(); }}
                  title="Selecionar conversas"
                  className={cn('w-8 h-8 rounded-xl flex items-center justify-center transition-colors',
                    batchMode
                      ? 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400'
                      : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  )}>
                  <CheckSquare className="w-4 h-4" />
                </motion.button>
                {/* Kebab "Mais" — colapsa SLA, CSAT, Analytics, Routing num único dropdown
                    para liberar espaço horizontal no header. Indicador de ponto colorido aparece
                    se alguma feature interna estiver ativa. */}
                <div ref={headerMoreRef} className="relative">
                  {(() => {
                    const hasActiveSecondary = slaConfig.enabled || csatEnabled || showAnalytics || routingRules.some(r => r.enabled);
                    return (
                      <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                        onClick={() => setShowHeaderMore(v => !v)}
                        title="Mais opções"
                        className={cn('w-8 h-8 rounded-xl flex items-center justify-center transition-colors relative',
                          showHeaderMore
                            ? 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400'
                            : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                        )}>
                        <MoreVertical className="w-4 h-4" />
                        {hasActiveSecondary && !showHeaderMore && (
                          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />
                        )}
                      </motion.button>
                    );
                  })()}
                  <AnimatePresence>
                    {showHeaderMore && (
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                        className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden z-30">
                        <button
                          type="button"
                          onClick={() => { setShowAnalytics(v => !v); setShowHeaderMore(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-white/[0.04] text-gray-700 dark:text-gray-300">
                          <BarChart3 className={cn('w-4 h-4', showAnalytics && 'text-red-500')} />
                          Analytics de conversas
                          {showAnalytics && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500" />}
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => { setShowSLASettings(true); setShowHeaderMore(false); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-white/[0.04] text-gray-700 dark:text-gray-300">
                              <Clock className={cn('w-4 h-4', slaConfig.enabled && 'text-red-500')} />
                              Configurar SLA
                              {slaConfig.enabled && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500" />}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                setShowHeaderMore(false);
                                if (!business?.id) return;
                                await updateDoc(doc(db, 'businesses', business.id), { 'settings.csatEnabled': !csatEnabled, updatedAt: new Date().toISOString() });
                                toast.success(!csatEnabled ? 'CSAT ativado' : 'CSAT desativado');
                              }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-white/[0.04] text-gray-700 dark:text-gray-300">
                              <span className={cn('w-4 h-4 leading-none flex items-center justify-center', csatEnabled && 'text-amber-500')}>⭐</span>
                              {csatEnabled ? 'Desativar CSAT' : 'Ativar CSAT'}
                              {csatEnabled && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setShowCSATDashboard(true); setShowHeaderMore(false); }}
                                  className="ml-auto text-[9px] font-semibold text-red-500 hover:text-red-600">
                                  ver dashboard
                                </button>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setShowRoutingRules(true); setShowHeaderMore(false); }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-white/[0.04] text-gray-700 dark:text-gray-300">
                              <ArrowRightLeft className={cn('w-4 h-4', routingRules.some(r => r.enabled) && 'text-violet-500')} />
                              Regras de roteamento
                              {routingRules.some(r => r.enabled) && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-500" />}
                            </button>
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowSettings(true)}
                  title="Configurações de canais"
                  className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </motion.button>
              </div>
            </div>

            {/* Search + new conversation + filter button */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder={t('conversations.searchPlaceholder', 'Buscar conversas...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm bg-gray-100 dark:bg-white/[0.04] border border-transparent dark:border-white/[0.06] rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:bg-white dark:focus:bg-white/[0.06] transition-colors"
                />
              </div>
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => setShowNewConversation(true)}
                title="Nova conversa"
                className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center transition-colors bg-red-500 hover:bg-red-600 text-white shadow-sm shadow-red-500/30">
                <Plus className="w-4 h-4" />
              </motion.button>
              {/* Sort dropdown — re-ordena a lista filtrada client-side. Usa
                  popover absoluto pra não inflar a barra com select<>. Fica
                  acionado quando sort != recent (default invisível em uso). */}
              <div className="relative flex-shrink-0">
                <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => setShowSortMenu(v => !v)}
                  title="Ordenar"
                  className={cn('relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors',
                    sortMode !== 'recent'
                      ? 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400'
                      : 'bg-gray-100 dark:bg-white/[0.04] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  )}>
                  <ArrowDownUp className="w-4 h-4" />
                </motion.button>
                <AnimatePresence>
                  {showSortMenu && (
                    <>
                      {/* Click-outside catcher */}
                      <div className="fixed inset-0 z-30" onClick={() => setShowSortMenu(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.97 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full mt-1.5 z-40 min-w-[180px] rounded-xl bg-white dark:bg-[#1a2030] border border-gray-200 dark:border-white/[0.08] shadow-lg overflow-hidden"
                      >
                        {([
                          { id: 'recent',   label: 'Mais recentes',     hint: 'Padrão' },
                          { id: 'oldest',   label: 'Mais antigas',      hint: 'Zerar backlog' },
                          { id: 'priority', label: 'Por prioridade',    hint: 'Urgente → Baixa' },
                        ] as const).map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => { setSortMode(opt.id); setShowSortMenu(false); }}
                            className={cn(
                              'w-full flex items-center justify-between px-3 py-2 text-left transition-colors',
                              sortMode === opt.id
                                ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04]',
                            )}
                          >
                            <span className="text-xs font-semibold">{opt.label}</span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">{opt.hint}</span>
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => setShowAdvFilters(v => !v)}
                className={cn('relative w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center transition-colors',
                  showAdvFilters || activeFilterCount > 0
                    ? 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400'
                    : 'bg-gray-100 dark:bg-white/[0.04] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                )}>
                <SlidersHorizontal className="w-4 h-4" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </motion.button>
            </div>
          </div>

          {/* Channel Tabs — scroll horizontal quando há tabs demais (split
              Cloud/Baileys = 5 tabs). Labels completos sempre, sem truncate
              que cortava em "WA O..." / "Mess...". Quem não couber pode ser
              alcançado scrollando lateralmente — wheel-handler em
              channelTabsRef converte deltaY em scrollLeft (mesmo padrão
              de SettingsModule e FinancialModule). */}
          <div className="px-3 pb-1 flex-shrink-0">
            <div ref={channelTabsRef} className="flex gap-0.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
              {tabs.map((tab) => {
                const isActive = activeChannel === tab.id;
                const unread = tab.id === 'all' ? unreadByChannel.all : unreadByChannel[tab.id];
                // Resolve config visual: sub-tabs WhatsApp herdam de CHANNEL_CONFIG.whatsapp
                // (Cloud) ou WHATSAPP_WEB_CONFIG (Baileys) pra refletir transporte na cor.
                const cfg =
                  tab.id === 'whatsapp_cloud' ? CHANNEL_CONFIG.whatsapp
                  : tab.id === 'whatsapp_baileys' ? WHATSAPP_WEB_CONFIG
                  : tab.id !== 'all' ? CHANNEL_CONFIG[tab.id as ConversationChannel]
                  : null;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveChannel(tab.id)}
                    title={tab.label}
                    className={cn(
                      'flex items-center gap-1 flex-shrink-0 px-1.5 py-1.5 rounded-lg text-[10.5px] font-semibold transition-all duration-150 whitespace-nowrap',
                      isActive
                        ? 'bg-gray-900 dark:bg-white/[0.12] text-white dark:text-white'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-800 dark:hover:text-gray-200',
                    )}
                  >
                    {tab.id !== 'all' && cfg && (
                      <span className={cn('flex-shrink-0', isActive ? 'text-current' : cfg.textColor)}>
                        {tab.id === 'whatsapp_cloud'
                          ? <BadgeCheck className="w-3 h-3" />
                          : tab.id === 'whatsapp_baileys'
                            ? <Smartphone className="w-3 h-3" />
                            : <ChannelIcon channel={tab.id as ConversationChannel} size="sm" />}
                      </span>
                    )}
                    <span>{tab.label}</span>
                    {(unread ?? 0) > 0 && (
                      <span
                        className={cn(
                          'flex-shrink-0 min-w-[15px] h-[15px] rounded-full text-[9px] font-bold flex items-center justify-center px-0.5 leading-none',
                          isActive
                            ? 'bg-red-500 text-white'
                            : 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400',
                        )}
                      >
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Smart Views — linha única com 4 status pills (Todas / Todas
              abertas / Aguardando cliente / Resolvidas) + dropdown "Mais
              views" pras lentes acionáveis (Aguardando resposta, Atribuídas
              a mim, Sem dono, Esquecidas, Em soneca, Resolvidas hoje). */}
          <SmartViewsBar
            activeView={activeView}
            onViewChange={(id) => { setActiveView(id); setActiveViewId(null); }}
            counts={countsByView}
          />

          {/* Channel scope filter (Phase 2) — só aparece se operador tem >=1
              canal pessoal. Sem isso, polui a UI de quem só usa empresa. */}
          {myConnectionIds.size > 0 && (
            <div className="px-3 pb-1 flex items-center gap-1 flex-shrink-0">
              {([
                { id: 'all',      label: 'Todos',   icon: null },
                { id: 'business', label: 'Empresa', icon: <Building2 className="w-3 h-3" /> },
                { id: 'mine',     label: 'Meus',    icon: <UserIcon className="w-3 h-3" /> },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setActiveChannelScope(opt.id)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold transition-colors',
                    activeChannelScope === opt.id
                      ? 'bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                  )}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Advanced filter panel */}
          <AnimatePresence>
            {showAdvFilters && (
              <AdvancedFilterPanel
                filters={advFilters}
                onChange={f => { setAdvFilters(f); setActiveViewId(null); }}
                members={members}
                allLabels={allLabels}
                slaEnabled={slaConfig.enabled}
                onSaveView={() => setShowSaveViewModal(true)}
              />
            )}
          </AnimatePresence>

          {/* Saved views bar */}
          <SavedViewsBar
            views={savedViews}
            activeViewId={activeViewId}
            onSelect={handleSelectView}
            onEdit={handleEditView}
            onDelete={handleDeleteView}
          />

          {/* Sector Filter */}
          {sectors.length > 0 && (
            <div className="px-4 pb-2 flex-shrink-0">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                <button
                  onClick={() => setActiveSectorFilter('all')}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors',
                    activeSectorFilter === 'all'
                      ? 'bg-gray-900 dark:bg-gray-200 text-white dark:text-gray-900'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
                  )}
                >
                  <Layers className="w-3 h-3 inline mr-1" />
                  {t('conversations.statusAllSectors', 'Todos')}
                </button>
                {sectors.filter(s => s.isActive).map((sector) => (
                  <button
                    key={sector.id}
                    onClick={() => setActiveSectorFilter(sector.id)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors flex items-center gap-1',
                      activeSectorFilter === sector.id
                        ? 'text-white'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
                    )}
                    style={activeSectorFilter === sector.id ? { backgroundColor: sector.color } : undefined}
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sector.color }} />
                    {sector.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10 relative">
            {isLoadingConversations ? (
              <ConversationListSkeleton />
            ) : (
              <AnimatePresence mode="popLayout">
                {sortedConversations.length === 0 ? (
                  <motion.div
                    key="empty-list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center py-12 px-6 text-center"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-white/[0.04] flex items-center justify-center mb-3">
                      <MessageSquare className="w-6 h-6 text-gray-300 dark:text-gray-600" />
                    </div>
                    {conversations.length === 0 ? (
                      <>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          {t('conversations.noConversationsYet', 'Nenhuma conversa ainda')}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 leading-relaxed max-w-[220px]">
                          {t('conversations.noConversationsYetDesc', 'Conecte seus canais em Configurações para começar a receber mensagens')}
                        </p>
                        <button
                          onClick={() => setShowSettings(true)}
                          className="mt-3 text-xs font-semibold px-4 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                        >
                          {t('conversations.configureChannels', 'Configurar canais')}
                        </button>
                      </>
                    ) : (() => {
                      // Empty state contextual por smart view ativa. Quando a
                      // busca/canal/filtros avançados também estão filtrando,
                      // a mensagem da view é menos exata — então só usa o
                      // contextual quando NÃO há outros filtros ativos.
                      const hasOtherFilters = !!searchQuery
                        || activeChannel !== 'all'
                        || activeSectorFilter !== 'all'
                        || advFilters.assignedTo
                        || advFilters.priority
                        || advFilters.label
                        || advFilters.slaStatus
                        || advFilters.unreadOnly;
                      const ctx = SMART_VIEW_EMPTY_STATE[activeView];
                      const title = hasOtherFilters
                        ? t('conversations.noConversationsFound', 'Nenhuma conversa encontrada')
                        : ctx.title;
                      const subtitle = hasOtherFilters
                        ? t('conversations.noConversationsFoundDesc', 'Tente mudar o filtro ou a busca')
                        : ctx.subtitle;
                      return (
                        <>
                          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-[260px] leading-relaxed">{subtitle}</p>
                        </>
                      );
                    })()}
                  </motion.div>
                ) : (
                  sortedConversations.map((conv, index) => (
                    <motion.div
                      key={conv.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ delay: index * 0.03, duration: 0.2 }}
                    >
                      <ConversationItem
                        conversation={conv}
                        isSelected={selectedConversation?.id === conv.id}
                        onClick={() => { if (batchMode) toggleBatchSelect(conv.id); else handleSelectConversation(conv); }}
                        slaInfo={getSLAInfo(conv, slaConfig)}
                        batchMode={batchMode}
                        isBatchSelected={batchSelectedIds.has(conv.id)}
                        onBatchToggle={() => toggleBatchSelect(conv.id)}
                        connectionLabel={(() => {
                          if (!conv.channelConnectionId) return undefined;
                          const conn = connectionsById.get(conv.channelConnectionId);
                          // Esconde label de business primary (default — não polui)
                          if (!conn || (conn.ownerType === 'business' && conn.isPrimary)) return undefined;
                          return conn.displayName;
                        })()}
                        isMineConnection={
                          !!(conv.channelConnectionId && myConnectionIds.has(conv.channelConnectionId))
                        }
                      />
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            )}

            {/* Batch action bar */}
            <AnimatePresence>
              {batchMode && batchSelectedIds.size > 0 && (
                <BatchActionBar
                  count={batchSelectedIds.size}
                  onMarkRead={handleBatchMarkRead}
                  onAssign={() => setShowBatchAssign(true)}
                  onStatus={handleBatchStatus}
                  onTag={() => setShowBatchTag(true)}
                  onCancel={exitBatchMode}
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Right Panel ────────────────────────────────────────────────────── */}
        <div
          className={cn(
            'flex-1 flex flex-col bg-gray-50 dark:bg-[#0a0e17] min-w-0',
            !showMobileThread ? 'hidden md:flex' : 'flex',
          )}
        >
          <AnimatePresence mode="wait">
            {!selectedConversation ? (
              <motion.div
                key="empty-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 flex flex-col items-center justify-center gap-5 p-8"
              >
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 20 }}
                  className="relative"
                >
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-red-600/20 to-red-500/10 flex items-center justify-center border border-red-500/20">
                    <MessageSquare className="w-9 h-9 text-red-500/60" />
                  </div>
                  <motion.div
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center shadow-lg shadow-red-500/40"
                  >
                    <MessageSquare className="w-2.5 h-2.5 text-white" />
                  </motion.div>
                </motion.div>
                <div className="text-center max-w-xs">
                  <h2 className="font-display font-bold text-gray-700 dark:text-gray-200 text-xl mb-2">
                    {t('conversations.selectConversation', 'Selecione uma conversa')}
                  </h2>
                  <p className="text-sm text-gray-400 dark:text-gray-500 leading-relaxed">
                    {t('conversations.selectConversationDesc', 'Escolha uma conversa à esquerda para começar a responder seus clientes')}
                  </p>
                </div>
                <div className="flex items-center gap-4 mt-2">
                  {(['whatsapp', 'facebook', 'instagram'] as ConversationChannel[]).map((ch) => {
                    const cfg = CHANNEL_CONFIG[ch];
                    // Quando split Cloud/Baileys está ativo, clicar "WhatsApp"
                    // aqui precisa cair em uma das sub-tabs — senão activeChannel
                    // vira 'whatsapp' (que não está em `tabs`) e nenhuma tab fica
                    // highlighted, deixando UI num estado intermediário confuso.
                    const targetChannel: ChannelTabId =
                      ch === 'whatsapp' && splitWhatsApp
                        ? (hasWhatsAppCloud ? 'whatsapp_cloud' : 'whatsapp_baileys')
                        : ch;
                    return (
                      <motion.div
                        key={ch}
                        whileHover={{ y: -3 }}
                        className={cn(
                          'flex flex-col items-center gap-1.5 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors',
                          cfg.bgColor,
                          cfg.borderColor,
                        )}
                        onClick={() => setActiveChannel(targetChannel)}
                      >
                        <ChannelIcon channel={ch} size="md" />
                        <span className={cn('text-[10px] font-semibold', cfg.textColor)}>
                          {cfg.label}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={selectedConversation.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="flex-1 flex flex-col min-h-0"
              >
                {/* Thread Header */}
                <ThreadHeader
                  conversation={selectedConversation}
                  onBack={() => {
                    setShowMobileThread(false);
                    setSelectedConversation(null);
                  }}
                  onStatusChange={(status) => {
                    updateConversationStatus(selectedConversation.id, status);
                  }}
                  onSectorAssign={() => setShowSectorAssign(prev => !prev)}
                  onCreateOrder={isPedidosMode ? () => handleCreateOrderFromConversation(selectedConversation) : undefined}
                  onToggleAi={() => handleToggleAi(selectedConversation)}
                  onGoToAgentSettings={handleGoToAgentSettings}
                  onOpenAgentDebug={aiAgentEnabled ? () => setAgentDebugOpen(true) : undefined}
                  onOpenContact={() => handleOpenContact(selectedConversation)}
                  onLinkClient={() => setLinkContactOpen(true)}
                  linkedClientName={
                    selectedConversation.crmContactId
                      ? clientsList.find(c => c.id === selectedConversation.crmContactId)?.name
                      : undefined
                  }
                  onDeleteConversation={() => handleDeleteConversation(selectedConversation)}
                  onMarkUnread={() => handleMarkUnread(selectedConversation)}
                  onSnooze={(untilIso) => handleSnooze(selectedConversation, untilIso)}
                  onUnsnooze={() => handleUnsnooze(selectedConversation)}
                  onTogglePrivate={handleTogglePrivate}
                  onExport={() => handleExportHistory(selectedConversation)}
                  aiEnabledBusinessWide={aiAgentEnabled}
                  sectors={sectors}
                  slaInfo={getSLAInfo(selectedConversation, slaConfig)}
                  onToggleAssignHistory={() => setShowAssignHistory(v => !v)}
                  onMerge={() => setShowMergeDialog(true)}
                  onRename={handleRenameContact}
                  channelConnection={
                    selectedConversation.channelConnectionId
                      ? connectionsById.get(selectedConversation.channelConnectionId)
                      : undefined
                  }
                  isMineConnection={
                    !!(selectedConversation.channelConnectionId && myConnectionIds.has(selectedConversation.channelConnectionId))
                  }
                  // Phase 3.3: só mostra Transferir se há OUTRA connection
                  // do mesmo tipo acessível pro operador (senão sem destino).
                  onTransferChannel={
                    (() => {
                      const sameTypeOthers = channelConnections.filter(c => {
                        if (c.id === selectedConversation.channelConnectionId) return false;
                        if (!c.isActive || !c.isConnected) return false;
                        const convType = selectedConversation.connectedVia === 'baileys' ? 'whatsapp_baileys' : 'whatsapp_cloud';
                        return c.type === convType;
                      });
                      return sameTypeOthers.length > 0
                        ? () => setShowTransferChannelDialog(true)
                        : undefined;
                    })()
                  }
                />

                {/* Assignment history panel */}
                <AnimatePresence>
                  {showAssignHistory && (selectedConversation.assignmentHistory?.length ?? 0) > 0 && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-b border-gray-100 dark:border-white/[0.06] bg-gray-50/50 dark:bg-white/[0.02]">
                      <div className="px-4 py-2.5 space-y-1.5 max-h-40 overflow-y-auto">
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Histórico de atribuições</p>
                        {[...(selectedConversation.assignmentHistory ?? [])].reverse().map((h, i) => (
                          <div key={i} className="flex items-start gap-2 text-[10px]">
                            <div className="w-1 h-1 rounded-full bg-gray-400 mt-1.5 shrink-0" />
                            <div>
                              <span className="text-gray-600 dark:text-gray-400">
                                {h.sectorName ? `Setor: ${h.sectorName}` : h.assignedToName ? `Agente: ${h.assignedToName}` : 'Removido'}
                              </span>
                              <span className="text-gray-400 ml-1">por {h.changedByName} · {new Date(h.changedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Messages area */}
                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10">
                  {isLoadingMessages ? (
                    <div className="flex-1 flex items-center justify-center py-12">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin" />
                        <span className="text-xs text-gray-400 dark:text-gray-500">{t('conversations.loadingMessages', 'Carregando mensagens...')}</span>
                      </div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-12">
                      <div className="flex flex-col items-center gap-2 text-center">
                        <div className="w-10 h-10 rounded-2xl bg-gray-100 dark:bg-white/[0.04] flex items-center justify-center">
                          <MessageSquare className="w-5 h-5 text-gray-300 dark:text-gray-600" />
                        </div>
                        <p className="text-sm text-gray-400 dark:text-gray-500">{t('conversations.noMessagesYet', 'Nenhuma mensagem ainda')}</p>
                        <p className="text-xs text-gray-300 dark:text-gray-600">{t('conversations.sendFirstMessage', 'Envie a primeira mensagem')}</p>
                      </div>
                    </div>
                  ) : (
                    <MessageList
                      messages={messages}
                      conversation={selectedConversation}
                      messagesEndRef={messagesEndRef}
                      onRetry={retryMessage}
                      hasMoreMessages={hasMoreMessages}
                      loadingMoreMessages={loadingMoreMessages}
                      onLoadMore={loadMoreMessages}
                    />
                  )}
                </div>

                {/* WhatsApp 24h window expired banner */}
                {isWindowExpired(selectedConversation) && selectedConversation.channel === 'whatsapp' && (
                  <div className="px-4 py-2 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-100 dark:border-amber-500/20 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {t('conversations.windowExpired', 'Janela de 24h expirada. Apenas mensagens de template podem ser enviadas.')}
                    </p>
                  </div>
                )}

                {/* Template selector dropdown */}
                <AnimatePresence>
                  {showTemplateSelector && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      className="mx-4 mb-2 p-3 bg-white dark:bg-[#1e293b] rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-lg"
                    >
                      <div className="flex items-center justify-between mb-2.5">
                        <h4 className="text-xs font-semibold text-gray-900 dark:text-white">{t('conversations.selectTemplate', 'Selecionar Template')}</h4>
                        <button
                          onClick={() => setShowTemplateSelector(false)}
                          className="w-5 h-5 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {templatesLoading && (
                          <div className="flex items-center justify-center py-4 gap-2 text-gray-400 dark:text-gray-500">
                            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            <span className="text-xs">Carregando templates...</span>
                          </div>
                        )}
                        {templatesError && !templatesLoading && templateList.length === 0 && (
                          <div className="text-xs text-red-500 dark:text-red-400 text-center py-3 px-2">
                            {templatesError}
                          </div>
                        )}
                        {templatesError && !templatesLoading && templateList.length > 0 && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 px-2 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                            <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
                            {templatesError}
                          </div>
                        )}
                        {!templatesLoading && !templatesError && templateList.length === 0 && (
                          <div className="text-xs text-gray-400 dark:text-gray-500 text-center py-3">
                            Nenhum template aprovado encontrado.
                          </div>
                        )}
                        {!templatesLoading && templateList.map((tpl) => (
                          <button
                            key={`${tpl.name}_${tpl.language}`}
                            onClick={() => handleSendTemplate(tpl.name, tpl.language)}
                            disabled={isSending}
                            className="w-full text-left p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors group disabled:opacity-50"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span className="text-sm font-medium text-gray-800 dark:text-gray-200 block truncate">{tpl.name}</span>
                                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2">{tpl.preview}</p>
                              </div>
                              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                <Send className="w-3 h-3 text-gray-300 dark:text-gray-600 group-hover:text-[#25D366] transition-colors" />
                                <span className="text-[9px] uppercase text-gray-400 dark:text-gray-500">{tpl.language}</span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Composer */}
                {(() => {
                  // Cross-operator detection: a conversa está vinculada a uma
                  // connection pessoal de OUTRO operador. Se eu (admin/colega)
                  // responder, a msg sai pelo número dele. Mostra banner amber.
                  const conn = selectedConversation.channelConnectionId
                    ? connectionsById.get(selectedConversation.channelConnectionId)
                    : null;
                  const isCrossOperator = !!(
                    conn &&
                    conn.ownerType === 'user' &&
                    conn.ownerId &&
                    conn.ownerId !== user?.uid
                  );
                  const crossOpWarning = isCrossOperator
                    ? { ownerName: conn!.displayName || 'outro operador' }
                    : undefined;
                  return (
                    <Composer
                      ref={composerRef}
                      onSend={handleSend}
                      onSlashWhenEmpty={handleSlashWhenEmpty}
                      onTyping={sendTypingIndicator}
                      channel={selectedConversation.channel}
                      connectedVia={selectedConversation.connectedVia}
                      isSending={isSending}
                      attachment={attachment}
                      onAttachmentSelect={handleFileSelect}
                      onAttachmentRemove={handleRemoveAttachment}
                      disabled={isWindowExpired(selectedConversation)}
                      onTemplateClick={() => {
                        setShowTemplateSelector(true);
                        if (templateList.length === 0 && !templatesLoading) fetchWhatsappTemplates();
                      }}
                      isInternalNote={isInternalNote}
                      onToggleInternalNote={() => setIsInternalNote(prev => !prev)}
                      onSnippetClick={() => setShowSnippets(true)}
                      crossOperatorWarning={crossOpWarning}
                    />
                  );
                })()}

                {/* Snippets Popup — modo lista (default) ou criação inline (manager+).
                    Padrão Slack: user busca, se não acha, oferece criar com 1 clique
                    sem precisar abrir Configurações → Canais → Respostas. */}
                <AnimatePresence>
                  {showSnippets && (
                    <motion.div
                      ref={snippetsPopupRef}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute bottom-20 left-4 right-4 max-h-[440px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden z-30"
                    >
                      <div className="p-3 border-b border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2">
                          <Slash className="w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            placeholder={snippetCreateMode
                              ? 'Digite o atalho (ex: ola, fim_dia)'
                              : t('conversations.searchSnippets', 'Buscar respostas rápidas...')}
                            value={snippetSearch}
                            onChange={(e) => setSnippetSearch(e.target.value)}
                            className="flex-1 text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none"
                            autoFocus
                          />
                          {canCreateSnippet && !snippetCreateMode && (
                            <button
                              onClick={() => { setSnippetCreateMode(true); setSnippetDraftContent(''); }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                              title="Criar nova resposta rápida"
                            >
                              <Plus className="w-3 h-3" /> Novo
                            </button>
                          )}
                          <button onClick={closeSnippetsPopup} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* MODO CRIAÇÃO inline */}
                      {snippetCreateMode ? (
                        <div className="p-3 space-y-2">
                          <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">
                            Atalho: <code className="font-mono text-red-500 dark:text-red-400">/{snippetSearch.trim().toLowerCase().replace(/\s+/g, '_') || '?'}</code>
                          </div>
                          <textarea
                            value={snippetDraftContent}
                            onChange={(e) => setSnippetDraftContent(e.target.value.slice(0, 2000))}
                            placeholder="Mensagem completa que o atalho vai inserir..."
                            rows={4}
                            className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 resize-none"
                          />
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-400">{snippetDraftContent.length}/2000</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => { setSnippetCreateMode(false); setSnippetDraftContent(''); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                                disabled={snippetSaving}
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={handleQuickCreateSnippet}
                                disabled={snippetSaving || !snippetSearch.trim() || !snippetDraftContent.trim()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                              >
                                {snippetSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                Salvar atalho
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="overflow-y-auto max-h-[360px]">
                          {filteredSnippets.length === 0 ? (
                            <div className="p-4 text-center">
                              <p className="text-xs text-gray-400 dark:text-gray-500">
                                {snippets.length === 0
                                  ? t('conversations.noSnippets', 'Nenhuma resposta rápida cadastrada')
                                  : t('conversations.noSnippetsFound', 'Nenhum resultado encontrado')}
                              </p>
                              {/* Sugestão: criar atalho com o termo da busca atual */}
                              {canCreateSnippet && snippetSearch.trim() && (
                                <button
                                  onClick={() => { setSnippetCreateMode(true); setSnippetDraftContent(''); }}
                                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                                >
                                  <Plus className="w-3 h-3" />
                                  Criar atalho /{snippetSearch.trim().toLowerCase().replace(/\s+/g, '_')}
                                </button>
                              )}
                            </div>
                          ) : (
                            filteredSnippets.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => handleInsertSnippet(s)}
                                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors border-b border-gray-50 dark:border-gray-800/50 last:border-0"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono text-red-500 dark:text-red-400">/{s.shortcode}</span>
                                  {s.sectorId && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                                      {t('conversations.sectorLabel', 'setor')}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{s.content}</p>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Sector Assignment Popup */}
                <AnimatePresence>
                  {showSectorAssign && sectors.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute top-14 right-4 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden z-30"
                    >
                      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('conversations.assignSectorTitle', 'Atribuir Setor')}</span>
                        <button onClick={() => setShowSectorAssign(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="py-1">
                        {sectors.filter(s => s.isActive).map((sector) => (
                          <button
                            key={sector.id}
                            onClick={() => handleAssignSector(sector.id)}
                            className={cn(
                              'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors',
                              selectedConversation?.assignedToSectorId === sector.id && 'bg-red-50 dark:bg-red-500/10'
                            )}
                          >
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: sector.color }} />
                            <span className="text-gray-700 dark:text-gray-300 truncate">{sector.name}</span>
                            {selectedConversation?.assignedToSectorId === sector.id && (
                              <Check className="w-3.5 h-3.5 text-red-500 ml-auto" />
                            )}
                          </button>
                        ))}
                      </div>
                      {/* Toggle private */}
                      <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-800">
                        <button
                          onClick={handleTogglePrivate}
                          className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          {selectedConversation?.isPrivate ? t('conversations.makePublic', 'Tornar pública') : t('conversations.makePrivate', 'Tornar privada')}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Settings Dialog */}
      <AnimatePresence>
        {showSettings && <IntegrationSettingsDialog onClose={() => setShowSettings(false)} />}
        {showSaveViewModal && (
          // key garante remount limpo quando alterna entre create/edit
          // (defensivo: useState do modal só captura initialName/Emoji no
          // primeiro render — sem key, alternar create→edit no mesmo lifecycle
          // mostraria os valores antigos).
          <SaveViewModal
            key={editingView?.id ?? 'new'}
            onSave={handleSaveView}
            onClose={() => { setShowSaveViewModal(false); setEditingView(null); }}
            mode={editingView ? 'edit' : 'create'}
            initialName={editingView?.name}
            initialEmoji={editingView?.emoji}
          />
        )}
        {showBatchAssign && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowBatchAssign(false); }}>
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              className="w-full max-w-xs bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">Atribuir a ({batchSelectedIds.size})</p>
                <button onClick={() => setShowBatchAssign(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {members.map(m => (
                  <button key={m.id} onClick={() => handleBatchAssign(m.uid, m.name)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors text-left">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300">
                      {getInitials(m.name)}
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">{m.name}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
        {showBatchTag && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowBatchTag(false); }}>
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              className="w-full max-w-xs bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">Adicionar tag ({batchSelectedIds.size})</p>
                <button onClick={() => setShowBatchTag(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-3.5 h-3.5" /></button>
              </div>
              <BatchTagInput onAdd={handleBatchTag} existingTags={allLabels} />
            </motion.div>
          </motion.div>
        )}
        {showCSATDashboard && business?.id && (
          <CSATDashboard businessId={business.id} onClose={() => setShowCSATDashboard(false)} />
        )}
        {showMergeDialog && selectedConversation && (
          <MergeConversationsDialog
            source={selectedConversation}
            conversations={conversations}
            onClose={() => setShowMergeDialog(false)}
            onMerge={targetId => handleMergeConversations(selectedConversation.id, targetId)}
          />
        )}
        {showTransferChannelDialog && selectedConversation && (
          <TransferChannelDialog
            conversation={selectedConversation}
            connections={channelConnections}
            myConnectionIds={myConnectionIds}
            onClose={() => setShowTransferChannelDialog(false)}
            onTransferred={() => setShowTransferChannelDialog(false)}
          />
        )}
        <NewConversationDialog
          open={showNewConversation}
          onClose={() => { setShowNewConversation(false); setNewConvPrefill(null); }}
          onCreated={(conv) => {
            // Select immediately; onSnapshot will upgrade with any server-side mutations
            setSelectedConversation(conv);
            setShowMobileThread(true);
            setNewConvPrefill(null);
          }}
          clients={clientsList}
          clientsLoadError={clientsLoadError}
          connections={channelConnections}
          myConnectionIds={myConnectionIds}
          prefill={newConvPrefill}
        />
        {showRoutingRules && isAdmin && business?.id && (
          <RoutingRulesDialog
            rules={routingRules}
            businessId={business.id}
            members={members}
            sectors={sectors}
            onClose={() => setShowRoutingRules(false)}
            onSaved={r => setRoutingRules(r)}
          />
        )}
        {showAnalytics && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-30" onClick={() => setShowAnalytics(false)} />
            <ConversationAnalyticsPanel
              conversations={conversations}
              members={members}
              onClose={() => setShowAnalytics(false)}
            />
          </>
        )}
        {showSLASettings && isAdmin && business?.id && (
          <SLASettingsDialog
            current={slaConfig}
            businessId={business.id}
            onClose={() => setShowSLASettings(false)}
            onSaved={cfg => setSLAConfig(cfg)}
          />
        )}
      </AnimatePresence>

      {/* Link Contact Drawer */}
      <AnimatePresence>
        {linkContactOpen && selectedConversation && business?.id && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLinkContactOpen(false)}
              className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
            />
            <LinkContactDrawer
              conversation={selectedConversation}
              clients={clientsList}
              businessId={business.id}
              onClose={() => setLinkContactOpen(false)}
              onLinked={(clientId) => {
                setSelectedConversation(prev => prev ? { ...prev, crmContactId: clientId || undefined } : prev);
                setLinkContactOpen(false);
              }}
            />
          </>
        )}
      </AnimatePresence>

      {/* Agent Debug Drawer */}
      <AnimatePresence>
        {agentDebugOpen && selectedConversation && business?.id && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAgentDebugOpen(false)}
              className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
            />
            <AgentDebugDrawer
              businessId={business.id}
              conversationId={selectedConversation.id}
              onClose={() => setAgentDebugOpen(false)}
            />
          </>
        )}
      </AnimatePresence>

      {/* Delete conversation confirm */}
      <AnimatePresence>
        {deleteConfirmConv && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6"
            >
              <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-2">Excluir conversa?</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
                A conversa com <strong className="text-gray-700 dark:text-gray-300">{deleteConfirmConv.customContactName ?? deleteConfirmConv.contactName}</strong> será ocultada. As mensagens ficam preservadas e a conversa pode ser restaurada se uma nova mensagem chegar.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirmConv(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={executeDeleteConversation}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
                >
                  Excluir
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
