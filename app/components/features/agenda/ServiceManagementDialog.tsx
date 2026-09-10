'use client';

/**
 * app/components/features/agenda/ServiceManagementDialog.tsx
 *
 * Extraido de AgendaModule.tsx (M02, retomada 10/09/2026) — mesmo padrao ja
 * usado com sucesso em AppointmentFormDialog/ScheduleBlocksDialog/
 * FormTemplatesDialog: corte de bloco inteiro, sem mudanca de comportamento.
 * ServiceFormData exportado daqui e reimportado de volta no AgendaModule
 * (usado por buildFiscalFields/buildGroupFields/handleCreateService/
 * handleUpdateService no componente principal).
 */

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
  CalendarOff,
  Search,
  ChevronDown,
  Settings2,
  Palette,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Bell,
  MessageCircle,
  Copy,
  Receipt,
  FileCheck2,
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
import type { Appointment, AppointmentStatus, Service, CRMContact, User, WeeklySession, FormTemplate } from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';
import { syncToGoogleCalendar } from '@/lib/services/calendarSync';
import { checkAppointmentConflict } from '@/lib/services/appointmentConflicts';
import { createAppointmentSafe, updateAppointmentSafe, AppointmentConflictError, SessionFullError } from '@/lib/services/appointmentTxGuard';
import { buildGroupSlots, resolveGroupBooking, type GroupSlot } from '@/lib/services/groupSession';
import { isGroupService } from '@/lib/contracts/domain/service';
import { canTransitionAppointment } from '@/lib/contracts/fsm/appointment';
import { collection, query, where, orderBy, getDocs, getDoc, addDoc, updateDoc, deleteDoc, doc, onSnapshot, increment, writeBatch, limit as firestoreLimit } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { softDeleteDoc } from '@/lib/services/softDelete';
import { isActiveRecord } from '@/lib/utils/recordFilters';
import { useAppContext } from '@/app/app/AppContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { NfseServicoCombobox } from '@/app/components/features/fiscal/NfseServicoCombobox';
import { DURATION_OPTIONS } from './shared';

const SERVICE_COLOR_PALETTE = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F97316',
  '#06B6D4', '#84CC16', '#F59E0B', '#10B981',
  '#EF4444', '#6366F1', '#14B8A6', '#A855F7',
  '#E11D48', '#0EA5E9', '#D97706', '#059669',
];

interface ServiceFormData {
  name: string;
  description: string;
  duration: number;
  price: number;
  category: string;
  color: string;
  isActive: boolean;
  commissionRate?: number;
  // Turma/aula em grupo — opcionais (ausentes = agendamento exclusivo BIT-A-BIT).
  capacity?: number;
  sessions?: WeeklySession[];
  // Campos fiscais (NFSe) — opcionais, vão pro doc do Service
  lc116Code?: string;
  codigoMunicipal?: string;
  nbs?: string;
  aliquotaISS?: number;
  // M06.4a: ficha de anamnese/intake solicitada ao agendar este serviço.
  // Ausente = serviço não pede formulário (comportamento atual, BIT-A-BIT).
  formTemplateId?: string;
}

const WEEKDAY_SHORT: readonly string[] = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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

