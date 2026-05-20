'use client';

/**
 * AppointmentFormDialog — extraído do AgendaModule pra que o módulo
 * Conversas também possa usar ("Agendar atendimento" direto da conversa).
 *
 * Dialog puro: state local, sem efeitos de persistência. O caller é
 * responsável por:
 *   - Passar `services`/`clients`/`members` da fonte de verdade
 *   - Persistir no Firestore quando `onSave` é chamado
 *   - Calcular conflitos via `checkConflicts` (opcional)
 *
 * Sem mudança de comportamento desde a versão inline original — só
 * mudou de localização e os helpers/constantes vivem em
 * `./shared.ts` agora.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Search, X, AlertTriangle, Trash2, Check } from 'lucide-react';
import { Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { isActiveRecord } from '@/lib/utils/recordFilters';
import { maskMoney, unmaskMoney } from '@/lib/utils/masks';
import type { AppointmentStatus, CRMContact, Service, User } from '@/lib/types';
import {
  STATUS_OPTIONS,
  DURATION_OPTIONS,
  TIME_OPTIONS,
  addDurationToTime,
  type AppointmentFormData,
  type RecurrenceFrequency,
} from './shared';

export type { AppointmentFormData };

export interface AppointmentDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: AppointmentFormData) => void;
  onDelete?: () => void;
  initialData?: Partial<AppointmentFormData>;
  isEditing?: boolean;
  services: Service[];
  clients: CRMContact[];
  members: User[];
  saving?: boolean;
  checkConflicts?: (professionalId: string, date: string, startTime: string, endTime: string, excludeId?: string) => { hasConflict: boolean; message: string };
  editingAppointmentId?: string;
}

export function AppointmentFormDialog({
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
  const { t } = useTranslation();
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
    professionalIds: [],
    professionalNames: [],
    notes: '',
    status: 'agendado',
    price: 0,
    color: '#3B82F6',
    recurrenceFrequency: 'none',
    recurrenceOccurrences: 4,
  });
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && initialData) {
      // Edit: hidrata initial. Se initialData veio só com professionalId
      // (legado), seed professionalIds com [professionalId] pra UI multi
      // refletir o estado. Mesma coisa pra nomes.
      const seedIds = initialData.professionalIds && initialData.professionalIds.length > 0
        ? initialData.professionalIds
        : initialData.professionalId ? [initialData.professionalId] : [];
      const seedNames = initialData.professionalNames && initialData.professionalNames.length > 0
        ? initialData.professionalNames
        : initialData.professionalName ? [initialData.professionalName] : [];
      setFormData((prev) => ({
        ...prev,
        ...initialData,
        professionalIds: seedIds,
        professionalNames: seedNames,
      }));
      const resolvedName = initialData.clientId
        ? (clients.find(c => c.id === initialData.clientId)?.name || initialData.clientName)
        : initialData.clientName;
      setClientSearch(resolvedName || '');
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
        professionalIds: [],
        professionalNames: [],
        notes: '',
        status: 'agendado',
        price: 0,
        color: '#3B82F6',
      });
      setClientSearch('');
    }
  }, [open, initialData, clients]);

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
      (c.name?.toLowerCase() ?? '').includes(clientSearch.toLowerCase()) ||
      (c.phone && c.phone.includes(clientSearch))
    ).slice(0, 20);
  }, [clientSearch, clients]);

  const activeServices = useMemo(() => services.filter(isActiveRecord), [services]);

  const availableMembers = useMemo(() => {
    if (!formData.serviceId) return members;
    const anyHasServiceIds = members.some((m) => m.serviceIds && m.serviceIds.length > 0);
    if (!anyHasServiceIds) return members;
    return members.filter((m) => {
      if (!m.serviceIds || m.serviceIds.length === 0) return true;
      return m.serviceIds.includes(formData.serviceId);
    });
  }, [members, formData.serviceId]);

  // Conflito de agenda — checa pra CADA profissional selecionado. Se QUALQUER
  // um deles tem conflito no slot, avisa. Mensagem agrega os nomes em conflito
  // pra o operador entender qual é o problema. Sem multi-prof, comportamento
  // idêntico (1 prof = 1 check).
  const formConflict = useMemo(() => {
    if (!checkConflicts || formData.professionalIds.length === 0 || !formData.date || !formData.startTime) {
      return { hasConflict: false, message: '' };
    }
    const endTime = addDurationToTime(formData.startTime, formData.duration);
    const conflicts: string[] = [];
    for (let i = 0; i < formData.professionalIds.length; i++) {
      const pid = formData.professionalIds[i];
      const c = checkConflicts(pid, formData.date, formData.startTime, endTime, editingAppointmentId);
      if (c.hasConflict) {
        conflicts.push(`${formData.professionalNames[i] || pid}: ${c.message}`);
      }
    }
    return {
      hasConflict: conflicts.length > 0,
      message: conflicts.join(' · '),
    };
  }, [checkConflicts, formData.professionalIds, formData.professionalNames, formData.date, formData.startTime, formData.duration, editingAppointmentId]);

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

  const handleClientSelect = (client: CRMContact) => {
    setFormData((prev) => ({
      ...prev,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone || '',
    }));
    setClientSearch(client.name);
    setShowClientDropdown(false);
  };

  /** Toggle de profissional (multi-select via chips). Adiciona se ausente,
   *  remove se presente. Mantém arrays ids/names paralelos por índice. */
  const toggleProfessional = (memberId: string) => {
    setFormData((prev) => {
      const idx = prev.professionalIds.indexOf(memberId);
      if (idx >= 0) {
        // Remove
        const ids = [...prev.professionalIds];
        const names = [...prev.professionalNames];
        ids.splice(idx, 1);
        names.splice(idx, 1);
        return {
          ...prev,
          professionalIds: ids,
          professionalNames: names,
          // Sincroniza legado: pega o novo primeiro (ou vazio se acabou)
          professionalId: ids[0] ?? '',
          professionalName: names[0] ?? '',
        };
      }
      // Add
      const member = members.find((m) => m.id === memberId);
      const newName = member?.name ?? '';
      const ids = [...prev.professionalIds, memberId];
      const names = [...prev.professionalNames, newName];
      return {
        ...prev,
        professionalIds: ids,
        professionalNames: names,
        professionalId: ids[0],
        professionalName: names[0],
      };
    });
  };

  const handleSubmit = () => {
    if (!formData.clientName || !formData.date || !formData.startTime) {
      return;
    }
    // Garante consistência final: legado === primeiro do array (ou vazio).
    // toggleProfessional já mantém isso, mas reforça aqui pra casos onde
    // initialData veio com legado-only e usuário não tocou no campo.
    const final: AppointmentFormData = {
      ...formData,
      professionalId: formData.professionalIds[0] ?? '',
      professionalName: formData.professionalNames[0] ?? '',
    };
    onSave(final);
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
          {isEditing ? t('agenda.editAppointment', 'Editar Agendamento') : t('agenda.newAppointment', 'Novo Agendamento')}
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
              {t('agenda.client', 'Cliente')} *
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
                placeholder={t('agenda.searchClient', 'Buscar cliente...')}
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
                        {(client.name || '?').split(' ').map((n) => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{client.name}</div>
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
              {t('agenda.service', 'Serviço')} *
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
              <option value="">{t('agenda.selectService', 'Selecionar serviço')}</option>
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
                {t('agenda.date', 'Data')} *
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
                {t('agenda.startTime', 'Horário Início')} *
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
                {t('agenda.duration', 'Duração')}
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
                {t('agenda.endTime', 'Término')}
              </label>
              <div className="px-4 py-2.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-500 dark:text-gray-400">
                {endTime}
              </div>
            </div>
          </div>

          {/* Profissionais — multi-select via chips. Cada chip é toggleável,
              azul quando selecionado. Permite atribuir 1+ profissionais ao
              mesmo agendamento. Quando vazio, agendamento é "global" (sem
              prof específico — útil pra slots da casa que qualquer um cobre). */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              {t('agenda.professional', 'Profissionais')}
              {formData.professionalIds.length > 0 && (
                <span className="ml-1.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
                  ({formData.professionalIds.length})
                </span>
              )}
              {formData.serviceId && availableMembers.length < members.length && (
                <span className="ml-1.5 text-[10px] text-gray-400 dark:text-gray-500 font-normal">
                  · {availableMembers.length} {t('agenda.availableForService', 'disponíveis para este serviço')}
                </span>
              )}
            </label>
            <div className={cn(
              'flex flex-wrap gap-2 p-2 rounded-xl border bg-white dark:bg-gray-800 min-h-[44px]',
              formConflict.hasConflict
                ? 'border-amber-300 dark:border-amber-500/40'
                : 'border-gray-200 dark:border-gray-700',
            )}>
              {availableMembers.length === 0 ? (
                <span className="text-xs text-gray-400 dark:text-gray-500 px-1 py-1">
                  Nenhum profissional cadastrado.
                </span>
              ) : (
                availableMembers.map((m) => {
                  const selected = formData.professionalIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleProfessional(m.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                        selected
                          ? 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-300 dark:border-red-500/40'
                          : 'bg-gray-50 dark:bg-white/[0.03] text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-red-200 dark:hover:border-red-500/30',
                      )}
                    >
                      {selected && <Check className="w-3 h-3" />}
                      {m.name}
                    </button>
                  );
                })
              )}
            </div>
            {formData.professionalIds.length === 0 && availableMembers.length > 0 && (
              <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                Sem profissional = agendamento global da casa. Clique pra atribuir 1 ou mais.
              </p>
            )}
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
                    <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">{t('agenda.scheduleConflict', 'Conflito de Agenda')}</div>
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
                {t('agenda.status', 'Status')}
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
                  <option key={s.value} value={s.value}>{t(`agenda.status_${s.value}`, s.label)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                {t('agenda.value', 'Valor (R$)')}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={formData.price ? maskMoney(formData.price) : ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, price: unmaskMoney(e.target.value) }))
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

          {/* Recurrence (create only) */}
          {!isEditing && (
            <div className="pt-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                {t('agenda.repeat', 'Repetir')}
              </label>
              <div className="flex gap-2 flex-wrap">
                {([
                  { value: 'none', label: t('agenda.repeatNone', 'Não') },
                  { value: 'daily', label: t('agenda.repeatDaily', 'Diário') },
                  { value: 'weekly', label: t('agenda.repeatWeekly', 'Semanal') },
                  { value: 'biweekly', label: t('agenda.repeatBiweekly', 'Quinzenal') },
                  { value: 'monthly', label: t('agenda.repeatMonthly', 'Mensal') },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, recurrenceFrequency: opt.value as RecurrenceFrequency }))}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                      formData.recurrenceFrequency === opt.value
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-red-300',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {formData.recurrenceFrequency && formData.recurrenceFrequency !== 'none' && (
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t('agenda.occurrences', 'Ocorrências')}:
                  </span>
                  <input
                    type="number"
                    min={2}
                    max={52}
                    value={formData.recurrenceOccurrences ?? 4}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        recurrenceOccurrences: Math.max(2, Math.min(52, Number(e.target.value) || 2)),
                      }))
                    }
                    className="w-20 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                  />
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {t('agenda.recurrenceHint', 'agendamentos vinculados (máx. 52)')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              {t('agenda.notes', 'Observações')}
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              rows={3}
              placeholder={t('agenda.notesPlaceholder', 'Observações adicionais...')}
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
            {t('agenda.delete', 'Excluir')}
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
            {t('agenda.cancel', 'Cancelar')}
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
            {saving ? t('agenda.saving', 'Salvando...') : isEditing ? t('agenda.saveChanges', 'Salvar Alterações') : t('agenda.schedule', 'Agendar')}
          </button>
        </div>
      </DialogActions>
    </Dialog>
  );
}
