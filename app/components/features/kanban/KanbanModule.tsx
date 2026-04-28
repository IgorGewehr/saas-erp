'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import { useAuth } from '@/app/components/providers/AuthProvider';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
} from 'firebase/firestore';
import { db, storage } from '@/lib/config/firebase';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import type {
  KanbanBoard,
  KanbanColumn,
  KanbanCard,
  KanbanLabel,
  KanbanPriority,
  KanbanChecklistItem,
  KanbanComment,
  KanbanAttachment,
  KanbanRecurrence,
  KanbanVisibility,
  KanbanCardTemplate,
  KanbanAutomation,
  KanbanAutomationTrigger,
  KanbanAutomationActionType,
  User,
} from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';
import { notifyUsers } from '@/lib/services/notifications';
import {
  Plus,
  Calendar,
  CheckSquare,
  MessageSquare,
  Paperclip,
  Search,
  Filter,
  Users,
  Clock,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Minus,
  Flame,
  X,
  GripVertical,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Archive,
  ArchiveX,
  FolderOpen,
  AlignLeft,
  CheckCircle2,
  Circle,
  LayoutGrid,
  List,
  Loader2,
  Send,
  Upload,
  FileText,
  Image as ImageIcon,
  Download,
  RefreshCw,
  Copy,
  Zap,
  Settings,
  Trash2 as TrashIcon,
  ToggleLeft,
  ToggleRight,
  RotateCcw,
} from 'lucide-react';

