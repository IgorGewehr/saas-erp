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
import { ptBR, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
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
  Bell,
  MessageCircle,
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
import { isActiveClient } from '@/lib/utils/clientFilters';
import { maskMoney, unmaskMoney } from '@/lib/utils/masks';
import { getAppointmentProfessionalIds, getAppointmentProfessionalNames, isAppointmentAssignedTo } from '@/lib/utils/appointment';
import { notifyUsers } from '@/lib/services/notifications';
import type { Appointment, AppointmentStatus, Service, CRMContact, User } from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';
import { maybeCreateCommission, maybeCancelCommission } from '@/lib/services/commission';
import { calculateEarnedPoints, addLoyaltyPoints } from '@/lib/services/loyalty';
import { syncToGoogleCalendar } from '@/lib/services/calendarSync';
import { checkAppointmentConflict } from '@/lib/services/appointmentConflicts';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot, increment, writeBatch, limit as firestoreLimit } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

// SDD Fase 4: dispatch de domain event quando appointment vira concluido.
// Fire-and-forget — não bloqueia o save. Auditoria fica em domainEvents/{id}.
// Métricas/commission/loyalty ainda fluem via chamadas inline (handler em
// modo auditoria — ver lib/contracts/_runtime/handlers/appointmentCompleted.ts).
async function emitAppointmentCompletedEvent(args: {
  appointmentId: string;
  clientId?: string;
  professionalId?: string;
  serviceId?: string;
  amount: number;
}): Promise<void> {
  try {
    const { getAuth } = await import('firebase/auth');
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) return;
    await fetch('/api/events/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        type: 'appointment.completed',
        occurredAt: new Date().toISOString(),
        appointmentId: args.appointmentId,
        clientId: args.clientId,
        professionalId: args.professionalId,
        serviceId: args.serviceId,
        amount: args.amount,
      }),
    });
  } catch (err) {
    // Fire-and-forget: log mas não derruba o save
    console.warn('[Agenda] emit appointment.completed falhou:', err);
  }
}

// ==========================================
// CONSTANTS
// ==========================================

const HOUR_HEIGHT = 64;
const HALF_HOUR_HEIGHT = HOUR_HEIGHT / 2;
const START_HOUR = 6;
const END_HOUR = 22;
const TOTAL_HOURS = END_HOUR - START_HOUR;

const WEEKDAY_LABELS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
const WEEKDAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

// STATUS_OPTIONS, DURATION_OPTIONS, TIME_OPTIONS, addDurationToTime e o
// type RecurrenceFrequency vivem em ./shared agora — usados tanto aqui
// quanto pelo AppointmentFormDialog extraído.
import {
  STATUS_OPTIONS,
  DURATION_OPTIONS,
  TIME_OPTIONS,
  addDurationToTime,
  timeToMinutes,
  minutesToTime,
} from './shared';

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
// timeToMinutes/minutesToTime/addDurationToTime/TIME_OPTIONS importados
// de ./shared (eram inline aqui antes da extração do AppointmentFormDialog).

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

// Gera datas para uma série recorrente a partir da data inicial.
function generateRecurrenceDates(startDateISO: string, frequency: RecurrenceFrequency, occurrences: number): string[] {
  if (!frequency || frequency === 'none' || occurrences <= 1) return [startDateISO];
  const start = parseISO(startDateISO);
  const dates: string[] = [];
  for (let i = 0; i < occurrences; i++) {
    let d: Date;
    switch (frequency) {
      case 'daily': d = addDays(start, i); break;
      case 'weekly': d = addWeeks(start, i); break;
      case 'biweekly': d = addWeeks(start, i * 2); break;
      case 'monthly': d = addMonths(start, i); break;
      default: d = start;
    }
    dates.push(format(d, 'yyyy-MM-dd'));
  }
  return dates;
}

