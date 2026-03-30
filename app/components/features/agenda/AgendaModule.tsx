'use client';

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import {
  format,
  addDays,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  isBefore,
  isAfter,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Clock,
  User as UserIcon,
  Users as UsersIcon,
  Phone,
  Mail,
  X,
  Check,
  Edit3,
  Trash2,
  DollarSign,
  FileText,
  LayoutGrid,
  Columns3,
  CalendarDays,
  Search,
  ChevronDown,
  Settings2,
  Palette,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
} from 'lucide-react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Popover from '@mui/material/Popover';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { cn } from '@/lib/utils';
import { formatCurrency, getStatusColor, getStatusLabel } from '@/lib/utils/format';
import type { Appointment, AppointmentStatus, Service, Client, User } from '@/lib/types';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// ==========================================
// CONSTANTS
// ==========================================

const HOUR_HEIGHT = 64;
const HALF_HOUR_HEIGHT = HOUR_HEIGHT / 2;
const START_HOUR = 6;
const END_HOUR = 22;
const TOTAL_HOURS = END_HOUR - START_HOUR;

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  agendado: '#3B82F6',
  confirmado: '#10B981',
  em_andamento: '#F59E0B',
  concluido: '#6366F1',
  cancelado: '#EF4444',
  nao_compareceu: '#6B7280',
};

const STATUS_BG_COLORS: Record<AppointmentStatus, string> = {
  agendado: 'rgba(59,130,246,0.12)',
  confirmado: 'rgba(16,185,129,0.12)',
  em_andamento: 'rgba(245,158,11,0.12)',
  concluido: 'rgba(99,102,241,0.12)',
  cancelado: 'rgba(239,68,68,0.12)',
  nao_compareceu: 'rgba(107,114,128,0.12)',
};

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: 'agendado', label: 'Agendado' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'em_andamento', label: 'Em Andamento' },
  { value: 'concluido', label: 'Concluido' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'nao_compareceu', label: 'Nao Compareceu' },
];

const DURATION_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hora' },
  { value: 90, label: '1h 30min' },
  { value: 120, label: '2 horas' },
];

const SERVICE_COLOR_PALETTE = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F97316',
  '#06B6D4', '#84CC16', '#F59E0B', '#10B981',
  '#EF4444', '#6366F1', '#14B8A6', '#A855F7',
  '#E11D48', '#0EA5E9', '#D97706', '#059669',
];

type ViewMode = 'day' | 'week' | 'month';

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getAppointmentTop(startTime: string): number {
  const minutes = timeToMinutes(startTime);
  const offsetMinutes = minutes - START_HOUR * 60;
  return (offsetMinutes / 60) * HOUR_HEIGHT;
}

function getAppointmentHeight(duration: number): number {
  return Math.max((duration / 60) * HOUR_HEIGHT, 24);
}

function getCurrentTimeOffset(): number {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const offsetMinutes = minutes - START_HOUR * 60;
  return (offsetMinutes / 60) * HOUR_HEIGHT;
}