export default function ServiceManagementDialog({
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
    capacity: undefined,
    sessions: undefined,
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

  // M06.4a: templates ativos pro seletor de ficha de anamnese. Fetch local
  // (não recebido via prop) — mesmo padrão self-contained de ScheduleBlocksDialog.
  const [formTemplates, setFormTemplates] = useState<FormTemplate[]>([]);
  useEffect(() => {
    const businessId = currentUser?.businessId;
    if (!open || !businessId) return;
    const q = query(collection(db, 'formTemplates'), where('businessId', '==', businessId));
    const unsub = onSnapshot(q, (snap) => {
      setFormTemplates(snap.docs.map((d) => ({ ...d.data(), id: d.id } as FormTemplate)).filter((f) => f.isActive));
    });
    return () => unsub();
  }, [open, currentUser?.businessId]);

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
      capacity: undefined,
      sessions: undefined,
      lc116Code: '',
      codigoMunicipal: '',
      nbs: '',
      aliquotaISS: undefined,
      formTemplateId: undefined,
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
      capacity: service.capacity,
      sessions: service.sessions ? service.sessions.map((s) => ({ ...s })) : undefined,
      lc116Code: service.lc116Code || '',
      codigoMunicipal: service.codigoMunicipal || '',
      nbs: service.nbs || '',
      aliquotaISS: service.aliquotaISS,
      formTemplateId: service.formTemplateId,
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

  // ── Turma/aula em grupo — estado local do editor de grade ──
  const isGroup = typeof formData.capacity === 'number' && formData.capacity > 1;
  const [draftWeekdays, setDraftWeekdays] = useState<number[]>([]);
  const [draftTime, setDraftTime] = useState<string>('19:00');
  const sessions = formData.sessions ?? [];

  const setBookingType = useCallback((group: boolean) => {
    setFormData((p) => group
      ? { ...p, capacity: p.capacity && p.capacity > 1 ? p.capacity : 10 }
      : { ...p, capacity: undefined, sessions: undefined });
    if (!group) setDraftWeekdays([]);
  }, []);

  const toggleDraftWeekday = useCallback((wd: number) => {
    setDraftWeekdays((prev) => prev.includes(wd) ? prev.filter((d) => d !== wd) : [...prev, wd].sort((a, b) => a - b));
  }, []);

  const addSessionsForDraft = useCallback(() => {
    if (draftWeekdays.length === 0 || !/^\d{2}:\d{2}$/.test(draftTime)) return;
    setFormData((p) => {
      const existing = p.sessions ?? [];
      const toAdd: WeeklySession[] = draftWeekdays
        .filter((wd) => !existing.some((s) => s.weekday === wd && s.startTime === draftTime))
        .map((wd) => ({ weekday: wd, startTime: draftTime }));
      if (toAdd.length === 0) return p;
      const next = [...existing, ...toAdd].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
      return { ...p, sessions: next };
    });
  }, [draftWeekdays, draftTime]);

  const copyTimeToDraftDays = useCallback((sourceTime: string) => {
    if (draftWeekdays.length === 0 || !/^\d{2}:\d{2}$/.test(sourceTime)) return;
    setFormData((p) => {
      const existing = p.sessions ?? [];
      const toAdd: WeeklySession[] = draftWeekdays
        .filter((wd) => !existing.some((s) => s.weekday === wd && s.startTime === sourceTime))
        .map((wd) => ({ weekday: wd, startTime: sourceTime }));
      if (toAdd.length === 0) return p;
      const next = [...existing, ...toAdd].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
      return { ...p, sessions: next };
    });
  }, [draftWeekdays]);

  const removeSession = useCallback((index: number) => {
    setFormData((p) => {
      const existing = p.sessions ?? [];
      const next = existing.filter((_, i) => i !== index);
      return { ...p, sessions: next.length > 0 ? next : undefined };
    });
  }, []);

  const updateSession = useCallback((index: number, patch: Partial<WeeklySession>) => {
    setFormData((p) => {
      const existing = p.sessions ?? [];
      const next = existing.map((s, i) => i === index ? { ...s, ...patch } : s);
      return { ...p, sessions: next };
    });
  }, []);

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

              {/* Tipo de agendamento — exclusivo x turma/grupo */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                  <UsersIcon className="w-3.5 h-3.5 inline mr-1" />
                  {t('agenda.bookingType', 'Tipo de agendamento')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBookingType(false)}
                    className={cn(
                      'flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all duration-200',
                      !isGroup
                        ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                    )}
                  >
                    <span className={cn('text-xs font-semibold', !isGroup ? 'text-red-700 dark:text-red-400' : 'text-gray-800 dark:text-gray-200')}>
                      {t('agenda.bookingExclusive', 'Exclusivo')}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                      {t('agenda.bookingExclusiveDesc', '1 cliente por horário')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBookingType(true)}
                    className={cn(
                      'flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl border-2 text-left transition-all duration-200',
                      isGroup
                        ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                    )}
                  >
                    <span className={cn('text-xs font-semibold', isGroup ? 'text-red-700 dark:text-red-400' : 'text-gray-800 dark:text-gray-200')}>
                      {t('agenda.bookingGroup', 'Turma / aula em grupo')}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                      {t('agenda.bookingGroupDesc', 'Vários alunos por horário')}
                    </span>
                  </button>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {isGroup && (
                  <motion.div
                    key="group-config"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/30 p-4">
                      {/* Capacidade */}
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                          {t('agenda.capacity', 'Capacidade (vagas por horário)')} *
                        </label>
                        <input
                          type="number"
                          min={2}
                          step={1}
                          value={formData.capacity ?? ''}
                          onChange={(e) => {
                            const n = Math.max(2, Math.floor(Number(e.target.value) || 0));
                            setFormData((p) => ({ ...p, capacity: Number.isFinite(n) && n >= 2 ? n : 2 }));
                          }}
                          placeholder="10"
                          className={cn(
                            'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                            'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                            'bg-white dark:bg-gray-800',
                            'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                            'transition-all duration-200',
                          )}
                        />
                      </div>

                      {/* Grade semanal */}
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                          <CalendarDays className="w-3.5 h-3.5 inline mr-1" />
                          {t('agenda.weeklySchedule', 'Grade semanal')}
                        </label>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-2">
                          {t('agenda.weeklyScheduleHint', 'Selecione os dias, escolha o horário e adicione. Sem grade, a turma usa o horário de funcionamento.')}
                        </p>

                        {/* Chips de dias */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {WEEKDAY_SHORT.map((label, wd) => {
                            const sel = draftWeekdays.includes(wd);
                            return (
                              <button
                                key={wd}
                                type="button"
                                onClick={() => toggleDraftWeekday(wd)}
                                className={cn(
                                  'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200',
                                  sel
                                    ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400'
                                    : 'bg-white dark:bg-gray-800 border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:border-slate-300 dark:hover:border-gray-600',
                                )}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Horário + adicionar */}
                        <div className="flex items-end gap-2">
                          <div className="flex-1">
                            <label className="block text-[10px] font-medium text-gray-400 dark:text-gray-500 mb-1">
                              {t('agenda.startTime', 'Horário')}
                            </label>
                            <input
                              type="time"
                              value={draftTime}
                              onChange={(e) => setDraftTime(e.target.value)}
                              className={cn(
                                'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                                'text-sm text-gray-900 dark:text-gray-100',
                                'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                              )}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={addSessionsForDraft}
                            disabled={draftWeekdays.length === 0}
                            className={cn(
                              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold',
                              'bg-red-600 text-white hover:bg-red-700 transition-all duration-200',
                              'disabled:opacity-40 disabled:cursor-not-allowed',
                            )}
                          >
                            <Plus className="w-4 h-4" />
                            {t('agenda.addSessions', 'Adicionar')}
                          </button>
                        </div>

                        {/* Lista de sessões */}
                        {sessions.length > 0 && (
                          <div className="mt-3 space-y-1.5">
                            {sessions.map((s, idx) => (
                              <motion.div
                                key={`${s.weekday}-${s.startTime}-${idx}`}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                              >
                                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 w-9">
                                  {WEEKDAY_SHORT[s.weekday] ?? '?'}
                                </span>
                                <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                                  {s.startTime}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => copyTimeToDraftDays(s.startTime)}
                                  disabled={draftWeekdays.length === 0}
                                  title={t('agenda.copyTimeToDays', 'Copiar este horário para os dias marcados')}
                                  className={cn(
                                    'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium',
                                    'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors',
                                    'disabled:opacity-40 disabled:cursor-not-allowed',
                                  )}
                                >
                                  <Copy className="w-3 h-3" />
                                  {t('agenda.copy', 'Copiar')}
                                </button>
                                <select
                                  value={s.professionalId ?? ''}
                                  onChange={(e) => {
                                    const pid = e.target.value;
                                    const member = members.find((m) => m.id === pid);
                                    updateSession(idx, { professionalId: pid || undefined, professionalName: member?.name || undefined });
                                  }}
                                  className={cn(
                                    'ml-auto px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                                    'text-[11px] text-gray-700 dark:text-gray-200 max-w-[140px]',
                                    'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                                  )}
                                >
                                  <option value="">{t('agenda.anyProfessional', 'Qualquer profissional')}</option>
                                  {members.map((m) => (
                                    <option key={m.id} value={m.id}>{(m.name || '?').split(' ')[0]}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => removeSession(idx)}
                                  className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
                                </button>
                              </motion.div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

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
                  {/* Combobox unificado de LC 116 + código municipal SP —
                      mesmo componente usado no EmitirNotaDialog. Operador
                      pesquisa por código/descrição/SP e auto-preenche os 2
                      campos. Quando o serviço é selecionado na emissão de
                      NFSe, esses campos auto-completam a nota. */}
                  <NfseServicoCombobox
                    lc116Value={formData.lc116Code ?? ''}
                    spCodeValue={formData.codigoMunicipal ?? ''}
                    onChange={(lc116, sp) => setFormData((p) => ({
                      ...p,
                      lc116Code: lc116,
                      codigoMunicipal: sp,
                    }))}
                  />
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

              {/* M06.4a: ficha de anamnese/intake — opcional. Quando definida,
                  a Agenda oferece "Enviar ficha" nos atendimentos deste serviço. */}
              <div>
                <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">
                  {t('agenda.serviceFormTemplate', 'Ficha de anamnese (opcional)')}
                </label>
                <select
                  value={formData.formTemplateId ?? ''}
                  onChange={(e) => setFormData((p) => ({ ...p, formTemplateId: e.target.value || undefined }))}
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                    'text-xs text-gray-900 dark:text-gray-100',
                    'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  )}
                >
                  <option value="">{t('agenda.serviceFormTemplateNone', 'Nenhuma — não solicita ficha')}</option>
                  {formTemplates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                  ))}
                </select>
                {formTemplates.length === 0 && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                    {t('agenda.serviceFormTemplateEmpty', 'Nenhuma ficha criada ainda — use o botão "Formulários" na Agenda pra criar uma.')}
                  </p>
                )}
              </div>

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

export type { ServiceFormData };