// Mantém Client.totalSpent / visitCount / lastVisit em sincronia com o ciclo de conclusão do Appointment.
// Why: esses campos eram puramente manuais, deixando a régua de valor do cliente sempre desatualizada.
async function syncClientMetrics(params: {
  clientId: string;
  visitDelta: number;
  priceDelta: number;
  lastVisitDate?: string;
}) {
  if (!params.clientId) return;
  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (params.visitDelta !== 0) update.visitCount = increment(params.visitDelta);
  if (params.priceDelta !== 0) update.totalSpent = increment(params.priceDelta);
  if (params.lastVisitDate) update.lastVisit = params.lastVisitDate;
  try {
    await updateDoc(doc(db, 'clients', params.clientId), update);
  } catch (err) {
    console.warn('[Agenda] syncClientMetrics failed:', err);
  }
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
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en-US' ? enUS : ptBR;
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
          {format(viewMonth, 'MMMM yyyy', { locale: dateLocale })}
        </span>
        <button
          onClick={() => setViewMonth(addMonths(viewMonth, 1))}
          className="p-1 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-md transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {(i18n.language === 'en-US'
          ? ['S', 'M', 'T', 'W', 'T', 'F', 'S']
          : ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
        ).map((d, i) => (
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
  clientsMap?: Record<string, string>;
}

function AppointmentBlock({ appointment, onClick, compact = false, clientsMap }: AppointmentBlockProps) {
  const displayName = (appointment.clientId && clientsMap?.[appointment.clientId]) || appointment.clientName;
  const color = STATUS_COLORS[appointment.status];
  const bgColor = STATUS_BG_COLORS[appointment.status];
  const height = getAppointmentHeight(appointment.duration);

  // Tiered layout based on real height — compact only affects font sizing
  const isTiny = height < 36;          // 30min slot
  const showService = height >= 50 && !!appointment.serviceName;
  const showTimeRange = height >= 60;
  // Multi-prof: pega TODOS os nomes via helper (cobre legado e novo schema).
  // Display: 1° nome + "+N" se houver mais — slot é estreito demais pra
  // listar todos sem truncar serviço/horário.
  const profNames = getAppointmentProfessionalNames(appointment);
  const showProfessional = height >= 84 && profNames.length > 0;
  const profDisplay = profNames.length === 0
    ? ''
    : profNames.length === 1
      ? profNames[0]
      : `${profNames[0]} +${profNames.length - 1}`;
  const showPrice = height >= 110 && appointment.price > 0;

  return (
    <Tooltip
      title={
        <div className="text-xs space-y-1 p-1">
          <div className="font-semibold">{displayName}</div>
          {appointment.serviceName && <div>{appointment.serviceName}</div>}
          <div>{appointment.startTime} - {appointment.endTime}</div>
          {profNames.length > 0 && <div>{profNames.join(', ')}</div>}
          <div>{getStatusLabel(appointment.status)}</div>
          {appointment.price > 0 && <div>{formatCurrency(appointment.price)}</div>}
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
        <div className={cn(
          'px-2 h-full flex flex-col min-w-0',
          isTiny ? 'py-0.5 justify-center' : 'py-1.5 justify-start gap-0.5',
        )}>
          <div className="flex items-start gap-1 min-w-0">
            <div
              className={cn(
                'font-semibold truncate leading-tight flex-1 min-w-0',
                compact ? 'text-[12px]' : 'text-[13px]',
              )}
              style={{ color }}
            >
              {displayName}
            </div>
            {appointment.reminderSentAt && !isTiny && (
              <Bell className="w-2.5 h-2.5 flex-shrink-0 opacity-70 mt-[3px]" style={{ color }} />
            )}
          </div>

          {isTiny ? (
            <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate leading-tight">
              {appointment.startTime}
              {appointment.serviceName ? ` · ${appointment.serviceName}` : ''}
            </div>
          ) : (
            <>
              {showService && (
                <div className="text-[10px] text-gray-600 dark:text-gray-400 truncate leading-tight">
                  {appointment.serviceName}
                </div>
              )}
              <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight truncate">
                {showTimeRange ? `${appointment.startTime} – ${appointment.endTime}` : appointment.startTime}
              </div>
              {showProfessional && (
                <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate leading-tight flex items-center gap-1"
                     title={profNames.join(', ')}>
                  <span className="opacity-70">·</span>
                  {profDisplay}
                </div>
              )}
              {showPrice && (
                <div className="text-[10px] font-medium truncate leading-tight mt-auto" style={{ color }}>
                  {formatCurrency(appointment.price)}
                </div>
              )}
            </>
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
  commissionRate?: number;
  // Campos fiscais (NFSe) — opcionais, vão pro doc do Service
  lc116Code?: string;
  codigoMunicipal?: string;
  nbs?: string;
  aliquotaISS?: number;
}

interface ServiceManagementDialogProps {
  open: boolean;
  onClose: () => void;
  services: Service[];
  members: User[];
  currentUser: User | null;
  isAdmin: boolean;
  onCreateService: (data: ServiceFormData) => Promise<void>;
  onUpdateService: (id: string, data: ServiceFormData) => Promise<void>;
  onDeleteService: (id: string) => Promise<void>;
}

function ServiceManagementDialog({
  open,
  onClose,
  services,
  members,
  currentUser,
  isAdmin,
  onCreateService,
  onUpdateService,
  onDeleteService,
}: ServiceManagementDialogProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<'list' | 'form'>('list');
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [filterUserId, setFilterUserId] = useState<string>('all');
  const [formData, setFormData] = useState<ServiceFormData>({
    name: '',
    description: '',
    duration: 60,
    price: 0,
    category: '',
    color: '#3B82F6',
    isActive: true,
    commissionRate: undefined,
    lc116Code: '',
    codigoMunicipal: '',
    nbs: '',
    aliquotaISS: undefined,
  });

  const canEditService = useCallback((service: Service) => {
    if (isAdmin) return true;
    if (!service.userId) return false; // global/legacy = so admin
    return service.userId === currentUser?.uid;
  }, [isAdmin, currentUser?.uid]);

  const filteredServices = useMemo(() => {
    if (filterUserId === 'all') return services;
    if (filterUserId === 'global') return services.filter((s) => !s.userId);
    return services.filter((s) => s.userId === filterUserId);
  }, [services, filterUserId]);

  const resetForm = useCallback(() => {
    setFormData({
      name: '',
      description: '',
      duration: 60,
      price: 0,
      category: '',
      color: '#3B82F6',
      isActive: true,
      commissionRate: undefined,
      lc116Code: '',
      codigoMunicipal: '',
      nbs: '',
      aliquotaISS: undefined,
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
      commissionRate: service.commissionRate,
      lc116Code: service.lc116Code || '',
      codigoMunicipal: service.codigoMunicipal || '',
      nbs: service.nbs || '',
      aliquotaISS: service.aliquotaISS,
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
          {view === 'list' ? t('agenda.manageServices', 'Gerenciar Serviços') : editingService ? t('agenda.editService', 'Editar Serviço') : t('agenda.newService', 'Novo Serviço')}
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
              {/* User filter bar */}
              {members.length > 1 && (
                <div className="flex items-center gap-1.5 mb-3 pb-3 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
                  <UserIcon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <button
                    onClick={() => setFilterUserId('all')}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-200 whitespace-nowrap flex-shrink-0',
                      filterUserId === 'all'
                        ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400'
                        : 'bg-white dark:bg-gray-800 border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:border-slate-300 dark:hover:border-gray-600',
                    )}
                  >
                    {t('agenda.all', 'Todos')}
                  </button>
                  {members.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setFilterUserId(filterUserId === m.id ? 'all' : m.id)}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-200 whitespace-nowrap flex-shrink-0',
                        filterUserId === m.id
                          ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400'
                          : 'bg-white dark:bg-gray-800 border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:border-slate-300 dark:hover:border-gray-600',
                      )}
                    >
                      {(m.name || '?').split(' ')[0]}
                    </button>
                  ))}
                </div>
              )}

              {filteredServices.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <Settings2 className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {filterUserId !== 'all' ? t('agenda.noServicesForUser', 'Nenhum serviço para este usuário') : t('agenda.noServicesRegistered', 'Nenhum serviço cadastrado')}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('agenda.createFirstService', 'Crie seu primeiro serviço para começar a agendar')}</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {filteredServices.map((service) => {
                    const editable = canEditService(service);
                    return (
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
                                {t('agenda.inactive', 'Inativo')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-500 dark:text-gray-400">{service.duration} min</span>
                            <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{formatCurrency(service.price)}</span>
                            {service.commissionRate != null && service.commissionRate > 0 && (
                              <>
                                <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                                  {service.commissionRate}%
                                </span>
                              </>
                            )}
                            {service.category && (
                              <>
                                <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                                <span className="text-xs text-gray-400 dark:text-gray-500">{service.category}</span>
                              </>
                            )}
                            {service.userName && (
                              <>
                                <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                  {service.userName.split(' ')[0]}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        {editable && (
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
                        )}
                      </motion.div>
                    );
                  })}
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
                  {t('agenda.serviceName', 'Nome do Serviço')} *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder={t('agenda.serviceNamePlaceholder', 'Ex: Corte Masculino')}
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
                  {t('agenda.description', 'Descrição')}
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder={t('agenda.descriptionPlaceholder', 'Descrição do serviço...')}
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
                    {t('agenda.duration', 'Duração')} *
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
                    {t('agenda.price', 'Preço (R$)')} *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formData.price ? maskMoney(formData.price) : ''}
                    onChange={(e) => setFormData((p) => ({ ...p, price: unmaskMoney(e.target.value) }))}
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

              {/* Category & Commission Rate */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    {t('agenda.category', 'Categoria')}
                  </label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData((p) => ({ ...p, category: e.target.value }))}
                    placeholder={t('agenda.categoryPlaceholder', 'Ex: Cabelo, Unhas...')}
                    className={cn(
                      'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                      'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                      'bg-white dark:bg-gray-800',
                      'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                      'transition-all duration-200',
                    )}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    {t('agenda.commissionRate', 'Comissão (%)')}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={formData.commissionRate ?? ''}
                    onChange={(e) => setFormData((p) => ({
                      ...p,
                      commissionRate: e.target.value === '' ? undefined : Math.min(100, Math.max(0, Number(e.target.value))),
                    }))}
                    placeholder="0"
                    className={cn(
                      'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                      'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                      'bg-white dark:bg-gray-800',
                      'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                      'transition-all duration-200',
                    )}
                  />
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                    {t('agenda.commissionRateHint', 'Substitui a taxa padrão do profissional')}
                  </p>
                </div>
              </div>

              {/* Color */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  <Palette className="w-3.5 h-3.5 inline mr-1" />
                  {t('agenda.color', 'Cor')}
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

              {/* Dados fiscais (NFSe) — colapsável, opcionais. Quando preenchidos,
                  EmitirNotaDialog auto-completa LC 116/codMunicipal/NBS/alíquota
                  ao importar este serviço, sem operador precisar redigitar. */}
              <details className="group rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/30">
                <summary className="cursor-pointer list-none px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.02] rounded-xl transition-colors">
                  <span>{t('agenda.serviceFiscalSection', 'Dados fiscais (NFSe — opcional)')}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400 transition-transform group-open:rotate-90" />
                </summary>
                <div className="px-4 pb-4 pt-2 space-y-3 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {t('agenda.serviceFiscalHint', 'Preenchidos aqui, os campos serão auto-completados ao emitir NFSe pra este serviço.')}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
                        {t('agenda.serviceLc116', 'Código LC 116')}
                      </label>
                      <input
                        type="text"
                        value={formData.lc116Code ?? ''}
                        onChange={(e) => setFormData((p) => ({ ...p, lc116Code: e.target.value }))}
                        placeholder="Ex: 01.07"
                        className={cn(
                          'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                          'text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400',
                          'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                        )}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
                        {t('agenda.serviceCodMunicipal', 'Código Municipal')}
                      </label>
                      <input
                        type="text"
                        value={formData.codigoMunicipal ?? ''}
                        onChange={(e) => setFormData((p) => ({ ...p, codigoMunicipal: e.target.value }))}
                        placeholder="Ex: 2919"
                        className={cn(
                          'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                          'text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400',
                          'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                        )}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
                        {t('agenda.serviceNbs', 'NBS (opcional)')}
                      </label>
                      <input
                        type="text"
                        value={formData.nbs ?? ''}
                        onChange={(e) => setFormData((p) => ({ ...p, nbs: e.target.value }))}
                        placeholder="Ex: 101010100"
                        className={cn(
                          'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                          'text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400',
                          'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                        )}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
                        {t('agenda.serviceAliquotaIss', 'Alíquota ISS (%)')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={formData.aliquotaISS ?? ''}
                        onChange={(e) => setFormData((p) => ({
                          ...p,
                          aliquotaISS: e.target.value === '' ? undefined : Math.min(100, Math.max(0, Number(e.target.value))),
                        }))}
                        placeholder={t('agenda.servicePadraoEmpresa', 'Padrão da empresa')}
                        className={cn(
                          'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                          'text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400',
                          'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                        )}
                      />
                    </div>
                  </div>
                </div>
              </details>

              {/* Active toggle */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('agenda.serviceActive', 'Serviço Ativo')}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t('agenda.serviceActiveDesc', 'Serviços inativos não aparecem na agenda')}</div>
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
            {t('agenda.newService', 'Novo Serviço')}
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
              {t('agenda.back', 'Voltar')}
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
              {saving ? t('agenda.saving', 'Salvando...') : editingService ? t('agenda.saveChanges', 'Salvar Alterações') : t('agenda.createService', 'Criar Serviço')}
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
  onDeleteSeries?: () => void;
  hasRecurrence?: boolean;
  loading: boolean;
  appointmentName?: string;
}

function DeleteConfirmDialog({ open, onClose, onCancel, onDelete, onDeleteSeries, hasRecurrence, loading, appointmentName }: DeleteConfirmDialogProps) {
  const { t } = useTranslation();
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
          {t('agenda.deleteAppointment', 'Excluir Agendamento')}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
          {appointmentName ? t('agenda.deleteConfirmNamed', `Deseja excluir o agendamento de ${appointmentName}?`, { name: appointmentName }) : t('agenda.deleteConfirm', 'Deseja excluir este agendamento?')}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
          {t('agenda.deleteOrCancelHint', 'Você pode cancelar o agendamento ou excluí-lo permanentemente.')}
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
            {t('agenda.cancelAppointmentKeepRecord', 'Cancelar Agendamento (manter registro)')}
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
            {loading ? t('agenda.deleting', 'Excluindo...') : t('agenda.deletePermanently', 'Excluir Permanentemente')}
          </button>
          {hasRecurrence && onDeleteSeries && (
            <button
              onClick={onDeleteSeries}
              disabled={loading}
              className={cn(
                'w-full px-4 py-2.5 rounded-xl text-sm font-semibold',
                'text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-500/15 hover:bg-red-200 dark:hover:bg-red-500/25',
                'border border-red-200 dark:border-red-500/30',
                'transition-all duration-200',
                'disabled:opacity-50',
              )}
            >
              {loading ? t('agenda.deleting', 'Excluindo...') : t('agenda.deleteSeries', 'Excluir Série Completa')}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={loading}
            className={cn(
              'w-full px-4 py-2.5 rounded-xl text-sm font-medium',
              'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
              'transition-all duration-200',
            )}
          >
            {t('agenda.back', 'Voltar')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// AppointmentFormDialog extraído pra AppointmentFormDialog.tsx — usado
// agora também pelas Conversas. Helpers/constants compartilhadas em
// ./shared. Re-import aqui mantém a API interna do AgendaModule intacta.
import { AppointmentFormDialog } from './AppointmentFormDialog';
import type { AppointmentFormData } from './AppointmentFormDialog';
import type { RecurrenceFrequency } from './shared';

// ---- View Appointment Dialog ----
interface ViewAppointmentDialogProps {
  open: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  canEdit: boolean;
  onEdit: () => void;
  onStatusChange: (status: AppointmentStatus) => void;
  onOpenConversation: () => void;
  statusChanging: boolean;
}

function ViewAppointmentDialog({
  open,
  onClose,
  appointment,
  canEdit,
  onEdit,
  onStatusChange,
  onOpenConversation,
  statusChanging,
}: ViewAppointmentDialogProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en-US' ? enUS : ptBR;
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
              {(appointment.clientName || '?').split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
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
                <div className="text-xs text-gray-500 dark:text-gray-400">{t('agenda.date', 'Data')}</div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {format(parseISO(appointment.date), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: dateLocale })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
              <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{t('agenda.time', 'Horário')}</div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {appointment.startTime} - {appointment.endTime} ({appointment.duration} min)
                </div>
              </div>
            </div>

            {appointment.clientPhone && (
              <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <Phone className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t('agenda.phone', 'Telefone')}</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{appointment.clientPhone}</div>
                </div>
              </div>
            )}

            {(() => {
              const profNames = getAppointmentProfessionalNames(appointment);
              if (profNames.length === 0) return null;
              return (
                <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                  <UserIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {profNames.length === 1
                        ? t('agenda.professional', 'Profissional')
                        : `${t('agenda.professionalPlural', 'Profissionais')} (${profNames.length})`}
                    </div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {profNames.join(', ')}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
              <DollarSign className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{t('agenda.value', 'Valor')}</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(appointment.price)}</div>
              </div>
            </div>

            {appointment.notes && (
              <div className="flex items-start gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <FileText className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{t('agenda.notes', 'Observações')}</div>
                  <div className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{appointment.notes}</div>
                </div>
              </div>
            )}

            {/* Reminder status row — only shown when at least one was sent */}
            {(appointment.reminderSentAt || appointment.confirmationRequestedAt || appointment.followUpSentAt) && (
              <div className="flex items-start gap-3 py-2.5 px-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-xl border border-emerald-100 dark:border-emerald-500/20">
                <Bell className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium mb-1">Lembretes enviados via WhatsApp</div>
                  <div className="flex flex-wrap gap-1.5">
                    {appointment.reminderSentAt && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                        <Check className="w-2.5 h-2.5" /> Lembrete
                      </span>
                    )}
                    {appointment.confirmationRequestedAt && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                        <Check className="w-2.5 h-2.5" /> Confirmação
                      </span>
                    )}
                    {appointment.followUpSentAt && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                        <Check className="w-2.5 h-2.5" /> Follow-up
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons — separados em 2 grupos:
              "ações sobre cliente" (Conversa, Editar) à esquerda, "ações de
              status" (Confirmar, Iniciar, Cancelar, Concluir, Não Compareceu)
              à direita. Divider só aparece quando há ações de status visíveis,
              caso contrário ficaria flutuando no fim do bloco. */}
          <div className="flex flex-wrap items-center gap-2 mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
            {/* Conversa — abre conv WA existente do cliente ou inicia uma nova.
                Fora do guard canEdit pois mandar mensagem não altera o
                appointment; mesmo um viewer pode/deve poder contatar o cliente. */}
            <button
              onClick={onOpenConversation}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold',
                'text-white bg-emerald-600 hover:bg-emerald-700 transition-colors',
                'shadow-sm shadow-emerald-500/20',
              )}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              {t('agenda.openConversation', 'Conversa')}
            </button>
            {canEdit && (
              <button
                onClick={onEdit}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                  'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors',
                )}
              >
                <Edit3 className="w-3.5 h-3.5" />
                {t('agenda.edit', 'Editar')}
              </button>
            )}

            {/* Divider entre grupos — só renderiza se houver botão de status
                à direita (status pré-conclusão + permissão de edição). */}
            {canEdit && (appointment.status === 'agendado' || appointment.status === 'confirmado' || appointment.status === 'em_andamento') && (
              <div className="hidden sm:block w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" aria-hidden="true" />
            )}

            {canEdit && appointment.status === 'agendado' && (
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
                {t('agenda.confirm', 'Confirmar')}
              </button>
            )}

            {canEdit && (appointment.status === 'agendado' || appointment.status === 'confirmado') && (
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
                {t('agenda.start', 'Iniciar')}
              </button>
            )}

            {canEdit && (appointment.status === 'agendado' || appointment.status === 'confirmado') && (
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
                {t('agenda.cancel', 'Cancelar')}
              </button>
            )}

            {canEdit && (appointment.status === 'confirmado' || appointment.status === 'em_andamento') && (
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
                {t('agenda.complete', 'Concluir')}
              </button>
            )}

            {canEdit && (appointment.status === 'agendado' || appointment.status === 'confirmado') && (
              <button
                onClick={() => onStatusChange('nao_compareceu')}
                disabled={statusChanging}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                  'text-gray-700 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors',
                  'disabled:opacity-50',
                )}
              >
                {t('agenda.noShow', 'Não Compareceu')}
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
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en-US' ? enUS : ptBR;
  const { user, business } = useAuth();
  const { setActivePage, setPendingOpenConversationId, setPendingNewConversation } = useAppContext();
  const queryClient = useQueryClient();

  const isAdmin = ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY['admin'];

  const canEditAppointment = useCallback((appt: Appointment) => {
    if (isAdmin) return true;
    // Multi-prof: operador pode editar se está em QUALQUER posição do array.
    // Sem prof atribuído = global, só admin.
    const ids = getAppointmentProfessionalIds(appt);
    if (ids.length === 0) return false;
    return !!user?.uid && ids.includes(user.uid);
  }, [isAdmin, user?.uid]);

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

  // Appointments — listener em tempo real (refactor sync multi-user):
  //
  // ANTES: useQuery + getDocs com staleTime 2min. Operador A criava/movia
  // agendamento, recepcionista B (outra aba) só via mudança após 2min ou
  // window focus — péssimo num ambiente onde a agenda é a fonte de verdade
  // pro fluxo do dia (cliente pergunta horário, B confirma um slot que A
  // já reservou há 30s).
  //
  // AGORA: onSnapshot. Mudanças propagam em tempo real pra todas as sessões.
  // services/clients continuam em useQuery — staleTime 5min cobre o uso
  // (services mudam raramente; clients aqui é dropdown lookup, não dado vivo).
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  useEffect(() => {
    if (!business?.id) { setAppointmentsLoading(false); return; }
    setAppointmentsLoading(true);
    const q = query(
      collection(db, 'appointments'),
      where('businessId', '==', business.id),
      orderBy('date', 'asc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setAppointments(snap.docs.map((d) => ({ ...d.data(), id: d.id } as Appointment)));
        setAppointmentsLoading(false);
      },
      (err) => {
        console.error('[Agenda] appointments snapshot error:', err);
        setAppointmentsLoading(false);
      },
    );
    return () => unsub();
  }, [business?.id]);

  // Fetch services
  const { data: services = [], isLoading: servicesLoading } = useQuery({
    queryKey: ['services', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      // Single-field — isActive + sort name client-side.
      const q = query(
        collection(db, 'services'),
        where('businessId', '==', business.id),
      );
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as Service))
        .filter(s => (s as { isActive?: boolean }).isActive !== false)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    },
    enabled: !!business?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch contacts (CRM)
  const { data: clients = [] } = useQuery({
    queryKey: ['clients', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      // Single-field — isActive + sort name aplicados client-side
      // (composite index clients/businessId+isActive+name evitado).
      const q = query(
        collection(db, 'clients'),
        where('businessId', '==', business.id),
      );
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as CRMContact))
        .filter(isActiveClient)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    },
    enabled: !!business?.id,
    staleTime: 5 * 60 * 1000,
  });

  const clientsMap = useMemo(
    () => Object.fromEntries(clients.map(c => [c.id, c.name])),
    [clients],
  );

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

  // Filter appointments by selected professional (multi-prof: aparece se
  // o profissional escolhido estiver em qualquer posição do array).
  const filteredAppointments = useMemo(() => {
    if (!appointments) return [];
    if (selectedProfessional === 'all') return appointments;
    return appointments.filter((a) => isAppointmentAssignedTo(a, selectedProfessional));
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

  // Conflict detection — delegado pra checkAppointmentConflict (função pura
  // em lib/services/appointmentConflicts.ts). Mesma lógica usada também
  // pelo ScheduleFromConversationDialog — evita drift entre os 2 fluxos.
  const checkConflicts = useCallback(
    (professionalId: string, date: string, startTime: string, endTime: string, excludeId?: string) =>
      checkAppointmentConflict({
        appointments: appointments ?? [],
        members,
        professionalId,
        date,
        startTime,
        endTime,
        excludeId,
        t: (key, fallback) => t(key, fallback),
      }),
    [appointments, members, t],
  );

  // ==========================================
  // SERVICE CRUD HANDLERS
  // ==========================================

  // Mapeia campos fiscais opcionais → object pra mesclar nos writes. Strings
  // vazias viram null (não-persistido); só vai pro Firestore o que o operador
  // realmente preencheu. Evita lixo no doc + facilita verificar `??` no leitor.
  const buildFiscalFields = useCallback((data: ServiceFormData) => ({
    lc116Code: data.lc116Code?.trim() || null,
    codigoMunicipal: data.codigoMunicipal?.trim() || null,
    nbs: data.nbs?.trim() || null,
    aliquotaISS: typeof data.aliquotaISS === 'number' && data.aliquotaISS >= 0 ? data.aliquotaISS : null,
  }), []);

  const handleCreateService = useCallback(async (data: ServiceFormData) => {
    if (!business?.id || !user) return;
    await addDoc(collection(db, 'services'), {
      businessId: business.id,
      userId: user.uid,
      userName: user.name,
      name: data.name,
      description: data.description || null,
      duration: data.duration,
      price: data.price,
      category: data.category || null,
      color: data.color,
      isActive: data.isActive,
      commissionRate: data.commissionRate ?? null,
      ...buildFiscalFields(data),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['services', business.id] });
    setSnackbar({ open: true, message: t('agenda.serviceCreated', 'Serviço criado com sucesso!'), severity: 'success' });
  }, [business?.id, user, queryClient, t, buildFiscalFields]);

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
      commissionRate: data.commissionRate ?? null,
      ...buildFiscalFields(data),
      updatedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['services', business.id] });
    setSnackbar({ open: true, message: t('agenda.serviceUpdated', 'Serviço atualizado com sucesso!'), severity: 'success' });
  }, [business?.id, queryClient, t, buildFiscalFields]);

  const handleDeleteService = useCallback(async (id: string) => {
    if (!business?.id) return;
    const now = new Date().toISOString();
    await updateDoc(doc(db, 'services', id), { isActive: false, deletedAt: now, updatedAt: now });
    queryClient.invalidateQueries({ queryKey: ['services', business.id] });
    setSnackbar({ open: true, message: t('agenda.serviceDeleted', 'Serviço excluído.'), severity: 'info' });
  }, [business?.id, queryClient, t]);

  // ==========================================
  // APPOINTMENT CRUD HANDLERS
  // ==========================================

  const handleSaveAppointment = useCallback(async (data: AppointmentFormData) => {
    if (!business?.id) return;
    setSaving(true);
    try {
      const endTime = addDurationToTime(data.startTime, data.duration);
      const serviceColor = services.find((s) => s.id === data.serviceId)?.color || data.color || '#3B82F6';

      // Hard conflict block — salva somente se não há conflito
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
            message: `${t('agenda.conflictBlocked', 'Conflito de horário')}: ${conflictResult.message}`,
            severity: 'error',
          });
          return; // Hard block — operador deve corrigir o horário antes de salvar
        }
      }

      // Soft warning for past appointments (does not block — allows retroactive registration)
      if (!editingAppointment) {
        const apptDateTime = new Date(`${data.date}T${data.startTime}`);
        if (!isNaN(apptDateTime.getTime()) && apptDateTime < new Date()) {
          setSnackbar({
            open: true,
            message: t('agenda.pastDateWarning', 'Atenção: este agendamento está no passado.'),
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
      // Profissionais: persiste o array novo (canonical) E o campo legado
      // (professionalId/Name = primeiro do array). APIs externas e queries
      // server-side antigas continuam funcionando com o legado.
      if (data.professionalId) payload.professionalId = data.professionalId;
      if (data.professionalName) payload.professionalName = data.professionalName;
      if (data.professionalIds && data.professionalIds.length > 0) {
        payload.professionalIds = data.professionalIds;
        payload.professionalNames = data.professionalNames;
      }
      if (data.notes) payload.notes = data.notes;

      if (editingAppointment) {
        await updateDoc(doc(db, 'appointments', editingAppointment.id), payload);

        // Sync Client metrics for the edit paths that affect "concluído" state/price/clientId.
        const wasDone = editingAppointment.status === 'concluido';
        const isDone = data.status === 'concluido';
        const oldClientId = editingAppointment.clientId || '';
        const newClientId = data.clientId || '';
        const oldPrice = editingAppointment.price || 0;
        const newPrice = data.price || 0;

        if (wasDone && isDone && oldClientId === newClientId) {
          // same client, same completion state — adjust only price diff
          if (newPrice !== oldPrice && newClientId) {
            await syncClientMetrics({ clientId: newClientId, visitDelta: 0, priceDelta: newPrice - oldPrice });
          }
        } else {
          if (wasDone && oldClientId) {
            await syncClientMetrics({ clientId: oldClientId, visitDelta: -1, priceDelta: -oldPrice });
          }
          if (isDone && newClientId) {
            await syncClientMetrics({ clientId: newClientId, visitDelta: 1, priceDelta: newPrice, lastVisitDate: data.date });
          }
        }

        // ── Loyalty points on edit (first time concluido) ────────────────
        if (!wasDone && isDone && newClientId) {
          const lc = business.settings?.loyalty;
          if (lc?.isEnabled && (data.price || 0) > 0) {
            const earned = calculateEarnedPoints(data.price || 0, lc);
            if (earned > 0) {
              addLoyaltyPoints(db, {
                businessId: business.id,
                clientId: newClientId,
                clientName: data.clientName || '',
                pointsEarned: earned,
                config: lc,
                sourceId: editingAppointment.id,
                sourceType: 'appointment',
                description: `Atendimento - ${data.serviceName || 'Serviço'}`,
              }).catch(err => console.warn('[Agenda] loyalty on edit failed:', err));
            }
          }
        }

        // ── Commission handling on edit ──────────────────────────────────
        if (!wasDone && isDone && data.professionalId) {
          const professional = members.find(m => m.id === data.professionalId);
          const service = services.find(s => s.id === data.serviceId);
          await maybeCreateCommission({
            appointment: { ...editingAppointment, ...payload, id: editingAppointment.id } as Appointment,
            professional,
            service,
            businessId: business.id,
          }).catch(err => console.warn('[Agenda] commission creation on edit failed:', err));
        } else if (wasDone && !isDone) {
          await maybeCancelCommission(editingAppointment.commissionTransactionId)
            .catch(err => console.warn('[Agenda] commission cancel on edit failed:', err));
        }

        // SDD Fase 4: emit domain event quando vira concluido (auditoria)
        if (!wasDone && isDone) {
          void emitAppointmentCompletedEvent({
            appointmentId: editingAppointment.id,
            clientId: data.clientId,
            professionalId: data.professionalId,
            serviceId: data.serviceId,
            amount: data.price || 0,
          });
        }

        setSnackbar({ open: true, message: t('agenda.appointmentUpdated', 'Agendamento atualizado com sucesso!'), severity: 'success' });
      } else {
        payload.businessId = business.id;
        payload.createdAt = new Date().toISOString();

        const freq: RecurrenceFrequency = data.recurrenceFrequency || 'none';
        const occurrences = freq === 'none' ? 1 : Math.max(2, Math.min(52, data.recurrenceOccurrences || 2));

        if (occurrences > 1) {
          // Recurring series — one shared recurrenceId links all instances.
          const recurrenceId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const dates = generateRecurrenceDates(data.date, freq, occurrences);

          // Validate ALL dates for conflicts before committing any — no partial series
          if (data.professionalId) {
            const conflictingDates: string[] = [];
            for (const d of dates) {
              const r = checkConflicts(data.professionalId, d, data.startTime, endTime);
              if (r.hasConflict) {
                conflictingDates.push(`${d} (${r.message})`);
              }
            }
            if (conflictingDates.length > 0) {
              const preview = conflictingDates.slice(0, 3).join('; ') + (conflictingDates.length > 3 ? ` +${conflictingDates.length - 3}…` : '');
              setSnackbar({
                open: true,
                message: `${t('agenda.recurrenceConflict', 'Conflito na série')}: ${preview}`,
                severity: 'error',
              });
              return; // Abort — zero docs written
            }
          }

          const batch = writeBatch(db);
          for (const d of dates) {
            const ref = doc(collection(db, 'appointments'));
            batch.set(ref, { ...payload, date: d, recurrenceId });
          }
          await batch.commit();
          if (data.status === 'concluido' && data.clientId) {
            // Backfill metrics for every occurrence created as 'concluído'.
            await syncClientMetrics({
              clientId: data.clientId,
              visitDelta: dates.length,
              priceDelta: (data.price || 0) * dates.length,
              lastVisitDate: dates[dates.length - 1],
            });
          }
          setSnackbar({
            open: true,
            message: t('agenda.seriesCreated', `Série criada com ${dates.length} agendamentos`, { count: dates.length }),
            severity: 'success',
          });
        } else {
          const newDocRef = await addDoc(collection(db, 'appointments'), payload);
          // SDD Fase 4: emit domain event se criado já concluido (auditoria)
          if (data.status === 'concluido') {
            void emitAppointmentCompletedEvent({
              appointmentId: newDocRef.id,
              clientId: data.clientId,
              professionalId: data.professionalId,
              serviceId: data.serviceId,
              amount: data.price || 0,
            });
          }
          if (data.status === 'concluido' && data.clientId) {
            await syncClientMetrics({
              clientId: data.clientId,
              visitDelta: 1,
              priceDelta: data.price || 0,
              lastVisitDate: data.date,
            });
            // Loyalty points accumulation on creation of completed appointment
            const lc = business.settings?.loyalty;
            if (lc?.isEnabled && (data.price || 0) > 0) {
              const earned = calculateEarnedPoints(data.price || 0, lc);
              if (earned > 0) {
                addLoyaltyPoints(db, {
                  businessId: business.id,
                  clientId: data.clientId,
                  clientName: data.clientName || '',
                  pointsEarned: earned,
                  config: lc,
                  sourceId: newDocRef.id,
                  sourceType: 'appointment',
                  description: `Atendimento - ${data.serviceName || 'Serviço'}`,
                }).catch(err => console.warn('[Agenda] loyalty on create failed:', err));
              }
            }
          }
          // Google Calendar sync (fire-and-forget)
          syncToGoogleCalendar('create', {
            id: newDocRef.id,
            title: `${data.serviceName || 'Agendamento'} — ${data.clientName}`,
            description: data.notes,
            date: data.date,
            startTime: data.startTime,
            endTime,
          }).then(eventId => {
            if (eventId) {
              updateDoc(doc(db, 'appointments', newDocRef.id), { googleCalendarEventId: eventId }).catch(() => {});
            }
          });

          setSnackbar({ open: true, message: t('agenda.appointmentCreated', 'Agendamento criado com sucesso!'), severity: 'success' });
        }
      }

      // Google Calendar sync for updates
      if (editingAppointment) {
        syncToGoogleCalendar('update', {
          id: editingAppointment.id,
          title: `${data.serviceName || 'Agendamento'} — ${data.clientName}`,
          description: data.notes,
          date: data.date,
          startTime: data.startTime,
          endTime,
          googleCalendarEventId: editingAppointment.googleCalendarEventId,
        }).catch(() => {});
      }

      // Notifica profissionais — só os NOVOS (diff em relação ao estado
      // anterior). Em create, todos são novos. Em edit, ignora quem já
      // estava atribuído pra não spammar. Operador removido NÃO recebe
      // (sem notificação de "você foi tirado", evita ruído).
      // Fire-and-forget: falha de notificação não trava o save.
      try {
        const newIds = data.professionalIds && data.professionalIds.length > 0
          ? data.professionalIds
          : data.professionalId ? [data.professionalId] : [];
        const oldIds = editingAppointment
          ? getAppointmentProfessionalIds(editingAppointment)
          : [];
        const addedIds = newIds.filter(id => !oldIds.includes(id));
        if (addedIds.length > 0 && user) {
          // Date display formatado pra "DD/MM" curto no body da notificação.
          const dateLabel = data.date.split('-').reverse().slice(0, 2).join('/');
          void notifyUsers(db, addedIds, {
            businessId: business.id,
            type: 'appointment_assigned',
            title: editingAppointment
              ? `Agendamento atualizado — você foi atribuído`
              : `Novo agendamento atribuído a você`,
            body: `${data.clientName} · ${dateLabel} às ${data.startTime}${data.serviceName ? ` · ${data.serviceName}` : ''}`,
            relatedId: editingAppointment?.id ?? undefined,
            actorId: user.uid,
            actorName: user.name,
          }).catch(err => console.warn('[Agenda] notify professionals failed:', err));
        }
      } catch (notifyErr) {
        console.warn('[Agenda] notify professionals threw:', notifyErr);
      }

      queryClient.invalidateQueries({ queryKey: ['appointments', business.id] });
      queryClient.invalidateQueries({ queryKey: ['clients', business.id] });
      setShowFormDialog(false);
      setEditingAppointment(null);
    } catch (err) {
      console.error('Error saving appointment:', err);
      setSnackbar({ open: true, message: t('agenda.errorSavingAppointment', 'Erro ao salvar agendamento.'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [business?.id, editingAppointment, services, queryClient, checkConflicts, t, members, user]);

  const handleDeleteAppointment = useCallback(async () => {
    if (!editingAppointment || !business?.id) return;
    setDeleteLoading(true);
    try {
      await deleteDoc(doc(db, 'appointments', editingAppointment.id));
      // Google Calendar sync — remove event
      if (editingAppointment.googleCalendarEventId) {
        syncToGoogleCalendar('delete', {
          id: editingAppointment.id,
          title: '',
          date: editingAppointment.date,
          startTime: editingAppointment.startTime,
          endTime: editingAppointment.endTime,
          googleCalendarEventId: editingAppointment.googleCalendarEventId,
        }).catch(() => {});
      }
      if (editingAppointment.status === 'concluido' && editingAppointment.clientId) {
        await syncClientMetrics({
          clientId: editingAppointment.clientId,
          visitDelta: -1,
          priceDelta: -(editingAppointment.price || 0),
        });
      }
      // Cancel commission if appointment was concluido — prevents orphaned pending transactions
      if (editingAppointment.status === 'concluido') {
        await maybeCancelCommission(editingAppointment.commissionTransactionId)
          .catch(err => console.warn('[Agenda] commission cancel on delete:', err));
        queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
      }
      queryClient.invalidateQueries({ queryKey: ['appointments', business.id] });
      queryClient.invalidateQueries({ queryKey: ['clients', business.id] });
      setShowDeleteDialog(false);
      setShowFormDialog(false);
      setEditingAppointment(null);
      setSnackbar({ open: true, message: t('agenda.appointmentDeleted', 'Agendamento excluído.'), severity: 'info' });
    } catch (err) {
      console.error('Error deleting appointment:', err);
      setSnackbar({ open: true, message: t('agenda.errorDeletingAppointment', 'Erro ao excluir agendamento.'), severity: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  }, [editingAppointment, business?.id, queryClient, t]);

  const handleDeleteSeries = useCallback(async () => {
    if (!editingAppointment?.recurrenceId || !business?.id) return;
    setDeleteLoading(true);
    try {
      // Filtra a série em memória (appointments já carregados via onSnapshot
      // single-field). Evita composite index appointments/businessId+recurrenceId.
      const seriesItems = appointments.filter(
        a => a.recurrenceId === editingAppointment.recurrenceId,
      );

      // Aggregate client metric deltas from any 'concluido' items in the series.
      const clientDeltas = new Map<string, { visits: number; price: number }>();
      const commissionIds: (string | undefined)[] = [];
      const batch = writeBatch(db);
      for (const a of seriesItems) {
        if (a.status === 'concluido') {
          if (a.clientId) {
            const d = clientDeltas.get(a.clientId) || { visits: 0, price: 0 };
            d.visits += 1;
            d.price += a.price || 0;
            clientDeltas.set(a.clientId, d);
          }
          // Collect commission IDs to cancel after batch delete
          if (a.commissionTransactionId) commissionIds.push(a.commissionTransactionId);
        }
        batch.delete(doc(db, 'appointments', a.id));
      }
      await batch.commit();

      await Promise.all([
        ...Array.from(clientDeltas.entries()).map(([clientId, d]) =>
          syncClientMetrics({ clientId, visitDelta: -d.visits, priceDelta: -d.price }),
        ),
        ...commissionIds.map(cid =>
          maybeCancelCommission(cid).catch(err => console.warn('[Agenda] series commission cancel:', err))
        ),
      ]);
      if (commissionIds.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
      }

      queryClient.invalidateQueries({ queryKey: ['appointments', business.id] });
      queryClient.invalidateQueries({ queryKey: ['clients', business.id] });
      setShowDeleteDialog(false);
      setShowFormDialog(false);
      setEditingAppointment(null);
      setSnackbar({
        open: true,
        message: t('agenda.seriesDeleted', `Série excluída (${seriesItems.length} agendamentos)`, { count: seriesItems.length }),
        severity: 'info',
      });
    } catch (err) {
      console.error('Error deleting series:', err);
      setSnackbar({ open: true, message: t('agenda.errorDeletingSeries', 'Erro ao excluir série.'), severity: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  }, [editingAppointment, business?.id, queryClient, t, appointments]);

  const handleCancelAppointment = useCallback(async () => {
    if (!editingAppointment || !business?.id) return;
    setDeleteLoading(true);
    try {
      await updateDoc(doc(db, 'appointments', editingAppointment.id), {
        status: 'cancelado',
        updatedAt: new Date().toISOString(),
      });
      if (editingAppointment.status === 'concluido' && editingAppointment.clientId) {
        await syncClientMetrics({
          clientId: editingAppointment.clientId,
          visitDelta: -1,
          priceDelta: -(editingAppointment.price || 0),
        });
      }
      // Cancel commission if appointment was concluido — prevents orphaned pending transactions
      if (editingAppointment.status === 'concluido') {
        await maybeCancelCommission(editingAppointment.commissionTransactionId)
          .catch(err => console.warn('[Agenda] commission cancel on cancel:', err));
        queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
      }
      queryClient.invalidateQueries({ queryKey: ['appointments', business.id] });
      queryClient.invalidateQueries({ queryKey: ['clients', business.id] });
      setShowDeleteDialog(false);
      setShowFormDialog(false);
      setEditingAppointment(null);
      setSnackbar({ open: true, message: t('agenda.appointmentCancelled', 'Agendamento cancelado.'), severity: 'info' });
    } catch (err) {
      console.error('Error cancelling appointment:', err);
      setSnackbar({ open: true, message: t('agenda.errorCancellingAppointment', 'Erro ao cancelar agendamento.'), severity: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  }, [editingAppointment, business?.id, queryClient, t]);

  const handleStatusChange = useCallback(async (status: AppointmentStatus) => {
    if (!selectedAppointment || !business?.id) return;
    setStatusChanging(true);
    try {
      await updateDoc(doc(db, 'appointments', selectedAppointment.id), {
        status,
        updatedAt: new Date().toISOString(),
      });

      // Auto-notify customer if agent enabled (appointment notifications always on when agent is on)
      if (business.settings?.aiAgent?.enabled) {
        void (async () => {
          try {
            const { getAuth } = await import('firebase/auth');
            const token = await getAuth().currentUser?.getIdToken();
            if (!token) return;
            await fetch('/api/conversations/status-notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ businessId: business.id, kind: 'appointment', id: selectedAppointment.id, newStatus: status }),
            });
          } catch (err) {
            console.warn('[Agenda] status-notify failed:', err);
          }
        })();
      }
      const prevStatus = selectedAppointment.status;
      const clientId = selectedAppointment.clientId;
      const wasDone = prevStatus === 'concluido';
      const isDone = status === 'concluido';

      if (clientId) {
        if (!wasDone && isDone) {
          await syncClientMetrics({
            clientId,
            visitDelta: 1,
            priceDelta: selectedAppointment.price || 0,
            lastVisitDate: selectedAppointment.date,
          });
        } else if (wasDone && !isDone) {
          await syncClientMetrics({
            clientId,
            visitDelta: -1,
            priceDelta: -(selectedAppointment.price || 0),
          });
        }
      }

      // ── Automatic commission handling ────────────────────────────────────
      if (!wasDone && isDone && selectedAppointment.professionalId) {
        const professional = members.find(m => m.id === selectedAppointment.professionalId);
        const service = services.find(s => s.id === selectedAppointment.serviceId);
        const commissionTxId = await maybeCreateCommission({
          appointment: selectedAppointment,
          professional,
          service,
          businessId: business.id,
        }).catch(err => { console.warn('[Agenda] commission creation failed:', err); return null; });
        if (commissionTxId) {
          setSelectedAppointment(prev => prev ? { ...prev, status, commissionTransactionId: commissionTxId } : null);
          queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
        } else {
          setSelectedAppointment(prev => prev ? { ...prev, status } : null);
        }
      } else if (wasDone && !isDone) {
        await maybeCancelCommission(selectedAppointment.commissionTransactionId)
          .catch(err => console.warn('[Agenda] commission cancellation failed:', err));
        setSelectedAppointment(prev => prev ? { ...prev, status } : null);
        queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
      } else {
        setSelectedAppointment(prev => prev ? { ...prev, status } : null);
      }

      queryClient.invalidateQueries({ queryKey: ['appointments', business.id] });
      queryClient.invalidateQueries({ queryKey: ['clients', business.id] });
      setSnackbar({
        open: true,
        message: t('agenda.statusChanged', `Status alterado para "${getStatusLabel(status)}"`, { status: getStatusLabel(status) }),
        severity: 'success',
      });
    } catch (err) {
      console.error('Error changing status:', err);
      setSnackbar({ open: true, message: t('agenda.errorChangingStatus', 'Erro ao alterar status.'), severity: 'error' });
    } finally {
      setStatusChanging(false);
    }
  }, [selectedAppointment, business?.id, queryClient, t, members, services]);

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
        return i18n.language === 'en-US'
          ? format(currentDate, 'EEEE, MMMM dd', { locale: dateLocale })
          : format(currentDate, "EEEE, dd 'de' MMMM", { locale: dateLocale });
      case 'week': {
        const wStart = weekStart;
        const wEnd = weekEnd;
        if (isSameMonth(wStart, wEnd)) {
          return i18n.language === 'en-US'
            ? `${format(wStart, 'MMM dd', { locale: dateLocale })} - ${format(wEnd, 'dd, yyyy', { locale: dateLocale })}`
            : `${format(wStart, 'dd', { locale: dateLocale })} - ${format(wEnd, "dd 'de' MMMM yyyy", { locale: dateLocale })}`;
        }
        return i18n.language === 'en-US'
          ? `${format(wStart, 'MMM dd', { locale: dateLocale })} - ${format(wEnd, 'MMM dd, yyyy', { locale: dateLocale })}`
          : `${format(wStart, "dd 'de' MMM", { locale: dateLocale })} - ${format(wEnd, "dd 'de' MMM yyyy", { locale: dateLocale })}`;
      }
      case 'month':
        return i18n.language === 'en-US'
          ? format(currentDate, 'MMMM yyyy', { locale: dateLocale })
          : format(currentDate, "MMMM 'de' yyyy", { locale: dateLocale });
    }
  }, [viewMode, currentDate, weekStart, weekEnd, dateLocale, i18n.language]);

  // ---- Appointment Actions ----
  const handleAppointmentClick = useCallback((appt: Appointment) => {
    setSelectedAppointment(appt);
    setShowViewDialog(true);
  }, []);

  const handleNewAppointment = useCallback((date?: string, time?: string) => {
    setEditingAppointment(null);
    const initial: Partial<AppointmentFormData> = {
      date: date || format(currentDate, 'yyyy-MM-dd'),
      startTime: time || '09:00',
    };
    // Auto-populate profissional para usuarios nao-admin (operador cria
    // só pra ele mesmo). Popula tanto o legado quanto o array novo pra
    // que o form multi-select já mostre o operador como pré-selecionado.
    if (!isAdmin && user) {
      initial.professionalId = user.uid;
      initial.professionalName = user.name;
      initial.professionalIds = [user.uid];
      initial.professionalNames = [user.name];
    }
    setFormInitialData(initial);
    setShowFormDialog(true);
  }, [currentDate, isAdmin, user]);

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
      // Hidrata multi: prefere arrays novos; cai pro legado se ausente.
      // AppointmentFormDialog faz a mesma fusão internamente — passamos ambos
      // pra forma consistente.
      professionalIds: selectedAppointment.professionalIds && selectedAppointment.professionalIds.length > 0
        ? [...selectedAppointment.professionalIds]
        : selectedAppointment.professionalId ? [selectedAppointment.professionalId] : [],
      professionalNames: selectedAppointment.professionalNames && selectedAppointment.professionalNames.length > 0
        ? [...selectedAppointment.professionalNames]
        : selectedAppointment.professionalName ? [selectedAppointment.professionalName] : [],
      notes: selectedAppointment.notes || '',
      status: selectedAppointment.status,
      price: selectedAppointment.price,
      color: selectedAppointment.color || '#3B82F6',
    });
    setShowFormDialog(true);
  }, [selectedAppointment]);

  // Abre a conversa do cliente do agendamento OU inicia uma nova via WhatsApp.
  // Espelha o padrão usado em CRMModule.tsx (LeadDetailPanel.onOpenConversations)
  // e ChannelsTab.handleCardClick — busca conv WA por crmContactId === clientId
  // e cai pra NewConversationDialog se não houver conv prévia.
  const handleOpenConversation = useCallback(async () => {
    if (!selectedAppointment || !business?.id) return;
    const appt = selectedAppointment;
    // Defensivo: appointment legado/corrompido sem clientId vincula a
    // ninguém. Sem isso, query bate em where('crmContactId','=='') (0
    // resultados) e cai pro NewConversation com clientId vazio, deixando
    // o dialog destino confuso. Falha cedo com toast claro.
    if (!appt.clientId) {
      toast.error('Agendamento sem cliente vinculado — edite o agendamento e selecione um cliente.');
      return;
    }
    setShowViewDialog(false);
    setSelectedAppointment(null);

    try {
      const snap = await getDocs(query(
        collection(db, 'conversations'),
        where('businessId', '==', business.id),
        where('crmContactId', '==', appt.clientId),
        firestoreLimit(20),
      ));
      const waDocs = snap.docs
        .filter(d => d.data().channel === 'whatsapp')
        .sort((a, b) => {
          const ta = (a.data().lastMessageAt as string | undefined) ?? '';
          const tb = (b.data().lastMessageAt as string | undefined) ?? '';
          return tb.localeCompare(ta);
        });
      if (waDocs.length > 0) {
        setPendingOpenConversationId(waDocs[0].id);
        setActivePage('Conversas');
        return;
      }
      // Sem conv prévia — abre NewConversationDialog pré-preenchido. Modo
      // padrão: Baileys (sem janela 24h) se disponível, senão Cloud.
      const ch = business.channels as (NonNullable<typeof business>['channels'] & {
        whatsappCloud?: { isConnected?: boolean; accessToken?: string };
        whatsappBaileys?: { isConnected?: boolean };
        whatsapp?: { isConnected?: boolean; connectedVia?: string; accessToken?: string };
      }) | undefined;
      const cloudOk = !!(ch?.whatsappCloud?.isConnected && ch.whatsappCloud.accessToken)
        || (!ch?.whatsappCloud && !!ch?.whatsapp?.isConnected && ch.whatsapp.connectedVia !== 'baileys' && !!ch.whatsapp.accessToken);
      const baileysOk = !!ch?.whatsappBaileys?.isConnected
        || (!ch?.whatsappBaileys && !!ch?.whatsapp?.isConnected && ch.whatsapp.connectedVia === 'baileys');
      if (!cloudOk && !baileysOk) {
        toast.error('Nenhum canal WhatsApp configurado. Conecte em Configurações.');
        return;
      }
      setPendingNewConversation({
        clientId: appt.clientId,
        channel: 'whatsapp',
        whatsappMode: baileysOk ? 'baileys' : 'cloud',
      });
      setActivePage('Conversas');
    } catch (err) {
      console.error('[Agenda] open conversation lookup failed:', err);
      setActivePage('Conversas');
    }
  }, [selectedAppointment, business, setActivePage, setPendingOpenConversationId, setPendingNewConversation]);

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
              {format(currentDate, 'EEEE', { locale: dateLocale })}
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
                  clientsMap={clientsMap}
                />
              ))}

              {/* Empty state */}
              {dayAppointments.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
                  <div className="text-center">
                    <CalendarIcon className="w-10 h-10 mx-auto text-gray-200 dark:text-gray-700 mb-2" />
                    <p className="text-sm text-gray-400 dark:text-gray-500">{t('agenda.noAppointmentsThisDay', 'Nenhum agendamento neste dia')}</p>
                    <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">{t('agenda.clickSlotToSchedule', 'Clique em um horário para agendar')}</p>
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
          const weekdayLabels = i18n.language === 'en-US' ? WEEKDAY_LABELS_EN : WEEKDAY_LABELS_PT;
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
                {weekdayLabels[i]}
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
                  {dayAppointmentsCount} {t('agenda.apptAbbr', 'agend.')}
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
                    clientsMap={clientsMap}
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
        {(i18n.language === 'en-US' ? WEEKDAY_LABELS_EN : WEEKDAY_LABELS_PT).map((label, i) => (
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
                      {(appt.clientName || '?').split(' ')[0]}
                    </motion.div>
                  ))}
                  {overflow > 0 && (
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium text-center py-0.5">
                      +{overflow} {t('agenda.more', 'mais')}
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
              title={t('agenda.previous', 'Anterior')}
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
              {t('agenda.today', 'Hoje')}
            </button>
            <button
              onClick={navigateNext}
              className="p-2 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all duration-200 hover:shadow-sm"
              title={t('agenda.next', 'Próximo')}
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
              { mode: 'day' as ViewMode, icon: CalendarDays, label: t('agenda.day', 'Dia') },
              { mode: 'week' as ViewMode, icon: Columns3, label: t('agenda.week', 'Semana') },
              { mode: 'month' as ViewMode, icon: LayoutGrid, label: t('agenda.month', 'Mês') },
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
            <span className="hidden sm:inline">{t('agenda.services', 'Serviços')}</span>
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
            <span className="hidden sm:inline">{t('agenda.newAppointment', 'Novo Agendamento')}</span>
            <span className="sm:hidden">{t('agenda.new', 'Novo')}</span>
          </button>
        </div>
      </div>

      {/* ========== STATUS SUMMARY ========== */}
      <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2 bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
        <span className="text-xs text-gray-400 dark:text-gray-500 mr-1 whitespace-nowrap">
          {visibleAppointments.length} {visibleAppointments.length !== 1 ? t('agenda.appointments', 'agendamentos') : t('agenda.appointment', 'agendamento')}
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
            {statusSummary[s.value]} {t(`agenda.status_${s.value}`, s.label)}
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
            {t('agenda.all', 'Todos')}
          </button>
          {members.map((member) => {
            const initials = (member.name || '?')
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
                <span className="hidden sm:inline">{(member.name || '?').split(' ')[0]}</span>
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
        canEdit={selectedAppointment ? canEditAppointment(selectedAppointment) : false}
        onEdit={handleEditAppointment}
        onStatusChange={handleStatusChange}
        onOpenConversation={handleOpenConversation}
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
        members={members}
        currentUser={user}
        isAdmin={isAdmin}
        onCreateService={handleCreateService}
        onUpdateService={handleUpdateService}
        onDeleteService={handleDeleteService}
      />

      <DeleteConfirmDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onCancel={handleCancelAppointment}
        onDelete={handleDeleteAppointment}
        onDeleteSeries={editingAppointment?.recurrenceId ? handleDeleteSeries : undefined}
        hasRecurrence={!!editingAppointment?.recurrenceId}
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
