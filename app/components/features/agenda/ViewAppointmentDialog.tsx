'use client';

/**
 * app/components/features/agenda/ViewAppointmentDialog.tsx
 *
 * Extraido de AgendaModule.tsx (M02, retomada 10/09/2026) — terceiro e
 * ultimo grupo do plano de M06.8. Mesmo padrao das extracoes anteriores:
 * corte de bloco inteiro, sem mudanca de comportamento. Comunicacao com o
 * pai e 100% via props/callbacks (onEmitNfse/onBillAppointment/etc apenas
 * disparam estado no componente principal, que coordena EmitirNotaDialog e
 * o fluxo de cobranca — nada disso precisou mudar aqui).
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
import { STATUS_COLORS, STATUS_BG_COLORS } from './shared';

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

export default function ViewAppointmentDialog({
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
