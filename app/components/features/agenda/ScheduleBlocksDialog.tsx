'use client';

import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material';
import { CalendarOff, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { cn } from '@/lib/utils';
import type { User } from '@/lib/types';
import type { ScheduleBlock } from '@/lib/contracts/domain/scheduleBlock';

/**
 * Gerenciar bloqueios de agenda (M06.3a) — férias, feriado, indisponibilidade.
 * Criação/cancelamento sempre via rota autenticada (Admin SDK,
 * /api/schedule-blocks*), nunca addDoc/updateDoc direto — mesmo princípio
 * server-authoritative do resto do núcleo M06. Leitura da lista é direto por
 * onSnapshot (não é dado sensível a race, só exibição).
 */

interface ConflictingAppointment {
  id: string;
  clientName: string;
  date: string;
  startTime: string;
  endTime: string;
}

async function callScheduleBlocksApi(path: string, method: string, body: Record<string, unknown>) {
  const { getAuth } = await import('firebase/auth');
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Sessão expirada — faça login novamente.');
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => null);
  if (!res.ok || !responseBody?.ok) {
    throw new Error(responseBody?.error || 'Não foi possível completar a operação.');
  }
  return responseBody.data;
}

export default function ScheduleBlocksDialog({
  open,
  onClose,
  businessId,
  members,
}: {
  open: boolean;
  onClose: () => void;
  businessId: string;
  members: User[];
}) {
  const { t } = useTranslation();
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [professionalId, setProfessionalId] = useState<string>(''); // '' = negócio inteiro
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hasTimeWindow, setHasTimeWindow] = useState(false);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [lastConflicts, setLastConflicts] = useState<ConflictingAppointment[]>([]);

  useEffect(() => {
    if (!open || !businessId) return;
    setLoadingList(true);
    const q = query(
      collection(db, 'scheduleBlocks'),
      where('businessId', '==', businessId),
      where('status', '==', 'ativo'),
      orderBy('startDate', 'asc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setBlocks(snap.docs.map((d) => ({ ...d.data(), id: d.id } as ScheduleBlock)));
        setLoadingList(false);
      },
      (err) => {
        console.error('[ScheduleBlocksDialog] snapshot error:', err);
        setLoadingList(false);
      },
    );
    return () => unsub();
  }, [open, businessId]);

  const resetForm = useCallback(() => {
    setProfessionalId('');
    setStartDate('');
    setEndDate('');
    setHasTimeWindow(false);
    setStartTime('');
    setEndTime('');
    setReason('');
    setLastConflicts([]);
  }, []);

  const handleCreate = async () => {
    if (!startDate || !endDate) return;
    setSaving(true);
    setLastConflicts([]);
    try {
      const professional = members.find((m) => m.id === professionalId);
      const data = await callScheduleBlocksApi('/api/schedule-blocks', 'POST', {
        ...(professionalId ? { professionalId, professionalName: professional?.name } : {}),
        startDate,
        endDate,
        ...(hasTimeWindow && startTime && endTime ? { startTime, endTime } : {}),
        ...(reason ? { reason } : {}),
      });
      toast.success(t('agenda.blockCreated', 'Bloqueio criado.'));
      if (data.conflictingAppointments?.length > 0) {
        setLastConflicts(data.conflictingAppointments);
      }
      resetForm();
    } catch (err) {
      console.error('[ScheduleBlocksDialog] create failed:', err);
      toast.error(err instanceof Error ? err.message : t('agenda.blockCreateError', 'Erro ao criar bloqueio.'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (blockId: string) => {
    setCancellingId(blockId);
    try {
      await callScheduleBlocksApi(`/api/schedule-blocks/${blockId}/cancel`, 'PATCH', { businessId });
      toast.success(t('agenda.blockCancelled', 'Bloqueio cancelado.'));
    } catch (err) {
      console.error('[ScheduleBlocksDialog] cancel failed:', err);
      toast.error(err instanceof Error ? err.message : t('agenda.blockCancelError', 'Erro ao cancelar bloqueio.'));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center">
            <CalendarOff size={18} className="text-white" />
          </div>
          <div>
            <span className="text-base font-display font-bold text-gray-900 dark:text-gray-100">
              {t('agenda.scheduleBlocksTitle2', 'Bloqueios de agenda')}
            </span>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t('agenda.scheduleBlocksSubtitle', 'Férias, feriado ou indisponibilidade')}
            </p>
          </div>
        </div>
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <div className="space-y-4">
          {/* Form */}
          <div className="space-y-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-gray-800">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {t('agenda.blockScope', 'Escopo')}
              </label>
              <select
                value={professionalId}
                onChange={(e) => setProfessionalId(e.target.value)}
                className="mt-1 w-full text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-gray-900 dark:text-gray-100"
              >
                <option value="">{t('agenda.wholeBusiness', 'Negócio inteiro (feriado/fechamento)')}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextField
                label={t('agenda.blockStartDate', 'De')} value={startDate}
                onChange={(e) => setStartDate(e.target.value)} fullWidth size="small" type="date"
                InputLabelProps={{ shrink: true }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
              />
              <TextField
                label={t('agenda.blockEndDate', 'Até')} value={endDate}
                onChange={(e) => setEndDate(e.target.value)} fullWidth size="small" type="date"
                InputLabelProps={{ shrink: true }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={hasTimeWindow}
                onChange={(e) => setHasTimeWindow(e.target.checked)}
                className="rounded border-gray-300"
              />
              {t('agenda.blockPartialDay', 'Só uma parte do dia (ex.: almoço) — sem marcar, bloqueia o dia inteiro')}
            </label>

            {hasTimeWindow && (
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label={t('agenda.blockStartTime', 'Das')} value={startTime}
                  onChange={(e) => setStartTime(e.target.value)} fullWidth size="small" type="time"
                  InputLabelProps={{ shrink: true }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
                />
                <TextField
                  label={t('agenda.blockEndTime', 'Às')} value={endTime}
                  onChange={(e) => setEndTime(e.target.value)} fullWidth size="small" type="time"
                  InputLabelProps={{ shrink: true }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
                />
              </div>
            )}

            <TextField
              label={t('agenda.blockReason', 'Motivo (opcional)')} value={reason}
              onChange={(e) => setReason(e.target.value)} fullWidth size="small"
              placeholder={t('agenda.blockReasonPlaceholder', 'Ex.: Férias, Feriado municipal, Conferência')}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
            />

            <Button
              onClick={handleCreate}
              disabled={saving || !startDate || !endDate || (hasTimeWindow && (!startTime || !endTime))}
              variant="contained" fullWidth
              sx={{ borderRadius: '10px', textTransform: 'none', bgcolor: '#374151', '&:hover': { bgcolor: '#1f2937' } }}
            >
              {saving ? t('agenda.blockSaving', 'Criando...') : t('agenda.blockCreate', 'Criar bloqueio')}
            </Button>

            {lastConflicts.length > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                  <strong>{t('agenda.blockConflictsTitle', 'Atenção: já existem agendamentos nesse período — não foram cancelados automaticamente:')}</strong>
                  <ul className="mt-1 space-y-0.5">
                    {lastConflicts.map((a) => (
                      <li key={a.id}>{a.clientName} — {a.date} {a.startTime}-{a.endTime}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* List */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              {t('agenda.activeBlocks', 'Bloqueios ativos')}
            </p>
            {loadingList ? (
              <div className="flex items-center justify-center py-6 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
            ) : blocks.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-4">
                {t('agenda.noActiveBlocks', 'Nenhum bloqueio ativo')}
              </p>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {blocks.map((block) => (
                  <div
                    key={block.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-white/[0.03] border border-gray-100 dark:border-gray-800"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
                        {block.professionalName || (block.professionalId ? block.professionalId : t('agenda.wholeBusiness', 'Negócio inteiro'))}
                        {block.reason && <span className="text-gray-400 dark:text-gray-500 font-normal"> · {block.reason}</span>}
                      </p>
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">
                        {block.startDate}{block.endDate !== block.startDate ? ` – ${block.endDate}` : ''}
                        {block.startTime && block.endTime ? ` · ${block.startTime}-${block.endTime}` : ` · ${t('agenda.allDay', 'dia inteiro')}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleCancel(block.id)}
                      disabled={cancellingId === block.id}
                      className={cn(
                        'p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors',
                        cancellingId === block.id && 'opacity-50',
                      )}
                      title={t('agenda.cancelBlock', 'Cancelar bloqueio')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ borderRadius: '10px', textTransform: 'none' }}>
          {t('agenda.close', 'Fechar')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
