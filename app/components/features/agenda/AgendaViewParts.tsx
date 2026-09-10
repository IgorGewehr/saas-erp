'use client';

/**
 * app/components/features/agenda/AgendaViewParts.tsx
 *
 * Componentes pequenos e autocontidos da grade da Agenda, extraídos de
 * AgendaModule.tsx (M02, retomada 10/09/2026) seguindo o MESMO padrão já
 * usado com sucesso 3x nesse mesmo arquivo (AppointmentFormDialog,
 * ScheduleBlocksDialog, FormTemplatesDialog): corte de bloco inteiro
 * (nunca find/replace por nome — há colisão de nomes como `saving` entre
 * componentes), constantes cross-cutting movidas pra ./shared, tipos
 * exportados daqui e reimportados de volta no AgendaModule.
 *
 * Nenhuma mudança de comportamento — só organização de arquivo. Corte
 * puramente mecânico: `getAppointmentTop`/`getAppointmentHeight`/
 * `getCurrentTimeOffset` só eram usados por estes componentes (confirmado
 * por grep antes de mover — `generateRecurrenceDates`, fisicamente vizinho
 * no arquivo original, NÃO veio junto porque só o `handleSaveAppointment`
 * do componente principal usa).
 */

import { useState, useEffect, useMemo } from 'react';
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
} from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Users as UsersIcon, Bell, AlertTriangle } from 'lucide-react';
import Dialog from '@mui/material/Dialog';
import Tooltip from '@mui/material/Tooltip';
import { cn } from '@/lib/utils';
import { formatCurrency, getStatusLabel } from '@/lib/utils/format';
import { getAppointmentProfessionalNames } from '@/lib/utils/appointment';
import type { Appointment } from '@/lib/types';
import { HOUR_HEIGHT, START_HOUR, END_HOUR, STATUS_COLORS, STATUS_BG_COLORS } from './shared';

function getAppointmentTop(startTime: string): number {
  const [h, m] = startTime.split(':').map(Number);
  const minutes = h * 60 + m;
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

// ---- Current Time Line ----
export function CurrentTimeLine() {
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

export function MiniCalendar({ selectedDate, onSelect, appointments }: MiniCalendarProps) {
  const { i18n } = useTranslation();
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
  /** Vagas ocupadas na turma deste appointment (não-canceladas com o mesmo
   *  sessionKey). Só passado pra appointments de turma; exibe badge "N/cap". */
  groupSeats?: number;
}

export function AppointmentBlock({ appointment, onClick, compact = false, clientsMap, groupSeats }: AppointmentBlockProps) {
  const displayName = (appointment.clientId && clientsMap?.[appointment.clientId]) || appointment.clientName;
  const isGroup = !!appointment.isGroupSession && !!appointment.capacitySnapshot;
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
            {isGroup && !isTiny && (
              <span
                className="flex-shrink-0 inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-px rounded-full bg-black/[0.06] dark:bg-white/[0.12] mt-[2px]"
                style={{ color }}
                title="Turma — vagas ocupadas"
              >
                <UsersIcon className="w-2.5 h-2.5" />
                {groupSeats ?? '–'}/{appointment.capacitySnapshot}
              </span>
            )}
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

export function DeleteConfirmDialog({ open, onClose, onCancel, onDelete, onDeleteSeries, hasRecurrence, loading, appointmentName }: DeleteConfirmDialogProps) {
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

// ---- Loading Skeleton ----
export function AgendaSkeleton() {
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
