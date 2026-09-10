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

// Hardening da Agenda (go-live odontologia): appointment.completed/canceled
// são a ÚNICA fonte dos efeitos de conclusão (métricas, comissão, fidelidade,
// baixa de insumo) — handler real em
// lib/contracts/_runtime/handlers/appointmentCompleted.ts e appointmentCanceled.ts.
// Chamadas AGUARDADAS (não fire-and-forget): o toast de sucesso só aparece
// depois que o servidor confirma os efeitos, mesma UX que já existia quando
// comissão era aguardada inline. Falha de rede é engolida (log apenas) pra
// não travar o save por causa só do dispatch do evento — o appointment em si
// já foi salvo antes desta chamada.
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
    console.warn('[Agenda] emit appointment.completed falhou:', err);
  }
}

// Reverte os efeitos de appointment.completed (comissão + métricas) quando um
// agendamento sai de 'concluido'. Handler real: appointmentCanceled.ts.
async function emitAppointmentCanceledEvent(args: {
  appointmentId: string;
  reason?: string;
}): Promise<void> {
  try {
    const { getAuth } = await import('firebase/auth');
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) return;
    await fetch('/api/events/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        type: 'appointment.canceled',
        occurredAt: new Date().toISOString(),
        appointmentId: args.appointmentId,
        reason: args.reason,
      }),
    });
  } catch (err) {
    console.warn('[Agenda] emit appointment.canceled falhou:', err);
  }
}

// P2.8: dispatch de domain event quando uma AULA EXPERIMENTAL (isTrial) é
// concluída. Sinaliza o funil de aquisição pro CRM/agent (outcome converteu →
// avançar lifecycleStage). Fire-and-forget; auditoria em domainEvents/{id}.
async function emitAppointmentTrialCompletedEvent(args: {
  appointmentId: string;
  clientId?: string;
  serviceId?: string;
  outcome: 'converteu' | 'nao_converteu' | 'pendente';
}): Promise<void> {
  try {
    const { getAuth } = await import('firebase/auth');
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) return;
    await fetch('/api/events/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        type: 'appointment.trialCompleted',
        occurredAt: new Date().toISOString(),
        appointmentId: args.appointmentId,
        clientId: args.clientId,
        serviceId: args.serviceId,
        outcome: args.outcome,
      }),
    });
  } catch (err) {
    console.warn('[Agenda] emit appointment.trialCompleted falhou:', err);
  }
}

/**
 * M06.2: transição de status via rota server-side única
 * (PATCH /api/appointments/[id]/transition) — FSM validada e efeitos de
 * conclusão/reversão aplicados na MESMA chamada, eliminando a janela de dois
 * passos separados (updateDoc + emitAppointment*Event) que existia antes.
 * Usada por handleStatusChange/handleCancelAppointment/handleDeleteAppointment/
 * handleDeleteSeries. `handleSaveAppointment` (edição via formulário) segue
 * usando emitAppointmentCompletedEvent/emitAppointmentCanceledEvent
 * diretamente — fora do escopo desta fatia.
 */
async function transitionAppointmentViaApi(
  appointmentId: string,
  businessId: string,
  status: AppointmentStatus,
): Promise<{ status: AppointmentStatus; dispatched: boolean }> {
  const { getAuth } = await import('firebase/auth');
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Sessão expirada — faça login novamente.');
  const res = await fetch(`/api/appointments/${appointmentId}/transition`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ businessId, status }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || 'Não foi possível alterar o agendamento.');
  }
  return body.data;
}

// ==========================================
// CONSTANTS
// ==========================================

const WEEKDAY_LABELS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
const WEEKDAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// STATUS_OPTIONS, DURATION_OPTIONS, TIME_OPTIONS, addDurationToTime, o type
// RecurrenceFrequency, a grade de horários (HOUR_HEIGHT/START_HOUR/etc) e as
// cores de status vivem em ./shared agora — usados tanto aqui quanto pelo
// AppointmentFormDialog e AgendaViewParts extraídos (M02, 10/09/2026).
import {
  STATUS_OPTIONS,
  DURATION_OPTIONS,
  TIME_OPTIONS,
  addDurationToTime,
  HOUR_HEIGHT,
  HALF_HOUR_HEIGHT,
  START_HOUR,
  END_HOUR,
  TOTAL_HOURS,
  STATUS_COLORS,
  STATUS_BG_COLORS,
} from './shared';
// CurrentTimeLine/MiniCalendar/AppointmentBlock/DeleteConfirmDialog/
// AgendaSkeleton extraídos pra arquivo próprio (M02, 10/09/2026) — mesmo
// padrão do AppointmentFormDialog abaixo.
import {
  CurrentTimeLine,
  MiniCalendar,
  AppointmentBlock,
  DeleteConfirmDialog,
  AgendaSkeleton,
} from './AgendaViewParts';

// SERVICE_COLOR_PALETTE movido pra ServiceManagementDialog.tsx (M02,
// 10/09/2026) — só era usado ali, não pelo componente principal.

type ViewMode = 'day' | 'week' | 'month';

