'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type {
  KanbanBoard,
  KanbanColumn,
  KanbanCard,
  KanbanLabel,
  KanbanPriority,
  KanbanChecklistItem,
} from '@/lib/types';
import {
  Plus,
  MoreHorizontal,
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
  Trash2,
  Edit3,
  Copy,
  Archive,
  Tag,
  User as UserIcon,
  CalendarDays,
  AlignLeft,
  CheckCircle2,
  Circle,
  Square,
  LayoutGrid,
  Star,
  Sparkles,
} from 'lucide-react';

// ─── Priority Config ──────────────────────────────────────
const PRIORITY_CONFIG: Record<KanbanPriority, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  urgent: { label: 'Urgente', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20', icon: Flame },
  high:   { label: 'Alta',    color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20', icon: ArrowUp },
  medium: { label: 'Média',   color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20', icon: Minus },
  low:    { label: 'Baixa',   color: 'text-gray-500 dark:text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700', icon: ArrowDown },
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

// ─── Mock Members ─────────────────────────────────────────
const MOCK_MEMBERS = [
  { id: 'u1', name: 'Igor Garcia', photoURL: null },
  { id: 'u2', name: 'Ana Silva', photoURL: null },
  { id: 'u3', name: 'Carlos Santos', photoURL: null },
  { id: 'u4', name: 'Maria Oliveira', photoURL: null },
  { id: 'u5', name: 'Pedro Lima', photoURL: null },
];

// ─── Mock Data ────────────────────────────────────────────
const MOCK_BOARDS: KanbanBoard[] = [
  {
    id: 'b1',
    businessId: 'biz1',
    name: 'Projeto Principal',
    description: 'Board principal do time de desenvolvimento',
    color: '#DC2626',
    columns: [
      { id: 'col1', title: 'Backlog',       color: '#6B7280', order: 0 },
      { id: 'col2', title: 'A Fazer',       color: '#3B82F6', order: 1 },
      { id: 'col3', title: 'Em Progresso',  color: '#F59E0B', order: 2, cardLimit: 5 },
      { id: 'col4', title: 'Revisão',       color: '#8B5CF6', order: 3, cardLimit: 3 },
      { id: 'col5', title: 'Concluído',     color: '#10B981', order: 4 },
    ],
    memberIds: ['u1', 'u2', 'u3', 'u4', 'u5'],
    createdBy: 'u1',
    isArchived: false,
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-14T10:00:00Z',
  },
  {
    id: 'b2',
    businessId: 'biz1',
    name: 'Marketing Q1',
    description: 'Campanhas do primeiro trimestre',
    color: '#8B5CF6',
    columns: [
      { id: 'col6', title: 'Ideias',      color: '#6B7280', order: 0 },
      { id: 'col7', title: 'Planejado',   color: '#3B82F6', order: 1 },
      { id: 'col8', title: 'Executando',  color: '#F59E0B', order: 2 },
      { id: 'col9', title: 'Finalizado',  color: '#10B981', order: 3 },
    ],
    memberIds: ['u1', 'u4', 'u5'],
    createdBy: 'u1',
    isArchived: false,
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-03-14T10:00:00Z',
  },
];

const MOCK_CARDS: KanbanCard[] = [
  // Board 1 - Backlog
  {
    id: 'c1', boardId: 'b1', columnId: 'col1', title: 'Redesign da página de login',
    description: 'Atualizar a página de login com o novo design system', priority: 'medium',
    labels: [DEFAULT_LABELS[3], DEFAULT_LABELS[5]], assigneeIds: ['u2'], assigneeNames: ['Ana Silva'],
    dueDate: '2026-03-25', checklist: [
      { id: 'ck1', text: 'Wireframe', completed: true },
      { id: 'ck2', text: 'UI Design', completed: true },
      { id: 'ck3', text: 'Implementação', completed: false },
      { id: 'ck4', text: 'Testes', completed: false },
    ], commentsCount: 3, attachmentsCount: 2, order: 0, createdBy: 'u1',
    createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-10T10:00:00Z',
  },
  {
    id: 'c2', boardId: 'b1', columnId: 'col1', title: 'Integração com gateway de pagamento',
    description: 'Integrar API do Stripe para processar pagamentos online', priority: 'high',
    labels: [DEFAULT_LABELS[4]], assigneeIds: ['u1', 'u3'], assigneeNames: ['Igor Garcia', 'Carlos Santos'],
    dueDate: '2026-03-20', commentsCount: 7, attachmentsCount: 1, order: 1, createdBy: 'u1',
    createdAt: '2026-03-02T10:00:00Z', updatedAt: '2026-03-12T10:00:00Z',
  },
  {
    id: 'c3', boardId: 'b1', columnId: 'col1', title: 'Otimizar queries do dashboard',
    priority: 'low', labels: [DEFAULT_LABELS[4]], assigneeIds: ['u3'], assigneeNames: ['Carlos Santos'],
    commentsCount: 1, attachmentsCount: 0, order: 2, createdBy: 'u3',
    createdAt: '2026-03-05T10:00:00Z', updatedAt: '2026-03-05T10:00:00Z',
  },
  // Board 1 - A Fazer
  {
    id: 'c4', boardId: 'b1', columnId: 'col2', title: 'Sistema de notificações push',
    description: 'Implementar notificações push para lembretes de agendamento', priority: 'high',
    labels: [DEFAULT_LABELS[1], DEFAULT_LABELS[4]], assigneeIds: ['u1'], assigneeNames: ['Igor Garcia'],
    dueDate: '2026-03-18', checklist: [
      { id: 'ck5', text: 'Configurar Firebase Cloud Messaging', completed: true },
      { id: 'ck6', text: 'Service Worker', completed: false },
      { id: 'ck7', text: 'UI de permissão', completed: false },
    ], commentsCount: 5, attachmentsCount: 0, order: 0, createdBy: 'u1',
    createdAt: '2026-03-03T10:00:00Z', updatedAt: '2026-03-13T10:00:00Z',
  },
  {
    id: 'c5', boardId: 'b1', columnId: 'col2', title: 'Relatório mensal de vendas em PDF',
    priority: 'medium', labels: [DEFAULT_LABELS[1]], assigneeIds: ['u2', 'u4'],
    assigneeNames: ['Ana Silva', 'Maria Oliveira'], dueDate: '2026-03-22',
    commentsCount: 2, attachmentsCount: 0, order: 1, createdBy: 'u2',
    createdAt: '2026-03-04T10:00:00Z', updatedAt: '2026-03-11T10:00:00Z',
  },
  {
    id: 'c13', boardId: 'b1', columnId: 'col2', title: 'Migrar banco para PostgreSQL',
    description: 'Migração gradual do Firestore para PostgreSQL com Supabase', priority: 'urgent',
    labels: [DEFAULT_LABELS[4]], assigneeIds: ['u1', 'u3'], assigneeNames: ['Igor Garcia', 'Carlos Santos'],
    dueDate: '2026-03-16', commentsCount: 12, attachmentsCount: 3, order: 2, createdBy: 'u1',
    createdAt: '2026-03-06T10:00:00Z', updatedAt: '2026-03-14T10:00:00Z',
  },
  // Board 1 - Em Progresso
  {
    id: 'c6', boardId: 'b1', columnId: 'col3', title: 'Módulo Kanban',
    description: 'Criar board Kanban para gestão de tarefas da equipe', priority: 'urgent',
    labels: [DEFAULT_LABELS[1], DEFAULT_LABELS[5]], assigneeIds: ['u1'], assigneeNames: ['Igor Garcia'],
    dueDate: '2026-03-14', checklist: [
      { id: 'ck8', text: 'Layout do board', completed: true },
      { id: 'ck9', text: 'Drag and drop', completed: true },
      { id: 'ck10', text: 'CRUD de cards', completed: true },
      { id: 'ck11', text: 'Filtros', completed: false },
    ], commentsCount: 8, attachmentsCount: 1, coverColor: '#FEE2E2',
    order: 0, createdBy: 'u1',
    createdAt: '2026-03-08T10:00:00Z', updatedAt: '2026-03-14T10:00:00Z',
  },
  {
    id: 'c7', boardId: 'b1', columnId: 'col3', title: 'API de relatórios fiscais',
    priority: 'high', labels: [DEFAULT_LABELS[4], DEFAULT_LABELS[7]],
    assigneeIds: ['u3'], assigneeNames: ['Carlos Santos'],
    dueDate: '2026-03-19', commentsCount: 4, attachmentsCount: 2, order: 1, createdBy: 'u3',
    createdAt: '2026-03-07T10:00:00Z', updatedAt: '2026-03-13T10:00:00Z',
  },
  // Board 1 - Revisão
  {
    id: 'c8', boardId: 'b1', columnId: 'col4', title: 'Tela de configurações do usuário',
    description: 'Permitir que o usuário altere foto, nome e preferências', priority: 'medium',
    labels: [DEFAULT_LABELS[3], DEFAULT_LABELS[5]], assigneeIds: ['u2'], assigneeNames: ['Ana Silva'],
    checklist: [
      { id: 'ck12', text: 'Upload de foto', completed: true },
      { id: 'ck13', text: 'Edição de dados', completed: true },
      { id: 'ck14', text: 'Testes E2E', completed: false },
    ], commentsCount: 6, attachmentsCount: 0, order: 0, createdBy: 'u2',
    createdAt: '2026-03-06T10:00:00Z', updatedAt: '2026-03-14T10:00:00Z',
  },
  // Board 1 - Concluído
  {
    id: 'c9', boardId: 'b1', columnId: 'col5', title: 'Setup do CI/CD',
    priority: 'high', labels: [DEFAULT_LABELS[4]], assigneeIds: ['u1'], assigneeNames: ['Igor Garcia'],
    commentsCount: 3, attachmentsCount: 1, order: 0, createdBy: 'u1',
    createdAt: '2026-02-20T10:00:00Z', updatedAt: '2026-03-05T10:00:00Z',
  },
  {
    id: 'c10', boardId: 'b1', columnId: 'col5', title: 'Autenticação com Google OAuth',
    priority: 'high', labels: [DEFAULT_LABELS[1], DEFAULT_LABELS[4]], assigneeIds: ['u1', 'u3'],
    assigneeNames: ['Igor Garcia', 'Carlos Santos'],
    commentsCount: 9, attachmentsCount: 0, order: 1, createdBy: 'u1',
    createdAt: '2026-02-15T10:00:00Z', updatedAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'c11', boardId: 'b1', columnId: 'col5', title: 'Design system e tokens',
    priority: 'medium', labels: [DEFAULT_LABELS[3]], assigneeIds: ['u2', 'u4'],
    assigneeNames: ['Ana Silva', 'Maria Oliveira'],
    commentsCount: 5, attachmentsCount: 4, order: 2, createdBy: 'u2',
    createdAt: '2026-02-10T10:00:00Z', updatedAt: '2026-02-28T10:00:00Z',
  },
  // Board 2 cards
  {
    id: 'c20', boardId: 'b2', columnId: 'col6', title: 'Campanha de lançamento no Instagram',
    priority: 'high', labels: [DEFAULT_LABELS[6]], assigneeIds: ['u4'], assigneeNames: ['Maria Oliveira'],
    dueDate: '2026-03-30', commentsCount: 2, attachmentsCount: 3, order: 0, createdBy: 'u4',
    createdAt: '2026-03-10T10:00:00Z', updatedAt: '2026-03-14T10:00:00Z',
  },
  {
    id: 'c21', boardId: 'b2', columnId: 'col7', title: 'Landing page para promoção de março',
    priority: 'medium', labels: [DEFAULT_LABELS[3], DEFAULT_LABELS[6]], assigneeIds: ['u2', 'u5'],
    assigneeNames: ['Ana Silva', 'Pedro Lima'], dueDate: '2026-03-20',
    commentsCount: 4, attachmentsCount: 1, order: 0, createdBy: 'u5',
    createdAt: '2026-03-08T10:00:00Z', updatedAt: '2026-03-13T10:00:00Z',
  },
  {
    id: 'c22', boardId: 'b2', columnId: 'col8', title: 'E-mail marketing - base de clientes',
    priority: 'high', labels: [DEFAULT_LABELS[6]], assigneeIds: ['u5'], assigneeNames: ['Pedro Lima'],
    checklist: [
      { id: 'ck20', text: 'Segmentar base', completed: true },
      { id: 'ck21', text: 'Criar template', completed: true },
      { id: 'ck22', text: 'Testar envio', completed: false },
      { id: 'ck23', text: 'Disparar campanha', completed: false },
    ],
    commentsCount: 6, attachmentsCount: 2, order: 0, createdBy: 'u5',
    createdAt: '2026-03-05T10:00:00Z', updatedAt: '2026-03-14T10:00:00Z',
  },
];

// ─── Helper: generate ID ──────────────────────────────────
let idCounter = 100;
const genId = () => `gen_${Date.now()}_${idCounter++}`;

// ─── Animations ───────────────────────────────────────────
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
function AvatarStack({ userIds, size = 'sm', max = 3 }: { userIds: string[]; size?: 'sm' | 'md'; max?: number }) {
  const members = userIds.map(id => MOCK_MEMBERS.find(m => m.id === id)).filter(Boolean);
  const shown = members.slice(0, max);
  const remaining = members.length - max;
  const px = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-7 h-7 text-xs';
  const overlap = size === 'sm' ? '-ml-1.5' : '-ml-2';

  return (
    <div className="flex items-center">
      {shown.map((member, i) => (
        <div
          key={member!.id}
          className={cn(
            px,
            'rounded-full flex items-center justify-center font-bold',
            'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 text-gray-600 dark:text-gray-300',
            'border-2 border-white dark:border-gray-900 shadow-sm ring-1 ring-black/5 dark:ring-white/5',
            i > 0 && overlap
          )}
          title={member!.name}
        >
          {getInitials(member!.name)}
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
  const config = PRIORITY_CONFIG[priority];
  const Icon = config.icon;

  if (compact) {
    return (
      <div className={cn('flex items-center justify-center w-5 h-5 rounded', config.bgColor, 'border')} title={config.label}>
        <Icon className={cn('w-3 h-3', config.color)} />
      </div>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border', config.bgColor, config.color)}>
      <Icon className="w-3 h-3" />
      {config.label}
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
  onOpen,
  onDragStart,
  isDragging,
}: {
  card: KanbanCard;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent, card: KanbanCard) => void;
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
            <AvatarStack userIds={card.assigneeIds} size="sm" max={2} />
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
  onCardOpen,
  onAddCard,
  onDragStart,
  onDragOver,
  onDrop,
  dragOverColumnId,
  draggingCardId,
}: {
  column: KanbanColumn;
  cards: KanbanCard[];
  onCardOpen: (card: KanbanCard) => void;
  onAddCard: (columnId: string) => void;
  onDragStart: (e: React.DragEvent, card: KanbanCard) => void;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  dragOverColumnId: string | null;
  draggingCardId: string | null;
}) {
  const isOverLimit = column.cardLimit ? cards.length >= column.cardLimit : false;
  const isDragTarget = dragOverColumnId === column.id;

  return (
    <motion.div
      variants={itemVariants}
      className="flex flex-col w-[300px] min-w-[300px] flex-shrink-0"
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
      </div>

      {/* Cards area */}
      <div
        onDragOver={(e) => onDragOver(e, column.id)}
        onDrop={(e) => onDrop(e, column.id)}
        className={cn(
          'flex-1 space-y-2.5 p-1.5 rounded-xl min-h-[120px]',
          'transition-all duration-200',
          isDragTarget
            ? 'bg-blue-50/60 dark:bg-blue-500/10 ring-2 ring-blue-200/60 dark:ring-blue-500/30 ring-inset'
            : 'bg-gray-50/50 dark:bg-white/[0.02]'
        )}
      >
        <AnimatePresence mode="popLayout">
          {cards.map(card => (
            <KanbanCardItem
              key={card.id}
              card={card}
              onOpen={() => onCardOpen(card)}
              onDragStart={onDragStart}
              isDragging={draggingCardId === card.id}
            />
          ))}
        </AnimatePresence>

        {/* Empty state */}
        {cards.length === 0 && !isDragTarget && (
          <div className="flex flex-col items-center justify-center py-8 text-gray-300 dark:text-gray-600">
            <LayoutGrid className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-xs font-medium">Nenhum card</p>
          </div>
        )}

        {/* Drop indicator */}
        {isDragTarget && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 48 }}
            className="border-2 border-dashed border-blue-300 dark:border-blue-500/40 rounded-xl bg-blue-50/50 dark:bg-blue-500/10 flex items-center justify-center"
          >
            <p className="text-xs text-blue-400 font-medium">Soltar aqui</p>
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
  onClose,
  onUpdate,
  onDelete,
}: {
  card: KanbanCard;
  columns: KanbanColumn[];
  onClose: () => void;
  onUpdate: (updated: KanbanCard) => void;
  onDelete: (id: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description || '');
  const [editingDescription, setEditingDescription] = useState(false);
  const [checklist, setChecklist] = useState<KanbanChecklistItem[]>(card.checklist || []);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const column = columns.find(c => c.id === card.columnId);
  const checkDone = checklist.filter(c => c.completed).length;
  const checkTotal = checklist.length;
  const checkPercent = checkTotal > 0 ? Math.round((checkDone / checkTotal) * 100) : 0;

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
    const item: KanbanChecklistItem = { id: genId(), text: newCheckItem.trim(), completed: false };
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
                  <span className="text-xs text-gray-400 dark:text-gray-500">em</span>
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
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Descrição</h4>
                  </div>
                  {editingDescription ? (
                    <div className="space-y-2">
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Adicione uma descrição..."
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20 min-h-[100px] resize-y"
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSaveDescription}
                          className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
                        >
                          Salvar
                        </button>
                        <button
                          onClick={() => { setDescription(card.description || ''); setEditingDescription(false); }}
                          className="px-3 py-1.5 rounded-lg text-gray-500 dark:text-gray-400 text-xs font-medium hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
                        >
                          Cancelar
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
                      {description || 'Clique para adicionar uma descrição...'}
                    </div>
                  )}
                </div>

                {/* Checklist */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Checklist</h4>
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
                      placeholder="Adicionar item..."
                      className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20"
                    />
                    <button
                      onClick={handleAddCheckItem}
                      disabled={!newCheckItem.trim()}
                      className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
                    >
                      Adicionar
                    </button>
                  </div>
                </div>
              </div>

              {/* Right: sidebar */}
              <div className="space-y-3">
                {/* Priority */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Prioridade</p>
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
                          {config.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Assignees */}
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Responsáveis</p>
                  <div className="space-y-1">
                    {card.assigneeNames.map((name, i) => (
                      <div key={i} className="flex items-center gap-2 px-2 py-1">
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[9px] font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                          {getInitials(name)}
                        </div>
                        <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Due date */}
                {card.dueDate && (
                  <div>
                    <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">Prazo</p>
                    <DueDateBadge date={card.dueDate} />
                  </div>
                )}

                {/* Actions */}
                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                  {showDeleteConfirm ? (
                    <div className="space-y-2">
                      <p className="text-xs text-red-600 dark:text-red-400 font-medium">Excluir este card?</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => { onDelete(card.id); onClose(); }}
                          className="flex-1 px-2 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
                        >
                          Excluir
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="flex-1 px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Excluir card
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
  onClose,
  onCreate,
}: {
  columnId: string;
  columns: KanbanColumn[];
  onClose: () => void;
  onCreate: (card: Partial<KanbanCard>) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<KanbanPriority>('medium');
  const [selectedColumn, setSelectedColumn] = useState(columnId);
  const [selectedLabels, setSelectedLabels] = useState<KanbanLabel[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

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
      assigneeNames: selectedAssignees.map(id => MOCK_MEMBERS.find(m => m.id === id)?.name || ''),
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
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">Novo Card</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Título *</label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) handleCreate(); }}
              placeholder="O que precisa ser feito?"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes opcionais..."
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20 resize-none"
            />
          </div>

          {/* Row: Column + Priority + Due Date */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Coluna</label>
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
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Prioridade</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as KanbanPriority)}
                className="w-full px-2.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30 focus:ring-2 focus:ring-red-100 dark:focus:ring-red-500/20 bg-white dark:bg-gray-800"
              >
                {(Object.keys(PRIORITY_CONFIG) as KanbanPriority[]).map(p => (
                  <option key={p} value={p}>{PRIORITY_CONFIG[p].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Prazo</label>
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
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Etiquetas</label>
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
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Responsáveis</label>
            <div className="flex flex-wrap gap-1.5">
              {MOCK_MEMBERS.map(member => (
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
                  {member.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              Cancelar
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
              Criar Card
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// NEW COLUMN DIALOG
// ═══════════════════════════════════════════════════════════
function NewColumnInline({
  onAdd,
  onCancel,
}: {
  onAdd: (title: string, color: string) => void;
  onCancel: () => void;
}) {
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
      className="w-[300px] min-w-[300px] flex-shrink-0 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg p-4 space-y-3"
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) { onAdd(title.trim(), color); } if (e.key === 'Escape') onCancel(); }}
        placeholder="Nome da coluna..."
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
          Adicionar
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-gray-500 dark:text-gray-400 text-sm font-medium hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          Cancelar
        </button>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════
// BOARD HEADER
// ═══════════════════════════════════════════════════════════
function BoardHeader({
  boards,
  activeBoard,
  onSelectBoard,
  searchQuery,
  onSearchChange,
  filterPriority,
  onFilterPriorityChange,
  filterAssignee,
  onFilterAssigneeChange,
  totalCards,
  filteredCards,
}: {
  boards: KanbanBoard[];
  activeBoard: KanbanBoard;
  onSelectBoard: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterPriority: KanbanPriority | 'all';
  onFilterPriorityChange: (p: KanbanPriority | 'all') => void;
  filterAssignee: string | 'all';
  onFilterAssigneeChange: (a: string | 'all') => void;
  totalCards: number;
  filteredCards: number;
}) {
  const [showFilters, setShowFilters] = useState(false);
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
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* Members */}
          <AvatarStack userIds={activeBoard.memberIds} size="md" max={4} />

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500 pointer-events-none" />
            <input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar cards..."
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
            Filtros
            {hasFilters && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            )}
          </button>
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
                <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Prioridade:</span>
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
                      {p === 'all' ? 'Todas' : PRIORITY_CONFIG[p].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assignee filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Responsável:</span>
                <select
                  value={filterAssignee}
                  onChange={(e) => onFilterAssigneeChange(e.target.value)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 focus:outline-none focus:border-red-200 dark:focus:border-red-500/30"
                >
                  <option value="all">Todos</option>
                  {MOCK_MEMBERS.map(m => (
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
                  Limpar filtros
                </button>
              )}

              {/* Count */}
              {hasFilters && (
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
                  {filteredCards} de {totalCards} cards
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN MODULE
// ═══════════════════════════════════════════════════════════
export default function KanbanModule() {
  const { user } = useAuth();

  // State
  const [boards, setBoards] = useState<KanbanBoard[]>(MOCK_BOARDS);
  const [cards, setCards] = useState<KanbanCard[]>(MOCK_CARDS);
  const [activeBoardId, setActiveBoardId] = useState(MOCK_BOARDS[0].id);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<KanbanPriority | 'all'>('all');
  const [filterAssignee, setFilterAssignee] = useState<string | 'all'>('all');

  // Dialogs
  const [selectedCard, setSelectedCard] = useState<KanbanCard | null>(null);
  const [newCardColumnId, setNewCardColumnId] = useState<string | null>(null);
  const [showNewColumn, setShowNewColumn] = useState(false);

  // Drag state
  const [draggingCard, setDraggingCard] = useState<KanbanCard | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Derived
  const activeBoard = boards.find(b => b.id === activeBoardId)!;
  const boardCards = cards.filter(c => c.boardId === activeBoardId);

  // Filter cards
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

  const sortedColumns = [...activeBoard.columns].sort((a, b) => a.order - b.order);

  // ─── Drag handlers ──────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, card: KanbanCard) => {
    setDraggingCard(card);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggingCard) return;
    if (draggingCard.columnId === targetColumnId) {
      setDraggingCard(null);
      return;
    }

    setCards(prev =>
      prev.map(c =>
        c.id === draggingCard.id
          ? { ...c, columnId: targetColumnId, updatedAt: new Date().toISOString() }
          : c
      )
    );
    setDraggingCard(null);
  }, [draggingCard]);

  const handleDragEnd = useCallback(() => {
    setDraggingCard(null);
    setDragOverColumn(null);
  }, []);

  // ─── Card CRUD ──────────────────────────────────────────
  const handleCreateCard = useCallback((partial: Partial<KanbanCard>) => {
    const columnCards = cards.filter(c => c.columnId === partial.columnId && c.boardId === activeBoardId);
    const newCard: KanbanCard = {
      id: genId(),
      boardId: activeBoardId,
      columnId: partial.columnId!,
      title: partial.title!,
      description: partial.description,
      priority: partial.priority || 'medium',
      labels: partial.labels || [],
      assigneeIds: partial.assigneeIds || [],
      assigneeNames: partial.assigneeNames || [],
      dueDate: partial.dueDate,
      checklist: [],
      commentsCount: 0,
      attachmentsCount: 0,
      order: columnCards.length,
      createdBy: user?.id || 'u1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setCards(prev => [...prev, newCard]);
  }, [activeBoardId, cards, user]);

  const handleUpdateCard = useCallback((updated: KanbanCard) => {
    setCards(prev =>
      prev.map(c => c.id === updated.id ? { ...updated, updatedAt: new Date().toISOString() } : c)
    );
    setSelectedCard(updated);
  }, []);

  const handleDeleteCard = useCallback((cardId: string) => {
    setCards(prev => prev.filter(c => c.id !== cardId));
  }, []);

  // ─── Column CRUD ────────────────────────────────────────
  const handleAddColumn = useCallback((title: string, color: string) => {
    const newCol: KanbanColumn = {
      id: genId(),
      title,
      color,
      order: activeBoard.columns.length,
    };
    setBoards(prev =>
      prev.map(b =>
        b.id === activeBoardId
          ? { ...b, columns: [...b.columns, newCol] }
          : b
      )
    );
    setShowNewColumn(false);
  }, [activeBoardId, activeBoard]);

  // ─── Keyboard: close dialogs on Escape ──────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedCard) setSelectedCard(null);
        else if (newCardColumnId) setNewCardColumnId(null);
        else if (showNewColumn) setShowNewColumn(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedCard, newCardColumnId, showNewColumn]);

  // Body overflow lock
  useEffect(() => {
    document.body.style.overflow = (selectedCard || newCardColumnId) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [selectedCard, newCardColumnId]);

  // ─── Stats for header ───────────────────────────────────
  const urgentCount = boardCards.filter(c => c.priority === 'urgent').length;
  const overdueCount = boardCards.filter(c => {
    if (!c.dueDate) return false;
    const d = new Date(c.dueDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d < today;
  }).length;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-4"
      onDragEnd={handleDragEnd}
    >
      {/* Stats bar */}
      <motion.div variants={itemVariants} className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-sm">
            <LayoutGrid className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-bold text-gray-900 dark:text-gray-100">{boardCards.length}</span> cards
            </span>
          </div>
          {urgentCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
              <Flame className="w-4 h-4 text-red-500 dark:text-red-400" />
              <span className="text-sm text-red-600 dark:text-red-400 font-medium">{urgentCount} urgente{urgentCount > 1 ? 's' : ''}</span>
            </div>
          )}
          {overdueCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
              <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">{overdueCount} atrasado{overdueCount > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      </motion.div>

      {/* Board header: tabs, search, filters */}
      <motion.div variants={itemVariants}>
        <BoardHeader
          boards={boards}
          activeBoard={activeBoard}
          onSelectBoard={setActiveBoardId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filterPriority={filterPriority}
          onFilterPriorityChange={setFilterPriority}
          filterAssignee={filterAssignee}
          onFilterAssigneeChange={setFilterAssignee}
          totalCards={boardCards.length}
          filteredCards={filteredCards.length}
        />
      </motion.div>

      {/* Columns container — horizontal scroll */}
      <motion.div
        variants={itemVariants}
        className="flex gap-4 overflow-x-auto pb-4 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8"
        style={{ scrollbarWidth: 'thin' }}
      >
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex gap-4"
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
                onCardOpen={setSelectedCard}
                onAddCard={(colId) => setNewCardColumnId(colId)}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                dragOverColumnId={dragOverColumn}
                draggingCardId={draggingCard?.id || null}
              />
            );
          })}

          {/* Add column button */}
          <AnimatePresence mode="wait">
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
                  'w-[300px] min-w-[300px] flex-shrink-0',
                  'flex items-center justify-center gap-2 py-4',
                  'rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700',
                  'text-sm font-medium text-gray-400 dark:text-gray-500',
                  'hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-50/50 dark:hover:bg-white/[0.02]',
                  'transition-all duration-200'
                )}
              >
                <Plus className="w-4 h-4" />
                Adicionar coluna
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      {/* Card detail dialog */}
      <AnimatePresence>
        {selectedCard && (
          <CardDetailDialog
            key="card-detail"
            card={selectedCard}
            columns={sortedColumns}
            onClose={() => setSelectedCard(null)}
            onUpdate={handleUpdateCard}
            onDelete={handleDeleteCard}
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
            onClose={() => setNewCardColumnId(null)}
            onCreate={handleCreateCard}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
