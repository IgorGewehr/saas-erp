'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { getInitials } from '@/lib/utils/format';
import {
  collection,
  query,
  where,
  orderBy,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  limit,
  startAfter,
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
  Info,
  MoreVertical,
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
  FileText,
  Headphones,
  Video,
  RotateCcw,
  Lock,
  StickyNote,
  Hash,
  Tag,
  Layers,
  ArrowRightLeft,
  Flag,
  Slash,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { getDocs } from 'firebase/firestore';
import type {
  Conversation,
  ConversationMessage,
  ConversationChannel,
  ConversationStatus,
  Sector,
  Snippet,
  User,
} from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';

// ─── Timestamp helpers ───────────────────────────────────────────────────────

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60_000) return 'agora';
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
  if (isYesterday) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function fullTime(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dateSeparatorLabel(isoStr: string): string {
  const now = new Date();
  const date = new Date(isoStr);
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (isToday) return 'Hoje';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return 'Ontem';
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

const CHANNEL_CONFIG: Record<ConversationChannel, ChannelConfig> = {
  whatsapp: {
    label: 'WhatsApp',
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
}

function ConversationItem({ conversation, isSelected, onClick }: ConversationItemProps) {
  const cfg = CHANNEL_CONFIG[conversation.channel];
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
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        {conversation.contactAvatarUrl ? (
          <img
            src={conversation.contactAvatarUrl}
            alt={conversation.contactName}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm',
              cfg.avatarBg,
              cfg.textColor,
            )}
          >
            {initials}
          </div>
        )}
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
            {relativeTime(conversation.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate leading-relaxed">
            {conversation.lastMessageDirection === 'outbound' && (
              <span className="text-gray-400 dark:text-gray-500 mr-1">Voce:</span>
            )}
            {conversation.lastMessage}
          </p>
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
  const integrations = [
    {
      channel: 'whatsapp' as ConversationChannel,
      name: 'WhatsApp Business',
      description: 'Receba e envie mensagens via API oficial do WhatsApp Business',
      isConnected: false,
    },
    {
      channel: 'facebook' as ConversationChannel,
      name: 'Facebook Page',
      description: 'Integre com sua Pagina do Facebook para gerenciar mensagens',
      isConnected: false,
    },
    {
      channel: 'instagram' as ConversationChannel,
      name: 'Instagram Business',
      description: 'Responda DMs do Instagram direto pelo ServicePro',
      isConnected: false,
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
              Integracoes de Mensagens
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Configure os canais de comunicacao
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
            const cfg = CHANNEL_CONFIG[item.channel];
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
                      {item.isConnected ? 'Conectado' : 'Nao configurado'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                    {item.description}
                  </p>
                  <button
                    className={cn(
                      'mt-2 text-xs font-semibold px-3 py-1 rounded-lg transition-colors',
                      cfg.bgColor,
                      cfg.textColor,
                      'hover:opacity-80',
                    )}
                  >
                    {item.isConnected ? 'Gerenciar' : 'Configurar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-6 pb-5">
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              Para conectar os canais voce precisara de uma conta Meta Business Suite e
              configurar as credenciais da API no painel de Configuracoes.
            </p>
          </div>
        </div>
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
  sectors: sectorsList,
}: {
  conversation: Conversation;
  onBack: () => void;
  onStatusChange: (status: ConversationStatus) => void;
  onSectorAssign?: () => void;
  sectors?: Sector[];
}) {
  const cfg = CHANNEL_CONFIG[conversation.channel];
  const initials = getInitials(conversation.contactName);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  const statusOptions: { value: ConversationStatus; label: string; color: string }[] = [
    { value: 'open', label: 'Aberta', color: 'text-emerald-600 dark:text-emerald-400' },
    { value: 'waiting', label: 'Aguardando', color: 'text-amber-600 dark:text-amber-400' },
    { value: 'resolved', label: 'Resolvida', color: 'text-gray-500 dark:text-gray-400' },
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
          {conversation.contactAvatarUrl ? (
            <img
              src={conversation.contactAvatarUrl}
              alt={conversation.contactName}
              className="w-9 h-9 rounded-full object-cover"
            />
          ) : (
            <div
              className={cn(
                'w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm',
                cfg.avatarBg,
                cfg.textColor,
              )}
            >
              {initials}
            </div>
          )}
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
          <div className="flex items-center gap-2">
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
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <StatusDot status={conversation.status} />
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {conversation.status === 'open' && 'Em atendimento'}
              {conversation.status === 'waiting' && 'Aguardando'}
              {conversation.status === 'resolved' && 'Resolvida'}
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
                  {conversation.priority === 'urgent' ? 'Urgente' : conversation.priority === 'high' ? 'Alta' : 'Baixa'}
                </span>
              </>
            )}
            {conversation.isPrivate && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <Lock className="w-3 h-3 text-amber-500" />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Sector assign button */}
        {onSectorAssign && sectorsList && sectorsList.length > 0 && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onSectorAssign}
            className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title="Atribuir setor"
          >
            <Layers className="w-4 h-4" />
          </motion.button>
        )}
        {conversation.channel === 'whatsapp' && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <Phone className="w-4 h-4" />
          </motion.button>
        )}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <Info className="w-4 h-4" />
        </motion.button>

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

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <MoreVertical className="w-4 h-4" />
        </motion.button>
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
  if (mediaType === 'image') {
    return (
      <div className="mb-1.5 rounded-xl overflow-hidden max-w-[240px]">
        <img
          src={mediaUrl}
          alt="Imagem"
          className="w-full h-auto object-cover rounded-xl"
          loading="lazy"
        />
      </div>
    );
  }

  if (mediaType === 'video') {
    return (
      <div className="mb-1.5 rounded-xl overflow-hidden max-w-[240px] bg-black/10 dark:bg-white/5 flex items-center justify-center p-4 gap-2">
        <Video className="w-5 h-5 text-gray-400" />
        <span className="text-xs text-gray-500 dark:text-gray-400">Video</span>
      </div>
    );
  }

  if (mediaType === 'audio') {
    return (
      <div className="mb-1.5 flex items-center gap-2 px-3 py-2 rounded-xl bg-black/5 dark:bg-white/5 min-w-[180px]">
        <Headphones className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <div className="flex-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        <span className="text-[10px] text-gray-400">Audio</span>
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
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">Documento</span>
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
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">Nota interna</span>
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
            Tentar novamente
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
  const items: Array<
    | { type: 'separator'; label: string }
    | { type: 'message'; msg: ConversationMessage; isGrouped: boolean }
  > = [];

  messages.forEach((msg, idx) => {
    // Date separator
    const prev = messages[idx - 1];
    if (!prev || !isSameDay(prev.sentAt, msg.sentAt)) {
      items.push({ type: 'separator', label: dateSeparatorLabel(msg.sentAt) });
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
              <><Loader2 className="w-3 h-3 animate-spin" /> Carregando...</>
            ) : (
              <><ChevronUp className="w-3 h-3" /> Carregar mensagens anteriores</>
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
            Nota interna — não será enviada ao contato
          </span>
          <button
            onClick={onToggleInternalNote}
            className="ml-auto text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 font-medium"
          >
            Voltar para mensagem
          </button>
        </div>
      )}
      {isDisabled ? (
        /* Template-only mode (24h window expired) */
        <div className="flex items-center gap-3">
          <div className="flex-1 px-4 py-2.5 rounded-2xl bg-gray-100 dark:bg-white/[0.04] border border-transparent dark:border-white/[0.06] text-sm text-gray-400 dark:text-gray-500">
            Janela de 24h expirada. Use um template para retomar a conversa.
          </div>
          <motion.button
            onClick={onTemplateClick}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-br from-[#25D366] to-[#128C7E] text-white text-sm font-semibold shadow-sm shadow-[#25D366]/30 hover:shadow-md transition-all"
          >
            <FileText className="w-4 h-4" />
            Enviar Template
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
            title="Anexar arquivo"
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
              title="Nota interna"
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
              title="Respostas rápidas"
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
            placeholder="Digite uma mensagem..."
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
            Enviando via {cfg.label}
          </span>
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-600">
          {isDisabled ? 'Apenas templates disponiveis' : 'Enter para enviar · Shift+Enter para nova linha'}
        </span>
      </div>
    </div>
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
  const statuses: { id: ConversationStatus | 'all'; label: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'open', label: 'Abertas' },
    { id: 'waiting', label: 'Aguardando' },
    { id: 'resolved', label: 'Resolvidas' },
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ConversasModule() {
  const { user, business, sectors, userSectorIds } = useAuth();

  const [activeChannel, setActiveChannel] = useState<ConversationChannel | 'all'>('all');
  const [activeStatus, setActiveStatus] = useState<ConversationStatus | 'all'>('all');
  const [activeSectorFilter, setActiveSectorFilter] = useState<string | 'all'>('all');
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileThread, setShowMobileThread] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
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
      const data = snap.docs.map((d) => ({ ...d.data(), id: d.id } as Conversation));
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

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    if (selectedConversation) {
      setTimeout(() => scrollToBottom('instant'), 50);
    }
  }, [selectedConversation?.id, scrollToBottom]);

  useEffect(() => {
    if (selectedConversation && messages.length > 0 && !isLoadingOlderRef.current) {
      scrollToBottom();
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

  // ── WhatsApp template definitions ────────────────────────────────────────────

  const whatsappTemplates = [
    {
      name: 'hello_world',
      displayName: 'Saudacao Padrao',
      description: 'Mensagem de ola padrao do WhatsApp Business',
      language: 'en_US',
    },
    {
      name: 'reengagement',
      displayName: 'Retomada de contato',
      description: 'Mensagem para retomar conversa com o cliente',
      language: 'pt_BR',
    },
  ];

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

        // 2. Update conversation metadata
        await updateDoc(doc(db, 'conversations', selectedConversation.id), {
          lastMessage: `[Template: ${templateName}]`,
          lastMessageAt: now,
          lastMessageDirection: 'outbound',
          updatedAt: now,
        });

        // 3. Send via API as template
        try {
          const auth = getAuth();
          const token = await auth.currentUser?.getIdToken();
          await fetch('/api/conversations/send', {
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
        } catch {
          console.warn('Failed to send template via API, saved locally');
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
      alert('Arquivo muito grande. Maximo 16MB.');
      return;
    }
    setAttachment(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, []);

  const handleRemoveAttachment = useCallback(() => {
    setAttachment(null);
  }, []);

  const sendMediaMessage = useCallback(async (file: File) => {
    if (!selectedConversation || !business?.id || !user) return;

    // Upload to Firebase Storage
    const storageRef = ref(storage, `conversations/${business.id}/${selectedConversation.id}/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    const mediaUrl = await getDownloadURL(storageRef);

    const mediaType: 'image' | 'video' | 'audio' | 'document' = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio'
      : 'document';

    const now = new Date().toISOString();

    // Save to Firestore
    await addDoc(collection(db, 'conversationMessages'), {
      conversationId: selectedConversation.id,
      businessId: business.id,
      channel: selectedConversation.channel,
      direction: 'outbound' as const,
      content: file.name,
      mediaUrl,
      mediaType,
      status: 'sending' as const,
      senderName: user.name,
      sentAt: now,
    });

    // Update conversation metadata
    await updateDoc(doc(db, 'conversations', selectedConversation.id), {
      lastMessage: `[${mediaType === 'image' ? 'Imagem' : mediaType === 'video' ? 'Video' : mediaType === 'audio' ? 'Audio' : 'Documento'}] ${file.name}`,
      lastMessageAt: now,
      lastMessageDirection: 'outbound',
      updatedAt: now,
    });

    // Send via API
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
          conversationId: selectedConversation.id,
          channel: selectedConversation.channel,
          recipientId: selectedConversation.contactExternalId,
          content: file.name,
          type: 'media',
          mediaUrl,
          mediaType,
        }),
      });
    } catch {
      console.warn('Failed to send media via API, saved locally');
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
    try {
      await updateDoc(doc(db, 'conversations', conversationId), {
        status,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error updating conversation status:', err);
    }
  }, []);

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

    // If there is a media attachment, send it first
    if (currentAttachment) {
      try {
        await sendMediaMessage(currentAttachment);
      } catch (err) {
        console.error('Error sending media:', err);
        setAttachment(currentAttachment);
      }
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

        // 2. Update conversation metadata
        await updateDoc(doc(db, 'conversations', selectedConversation.id), {
          lastMessage: content,
          lastMessageAt: now,
          lastMessageDirection: 'outbound',
          updatedAt: now,
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
            const errBody = await res.json().catch(() => ({ code: 'unknown' }));
            if (errBody.code === 'disconnected' || errBody.code === 'token_expired') {
              const names: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Facebook Messenger', instagram: 'Instagram' };
              toast.warn(`${names[selectedConversation.channel] || 'Canal'} está desconectado. Reconecte nas Configurações para enviar mensagens.`);
            }
            await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' }).catch(() => {});
          }
        } catch {
          toast.error('Erro de conexão. Verifique sua internet e tente novamente.');
          await updateDoc(doc(db, 'conversationMessages', msgRef.id), { status: 'failed' }).catch(() => {});
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
    return matchesChannel && matchesStatus && matchesSector && matchesSearch;
  });

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
    { id: 'all', label: 'Todos' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'facebook', label: 'Messenger' },
    { id: 'instagram', label: 'Instagram' },
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
                    Conversas
                  </h1>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">
                    {isLoadingConversations
                      ? 'Carregando...'
                      : `${filteredConversations.length} conversa${filteredConversations.length !== 1 ? 's' : ''}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
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

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar conversas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm bg-gray-100 dark:bg-white/[0.04] border border-transparent dark:border-white/[0.06] rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:bg-white dark:focus:bg-white/[0.06] transition-colors"
              />
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
                  Todos
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
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10">
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
                          Nenhuma conversa ainda
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 leading-relaxed max-w-[220px]">
                          Conecte seus canais em Configuracoes para comecar a receber mensagens
                        </p>
                        <button
                          onClick={() => setShowSettings(true)}
                          className="mt-3 text-xs font-semibold px-4 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                        >
                          Configurar canais
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                          Nenhuma conversa encontrada
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          Tente mudar o filtro ou a busca
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
                        onClick={() => handleSelectConversation(conv)}
                      />
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            )}
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
                    Selecione uma conversa
                  </h2>
                  <p className="text-sm text-gray-400 dark:text-gray-500 leading-relaxed">
                    Escolha uma conversa a esquerda para comecar a responder seus clientes
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
                  sectors={sectors}
                />

                {/* Messages area */}
                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-1 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10">
                  {isLoadingMessages ? (
                    <div className="flex-1 flex items-center justify-center py-12">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin" />
                        <span className="text-xs text-gray-400 dark:text-gray-500">Carregando mensagens...</span>
                      </div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-12">
                      <div className="flex flex-col items-center gap-2 text-center">
                        <div className="w-10 h-10 rounded-2xl bg-gray-100 dark:bg-white/[0.04] flex items-center justify-center">
                          <MessageSquare className="w-5 h-5 text-gray-300 dark:text-gray-600" />
                        </div>
                        <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma mensagem ainda</p>
                        <p className="text-xs text-gray-300 dark:text-gray-600">Envie a primeira mensagem</p>
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
                      Janela de 24h expirada. Apenas mensagens de template podem ser enviadas.
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
                        <h4 className="text-xs font-semibold text-gray-900 dark:text-white">Selecionar Template</h4>
                        <button
                          onClick={() => setShowTemplateSelector(false)}
                          className="w-5 h-5 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {whatsappTemplates.map((tpl) => (
                          <button
                            key={tpl.name}
                            onClick={() => handleSendTemplate(tpl.name, tpl.language)}
                            disabled={isSending}
                            className="w-full text-left p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors group disabled:opacity-50"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{tpl.displayName}</span>
                              <Send className="w-3 h-3 text-gray-300 dark:text-gray-600 group-hover:text-[#25D366] transition-colors" />
                            </div>
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{tpl.description}</p>
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
                  onTemplateClick={() => setShowTemplateSelector(true)}
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
                            placeholder="Buscar respostas rápidas..."
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
                            {snippets.length === 0 ? 'Nenhuma resposta rápida cadastrada' : 'Nenhum resultado encontrado'}
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
                                    setor
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
                        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Atribuir Setor</span>
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
                          {selectedConversation?.isPrivate ? 'Tornar pública' : 'Tornar privada'}
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
      </AnimatePresence>
    </div>
  );
}