// ==========================================
// HELPER FUNCTIONS
// ==========================================
// timeToMinutes/minutesToTime/addDurationToTime/TIME_OPTIONS importados de
// ./shared. getAppointmentTop/getAppointmentHeight/getCurrentTimeOffset
// moveram pra AgendaViewParts.tsx (só eram usados por CurrentTimeLine/
// AppointmentBlock, confirmado por grep antes de mover).

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

// ==========================================
// SUB-COMPONENTS
// ==========================================
// CurrentTimeLine/MiniCalendar/AppointmentBlock movidos pra AgendaViewParts.tsx
// (M02, 10/09/2026) — reimportados no topo deste arquivo.

// ServiceManagementDialog (+ ServiceFormData) movido pra arquivo proprio
// (M02, 10/09/2026) - reimportado no topo deste arquivo.

// DeleteConfirmDialog movido pra AgendaViewParts.tsx (M02, 10/09/2026).

// AppointmentFormDialog extraído pra AppointmentFormDialog.tsx — usado
// agora também pelas Conversas. Helpers/constants compartilhadas em
// ./shared. Re-import aqui mantém a API interna do AgendaModule intacta.
import { AppointmentFormDialog } from './AppointmentFormDialog';
import type { AppointmentFormData } from './AppointmentFormDialog';
import ScheduleBlocksDialog from './ScheduleBlocksDialog';
import FormTemplatesDialog from './FormTemplatesDialog';
import ServiceManagementDialog from './ServiceManagementDialog';
import type { ServiceFormData } from './ServiceManagementDialog';
import EmitirNotaDialog from '@/app/components/features/fiscal/EmitirNotaDialog';
import { buildAppointmentNfseInput } from '@/lib/services/fiscal/appointmentNfse';
import { buildAppointmentBillingPrefill } from '@/lib/services/agenda/appointmentBilling';
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
  onEmitNfse: () => void;
  onBillAppointment: () => void;
  formTemplateId?: string;
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
  onEmitNfse,
  onBillAppointment,
  formTemplateId,
  statusChanging,
}: ViewAppointmentDialogProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'en-US' ? enUS : ptBR;

  // M06.4a: idempotência visual do botão "Enviar ficha" — precisa rodar
  // antes do early-return abaixo (regra dos hooks: appointment pode ser
  // null em algum render, mas os hooks têm que ser chamados sempre).
  const [formSubmitted, setFormSubmitted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open || !appointment || !formTemplateId) {
      setFormSubmitted(null);
      return;
    }
    let cancelled = false;
    const q = query(
      collection(db, 'formResponses'),
      where('businessId', '==', appointment.businessId),
      where('appointmentId', '==', appointment.id),
    );
    getDocs(q).then((snap) => {
      if (!cancelled) setFormSubmitted(!snap.empty);
    });
    return () => {
      cancelled = true;
    };
  }, [open, appointment?.id, appointment?.businessId, formTemplateId]);

  // M06.6: status fiscal AO VIVO, não o Appointment.fiscalStatus (gravado uma
  // única vez na emissão e nunca mais atualizado — pode ficar sempre "emitida"
  // mesmo que a nota tenha sido rejeitada depois de reconsultada, ou
  // cancelada). Busca pontual no fiscalDocuments quando o dialog abre, mesmo
  // padrão de idempotência visual dos outros badges desta tela.
  const [fiscalLiveStatus, setFiscalLiveStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !appointment?.fiscalDocumentId) {
      setFiscalLiveStatus(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, 'fiscalDocuments', appointment.fiscalDocumentId)).then((snap) => {
      if (!cancelled) setFiscalLiveStatus((snap.data()?.status as string | undefined) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, appointment?.fiscalDocumentId]);

  if (!appointment) return null;

  const color = STATUS_COLORS[appointment.status];

  const handleSendForm = () => {
    if (!formTemplateId || typeof window === 'undefined') return;
    const origin = window.location.origin;
    const link = `${origin}/forms/${formTemplateId}?clientId=${appointment.clientId}&clientName=${encodeURIComponent(appointment.clientName)}&appointmentId=${appointment.id}`;
    const message = `Olá ${appointment.clientName}! Por favor preencha sua ficha antes da consulta: ${link}`;
    const digitsOnly = appointment.clientPhone?.replace(/\D/g, '');
    if (digitsOnly) {
      window.open(`https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`, '_blank');
    } else {
      navigator.clipboard.writeText(link);
      toast.info(t('agenda.formLinkCopied', 'Telefone não cadastrado — link da ficha copiado.'));
    }
  };

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

            {/* NFSe (M06.6): status AO VIVO do fiscalDocuments vinculado, não
                a presença crua de fiscalDocumentId — Appointment.fiscalStatus
                nunca é atualizado depois da emissão inicial (campo morto pra
                leitura), então uma nota rejeitada/cancelada DEPOIS continuava
                mostrando "emitida" pra sempre. rejeitada/erro/cancelada são
                terminais no FSM fiscal (reemissão cria um documento NOVO via
                /api/fiscal/emit, não um "retry" do mesmo) — por isso o botão
                "Emitir NFSe" reaparece nesses casos, ao lado do status real.
                M04: pendente/contingencia (SEFAZ indisponível na emissão,
                agora vinculada à origem — ver AGENDA_M06_6_COBRANCA_FISCAL.md)
                é um 3º estado: NÃO é "emitida" (badge enganosa) e NÃO deve
                reabilitar "Emitir NFSe" (reemitir criaria uma SEGUNDA nota
                quando a SEFAZ voltasse) — reenvio é feito no módulo Fiscal
                ("Reenviar para SEFAZ"), não aqui. */}
            {appointment.status === 'concluido' && (() => {
              const isFiscalTerminalFailure = appointment.fiscalDocumentId
                && ['rejeitada', 'erro', 'cancelada'].includes(fiscalLiveStatus ?? '');
              const isFiscalPending = appointment.fiscalDocumentId
                && ['pendente', 'contingencia'].includes(fiscalLiveStatus ?? '');
              const isFiscalActive = appointment.fiscalDocumentId && !isFiscalTerminalFailure && !isFiscalPending;
              return (
                <>
                  {isFiscalActive && (
                    <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10">
                      <FileCheck2 className="w-3.5 h-3.5" />
                      {fiscalLiveStatus && fiscalLiveStatus !== 'autorizada'
                        ? getStatusLabel(fiscalLiveStatus)
                        : t('agenda.nfseEmitted', 'NFSe emitida')}
                    </span>
                  )}
                  {isFiscalPending && (
                    <span
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10"
                      title={t('agenda.nfsePendingHint', 'Reenvie pelo módulo Fiscal quando a SEFAZ voltar — não emita de novo aqui.')}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      {getStatusLabel(fiscalLiveStatus ?? '')}
                    </span>
                  )}
                  {isFiscalTerminalFailure && (
                    <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {getStatusLabel(fiscalLiveStatus ?? '')}
                    </span>
                  )}
                  {(!appointment.fiscalDocumentId || isFiscalTerminalFailure) && canEdit && (
                    <button
                      onClick={onEmitNfse}
                      className={cn(
                        'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                        'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors',
                      )}
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      {t('agenda.emitNfse', 'Emitir NFSe')}
                    </button>
                  )}
                </>
              );
            })()}

            {/* Cobrança: lançada → badge (idempotência visual); senão,
                concluído OU não-compareceu (M06.3b: taxa de no-show, mesmo
                fluxo manual — ver appointmentBilling.ts) → botão. Criação
                real da transação vive no FinancialModule (sessionStorage +
                setActivePage, mesmo mecanismo de pendingOrderPrefill de
                Conversas → Pedidos) — não reimplementada aqui. NFSe (acima)
                continua só concluído — taxa de no-show não é nota fiscal de
                serviço prestado. */}
            {(appointment.status === 'concluido' || appointment.status === 'nao_compareceu') && (
              (appointment.billingTransactionId || appointment.billingInstallmentGroupId) ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10">
                  <DollarSign className="w-3.5 h-3.5" />
                  {t('agenda.billingLaunched', 'Cobrança lançada')}
                </span>
              ) : canEdit && (
                <button
                  onClick={onBillAppointment}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                    'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors',
                  )}
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  {t('agenda.billAppointment', 'Cobrar')}
                </button>
              )
            )}

            {/* Ficha de anamnese (M06.4a): preenchida → badge (idempotência
                visual via query em formResponses no useEffect acima); senão,
                serviço com formTemplateId e atendimento não cancelado →
                botão. Envio é manual via wa.me (decisão do usuário) — não
                reimplementa o cron de lembretes. */}
            {formTemplateId && appointment.status !== 'cancelado' && (
              formSubmitted ? (
                <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10">
                  <FileCheck2 className="w-3.5 h-3.5" />
                  {t('agenda.formSubmitted', 'Ficha preenchida')}
                </span>
              ) : canEdit && (
                <button
                  onClick={handleSendForm}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                    'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors',
                  )}
                >
                  <FileText className="w-3.5 h-3.5" />
                  {t('agenda.sendForm', 'Enviar ficha')}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// AgendaSkeleton movido pra AgendaViewParts.tsx (M02, 10/09/2026).

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
  // M06.3a: bloqueio de agenda é decisão sobre a disponibilidade de outra
  // pessoa — mesmo nível de permissão de NFSe/NFCe (manager+), não operador.
  const canManageScheduleBlocks = ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY['manager'];
  const [showScheduleBlocksDialog, setShowScheduleBlocksDialog] = useState(false);
  const [showFormTemplatesDialog, setShowFormTemplatesDialog] = useState(false);

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
  // Atendimento em emissão de NFSe — quando setado, abre o EmitirNotaDialog
  // pré-preenchido. Null = fechado. Espelha nfceOrder do OrdersModule.
  const [nfseAppointment, setNfseAppointment] = useState<Appointment | null>(null);
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
    // M06.8: janela de datas — antes carregava o histórico INTEIRO do tenant
    // (sem where/limit de data), crescendo pra sempre com o tempo. Janela
    // generosa (6 meses pra trás, 1 ano pra frente) cobre qualquer uso
    // realista de uma clínica pequena/média sem virar custo de leitura
    // ilimitado. Limitação aceita: a janela é calculada uma vez no mount
    // (não "desliza" sozinha se a aba ficar aberta por meses sem reload) —
    // suficiente pra sessão de trabalho normal, não resolve o caso extremo
    // de uma aba nunca recarregada. Histórico mais antigo que isso não
    // aparece aqui — quem precisar dele usa Relatórios ou a Timeline do
    // cliente (queries próprias, sem essa janela).
    const now = new Date();
    const minDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const q = query(
      collection(db, 'appointments'),
      where('businessId', '==', business.id),
      where('date', '>=', minDate),
      where('date', '<=', maxDate),
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
        .filter(isActiveRecord)
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

  // Turmas (academia): slots da grade semanal do serviço numa data, com vagas
  // calculadas sobre os appointments carregados. includeFull=true pra exibir a
  // turma cheia desabilitada no dialog. Reusa o MESMO núcleo (buildGroupSlots)
  // do agente — zero lógica de disponibilidade duplicada.
  const getGroupSlots = useCallback(
    (serviceId: string, date: string): GroupSlot[] => {
      const service = services.find((s) => s.id === serviceId);
      if (!service || !isGroupService(service.capacity) || !service.sessions?.length) return [];
      const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
      return buildGroupSlots(service, date, dayOfWeek, undefined, appointments ?? [], true);
    },
    [services, appointments],
  );

  // Vagas ocupadas por turma (sessionKey → count de não-cancelados). Alimenta o
  // badge "N/cap" nos cards de calendário sem recomputar por card.
  const sessionSeatsMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of appointments ?? []) {
      if (a.sessionKey && a.status !== 'cancelado') {
        m[a.sessionKey] = (m[a.sessionKey] ?? 0) + 1;
      }
    }
    return m;
  }, [appointments]);

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

  // Turma: só persiste capacity/sessions quando o serviço é de grupo
  // (capacity>1). Caso contrário escreve null/[] — preserva agendamento
  // exclusivo BIT-A-BIT (effectiveServiceCapacity trata ausente/1 como exclusivo).
  const buildGroupFields = useCallback((data: ServiceFormData) => {
    const isGroup = typeof data.capacity === 'number' && data.capacity > 1;
    if (!isGroup) {
      return { capacity: null, sessions: null };
    }
    const sessions = (data.sessions ?? [])
      .filter((s) => typeof s.weekday === 'number' && /^\d{2}:\d{2}$/.test(s.startTime))
      .map((s) => ({
        weekday: s.weekday,
        startTime: s.startTime,
        duration: typeof s.duration === 'number' && s.duration > 0 ? s.duration : null,
        capacity: typeof s.capacity === 'number' && s.capacity > 0 ? s.capacity : null,
        professionalId: s.professionalId || null,
        professionalName: s.professionalId ? (s.professionalName || null) : null,
      }));
    return {
      capacity: data.capacity,
      sessions: sessions.length > 0 ? sessions : null,
    };
  }, []);

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
      ...buildGroupFields(data),
      ...buildFiscalFields(data),
      // M06.4a: ficha de anamnese solicitada ao agendar este serviço.
      formTemplateId: data.formTemplateId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['services', business.id] });
    setSnackbar({ open: true, message: t('agenda.serviceCreated', 'Serviço criado com sucesso!'), severity: 'success' });
  }, [business?.id, user, queryClient, t, buildFiscalFields, buildGroupFields]);

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
      ...buildGroupFields(data),
      ...buildFiscalFields(data),
      formTemplateId: data.formTemplateId || null,
      updatedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['services', business.id] });
    setSnackbar({ open: true, message: t('agenda.serviceUpdated', 'Serviço atualizado com sucesso!'), severity: 'success' });
  }, [business?.id, queryClient, t, buildFiscalFields, buildGroupFields]);

  const handleDeleteService = useCallback(async (id: string) => {
    if (!business?.id || !user?.uid) return;
    // Soft-delete via helper canonico. Deploy C concluido: nao escreve mais
    // isActive=false (API publica e pickers ja usam isActiveRecord).
    await softDeleteDoc(
      doc(db, 'services', id),
      { uid: user.uid, name: user.name || user.uid },
    );
    queryClient.invalidateQueries({ queryKey: ['services', business.id] });
    setSnackbar({ open: true, message: t('agenda.serviceDeleted', 'Serviço excluído.'), severity: 'info' });
  }, [business?.id, user?.uid, user?.name, queryClient, t]);

  // ==========================================
  // APPOINTMENT CRUD HANDLERS
  // ==========================================

  const handleSaveAppointment = useCallback(async (data: AppointmentFormData) => {
    if (!business?.id) return;
    setSaving(true);
    try {
      const endTime = addDurationToTime(data.startTime, data.duration);
      const service = services.find((s) => s.id === data.serviceId);
      const serviceColor = service?.color || data.color || '#3B82F6';

      // ── Turma (academia) ────────────────────────────────────────────────
      // capacity>1 = turma: o aluno é UM appointment compartilhando o sessionKey
      // canônico. O guard conta vagas e ignora colegas (mesmo sessionKey) no
      // check de conflito — então pulamos o hard-block legado abaixo (que veria
      // colega como conflito) e a recorrência (a grade já é a repetição).
      const isGroup = service ? isGroupService(service.capacity) : false;
      // FONTE ÚNICA (mesma do agente em tools/agenda): resolve sessionKey +
      // capacity efetiva (respeita WeeklySession.capacity) + profissional. Sem
      // isso, manual e agente montavam keys/capacidades diferentes e a turma
      // estourava.
      const groupBooking = isGroup && service
        ? resolveGroupBooking(service, data.date, data.startTime, data.professionalId || undefined)
        : null;
      const groupCapacity = groupBooking?.capacity ?? 1;
      const sessionKey = groupBooking?.sessionKey;

      // Hard conflict block — exclusivo apenas. Turma é validada no guard via
      // sessionKey+capacity (colegas dividem o horário legitimamente).
      if (!isGroup && data.professionalId) {
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

      // FSM: o diálogo de edição deixa o status como <select> livre — sem este
      // guard, dava pra abrir um agendamento 'agendado' e marcar 'concluido'
      // direto, pulando confirmado/em_andamento (mesmo risco de comissão/
      // fidelidade indevida que handleStatusChange já bloqueia há mais tempo).
      if (editingAppointment && editingAppointment.status !== data.status
        && !canTransitionAppointment(editingAppointment.status, data.status)) {
        setSnackbar({
          open: true,
          message: t(
            'agenda.invalidTransition',
            `Não é possível ir de "${getStatusLabel(editingAppointment.status)}" para "${getStatusLabel(data.status)}". Confirme ou inicie o atendimento antes de concluir.`,
          ),
          severity: 'warning',
        });
        return;
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
      // P2.8: aula experimental — flag + outcome (funil de aquisição).
      if (data.isTrial) {
        payload.isTrial = true;
        payload.trialOutcome = data.trialOutcome ?? 'pendente';
      }
      // Turma: grava a chave da sessão + snapshot da capacidade (mesma forma do
      // agente). Isso liga o appointment à turma pra contagem de vagas e pro
      // tx guard ignorar colegas no check de conflito.
      if (isGroup && sessionKey) {
        payload.sessionKey = sessionKey;
        payload.isGroupSession = true;
        payload.capacitySnapshot = groupCapacity;
      }

      if (editingAppointment) {
        // Re-check atomico via tx — fecha race window de ~100-200ms onde
        // 2 operadores editando o mesmo prof+dia podiam ambos salvar com
        // overlap. Tx Firestore reexecuta com optimistic locking; o
        // "perdedor" ve o doc novo do outro e detecta o conflito.
        await updateAppointmentSafe(
          db,
          editingAppointment.id,
          {
            businessId: business.id,
            professionalId: data.professionalId,
            date: data.date,
            startTime: data.startTime,
            endTime,
            ...(isGroup ? { sessionKey, capacity: groupCapacity } : {}),
            ...payload,
          },
          members,
          // Passa snapshot anterior pra que mudanca de prof/data bumpe
          // ambos os locks (origem + destino) — senao operadores na origem
          // continuariam vendo slot "ocupado" pelo apt movido.
          { professionalId: editingAppointment.professionalId, date: editingAppointment.date },
          (key, fallback) => t(key, fallback),
        );

        const wasDone = editingAppointment.status === 'concluido';
        const isDone = data.status === 'concluido';
        const oldClientId = editingAppointment.clientId || '';
        const newClientId = data.clientId || '';
        const oldPrice = editingAppointment.price || 0;
        const newPrice = data.price || 0;

        // Correção de preço num agendamento JÁ concluído (status não mudou —
        // FSM não se aplica aqui). Único ajuste que continua direto: não cria
        // Transaction/loyaltyTransaction nova, só corrige o cache totalSpent.
        if (wasDone && isDone && oldClientId === newClientId && newClientId && newPrice !== oldPrice) {
          await updateDoc(doc(db, 'clients', newClientId), {
            totalSpent: increment(newPrice - oldPrice),
            updatedAt: new Date().toISOString(),
          }).catch(err => console.warn('[Agenda] ajuste de totalSpent na edição falhou:', err));
        }

        // ── Efeitos de conclusão/reversão — fonte única server-side ──────────
        // (métricas, comissão, fidelidade, baixa de insumo — ver
        // lib/contracts/_runtime/handlers/appointmentCompleted.ts / appointmentCanceled.ts)
        if (!wasDone && isDone) {
          await emitAppointmentCompletedEvent({
            appointmentId: editingAppointment.id,
            clientId: data.clientId,
            professionalId: data.professionalId,
            serviceId: data.serviceId,
            amount: data.price || 0,
          });
        } else if (wasDone && !isDone) {
          await emitAppointmentCanceledEvent({ appointmentId: editingAppointment.id });
        }

        // P2.8: aula experimental concluída → sinaliza conversão pro CRM/agent.
        // Sem outcome explícito ainda → 'pendente' (operador decide depois).
        if (!wasDone && isDone && data.isTrial) {
          void emitAppointmentTrialCompletedEvent({
            appointmentId: editingAppointment.id,
            clientId: data.clientId,
            serviceId: data.serviceId,
            outcome: data.trialOutcome ?? 'pendente',
          });
        }

        setSnackbar({ open: true, message: t('agenda.appointmentUpdated', 'Agendamento atualizado com sucesso!'), severity: 'success' });
      } else {
        payload.businessId = business.id;
        payload.createdAt = new Date().toISOString();

        const freq: RecurrenceFrequency = data.recurrenceFrequency || 'none';
        // Turma nunca cria série recorrente: a grade semanal do serviço já é a
        // repetição; cada reserva é UM aluno entrando numa sessão específica.
        const occurrences = isGroup
          ? 1
          : (freq === 'none' ? 1 : Math.max(2, Math.min(52, data.recurrenceOccurrences || 2)));

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
          const seriesRefs: Array<ReturnType<typeof doc>> = [];
          for (const d of dates) {
            const ref = doc(collection(db, 'appointments'));
            seriesRefs.push(ref);
            batch.set(ref, { ...payload, date: d, recurrenceId });
          }
          await batch.commit();
          // Cada ocorrência criada já 'concluido' dispara seus PRÓPRIOS efeitos
          // (métricas, comissão, fidelidade, baixa de insumo) via evento
          // individual — o handler server-side relê o doc de cada uma.
          // Sequencial (não Promise.all): garante que lastVisit do cliente
          // termine na data da ÚLTIMA ocorrência da série, não numa aleatória.
          if (data.status === 'concluido') {
            for (let i = 0; i < seriesRefs.length; i++) {
              await emitAppointmentCompletedEvent({
                appointmentId: seriesRefs[i].id,
                clientId: data.clientId,
                professionalId: data.professionalId,
                serviceId: data.serviceId,
                amount: data.price || 0,
              }).catch(err => console.warn(`[Agenda] emit appointment.completed falhou (ocorrência ${i}):`, err));
            }
          }
          setSnackbar({
            open: true,
            message: t('agenda.seriesCreated', `Série criada com ${dates.length} agendamentos`, { count: dates.length }),
            severity: 'success',
          });
        } else {
          // Re-check atomico via tx (single create). Veja updateAppointmentSafe
          // pra contexto da race window. Recurrence (acima) mantem o batch
          // pre-validado — tx n cobre N writes sem perda de performance.
          const newDocId = await createAppointmentSafe(
            db,
            {
              businessId: business.id,
              professionalId: data.professionalId,
              date: data.date,
              startTime: data.startTime,
              endTime,
              ...(isGroup ? { sessionKey, capacity: groupCapacity } : {}),
              ...payload,
            },
            members,
            (key, fallback) => t(key, fallback),
          );
          const newDocRef = doc(db, 'appointments', newDocId);
          // Efeitos de conclusão (métricas, comissão, fidelidade, baixa de
          // insumo) quando criado já 'concluido' — mesma fonte única server-side
          // do caminho de edição/mudança de status (ver appointmentCompleted.ts).
          if (data.status === 'concluido') {
            await emitAppointmentCompletedEvent({
              appointmentId: newDocRef.id,
              clientId: data.clientId,
              professionalId: data.professionalId,
              serviceId: data.serviceId,
              amount: data.price || 0,
            });
            // P2.8: aula experimental criada já concluída → sinaliza conversão.
            if (data.isTrial) {
              void emitAppointmentTrialCompletedEvent({
                appointmentId: newDocRef.id,
                clientId: data.clientId,
                serviceId: data.serviceId,
                outcome: data.trialOutcome ?? 'pendente',
              });
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
          }).catch(err => console.warn('[Agenda] GCal create sync failed:', err));

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
      // Race lost: outro operador salvou no mesmo slot entre o pre-check da
      // UI e o commit da tx. Mensagem detalhada do conflito vem do servidor.
      if (err instanceof AppointmentConflictError) {
        setSnackbar({
          open: true,
          message: `${t('agenda.conflictBlocked', 'Conflito de horário')}: ${err.message}`,
          severity: 'error',
        });
        return;
      }
      // Turma lotou entre o render e o commit (outra reserva pegou a vaga).
      if (err instanceof SessionFullError) {
        setSnackbar({
          open: true,
          message: t('agenda.classFullBlocked', 'Turma cheia: todas as vagas deste horário já foram ocupadas.'),
          severity: 'error',
        });
        return;
      }
      console.error('Error saving appointment:', err);
      setSnackbar({ open: true, message: t('agenda.errorSavingAppointment', 'Erro ao salvar agendamento.'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [business?.id, editingAppointment, services, queryClient, checkConflicts, t, members, user]);

  const handleDeleteAppointment = useCallback(async () => {
    if (!editingAppointment || !business?.id || !user?.uid) return;
    // Fase 5 do plano de soft-delete: appointments e Tier 2 status-driven.
    // Em vez de hard-delete, transitamos pra status 'cancelado' (FSM). Preserva
    // doc pra reports/comissoes e mantem trilha de auditoria. Side-effects
    // (calendar, comissao, metricas de cliente) ainda rodam — semantica
    // identica ao delete antigo.
    // Idempotente: se ja estava 'cancelado', side-effects ja foram aplicados —
    // skip pra evitar revert duplicado.
    if (editingAppointment.status === 'cancelado') {
      setShowDeleteDialog(false);
      setShowFormDialog(false);
      setEditingAppointment(null);
      return;
    }
    setDeleteLoading(true);
    try {
      // M06.2: FSM validada + efeito de reversão (se estava concluido)
      // aplicados na MESMA chamada de servidor — ver transitionAppointmentViaApi.
      await transitionAppointmentViaApi(editingAppointment.id, business.id, 'cancelado');
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
      if (editingAppointment.status === 'concluido') {
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
      setSnackbar({ open: true, message: err instanceof Error ? err.message : t('agenda.errorCancellingAppointment', 'Erro ao cancelar agendamento.'), severity: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  }, [editingAppointment, business?.id, user?.uid, queryClient, t]);

  const handleDeleteSeries = useCallback(async () => {
    if (!editingAppointment?.recurrenceId || !business?.id || !user?.uid) return;
    setDeleteLoading(true);
    try {
      // Filtra a série em memória (appointments já carregados via onSnapshot
      // single-field). Evita composite index appointments/businessId+recurrenceId.
      // Pula itens ja cancelados (idempotencia — side-effects ja foram aplicados).
      const seriesItems = appointments.filter(
        a => a.recurrenceId === editingAppointment.recurrenceId && a.status !== 'cancelado',
      );

      // M06.2: itens CONCLUÍDOS precisam reverter efeito (comissão/fidelidade)
      // — cada um passa pela rota de transição (FSM + dispatch na mesma
      // chamada), fora do batch abaixo pra não gravar o status duas vezes.
      // Os demais (sem efeito a reverter) cancelam em lote, como antes.
      const completedItems = seriesItems.filter(a => a.status === 'concluido');
      const otherItems = seriesItems.filter(a => a.status !== 'concluido');
      const now = new Date().toISOString();

      if (otherItems.length > 0) {
        const batch = writeBatch(db);
        for (const a of otherItems) {
          // Fase 5: status-driven em vez de hard-delete. Preserva doc na FSM.
          batch.update(doc(db, 'appointments', a.id), {
            status: 'cancelado', cancelledAt: now, cancelledBy: user.uid, cancelledByName: user.name || user.uid, updatedAt: now,
          });
        }
        await batch.commit();
      }

      const completedResults = await Promise.allSettled(
        completedItems.map(a => transitionAppointmentViaApi(a.id, business.id, 'cancelado')),
      );
      completedResults.forEach((result, i) => {
        if (result.status === 'rejected') {
          console.warn(`[Agenda] series appointment.canceled falhou (${completedItems[i].id}):`, result.reason);
        }
      });
      if (completedItems.length > 0) {
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
  }, [editingAppointment, business?.id, user?.uid, user?.name, queryClient, t, appointments]);

  const handleCancelAppointment = useCallback(async () => {
    if (!editingAppointment || !business?.id || !user?.uid) return;
    setDeleteLoading(true);
    try {
      // M06.2: mesma rota de handleDeleteAppointment — Tier 2 já unificou os
      // dois fluxos; agora ambos passam pela mesma transição server-side.
      await transitionAppointmentViaApi(editingAppointment.id, business.id, 'cancelado');
      if (editingAppointment.status === 'concluido') {
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
      setSnackbar({ open: true, message: err instanceof Error ? err.message : t('agenda.errorCancellingAppointment', 'Erro ao cancelar agendamento.'), severity: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  }, [editingAppointment, business?.id, user?.uid, queryClient, t]);

  const handleStatusChange = useCallback(async (status: AppointmentStatus) => {
    if (!selectedAppointment || !business?.id) return;

    // R4 / FSM: valida a transição ANTES de gravar. Sem isto o operador pulava
    // 'agendado' → 'concluido' direto, gerando comissão/loyalty/baixa de insumo
    // sem o atendimento ter passado por confirmado/em_andamento (P2.16). Mesma
    // regra que a rota do agente IA já aplica — fecha a assimetria.
    const fromStatus = selectedAppointment.status;
    if (fromStatus === status) return; // no-op
    if (!canTransitionAppointment(fromStatus, status)) {
      setSnackbar({
        open: true,
        message: t(
          'agenda.invalidTransition',
          `Não é possível ir de "${getStatusLabel(fromStatus)}" para "${getStatusLabel(status)}". Confirme ou inicie o atendimento antes de concluir.`,
        ),
        severity: 'warning',
      });
      return;
    }

    setStatusChanging(true);
    try {
      // M06.2: FSM revalidada no servidor + efeito de conclusão/reversão
      // (comissão, fidelidade, baixa de insumo, métricas) aplicados na MESMA
      // chamada — ver transitionAppointmentViaApi. Antes eram dois passos
      // separados (updateDoc + fetch de evento); se o navegador morresse
      // entre os dois, o atendimento ficava concluido sem nenhum efeito.
      await transitionAppointmentViaApi(selectedAppointment.id, business.id, status);

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
      const wasDone = prevStatus === 'concluido';
      const isDone = status === 'concluido';

      // commissionTransactionId chega no selectedAppointment via onSnapshot
      // assim que o handler grava — não precisa setState otimista aqui.
      if (wasDone !== isDone) {
        queryClient.invalidateQueries({ queryKey: ['transactions', business.id] });
      }
      setSelectedAppointment(prev => prev ? { ...prev, status } : null);

      // P2.8: aula experimental concluída via mudança de status → sinaliza
      // conversão pro CRM/agent (mesma transição idempotente !wasDone && isDone).
      if (!wasDone && isDone && selectedAppointment.isTrial) {
        void emitAppointmentTrialCompletedEvent({
          appointmentId: selectedAppointment.id,
          clientId: selectedAppointment.clientId,
          serviceId: selectedAppointment.serviceId,
          outcome: selectedAppointment.trialOutcome ?? 'pendente',
        });
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
      setSnackbar({ open: true, message: err instanceof Error ? err.message : t('agenda.errorChangingStatus', 'Erro ao alterar status.'), severity: 'error' });
    } finally {
      setStatusChanging(false);
    }
  }, [selectedAppointment, business?.id, queryClient, t]);

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
                  groupSeats={appt.sessionKey ? sessionSeatsMap[appt.sessionKey] : undefined}
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
                    groupSeats={appt.sessionKey ? sessionSeatsMap[appt.sessionKey] : undefined}
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

          {/* Formulários/anamnese (M06.4a) — segundo ponto de entrada fora do
              Enterprise; qualquer autenticado pode gerenciar (não é ação
              sensível a dinheiro/agenda de outra pessoa, diferente de bloqueio). */}
          <button
            onClick={() => setShowFormTemplatesDialog(true)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium',
              'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] border border-gray-200 dark:border-gray-700',
              'transition-all duration-200',
            )}
            title={t('agenda.formTemplatesTitle', 'Gerenciar fichas de anamnese/intake')}
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">{t('agenda.formTemplates', 'Formulários')}</span>
          </button>

          {/* Schedule blocks (M06.3a) — férias, feriado, indisponibilidade */}
          {canManageScheduleBlocks && (
            <button
              onClick={() => setShowScheduleBlocksDialog(true)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium',
                'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] border border-gray-200 dark:border-gray-700',
                'transition-all duration-200',
              )}
              title={t('agenda.scheduleBlocksTitle', 'Bloquear férias, feriado ou indisponibilidade')}
            >
              <CalendarOff className="w-4 h-4" />
              <span className="hidden sm:inline">{t('agenda.scheduleBlocks', 'Bloqueios')}</span>
            </button>
          )}

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
        onEmitNfse={() => {
          setNfseAppointment(selectedAppointment);
          setShowViewDialog(false);
        }}
        formTemplateId={selectedAppointment ? services.find((s) => s.id === selectedAppointment.serviceId)?.formTemplateId : undefined}
        onBillAppointment={() => {
          if (!selectedAppointment) return;
          if (typeof window !== 'undefined') {
            sessionStorage.setItem(
              'pendingTransactionPrefill',
              JSON.stringify(buildAppointmentBillingPrefill(selectedAppointment)),
            );
          }
          setShowViewDialog(false);
          setActivePage('Financeiro');
        }}
        statusChanging={statusChanging}
      />

      {/* Emissão de NFSe do atendimento — reusa o dialog fiscal existente,
          pré-preenchido via buildAppointmentNfseInput. A emissão real
          (certificado + SEFAZ) e o writeback fiscalDocumentId/accessKey vivem
          no /api/fiscal/emit. Mesmo padrão do NFC-e em Pedidos. */}
      <EmitirNotaDialog
        open={!!nfseAppointment}
        onClose={() => setNfseAppointment(null)}
        type="nfse"
        onSuccess={() => setNfseAppointment(null)}
        prefillNFSe={nfseAppointment && business
          ? buildAppointmentNfseInput(nfseAppointment, services.find(s => s.id === nfseAppointment.serviceId), business)
          : undefined}
      />

      {/* Bloqueios de agenda (M06.3a) — férias, feriado, indisponibilidade. */}
      {canManageScheduleBlocks && business && (
        <ScheduleBlocksDialog
          open={showScheduleBlocksDialog}
          onClose={() => setShowScheduleBlocksDialog(false)}
          businessId={business.id}
          members={members}
        />
      )}

      {/* Formulários/anamnese (M06.4a) — segundo ponto de entrada pro
          builder existente, fora do Enterprise. */}
      {business && user && (
        <FormTemplatesDialog
          open={showFormTemplatesDialog}
          onClose={() => setShowFormTemplatesDialog(false)}
          businessId={business.id}
          userId={user.uid}
          userName={user.name}
        />
      )}

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
        getGroupSlots={getGroupSlots}
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