function generateTimeOptions(): string[] {
  const options: string[] = [];
  for (let h = 6; h <= 21; h++) {
    options.push(`${String(h).padStart(2, '0')}:00`);
    options.push(`${String(h).padStart(2, '0')}:30`);
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

function addDurationToTime(startTime: string, duration: number): string {
  const totalMinutes = timeToMinutes(startTime) + duration;
  return minutesToTime(totalMinutes);
}

// ==========================================
// SUB-COMPONENTS
// ==========================================

// ---- Current Time Line ----
function CurrentTimeLine() {
  const [offset, setOffset] = useState(getCurrentTimeOffset());

  useEffect(() => {
    const interval = setInterval(() => {
      setOffset(getCurrentTimeOffset());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  const currentHour = now.getHours();
  if (currentHour < START_HOUR || currentHour >= END_HOUR) return null;

  return (
    <div
      className="absolute left-0 right-0 z-30 pointer-events-none flex items-center"
      style={{ top: `${offset}px` }}
    >
      <div className="w-2.5 h-2.5 rounded-full bg-red-600 -ml-1 shadow-sm shadow-red-600/40" />
      <div className="flex-1 h-[2px] bg-red-600 shadow-sm shadow-red-600/30" />
    </div>
  );
}

// ---- Mini Calendar ----
interface MiniCalendarProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  appointments: Appointment[];
}

function MiniCalendar({ selectedDate, onSelect, appointments }: MiniCalendarProps) {
  const [viewMonth, setViewMonth] = useState(startOfMonth(selectedDate));

  const monthStart2 = startOfMonth(viewMonth);
  const monthEnd2 = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart2, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd2, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const datesWithAppointments = useMemo(() => {
    const set = new Set<string>();
    appointments.forEach((a) => set.add(a.date));
    return set;
  }, [appointments]);

  return (
    <div className="p-3 w-[280px]">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setViewMonth(subMonths(viewMonth, 1))}
          className="p-1 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-md transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 capitalize">
          {format(viewMonth, 'MMMM yyyy', { locale: ptBR })}
        </span>
        <button
          onClick={() => setViewMonth(addMonths(viewMonth, 1))}
          className="p-1 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-md transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[11px] font-medium text-gray-400 dark:text-gray-500 py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const isCurrentMonth = isSameMonth(day, viewMonth);
          const isSelected = isSameDay(day, selectedDate);
          const isTodayDate = isToday(day);
          const hasAppt = datesWithAppointments.has(format(day, 'yyyy-MM-dd'));

          return (
            <button
              key={i}
              onClick={() => onSelect(day)}
              className={cn(
                'relative w-9 h-9 flex items-center justify-center text-[13px] rounded-lg transition-all duration-150',
                !isCurrentMonth && 'text-gray-300 dark:text-gray-600',
                isCurrentMonth && !isSelected && !isTodayDate && 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04]',
                isTodayDate && !isSelected && 'text-red-600 font-bold',
                isSelected && 'bg-red-600 text-white font-semibold shadow-sm',
              )}
            >
              {format(day, 'd')}
              {hasAppt && !isSelected && (
                <span
                  className={cn(
                    'absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full',
                    isTodayDate ? 'bg-red-600' : 'bg-gray-400 dark:bg-gray-500',
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Appointment Block (for Day/Week views) ----
interface AppointmentBlockProps {
  appointment: Appointment;
  onClick: (appt: Appointment) => void;
  compact?: boolean;
}

function AppointmentBlock({ appointment, onClick, compact = false }: AppointmentBlockProps) {
  const color = STATUS_COLORS[appointment.status];
  const bgColor = STATUS_BG_COLORS[appointment.status];
  const height = getAppointmentHeight(appointment.duration);
  const isShort = compact || height < 48;

  return (
    <Tooltip
      title={
        <div className="text-xs space-y-1 p-1">
          <div className="font-semibold">{appointment.clientName}</div>
          <div>{appointment.serviceName}</div>
          <div>{appointment.startTime} - {appointment.endTime}</div>
          <div>{getStatusLabel(appointment.status)}</div>
          <div>{formatCurrency(appointment.price)}</div>
        </div>
      }
      arrow
      placement="right"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        whileHover={{ scale: 1.02, zIndex: 50 }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(appointment);
        }}
        className={cn(
          'absolute left-1 right-1 z-10 rounded-lg cursor-pointer overflow-hidden',
          'border-l-[3px] transition-shadow duration-200',
          'hover:shadow-lg hover:shadow-black/10',
          appointment.status === 'cancelado' && 'opacity-50',
        )}
        style={{
          top: `${getAppointmentTop(appointment.startTime)}px`,
          height: `${height}px`,
          backgroundColor: bgColor,
          borderLeftColor: color,
        }}
      >
        <div className={cn('px-2 h-full flex flex-col justify-center', isShort ? 'py-0.5' : 'py-1.5')}>
          <div
            className={cn(
              'font-semibold truncate leading-tight',
              compact ? 'text-[10px]' : 'text-[11px]',
            )}
            style={{ color }}
          >
            {compact ? appointment.clientName.split(' ')[0] : appointment.clientName}
          </div>
          {!isShort && (
            <>
              <div className="text-[10px] text-gray-600 dark:text-gray-400 truncate leading-tight mt-0.5">
                {appointment.serviceName}
              </div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight mt-0.5">
                {appointment.startTime} - {appointment.endTime}
              </div>
            </>
          )}
          {isShort && (
            <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate leading-tight">
              {compact
                ? `${appointment.startTime}${appointment.serviceName ? ` ${appointment.serviceName.split(' ')[0]}` : ''}`
                : appointment.startTime}
            </div>
          )}
        </div>
      </motion.div>
    </Tooltip>
  );
}

// ---- Service Management Dialog ----
interface ServiceFormData {
  name: string;
  description: string;
  duration: number;
  price: number;
  category: string;
  color: string;
  isActive: boolean;
}

interface ServiceManagementDialogProps {
  open: boolean;
  onClose: () => void;
  services: Service[];
  onCreateService: (data: ServiceFormData) => Promise<void>;
  onUpdateService: (id: string, data: ServiceFormData) => Promise<void>;
  onDeleteService: (id: string) => Promise<void>;
}

function ServiceManagementDialog({
  open,
  onClose,
  services,
  onCreateService,
  onUpdateService,
  onDeleteService,
}: ServiceManagementDialogProps) {
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ServiceFormData>({
    name: '',
    description: '',
    duration: 60,
    price: 0,
    category: '',
    color: '#3B82F6',
    isActive: true,
  });

  const resetForm = useCallback(() => {
    setFormData({
      name: '',
      description: '',
      duration: 60,
      price: 0,
      category: '',
      color: '#3B82F6',
      isActive: true,
    });
    setEditingService(null);
  }, []);

  const handleEdit = useCallback((service: Service) => {
    setEditingService(service);
    setFormData({
      name: service.name,
      description: service.description || '',
      duration: service.duration,
      price: service.price,
      category: service.category || '',
      color: service.color,
      isActive: service.isActive,
    });
    setView('form');
  }, []);

  const handleNew = useCallback(() => {
    resetForm();
    setView('form');
  }, [resetForm]);

  const handleSave = useCallback(async () => {
    if (!formData.name || !formData.duration) return;
    setSaving(true);
    try {
      if (editingService) {
        await onUpdateService(editingService.id, formData);
      } else {
        await onCreateService(formData);
      }
      resetForm();
      setView('list');
    } finally {
      setSaving(false);
    }
  }, [formData, editingService, onCreateService, onUpdateService, resetForm]);

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      await onDeleteService(id);
      setConfirmDeleteId(null);
    } finally {
      setDeleting(null);
    }
  }, [onDeleteService]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: '16px' } }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          pt: 2.5,
          pb: 1,
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {view === 'list' ? 'Gerenciar Servicos' : editingService ? 'Editar Servico' : 'Novo Servico'}
        </span>
        <button
          onClick={view === 'form' ? () => { resetForm(); setView('list'); } : onClose}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </button>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 1, pb: 0 }}>
        <AnimatePresence mode="wait">
          {view === 'list' ? (
            <motion.div
              key="list"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="py-2"
            >
              {services.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <Settings2 className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum servico cadastrado</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Crie seu primeiro servico para comecar a agendar</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {services.map((service) => (
                    <motion.div
                      key={service.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl border transition-colors',
                        service.isActive
                          ? 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
                          : 'border-gray-100 dark:border-gray-800 opacity-50',
                      )}
                    >
                      <div
                        className="w-3 h-8 rounded-full flex-shrink-0"
                        style={{ backgroundColor: service.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {service.name}
                          </span>
                          {!service.isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                              Inativo
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-500 dark:text-gray-400">{service.duration} min</span>
                          <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{formatCurrency(service.price)}</span>
                          {service.category && (
                            <>
                              <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                              <span className="text-xs text-gray-400 dark:text-gray-500">{service.category}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleEdit(service)}
                          className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                        </button>
                        {confirmDeleteId === service.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(service.id)}
                              disabled={deleting === service.id}
                              className="p-1.5 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-lg transition-colors"
                            >
                              <Check className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors"
                            >
                              <X className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(service.id)}
                            className="p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-red-500" />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4 py-2"
            >
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  Nome do Servico *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Ex: Corte Masculino"
                  className={cn(
                    'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                    'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                    'bg-white dark:bg-gray-800',
                    'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                    'transition-all duration-200',
                  )}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  Descricao
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder="Descricao do servico..."
                  className={cn(
                    'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 resize-none',
                    'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                    'bg-white dark:bg-gray-800',
                    'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                    'transition-all duration-200',
                  )}
                />
              </div>

              {/* Duration & Price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Duracao *
                  </label>
                  <select
                    value={formData.duration}
                    onChange={(e) => setFormData((p) => ({ ...p, duration: Number(e.target.value) }))}
                    className={cn(
                      'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                      'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                      'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                      'transition-all duration-200',
                    )}
                  >
                    {DURATION_OPTIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Preco (R$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price || ''}
                    onChange={(e) => setFormData((p) => ({ ...p, price: Number(e.target.value) }))}
                    placeholder="0,00"
                    className={cn(
                      'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                      'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                      'bg-white dark:bg-gray-800',
                      'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                      'transition-all duration-200',
                    )}
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  Categoria
                </label>
                <input
                  type="text"
                  value={formData.category}
                  onChange={(e) => setFormData((p) => ({ ...p, category: e.target.value }))}
                  placeholder="Ex: Cabelo, Unhas, Barba..."
                  className={cn(
                    'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                    'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                    'bg-white dark:bg-gray-800',
                    'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                    'transition-all duration-200',
                  )}
                />
              </div>

              {/* Color */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  <Palette className="w-3.5 h-3.5 inline mr-1" />
                  Cor
                </label>
                <div className="flex flex-wrap gap-2">
                  {SERVICE_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => setFormData((p) => ({ ...p, color: c }))}
                      className={cn(
                        'w-8 h-8 rounded-lg transition-all duration-200',
                        formData.color === c
                          ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-gray-500 dark:ring-offset-gray-900 scale-110'
                          : 'hover:scale-110',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">Servico Ativo</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Servicos inativos nao aparecem na agenda</div>
                </div>
                <button
                  onClick={() => setFormData((p) => ({ ...p, isActive: !p.isActive }))}
                  className="transition-colors"
                >
                  {formData.isActive ? (
                    <ToggleRight className="w-8 h-8 text-red-600" />
                  ) : (
                    <ToggleLeft className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                  )}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          py: 2.5,
          gap: 1,
          justifyContent: view === 'list' ? 'flex-end' : 'space-between',
        }}
      >
        {view === 'list' ? (
          <button
            onClick={handleNew}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold',
              'bg-red-600 text-white hover:bg-red-700',
              'shadow-sm shadow-red-600/20',
              'transition-all duration-200',
            )}
          >
            <Plus className="w-4 h-4" />
            Novo Servico
          </button>
        ) : (
          <>
            <button
              onClick={() => { resetForm(); setView('list'); }}
              className={cn(
                'px-5 py-2.5 rounded-xl text-sm font-medium',
                'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] border border-gray-200 dark:border-gray-700',
                'transition-all duration-200',
              )}
            >
              Voltar
            </button>
            <button
              onClick={handleSave}
              disabled={!formData.name || saving}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold',
                'bg-red-600 text-white hover:bg-red-700',
                'shadow-sm shadow-red-600/20',
                'transition-all duration-200',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {saving ? 'Salvando...' : editingService ? 'Salvar Alteracoes' : 'Criar Servico'}
            </button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ---- Delete Confirmation Dialog ----
interface DeleteConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onCancel: () => void;
  onDelete: () => void;
  loading: boolean;
  appointmentName?: string;
}

function DeleteConfirmDialog({ open, onClose, onCancel, onDelete, loading, appointmentName }: DeleteConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { borderRadius: '16px' } }}
    >
      <div className="p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Excluir Agendamento
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
          {appointmentName ? `Deseja excluir o agendamento de ${appointmentName}?` : 'Deseja excluir este agendamento?'}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
          Voce pode cancelar o agendamento ou exclui-lo permanentemente.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className={cn(
              'w-full px-4 py-2.5 rounded-xl text-sm font-medium',
              'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20',
              'transition-all duration-200',
              'disabled:opacity-50',
            )}
          >
            Cancelar Agendamento (manter registro)
          </button>
          <button
            onClick={onDelete}
            disabled={loading}
            className={cn(
              'w-full px-4 py-2.5 rounded-xl text-sm font-semibold',
              'text-white bg-red-600 hover:bg-red-700',
              'shadow-sm shadow-red-600/20',
              'transition-all duration-200',
              'disabled:opacity-50',
            )}
          >
            {loading ? 'Excluindo...' : 'Excluir Permanentemente'}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className={cn(
              'w-full px-4 py-2.5 rounded-xl text-sm font-medium',
              'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
              'transition-all duration-200',
            )}
          >
            Voltar
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ---- New/Edit Appointment Dialog ----
interface AppointmentFormData {
  clientId: string;
  clientName: string;
  clientPhone: string;
  serviceId: string;
  serviceName: string;
  date: string;
  startTime: string;
  duration: number;
  professionalId: string;
  professionalName: string;
  notes: string;
  status: AppointmentStatus;
  price: number;
  color: string;
}

interface AppointmentDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: AppointmentFormData) => void;
  onDelete?: () => void;
  initialData?: Partial<AppointmentFormData>;
  isEditing?: boolean;
  services: Service[];
  clients: Client[];
  members: User[];
  saving?: boolean;
  checkConflicts?: (professionalId: string, date: string, startTime: string, endTime: string, excludeId?: string) => { hasConflict: boolean; message: string };
  editingAppointmentId?: string;
}

function AppointmentFormDialog({
  open,
  onClose,
  onSave,
  onDelete,
  initialData,
  isEditing = false,
  services,
  clients,
  members,
  saving = false,
  checkConflicts,
  editingAppointmentId,
}: AppointmentDialogProps) {
  const [formData, setFormData] = useState<AppointmentFormData>({
    clientId: '',
    clientName: '',
    clientPhone: '',
    serviceId: '',
    serviceName: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '09:00',
    duration: 60,
    professionalId: '',
    professionalName: '',
    notes: '',
    status: 'agendado',
    price: 0,
    color: '#3B82F6',
  });
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && initialData) {
      setFormData((prev) => ({ ...prev, ...initialData }));
      setClientSearch(initialData.clientName || '');
    } else if (open) {
      setFormData({
        clientId: '',
        clientName: '',
        clientPhone: '',
        serviceId: '',
        serviceName: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        startTime: '09:00',
        duration: 60,
        professionalId: '',
        professionalName: '',
        notes: '',
        status: 'agendado',
        price: 0,
        color: '#3B82F6',
      });
      setClientSearch('');
    }
  }, [open, initialData]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showClientDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (clientSearchRef.current && !clientSearchRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showClientDropdown]);

  const filteredClients = useMemo(() => {
    if (!clientSearch) return clients.slice(0, 20);
    return clients.filter((c) =>
      c.nome.toLowerCase().includes(clientSearch.toLowerCase()) ||
      (c.phone && c.phone.includes(clientSearch))
    ).slice(0, 20);
  }, [clientSearch, clients]);

  const activeServices = useMemo(() => services.filter((s) => s.isActive), [services]);

  // Filter members by selected service (if they have serviceIds configured)
  const availableMembers = useMemo(() => {
    if (!formData.serviceId) return members;
    // Check if any member has serviceIds configured
    const anyHasServiceIds = members.some((m) => m.serviceIds && m.serviceIds.length > 0);
    if (!anyHasServiceIds) return members;
    return members.filter((m) => {
      // If member has no serviceIds, show them (backwards compatible)
      if (!m.serviceIds || m.serviceIds.length === 0) return true;
      return m.serviceIds.includes(formData.serviceId);
    });
  }, [members, formData.serviceId]);

  // Conflict detection for the current form state
  const formConflict = useMemo(() => {
    if (!checkConflicts || !formData.professionalId || !formData.date || !formData.startTime) {
      return { hasConflict: false, message: '' };
    }
    const endTime = addDurationToTime(formData.startTime, formData.duration);
    return checkConflicts(formData.professionalId, formData.date, formData.startTime, endTime, editingAppointmentId);
  }, [checkConflicts, formData.professionalId, formData.date, formData.startTime, formData.duration, editingAppointmentId]);

  const handleServiceChange = (serviceId: string) => {
    const service = services.find((s) => s.id === serviceId);
    if (service) {
      setFormData((prev) => ({
        ...prev,
        serviceId: service.id,
        serviceName: service.name,
        duration: service.duration,
        price: service.price,
        color: service.color,
      }));
    }
  };

  const handleClientSelect = (client: Client) => {
    setFormData((prev) => ({
      ...prev,
      clientId: client.id,
      clientName: client.nome,
      clientPhone: client.phone || '',
    }));
    setClientSearch(client.nome);
    setShowClientDropdown(false);
  };

  const handleSubmit = () => {
    if (!formData.clientName || !formData.date || !formData.startTime) {
      return;
    }
    onSave(formData);
  };

  const endTime = addDurationToTime(formData.startTime, formData.duration);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '16px',
          overflow: 'visible',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          pt: 2.5,
          pb: 1,
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {isEditing ? 'Editar Agendamento' : 'Novo Agendamento'}
        </span>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </button>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 1, pb: 0 }}>
        <div className="space-y-4 py-2">
          {/* Client search */}
          <div ref={clientSearchRef} className="relative">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Cliente *
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setShowClientDropdown(true);
                  setFormData((prev) => ({ ...prev, clientName: e.target.value, clientId: '' }));
                }}
                onFocus={() => setShowClientDropdown(true)}
                placeholder="Buscar cliente..."
                className={cn(
                  'w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                  'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  'bg-white dark:bg-gray-800',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              />
            </div>
            <AnimatePresence>
              {showClientDropdown && filteredClients.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-48 overflow-y-auto"
                >
                  {filteredClients.map((client) => (
                    <button
                      key={client.id}
                      onClick={() => handleClientSelect(client)}
                      className="w-full px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-white/[0.04] flex items-center gap-3 transition-colors first:rounded-t-xl last:rounded-b-xl"
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-semibold text-gray-500 dark:text-gray-400">
                        {client.nome.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{client.nome}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{client.phone}</div>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Service select */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Servico *
            </label>
            <select
              value={formData.serviceId}
              onChange={(e) => handleServiceChange(e.target.value)}
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                'transition-all duration-200',
              )}
            >
              <option value="">Selecionar servico</option>
              {activeServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} - {formatCurrency(s.price)} ({s.duration} min)
                </option>
              ))}
            </select>
          </div>

          {/* Date and time row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Data *
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData((prev) => ({ ...prev, date: e.target.value }))}
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                  'text-sm text-gray-900 dark:text-gray-100',
                  'bg-white dark:bg-gray-800',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Horario Inicio *
              </label>
              <select
                value={formData.startTime}
                onChange={(e) => setFormData((prev) => ({ ...prev, startTime: e.target.value }))}
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                  'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Duration and end time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Duracao
              </label>
              <select
                value={formData.duration}
                onChange={(e) => setFormData((prev) => ({ ...prev, duration: Number(e.target.value) }))}
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                  'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Termino
              </label>
              <div className="px-4 py-2.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-500 dark:text-gray-400">
                {endTime}
              </div>
            </div>
          </div>

          {/* Professional */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Profissional
              {formData.serviceId && availableMembers.length < members.length && (
                <span className="ml-1.5 text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                  ({availableMembers.length} disponiveis para este servico)
                </span>
              )}
            </label>
            <select
              value={formData.professionalId}
              onChange={(e) => {
                const member = members.find((m) => m.id === e.target.value);
                setFormData((prev) => ({
                  ...prev,
                  professionalId: e.target.value,
                  professionalName: member?.name || '',
                }));
              }}
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border bg-white dark:bg-gray-800',
                'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                'transition-all duration-200',
                formConflict.hasConflict
                  ? 'border-amber-300 dark:border-amber-500/40'
                  : 'border-gray-200 dark:border-gray-700',
              )}
            >
              <option value="">Selecionar profissional</option>
              {availableMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Conflict warning */}
          <AnimatePresence>
            {formConflict.hasConflict && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className={cn(
                  'flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border',
                  'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30',
                )}>
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">Conflito de Agenda</div>
                    <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">{formConflict.message}</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Status and Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, status: e.target.value as AppointmentStatus }))
                }
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                  'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Valor (R$)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.price || ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, price: Number(e.target.value) }))
                }
                placeholder="0,00"
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                  'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  'bg-white dark:bg-gray-800',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Observacoes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              rows={3}
              placeholder="Observacoes adicionais..."
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 resize-none',
                'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                'bg-white dark:bg-gray-800',
                'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                'transition-all duration-200',
              )}
            />
          </div>
        </div>
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          py: 2.5,
          gap: 1,
          justifyContent: isEditing ? 'space-between' : 'flex-end',
        }}
      >
        {isEditing && onDelete && (
          <button
            onClick={onDelete}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium',
              'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors',
            )}
          >
            <Trash2 className="w-4 h-4 inline mr-1.5" />
            Excluir
          </button>
        )}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className={cn(
              'px-5 py-2.5 rounded-xl text-sm font-medium',
              'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] border border-gray-200 dark:border-gray-700',
              'transition-all duration-200',
            )}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!formData.clientName || saving}
            className={cn(
              'px-5 py-2.5 rounded-xl text-sm font-semibold',
              'bg-red-600 text-white hover:bg-red-700',
              'shadow-sm shadow-red-600/20',
              'transition-all duration-200',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {saving ? 'Salvando...' : isEditing ? 'Salvar Alteracoes' : 'Agendar'}
          </button>
        </div>
      </DialogActions>
    </Dialog>
  );
}