// ─── Priority Config ──────────────────────────────────────
const PRIORITY_CONFIG: Record<KanbanPriority, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  urgent: { label: 'Urgente', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20', icon: Flame },
  high:   { label: 'Alta',    color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20', icon: ArrowUp },
  medium: { label: 'Média',   color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20', icon: Minus },
  low:    { label: 'Baixa',   color: 'text-gray-500 dark:text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700', icon: ArrowDown },
};

// ─── Priority label translation keys ─────────────────────
const PRIORITY_LABEL_KEYS: Record<KanbanPriority, string> = {
  urgent: 'kanban.priority.urgent',
  high:   'kanban.priority.high',
  medium: 'kanban.priority.medium',
  low:    'kanban.priority.low',
};

// ─── Default Labels ───────────────────────────────────────
const DEFAULT_LABELS: KanbanLabel[] = [
  { id: 'l1', name: 'Bug',        color: '#EF4444' },
  { id: 'l2', name: 'Feature',    color: '#8B5CF6' },
  { id: 'l3', name: 'Melhoria',   color: '#3B82F6' },
  { id: 'l4', name: 'Design',     color: '#EC4899' },
  { id: 'l5', name: 'Backend',    color: '#10B981' },
  { id: 'l6', name: 'Frontend',   color: '#F59E0B' },
  { id: 'l7', name: 'Marketing',  color: '#06B6D4' },
  { id: 'l8', name: 'Financeiro', color: '#84CC16' },
];

// ─── Board template presets ───────────────────────────────
const BOARD_PRESETS: { id: string; name: string; color: string; columns: { title: string; color: string }[] }[] = [
  { id: 'sprint',    name: 'Sprint',       color: '#6366F1', columns: [{ title: 'Backlog', color: '#6B7280' }, { title: 'A Fazer', color: '#3B82F6' }, { title: 'Em Progresso', color: '#F59E0B' }, { title: 'Em Revisão', color: '#8B5CF6' }, { title: 'Concluído', color: '#10B981' }] },
  { id: 'suporte',   name: 'Suporte',      color: '#EF4444', columns: [{ title: 'Novo', color: '#EF4444' }, { title: 'Em Atendimento', color: '#F97316' }, { title: 'Aguardando Cliente', color: '#F59E0B' }, { title: 'Resolvido', color: '#10B981' }] },
  { id: 'marketing', name: 'Marketing',    color: '#EC4899', columns: [{ title: 'Ideias', color: '#8B5CF6' }, { title: 'Planejamento', color: '#3B82F6' }, { title: 'Produção', color: '#F97316' }, { title: 'Revisão', color: '#F59E0B' }, { title: 'Publicado', color: '#10B981' }] },
  { id: 'custom',    name: 'Em branco',    color: '#6B7280', columns: [{ title: 'A Fazer', color: '#3B82F6' }, { title: 'Em Progresso', color: '#F59E0B' }, { title: 'Concluído', color: '#10B981' }] },
];

// ─── Local ID for client-side entities (columns, checklist items) ─────────────
const genLocalId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// ─── Attachment helpers ───────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string): React.ElementType {
  if (type.startsWith('image/')) return ImageIcon;
  if (type === 'application/pdf' || type.includes('document')) return FileText;
  return Paperclip;
}

// ─── Member display type ──────────────────────────────────
type MemberDisplay = Pick<User, 'id' | 'name'> & { photoURL?: string | null };

// ─── Animations ───────────────────────────────────────────
// ─── Toast Component ─────────────────────────────────────
function KanbanToast({ message, type, onClose }: { message: string; type: 'error' | 'success'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className={cn(
        'fixed bottom-6 right-6 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium',
        type === 'error'
          ? 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300'
          : 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300',
      )}
    >
      {type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
      {message}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100"><X size={14} /></button>
    </motion.div>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
};

const cardVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: { duration: 0.15 },
  },
};

// ═══════════════════════════════════════════════════════════
// AVATAR STACK
// ═══════════════════════════════════════════════════════════
function AvatarStack({
  userIds,
  membersList,
  size = 'sm',
  max = 3,
}: {
  userIds: string[];
  membersList: MemberDisplay[];
  size?: 'sm' | 'md';
  max?: number;
}) {
  const members = userIds
    .map(id => membersList.find(m => m.id === id))
    .filter(Boolean) as MemberDisplay[];
  const shown = members.slice(0, max);
  const remaining = members.length - max;
  const px = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-xs';
  const overlap = size === 'sm' ? '-ml-1.5' : '-ml-2';

  return (
    <div className="flex items-center">
      {shown.map((member, i) => (
        <div
          key={member.id}
          className={cn(
            px,
            'rounded-full flex items-center justify-center font-bold',
            'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 text-gray-600 dark:text-gray-300',
            'border-2 border-white dark:border-gray-900 shadow-sm ring-1 ring-black/5 dark:ring-white/5',
            i > 0 && overlap
          )}
          title={member.name}
        >
          {getInitials(member.name)}
        </div>
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            px, overlap,
            'rounded-full flex items-center justify-center font-bold',
            'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 border-2 border-white dark:border-gray-900 shadow-sm'
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PRIORITY BADGE
// ═══════════════════════════════════════════════════════════
function PriorityBadge({ priority, compact = false }: { priority: KanbanPriority; compact?: boolean }) {
  const { t } = useTranslation();
  const config = PRIORITY_CONFIG[priority];
  const Icon = config.icon;
  const label = t(PRIORITY_LABEL_KEYS[priority], config.label);

  if (compact) {
    return (
      <div className={cn('flex items-center justify-center w-5 h-5 rounded', config.bgColor, 'border')} title={label}>
        <Icon className={cn('w-3 h-3', config.color)} />
      </div>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border', config.bgColor, config.color)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════
// DUE DATE BADGE
// ═══════════════════════════════════════════════════════════
function DueDateBadge({ date }: { date: string }) {
  const d = new Date(date + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  let colorClass = 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700';
  if (diff < 0) colorClass = 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20';
  else if (diff === 0) colorClass = 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20';
  else if (diff <= 2) colorClass = 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20';

  const formatted = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border', colorClass)}>
      <Clock className="w-3 h-3" />
      {formatted}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════
// KANBAN CARD
// ═══════════════════════════════════════════════════════════
function KanbanCardItem({
  card,
  members,
  onOpen,
  onDragStart,
  onDragOverCard,
  onDropOnCard,
  isDragging,
}: {
  card: KanbanCard;
  members: MemberDisplay[];
  onOpen: () => void;
  onDragStart: (e: React.DragEvent, card: KanbanCard) => void;
  onDragOverCard: (e: React.DragEvent, card: KanbanCard) => void;
  onDropOnCard: (e: React.DragEvent, card: KanbanCard) => void;
  isDragging: boolean;
}) {
  const checkDone = card.checklist?.filter(c => c.completed).length ?? 0;
  const checkTotal = card.checklist?.length ?? 0;
  const hasChecklist = checkTotal > 0;
  const checkPercent = hasChecklist ? Math.round((checkDone / checkTotal) * 100) : 0;

  return (
    <motion.div
      layout
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      draggable
      onDragStart={(e) => onDragStart(e as unknown as React.DragEvent, card)}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOverCard(e as unknown as React.DragEvent, card); }}
      onDrop={(e) => onDropOnCard(e as unknown as React.DragEvent, card)}
      onClick={onOpen}
      className={cn(
        'group relative bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-700/50',
        'shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] dark:hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)]',
        'cursor-grab active:cursor-grabbing',
        'transition-shadow duration-200',
        'hover:border-gray-300/80 dark:hover:border-gray-600',
        isDragging && 'opacity-40 scale-95 rotate-1'
      )}
    >
      {/* Cover color strip */}
      {card.coverColor && (
        <div
          className="h-1.5 rounded-t-xl"
          style={{ backgroundColor: card.coverColor }}
        />
      )}

      <div className="p-3 space-y-2.5">
        {/* Labels row */}
        {card.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {card.labels.map(label => (
              <span
                key={label.id}
                className="h-1.5 w-8 rounded-full"
                style={{ backgroundColor: label.color }}
                title={label.name}
              />
            ))}
          </div>
        )}

        {/* Title */}
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug pr-4">
          {card.title}
        </p>

        {/* Checklist progress bar */}
        {hasChecklist && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  checkPercent === 100 ? 'bg-emerald-500' : 'bg-blue-500'
                )}
                initial={{ width: 0 }}
                animate={{ width: `${checkPercent}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <span className={cn(
              'text-[10px] font-medium',
              checkPercent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'
            )}>
              {checkDone}/{checkTotal}
            </span>
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <PriorityBadge priority={card.priority} compact />

            {card.dueDate && <DueDateBadge date={card.dueDate} />}

            {card.commentsCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-gray-400 dark:text-gray-500 text-[11px]">
                <MessageSquare className="w-3 h-3" />
                {card.commentsCount}
              </span>
            )}

            {card.attachmentsCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-gray-400 dark:text-gray-500 text-[11px]">
                <Paperclip className="w-3 h-3" />
                {card.attachmentsCount}
              </span>
            )}
          </div>

          {/* Assignees */}
          {card.assigneeIds.length > 0 && (
            <AvatarStack userIds={card.assigneeIds} membersList={members} size="sm" max={2} />
          )}
        </div>
      </div>

      {/* Drag handle indicator */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// KANBAN COLUMN
// ═══════════════════════════════════════════════════════════
function KanbanColumnComponent({
  column,
  cards,
  members,
  onCardOpen,
  onAddCard,
  onDeleteColumn,
  onDragStart,
  onDragOver,
  onDrop,
  onDragOverCard,
  onDropOnCard,
  dragOverColumnId,
  draggingCardId,
  dragOverCardId,
}: {
  column: KanbanColumn;
  cards: KanbanCard[];
  members: MemberDisplay[];
  onCardOpen: (card: KanbanCard) => void;
  onAddCard?: (columnId: string) => void;
  onDeleteColumn?: (columnId: string) => void;
  onDragStart: (e: React.DragEvent, card: KanbanCard) => void;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  onDragOverCard: (e: React.DragEvent, card: KanbanCard) => void;
  onDropOnCard: (e: React.DragEvent, card: KanbanCard) => void;
  dragOverColumnId: string | null;
  draggingCardId: string | null;
  dragOverCardId: string | null;
}) {
  const { t } = useTranslation();
  const isOverLimit = column.cardLimit ? cards.length >= column.cardLimit : false;
  const isDragTarget = dragOverColumnId === column.id;

  return (
    <motion.div
      variants={itemVariants}
      className="group/col flex flex-col w-[300px] min-w-[300px] flex-shrink-0 h-full"
    >
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-[0_0_0_2px_white,0_0_0_4px_currentColor] dark:shadow-[0_0_0_2px_rgb(17,24,39),0_0_0_4px_currentColor]"
            style={{ backgroundColor: column.color, color: column.color }}
          />
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
            {column.title}
          </h3>
          <span className={cn(
            'flex items-center justify-center min-w-[20px] h-5 px-1.5',
            'rounded-full text-[11px] font-bold',
            isOverLimit
              ? 'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
          )}>
            {cards.length}
            {column.cardLimit && (
              <span className="text-gray-300 dark:text-gray-600 ml-0.5">/{column.cardLimit}</span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {onDeleteColumn && (
            <button
              onClick={() => onDeleteColumn(column.id)}
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-lg opacity-0 group-hover/col:opacity-100',
                'text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10',
                'transition-all duration-150 active:scale-90'
              )}
              title={t('kanban.deleteColumn', 'Excluir coluna')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onAddCard && (
            <button
              onClick={() => onAddCard(column.id)}
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-lg',
                'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                'transition-all duration-150 active:scale-90'
              )}
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Cards area */}
      <div
        onDragOver={(e) => onDragOver(e, column.id)}
        onDrop={(e) => onDrop(e, column.id)}
        className={cn(
          'flex-1 overflow-y-auto space-y-2.5 p-1.5 rounded-xl min-h-[120px]',
          'transition-all duration-200',
          isDragTarget
            ? 'bg-blue-50/60 dark:bg-blue-500/10 ring-2 ring-blue-200/60 dark:ring-blue-500/30 ring-inset'
            : 'bg-gray-50/50 dark:bg-white/[0.02]'
        )}
      >
        <AnimatePresence mode="popLayout">
          {cards.flatMap(card => {
            const showIndicator = dragOverCardId === card.id && draggingCardId !== card.id;
            return [
              showIndicator ? (
                <motion.div
                  key={`${card.id}-drop-indicator`}
                  layout
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  exit={{ opacity: 0, scaleY: 0 }}
                  transition={{ duration: 0.12 }}
                  className="h-0.5 bg-blue-400 dark:bg-blue-500 rounded-full mx-1 origin-top"
                />
              ) : null,
              <KanbanCardItem
                key={card.id}
                card={card}
                members={members}
                onOpen={() => onCardOpen(card)}
                onDragStart={onDragStart}
                onDragOverCard={onDragOverCard}
                onDropOnCard={onDropOnCard}
                isDragging={draggingCardId === card.id}
              />,
            ].filter((el): el is React.ReactElement => el !== null);
          })}
        </AnimatePresence>

        {/* Empty state */}
        {cards.length === 0 && !isDragTarget && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-300 dark:text-gray-600">
            <LayoutGrid className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-xs font-medium">{t('kanban.noCard', 'Nenhum card')}</p>
          </div>
        )}

        {/* Drop indicator */}
        {isDragTarget && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 48 }}
            className="border-2 border-dashed border-blue-300 dark:border-blue-500/40 rounded-xl bg-blue-50/50 dark:bg-blue-500/10 flex items-center justify-center"
          >
            <p className="text-xs text-blue-400 font-medium">{t('kanban.dropHere', 'Soltar aqui')}</p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// CARD DETAIL DIALOG
// ═══════════════════════════════════════════════════════════
function CardDetailDialog({
  card,
  columns,
  currentUser,
  members,
  onClose,
  onUpdate,
  onDelete,
  onSaveTemplate,
}: {
  card: KanbanCard;
  columns: KanbanColumn[];
  currentUser: User | null;
  members: MemberDisplay[];
  onClose: () => void;
  onUpdate: (updated: KanbanCard) => void;
  onDelete: (id: string) => void;
  onSaveTemplate?: (card: KanbanCard, name: string) => void;
}) {
  const { t } = useTranslation();
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [editingDescription, setEditingDescription] = useState(false);
  const [checklist, setChecklist] = useState<KanbanChecklistItem[]>(card.checklist || []);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [comments, setComments] = useState<KanbanComment[]>(card.comments || []);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [localAssigneeIds, setLocalAssigneeIds] = useState<string[]>(card.assigneeIds);
  const [localDueDate, setLocalDueDate] = useState(card.dueDate || '');
  const [localLabels, setLocalLabels] = useState<KanbanLabel[]>(card.labels);
  const [attachments, setAttachments] = useState<KanbanAttachment[]>(card.attachments || []);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const column = columns.find(c => c.id === card.columnId);
  const checkDone = checklist.filter(c => c.completed).length;
  const checkTotal = checklist.length;
  const checkPercent = checkTotal > 0 ? Math.round((checkDone / checkTotal) * 100) : 0;

  // Sync local state when card prop changes (other user updated it)
  useEffect(() => {
    if (!editingTitle) setTitle(card.title);
    if (!editingDescription) setDescription(card.description || '');
    setChecklist(card.checklist || []);
    setComments(card.comments || []);
    setLocalAssigneeIds(card.assigneeIds);
    setLocalDueDate(card.dueDate || '');
    setLocalLabels(card.labels);
    setAttachments(card.attachments || []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, editingTitle, editingDescription]);

  const handleSaveTitle = () => {
    if (title.trim()) {
      onUpdate({ ...card, title: title.trim() });
    }
    setEditingTitle(false);
  };

  const handleSaveDescription = () => {
    onUpdate({ ...card, description: description.trim() || undefined });
    setEditingDescription(false);
  };

  const handleToggleCheck = (checkId: string) => {
    const updated = checklist.map(c =>
      c.id === checkId ? { ...c, completed: !c.completed } : c
    );
    setChecklist(updated);
    onUpdate({ ...card, checklist: updated });
  };

  const handleAddCheckItem = () => {
    if (!newCheckItem.trim()) return;
    const item: KanbanChecklistItem = { id: genLocalId(), text: newCheckItem.trim(), completed: false };
    const updated = [...checklist, item];
    setChecklist(updated);
    onUpdate({ ...card, checklist: updated });
    setNewCheckItem('');
  };

  const handleRemoveCheckItem = (checkId: string) => {
    const updated = checklist.filter(c => c.id !== checkId);
    setChecklist(updated);
    onUpdate({ ...card, checklist: updated });
  };

  const handleChangePriority = (priority: KanbanPriority) => {
    onUpdate({ ...card, priority });
  };

  const handleChangeColumn = (columnId: string) => {
    onUpdate({ ...card, columnId });
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !currentUser) return;
    setSubmittingComment(true);
    const comment: KanbanComment = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      text: newComment.trim(),
      authorId: currentUser.uid,
      authorName: currentUser.name,
      createdAt: new Date().toISOString(),
    };
    const updated = [...comments, comment];
    setComments(updated);
    setNewComment('');
    onUpdate({ ...card, comments: updated, commentsCount: updated.length });
    setSubmittingComment(false);
  };

  const handleDeleteComment = (commentId: string) => {
    const updated = comments.filter(c => c.id !== commentId);
    setComments(updated);
    onUpdate({ ...card, comments: updated, commentsCount: updated.length });
  };

  const handleToggleAssignee = (memberId: string) => {
    const member = members.find(m => m.id === memberId);
    if (!member) return;
    const isSelected = localAssigneeIds.includes(memberId);
    const newIds = isSelected ? localAssigneeIds.filter(id => id !== memberId) : [...localAssigneeIds, memberId];
    const newNames = newIds.map(id => members.find(m => m.id === id)?.name || '');
    setLocalAssigneeIds(newIds);
    onUpdate({ ...card, assigneeIds: newIds, assigneeNames: newNames });
  };

  const handleDueDateChange = (date: string) => {
    setLocalDueDate(date);
    onUpdate({ ...card, dueDate: date || undefined });
  };

  const handleToggleLabel = (label: KanbanLabel) => {
    const isSelected = localLabels.find(l => l.id === label.id);
    const newLabels = isSelected ? localLabels.filter(l => l.id !== label.id) : [...localLabels, label];
    setLocalLabels(newLabels);
    onUpdate({ ...card, labels: newLabels });
  };

  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser || !card.businessId) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('Arquivo muito grande. Limite: 10MB');
      return;
    }
    const attachId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const storagePath = `kanban/${card.businessId}/${card.id}/${attachId}_${file.name}`;
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, file);
    setUploadProgress(0);
    task.on('state_changed',
      (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      () => { setUploadProgress(null); },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        const newAttach: KanbanAttachment = {
          id: attachId,
          name: file.name,
          url,
          storagePath,
          type: file.type,
          size: file.size,
          uploadedBy: currentUser.uid,
          uploadedByName: currentUser.name,
          uploadedAt: new Date().toISOString(),
        };
        const updated = [...attachments, newAttach];
        setAttachments(updated);
        onUpdate({ ...card, attachments: updated, attachmentsCount: updated.length });
        setUploadProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    );
  };

  const handleDeleteAttachment = async (attach: KanbanAttachment) => {
    try {
      await deleteObject(ref(storage, attach.storagePath));
    } catch { /* file may already be deleted */ }
    const updated = attachments.filter(a => a.id !== attach.id);
    setAttachments(updated);
    onUpdate({ ...card, attachments: updated, attachmentsCount: updated.length });
  };

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4 bg-black/40 backdrop-blur-[2px] overflow-y-auto pb-8"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl border border-gray-200/80 dark:border-gray-700/50 overflow-hidden"
        >
          {/* Cover strip */}
          {card.coverColor && (
            <div className="h-2 w-full" style={{ backgroundColor: card.coverColor }} />
          )}

          <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Labels */}
                {card.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {card.labels.map(label => (
                      <span
                        key={label.id}
                        className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium text-white"
                        style={{ backgroundColor: label.color }}
                      >
                        {label.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Title */}
                {editingTitle ? (
                  <input
                    ref={titleInputRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={handleSaveTitle}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') { setTitle(card.title); setEditingTitle(false); } }}
                    className="w-full text-xl font-bold text-gray-900 dark:text-gray-100 font-display bg-transparent border-b-2 border-red-300 dark:border-red-500/50 focus:border-red-500 outline-none pb-1"
                  />
                ) : (
                  <h2
                    onClick={() => setEditingTitle(true)}
                    className="text-xl font-bold text-gray-900 dark:text-gray-100 font-display cursor-text hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    {card.title}
                  </h2>
                )}

                {/* Column badge */}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-gray-400 dark:text-gray-500">{t('kanban.inColumn', 'em')}</span>
                  <select
                    value={card.columnId}
                    onChange={(e) => handleChangeColumn(e.target.value)}
                    className="text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-red-200 dark:focus:ring-red-500/30"
                  >
                    {columns.map(col => (
                      <option key={col.id} value={col.id}>{col.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                onClick={onClose}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all flex-shrink-0"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-6">
              {/* Left: main content */}
              <div className="space-y-5">
                {/* Description */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <AlignLeft className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('kanban.description', 'Descrição')}</h4>
                  </div>
                  {editingDescription ? (
                    <div className="space-y-2">
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('kanban.addDescriptionPlaceholder', 'Adicione uma descrição...')}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20 min-h-[100px] resize-y"
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSaveDescription}
                          className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
                        >
                          {t('kanban.save', 'Salvar')}
                        </button>
                        <button
                          onClick={() => { setDescription(card.description || ''); setEditingDescription(false); }}
                          className="px-3 py-1.5 rounded-lg text-gray-500 dark:text-gray-400 text-xs font-medium hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                        >
                          {t('kanban.cancel', 'Cancelar')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => setEditingDescription(true)}
                      className={cn(
                        'px-3 py-2 rounded-xl text-sm min-h-[60px] cursor-text',
                        description
                          ? 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                          : 'text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                        'transition-colors'
                      )}
                    >
                      {description || t('kanban.clickToAddDescription', 'Clique para adicionar uma descrição...')}
                    </div>
                  )}
                </div>

                {/* Checklist */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('kanban.checklist', 'Checklist')}</h4>
                    </div>
                    {checkTotal > 0 && (
                      <span className={cn(
                        'text-xs font-medium px-2 py-0.5 rounded-full',
                        checkPercent === 100 ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                      )}>
                        {checkPercent}%
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  {checkTotal > 0 && (
                    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-3">
                      <motion.div
                        className={cn(
                          'h-full rounded-full transition-colors duration-300',
                          checkPercent === 100 ? 'bg-emerald-500' : 'bg-blue-500'
                        )}
                        initial={{ width: 0 }}
                        animate={{ width: `${checkPercent}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  )}

                  {/* Items */}
                  <div className="space-y-1">
                    {checklist.map(item => (
                      <div key={item.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
                        <button
                          onClick={() => handleToggleCheck(item.id)}
                          className="flex-shrink-0"
                        >
                          {item.completed ? (
                            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" />
                          ) : (
                            <Circle className="w-4.5 h-4.5 text-gray-300 dark:text-gray-600 hover:text-gray-400 dark:hover:text-gray-500" />
                          )}
                        </button>
                        <span className={cn(
                          'flex-1 text-sm',
                          item.completed ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-700 dark:text-gray-300'
                        )}>
                          {item.text}
                        </span>
                        <button
                          onClick={() => handleRemoveCheckItem(item.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-all"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add item */}
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      value={newCheckItem}
                      onChange={(e) => setNewCheckItem(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddCheckItem(); }}
                      placeholder={t('kanban.addItemPlaceholder', 'Adicionar item...')}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20"
                    />
                    <button
                      onClick={handleAddCheckItem}
                      disabled={!newCheckItem.trim()}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
                    >
                      {t('kanban.add', 'Adicionar')}
                    </button>
                  </div>
                </div>

                {/* Comments */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('kanban.comments', 'Comentários')}</h4>
                    {comments.length > 0 && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                        {comments.length}
                      </span>
                    )}
                  </div>

                  {/* Thread */}
                  {comments.length > 0 && (
                    <div className="space-y-3 mb-3">
                      {comments.map(comment => {
                        const isOwn = comment.authorId === currentUser?.uid;
                        return (
                          <div key={comment.id} className="flex gap-2.5 group">
                            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 shadow-sm mt-0.5">
                              {getInitials(comment.authorName)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{comment.authorName}</span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                  {new Date(comment.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 rounded-xl px-3 py-2 leading-relaxed whitespace-pre-wrap break-words">
                                {comment.text}
                              </div>
                            </div>
                            {isOwn && (
                              <button
                                onClick={() => handleDeleteComment(comment.id)}
                                className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-all mt-1 self-start"
                                title={t('kanban.deleteComment', 'Excluir comentário')}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* New comment input */}
                  <div className="flex gap-2.5 items-start">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-red-50 to-red-100 dark:from-red-500/20 dark:to-red-500/10 flex items-center justify-center text-[10px] font-bold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 mt-0.5">
                      {getInitials(currentUser?.name || 'U')}
                    </div>
                    <div className="flex-1 space-y-2">
                      <textarea
                        ref={commentInputRef}
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddComment(); }}
                        placeholder={t('kanban.addCommentPlaceholder', 'Adicionar comentário... (Ctrl+Enter para enviar)')}
                        rows={2}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20 resize-none"
                      />
                      <button
                        onClick={handleAddComment}
                        disabled={!newComment.trim() || submittingComment}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                          'bg-red-500 text-white hover:bg-red-600',
                          'disabled:opacity-40 disabled:cursor-not-allowed'
                        )}
                      >
                        <Send className="w-3 h-3" />
                        {t('kanban.sendComment', 'Comentar')}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Attachments */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('kanban.attachments.title', 'Anexos')}</h4>
                      {attachments.length > 0 && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{attachments.length}</span>
                      )}
                    </div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadProgress !== null}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
                    >
                      <Upload className="w-3 h-3" />
                      {t('kanban.attachments.upload', 'Anexar')}
                    </button>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={handleUploadFile} />
                  </div>

                  {/* Upload progress */}
                  {uploadProgress !== null && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                        <span>{t('kanban.attachments.uploading', 'Enviando...')}</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-red-500"
                          animate={{ width: `${uploadProgress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>
                  )}

                  {/* File list */}
                  {attachments.length > 0 ? (
                    <div className="space-y-1.5">
                      {attachments.map(attach => {
                        const FileIcon = getFileIcon(attach.type);
                        const isOwn = attach.uploadedBy === currentUser?.uid;
                        return (
                          <div key={attach.id} className="group flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
                            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                              <FileIcon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{attach.name}</p>
                              <p className="text-[11px] text-gray-400 dark:text-gray-500">{formatFileSize(attach.size)} · {attach.uploadedByName}</p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <a
                                href={attach.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                                title={t('kanban.attachments.download', 'Baixar')}
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                              {isOwn && (
                                <button
                                  onClick={() => handleDeleteAttachment(attach)}
                                  className="p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                  title={t('kanban.attachments.delete', 'Excluir')}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">{t('kanban.attachments.empty', 'Nenhum anexo ainda.')}</p>
                  )}
                </div>
              </div>

              {/* Right: sidebar */}
              <div className="space-y-3">
                {/* Priority */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">{t('kanban.priority_label', 'Prioridade')}</p>
                  <div className="space-y-1">
                    {(Object.keys(PRIORITY_CONFIG) as KanbanPriority[]).map(p => {
                      const config = PRIORITY_CONFIG[p];
                      const Icon = config.icon;
                      return (
                        <button
                          key={p}
                          onClick={() => handleChangePriority(p)}
                          className={cn(
                            'flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
                            card.priority === p
                              ? cn(config.bgColor, config.color, 'border')
                              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                          )}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {t(PRIORITY_LABEL_KEYS[p], config.label)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Assignees */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">{t('kanban.assignees', 'Responsáveis')}</p>
                  {members.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {members.map(member => {
                        const selected = localAssigneeIds.includes(member.id);
                        return (
                          <button
                            key={member.id}
                            onClick={() => handleToggleAssignee(member.id)}
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all border',
                              selected
                                ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20'
                                : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                            )}
                          >
                            <div className={cn(
                              'w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0',
                              selected ? 'bg-red-200 dark:bg-red-500/30 text-red-700 dark:text-red-400' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                            )}>
                              {getInitials(member.name)}
                            </div>
                            {(member.name || '?').split(' ')[0]}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 px-1">{t('kanban.noMembers', 'Sem membros')}</p>
                  )}
                </div>

                {/* Due date */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">{t('kanban.dueDate', 'Prazo')}</p>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={localDueDate}
                      onChange={(e) => handleDueDateChange(e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-1 focus:ring-red-100 dark:focus:ring-red-500/20"
                    />
                    {localDueDate && (
                      <button
                        onClick={() => handleDueDateChange('')}
                        className="p-1 rounded text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0"
                        title={t('kanban.clearDate', 'Limpar prazo')}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {localDueDate && <div className="mt-1.5"><DueDateBadge date={localDueDate} /></div>}
                </div>

                {/* Labels */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">{t('kanban.labels', 'Etiquetas')}</p>
                  <div className="flex flex-wrap gap-1">
                    {DEFAULT_LABELS.map(label => {
                      const selected = localLabels.find(l => l.id === label.id);
                      return (
                        <button
                          key={label.id}
                          onClick={() => handleToggleLabel(label)}
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium transition-all',
                            selected ? 'text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                          )}
                          style={selected ? { backgroundColor: label.color } : undefined}
                        >
                          {label.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Recurrence */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">{t('kanban.recurrence.label', 'Recorrência')}</p>
                  <select
                    value={card.recurrence || ''}
                    onChange={(e) => onUpdate({ ...card, recurrence: (e.target.value as KanbanRecurrence) || undefined })}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-1 focus:ring-red-100 dark:focus:ring-red-500/20"
                  >
                    <option value="">{t('kanban.recurrence.none', 'Não repete')}</option>
                    <option value="daily">{t('kanban.recurrence.daily', 'Diária')}</option>
                    <option value="weekly">{t('kanban.recurrence.weekly', 'Semanal')}</option>
                    <option value="monthly">{t('kanban.recurrence.monthly', 'Mensal')}</option>
                  </select>
                  {card.recurrence && (
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />
                      {t('kanban.recurrence.hint', 'Nova ocorrência criada ao concluir')}
                    </p>
                  )}
                </div>

                {/* Save as Template */}
                {onSaveTemplate && (
                  <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                    {showSaveTemplate ? (
                      <div className="flex gap-1.5 items-center">
                        <input
                          autoFocus
                          value={templateName}
                          onChange={(e) => setTemplateName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && templateName.trim()) {
                              onSaveTemplate(card, templateName.trim());
                              setShowSaveTemplate(false);
                              setTemplateName('');
                            }
                            if (e.key === 'Escape') setShowSaveTemplate(false);
                          }}
                          placeholder={t('kanban.template.namePlaceholder', 'Nome do template...')}
                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30"
                        />
                        <button
                          onClick={() => { if (templateName.trim()) { onSaveTemplate(card, templateName.trim()); setShowSaveTemplate(false); setTemplateName(''); } }}
                          className="px-2.5 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
                        >
                          {t('kanban.save', 'Salvar')}
                        </button>
                        <button onClick={() => setShowSaveTemplate(false)} className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setTemplateName(card.title); setShowSaveTemplate(true); }}
                        className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {t('kanban.template.saveAs', 'Salvar como template')}
                      </button>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                  {showDeleteConfirm ? (
                    <div className="space-y-2">
                      <p className="text-xs text-red-600 dark:text-red-400 font-medium">{t('kanban.deleteConfirm', 'Excluir este card?')}</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => { onDelete(card.id); onClose(); }}
                          className="flex-1 px-2 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
                        >
                          {t('kanban.delete', 'Excluir')}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="flex-1 px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        >
                          {t('kanban.cancel', 'Cancelar')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('kanban.deleteCard', 'Excluir card')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ═══════════════════════════════════════════════════════════
// NEW CARD DIALOG
// ═══════════════════════════════════════════════════════════
function NewCardDialog({
  columnId,
  columns,
  members,
  onClose,
  onCreate,
  initialDueDate,
  templates,
}: {
  columnId: string;
  columns: KanbanColumn[];
  members: MemberDisplay[];
  onClose: () => void;
  onCreate: (card: Partial<KanbanCard>) => void;
  initialDueDate?: string;
  templates?: KanbanCardTemplate[];
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<KanbanPriority>('medium');
  const [selectedColumn, setSelectedColumn] = useState(columnId);
  const [selectedLabels, setSelectedLabels] = useState<KanbanLabel[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState(initialDueDate || '');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const applyTemplate = (templateId: string) => {
    const tmpl = templates?.find(t => t.id === templateId);
    if (!tmpl) return;
    setTitle(tmpl.title);
    setDescription(tmpl.description || '');
    setPriority(tmpl.priority);
    setSelectedLabels(tmpl.labels || []);
  };

  const toggleLabel = (label: KanbanLabel) => {
    setSelectedLabels(prev =>
      prev.find(l => l.id === label.id)
        ? prev.filter(l => l.id !== label.id)
        : [...prev, label]
    );
  };

  const toggleAssignee = (memberId: string) => {
    setSelectedAssignees(prev =>
      prev.includes(memberId) ? prev.filter(id => id !== memberId) : [...prev, memberId]
    );
  };

  const handleCreate = () => {
    if (!title.trim()) return;
    onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      columnId: selectedColumn,
      labels: selectedLabels,
      assigneeIds: selectedAssignees,
      assigneeNames: selectedAssignees.map(id => members.find(m => m.id === id)?.name || ''),
      dueDate: dueDate || undefined,
    });
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-black/40 backdrop-blur-[2px] overflow-y-auto pb-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200/80 dark:border-gray-700/50 overflow-hidden"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">{t('kanban.newCard', 'Novo Card')}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Template picker */}
          {templates && templates.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('kanban.template.useTemplate', 'Usar template (opcional)')}</label>
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) applyTemplate(e.target.value); }}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20"
              >
                <option value="">{t('kanban.template.noTemplate', '— Sem template —')}</option>
                {templates.map(tmpl => (
                  <option key={tmpl.id} value={tmpl.id}>{tmpl.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('kanban.titleLabel', 'Título *')}</label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) handleCreate(); }}
              placeholder={t('kanban.titlePlaceholder', 'O que precisa ser feito?')}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('kanban.descriptionLabel', 'Descrição')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('kanban.descriptionPlaceholder', 'Detalhes opcionais...')}
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20 resize-none"
            />
          </div>

          {/* Row: Column + Priority + Due Date */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('kanban.column', 'Coluna')}</label>
              <select
                value={selectedColumn}
                onChange={(e) => setSelectedColumn(e.target.value)}
                className="w-full px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20 bg-white dark:bg-gray-800"
              >
                {columns.map(col => (
                  <option key={col.id} value={col.id}>{col.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('kanban.priority_label', 'Prioridade')}</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as KanbanPriority)}
                className="w-full px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20 bg-white dark:bg-gray-800"
              >
                {(Object.keys(PRIORITY_CONFIG) as KanbanPriority[]).map(p => (
                  <option key={p} value={p}>{t(PRIORITY_LABEL_KEYS[p], PRIORITY_CONFIG[p].label)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('kanban.dueDate', 'Prazo')}</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20"
              />
            </div>
          </div>

          {/* Labels */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('kanban.labels', 'Etiquetas')}</label>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_LABELS.map(label => (
                <button
                  key={label.id}
                  onClick={() => toggleLabel(label)}
                  className={cn(
                    'inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                    selectedLabels.find(l => l.id === label.id)
                      ? 'text-white shadow-sm ring-2 ring-offset-1 dark:ring-offset-gray-900'
                      : 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
                  )}
                  style={
                    selectedLabels.find(l => l.id === label.id)
                      ? { backgroundColor: label.color }
                      : undefined
                  }
                >
                  {label.name}
                </button>
              ))}
            </div>
          </div>

          {/* Assignees */}
          {members.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('kanban.assignees', 'Responsáveis')}</label>
              <div className="flex flex-wrap gap-1.5">
                {members.map(member => (
                  <button
                    key={member.id}
                    onClick={() => toggleAssignee(member.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border',
                      selectedAssignees.includes(member.id)
                        ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold',
                      selectedAssignees.includes(member.id)
                        ? 'bg-red-200 dark:bg-red-500/30 text-red-700 dark:text-red-400'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    )}>
                      {getInitials(member.name)}
                    </div>
                    {(member.name || '?').split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              {t('kanban.cancel', 'Cancelar')}
            </button>
            <button
              onClick={handleCreate}
              disabled={!title.trim()}
              className={cn(
                'px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all',
                'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700',
                'shadow-md shadow-red-500/25 hover:shadow-lg hover:shadow-red-500/30',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none'
              )}
            >
              {t('kanban.createCard', 'Criar Card')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// NEW COLUMN INLINE
// ═══════════════════════════════════════════════════════════
function NewColumnInline({
  onAdd,
  onCancel,
}: {
  onAdd: (title: string, color: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [color, setColor] = useState('#6B7280');
  const inputRef = useRef<HTMLInputElement>(null);
  const COLORS = ['#6B7280', '#3B82F6', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444', '#EC4899', '#06B6D4'];

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, x: 20 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.95, x: 20 }}
      className="w-[300px] min-w-[300px] flex-shrink-0 self-start bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg p-4 space-y-3"
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) { onAdd(title.trim(), color); } if (e.key === 'Escape') onCancel(); }}
        placeholder={t('kanban.columnNamePlaceholder', 'Nome da coluna...')}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20"
      />
      <div className="flex items-center gap-1.5">
        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={cn(
              'w-6 h-6 rounded-full transition-transform',
              color === c && 'outline outline-2 outline-offset-2 scale-110'
            )}
            style={{ backgroundColor: c, outlineColor: c }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => { if (title.trim()) onAdd(title.trim(), color); }}
          disabled={!title.trim()}
          className="flex-1 px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-40"
        >
          {t('kanban.add', 'Adicionar')}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-gray-500 dark:text-gray-400 text-sm font-medium hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          {t('kanban.cancel', 'Cancelar')}
        </button>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// NEW BOARD DIALOG (with preset templates)
// ═══════════════════════════════════════════════════════════
function NewBoardDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, color: string, presetId?: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#DC2626');
  const [selectedPreset, setSelectedPreset] = useState<string>('custom');
  const inputRef = useRef<HTMLInputElement>(null);
  const BOARD_COLORS = ['#DC2626', '#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#84CC16'];

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSelectPreset = (presetId: string) => {
    const preset = BOARD_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setSelectedPreset(presetId);
    setColor(preset.color);
    if (!name) setName(preset.id !== 'custom' ? preset.name : '');
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), color, selectedPreset !== 'custom' ? selectedPreset : undefined);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4 bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md border border-gray-200/80 dark:border-gray-700/50 overflow-hidden"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">{t('kanban.newBoard', 'Novo Board')}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Preset templates */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">{t('kanban.boardTemplate', 'Template')}</label>
            <div className="grid grid-cols-2 gap-2">
              {BOARD_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset.id)}
                  className={cn(
                    'flex flex-col gap-1.5 p-3 rounded-xl border text-left transition-all',
                    selectedPreset === preset.id
                      ? 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-white/[0.03]'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: preset.color }} />
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{preset.name}</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {preset.columns.map((col, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{col.title}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('kanban.nameLabel', 'Nome *')}</label>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleCreate(); if (e.key === 'Escape') onClose(); }}
              placeholder={t('kanban.boardNamePlaceholder', 'Nome do board...')}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t('kanban.colorLabel', 'Cor')}</label>
            <div className="flex items-center gap-2 flex-wrap">
              {BOARD_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn('w-7 h-7 rounded-full transition-transform', color === c && 'outline outline-2 outline-offset-2 scale-110')}
                  style={{ backgroundColor: c, outlineColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              {t('kanban.cancel', 'Cancelar')}
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim()}
              className={cn(
                'px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all',
                'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700',
                'shadow-md shadow-red-500/25 hover:shadow-lg hover:shadow-red-500/30',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none'
              )}
            >
              {t('kanban.createBoard', 'Criar Board')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// AUTOMATION DIALOG
// ═══════════════════════════════════════════════════════════
function AutomationDialog({
  board,
  members,
  onClose,
  onSave,
}: {
  board: KanbanBoard;
  members: MemberDisplay[];
  onClose: () => void;
  onSave: (automations: KanbanAutomation[]) => void;
}) {
  const { t } = useTranslation();
  const [automations, setAutomations] = useState<KanbanAutomation[]>(board.automations || []);
  const sortedColumns = [...board.columns].sort((a, b) => a.order - b.order);

  const addAutomation = () => {
    const newAuto: KanbanAutomation = {
      id: genLocalId(),
      trigger: 'move_to_column',
      triggerColumnId: sortedColumns[sortedColumns.length - 1]?.id || '',
      actions: [{ type: 'set_priority', value: 'urgent' }],
      isEnabled: true,
    };
    setAutomations(prev => [...prev, newAuto]);
  };

  const updateAutomation = (id: string, patch: Partial<KanbanAutomation>) => {
    setAutomations(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  };

  const updateAction = (autoId: string, actionIndex: number, patch: Partial<{ type: KanbanAutomationActionType; value: string }>) => {
    setAutomations(prev => prev.map(a => {
      if (a.id !== autoId) return a;
      const actions = a.actions.map((act, i) => i === actionIndex ? { ...act, ...patch } : act);
      return { ...a, actions };
    }));
  };

  const removeAutomation = (id: string) => setAutomations(prev => prev.filter(a => a.id !== id));

  const triggerLabel = (a: KanbanAutomation) => {
    if (a.trigger === 'due_date_passed') return t('kanban.automation.triggerOverdue', 'Quando tarefa atrasar');
    const col = board.columns.find(c => c.id === a.triggerColumnId);
    return t('kanban.automation.triggerMove', `Ao mover para "${col?.title || '...'}"`, { col: col?.title || '...' });
  };

  const actionValueLabel = (act: { type: KanbanAutomationActionType; value: string }) => {
    if (act.type === 'set_priority') {
      const labels: Record<string, string> = { urgent: 'Urgente', high: 'Alta', medium: 'Média', low: 'Baixa' };
      return labels[act.value] || act.value;
    }
    if (act.type === 'add_label') return DEFAULT_LABELS.find(l => l.id === act.value)?.name || act.value;
    if (act.type === 'assign_user') return members.find(m => m.id === act.value)?.name || act.value;
    return act.value;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] px-4 bg-black/40 backdrop-blur-[2px] overflow-y-auto pb-8"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200/80 dark:border-gray-700/50"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 font-display">{t('kanban.automations', 'Automações')}</h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">— {board.name}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-3">
          {automations.length === 0 && (
            <div className="py-8 text-center">
              <Zap className="w-8 h-8 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
              <p className="text-sm text-gray-400 dark:text-gray-500">{t('kanban.automation.empty', 'Nenhuma automação configurada.')}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('kanban.automation.emptyHint', 'Automações executam ações automaticamente ao mover cards ou quando tarefas atrasam.')}</p>
            </div>
          )}

          {automations.map((auto, idx) => (
            <div key={auto.id} className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-white/[0.02] space-y-3">
              {/* Header row */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('kanban.automation.rule', 'Regra')} {idx + 1}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateAutomation(auto.id, { isEnabled: !auto.isEnabled })}
                    className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
                    title={auto.isEnabled ? t('kanban.automation.disable', 'Desativar') : t('kanban.automation.enable', 'Ativar')}
                  >
                    {auto.isEnabled
                      ? <ToggleRight className="w-4 h-4 text-emerald-500" />
                      : <ToggleLeft className="w-4 h-4 text-gray-400 dark:text-gray-500" />}
                    <span className={auto.isEnabled ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                      {auto.isEnabled ? t('kanban.automation.active', 'Ativa') : t('kanban.automation.inactive', 'Inativa')}
                    </span>
                  </button>
                  <button onClick={() => removeAutomation(auto.id)} className="p-1 rounded text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors">
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Trigger */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">{t('kanban.automation.when', 'Quando')}</label>
                <select
                  value={auto.trigger}
                  onChange={(e) => updateAutomation(auto.id, { trigger: e.target.value as KanbanAutomationTrigger })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30"
                >
                  <option value="move_to_column">{t('kanban.automation.triggerMoveOption', 'Card mover para coluna...')}</option>
                  <option value="due_date_passed">{t('kanban.automation.triggerOverdueOption', 'Data de vencimento passar')}</option>
                </select>
                {auto.trigger === 'move_to_column' && (
                  <select
                    value={auto.triggerColumnId || ''}
                    onChange={(e) => updateAutomation(auto.id, { triggerColumnId: e.target.value })}
                    className="mt-1.5 w-full px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30"
                  >
                    <option value="">{t('kanban.automation.selectColumn', 'Selecione a coluna...')}</option>
                    {sortedColumns.map(col => (
                      <option key={col.id} value={col.id}>{col.title}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Actions */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">{t('kanban.automation.then', 'Então')}</label>
                {auto.actions.map((act, aIdx) => (
                  <div key={aIdx} className="flex items-center gap-2 mb-1.5">
                    <select
                      value={act.type}
                      onChange={(e) => updateAction(auto.id, aIdx, { type: e.target.value as KanbanAutomationActionType, value: '' })}
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30"
                    >
                      <option value="set_priority">{t('kanban.automation.actionPriority', 'Definir prioridade')}</option>
                      <option value="add_label">{t('kanban.automation.actionLabel', 'Adicionar label')}</option>
                      <option value="assign_user">{t('kanban.automation.actionAssign', 'Atribuir para')}</option>
                    </select>
                    {act.type === 'set_priority' && (
                      <select
                        value={act.value}
                        onChange={(e) => updateAction(auto.id, aIdx, { value: e.target.value })}
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30"
                      >
                        <option value="urgent">{t('kanban.priority.urgent', 'Urgente')}</option>
                        <option value="high">{t('kanban.priority.high', 'Alta')}</option>
                        <option value="medium">{t('kanban.priority.medium', 'Média')}</option>
                        <option value="low">{t('kanban.priority.low', 'Baixa')}</option>
                      </select>
                    )}
                    {act.type === 'add_label' && (
                      <select
                        value={act.value}
                        onChange={(e) => updateAction(auto.id, aIdx, { value: e.target.value })}
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30"
                      >
                        <option value="">{t('kanban.automation.selectLabel', 'Selecione...')}</option>
                        {DEFAULT_LABELS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    )}
                    {act.type === 'assign_user' && (
                      <select
                        value={act.value}
                        onChange={(e) => updateAction(auto.id, aIdx, { value: e.target.value })}
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30"
                      >
                        <option value="">{t('kanban.automation.selectUser', 'Selecione...')}</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                <p className="text-[11px] text-gray-400 dark:text-gray-500 italic mt-1">
                  → {triggerLabel(auto)}: {auto.actions.map(a => `${a.type === 'set_priority' ? 'definir prioridade como' : a.type === 'add_label' ? 'adicionar label' : 'atribuir para'} "${actionValueLabel(a)}"`).join(', ')}
                </p>
              </div>
            </div>
          ))}

          <button
            onClick={addAutomation}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-400 dark:text-gray-500 hover:border-amber-300 dark:hover:border-amber-500/40 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50/50 dark:hover:bg-amber-500/5 transition-all"
          >
            <Plus className="w-4 h-4" />
            {t('kanban.automation.add', 'Adicionar automação')}
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 pb-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors">
            {t('kanban.cancel', 'Cancelar')}
          </button>
          <button
            onClick={() => { onSave(automations); onClose(); }}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 shadow-md shadow-amber-500/25 transition-all"
          >
            {t('kanban.automation.save', 'Salvar automações')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// BOARD HEADER
// ═══════════════════════════════════════════════════════════
type KanbanViewMode = 'board' | 'list' | 'calendar' | 'mytasks';

function BoardHeader({
  boards,
  activeBoard,
  members,
  onSelectBoard,
  onNewBoard,
  onArchiveBoard,
  archivedBoards,
  onRestoreBoard,
  canManageBoard: canManage,
  searchQuery,
  onSearchChange,
  filterPriority,
  onFilterPriorityChange,
  filterAssignee,
  onFilterAssigneeChange,
  totalCards,
  filteredCards,
  viewMode,
  onViewModeChange,
  urgentTaskCount,
  onOpenAutomations,
}: {
  boards: KanbanBoard[];
  activeBoard: KanbanBoard;
  members: MemberDisplay[];
  onSelectBoard: (id: string) => void;
  onNewBoard: () => void;
  onArchiveBoard?: (id: string) => void;
  archivedBoards?: KanbanBoard[];
  onRestoreBoard?: (id: string) => void;
  canManageBoard?: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterPriority: KanbanPriority | 'all';
  onFilterPriorityChange: (p: KanbanPriority | 'all') => void;
  filterAssignee: string | 'all';
  onFilterAssigneeChange: (a: string | 'all') => void;
  totalCards: number;
  filteredCards: number;
  viewMode: KanbanViewMode;
  onViewModeChange: (v: KanbanViewMode) => void;
  urgentTaskCount?: number;
  onOpenAutomations?: () => void;
}) {
  const { t } = useTranslation();
  const [showFilters, setShowFilters] = useState(false);
  const [showArchivedDropdown, setShowArchivedDropdown] = useState(false);
  const hasFilters = filterPriority !== 'all' || filterAssignee !== 'all' || searchQuery.trim() !== '';

  return (
    <div className="space-y-3">
      {/* Board tabs + actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Board tabs */}
        <div className="flex items-center gap-1 bg-gray-100/80 dark:bg-gray-800/80 p-1 rounded-xl">
          {boards.map(board => (
            <button
              key={board.id}
              onClick={() => onSelectBoard(board.id)}
              className={cn(
                'relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                activeBoard.id === board.id
                  ? 'text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-white/50 dark:hover:bg-white/[0.04]'
              )}
            >
              {activeBoard.id === board.id && (
                <motion.div
                  layoutId="board-tab-active"
                  className="absolute inset-0 rounded-lg bg-gradient-to-r from-red-500 to-red-600 shadow-md"
                  transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: activeBoard.id === board.id ? '#fff' : board.color }}
                />
                {board.name}
              </span>
            </button>
          ))}

          {/* Board actions */}
          {canManage && onArchiveBoard && boards.length > 1 && (
            <button
              onClick={() => onArchiveBoard(activeBoard.id)}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-lg ml-0.5',
                'text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400',
                'hover:bg-red-50 dark:hover:bg-red-500/10 transition-all duration-150 active:scale-90'
              )}
              title={t('kanban.archiveBoardTooltip', 'Arquivar board')}
            >
              <ArchiveX className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Archived boards button */}
          {canManage && archivedBoards && archivedBoards.length > 0 && (
            <div className="relative ml-0.5">
              <button
                onClick={() => setShowArchivedDropdown(v => !v)}
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-lg',
                  'transition-all duration-150 active:scale-90',
                  showArchivedDropdown
                    ? 'text-amber-500 bg-amber-50 dark:bg-amber-500/10'
                    : 'text-gray-400 dark:text-gray-500 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10'
                )}
                title={t('kanban.viewArchived', 'Ver boards arquivados')}
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>

              <AnimatePresence>
                {showArchivedDropdown && (
                  <>
                    {/* Backdrop */}
                    <div className="fixed inset-0 z-30" onClick={() => setShowArchivedDropdown(false)} />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -4 }}
                      transition={{ duration: 0.12 }}
                      className="absolute left-0 top-full mt-2 z-40 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700/50 rounded-xl shadow-xl min-w-[220px] py-1.5 overflow-hidden"
                    >
                      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 py-1.5">
                        {t('kanban.archivedBoards', 'Boards arquivados')}
                      </p>
                      {archivedBoards.map(board => (
                        <div key={board.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 group">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: board.color }} />
                          <span className="flex-1 text-sm text-gray-700 dark:text-gray-300 truncate">{board.name}</span>
                          {onRestoreBoard && (
                            <button
                              onClick={() => { onRestoreBoard(board.id); setShowArchivedDropdown(false); }}
                              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium transition-all shrink-0"
                              title={t('kanban.restore', 'Restaurar')}
                            >
                              <RotateCcw className="w-3 h-3" />
                              {t('kanban.restore', 'Restaurar')}
                            </button>
                          )}
                        </div>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* New board button */}
          {canManage && <button
            onClick={onNewBoard}
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-lg ml-0.5',
              'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300',
              'hover:bg-white/50 dark:hover:bg-white/[0.06] transition-all duration-150 active:scale-90'
            )}
            title={t('kanban.newBoardTooltip', 'Novo board')}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* Members */}
          <AvatarStack userIds={activeBoard.memberIds} membersList={members} size="md" max={4} />

          {/* View mode toggle */}
          <div className="flex items-center bg-gray-100/80 dark:bg-gray-800/80 rounded-xl p-1 gap-0.5">
            {([
              { mode: 'board' as KanbanViewMode, icon: LayoutGrid, label: t('kanban.viewBoard', 'Board') },
              { mode: 'list' as KanbanViewMode, icon: List, label: t('kanban.viewList', 'Lista') },
              { mode: 'calendar' as KanbanViewMode, icon: Calendar, label: t('kanban.viewCalendar', 'Calendário') },
              { mode: 'mytasks' as KanbanViewMode, icon: Users, label: t('kanban.viewMyTasks', 'Minhas Tarefas') },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => onViewModeChange(mode)}
                title={label}
                className={cn(
                  'relative flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-200',
                  viewMode === mode
                    ? 'bg-white dark:bg-gray-700 text-red-600 dark:text-red-400 shadow-sm'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {mode === 'mytasks' && urgentTaskCount && urgentTaskCount > 0 ? (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
                    {urgentTaskCount > 9 ? '9+' : urgentTaskCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('kanban.searchPlaceholder', 'Buscar cards...')}
              className="w-44 pl-8 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20 bg-white dark:bg-gray-800 transition-all"
            />
          </div>

          {/* Filters toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-all',
              hasFilters
                ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            {t('kanban.filters', 'Filtros')}
            {hasFilters && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            )}
          </button>

          {/* Automations button */}
          {onOpenAutomations && (
            <button
              onClick={onOpenAutomations}
              title={t('kanban.automations', 'Automações')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-all',
                (activeBoard.automations?.some(a => a.isEnabled))
                  ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]'
              )}
            >
              <Zap className="w-3.5 h-3.5" />
              {t('kanban.automations', 'Automações')}
              {activeBoard.automations?.some(a => a.isEnabled) && (
                <span className="text-[10px] font-bold px-1 rounded bg-amber-500 text-white">{activeBoard.automations.filter(a => a.isEnabled).length}</span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Filters row */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 flex-wrap py-2 px-1">
              {/* Priority filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{t('kanban.priorityFilter', 'Prioridade:')}</span>
                <div className="flex items-center gap-1">
                  {(['all', 'urgent', 'high', 'medium', 'low'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => onFilterPriorityChange(p)}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                        filterPriority === p
                          ? p === 'all' ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900' : cn(PRIORITY_CONFIG[p].bgColor, PRIORITY_CONFIG[p].color, 'border')
                          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]'
                      )}
                    >
                      {p === 'all' ? t('kanban.allPriorities', 'Todas') : t(PRIORITY_LABEL_KEYS[p], PRIORITY_CONFIG[p].label)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assignee filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{t('kanban.assigneeFilter', 'Responsável:')}</span>
                <select
                  value={filterAssignee}
                  onChange={(e) => onFilterAssigneeChange(e.target.value)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30"
                >
                  <option value="all">{t('kanban.allAssignees', 'Todos')}</option>
                  {members.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              {/* Clear filters */}
              {hasFilters && (
                <button
                  onClick={() => { onFilterPriorityChange('all'); onFilterAssigneeChange('all'); onSearchChange(''); }}
                  className="text-xs text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 font-medium transition-colors"
                >
                  {t('kanban.clearFilters', 'Limpar filtros')}
                </button>
              )}

              {/* Count */}
              {hasFilters && (
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
                  {t('kanban.filteredCount', '{{filtered}} de {{total}} cards', { filtered: filteredCards, total: totalCards })}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Priority color dots for list/calendar views ──────────
const PRIORITY_HEX: Record<KanbanPriority, string> = {
  urgent: '#EF4444',
  high:   '#F97316',
  medium: '#3B82F6',
  low:    '#6B7280',
};

// ═══════════════════════════════════════════════════════════
// MY TASKS VIEW
// ═══════════════════════════════════════════════════════════
function MyTasksView({
  cards,
  boards,
  onCardOpen,
}: {
  cards: KanbanCard[];
  boards: KanbanBoard[];
  onCardOpen: (card: KanbanCard) => void;
}) {
  const { t } = useTranslation();

  type Group = 'overdue' | 'today' | 'week' | 'future' | 'none';

  const getGroup = (card: KanbanCard): Group => {
    if (!card.dueDate) return 'none';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(card.dueDate + 'T00:00:00');
    const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return 'overdue';
    if (diff === 0) return 'today';
    if (diff <= 7) return 'week';
    return 'future';
  };

  const groups: { key: Group; label: string; colorClass: string; emptyHide?: boolean }[] = [
    { key: 'overdue', label: t('kanban.myTasks.overdue', 'Atrasado'), colorClass: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20' },
    { key: 'today',   label: t('kanban.myTasks.today',   'Hoje'),     colorClass: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20' },
    { key: 'week',    label: t('kanban.myTasks.week',    'Esta semana'), colorClass: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20' },
    { key: 'future',  label: t('kanban.myTasks.future',  'Futuro'),   colorClass: 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700' },
    { key: 'none',    label: t('kanban.myTasks.noDate',  'Sem prazo'), colorClass: 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700', emptyHide: true },
  ];

  const grouped = useMemo(() => {
    const map: Record<Group, KanbanCard[]> = { overdue: [], today: [], week: [], future: [], none: [] };
    for (const card of cards) map[getGroup(card)].push(card);
    const PRIO_ORDER: Record<KanbanPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    for (const g of Object.keys(map) as Group[]) {
      map[g].sort((a, b) => PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-500/10 dark:to-emerald-500/5 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-7 h-7 text-emerald-500" />
        </div>
        <h3 className="text-base font-bold text-gray-800 dark:text-gray-200 mb-1">{t('kanban.myTasks.allDone', 'Tudo em dia!')}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('kanban.myTasks.allDoneDesc', 'Você não tem nenhuma tarefa atribuída.')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {groups.map(({ key, label, colorClass, emptyHide }) => {
        const groupCards = grouped[key];
        if (emptyHide && groupCards.length === 0) return null;
        return (
          <div key={key}>
            {/* Group header */}
            <div className="flex items-center gap-2 mb-2">
              <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border', colorClass)}>
                {label}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{groupCards.length}</span>
              <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
            </div>

            {groupCards.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 px-1 py-2 italic">{t('kanban.myTasks.empty', 'Nenhuma tarefa neste grupo')}</p>
            ) : (
              <div className="space-y-1.5">
                {groupCards.map(card => {
                  const board = boards.find(b => b.id === card.boardId);
                  const col = board?.columns.find(c => c.id === card.columnId);
                  return (
                    <motion.div
                      key={card.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => onCardOpen(card)}
                      className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-700/50 shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600 cursor-pointer transition-all group"
                    >
                      {/* Priority dot */}
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: PRIORITY_HEX[card.priority] }} />

                      {/* Title */}
                      <p className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                        {card.title}
                      </p>

                      {/* Board + column context */}
                      {board && (
                        <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: board.color }} />
                          <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[120px]">{board.name}</span>
                          {col && <span className="text-[11px] text-gray-300 dark:text-gray-600">/ {col.title}</span>}
                        </div>
                      )}

                      {/* Due date */}
                      {card.dueDate && <DueDateBadge date={card.dueDate} />}

                      {/* Priority badge */}
                      <PriorityBadge priority={card.priority} compact />
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LIST VIEW
// ═══════════════════════════════════════════════════════════
function ListView({
  cards,
  columns,
  members,
  onCardOpen,
}: {
  cards: KanbanCard[];
  columns: KanbanColumn[];
  members: MemberDisplay[];
  onCardOpen: (card: KanbanCard) => void;
}) {
  const { t } = useTranslation();
  type SortKey = 'priority' | 'dueDate' | 'title' | 'column';
  const PRIORITY_ORDER: Record<KanbanPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [sortAsc, setSortAsc] = useState(true);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(prev => !prev);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sorted = [...cards].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'priority') cmp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    else if (sortKey === 'dueDate') {
      if (!a.dueDate && !b.dueDate) cmp = 0;
      else if (!a.dueDate) cmp = 1;
      else if (!b.dueDate) cmp = -1;
      else cmp = a.dueDate.localeCompare(b.dueDate);
    } else if (sortKey === 'title') {
      cmp = a.title.localeCompare(b.title);
    } else if (sortKey === 'column') {
      const colA = columns.find(c => c.id === a.columnId)?.title || '';
      const colB = columns.find(c => c.id === b.columnId)?.title || '';
      cmp = colA.localeCompare(colB);
    }
    return sortAsc ? cmp : -cmp;
  });

  const SortBtn = ({ label, k }: { label: string; k: SortKey }) => (
    <button
      onClick={() => handleSort(k)}
      className={cn(
        'flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors',
        sortKey === k ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
      )}
    >
      {label}
      {sortKey === k && <ChevronDown className={cn('w-3 h-3 transition-transform', !sortAsc && 'rotate-180')} />}
    </button>
  );

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-300 dark:text-gray-600">
        <List className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm font-medium">{t('kanban.noCards', 'Nenhum card encontrado')}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/50">
        <SortBtn label={t('kanban.listColTitle', 'Título')} k="title" />
        <SortBtn label={t('kanban.listColStatus', 'Coluna')} k="column" />
        <SortBtn label={t('kanban.listColPriority', 'Prioridade')} k="priority" />
        <SortBtn label={t('kanban.listColDue', 'Prazo')} k="dueDate" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{t('kanban.listColAssignees', 'Resp.')}</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        <AnimatePresence mode="popLayout">
          {sorted.map(card => {
            const col = columns.find(c => c.id === card.columnId);
            const checkDone = card.checklist?.filter(c => c.completed).length ?? 0;
            const checkTotal = card.checklist?.length ?? 0;
            return (
              <motion.div
                key={card.id}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                onClick={() => onCardOpen(card)}
                className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-4 py-3 items-center hover:bg-gray-50/60 dark:hover:bg-white/[0.02] cursor-pointer transition-colors group"
              >
                {/* Title + checklist */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: PRIORITY_HEX[card.priority] }} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
                      {card.title}
                    </p>
                    {checkTotal > 0 && (
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">{checkDone}/{checkTotal} itens</p>
                    )}
                  </div>
                </div>

                {/* Column */}
                <div className="flex items-center gap-1.5">
                  {col && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />}
                  <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{col?.title || '—'}</span>
                </div>

                {/* Priority */}
                <PriorityBadge priority={card.priority} />

                {/* Due date */}
                <div>{card.dueDate ? <DueDateBadge date={card.dueDate} /> : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>}</div>

                {/* Assignees */}
                <div>{card.assigneeIds.length > 0 ? <AvatarStack userIds={card.assigneeIds} membersList={members} size="sm" max={2} /> : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>}</div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
        <span className="text-xs text-gray-400 dark:text-gray-500">{t('kanban.listTotal', '{{count}} cards', { count: sorted.length })}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CALENDAR VIEW
// ═══════════════════════════════════════════════════════════
function CalendarView({
  cards,
  onCardOpen,
  onCreateCard,
}: {
  cards: KanbanCard[];
  onCardOpen: (card: KanbanCard) => void;
  onCreateCard?: (date: string) => void;
}) {
  const { t } = useTranslation();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = lastDay.getDate();

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const monthLabel = new Date(year, month, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

  // Group cards by dueDate day
  const cardsByDay = useMemo(() => {
    const map: Record<number, KanbanCard[]> = {};
    for (const card of cards) {
      if (!card.dueDate) continue;
      const d = new Date(card.dueDate + 'T00:00:00');
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(card);
      }
    }
    return map;
  }, [cards, year, month]);

  const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Build grid cells: leading blanks + days
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
      {/* Calendar header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
        <button
          onClick={prevMonth}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 capitalize">{monthLabel}</h3>
        <button
          onClick={nextMonth}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-800">
        {DOW_LABELS.map(dow => (
          <div key={dow} className="py-2 text-center text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            {dow}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 auto-rows-[minmax(80px,_auto)]">
        {cells.map((day, idx) => {
          if (!day) {
            return <div key={`blank-${idx}`} className="border-b border-r border-gray-100 dark:border-gray-800 bg-gray-50/30 dark:bg-white/[0.01]" />;
          }
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isToday = dateStr === todayStr;
          const dayCards = cardsByDay[day] || [];

          return (
            <div
              key={day}
              onClick={() => onCreateCard?.(dateStr)}
              className={cn(
                'border-b border-r border-gray-100 dark:border-gray-800 p-1.5 relative cursor-pointer',
                'hover:bg-gray-50/60 dark:hover:bg-white/[0.02] transition-colors group',
                isToday && 'bg-red-50/40 dark:bg-red-500/5'
              )}
            >
              {/* Day number */}
              <div className={cn(
                'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold mb-1',
                isToday
                  ? 'bg-red-500 text-white'
                  : 'text-gray-700 dark:text-gray-300'
              )}>
                {day}
              </div>

              {/* Cards */}
              <div className="space-y-0.5">
                {dayCards.slice(0, 3).map(card => (
                  <div
                    key={card.id}
                    onClick={(e) => { e.stopPropagation(); onCardOpen(card); }}
                    className={cn(
                      'w-full text-left px-1.5 py-0.5 rounded text-[11px] font-medium truncate cursor-pointer transition-opacity hover:opacity-80',
                      PRIORITY_CONFIG[card.priority].bgColor,
                      PRIORITY_CONFIG[card.priority].color
                    )}
                    title={card.title}
                  >
                    {card.title}
                  </div>
                ))}
                {dayCards.length > 3 && (
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 pl-1">
                    +{dayCards.length - 3} {t('kanban.calendarMore', 'mais')}
                  </div>
                )}
              </div>

              {/* Add card hint */}
              {onCreateCard && (
                <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Plus className="w-3 h-3 text-gray-400 dark:text-gray-500" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// LOADING SKELETON
// ═══════════════════════════════════════════════════════════
function KanbanSkeleton() {
  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-3">
        <div className="shimmer h-8 w-32 rounded-xl" />
        <div className="shimmer h-8 w-28 rounded-xl" />
      </div>
      <div className="shimmer h-10 w-80 rounded-xl" />
      <div className="flex gap-4 overflow-hidden">
        {[1, 2, 3].map(i => (
          <div key={i} className="w-[300px] min-w-[300px] flex-shrink-0 space-y-3">
            <div className="shimmer h-6 w-28 rounded-lg" />
            <div className="space-y-2.5 p-1.5">
              {[1, 2, 3].map(j => (
                <div key={j} className="shimmer rounded-xl" style={{ height: 80 + j * 10 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// EMPTY STATE (no boards yet)
// ═══════════════════════════════════════════════════════════
function EmptyBoards({ onCreateBoard }: { onCreateBoard: () => void }) {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center justify-center py-20 text-center px-4"
    >
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-50 to-red-100 dark:from-red-500/10 dark:to-red-500/5 flex items-center justify-center mb-5 shadow-sm">
        <LayoutGrid className="w-8 h-8 text-red-400 dark:text-red-500" />
      </div>
      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display mb-2">
        {t('kanban.noBoardsYet', 'Nenhum board ainda')}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-xs">
        {t('kanban.noBoardsDesc', 'Crie seu primeiro board para organizar as tarefas da sua equipe.')}
      </p>
      <button
        onClick={onCreateBoard}
        className={cn(
          'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all',
          'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700',
          'shadow-md shadow-red-500/25 hover:shadow-lg hover:shadow-red-500/30 hover:-translate-y-0.5'
        )}
      >
        <Plus className="w-4 h-4" />
        {t('kanban.createFirstBoard', 'Criar primeiro board')}
      </button>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN MODULE
// ═══════════════════════════════════════════════════════════
export default function KanbanModule() {
  const { t } = useTranslation();
  const { user, business, sectors, userSectorIds } = useAuth();
  const isAdmin = ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY['admin'];

  // ─── Real-time state ──────────────────────────────────────
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [archivedBoards, setArchivedBoards] = useState<KanbanBoard[]>([]);
  const [showArchivedPanel, setShowArchivedPanel] = useState(false);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [members, setMembers] = useState<MemberDisplay[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(true);
  const [loadingCards, setLoadingCards] = useState(false);

  // ─── UI state ─────────────────────────────────────────────
  const [activeBoardId, setActiveBoardId] = useState<string>('');
  const [viewMode, setViewMode] = useState<KanbanViewMode>('board');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<KanbanPriority | 'all'>('all');
  const [filterAssignee, setFilterAssignee] = useState<string | 'all'>('all');

  // Dialogs
  const [selectedCard, setSelectedCard] = useState<KanbanCard | null>(null);
  const [newCardColumnId, setNewCardColumnId] = useState<string | null>(null);
  const [newCardDate, setNewCardDate] = useState<string | undefined>(undefined);
  const [showNewColumn, setShowNewColumn] = useState(false);
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [archiveBoardConfirmId, setArchiveBoardConfirmId] = useState<string | null>(null);
  const [deleteColumnConfirm, setDeleteColumnConfirm] = useState<{ columnId: string; columnTitle: string } | null>(null);

  // Templates
  const [templates, setTemplates] = useState<KanbanCardTemplate[]>([]);

  // Drag state
  const [draggingCard, setDraggingCard] = useState<KanbanCard | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const showToast = useCallback((message: string, type: 'error' | 'success' = 'error') => setToast({ message, type }), []);

  // Permission helpers
  const canEdit = ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY['operator'];
  const canManageBoard = ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY['manager'];

  // ─── Firestore: boards listener ───────────────────────────
  useEffect(() => {
    if (!business?.id) return;
    const q = query(
      collection(db, 'kanbanBoards'),
      where('businessId', '==', business.id)
    );
    const unsub = onSnapshot(q, (snap) => {
      const allBoards = snap.docs
        .map(d => ({ ...d.data(), id: d.id } as KanbanBoard))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      // Separate active and archived boards
      setArchivedBoards(allBoards.filter(b => b.isArchived));

      const activeBoards = allBoards.filter(b => !b.isArchived);

      // Apply sector-based visibility filtering
      const data = activeBoards.filter(board => {
        if (isAdmin) return true;
        const visibility = board.visibility || 'all';
        switch (visibility) {
          case 'all': return true;
          case 'members': return board.memberIds.includes(user?.uid || '');
          case 'sectors':
            return board.sectorIds?.some(s => userSectorIds.includes(s))
                   || board.memberIds.includes(user?.uid || '');
          default: return true;
        }
      });
      setBoards(data);
      setLoadingBoards(false);
      // Auto-select first board if none selected or current is gone
      if (data.length > 0) {
        setActiveBoardId(prev => (!prev || !data.find(b => b.id === prev)) ? data[0].id : prev);
      }
    }, () => setLoadingBoards(false));
    return () => unsub();
  }, [business?.id, isAdmin, user?.uid, userSectorIds]);

  // ─── Firestore: cards listener (scoped to active board) ───
  useEffect(() => {
    if (!business?.id || !activeBoardId) return;
    setLoadingCards(true);
    const q = query(
      collection(db, 'kanbanCards'),
      where('businessId', '==', business.id),
      where('boardId', '==', activeBoardId)
    );
    const unsub = onSnapshot(q, (snap) => {
      setCards(snap.docs.map(d => ({ ...d.data(), id: d.id } as KanbanCard)));
      setLoadingCards(false);
    }, () => setLoadingCards(false));
    return () => {
      unsub();
      setLoadingCards(false);
    };
  }, [business?.id, activeBoardId]);

  // ─── Firestore: my tasks cross-board query ────────────────
  const [myTasksCards, setMyTasksCards] = useState<KanbanCard[]>([]);

  useEffect(() => {
    if (!business?.id || !user?.uid) return;
    const q = query(
      collection(db, 'kanbanCards'),
      where('businessId', '==', business.id),
      where('assigneeIds', 'array-contains', user.uid)
    );
    const unsub = onSnapshot(q, (snap) => {
      setMyTasksCards(snap.docs.map(d => ({ ...d.data(), id: d.id } as KanbanCard)));
    });
    return () => unsub();
  }, [business?.id, user?.uid]);

  // ─── Firestore: card templates listener ───────────────────
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'kanbanTemplates'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, snap => {
      setTemplates(snap.docs.map(d => ({ ...d.data(), id: d.id } as KanbanCardTemplate)));
    });
    return () => unsub();
  }, [business?.id]);

  // ─── Firestore: team members listener ─────────────────────
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'users'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      setMembers(snap.docs.map(d => {
        const u = { ...d.data(), id: d.id } as User;
        return { id: u.id, name: u.name, photoURL: u.photoURL };
      }));
    });
    return () => unsub();
  }, [business?.id]);

  // ─── Sync selectedCard when cards update (multi-user) ─────
  useEffect(() => {
    if (!selectedCard) return;
    const latest = cards.find(c => c.id === selectedCard.id);
    if (!latest) {
      setSelectedCard(null); // Deleted by another user
    } else {
      setSelectedCard(latest); // Updated by another user
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  // ─── Derived ──────────────────────────────────────────────
  const activeBoard = boards.find(b => b.id === activeBoardId);
  const boardCards = cards; // already filtered by boardId via Firestore

  // ─── Overdue automation: mark past-due cards as urgent ────
  const processedOverdueRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    processedOverdueRef.current = new Set(); // reset when board changes
  }, [activeBoardId]);

  useEffect(() => {
    if (!business?.id || !activeBoard?.automations) return;
    const overdueAuto = activeBoard.automations.find(a => a.isEnabled && a.trigger === 'due_date_passed');
    if (!overdueAuto) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const toProcess = boardCards.filter(c => {
      if (!c.dueDate || processedOverdueRef.current.has(c.id)) return false;
      return new Date(c.dueDate + 'T00:00:00') < today;
    });
    if (toProcess.length === 0) return;
    toProcess.forEach(card => {
      processedOverdueRef.current.add(card.id);
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      for (const action of overdueAuto.actions) {
        if (action.type === 'set_priority') updates.priority = action.value;
      }
      updateDoc(doc(db, 'kanbanCards', card.id), updates).catch(console.error);
    });
    showToast(`${toProcess.length} card${toProcess.length > 1 ? 's' : ''} marcado${toProcess.length > 1 ? 's' : ''} como urgente por automação`, 'success');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardCards, activeBoard?.automations]);

  const filteredCards = useMemo(() => {
    return boardCards.filter(card => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!card.title.toLowerCase().includes(q) && !(card.description || '').toLowerCase().includes(q)) {
          return false;
        }
      }
      if (filterPriority !== 'all' && card.priority !== filterPriority) return false;
      if (filterAssignee !== 'all' && !card.assigneeIds.includes(filterAssignee)) return false;
      return true;
    });
  }, [boardCards, searchQuery, filterPriority, filterAssignee]);

  const sortedColumns = activeBoard ? [...activeBoard.columns].sort((a, b) => a.order - b.order) : [];

  // ─── Drag handlers ────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, card: KanbanCard) => {
    setDraggingCard(card);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
    setDragOverCardId(null); // clear card indicator when hovering over empty column space
  }, []);

  // Card-level drag over — stops propagation so column handler doesn't clear dragOverCardId
  const handleDragOverCard = useCallback((e: React.DragEvent, card: KanbanCard) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCardId(card.id);
    setDragOverColumn(card.columnId); // highlight the column too
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    setDragOverCardId(null);
    if (!draggingCard || !business?.id) return;
    if (!canEdit) { showToast(t('kanban.errors.noPermission', 'Sem permissão para mover cards')); setDraggingCard(null); return; }
    if (draggingCard.columnId === targetColumnId) {
      setDraggingCard(null);
      return;
    }
    try {
      const targetColumnCards = cards.filter(c => c.columnId === targetColumnId);
      const newOrder = targetColumnCards.length;
      await updateDoc(doc(db, 'kanbanCards', draggingCard.id), {
        columnId: targetColumnId,
        order: newOrder,
        updatedAt: new Date().toISOString(),
      });

      // Execute move_to_column automations
      const moveAutomations = (activeBoard?.automations || []).filter(
        a => a.isEnabled && a.trigger === 'move_to_column' && a.triggerColumnId === targetColumnId
      );
      if (moveAutomations.length > 0) {
        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        let updatedLabels = [...draggingCard.labels];
        let updatedAssigneeIds = [...draggingCard.assigneeIds];
        let updatedAssigneeNames = [...draggingCard.assigneeNames];
        for (const auto of moveAutomations) {
          for (const action of auto.actions) {
            if (action.type === 'set_priority') updates.priority = action.value;
            if (action.type === 'add_label') {
              const label = DEFAULT_LABELS.find(l => l.id === action.value);
              if (label && !updatedLabels.find(l => l.id === action.value)) updatedLabels = [...updatedLabels, label];
            }
            if (action.type === 'assign_user') {
              const member = members.find(m => m.id === action.value);
              if (member && !updatedAssigneeIds.includes(action.value)) {
                updatedAssigneeIds = [...updatedAssigneeIds, action.value];
                updatedAssigneeNames = [...updatedAssigneeNames, member.name];
              }
            }
          }
        }
        if (updatedLabels.length !== draggingCard.labels.length) updates.labels = updatedLabels;
        if (updatedAssigneeIds.length !== draggingCard.assigneeIds.length) {
          updates.assigneeIds = updatedAssigneeIds;
          updates.assigneeNames = updatedAssigneeNames;
        }
        if (Object.keys(updates).length > 1) {
          await updateDoc(doc(db, 'kanbanCards', draggingCard.id), updates);
          showToast(t('kanban.automation.applied', 'Automação aplicada'), 'success');
        }
      }

      // Recurrence: if dropped into the last column, create next occurrence
      const isLastColumn = sortedColumns.length > 0 &&
        sortedColumns[sortedColumns.length - 1].id === targetColumnId;
      if (isLastColumn && draggingCard.recurrence && draggingCard.dueDate && business?.id) {
        const currentDue = new Date(draggingCard.dueDate + 'T00:00:00');
        if (draggingCard.recurrence === 'daily') currentDue.setDate(currentDue.getDate() + 1);
        else if (draggingCard.recurrence === 'weekly') currentDue.setDate(currentDue.getDate() + 7);
        else if (draggingCard.recurrence === 'monthly') currentDue.setMonth(currentDue.getMonth() + 1);
        const nextDue = currentDue.toISOString().split('T')[0];
        const firstColId = sortedColumns[0].id;
        const firstColCards = cards.filter(c => c.columnId === firstColId);
        await addDoc(collection(db, 'kanbanCards'), {
          businessId: business.id,
          boardId: draggingCard.boardId,
          columnId: firstColId,
          title: draggingCard.title,
          description: draggingCard.description || null,
          priority: draggingCard.priority,
          labels: draggingCard.labels,
          assigneeIds: draggingCard.assigneeIds,
          assigneeNames: draggingCard.assigneeNames,
          dueDate: nextDue,
          checklist: (draggingCard.checklist || []).map(item => ({ ...item, completed: false })),
          comments: [],
          attachments: [],
          recurrence: draggingCard.recurrence,
          commentsCount: 0,
          attachmentsCount: 0,
          coverColor: draggingCard.coverColor || null,
          order: firstColCards.length,
          createdBy: draggingCard.createdBy,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        showToast(t('kanban.recurrence.created', 'Próxima ocorrência criada automaticamente'), 'success');
      }
    } catch (err) {
      console.error('Error moving card:', err);
      showToast(t('kanban.errors.moveCard', 'Erro ao mover card'));
    }
    setDraggingCard(null);
  }, [draggingCard, business?.id, canEdit, cards, sortedColumns, showToast, t]);

  const handleDragEnd = useCallback(() => {
    setDraggingCard(null);
    setDragOverColumn(null);
    setDragOverCardId(null);
  }, []);

  // Drop on a specific card — handles within-column reorder; cross-column drops
  // propagate up to the column's handleDrop (which runs automations etc.)
  const handleDropOnCard = useCallback(async (e: React.DragEvent, targetCard: KanbanCard) => {
    if (!draggingCard || draggingCard.id === targetCard.id) {
      setDraggingCard(null);
      setDragOverCardId(null);
      return;
    }

    // Only handle same-column reorder here; cross-column bubbles to handleDrop
    if (draggingCard.columnId !== targetCard.columnId) return;

    e.stopPropagation(); // prevent column's handleDrop from firing
    setDragOverColumn(null);
    setDragOverCardId(null);

    if (!business?.id || !canEdit) {
      if (!canEdit) showToast(t('kanban.errors.noPermission', 'Sem permissão para mover cards'));
      setDraggingCard(null);
      return;
    }

    const columnCards = cards
      .filter(c => c.columnId === targetCard.columnId)
      .sort((a, b) => a.order - b.order);

    // Remove dragging card, then insert before target card
    const reordered = columnCards.filter(c => c.id !== draggingCard.id);
    const insertAt = reordered.findIndex(c => c.id === targetCard.id);
    reordered.splice(insertAt >= 0 ? insertAt : reordered.length, 0, draggingCard);

    try {
      const batch = writeBatch(db);
      reordered.forEach((card, i) => {
        batch.update(doc(db, 'kanbanCards', card.id), {
          order: i,
          updatedAt: new Date().toISOString(),
        });
      });
      await batch.commit();
    } catch (err) {
      console.error('Error reordering cards:', err);
      showToast(t('kanban.errors.moveCard', 'Erro ao mover card'));
    }
    setDraggingCard(null);
  }, [draggingCard, business?.id, canEdit, cards, showToast, t]);

  // ─── Card CRUD ────────────────────────────────────────────
  const handleCreateCard = useCallback(async (partial: Partial<KanbanCard>) => {
    if (!business?.id || !user || !activeBoardId) return;
    if (!canEdit) { showToast(t('kanban.errors.noPermission', 'Sem permissão para criar cards')); return; }
    const columnCards = cards.filter(c => c.columnId === partial.columnId);
    try {
      const cardRef = await addDoc(collection(db, 'kanbanCards'), {
        businessId: business.id,
        boardId: activeBoardId,
        columnId: partial.columnId,
        title: partial.title,
        description: partial.description || null,
        priority: partial.priority || 'medium',
        labels: partial.labels || [],
        assigneeIds: partial.assigneeIds || [],
        assigneeNames: partial.assigneeNames || [],
        dueDate: partial.dueDate || null,
        checklist: [],
        commentsCount: 0,
        attachmentsCount: 0,
        coverColor: null,
        order: columnCards.length,
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Notify assigned users on card creation
      const assignees = partial.assigneeIds || [];
      if (assignees.length > 0) {
        notifyUsers(db, assignees, {
          businessId: business.id,
          type: 'task_assigned',
          title: t('kanban.notif.assigned', 'Tarefa atribuída'),
          body: `${user.name} ${t('kanban.notif.assignedYou', 'atribuiu você à tarefa')} "${partial.title}"`,
          link: 'Kanban',
          relatedId: cardRef.id,
          actorId: user.uid,
          actorName: user.name,
        }).catch(err => console.warn('Notification dispatch failed:', err));
      }
    } catch (err) {
      console.error('Error creating card:', err);
      showToast(t('kanban.errors.createCard', 'Erro ao criar card'));
    }
  }, [business?.id, user, activeBoardId, cards, canEdit, showToast, t]);

  const handleUpdateCard = useCallback(async (updated: KanbanCard) => {
    if (!business?.id || !user) return;
    if (!canEdit) { showToast(t('kanban.errors.noPermission', 'Sem permissão para editar cards')); return; }
    const { id, ...data } = updated;
    const now = new Date().toISOString();

    // Detect new assignees for notification
    const previous = cards.find(c => c.id === id);
    const prevAssignees = new Set(previous?.assigneeIds || []);
    const newAssignees = (updated.assigneeIds || []).filter(uid => !prevAssignees.has(uid));

    setSelectedCard({ ...updated, updatedAt: now });
    try {
      // Only send mutable fields to Firestore
      const { businessId: _b, boardId: _bo, createdBy: _c, createdAt: _ca, ...mutableData } = data;
      await updateDoc(doc(db, 'kanbanCards', id), {
        ...mutableData,
        updatedAt: now,
      });

      // Notify newly assigned users
      if (newAssignees.length > 0) {
        notifyUsers(db, newAssignees, {
          businessId: business.id,
          type: 'task_assigned',
          title: t('kanban.notif.assigned', 'Tarefa atribuída'),
          body: `${user.name} ${t('kanban.notif.assignedYou', 'atribuiu você à tarefa')} "${updated.title}"`,
          link: 'Kanban',
          relatedId: id,
          actorId: user.uid,
          actorName: user.name,
        }).catch(err => console.warn('Notification dispatch failed:', err));
      }
    } catch (err) {
      console.error('Error updating card:', err);
      showToast(t('kanban.errors.updateCard', 'Erro ao atualizar card'));
    }
  }, [business?.id, user, canEdit, cards, showToast, t]);

  const handleDeleteCard = useCallback(async (cardId: string) => {
    if (!business?.id) return;
    if (!canEdit) { showToast(t('kanban.errors.noPermission', 'Sem permissão para excluir cards')); return; }
    try {
      await deleteDoc(doc(db, 'kanbanCards', cardId));
      setSelectedCard(null);
    } catch (err) {
      console.error('Error deleting card:', err);
      showToast(t('kanban.errors.deleteCard', 'Erro ao excluir card'));
    }
  }, [business?.id, canEdit, showToast, t]);

  // ─── Column CRUD ──────────────────────────────────────────
  const handleAddColumn = useCallback(async (title: string, color: string) => {
    if (!business?.id || !activeBoard) return;
    if (!canManageBoard) { showToast(t('kanban.errors.noPermission', 'Sem permissão para adicionar colunas')); return; }
    const newCol: KanbanColumn = {
      id: genLocalId(),
      title,
      color,
      order: activeBoard.columns.length,
    };
    try {
      await updateDoc(doc(db, 'kanbanBoards', activeBoardId), {
        columns: [...activeBoard.columns, newCol],
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error adding column:', err);
      showToast(t('kanban.errors.addColumn', 'Erro ao adicionar coluna'));
    }
    setShowNewColumn(false);
  }, [business?.id, activeBoardId, activeBoard, canManageBoard, showToast, t]);

  const handleDeleteColumn = useCallback((columnId: string) => {
    if (!business?.id || !activeBoard) return;
    if (!canManageBoard) { showToast(t('kanban.errors.noPermission', 'Sem permissão')); return; }
    const columnCards = cards.filter(c => c.columnId === columnId);
    if (columnCards.length > 0) {
      showToast(t('kanban.errors.columnNotEmpty', 'Remova todos os cards da coluna antes de excluí-la'));
      return;
    }
    if (activeBoard.columns.length <= 1) {
      showToast(t('kanban.errors.lastColumn', 'O board precisa ter pelo menos uma coluna'));
      return;
    }
    const column = activeBoard.columns.find(c => c.id === columnId);
    setDeleteColumnConfirm({ columnId, columnTitle: column?.title ?? 'esta coluna' });
  }, [business?.id, activeBoard, cards, canManageBoard, showToast, t]);

  const handleDeleteColumnConfirmed = useCallback(async () => {
    if (!business?.id || !activeBoard || !deleteColumnConfirm) return;
    try {
      const updatedColumns = activeBoard.columns
        .filter(c => c.id !== deleteColumnConfirm.columnId)
        .map((c, i) => ({ ...c, order: i }));
      await updateDoc(doc(db, 'kanbanBoards', activeBoardId), {
        columns: updatedColumns,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error deleting column:', err);
      showToast(t('kanban.errors.deleteColumn', 'Erro ao excluir coluna'));
    } finally {
      setDeleteColumnConfirm(null);
    }
  }, [business?.id, activeBoardId, activeBoard, deleteColumnConfirm, showToast, t]);

  // Opens the confirmation dialog — actual archive happens in handleArchiveConfirmed
  const handleArchiveBoard = useCallback((boardId: string) => {
    if (!canManageBoard) { showToast(t('kanban.errors.noPermission', 'Sem permissão')); return; }
    setArchiveBoardConfirmId(boardId);
  }, [canManageBoard, showToast, t]);

  const handleArchiveConfirmed = useCallback(async () => {
    if (!business?.id || !archiveBoardConfirmId) return;
    try {
      await updateDoc(doc(db, 'kanbanBoards', archiveBoardConfirmId), {
        isArchived: true,
        updatedAt: new Date().toISOString(),
      });
      if (activeBoardId === archiveBoardConfirmId) {
        const remaining = boards.filter(b => b.id !== archiveBoardConfirmId);
        setActiveBoardId(remaining.length > 0 ? remaining[0].id : '');
      }
      showToast(t('kanban.boardArchived', 'Board arquivado'), 'success');
    } catch (err) {
      console.error('Error archiving board:', err);
      showToast(t('kanban.errors.archiveBoard', 'Erro ao arquivar board'));
    } finally {
      setArchiveBoardConfirmId(null);
    }
  }, [business?.id, archiveBoardConfirmId, activeBoardId, boards, showToast, t]);

  const handleRestoreBoard = useCallback(async (boardId: string) => {
    if (!business?.id || !canManageBoard) return;
    try {
      await updateDoc(doc(db, 'kanbanBoards', boardId), {
        isArchived: false,
        updatedAt: new Date().toISOString(),
      });
      showToast(t('kanban.boardRestored', 'Board restaurado'), 'success');
    } catch (err) {
      console.error('Error restoring board:', err);
      showToast(t('kanban.errors.restoreBoard', 'Erro ao restaurar board'));
    }
  }, [business?.id, canManageBoard, showToast, t]);

  const handleRenameBoard = useCallback(async (boardId: string, newName: string) => {
    if (!business?.id || !newName.trim()) return;
    if (!canManageBoard) { showToast(t('kanban.errors.noPermission', 'Sem permissão')); return; }
    try {
      await updateDoc(doc(db, 'kanbanBoards', boardId), {
        name: newName.trim(),
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Error renaming board:', err);
      showToast(t('kanban.errors.renameBoard', 'Erro ao renomear board'));
    }
  }, [business?.id, canManageBoard, showToast, t]);

  // ─── Board CRUD ───────────────────────────────────────────
  const handleCreateBoard = useCallback(async (name: string, color: string, presetId?: string) => {
    if (!business?.id || !user) return;
    if (!canManageBoard) { showToast(t('kanban.errors.noPermission', 'Sem permissão para criar boards')); return; }
    const preset = BOARD_PRESETS.find(p => p.id === presetId);
    const defaultColumns: KanbanColumn[] = preset
      ? preset.columns.map((c, i) => ({ id: genLocalId(), title: c.title, color: c.color, order: i }))
      : [
          { id: genLocalId(), title: t('kanban.defaultColTodo', 'A Fazer'),       color: '#3B82F6', order: 0 },
          { id: genLocalId(), title: t('kanban.defaultColInProgress', 'Em Progresso'), color: '#F59E0B', order: 1 },
          { id: genLocalId(), title: t('kanban.defaultColDone', 'Concluído'),     color: '#10B981', order: 2 },
        ];
    try {
      const docRef = await addDoc(collection(db, 'kanbanBoards'), {
        businessId: business.id,
        name,
        description: '',
        color,
        columns: defaultColumns,
        memberIds: [user.uid],
        sectorIds: [],
        visibility: 'all' as KanbanVisibility,
        createdBy: user.uid,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setActiveBoardId(docRef.id);
    } catch (err) {
      console.error('Error creating board:', err);
      showToast(t('kanban.errors.createBoard', 'Erro ao criar board'));
    }
  }, [business?.id, user, canManageBoard, showToast, t]);

  // ─── Template handlers ────────────────────────────────────
  const handleSaveTemplate = useCallback(async (card: KanbanCard, templateName: string) => {
    if (!business?.id || !user) return;
    try {
      await addDoc(collection(db, 'kanbanTemplates'), {
        businessId: business.id,
        name: templateName,
        title: card.title,
        description: card.description || null,
        priority: card.priority,
        labels: card.labels,
        checklist: (card.checklist || []).map(item => ({ ...item, completed: false })),
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      });
      showToast(t('kanban.template.saved', 'Template salvo com sucesso'), 'success');
    } catch (err) {
      console.error('Error saving template:', err);
      showToast(t('kanban.errors.saveTemplate', 'Erro ao salvar template'));
    }
  }, [business?.id, user, showToast, t]);

  // ─── Automation handler ───────────────────────────────────
  const handleSaveAutomations = useCallback(async (automations: KanbanAutomation[]) => {
    if (!business?.id || !activeBoard) return;
    try {
      await updateDoc(doc(db, 'kanbanBoards', activeBoardId), {
        automations,
        updatedAt: new Date().toISOString(),
      });
      showToast(t('kanban.automation.saved', 'Automações salvas'), 'success');
    } catch (err) {
      console.error('Error saving automations:', err);
      showToast(t('kanban.errors.saveAutomations', 'Erro ao salvar automações'));
    }
  }, [business?.id, activeBoardId, activeBoard, showToast, t]);

  // ─── Keyboard shortcuts ───────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedCard) setSelectedCard(null);
        else if (newCardColumnId) setNewCardColumnId(null);
        else if (showNewColumn) setShowNewColumn(false);
        else if (showNewBoard) setShowNewBoard(false);
        else if (showAutomations) setShowAutomations(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedCard, newCardColumnId, showNewColumn, showNewBoard]);

  // Body overflow lock when dialogs are open
  useEffect(() => {
    const locked = !!(selectedCard || newCardColumnId || showNewBoard || showAutomations);
    document.body.style.overflow = locked ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [selectedCard, newCardColumnId, showNewBoard]);

  // ─── Stats ────────────────────────────────────────────────
  const urgentCount = boardCards.filter(c => c.priority === 'urgent').length;
  const overdueCount = boardCards.filter(c => {
    if (!c.dueDate) return false;
    const d = new Date(c.dueDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d < today;
  }).length;

  const urgentTaskCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return myTasksCards.filter(c => {
      if (!c.dueDate) return false;
      return new Date(c.dueDate + 'T00:00:00') <= today;
    }).length;
  }, [myTasksCards]);

  // ─── Loading ──────────────────────────────────────────────
  if (loadingBoards) {
    return <KanbanSkeleton />;
  }

  // ─── No boards yet ────────────────────────────────────────
  if (boards.length === 0) {
    return (
      <>
        <EmptyBoards onCreateBoard={() => setShowNewBoard(true)} />
        <AnimatePresence>
          {showNewBoard && (
            <NewBoardDialog
              key="new-board"
              onClose={() => setShowNewBoard(false)}
              onCreate={handleCreateBoard}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  if (!activeBoard) return null;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-col h-full"
      onDragEnd={handleDragEnd}
    >
      {/* Stats + Board header area */}
      <motion.div variants={itemVariants} className="flex-shrink-0 px-4 sm:px-6 lg:px-8 pt-4 sm:pt-5 pb-2 space-y-3">
        {/* Stats bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm">
              <LayoutGrid className="w-4 h-4 text-gray-400 dark:text-gray-500" />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-bold text-gray-900 dark:text-gray-100">{boardCards.length}</span> cards
              </span>
            </div>
            {loadingCards && (
              <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t('kanban.syncing', 'Sincronizando...')}</span>
              </div>
            )}
            {urgentCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                <Flame className="w-4 h-4 text-red-500 dark:text-red-400" />
                <span className="text-sm text-red-600 dark:text-red-400 font-medium">{t(urgentCount === 1 ? 'kanban.urgentCount_one' : 'kanban.urgentCount_other', urgentCount === 1 ? '{{count}} urgente' : '{{count}} urgentes', { count: urgentCount })}</span>
              </div>
            )}
            {overdueCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">{t(overdueCount === 1 ? 'kanban.overdueCount_one' : 'kanban.overdueCount_other', overdueCount === 1 ? '{{count}} atrasado' : '{{count}} atrasados', { count: overdueCount })}</span>
              </div>
            )}
          </div>
        </div>

        {/* Board header: tabs, search, filters */}
        <BoardHeader
          boards={boards}
          activeBoard={activeBoard}
          members={members}
          onSelectBoard={setActiveBoardId}
          onNewBoard={() => setShowNewBoard(true)}
          onArchiveBoard={handleArchiveBoard}
          archivedBoards={archivedBoards}
          onRestoreBoard={handleRestoreBoard}
          canManageBoard={canManageBoard}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filterPriority={filterPriority}
          onFilterPriorityChange={setFilterPriority}
          filterAssignee={filterAssignee}
          onFilterAssigneeChange={setFilterAssignee}
          totalCards={boardCards.length}
          filteredCards={filteredCards.length}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          urgentTaskCount={urgentTaskCount}
          onOpenAutomations={canManageBoard ? () => setShowAutomations(true) : undefined}
        />
      </motion.div>

      {/* Content area — switches based on viewMode */}
      {/* Board view — always rendered in DOM to avoid height/scroll issues on remount */}
      <motion.div
        variants={itemVariants}
        className="flex-1 overflow-x-auto overflow-y-hidden px-4 sm:px-6 lg:px-8 pb-4"
        style={{ scrollbarWidth: 'thin', display: viewMode === 'board' ? undefined : 'none' }}
      >
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex gap-4 h-full"
        >
          {sortedColumns.map(column => {
            const columnCards = filteredCards
              .filter(c => c.columnId === column.id)
              .sort((a, b) => a.order - b.order);

            return (
              <KanbanColumnComponent
                key={column.id}
                column={column}
                cards={columnCards}
                members={members}
                onCardOpen={setSelectedCard}
                onAddCard={canEdit ? (colId) => setNewCardColumnId(colId) : undefined}
                onDeleteColumn={canManageBoard ? handleDeleteColumn : undefined}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragOverCard={handleDragOverCard}
                onDropOnCard={handleDropOnCard}
                dragOverColumnId={dragOverColumn}
                draggingCardId={draggingCard?.id || null}
                dragOverCardId={dragOverCardId}
              />
            );
          })}

          {/* Add column button — managers/admins only */}
          {canManageBoard && <AnimatePresence mode="wait">
            {showNewColumn ? (
              <NewColumnInline
                key="new-column-form"
                onAdd={handleAddColumn}
                onCancel={() => setShowNewColumn(false)}
              />
            ) : (
              <motion.button
                key="add-column-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowNewColumn(true)}
                className={cn(
                  'w-[300px] min-w-[300px] flex-shrink-0 self-start',
                  'flex items-center justify-center gap-2 py-4',
                  'rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700',
                  'text-sm font-medium text-gray-400 dark:text-gray-500',
                  'hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-50/50 dark:hover:bg-white/[0.02]',
                  'transition-all duration-200'
                )}
              >
                <Plus className="w-4 h-4" />
                {t('kanban.addColumn', 'Adicionar coluna')}
              </motion.button>
            )}
          </AnimatePresence>}
        </motion.div>
      </motion.div>

      {/* List view */}
      {viewMode === 'list' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pb-4"
          style={{ scrollbarWidth: 'thin' }}
        >
          <ListView
            cards={filteredCards}
            columns={sortedColumns}
            members={members}
            onCardOpen={setSelectedCard}
          />
        </motion.div>
      )}

      {/* Calendar view */}
      {viewMode === 'calendar' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pb-4"
          style={{ scrollbarWidth: 'thin' }}
        >
          <CalendarView
            cards={filteredCards}
            onCardOpen={setSelectedCard}
            onCreateCard={canEdit ? (date) => {
              const firstColId = sortedColumns[0]?.id;
              if (firstColId) { setNewCardDate(date); setNewCardColumnId(firstColId); }
            } : undefined}
          />
        </motion.div>
      )}

      {/* My Tasks view */}
      {viewMode === 'mytasks' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pb-4"
          style={{ scrollbarWidth: 'thin' }}
        >
          <MyTasksView
            cards={myTasksCards}
            boards={boards}
            onCardOpen={setSelectedCard}
          />
        </motion.div>
      )}

      {/* Card detail dialog */}
      <AnimatePresence>
        {selectedCard && (
          <CardDetailDialog
            key="card-detail"
            card={selectedCard}
            columns={sortedColumns}
            currentUser={user}
            members={members}
            onClose={() => setSelectedCard(null)}
            onUpdate={handleUpdateCard}
            onDelete={handleDeleteCard}
            onSaveTemplate={canEdit ? handleSaveTemplate : undefined}
          />
        )}
      </AnimatePresence>

      {/* New card dialog */}
      <AnimatePresence>
        {newCardColumnId && (
          <NewCardDialog
            key="new-card"
            columnId={newCardColumnId}
            columns={sortedColumns}
            members={members}
            onClose={() => { setNewCardColumnId(null); setNewCardDate(undefined); }}
            onCreate={handleCreateCard}
            initialDueDate={newCardDate}
            templates={templates}
          />
        )}
      </AnimatePresence>

      {/* Automation dialog */}
      <AnimatePresence>
        {showAutomations && activeBoard && (
          <AutomationDialog
            key="automation-dialog"
            board={activeBoard}
            members={members}
            onClose={() => setShowAutomations(false)}
            onSave={handleSaveAutomations}
          />
        )}
      </AnimatePresence>

      {/* New board dialog */}
      <AnimatePresence>
        {showNewBoard && (
          <NewBoardDialog
            key="new-board"
            onClose={() => setShowNewBoard(false)}
            onCreate={handleCreateBoard}
          />
        )}
      </AnimatePresence>

      {/* Archive board confirmation dialog */}
      <AnimatePresence>
        {archiveBoardConfirmId && (() => {
          const boardToArchive = boards.find(b => b.id === archiveBoardConfirmId);
          return (
            <motion.div
              key="archive-confirm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
              onClick={() => setArchiveBoardConfirmId(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 8 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 w-full max-w-sm p-6"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                    <Archive className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                      {t('kanban.archiveConfirmTitle', 'Arquivar board')}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {boardToArchive?.name}
                    </p>
                  </div>
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
                  {t(
                    'kanban.archiveConfirmBody',
                    'Este board será arquivado e removido da lista. Os cards não serão excluídos e o board pode ser restaurado a qualquer momento.',
                  )}
                </p>

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setArchiveBoardConfirmId(null)}
                    className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    {t('kanban.cancel', 'Cancelar')}
                  </button>
                  <button
                    onClick={handleArchiveConfirmed}
                    className="px-4 py-2 text-sm rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors"
                  >
                    {t('kanban.archiveConfirm', 'Arquivar')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Delete column confirmation dialog */}
      <AnimatePresence>
        {deleteColumnConfirm && (
          <motion.div
            key="delete-col-confirm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => setDeleteColumnConfirm(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 w-full max-w-sm p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                    {t('kanban.deleteColumnTitle', 'Excluir coluna')}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {deleteColumnConfirm.columnTitle}
                  </p>
                </div>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
                {t(
                  'kanban.deleteColumnBody',
                  'Tem certeza que deseja excluir esta coluna? Essa ação não pode ser desfeita.',
                )}
              </p>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeleteColumnConfirm(null)}
                  className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {t('kanban.cancel', 'Cancelar')}
                </button>
                <button
                  onClick={handleDeleteColumnConfirmed}
                  className="px-4 py-2 text-sm rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
                >
                  {t('kanban.deleteColumnConfirm', 'Excluir coluna')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast notifications */}
      <AnimatePresence>
        {toast && (
          <KanbanToast
            key="kanban-toast"
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
