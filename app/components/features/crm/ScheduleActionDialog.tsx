'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material';
import { Phone, Calendar, CalendarPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { db } from '@/lib/config/firebase';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import type { CRMContact } from '@/lib/types';

export function ScheduleActionDialog({ open, onClose, contact, businessId, userId, userName, onCreated }: {
  open: boolean;
  onClose: () => void;
  contact: CRMContact;
  businessId: string;
  userId: string;
  userName: string;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<'contato' | 'consulta'>('contato');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setType('contato');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setDate(tomorrow.toISOString().split('T')[0]);
      setTime('10:00');
      setNotes('');
    }
  }, [open]);

  const handleSave = async () => {
    if (!date || !time || !businessId) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const scheduledAt = `${date}T${time}:00`;

      if (type === 'consulta') {
        const endMinutes = parseInt(time.split(':')[0]) * 60 + parseInt(time.split(':')[1]) + 60;
        const endTime = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

        try {
          await addDoc(collection(db, 'appointments'), {
            businessId,
            clientId: contact.id,
            clientName: contact.name,
            clientPhone: contact.phone || contact.whatsapp || '',
            serviceName: t('crm.schedule.crmConsultation', 'Consulta CRM'),
            date,
            startTime: time,
            endTime,
            duration: 60,
            status: 'agendado',
            price: 0,
            notes: `Lead CRM: ${contact.name}. ${notes}`.trim(),
            createdAt: now,
            updatedAt: now,
          });
        } catch (err) {
          console.error('[ScheduleDialog] Failed to create appointment:', err);
          toast.error(t('crm.schedule.errorAppointment', 'Erro ao criar agendamento na agenda'));
          setSaving(false);
          return;
        }
      }

      try {
        await addDoc(collection(db, 'crmActivities'), {
          businessId,
          contactId: contact.id,
          contactName: contact.name,
          type: type === 'consulta' ? 'reuniao' : 'tarefa',
          title: type === 'consulta' ? `Consulta com ${contact.name}` : `Follow-up com ${contact.name}`,
          description: notes || undefined,
          scheduledAt,
          isCompleted: false,
          assignedTo: userId,
          assignedToName: userName,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        console.error('[ScheduleDialog] Failed to create CRM activity:', err);
        toast.error(t('crm.schedule.errorActivity', 'Erro ao registrar atividade no CRM'));
        setSaving(false);
        return;
      }

      try {
        await updateDoc(doc(db, 'crmContacts', contact.id), {
          lastContactDate: now,
          updatedAt: now,
        });
      } catch (err) {
        console.error('[ScheduleDialog] Failed to update contact lastContactDate:', err);
      }

      toast.success(type === 'consulta' ? t('crm.schedule.successConsultation', 'Consulta agendada! Visível na Agenda.') : t('crm.schedule.successContact', 'Contato agendado!'));
      onCreated();
      onClose();
    } catch (err) {
      console.error('[ScheduleDialog] Unexpected error:', err);
      toast.error(t('crm.schedule.errorSchedule', 'Erro ao agendar'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
            <CalendarPlus size={18} className="text-white" />
          </div>
          <div>
            <span className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{t('crm.detail.schedule', 'Agendar')}</span>
            <p className="text-xs text-gray-400 dark:text-gray-500">{contact.name}</p>
          </div>
        </div>
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <div className="space-y-4">
          <div className="flex gap-2">
            {[
              { value: 'contato' as const, label: t('crm.schedule.nextContact', 'Próximo Contato'), icon: <Phone size={14} /> },
              { value: 'consulta' as const, label: t('crm.schedule.newConsultation', 'Nova Consulta'), icon: <Calendar size={14} /> },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setType(opt.value)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all',
                  type === opt.value
                    ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400'
                    : 'bg-white dark:bg-white/[0.04] border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600',
                )}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('crm.schedule.date', 'Data')} value={date} onChange={(e) => setDate(e.target.value)} fullWidth size="small" type="date" InputLabelProps={{ shrink: true }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
            <TextField label={t('crm.schedule.time', 'Horário')} value={time} onChange={(e) => setTime(e.target.value)} fullWidth size="small" type="time" InputLabelProps={{ shrink: true }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          </div>
          <TextField label={t('crm.form.notes', 'Observações')} value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth size="small" multiline rows={2} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          {type === 'consulta' && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20">
              <Calendar size={14} className="text-blue-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-blue-700 dark:text-blue-400 leading-relaxed">
                {t('crm.schedule.consultationNote', 'Um agendamento será criado na Agenda do Aevo e uma atividade será registrada no CRM.')}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving} sx={{ borderRadius: '10px', textTransform: 'none' }}>{t('crm.action.cancel', 'Cancelar')}</Button>
        <Button onClick={handleSave} disabled={saving || !date || !time} variant="contained" sx={{ borderRadius: '10px', textTransform: 'none', bgcolor: '#DC2626', '&:hover': { bgcolor: '#B91C1C' } }}>
          {saving ? t('crm.schedule.scheduling', 'Agendando...') : t('crm.detail.schedule', 'Agendar')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