// ---- View Appointment Dialog ----
interface ViewAppointmentDialogProps {
  open: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  onEdit: () => void;
  onStatusChange: (status: AppointmentStatus) => void;
  statusChanging: boolean;
}

function ViewAppointmentDialog({
  open,
  onClose,
  appointment,
  onEdit,
  onStatusChange,
  statusChanging,
}: ViewAppointmentDialogProps) {
  if (!appointment) return null;

  const color = STATUS_COLORS[appointment.status];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '16px',
        },
      }}
    >
      <div className="relative">
        {/* Colored top bar */}
        <div
          className="h-1.5 rounded-t-2xl"
          style={{ backgroundColor: color }}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors z-10"
        >
          <X className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </button>

        <div className="px-6 pt-5 pb-6">
          {/* Header */}
          <div className="flex items-start gap-4 mb-6">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
              style={{ backgroundColor: color }}
            >
              {appointment.clientName.split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {appointment.clientName}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{appointment.serviceName}</p>
              <Chip
                label={getStatusLabel(appointment.status)}
                size="small"
                sx={{
                  mt: 1,
                  backgroundColor: STATUS_BG_COLORS[appointment.status],
                  color: color,
                  fontWeight: 600,
                  fontSize: '11px',
                  height: '24px',
                }}
              />
            </div>
          </div>

          {/* Details grid */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
              <CalendarIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Data</div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {format(parseISO(appointment.date), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
              <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Horario</div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {appointment.startTime} - {appointment.endTime} ({appointment.duration} min)
                </div>
              </div>
            </div>

            {appointment.clientPhone && (
              <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <Phone className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Telefone</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{appointment.clientPhone}</div>
                </div>
              </div>
            )}

            {appointment.professionalName && (
              <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <UserIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Profissional</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{appointment.professionalName}</div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
              <DollarSign className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Valor</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(appointment.price)}</div>
              </div>
            </div>

            {appointment.notes && (
              <div className="flex items-start gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <FileText className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Observacoes</div>
                  <div className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{appointment.notes}</div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={onEdit}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors',
              )}
            >
              <Edit3 className="w-3.5 h-3.5" />
              Editar
            </button>

            {appointment.status === 'agendado' && (
              <button
                onClick={() => onStatusChange('confirmado')}
                disabled={statusChanging}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                  'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors',
                  'disabled:opacity-50',
                )}
              >
                <Check className="w-3.5 h-3.5" />
                Confirmar
              </button>
            )}

            {(appointment.status === 'agendado' || appointment.status === 'confirmado') && (
              <button
                onClick={() => onStatusChange('em_andamento')}
                disabled={statusChanging}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                  'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors',
                  'disabled:opacity-50',
                )}
              >
                <Clock className="w-3.5 h-3.5" />
                Iniciar
              </button>
            )}

            {(appointment.status === 'agendado' || appointment.status === 'confirmado') && (
              <button
                onClick={() => onStatusChange('cancelado')}
                disabled={statusChanging}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                  'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors',
                  'disabled:opacity-50',
                )}
              >
                <X className="w-3.5 h-3.5" />
                Cancelar
              </button>
            )}

            {(appointment.status === 'confirmado' || appointment.status === 'em_andamento') && (
              <button
                onClick={() => onStatusChange('concluido')}
                disabled={statusChanging}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                  'text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors',
                  'disabled:opacity-50',
                )}
              >
                <Check className="w-3.5 h-3.5" />
                Concluir
              </button>
            )}

            {(appointment.status === 'agendado' || appointment.status === 'confirmado') && (
              <button
                onClick={() => onStatusChange('nao_compareceu')}
                disabled={statusChanging}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                  'text-gray-700 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors',
                  'disabled:opacity-50',
                )}
              >
                Nao Compareceu
              </button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ==========================================
