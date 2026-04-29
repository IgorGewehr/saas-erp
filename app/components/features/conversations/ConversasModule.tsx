'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { getInitials } from '@/lib/utils/format';
import {
  collection,
  query,
  where,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  limit,
  startAfter,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { db, storage } from '@/lib/config/firebase';
import debounce from 'lodash.debounce';
import {
  MessageSquare,
  Search,
  Send,
  Phone,
  MoreVertical,
  Trash2,
  User as UserIcon,
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
  CheckSquare,
  Square,
  UserCheck,
  CheckCircle,
  TagIcon,
  MailOpen,
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

import type { BusinessSettings } from '@/lib/types';
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
        status === 'open' && 'bg-emerald-400',
        status === 'waiting' && 'bg-amber-400',
        status === 'resolved' && 'bg-gray-400',
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
}

function ConversationItem({ conversation, isSelected, onClick, slaInfo, batchMode, isBatchSelected, onBatchToggle }: ConversationItemProps) {
  const { t } = useTranslation();
  const cfg = getConvConfig(conversation);
  const initials = getInitials(conversation.contactName);

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ x: 2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(
        'w-full text-left px-3 py-3 flex items-start gap-3 transition-colors duration-150 relative',
        isSelected
          ? 'bg-red-50 dark:bg-red-500/[0.08] border-l-2 border-red-500'
          : 'border-l-2 border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.03]',
      )}
    >
      {/* Batch checkbox */}
      {batchMode && (
        <button onClick={e => { e.stopPropagation(); onBatchToggle?.(); }}
          className="flex-shrink-0 mt-0.5 text-gray-400 hover:text-red-500 transition-colors">
          {isBatchSelected
            ? <CheckSquare className="w-5 h-5 text-red-500" />
            : <Square className="w-5 h-5" />}
        </button>
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
              alt={conversation.contactName}
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
              {conversation.contactName}
            </span>
          </div>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 whitespace-nowrap">
            {relativeTime(conversation.lastMessageAt, t)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate leading-relaxed">
            {conversation.lastMessageDirection === 'outbound' && (
              <span className="text-gray-400 dark:text-gray-500 mr-1">{t('conversations.you', 'Você:')}</span>
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
    </motion.button>
  );
}

// ─── Settings Dialog ─────────────────────────────────────────────────────────

function IntegrationSettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { business } = useAuth();
  const { setActivePage } = useAppContext();

  const channels = business?.channels;
  const integrations = [
    {
      channel: 'whatsapp' as ConversationChannel,
      name: 'WhatsApp Business',
      description: channels?.whatsapp?.isConnected
        ? `Conectado: ${channels.whatsapp.displayPhoneNumber || channels.whatsapp.phoneNumberId || ''}`
        : 'Receba e envie mensagens via API oficial do WhatsApp Business',
      isConnected: channels?.whatsapp?.isConnected || false,
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
  aiEnabledBusinessWide,
  sectors: sectorsList,
  slaInfo,
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
  aiEnabledBusinessWide?: boolean;
  sectors?: Sector[];
  slaInfo?: SLAInfo | null;
}) {
  const { t } = useTranslation();
  const cfg = getConvConfig(conversation);
  const initials = getInitials(conversation.contactName);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const overflowRef = useRef<HTMLDivElement | null>(null);

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
    { value: 'open', label: t('conversations.statusOpen', 'Aberta'), color: 'text-emerald-600 dark:text-emerald-400' },
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
                alt={conversation.contactName}
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
            <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
              {conversation.contactName}
            </span>
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
                    Exportar histórico (.txt)
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

function MediaAttachment({
  mediaUrl,
  mediaType,
}: {
  mediaUrl: string;
  mediaType?: ConversationMessage['mediaType'];
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
    return (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-1.5 flex items-center gap-2 px-3 py-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors min-w-[160px]"
      >
        <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{t('conversations.mediaDocument', 'Documento')}</span>
      </a>
    );
  }

  return null;
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

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
      <div className={cn('max-w-[75%] sm:max-w-[65%] flex flex-col', isOut ? 'items-end' : 'items-start')}>
        {/* Media attachment */}
        {message.mediaUrl && message.mediaType && (
          <MediaAttachment mediaUrl={message.mediaUrl} mediaType={message.mediaType} />
        )}

        {/* Text content */}
        {message.content && (
          <div
            className={cn(
              'relative px-3.5 py-2.5 text-sm leading-relaxed shadow-sm',
              message.isInternal
                ? 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-500/30 text-amber-900 dark:text-amber-100 rounded-2xl'
                : isOut
                  ? 'bg-gradient-to-br from-red-600 to-red-500 text-white rounded-2xl rounded-tr-sm'
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

        {/* Time + status */}
        <div
          className={cn(
            'flex items-center gap-1 mt-1 px-1',
            isOut ? 'flex-row-reverse' : 'flex-row',
          )}
        >
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {fullTime(message.sentAt)}
          </span>
          {isOut && <MessageStatusIcon status={message.status} />}
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

function Composer({
  value,
  onChange,
  onSend,
  onKeyDown,
  inputRef,
  channel,
  isSending,
  attachment,
  onAttachmentSelect,
  onAttachmentRemove,
  disabled,
  onTemplateClick,
  isInternalNote,
  onToggleInternalNote,
  onSnippetClick,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  channel: ConversationChannel;
  isSending: boolean;
  attachment: File | null;
  onAttachmentSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAttachmentRemove: () => void;
  disabled?: boolean;
  onTemplateClick?: () => void;
  isInternalNote?: boolean;
  onToggleInternalNote?: () => void;
  onSnippetClick?: () => void;
}) {
  const { t } = useTranslation();
  const cfg = CHANNEL_CONFIG[channel];
  const hasContent = value.trim().length > 0 || !!attachment;
  const isDisabled = disabled || false;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate thumbnail preview for images
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (attachment && attachment.type.startsWith('image/')) {
      const url = URL.createObjectURL(attachment);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [attachment]);

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
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <Smile className="w-4 h-4" />
          </motion.button>
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
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={t('conversations.messagePlaceholder', 'Digite uma mensagem...')}
            disabled={isSending}
            className="w-full resize-none bg-gray-100 dark:bg-white/[0.04] border border-transparent dark:border-white/[0.06] rounded-2xl px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:bg-white dark:focus:bg-white/[0.06] transition-colors leading-relaxed max-h-36 overflow-y-auto disabled:opacity-50"
            style={{ minHeight: '42px' }}
          />
          {value.length > 200 && (
            <span className="absolute bottom-1 right-3 text-[10px] text-gray-400 dark:text-gray-600">
              {value.length}/1000
            </span>
          )}
        </div>

        {/* Send button */}
        <motion.button
          onClick={onSend}
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
}

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

function SavedViewsBar({ views, activeViewId, onSelect, onDelete }: {
  views: ConversationView[];
  activeViewId: string | null;
  onSelect: (view: ConversationView) => void;
  onDelete: (viewId: string) => void;
}) {
  if (views.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 px-4 pb-2 overflow-x-auto scrollbar-none flex-shrink-0">
      {views.map(view => {
        const isActive = activeViewId === view.id;
        return (
          <div key={view.id} className={cn('flex items-center gap-1 rounded-lg border text-[10px] font-semibold whitespace-nowrap transition-all',
            isActive
              ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400'
              : 'bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600')}>
            <button onClick={() => onSelect(view)} className="flex items-center gap-1 pl-2.5 py-1.5">
              {view.emoji && <span>{view.emoji}</span>}
              <BookmarkCheck className="w-2.5 h-2.5 opacity-60" />
              {view.name}
            </button>
            <button onClick={() => onDelete(view.id)}
              className="pr-1.5 py-1.5 opacity-50 hover:opacity-100 transition-opacity">
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Save View Modal ─────────────────────────────────────────────────────────

function SaveViewModal({ onSave, onClose }: {
  onSave: (name: string, emoji: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🔖');
  const [saving, setSaving] = useState(false);
  const EMOJIS = ['🔖', '⭐', '🔥', '📌', '💼', '🎯', '📋', '🚨', '💬', '✅'];

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave(name.trim(), emoji); onClose(); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-xs bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">Salvar view</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"><X className="w-3.5 h-3.5" /></button>
        </div>
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
            {saving ? 'Salvando...' : 'Salvar'}
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
        <span className="text-xs text-gray-300 flex-1">selecionada{count !== 1 ? 's' : ''}</span>

        <div className="flex items-center gap-1.5">
          <button onClick={onMarkRead} title="Marcar como lida"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-semibold transition-colors">
            <MailOpen className="w-3 h-3" /> Lida
          </button>
          <button onClick={onAssign} title="Atribuir"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-semibold transition-colors">
            <UserCheck className="w-3 h-3" /> Atribuir
          </button>
          <div className="relative">
            <button onClick={() => setShowStatus(v => !v)} title="Mudar status"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-semibold transition-colors">
              <CheckCircle className="w-3 h-3" /> Status
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
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-semibold transition-colors">
            <TagIcon className="w-3 h-3" /> Tag
          </button>
        </div>

        <button onClick={onCancel} className="ml-1 p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
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
                  className={cn('w-8 h-4.5 rounded-full transition-colors flex-shrink-0 relative', rule.enabled ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600')} style={{ height: 18 }}>
                  <span className={cn('absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform', rule.enabled ? 'translate-x-4' : 'translate-x-0.5')} />
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

// ─── Status Filter Tabs ──────────────────────────────────────────────────────

function StatusFilterBar({
  activeStatus,
  onStatusChange,
  counts,
}: {
  activeStatus: ConversationStatus | 'all';
  onStatusChange: (status: ConversationStatus | 'all') => void;
  counts: Record<string, number>;
}) {
  const { t } = useTranslation();
  const statuses: { id: ConversationStatus | 'all'; label: string }[] = [
    { id: 'all', label: t('conversations.statusAll', 'Todas') },
    { id: 'open', label: t('conversations.statusOpen', 'Abertas') },
    { id: 'waiting', label: t('conversations.statusWaiting', 'Aguardando') },
    { id: 'resolved', label: t('conversations.statusResolved', 'Resolvidas') },
  ];

  return (
    <div className="flex gap-1 px-4 pb-2">
      {statuses.map((s) => {
        const isActive = activeStatus === s.id;
        const count = s.id === 'all' ? counts.all || 0 : counts[s.id] || 0;
        return (
          <button
            key={s.id}
            onClick={() => onStatusChange(s.id)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all duration-150',
              isActive
                ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/[0.04] hover:text-gray-600 dark:hover:text-gray-300',
            )}
          >
            {s.id !== 'all' && <StatusDot status={s.id} />}
            {s.label}
            {count > 0 && (
              <span className={cn(
                'text-[9px] min-w-[14px] h-[14px] rounded-full flex items-center justify-center px-0.5',
                isActive
                  ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                  : 'bg-gray-100 dark:bg-white/[0.06] text-gray-400',
              )}>
                {count}
              </span>
            )}
          </button>
        );
      })}
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
  const convName = (conv.contactName || '').toLowerCase().trim();
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
      const payload: Record<string, unknown> = {
        businessId,
        name: conversation.contactName || 'Novo contato',
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
                  Cria <strong>{conversation.contactName || 'este contato'}</strong>
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
    import('firebase/firestore').then(({ collection, query, where, orderBy, limit, onSnapshot }) => {
      const q = query(
        collection(db, 'agentRuns'),
        where('businessId', '==', businessId),
        where('conversationId', '==', conversationId),
        orderBy('createdAt', 'desc'),
        limit(10),
      );
      const unsub = onSnapshot(q,
        (snap) => {
          setRuns(snap.docs.map(d => ({ ...(d.data() as AgentRun), id: d.id })));
          setLoading(false);
        },
        () => setLoading(false),
      );
      return () => unsub();
    });
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
  const { user, business, sectors, userSectorIds } = useAuth();
  const { setActivePage } = useAppContext();

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

  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'clients'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      setClientsList(snap.docs.map(d => ({ ...(d.data() as Client), id: d.id })));
    });
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
      await updateDoc(doc(db, 'conversations', deleteConfirmConv.id), {
        isDeleted: true,
        deletedAt: new Date().toISOString(),
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

  const handleOpenContact = useCallback((conv: Conversation) => {
    // Navigate to the clients page — they can find/edit there
    setActivePage('Clientes');
  }, [setActivePage]);

  const handleExportHistory = useCallback(async (conv: Conversation) => {
    try {
      const snap = await (await import('firebase/firestore')).getDocs(
        (await import('firebase/firestore')).query(
          (await import('firebase/firestore')).collection(db, 'conversationMessages'),
          (await import('firebase/firestore')).where('conversationId', '==', conv.id),
          (await import('firebase/firestore')).orderBy('sentAt', 'asc'),
        ),
      );
      const lines = snap.docs.map(d => {
        const m = d.data();
        const time = m.sentAt ? new Date(m.sentAt).toLocaleString('pt-BR') : '?';
        const who = m.direction === 'inbound' ? conv.contactName : (m.senderName || 'Equipe');
        return `[${time}] ${who}: ${typeof m.content === 'string' ? m.content : '[mídia]'}`;
      });
      const content = `Conversa com ${conv.contactName}\nCanal: ${conv.channel}\nExportado em: ${new Date().toLocaleString('pt-BR')}\n\n${lines.join('\n')}\n`;
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversa-${conv.contactName.replace(/\s+/g, '_')}-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('[Conversations] Export failed:', err);
    }
  }, []);

  const handleCreateOrderFromConversation = useCallback((conv: Conversation) => {
    // Stash prefill for OrdersModule to pick up on mount.
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('pendingOrderPrefill', JSON.stringify({
        clientId: conv.crmContactId || '',
        clientName: conv.contactName,
        clientPhone: conv.contactPhone || '',
        channel: conv.channel,
        conversationId: conv.id,
        contactExternalId: conv.contactExternalId || '',
      }));
    }
    setActivePage('Pedidos');
  }, [setActivePage]);

  const [activeChannel, setActiveChannel] = useState<ConversationChannel | 'all'>('all');
  const [activeStatus, setActiveStatus] = useState<ConversationStatus | 'all'>('all');
  const [activeSectorFilter, setActiveSectorFilter] = useState<string | 'all'>('all');
  const [advFilters, setAdvFilters] = useState<AdvancedFilters>(EMPTY_ADV_FILTERS);
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  const [savedViews, setSavedViews] = useState<ConversationView[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchAssign, setShowBatchAssign] = useState(false);
  const [showBatchTag, setShowBatchTag] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [messageInput, setMessageInput] = useState('');
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isAdmin = ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY['admin'];

  // ── SLA breach notifications ───────────────────────────────────────────────
  useEffect(() => {
    if (!slaConfig.enabled) return;
    for (const conv of conversations) {
      const info = getSLAInfo(conv, slaConfig);
      if (info?.status === 'breached' && !notifiedBreachIdsRef.current.has(conv.id)) {
        notifiedBreachIdsRef.current.add(conv.id);
        toast.warn(`⏱ SLA vencido: ${conv.contactName}`, { toastId: `sla-${conv.id}`, autoClose: 8000 });
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
        appliedRoutingRef.current.add(conv.id);
        const now = new Date().toISOString();
        if (action.type === 'assign_sector' && action.sectorId) {
          updateDoc(doc(db, 'conversations', conv.id), { assignedToSectorId: action.sectorId, sectorIds: [action.sectorId], updatedAt: now }).catch(console.error);
        } else if (action.type === 'assign_user' && action.userId) {
          updateDoc(doc(db, 'conversations', conv.id), { assignedTo: action.userId, assignedToName: action.userName, updatedAt: now }).catch(console.error);
        } else if (action.type === 'set_priority' && action.priority) {
          updateDoc(doc(db, 'conversations', conv.id), { priority: action.priority, updatedAt: now }).catch(console.error);
        }
        break; // First matching rule wins
      }
    }
  }, [conversations, routingRules, business?.id]);

  // ── Real-time: Conversations list ──────────────────────────────────────────

  useEffect(() => {
    if (!business?.id) return;

    setIsLoadingConversations(true);

    const q = query(
      collection(db, 'conversations'),
      where('businessId', '==', business.id),
      orderBy('lastMessageAt', 'desc'),
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as Conversation & { isDeleted?: boolean }))
        .filter((c) => !c.isDeleted);
      setConversations(data);
      setIsLoadingConversations(false);

      // Update selected conversation if it exists in the new data
      setSelectedConversation((prev) => {
        if (!prev) return prev;
        const updated = data.find((c) => c.id === prev.id);
        return updated || prev;
      });
    });

    return () => unsub();
  }, [business?.id]);

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
    const q = query(collection(db, 'conversationViews'), where('businessId', '==', business.id), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => setSavedViews(snap.docs.map(d => ({ ...d.data(), id: d.id } as ConversationView))));
    return () => unsub();
  }, [business?.id]);

  const handleSaveView = async (name: string, emoji: string) => {
    if (!business?.id || !user) return;
    const filters = {
      channel: activeChannel !== 'all' ? activeChannel : undefined,
      status: activeStatus !== 'all' ? activeStatus : undefined,
      sectorId: activeSectorFilter !== 'all' ? activeSectorFilter : undefined,
      assignedTo: advFilters.assignedTo || undefined,
      priority: advFilters.priority || undefined,
      label: advFilters.label || undefined,
      slaStatus: advFilters.slaStatus || undefined,
      unreadOnly: advFilters.unreadOnly || undefined,
    };
    await addDoc(collection(db, 'conversationViews'), {
      businessId: business.id, name, emoji,
      filters,
      createdBy: user.uid, createdByName: user.name,
      createdAt: new Date().toISOString(),
    });
  };

  const handleDeleteView = async (viewId: string) => {
    try {
      await deleteDoc(doc(db, 'conversationViews', viewId));
      if (activeViewId === viewId) { setActiveViewId(null); }
    } catch (err) { console.error('[Views] Delete error:', err); }
  };

  const handleSelectView = (view: ConversationView) => {
    if (activeViewId === view.id) {
      // Deselect
      setActiveViewId(null);
      setActiveChannel('all'); setActiveStatus('all'); setActiveSectorFilter('all');
      setAdvFilters(EMPTY_ADV_FILTERS);
      return;
    }
    setActiveViewId(view.id);
    setActiveChannel((view.filters.channel as ConversationChannel | 'all') ?? 'all');
    setActiveStatus((view.filters.status as ConversationStatus | 'all') ?? 'all');
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
    toast.success(`${batchSelectedIds.size} conversa(s) atualizada(s)`);
    exitBatchMode();
  }, [business?.id, batchSelectedIds, exitBatchMode]);

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
    if (!business?.id || batchSelectedIds.size === 0) return;
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    for (const id of batchSelectedIds) batch.update(doc(db, 'conversations', id), { assignedTo: userId, assignedToName: userName, updatedAt: now });
    await batch.commit();
    toast.success(`${batchSelectedIds.size} conversa(s) atribuída(s) a ${userName}`);
    setShowBatchAssign(false);
    exitBatchMode();
  }, [business?.id, batchSelectedIds, exitBatchMode]);

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

    setIsLoadingMessages(true);
    setHasMoreMessages(false);
    setOldestMessageTimestamp(null);

    // Load latest 50 messages in real-time
    const q = query(
      collection(db, 'conversationMessages'),
      where('businessId', '==', business.id),
      where('conversationId', '==', selectedConversation.id),
      orderBy('sentAt', 'desc'),
      limit(50),
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as ConversationMessage))
        .reverse(); // Reverse to show oldest first (chronological order)

      setMessages((prev) => {
        // If we had loaded older messages, preserve them and merge with real-time updates
        if (prev.length > 50) {
          const olderMessages = prev.slice(0, prev.length - 50);
          // Deduplicate: remove any older messages that appear in the new batch
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
    });

    return () => unsub();
  }, [selectedConversation?.id, business?.id]);

  // ── Auto-scroll to bottom ──────────────────────────────────────────────────

  // Scroll the messages container to the absolute bottom.
  // Using scrollTop = scrollHeight directly on the container is more reliable than
  // scrollIntoView, which can be affected by other scrollable ancestors.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = messagesContainerRef.current;
    if (!container) return;
    if (behavior === 'instant') {
      container.scrollTop = container.scrollHeight;
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior });
    }
  }, []);

  // Track the conversation ID for which we've already done the initial instant scroll
  const initialScrollDoneRef = useRef<string | null>(null);

  // Reset initial scroll flag when conversation changes
  useEffect(() => {
    if (selectedConversation?.id) {
      initialScrollDoneRef.current = null;
    }
  }, [selectedConversation?.id]);

  // Scroll to bottom when messages finish loading for the first time in a conversation.
  // Two-pass strategy: immediate rAF for text messages, delayed pass for images/media
  // that finish loading after the initial DOM paint and would otherwise push content down.
  useEffect(() => {
    if (
      !isLoadingMessages &&
      selectedConversation?.id &&
      messages.length > 0 &&
      initialScrollDoneRef.current !== selectedConversation.id
    ) {
      initialScrollDoneRef.current = selectedConversation.id;

      // Pass 1: scroll as soon as the DOM is painted (catches text-only conversations)
      requestAnimationFrame(() => scrollToBottom('instant'));

      // Pass 2: re-scroll after a short delay to catch images/media that load
      // asynchronously and shift layout after the first scroll
      setTimeout(() => scrollToBottom('instant'), 350);
    }
  }, [isLoadingMessages, selectedConversation?.id, messages.length, scrollToBottom]);

  // Smooth scroll when a new message arrives after the initial load
  useEffect(() => {
    if (
      selectedConversation &&
      messages.length > 0 &&
      !isLoadingOlderRef.current &&
      initialScrollDoneRef.current === selectedConversation.id
    ) {
      scrollToBottom('smooth');
    }
  }, [messages.length, selectedConversation, scrollToBottom]);

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
    try {
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/channels/whatsapp-templates?businessId=${business.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setTemplatesError(data.error || 'Erro ao carregar templates.');
        return;
      }
      const data = await res.json();
      setTemplateList(data.templates || []);
    } catch {
      setTemplatesError('Erro ao carregar templates.');
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

      try {
        // 1. Save template message to Firestore
        await addDoc(collection(db, 'conversationMessages'), {
          conversationId: selectedConversation.id,
          businessId: business.id,
          channel: selectedConversation.channel,
          direction: 'outbound' as const,
          content: `[Template: ${templateName}]`,
          status: 'sending' as const,
          senderName: user.name,
          sentAt: now,
        });

        // 2. Update conversation metadata (set firstResponseAt if this is the first reply)
        await updateDoc(doc(db, 'conversations', selectedConversation.id), {
          lastMessage: `[Template: ${templateName}]`,
          lastMessageAt: now,
          lastMessageDirection: 'outbound',
          updatedAt: now,
          ...(!selectedConversation.firstResponseAt ? { firstResponseAt: now } : {}),
        });

        // 3. Send via API as template
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
              channel: selectedConversation.channel,
              recipientId: selectedConversation.contactExternalId,
              content: `[Template: ${templateName}]`,
              type: 'template',
              templateName,
              templateLanguage,
            }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
            toast.error(`Falha ao enviar template "${templateName}": ${errBody.error || 'erro desconhecido'}${errBody.metaCode ? ` (Meta #${errBody.metaCode})` : ''}`);
            console.error('[SendTemplate] API error:', errBody);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(`Erro de conexão ao enviar template: ${msg}`);
        }
      } catch (err) {
        console.error('Error sending template message:', err);
      } finally {
        setIsSending(false);
      }
    },
    [selectedConversation, business?.id, user, isSending],
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
        // Send read receipt for the last inbound message
        const lastInbound = messages
          .filter((m) => m.direction === 'inbound' && m.externalMessageId)
          .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
        if (lastInbound?.externalMessageId) {
          sendReadReceipt(conv, lastInbound.externalMessageId);
        }
      }
    },
    [markAsRead, messages, sendReadReceipt],
  );

  // ── Typing indicator (Task 4) ─────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sendTypingIndicator = useMemo(
    () => debounce(async () => {
      if (!selectedConversation || !business?.id) return;
      try {
        await fetch('/api/conversations/typing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: business.id,
            channel: selectedConversation.channel,
            recipientId: selectedConversation.contactExternalId,
          }),
        });
      } catch {
        // Silent fail - typing indicators are non-critical
      }
    }, 3000, { leading: true, trailing: false }),
    [selectedConversation, business?.id],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => { sendTypingIndicator.cancel(); };
  }, [sendTypingIndicator]);

  // ── File attachment handling (Task 1) ──────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      alert(t('conversations.fileTooLarge', 'Arquivo muito grande. Máximo 16MB.'));
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

  const sendMediaMessage = useCallback(async (file: File) => {
    if (!selectedConversation || !business?.id || !user) return;

    const mediaType: 'image' | 'video' | 'audio' | 'document' = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio'
      : 'document';
    const now = new Date().toISOString();
    const messageContent = mediaType === 'document' ? file.name : '';

    let msgRef: Awaited<ReturnType<typeof addDoc>> | null = null;

    try {
      // 1. Upload to Firebase Storage with explicit content-type so Meta APIs receive
      //    the correct MIME header when fetching the file.
      const storageRef = ref(storage, `conversations/${business.id}/${selectedConversation.id}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });
      const mediaUrl = await getDownloadURL(storageRef);

      // 2. Save to Firestore with 'sending' status
      msgRef = await addDoc(collection(db, 'conversationMessages'), {
        conversationId: selectedConversation.id,
        businessId: business.id,
        channel: selectedConversation.channel,
        direction: 'outbound' as const,
        content: messageContent,
        mediaUrl,
        mediaType,
        status: 'sending' as const,
        senderName: user.name,
        sentAt: now,
      });

      // 3. Update conversation last-message preview
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

      // 4. Send via Meta API
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
          channel: selectedConversation.channel,
          recipientId: selectedConversation.contactExternalId,
          content: file.name,
          type: 'media',
          mediaUrl,
          mediaType,
        }),
      });

      if (sendRes.ok) {
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

    // Re-send via API
    try {
      const authInstance = getAuth();
      const token = await authInstance.currentUser?.getIdToken();
      await fetch('/api/conversations/send', {
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
    } catch {
      await updateDoc(doc(db, 'conversationMessages', msg.id), { status: 'failed' });
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

  const handleSend = useCallback(async () => {
    const hasText = messageInput.trim().length > 0;
    const hasFile = !!attachment;
    if ((!hasText && !hasFile) || !selectedConversation || !business?.id || !user || isSending) return;

    const content = messageInput.trim();
    const currentAttachment = attachment;
    setMessageInput('');
    setAttachment(null);
    setIsSending(true);

    // If there is a media attachment, send it (errors are handled + toasted inside sendMediaMessage)
    if (currentAttachment) {
      await sendMediaMessage(currentAttachment);
    }

    // If no text, just finish
    if (!hasText) {
      setIsSending(false);
      inputRef.current?.focus();
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
            console.error('[Send] API error:', errBody);
            await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' }).catch(e => console.warn('[Conversations] Failed to mark message as failed:', e));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(`Erro de conexão ao enviar mensagem: ${msg}`);
          await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' }).catch(e => console.warn('[Conversations] Failed to mark message as failed:', e));
        }
      }
    } catch (err) {
      console.error('Error sending message:', err);
      // Restore input if Firestore write failed
      setMessageInput(content);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageInput, attachment, selectedConversation, business?.id, user, isSending, sendMediaMessage, isInternalNote]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Trigger snippet autocomplete with /
      if (e.key === '/' && messageInput === '') {
        setShowSnippets(true);
        setSnippetSearch('');
      }
    },
    [handleSend, messageInput],
  );

  // ── Snippet insertion ──────────────────────────────────────────────────────

  const handleInsertSnippet = useCallback((snippet: Snippet) => {
    let content = snippet.content;
    // Replace {{contact.name}} with actual contact name
    if (selectedConversation) {
      content = content.replace(/\{\{contact\.name\}\}/g, selectedConversation.contactName);
    }
    setMessageInput(content);
    setShowSnippets(false);
    inputRef.current?.focus();
  }, [selectedConversation]);

  // ── Sector assignment ──────────────────────────────────────────────────────

  const handleAssignSector = useCallback(async (sectorId: string) => {
    if (!selectedConversation || !business?.id) return;
    const sector = sectors.find(s => s.id === sectorId);
    try {
      await updateDoc(doc(db, 'conversations', selectedConversation.id), {
        assignedToSectorId: sectorId,
        sectorIds: [sectorId],
        updatedAt: new Date().toISOString(),
      });
      setShowSectorAssign(false);
    } catch (err) {
      console.error('Error assigning sector:', err);
    }
  }, [selectedConversation, business?.id, sectors]);

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

  const filteredConversations = getVisibleConversations(conversations).filter((c) => {
    const matchesChannel = activeChannel === 'all' || c.channel === activeChannel;
    const matchesStatus = activeStatus === 'all' || c.status === activeStatus;
    const matchesSector = activeSectorFilter === 'all' || c.sectorIds?.includes(activeSectorFilter) || c.assignedToSectorId === activeSectorFilter;
    const matchesSearch =
      !searchQuery ||
      c.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.contactPhone && c.contactPhone.includes(searchQuery));
    // Advanced filters
    const matchesAssigned = !advFilters.assignedTo || c.assignedTo === advFilters.assignedTo;
    const matchesPriority = !advFilters.priority || c.priority === advFilters.priority;
    const matchesLabel = !advFilters.label || c.labels?.includes(advFilters.label) || c.tags?.includes(advFilters.label);
    const matchesUnread = !advFilters.unreadOnly || (c.unreadCount ?? 0) > 0;
    const matchesSLAStatus = !advFilters.slaStatus || getSLAInfo(c, slaConfig)?.status === advFilters.slaStatus;
    return matchesChannel && matchesStatus && matchesSector && matchesSearch && matchesAssigned && matchesPriority && matchesLabel && matchesUnread && matchesSLAStatus;
  });

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

  const unreadByChannel = conversations.reduce(
    (acc, c) => {
      acc[c.channel] = (acc[c.channel] ?? 0) + c.unreadCount;
      acc.all = (acc.all ?? 0) + c.unreadCount;
      return acc;
    },
    {} as Record<string, number>,
  );

  // ── Counts per status ──────────────────────────────────────────────────────

  const countsByStatus = conversations.reduce(
    (acc, c) => {
      // Only count conversations matching current channel filter
      if (activeChannel !== 'all' && c.channel !== activeChannel) return acc;
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      acc.all = (acc.all ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // ── Tabs ────────────────────────────────────────────────────────────────────

  const tabs: { id: ConversationChannel | 'all'; label: string }[] = [
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
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center shadow-lg shadow-red-500/25">
                  <MessageSquare className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h1 className="font-display font-bold text-gray-900 dark:text-white text-base leading-tight">
                    {t('conversations.title', 'Conversas')}
                  </h1>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">
                    {isLoadingConversations
                      ? t('conversations.loading', 'Carregando...')
                      : t(filteredConversations.length === 1 ? 'conversations.conversationCount_one' : 'conversations.conversationCount_other', filteredConversations.length === 1 ? '{{count}} conversa' : '{{count}} conversas', { count: filteredConversations.length })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
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
                {isAdmin && (
                  <>
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                      onClick={() => setShowSLASettings(true)}
                      title="Configurar SLA"
                      className={cn('w-8 h-8 rounded-xl flex items-center justify-center transition-colors',
                        slaConfig.enabled
                          ? 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400'
                          : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      )}>
                      <Clock className="w-4 h-4" />
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                      onClick={async () => {
                        if (!business?.id) return;
                        await updateDoc(doc(db, 'businesses', business.id), { 'settings.csatEnabled': !csatEnabled, updatedAt: new Date().toISOString() });
                        toast.success(!csatEnabled ? 'CSAT ativado' : 'CSAT desativado');
                      }}
                      title={csatEnabled ? 'CSAT ativo — clique para desativar / ver dashboard' : 'Ativar CSAT'}
                      onDoubleClick={() => setShowCSATDashboard(true)}
                      className={cn('w-8 h-8 rounded-xl flex items-center justify-center transition-colors',
                        csatEnabled
                          ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      )}>
                      <span className="text-sm leading-none">⭐</span>
                    </motion.button>
                  </>
                )}
                <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => setShowAnalytics(v => !v)}
                  title="Analytics de conversas"
                  className={cn('w-8 h-8 rounded-xl flex items-center justify-center transition-colors',
                    showAnalytics
                      ? 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400'
                      : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  )}>
                  <BarChart3 className="w-4 h-4" />
                </motion.button>
                {isAdmin && (
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    onClick={() => setShowRoutingRules(true)}
                    title="Regras de roteamento"
                    className={cn('w-8 h-8 rounded-xl flex items-center justify-center transition-colors',
                      routingRules.some(r => r.enabled)
                        ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400'
                        : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    )}>
                    <ArrowRightLeft className="w-4 h-4" />
                  </motion.button>
                )}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowSettings(true)}
                  className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                </motion.button>
              </div>
            </div>

            {/* Search + filter button */}
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

          {/* Channel Tabs */}
          <div className="px-3 pb-1 flex-shrink-0">
            <div className="flex gap-0.5">
              {tabs.map((tab) => {
                const isActive = activeChannel === tab.id;
                const unread = tab.id === 'all' ? unreadByChannel.all : unreadByChannel[tab.id];
                const cfg = tab.id !== 'all' ? CHANNEL_CONFIG[tab.id as ConversationChannel] : null;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveChannel(tab.id)}
                    className={cn(
                      'flex items-center gap-1 min-w-0 px-1.5 py-1.5 rounded-lg text-[10.5px] font-semibold transition-all duration-150 whitespace-nowrap',
                      isActive
                        ? 'bg-gray-900 dark:bg-white/[0.12] text-white dark:text-white'
                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:text-gray-800 dark:hover:text-gray-200',
                    )}
                  >
                    {tab.id !== 'all' && cfg && (
                      <span className={cn('flex-shrink-0', isActive ? 'text-current' : cfg.textColor)}>
                        <ChannelIcon channel={tab.id as ConversationChannel} size="sm" />
                      </span>
                    )}
                    <span className="truncate">{tab.label}</span>
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

          {/* Status Filter */}
          <StatusFilterBar
            activeStatus={activeStatus}
            onStatusChange={setActiveStatus}
            counts={countsByStatus}
          />

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
                {filteredConversations.length === 0 ? (
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
                    ) : (
                      <>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          {t('conversations.noConversationsFound', 'Nenhuma conversa encontrada')}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {t('conversations.noConversationsFoundDesc', 'Tente mudar o filtro ou a busca')}
                        </p>
                      </>
                    )}
                  </motion.div>
                ) : (
                  filteredConversations.map((conv, index) => (
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
                    return (
                      <motion.div
                        key={ch}
                        whileHover={{ y: -3 }}
                        className={cn(
                          'flex flex-col items-center gap-1.5 px-4 py-2.5 rounded-xl border cursor-pointer transition-colors',
                          cfg.bgColor,
                          cfg.borderColor,
                        )}
                        onClick={() => setActiveChannel(ch)}
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
                  onTogglePrivate={handleTogglePrivate}
                  onExport={() => handleExportHistory(selectedConversation)}
                  aiEnabledBusinessWide={aiAgentEnabled}
                  sectors={sectors}
                  slaInfo={getSLAInfo(selectedConversation, slaConfig)}
                />

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
                        {templatesError && !templatesLoading && (
                          <div className="text-xs text-red-500 dark:text-red-400 text-center py-3 px-2">
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
                <Composer
                  value={messageInput}
                  onChange={(v) => { setMessageInput(v); sendTypingIndicator(); }}
                  onSend={handleSend}
                  onKeyDown={handleKeyDown}
                  inputRef={inputRef}
                  channel={selectedConversation.channel}
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
                />

                {/* Snippets Popup */}
                <AnimatePresence>
                  {showSnippets && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute bottom-20 left-4 right-4 max-h-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden z-30"
                    >
                      <div className="p-3 border-b border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2">
                          <Slash className="w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            placeholder={t('conversations.searchSnippets', 'Buscar respostas rápidas...')}
                            value={snippetSearch}
                            onChange={(e) => setSnippetSearch(e.target.value)}
                            className="flex-1 text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none"
                            autoFocus
                          />
                          <button onClick={() => setShowSnippets(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="overflow-y-auto max-h-48">
                        {filteredSnippets.length === 0 ? (
                          <div className="p-4 text-center text-xs text-gray-400 dark:text-gray-500">
                            {snippets.length === 0 ? t('conversations.noSnippets', 'Nenhuma resposta rápida cadastrada') : t('conversations.noSnippetsFound', 'Nenhum resultado encontrado')}
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
          <SaveViewModal
            onSave={handleSaveView}
            onClose={() => setShowSaveViewModal(false)}
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
                A conversa com <strong className="text-gray-700 dark:text-gray-300">{deleteConfirmConv.contactName}</strong> será ocultada. As mensagens ficam preservadas e a conversa pode ser restaurada se uma nova mensagem chegar.
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