// LOADING SKELETON
// ==========================================
function AgendaSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full flex flex-col surface rounded-2xl overflow-hidden"
    >
      {/* Header skeleton */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="h-9 w-32 rounded-xl shimmer" />
          <div className="h-9 w-56 rounded-xl shimmer" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-36 rounded-xl shimmer" />
          <div className="h-9 w-36 rounded-xl shimmer" />
        </div>
      </div>
      {/* Status bar skeleton */}
      <div className="flex items-center gap-2 px-6 py-2 border-b border-gray-100 dark:border-gray-800">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-5 w-20 rounded-md shimmer" />
        ))}
      </div>
      {/* Body skeleton */}
      <div className="flex-1 flex p-4 gap-4">
        <div className="w-16 space-y-6 pt-2">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-4 w-12 rounded shimmer" />
          ))}
        </div>
        <div className="flex-1 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: i * 0.07 }}
              className="h-16 rounded-xl shimmer"
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ==========================================
// MAIN AGENDA MODULE
// ==========================================

export default function AgendaModule() {
  const { user, business } = useAuth();
  const queryClient = useQueryClient();

  // ---- State ----
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [showServiceDialog, setShowServiceDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [formInitialData, setFormInitialData] = useState<Partial<AppointmentFormData>>({});
  const [calendarAnchor, setCalendarAnchor] = useState<HTMLElement | null>(null);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');
  const [saving, setSaving] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [members, setMembers] = useState<User[]>([]);
  const [selectedProfessional, setSelectedProfessional] = useState<string>('all');
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const calendarOpen = Boolean(calendarAnchor);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ==========================================
  // FIRESTORE QUERIES
  // ==========================================

  // Fetch appointments
  const { data: appointments = [], isLoading: appointmentsLoading } = useQuery({
    queryKey: ['appointments', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'appointments'),
        where('businessId', '==', business.id),
        orderBy('date', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Appointment));
    },
    enabled: !!business?.id,
    staleTime: 2 * 60 * 1000,
  });

  // Fetch services
  const { data: services = [], isLoading: servicesLoading } = useQuery({
    queryKey: ['services', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'services'),
        where('businessId', '==', business.id),
        orderBy('name', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Service));
    },
    enabled: !!business?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch clients
  const { data: clients = [] } = useQuery({
    queryKey: ['clients', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'clients'),
        where('businessId', '==', business.id),
        where('isActive', '==', true),
        orderBy('nome', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as Client));
    },
    enabled: !!business?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch team members via onSnapshot
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'users'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      setMembers(snap.docs.map((d) => ({ ...d.data(), id: d.id } as User)));
    });
    return () => unsub();
  }, [business?.id]);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollContainerRef.current) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const offsetMinutes = currentMinutes - START_HOUR * 60;
      const scrollTarget = (offsetMinutes / 60) * HOUR_HEIGHT - 200;
      scrollContainerRef.current.scrollTop = Math.max(0, scrollTarget);
    }
  }, [viewMode]);

  // Default to day view on mobile
  useEffect(() => {
    if (isMobile && viewMode === 'week') {
      setViewMode('day');
    }
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ==========================================
  // PROFESSIONAL FILTERING & CONFLICT DETECTION
  // ==========================================

  // Filter appointments by selected professional
  const filteredAppointments = useMemo(() => {
    if (!appointments) return [];
    if (selectedProfessional === 'all') return appointments;
    return appointments.filter((a) => a.professionalId === selectedProfessional);
  }, [appointments, selectedProfessional]);

  // Group appointments by date (using filtered)
  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    filteredAppointments.forEach((a) => {
      const existing = map.get(a.date) || [];
      existing.push(a);
      map.set(a.date, existing);
    });
    return map;
  }, [filteredAppointments]);

  // Conflict detection for professional scheduling
  const checkConflicts = useCallback((professionalId: string, date: string, startTime: string, endTime: string, excludeId?: string) => {
    if (!professionalId || !appointments) return { hasConflict: false, message: '' };

    // Check 1: Working hours
    const professional = members.find((m) => m.id === professionalId);
    if (professional?.workingHours) {
      const dayOfWeek = new Date(date + 'T12:00:00').getDay();
      const daySchedule = professional.workingHours[dayOfWeek];
      if (!daySchedule?.enabled) {
        return { hasConflict: true, message: `${professional.name} nao trabalha neste dia` };
      }
      if (startTime < daySchedule.start || endTime > daySchedule.end) {
        return { hasConflict: true, message: `Fora do horario de trabalho (${daySchedule.start} - ${daySchedule.end})` };
      }
    }

    // Check 2: Overlapping appointments
    const existing = appointments.filter((a) =>
      a.professionalId === professionalId &&
      a.date === date &&
      a.status !== 'cancelado' &&
      a.id !== excludeId &&
      !(endTime <= a.startTime || startTime >= a.endTime)
    );

    if (existing.length > 0) {
      return { hasConflict: true, message: `Conflito com ${existing[0].clientName} (${existing[0].startTime} - ${existing[0].endTime})` };
    }

    return { hasConflict: false, message: '' };
  }, [appointments, members]);

  // ==========================================
  // SERVICE CRUD HANDLERS
  // ==========================================

  const handleCreateService = useCallback(async (data: ServiceFormData) => {
    if (!business?.id) return;
    await addDoc(collection(db, 'services'), {
      businessId: business.id,
      name: data.name,
      description: data.description || null,
      duration: data.duration,
      price: data.price,
      category: data.category || null,
      color: data.color,
      isActive: data.isActive,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['services', business.id] });
    setSnackbar({ open: true, message: 'Servico criado com sucesso!', severity: 'success' });
  }, [business?.id, queryClient]);

  const handleUpdateService = useCallback(async (id: string, data: ServiceFormData) => {
    if (!business?.id) return;
    await updateDoc(doc(db, 'services', id), {
      name: data.name,
      description: data.description || null,
      duration: data.duration,
      price: data.price,
      category: data.category || null,
      color: data.color,
      isActive: data.isActive,
      updatedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['services', business.id] });
    setSnackbar({ open: true, message: 'Servico atualizado com sucesso!', severity: 'success' });
  }, [business?.id, queryClient]);

  const handleDeleteService = useCallback(async (id: string) => {
    if (!business?.id) return;
    await deleteDoc(doc(db, 'services', id));
    queryClient.invalidateQueries({ queryKey: ['services', business.id] });
    setSnackbar({ open: true, message: 'Servico excluido.', severity: 'info' });
  }, [business?.id, queryClient]);

  // ==========================================
  // APPOINTMENT CRUD HANDLERS
  // ==========================================

  const handleSaveAppointment = useCallback(async (data: AppointmentFormData) => {
    if (!business?.id) return;
    setSaving(true);
    try {
      const endTime = addDurationToTime(data.startTime, data.duration);
      const serviceColor = services.find((s) => s.id === data.serviceId)?.color || data.color || '#3B82F6';

      // Soft conflict warning (does not block saving)
      if (data.professionalId) {
        const conflictResult = checkConflicts(
          data.professionalId,
          data.date,
          data.startTime,
          endTime,
          editingAppointment?.id
        );
        if (conflictResult.hasConflict) {
          setSnackbar({
            open: true,
            message: `Aviso: ${conflictResult.message}`,
            severity: 'warning',
          });
        }
      }

      const payload: Record<string, any> = {
        clientId: data.clientId || '',
        clientName: data.clientName,
        date: data.date,
        startTime: data.startTime,
        endTime,
        duration: data.duration,
        status: data.status,
        price: data.price,
        color: serviceColor,
        updatedAt: new Date().toISOString(),
      };
      if (data.clientPhone) payload.clientPhone = data.clientPhone;
      if (data.serviceId) payload.serviceId = data.serviceId;
      if (data.serviceName) payload.serviceName = data.serviceName;
      if (data.professionalId) payload.professionalId = data.professionalId;
      if (data.professionalName) payload.professionalName = data.professionalName;
      if (data.notes) payload.notes = data.notes;

      if (editingAppointment) {
        await updateDoc(doc(db, 'appointments', editingAppointment.id), payload);
        setSnackbar({ open: true, message: 'Agendamento atualizado com sucesso!', severity: 'success' });
      } else {
        payload.businessId = business.id;
        payload.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'appointments'), payload);
        setSnackbar({ open: true, message: 'Agendamento criado com sucesso!', severity: 'success' });
      }

      queryClient.invalidateQueries({ queryKey: ['appointments', business.id] });
      setShowFormDialog(false);
      setEditingAppointment(null);
    } catch (err) {
      console.error('Error saving appointment:', err);
      setSnackbar({ open: true, message: 'Erro ao salvar agendamento.', severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [business?.id, editingAppointment, services, queryClient, checkConflicts]);

  const handleDeleteAppointment = useCallback(async () => {
    if (!editingAppointment || !business?.id) return;
    setDeleteLoading(true);
    try {
      await deleteDoc(doc(db, 'appointments', editingAppointment.id));
      queryClient.invalidateQueries({ queryKey: ['appointments', business.id] });
      setShowDeleteDialog(false);
      setShowFormDialog(false);
      setEditingAppointment(null);
      setSnackbar({ open: true, message: 'Agendamento excluido.', severity: 'info' });
    } catch (err) {
      console.error('Error deleting appointment:', err);
      setSnackbar({ open: true, message: 'Erro ao excluir agendamento.', severity: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  }, [editingAppointment, business?.id, queryClient]);

  const handleCancelAppointment = useCallback(async () => {
    if (!editingAppointment || !business?.id) return;
    setDeleteLoading(true);
    try {
      await updateDoc(doc(db, 'appointments', editingAppointment.id), {
        status: 'cancelado',
        updatedAt: new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ['appointments', business.id] });
      setShowDeleteDialog(false);
      setShowFormDialog(false);
      setEditingAppointment(null);
      setSnackbar({ open: true, message: 'Agendamento cancelado.', severity: 'info' });
    } catch (err) {
      console.error('Error cancelling appointment:', err);
      setSnackbar({ open: true, message: 'Erro ao cancelar agendamento.', severity: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  }, [editingAppointment, business?.id, queryClient]);

  const handleStatusChange = useCallback(async (status: AppointmentStatus) => {
    if (!selectedAppointment || !business?.id) return;
    setStatusChanging(true);
    try {
      await updateDoc(doc(db, 'appointments', selectedAppointment.id), {
        status,
        updatedAt: new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ['appointments', business.id] });
      setSelectedAppointment((prev) => (prev ? { ...prev, status } : null));
      setSnackbar({
        open: true,
        message: `Status alterado para "${getStatusLabel(status)}"`,
        severity: 'success',
      });
    } catch (err) {
      console.error('Error changing status:', err);
      setSnackbar({ open: true, message: 'Erro ao alterar status.', severity: 'error' });
    } finally {
      setStatusChanging(false);
    }
  }, [selectedAppointment, business?.id, queryClient]);

  // ---- Computed values ----
  const weekStart = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 0 }), [currentDate]);
  const weekEnd = useMemo(() => endOfWeek(currentDate, { weekStartsOn: 0 }), [currentDate]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);
  const monthStartVal = useMemo(() => startOfMonth(currentDate), [currentDate]);
  const monthEndVal = useMemo(() => endOfMonth(currentDate), [currentDate]);

  const monthCalendarDays = useMemo(() => {
    const start = startOfWeek(monthStartVal, { weekStartsOn: 0 });
    const end = endOfWeek(monthEndVal, { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [monthStartVal, monthEndVal]);

  // Appointments for current view (using filtered)
  const visibleAppointments = useMemo(() => {
    switch (viewMode) {
      case 'day':
        return filteredAppointments.filter((a) =>
          isSameDay(parseISO(a.date), currentDate)
        );
      case 'week':
        return filteredAppointments.filter((a) => {
          const d = parseISO(a.date);
          return !isBefore(d, weekStart) && !isAfter(d, weekEnd);
        });
      case 'month':
        return filteredAppointments.filter((a) => {
          const d = parseISO(a.date);
          return isSameMonth(d, currentDate);
        });
      default:
        return [];
    }
  }, [filteredAppointments, viewMode, currentDate, weekStart, weekEnd]);

  // ---- Navigation ----
  const navigatePrev = useCallback(() => {
    setSlideDirection('left');
    switch (viewMode) {
      case 'day':
        setCurrentDate((d) => subDays(d, 1));
        break;
      case 'week':
        setCurrentDate((d) => subWeeks(d, 1));
        break;
      case 'month':
        setCurrentDate((d) => subMonths(d, 1));
        break;
    }
  }, [viewMode]);

  const navigateNext = useCallback(() => {
    setSlideDirection('right');
    switch (viewMode) {
      case 'day':
        setCurrentDate((d) => addDays(d, 1));
        break;
      case 'week':
        setCurrentDate((d) => addWeeks(d, 1));
        break;
      case 'month':
        setCurrentDate((d) => addMonths(d, 1));
        break;
    }
  }, [viewMode]);

  const navigateToday = useCallback(() => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  }, []);

  const navigateToDate = useCallback((date: Date) => {
    setCurrentDate(date);
    setSelectedDate(date);
    setCalendarAnchor(null);
  }, []);

  // ---- Period display text ----
  const periodText = useMemo(() => {
    switch (viewMode) {
      case 'day':
        return format(currentDate, "EEEE, dd 'de' MMMM", { locale: ptBR });
      case 'week': {
        const wStart = weekStart;
        const wEnd = weekEnd;
        if (isSameMonth(wStart, wEnd)) {
          return `${format(wStart, 'dd', { locale: ptBR })} - ${format(wEnd, "dd 'de' MMMM yyyy", { locale: ptBR })}`;
        }
        return `${format(wStart, "dd 'de' MMM", { locale: ptBR })} - ${format(wEnd, "dd 'de' MMM yyyy", { locale: ptBR })}`;
      }
      case 'month':
        return format(currentDate, "MMMM 'de' yyyy", { locale: ptBR });
    }
  }, [viewMode, currentDate, weekStart, weekEnd]);

  // ---- Appointment Actions ----
  const handleAppointmentClick = useCallback((appt: Appointment) => {
    setSelectedAppointment(appt);
    setShowViewDialog(true);
  }, []);

  const handleNewAppointment = useCallback((date?: string, time?: string) => {
    setEditingAppointment(null);
    setFormInitialData({
      date: date || format(currentDate, 'yyyy-MM-dd'),
      startTime: time || '09:00',
    });
    setShowFormDialog(true);
  }, [currentDate]);

  const handleEditAppointment = useCallback(() => {
    if (!selectedAppointment) return;
    setShowViewDialog(false);
    setEditingAppointment(selectedAppointment);
    setFormInitialData({
      clientId: selectedAppointment.clientId,
      clientName: selectedAppointment.clientName,
      clientPhone: selectedAppointment.clientPhone || '',
      serviceId: selectedAppointment.serviceId || '',
      serviceName: selectedAppointment.serviceName,
      date: selectedAppointment.date,
      startTime: selectedAppointment.startTime,
      duration: selectedAppointment.duration,
      professionalId: selectedAppointment.professionalId || '',
      professionalName: selectedAppointment.professionalName || '',
      notes: selectedAppointment.notes || '',
      status: selectedAppointment.status,
      price: selectedAppointment.price,
      color: selectedAppointment.color || '#3B82F6',
    });
    setShowFormDialog(true);
  }, [selectedAppointment]);

  const handleSlotClick = useCallback((date: Date, time: string) => {
    handleNewAppointment(format(date, 'yyyy-MM-dd'), time);
  }, [handleNewAppointment]);

  // ---- Time column ----
  const timeColumn = useMemo(
    () => (
      <div className="w-16 flex-shrink-0 border-r border-gray-100 dark:border-gray-800 relative" style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}>
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
          const hour = START_HOUR + i;
          return (
            <div
              key={hour}
              className="absolute right-0 w-full pr-2 flex items-center justify-end"
              style={{ top: `${i * HOUR_HEIGHT - 6}px` }}
            >
              <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">
                {String(hour).padStart(2, '0')}:00
              </span>
            </div>
          );
        })}
      </div>
    ),
    [],
  );

  // ---- Horizontal grid lines ----
  const gridLines = useMemo(
    () => (
      <>
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
          <div
            key={`line-${i}`}
            className="absolute left-0 right-0 border-t border-gray-100 dark:border-gray-800"
            style={{ top: `${i * HOUR_HEIGHT}px` }}
          />
        ))}
        {Array.from({ length: TOTAL_HOURS }, (_, i) => (
          <div
            key={`half-${i}`}
            className="absolute left-0 right-0 border-t border-gray-50 dark:border-gray-800/50 border-dashed"
            style={{ top: `${i * HOUR_HEIGHT + HALF_HOUR_HEIGHT}px` }}
          />
        ))}
      </>
    ),
    [],
  );

  // ==========================================
  // LOADING STATE
  // ==========================================
  if (appointmentsLoading || servicesLoading) {
    return <AgendaSkeleton />;
  }

  // ==========================================
  // RENDER: DAY VIEW
  // ==========================================
  const renderDayView = () => {
    const dayAppointments = filteredAppointments.filter((a) =>
      isSameDay(parseISO(a.date), currentDate)
    );

    return (
      <motion.div
        key={`day-${format(currentDate, 'yyyy-MM-dd')}`}
        initial={{ opacity: 0, x: slideDirection === 'right' ? 20 : -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: slideDirection === 'right' ? -20 : 20 }}
        transition={{ duration: 0.25 }}
        className="flex-1 overflow-hidden"
      >
        {/* Day header */}
        <div className="flex items-center px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
          <div className="w-16 flex-shrink-0" />
          <div className="flex-1 text-center">
            <div className={cn(
              'text-xs font-medium uppercase tracking-wider',
              isToday(currentDate) ? 'text-red-600' : 'text-gray-500 dark:text-gray-400',
            )}>
              {format(currentDate, 'EEEE', { locale: ptBR })}
            </div>
            <div className={cn(
              'inline-flex items-center justify-center w-10 h-10 rounded-full text-lg font-semibold mt-1',
              isToday(currentDate)
                ? 'bg-red-600 text-white'
                : 'text-gray-900 dark:text-gray-100',
            )}>
              {format(currentDate, 'd')}
            </div>
          </div>
        </div>

        {/* Time grid */}
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto overflow-x-hidden"
          style={{ height: 'calc(100vh - 240px)' }}
        >
          <div className="flex relative" style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}>
            {timeColumn}
            <div className="flex-1 relative">
              {gridLines}
              <CurrentTimeLine />

              {/* Clickable slots */}
              {Array.from({ length: TOTAL_HOURS * 2 }, (_, i) => {
                const hour = START_HOUR + Math.floor(i / 2);
                const minute = (i % 2) * 30;
                const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                return (
                  <div
                    key={`slot-${i}`}
                    className="absolute left-0 right-0 cursor-pointer hover:bg-red-50/30 dark:hover:bg-red-500/5 transition-colors z-[5]"
                    style={{
                      top: `${i * HALF_HOUR_HEIGHT}px`,
                      height: `${HALF_HOUR_HEIGHT}px`,
                    }}
                    onClick={() => handleSlotClick(currentDate, timeStr)}
                  />
                );
              })}

              {/* Appointment blocks */}
              {dayAppointments.map((appt) => (
                <AppointmentBlock
                  key={appt.id}
                  appointment={appt}
                  onClick={handleAppointmentClick}
                />
              ))}

              {/* Empty state */}
              {dayAppointments.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
                  <div className="text-center">
                    <CalendarIcon className="w-10 h-10 mx-auto text-gray-200 dark:text-gray-700 mb-2" />
                    <p className="text-sm text-gray-400 dark:text-gray-500">Nenhum agendamento neste dia</p>
                    <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Clique em um horario para agendar</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  // ==========================================
  // RENDER: WEEK VIEW
  // ==========================================
  const renderWeekView = () => (
    <motion.div
      key={`week-${format(weekStart, 'yyyy-MM-dd')}`}
      initial={{ opacity: 0, x: slideDirection === 'right' ? 20 : -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: slideDirection === 'right' ? -20 : 20 }}
      transition={{ duration: 0.25 }}
      className="flex-1 overflow-hidden"
    >
      {/* Weekday headers */}
      <div className="flex border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-20">
        <div className="w-16 flex-shrink-0 border-r border-gray-100 dark:border-gray-800" />
        {weekDays.map((day, i) => {
          const isTodayCol = isToday(day);
          const dayAppointmentsCount = appointmentsByDate.get(format(day, 'yyyy-MM-dd'))?.length || 0;
          return (
            <div
              key={i}
              className={cn(
                'flex-1 text-center py-2.5 border-r border-gray-100 dark:border-gray-800 last:border-r-0 min-w-[100px]',
                isTodayCol && 'bg-red-50/40 dark:bg-red-500/5',
              )}
            >
              <div className={cn(
                'text-[11px] font-medium uppercase tracking-wider',
                isTodayCol ? 'text-red-600' : 'text-gray-400 dark:text-gray-500',
              )}>
                {WEEKDAY_LABELS[i]}
              </div>
              <div
                className={cn(
                  'inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold mt-0.5 cursor-pointer',
                  isTodayCol
                    ? 'bg-red-600 text-white'
                    : 'text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                )}
                onClick={() => {
                  setCurrentDate(day);
                  setViewMode('day');
                }}
              >
                {format(day, 'd')}
              </div>
              {dayAppointmentsCount > 0 && (
                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {dayAppointmentsCount} agend.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div
        ref={scrollContainerRef}
        className="overflow-auto"
        style={{ height: 'calc(100vh - 260px)' }}
      >
        <div className="flex relative" style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px`, minWidth: isMobile ? '800px' : 'auto' }}>
          {timeColumn}

          {weekDays.map((day, dayIdx) => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const dayAppts = appointmentsByDate.get(dayKey) || [];
            const isTodayCol = isToday(day);

            return (
              <div
                key={dayIdx}
                className={cn(
                  'flex-1 relative border-r border-gray-100 dark:border-gray-800 last:border-r-0 min-w-[100px]',
                  isTodayCol && 'bg-red-50/20 dark:bg-red-500/5',
                )}
              >
                {gridLines}
                {isTodayCol && <CurrentTimeLine />}

                {/* Clickable slots */}
                {Array.from({ length: TOTAL_HOURS * 2 }, (_, i) => {
                  const hour = START_HOUR + Math.floor(i / 2);
                  const minute = (i % 2) * 30;
                  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                  return (
                    <div
                      key={`slot-${dayIdx}-${i}`}
                      className="absolute left-0 right-0 cursor-pointer hover:bg-red-50/30 dark:hover:bg-red-500/5 transition-colors z-[5]"
                      style={{
                        top: `${i * HALF_HOUR_HEIGHT}px`,
                        height: `${HALF_HOUR_HEIGHT}px`,
                      }}
                      onClick={() => handleSlotClick(day, timeStr)}
                    />
                  );
                })}

                {dayAppts.map((appt) => (
                  <AppointmentBlock
                    key={appt.id}
                    appointment={appt}
                    onClick={handleAppointmentClick}
                    compact
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );

  // ==========================================
  // RENDER: MONTH VIEW
  // ==========================================
  const renderMonthView = () => (
    <motion.div
      key={`month-${format(currentDate, 'yyyy-MM')}`}
      initial={{ opacity: 0, x: slideDirection === 'right' ? 20 : -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: slideDirection === 'right' ? -20 : 20 }}
      transition={{ duration: 0.25 }}
      className="flex-1 overflow-hidden"
    >
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={i} className="text-center py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 border-r border-gray-100 dark:border-gray-800 last:border-r-0">
            {label}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div
        className="overflow-y-auto"
        style={{ height: 'calc(100vh - 220px)' }}
      >
        <div className="grid grid-cols-7">
          {monthCalendarDays.map((day, idx) => {
            const isCurrentMonthDay = isSameMonth(day, currentDate);
            const isTodayDate = isToday(day);
            const dayKey = format(day, 'yyyy-MM-dd');
            const dayAppts = appointmentsByDate.get(dayKey) || [];
            const maxPreview = 3;
            const overflow = dayAppts.length - maxPreview;

            return (
              <div
                key={idx}
                className={cn(
                  'min-h-[120px] border-r border-b border-gray-100 dark:border-gray-800 last:border-r-0',
                  'p-1.5 cursor-pointer transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]',
                  !isCurrentMonthDay && 'bg-gray-50/30 dark:bg-gray-800/30',
                )}
                onClick={() => {
                  setCurrentDate(day);
                  setSelectedDate(day);
                  setViewMode('day');
                }}
              >
                <div className="flex justify-center mb-1">
                  <span
                    className={cn(
                      'inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium',
                      isTodayDate && 'bg-red-600 text-white font-bold',
                      !isTodayDate && isCurrentMonthDay && 'text-gray-900 dark:text-gray-100',
                      !isTodayDate && !isCurrentMonthDay && 'text-gray-300 dark:text-gray-600',
                    )}
                  >
                    {format(day, 'd')}
                  </span>
                </div>

                <div className="space-y-0.5">
                  {dayAppts.slice(0, maxPreview).map((appt) => (
                    <motion.div
                      key={appt.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAppointmentClick(appt);
                      }}
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] truncate cursor-pointer',
                        'transition-all duration-150 hover:shadow-sm',
                      )}
                      style={{
                        backgroundColor: STATUS_BG_COLORS[appt.status],
                        color: STATUS_COLORS[appt.status],
                        borderLeft: `2px solid ${STATUS_COLORS[appt.status]}`,
                      }}
                    >
                      <span className="font-semibold">{appt.startTime}</span>{' '}
                      {appt.clientName.split(' ')[0]}
                    </motion.div>
                  ))}
                  {overflow > 0 && (
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium text-center py-0.5">
                      +{overflow} mais
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );

  // ==========================================
  // STATUS SUMMARY BAR
  // ==========================================
  const statusSummary = (() => {
    const counts: Record<AppointmentStatus, number> = {
      agendado: 0,
      confirmado: 0,
      em_andamento: 0,
      concluido: 0,
      cancelado: 0,
      nao_compareceu: 0,
    };
    visibleAppointments.forEach((a) => {
      counts[a.status]++;
    });
    return counts;
  })();

  // ==========================================
  // MAIN RENDER
  // ==========================================
  return (
    <div className="h-full flex flex-col surface rounded-2xl overflow-hidden">
      {/* ========== HEADER BAR ========== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
        {/* Left: Navigation */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Prev / Today / Next */}
          <div className="flex items-center bg-gray-50 dark:bg-gray-800 rounded-xl p-0.5">
            <button
              onClick={navigatePrev}
              className="p-2 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all duration-200 hover:shadow-sm"
              title="Anterior"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
            <button
              onClick={navigateToday}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200',
                isToday(currentDate)
                  ? 'bg-red-600 text-white shadow-sm shadow-red-600/20'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700 hover:shadow-sm',
              )}
            >
              Hoje
            </button>
            <button
              onClick={navigateNext}
              className="p-2 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all duration-200 hover:shadow-sm"
              title="Proximo"
            >
              <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          </div>

          {/* Date display / calendar trigger */}
          <button
            onClick={(e) => setCalendarAnchor(e.currentTarget)}
            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.04] rounded-xl transition-colors"
          >
            <CalendarIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            <span className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100 capitalize whitespace-nowrap">
              {periodText}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          </button>

          {/* Mini calendar popover */}
          <Popover
            open={calendarOpen}
            anchorEl={calendarAnchor}
            onClose={() => setCalendarAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            PaperProps={{
              sx: {
                borderRadius: '16px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05)',
                mt: 1,
              },
            }}
          >
            <MiniCalendar
              selectedDate={selectedDate}
              onSelect={navigateToDate}
              appointments={appointments}
            />
          </Popover>
        </div>

        {/* Right: View toggles + Services + New button */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* View mode toggle */}
          <div className="flex items-center bg-gray-50 dark:bg-gray-800 rounded-xl p-0.5">
            {([
              { mode: 'day' as ViewMode, icon: CalendarDays, label: 'Dia' },
              { mode: 'week' as ViewMode, icon: Columns3, label: 'Semana' },
              { mode: 'month' as ViewMode, icon: LayoutGrid, label: 'Mes' },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
                  viewMode === mode
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {/* Services management button */}
          <button
            onClick={() => setShowServiceDialog(true)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium',
              'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] border border-gray-200 dark:border-gray-700',
              'transition-all duration-200',
            )}
          >
            <Settings2 className="w-4 h-4" />
            <span className="hidden sm:inline">Servicos</span>
          </button>

          {/* New appointment button */}
          <button
            onClick={() => handleNewAppointment()}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl',
              'bg-red-600 text-white text-sm font-semibold',
              'hover:bg-red-700 active:bg-red-800',
              'shadow-sm shadow-red-600/20',
              'transition-all duration-200',
            )}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Novo Agendamento</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>
      </div>

      {/* ========== STATUS SUMMARY ========== */}
      <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2 bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
        <span className="text-xs text-gray-400 dark:text-gray-500 mr-1 whitespace-nowrap">
          {visibleAppointments.length} agendamento{visibleAppointments.length !== 1 ? 's' : ''}
        </span>
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
        {STATUS_OPTIONS.filter((s) => statusSummary[s.value] > 0).map((s) => (
          <span
            key={s.value}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium whitespace-nowrap"
            style={{
              backgroundColor: STATUS_BG_COLORS[s.value],
              color: STATUS_COLORS[s.value],
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[s.value] }}
            />
            {statusSummary[s.value]} {s.label}
          </span>
        ))}
      </div>

      {/* ========== PROFESSIONAL FILTER BAR ========== */}
      {members.length > 1 && (
        <div className="flex items-center gap-2 px-4 sm:px-6 py-2 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
          <UsersIcon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <button
            onClick={() => setSelectedProfessional('all')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 whitespace-nowrap flex-shrink-0',
              selectedProfessional === 'all'
                ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400'
                : 'bg-white dark:bg-gray-800 border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:border-slate-300 dark:hover:border-gray-600',
            )}
          >
            Todos
          </button>
          {members.map((member) => {
            const initials = member.name
              .split(' ')
              .map((n) => n[0])
              .filter(Boolean)
              .slice(0, 2)
              .join('')
              .toUpperCase();
            const isActive = selectedProfessional === member.id;
            return (
              <button
                key={member.id}
                onClick={() => setSelectedProfessional(isActive ? 'all' : member.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 whitespace-nowrap flex-shrink-0',
                  isActive
                    ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400'
                    : 'bg-white dark:bg-gray-800 border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:border-slate-300 dark:hover:border-gray-600',
                )}
              >
                <span
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0',
                    isActive
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
                  )}
                >
                  {initials}
                </span>
                <span className="hidden sm:inline">{member.name.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ========== CALENDAR VIEW AREA ========== */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'day' && renderDayView()}
          {viewMode === 'week' && renderWeekView()}
          {viewMode === 'month' && renderMonthView()}
        </AnimatePresence>
      </div>

      {/* ========== DIALOGS ========== */}
      <ViewAppointmentDialog
        open={showViewDialog}
        onClose={() => {
          setShowViewDialog(false);
          setSelectedAppointment(null);
        }}
        appointment={selectedAppointment}
        onEdit={handleEditAppointment}
        onStatusChange={handleStatusChange}
        statusChanging={statusChanging}
      />

      <AppointmentFormDialog
        open={showFormDialog}
        onClose={() => {
          setShowFormDialog(false);
          setEditingAppointment(null);
        }}
        onSave={handleSaveAppointment}
        onDelete={editingAppointment ? () => setShowDeleteDialog(true) : undefined}
        initialData={formInitialData}
        isEditing={!!editingAppointment}
        services={services}
        clients={clients}
        members={members}
        saving={saving}
        checkConflicts={checkConflicts}
        editingAppointmentId={editingAppointment?.id}
      />

      <ServiceManagementDialog
        open={showServiceDialog}
        onClose={() => setShowServiceDialog(false)}
        services={services}
        onCreateService={handleCreateService}
        onUpdateService={handleUpdateService}
        onDeleteService={handleDeleteService}
      />

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onCancel={handleCancelAppointment}
        onDelete={handleDeleteAppointment}
        loading={deleteLoading}
        appointmentName={editingAppointment?.clientName}
      />

      {/* ========== SNACKBAR ========== */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{
            borderRadius: '12px',
            fontFamily: 'Inter, sans-serif',
            fontSize: '13px',
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </div>
  );
}
