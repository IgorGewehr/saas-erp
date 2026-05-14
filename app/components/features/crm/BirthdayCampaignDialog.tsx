'use client';

/**
 * BirthdayCampaignDialog — modal de criar/editar campanha recorrente de
 * aniversário. Diferente do BroadcastDetailDialog (one-shot, lista fixa):
 * é uma REGRA que o cron varre diariamente pra encontrar clientes cujo
 * `birthDate` bate com hoje + daysBeforeBirthday e dispara mensagem.
 *
 * Visual padronizado com a "Nova Campanha" pontual (ModernDialog +
 * ModernSection). Modo edição expõe botão "Excluir" no footer.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  TextField, Select, MenuItem, FormControl, InputLabel,
  FormControlLabel, Switch, Slider,
} from '@mui/material';
import { addDoc, updateDoc, deleteDoc, doc, collection, deleteField } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { toast } from 'react-toastify';
import { Cake, Clock, Send, Filter, ShieldCheck, Trash2, AlertTriangle, Calendar, Repeat } from 'lucide-react';
import {
  ModernDialog,
  ModernDialogActions,
  ModernCancelButton,
  ModernPrimaryButton,
  ModernSection,
  ModernPill,
} from '@/app/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { BirthdayCampaign, ChannelConnection, ConsentBasis, LeadStatus, Client } from '@/lib/types';
import { CONSENT_BASIS_LABELS } from '@/lib/types';
import TemplateSelector, { isTemplateSelectionValid, type TemplateSelection } from './TemplateSelector';
import { MOVABLE_PRESETS, resolvePresetMmDd, nextOccurrenceOfPreset, type FestivePresetKey } from '@/lib/utils/festive-dates';

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'novo',         label: 'Novo' },
  { value: 'contatado',    label: 'Contatado' },
  { value: 'qualificado',  label: 'Qualificado' },
  { value: 'proposta',     label: 'Proposta' },
  { value: 'negociacao',   label: 'Negociação' },
  { value: 'ganho',        label: 'Ganho' },
  { value: 'perdido',      label: 'Perdido' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: string;
  user: { uid: string; name: string };
  /** Quando presente, modal abre em modo edição. Quando null, é create. */
  editing: BirthdayCampaign | null;
  /** Connections do business — filtro de elegibilidade roda aqui dentro. */
  availableConnections: ChannelConnection[];
  /** Lista atual de clientes — usada pra sugerir tags e fazer preview do count. */
  clients: Client[];
}

const DEFAULT_MESSAGE = '🎂 Feliz aniversário, {{name}}! Pra comemorar, preparamos uma promoção especial pra você. Aproveite!';

/** Datas festivas FIXAS no calendário brasileiro (MM-DD constante todo ano).
 *  Operador escolhe pelo combobox ou digita MM-DD livre. Black Friday saiu
 *  daqui — é móvel (4ª sex de novembro) e foi pra MOVABLE_PRESETS do util. */
const FIXED_FESTIVE_DATES: Array<{ value: string; label: string }> = [
  { value: '12-25', label: 'Natal (25/12)' },
  { value: '12-31', label: 'Réveillon (31/12)' },
  { value: '06-12', label: 'Dia dos Namorados (12/06)' },
  { value: '04-21', label: 'Tiradentes (21/04)' },
  { value: '09-07', label: 'Independência (07/09)' },
  { value: '10-12', label: 'Nossa Sra. Aparecida (12/10)' },
  { value: '10-12', label: 'Dia das Crianças (12/10)' },
  { value: '11-02', label: 'Finados (02/11)' },
  { value: '11-15', label: 'Proclamação República (15/11)' },
  { value: '03-08', label: 'Dia Internacional da Mulher (08/03)' },
];

export default function BirthdayCampaignDialog({
  open, onClose, businessId, user, editing, availableConnections, clients,
}: Props) {
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  // Tipo da recorrência: 'birthday' (aniversário de cada contato) ou
  // 'fixed_date' (data fixa do calendário pra todos os filtrados).
  // Default 'birthday' — comportamento legado.
  const [recurrenceType, setRecurrenceType] = useState<'birthday' | 'fixed_date'>('birthday');
  // MM-DD da data festiva (só usado quando recurrenceType === 'fixed_date'
  // E festivePreset NÃO está setado). Default Natal pra exemplo claro.
  const [festiveDate, setFestiveDate] = useState<string>('12-25');
  // Chave do preset MÓVEL (mothers_day, easter, etc.) — quando setado,
  // sobrepõe festiveDate. Runner resolve a data correta pro ano da execução
  // via festive-dates util. Permite "Dia das Mães" sem ajustar MM-DD todo ano.
  const [festivePreset, setFestivePreset] = useState<string>('');
  const [daysBefore, setDaysBefore] = useState(0);
  const [sendAtHour, setSendAtHour] = useState(9);
  const [viaBaileys, setViaBaileys] = useState(false);
  const [connectionId, setConnectionId] = useState('');
  const [messageContent, setMessageContent] = useState(DEFAULT_MESSAGE);
  const [template, setTemplate] = useState<TemplateSelection | null>(null);
  const [filterTipo, setFilterTipo] = useState<'pf' | 'pj' | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<LeadStatus[]>([]);
  const [filterTagsInput, setFilterTagsInput] = useState('');
  const [consentBasis, setConsentBasis] = useState<ConsentBasis>('legitimate-interest');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset / pre-fill quando abre.
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (!editing) {
      setName(''); setEnabled(true);
      setRecurrenceType('birthday'); setFestiveDate('12-25'); setFestivePreset('');
      setDaysBefore(0); setSendAtHour(9);
      setViaBaileys(false); setConnectionId('');
      setMessageContent(DEFAULT_MESSAGE); setTemplate(null);
      setFilterTipo('all'); setFilterStatus([]); setFilterTagsInput('');
      setConsentBasis('legitimate-interest');
      return;
    }
    setName(editing.name);
    setEnabled(editing.enabled);
    // Fallback 'birthday' pra docs antigos sem o campo (retrocompat).
    setRecurrenceType(editing.recurrenceType ?? 'birthday');
    setFestiveDate(editing.festiveDate ?? '12-25');
    setFestivePreset(editing.festivePreset ?? '');
    setDaysBefore(editing.daysBeforeBirthday);
    setSendAtHour(editing.sendAtHour);
    setViaBaileys(editing.viaBaileys);
    setConnectionId(editing.channelConnectionId ?? '');
    setMessageContent(editing.messageContent ?? DEFAULT_MESSAGE);
    if (editing.templateName) {
      setTemplate({
        name: editing.templateName,
        language: editing.templateLanguage ?? 'pt_BR',
        params: editing.templateParams ?? [],
        preview: editing.templateBody ?? '',
      });
    } else {
      setTemplate(null);
    }
    setFilterTipo(editing.filters?.tipo ?? 'all');
    setFilterStatus(editing.filters?.status ?? []);
    setFilterTagsInput((editing.filters?.tags ?? []).join(', '));
    setConsentBasis(editing.consentBasis);
  }, [open, editing]);

  // Connections elegíveis: ativas, conectadas, do tipo certo (Cloud ou Baileys).
  // Exclui chip validador — ele só serve pra checar onWhatsApp pré-disparo,
  // nunca envia. Se aparecesse aqui e o operador selecionasse por engano,
  // a campanha inteira passaria pelo validator e queimaria.
  const eligibleConnections = useMemo(() => availableConnections.filter(c => {
    if (!c.isActive || !c.isConnected) return false;
    if (c.purpose === 'validator') return false;
    return viaBaileys ? c.type === 'whatsapp_baileys' : c.type === 'whatsapp_cloud';
  }), [availableConnections, viaBaileys]);

  // Auto-seleciona quando há exatamente 1.
  useEffect(() => {
    if (eligibleConnections.length === 1) {
      const onlyId = eligibleConnections[0].id;
      if (connectionId !== onlyId) setConnectionId(onlyId);
      return;
    }
    if (connectionId && !eligibleConnections.some(c => c.id === connectionId)) {
      setConnectionId('');
    }
  }, [eligibleConnections, connectionId]);

  const filterTags = useMemo(() => filterTagsInput
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean), [filterTagsInput]);

  const isFixedDate = recurrenceType === 'fixed_date';

  // Clients que passam nos filtros (sem checar birthDate). Usado pra dois
  // fins: (1) base do preview pra fixed_date; (2) base pro calcular
  // nextDispatchInfo no modo birthday (a função interna re-aplica o filtro
  // birthDate aos elegíveis em cada dia futuro).
  const filteredClients = useMemo(() => clients.filter(c => {
    if ((c as { deletedAt?: string }).deletedAt) return false;
    if (filterTipo !== 'all' && c.tipo !== filterTipo) return false;
    if (filterStatus.length && !filterStatus.includes(c.status)) return false;
    if (filterTags.length) {
      const cTags = (c.tags || []).map(t => t.toLowerCase());
      if (!filterTags.every(t => cTags.includes(t))) return false;
    }
    return true;
  }), [clients, filterTipo, filterStatus, filterTags]);

  // Preview: aniversariantes no mês-alvo (só relevante pra mode birthday).
  // Em fixed_date, esse valor é apenas filteredClients.length (mês não importa).
  const totalInMonth = useMemo(() => {
    if (isFixedDate) return filteredClients.length;
    const target = new Date();
    target.setDate(target.getDate() + daysBefore);
    const targetMonth = target.getMonth() + 1;
    return clients.filter(c => {
      if (!c.birthDate || c.birthDate.length < 7) return false;
      const month = Number(c.birthDate.slice(5, 7));
      return month === targetMonth;
    }).length;
  }, [clients, daysBefore, isFixedDate, filteredClients.length]);

  const previewClients = useMemo(() => {
    if (isFixedDate) {
      // Fixed_date: todos os filtrados disparam na data marcada. Ordena por nome
      // (não tem birthday MM-DD pra usar como sort key aqui).
      return [...filteredClients].sort((a, b) => a.name.localeCompare(b.name));
    }
    const target = new Date();
    target.setDate(target.getDate() + daysBefore);
    const targetMonth = target.getMonth() + 1;
    return filteredClients
      .filter(c => {
        if (!c.birthDate || c.birthDate.length < 7) return false;
        return Number(c.birthDate.slice(5, 7)) === targetMonth;
      })
      .sort((a, b) => {
        const dayA = Number(a.birthDate!.slice(8, 10));
        const dayB = Number(b.birthDate!.slice(8, 10));
        return dayA - dayB;
      });
  }, [filteredClients, daysBefore, isFixedDate]);
  const previewCount = previewClients.length;

  // Resolve a data efetiva pra fixed_date: se festivePreset setado, calcula
  // dinamicamente via util pro ano corrente; senão, usa festiveDate.
  // Centraliza pra não duplicar a lógica em todayMatchCount + nextDispatchInfo.
  const resolvedFestiveDate = useMemo(() => {
    if (!isFixedDate) return null;
    if (festivePreset) {
      return resolvePresetMmDd(festivePreset as FestivePresetKey, new Date().getFullYear());
    }
    return festiveDate;
  }, [isFixedDate, festivePreset, festiveDate]);

  // Quantos disparam HOJE: depende do tipo.
  //   - birthday: clientes do mês cujo MM-DD === hoje + daysBefore
  //   - fixed_date: se data resolvida === hoje + daysBefore, todos os filtrados
  const todayMatchCount = useMemo(() => {
    const target = new Date();
    target.setDate(target.getDate() + daysBefore);
    const targetMm = String(target.getMonth() + 1).padStart(2, '0');
    const targetDd = String(target.getDate()).padStart(2, '0');
    const targetMmDd = `${targetMm}-${targetDd}`;
    if (isFixedDate) {
      return resolvedFestiveDate === targetMmDd ? filteredClients.length : 0;
    }
    return previewClients.filter(c => c.birthDate?.slice(5, 10) === targetMmDd).length;
  }, [previewClients, daysBefore, isFixedDate, resolvedFestiveDate, filteredClients.length]);

  // Próximo dia em que disparará. Birthday: varre 366d procurando match.
  // Fixed_date: usa nextOccurrenceOfPreset (movable) ou calcula via festiveDate.
  const nextDispatchInfo = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (isFixedDate) {
      if (filteredClients.length === 0) return null;
      // Pra preset móvel: usa o util que já considera virada de ano.
      let festiveDateObj: Date | null = null;
      if (festivePreset) {
        festiveDateObj = nextOccurrenceOfPreset(festivePreset as FestivePresetKey, today);
      } else {
        const [festMm, festDd] = festiveDate.split('-').map(Number);
        if (!festMm || !festDd) return null;
        festiveDateObj = new Date(today.getFullYear(), festMm - 1, festDd);
        if (festiveDateObj < today) {
          festiveDateObj = new Date(today.getFullYear() + 1, festMm - 1, festDd);
        }
      }
      if (!festiveDateObj) return null;
      // Data efetiva de DISPARO = festiveDate - daysBefore.
      const candidate = new Date(festiveDateObj);
      candidate.setDate(candidate.getDate() - daysBefore);
      // Se daysBefore puxa pra antes de hoje (ex: preset deste ano já passou
      // do dia, mas a virada -daysBefore caiu pra trás), usa próximo ano.
      if (candidate < today && festivePreset) {
        const nextYearOcc = resolvePresetMmDd(festivePreset as FestivePresetKey, today.getFullYear() + 1);
        if (nextYearOcc) {
          const [m, d] = nextYearOcc.split('-').map(Number);
          const nextDate = new Date(today.getFullYear() + 1, m - 1, d);
          nextDate.setDate(nextDate.getDate() - daysBefore);
          return { date: nextDate, count: filteredClients.length };
        }
      }
      return { date: candidate, count: filteredClients.length };
    }

    // birthday: cada dia dos próximos 366, calcula a data-alvo (+daysBefore)
    // e conta quantos clientes têm birthDate.MM-DD === alvo. Primeiro dia
    // com ≥1 match = próximo disparo.
    if (filteredClients.length === 0) return null;
    for (let dayOffset = 0; dayOffset < 366; dayOffset++) {
      const runDate = new Date(today);
      runDate.setDate(runDate.getDate() + dayOffset);
      const targetDate = new Date(runDate);
      targetDate.setDate(targetDate.getDate() + daysBefore);
      const targetMm = String(targetDate.getMonth() + 1).padStart(2, '0');
      const targetDd = String(targetDate.getDate()).padStart(2, '0');
      const targetMmDd = `${targetMm}-${targetDd}`;
      const matches = filteredClients.filter(c =>
        c.birthDate && c.birthDate.length >= 10 && c.birthDate.slice(5, 10) === targetMmDd
      ).length;
      if (matches > 0) return { date: runDate, count: matches };
    }
    return null;
  }, [filteredClients, daysBefore, isFixedDate, festiveDate]);

  const [showRecipients, setShowRecipients] = useState(false);

  const hasActiveFilters = filterTipo !== 'all' || filterStatus.length > 0 || filterTags.length > 0;

  const canSave = useMemo(() => {
    if (!name.trim()) return false;
    if (eligibleConnections.length > 0 && !connectionId) return false;
    // Pra fixed_date: ou festivePreset (preset móvel resolvido pelo runner)
    // OU festiveDate MM-DD válido. Pelo menos um precisa estar válido.
    if (recurrenceType === 'fixed_date') {
      if (festivePreset) {
        // Preset existe na lista de móveis conhecidos?
        if (!MOVABLE_PRESETS.some(p => p.key === festivePreset)) return false;
      } else {
        const m = festiveDate.match(/^(\d{2})-(\d{2})$/);
        if (!m) return false;
        const mm = Number(m[1]), dd = Number(m[2]);
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
      }
    }
    if (viaBaileys) return messageContent.trim().length > 0;
    return isTemplateSelectionValid(template);
  }, [name, connectionId, eligibleConnections.length, viaBaileys, messageContent, template, recurrenceType, festiveDate, festivePreset]);

  const handleSave = async () => {
    if (!canSave) {
      toast.error('Preencha todos os campos obrigatórios');
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const filtersClean: NonNullable<BirthdayCampaign['filters']> = { tipo: filterTipo };
      if (filterStatus.length) filtersClean.status = filterStatus;
      if (filterTags.length) filtersClean.tags = filterTags;

      // Campos do payload + limpeza explícita via deleteField() quando muda
      // de tipo. Sem isso, docs editados de fixed_date pra birthday ficavam
      // com festiveDate/festivePreset órfãos no Firestore (não causava bug
      // funcional — runner ignora — mas poluía o DB).
      // updateDoc aceita FieldValue.delete() em qualquer campo; tipo Partial
      // não permite, então uso cast pontual via Record.
      const payload: Record<string, unknown> = {
        businessId,
        name: name.trim(),
        enabled,
        // recurrenceType sempre persiste — pre-fill na próxima abertura
        // reflete a escolha sem ambiguidade.
        recurrenceType,
        daysBeforeBirthday: daysBefore,
        sendAtHour,
        channel: 'whatsapp',
        viaBaileys,
        ...(connectionId ? { channelConnectionId: connectionId } : {}),
      };

      // Lógica de festivePreset/festiveDate por estado atual:
      //  - fixed_date + preset móvel: persiste preset, REMOVE festiveDate
      //  - fixed_date + MM-DD fixo:   persiste festiveDate, REMOVE festivePreset
      //  - birthday:                  REMOVE ambos (limpeza completa)
      if (recurrenceType === 'fixed_date') {
        if (festivePreset) {
          payload.festivePreset = festivePreset;
          payload.festiveDate = deleteField();
        } else {
          payload.festiveDate = festiveDate;
          payload.festivePreset = deleteField();
        }
      } else {
        payload.festivePreset = deleteField();
        payload.festiveDate = deleteField();
      }

      // Conteúdo da mensagem — branch por viaBaileys.
      if (viaBaileys) {
        payload.messageContent = messageContent.trim();
      } else {
        payload.templateName = template?.name;
        payload.templateLanguage = template?.language;
        payload.templateParams = template?.params;
        payload.templateBody = template?.preview;
      }

      payload.filters = filtersClean;
      payload.consentBasis = consentBasis;
      payload.consentAcknowledgedAt = now;
      payload.consentAcknowledgedBy = user.uid;
      payload.updatedAt = now;

      if (editing) {
        await updateDoc(doc(db, 'birthdayCampaigns', editing.id), payload);
        toast.success('Campanha atualizada');
      } else {
        // No create, deleteField() não faz sentido (não há campo a deletar)
        // — substitui esses por undefined (que addDoc também ignora). Já
        // que docs novos partem sem os campos, o resultado é o mesmo.
        const createPayload = { ...payload };
        if (createPayload.festivePreset && typeof createPayload.festivePreset !== 'string') {
          delete createPayload.festivePreset;
        }
        if (createPayload.festiveDate && typeof createPayload.festiveDate !== 'string') {
          delete createPayload.festiveDate;
        }
        await addDoc(collection(db, 'birthdayCampaigns'), {
          ...createPayload,
          stats: { totalSent: 0, totalDelivered: 0, totalRead: 0, totalFailed: 0 },
          createdBy: user.uid,
          createdByName: user.name,
          createdAt: now,
        });
        toast.success('Campanha criada — disparará automaticamente quando habilitada');
      }
      onClose();
    } catch (err) {
      console.error('[BirthdayCampaign] save failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar campanha');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'birthdayCampaigns', editing.id));
      toast.success('Campanha excluída');
      onClose();
    } catch (err) {
      console.error('[BirthdayCampaign] delete failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir campanha');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  // Sample contact pra preview do template.
  const sampleRecipient = useMemo(() => {
    const sample = clients.find(c => c.birthDate && c.tipo !== 'pj');
    if (!sample) return undefined;
    return {
      name: sample.name,
      phoneNumber: sample.phone || sample.whatsapp || '',
      email: sample.email || '',
    };
  }, [clients]);

  const channelLabel = viaBaileys ? 'WA Web' : 'WA Cloud';
  const dayLabel = daysBefore === 0 ? 'No dia' : `${daysBefore}d antes`;
  // Label do tipo pra header/badges — texto curto e ícone.
  const typeLabel = isFixedDate ? 'Data festiva' : 'Aniversário';
  // Label completo da data festiva (preset móvel > fixo conhecido > MM-DD cru).
  const festiveLabel = useMemo(() => {
    if (festivePreset) {
      const movable = MOVABLE_PRESETS.find(p => p.key === festivePreset);
      return movable?.label ?? festivePreset;
    }
    const fixed = FIXED_FESTIVE_DATES.find(p => p.value === festiveDate);
    return fixed?.label ?? festiveDate;
  }, [festiveDate, festivePreset]);

  return (
    <ModernDialog
      open={open}
      onClose={onClose}
      icon={isFixedDate ? Calendar : Cake}
      title={editing ? 'Editar campanha recorrente' : 'Nova campanha recorrente'}
      maxWidth="sm"
      badges={
        editing
          ? <ModernPill tone={enabled ? 'emerald' : 'slate'}>{enabled ? 'Ativa' : 'Pausada'}</ModernPill>
          : undefined
      }
      subtitle={
        <>
          <ModernPill tone="amber">
            {isFixedDate ? <Calendar size={12} /> : <Cake size={12} />}
            {typeLabel}
          </ModernPill>
          <ModernPill tone="red"><Send size={12} />{channelLabel}</ModernPill>
          <ModernPill tone="blue"><Clock size={12} />{dayLabel} · {String(sendAtHour).padStart(2, '0')}:00</ModernPill>
          <ModernPill tone={todayMatchCount > 0 ? 'emerald' : 'slate'}>
            {todayMatchCount} hoje
          </ModernPill>
          {!isFixedDate && <ModernPill tone="slate">{previewCount} no mês</ModernPill>}
        </>
      }
      footer={
        <ModernDialogActions
          status={
            <>
              <ModernPill tone={todayMatchCount > 0 ? 'emerald' : 'slate'}>
                {todayMatchCount} hoje
              </ModernPill>
              <span className="truncate">
                {dayLabel} · {String(sendAtHour).padStart(2, '0')}:00 · {channelLabel}
              </span>
            </>
          }
        >
          {editing && !confirmDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[14px] text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
              title="Excluir campanha"
            >
              <Trash2 size={14} />
              Excluir
            </button>
          )}
          {editing && confirmDelete && (
            <div className="flex items-center gap-2 mr-2">
              <span className="text-[11px] font-semibold text-red-700 dark:text-red-400 hidden sm:inline">
                Excluir mesmo?
              </span>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-60"
              >
                <Trash2 size={12} />
                {deleting ? 'Excluindo…' : 'Confirmar'}
              </button>
            </div>
          )}
          <ModernCancelButton onClick={onClose}>Cancelar</ModernCancelButton>
          <ModernPrimaryButton
            onClick={handleSave}
            disabled={!canSave || saving || deleting}
            startIcon={!saving ? <Send size={16} /> : undefined}
          >
            {saving ? 'Salvando…' : editing ? 'Atualizar' : 'Criar campanha'}
          </ModernPrimaryButton>
        </ModernDialogActions>
      }
    >
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        {isFixedDate
          ? <>Esta campanha dispara automaticamente em uma data fixa do calendário (ex: Natal, Dia das Mães) pra todos os contatos do filtro.</>
          : <>Esta campanha dispara automaticamente quando algum cliente faz aniversário.</>}
        {' '}Use placeholders como <code className="bg-slate-100 dark:bg-white/[0.06] px-1 rounded">{'{{name}}'}</code> pra personalizar a mensagem.
      </p>

      {/* Toggle do tipo de recorrência — Aniversário vs Data festiva.
          Visual similar ao toggle Cloud/Baileys logo abaixo. Trocar de tipo
          NÃO limpa filtros/mensagem, só altera a semântica de "quando dispara". */}
      <ModernSection
        icon={Repeat}
        title="Tipo de recorrência"
        meta={<ModernPill tone="amber">{typeLabel}</ModernPill>}
      >
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRecurrenceType('birthday')}
            className={cn(
              'flex-1 px-3 py-2 text-xs rounded-lg border-2 transition-colors text-left',
              !isFixedDate
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10'
                : 'border-slate-200 dark:border-slate-700 hover:border-amber-300',
            )}
          >
            <p className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Cake size={13} /> Aniversário do contato
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              Dispara no <code>birthDate</code> de cada cliente · individual
            </p>
          </button>
          <button
            type="button"
            onClick={() => setRecurrenceType('fixed_date')}
            className={cn(
              'flex-1 px-3 py-2 text-xs rounded-lg border-2 transition-colors text-left',
              isFixedDate
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10'
                : 'border-slate-200 dark:border-slate-700 hover:border-amber-300',
            )}
          >
            <p className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Calendar size={13} /> Data festiva
            </p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              Data fixa do ano (Natal, Mães…) · todos do filtro
            </p>
          </button>
        </div>

        {/* Date picker pra fixed_date. Combobox unificado:
            - Presets MÓVEIS (calculados dinamicamente todo ano via util)
            - Presets FIXOS (MM-DD constante)
            - Custom (libera input livre de MM-DD)
            Encoding do `value`: 'preset:KEY' pra móvel, MM-DD pra fixo. */}
        {isFixedDate && (
          <div className="space-y-2">
            <FormControl fullWidth size="small">
              <InputLabel>Data festiva</InputLabel>
              <Select
                value={
                  festivePreset
                    ? `preset:${festivePreset}`
                    : FIXED_FESTIVE_DATES.some(p => p.value === festiveDate)
                      ? festiveDate
                      : ''
                }
                label="Data festiva"
                onChange={e => {
                  const v = e.target.value as string;
                  if (v.startsWith('preset:')) {
                    // Preset móvel selecionado — runner resolverá pelo ano
                    setFestivePreset(v.slice('preset:'.length));
                    // Mantém festiveDate como placeholder visual da ocorrência
                    // atual mas o runner ignora quando festivePreset está setado.
                    const mmDd = resolvePresetMmDd(
                      v.slice('preset:'.length) as FestivePresetKey,
                      new Date().getFullYear(),
                    );
                    if (mmDd) setFestiveDate(mmDd);
                  } else {
                    // Preset fixo OU '' — limpa preset móvel se havia.
                    setFestivePreset('');
                    setFestiveDate(v);
                  }
                }}
                renderValue={(v) => {
                  if (typeof v !== 'string' || !v) return 'Customizada';
                  if (v.startsWith('preset:')) {
                    const movable = MOVABLE_PRESETS.find(p => `preset:${p.key}` === v);
                    return movable?.label ?? 'Móvel';
                  }
                  const fixed = FIXED_FESTIVE_DATES.find(p => p.value === v);
                  return fixed?.label ?? v;
                }}
              >
                {/* Móveis com label de cálculo dinâmico */}
                <MenuItem disabled value="">
                  <em className="text-[10px] uppercase tracking-wider text-slate-400">
                    Móveis (calculadas todo ano)
                  </em>
                </MenuItem>
                {MOVABLE_PRESETS.map(p => {
                  const nextOcc = nextOccurrenceOfPreset(p.key, new Date());
                  const ocLabel = nextOcc ? ` (próx: ${nextOcc.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })})` : '';
                  return (
                    <MenuItem key={p.key} value={`preset:${p.key}`}>
                      {p.label}{ocLabel}
                    </MenuItem>
                  );
                })}
                <MenuItem disabled value="">
                  <em className="text-[10px] uppercase tracking-wider text-slate-400">
                    Fixas (MM-DD constante)
                  </em>
                </MenuItem>
                {FIXED_FESTIVE_DATES.map(p => (
                  <MenuItem key={`fixed-${p.value}-${p.label}`} value={p.value}>
                    {p.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {/* Input livre MM-DD só faz sentido pra fixas. Móvel não tem MM-DD
                único (varia por ano), então o input fica readonly+informativo
                exibindo a data resolvida deste ano. */}
            <TextField
              label={festivePreset ? 'Data calculada (este ano)' : 'Ou MM-DD customizado'}
              value={festiveDate}
              onChange={e => {
                if (festivePreset) return; // readonly quando preset móvel
                setFestiveDate(e.target.value);
              }}
              placeholder="12-25"
              fullWidth
              size="small"
              disabled={!!festivePreset}
              error={!festivePreset && !/^\d{2}-\d{2}$/.test(festiveDate)}
              helperText={(() => {
                if (festivePreset) {
                  const movable = MOVABLE_PRESETS.find(p => p.key === festivePreset);
                  return `${movable?.label ?? festivePreset}: ${movable?.description ?? ''} Recalculado automaticamente todo ano.`;
                }
                if (/^\d{2}-\d{2}$/.test(festiveDate)) {
                  return `Disparo no dia ${festiveDate.slice(3, 5)}/${festiveDate.slice(0, 2)} todos os anos${daysBefore > 0 ? ` (${daysBefore}d antes)` : ''}.`;
                }
                return 'Use o formato MM-DD (ex: 12-25 para Natal).';
              })()}
            />
          </div>
        )}
      </ModernSection>

      <ModernSection icon={Cake} title="Identificação" meta={<ModernPill tone="slate">1</ModernPill>}>
        <TextField
          label="Nome da campanha"
          placeholder="ex: Promoção 10% no aniversário"
          value={name}
          onChange={e => setName(e.target.value)}
          fullWidth
          size="small"
          autoFocus
        />
        <FormControlLabel
          control={<Switch checked={enabled} onChange={e => setEnabled(e.target.checked)} size="small" />}
          label={<span className="text-sm">Campanha ativa (dispara automaticamente)</span>}
        />
      </ModernSection>

      <ModernSection
        icon={Clock}
        title="Quando dispara"
        meta={<ModernPill tone="blue">{dayLabel} · {String(sendAtHour).padStart(2, '0')}:00</ModernPill>}
      >
        <div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
            Antecedência: <span className="font-semibold">
              {(() => {
                const eventLabel = isFixedDate ? 'da data festiva' : 'do aniversário';
                if (daysBefore === 0) return `no dia ${eventLabel}`;
                return `${daysBefore} dia${daysBefore === 1 ? '' : 's'} antes ${eventLabel}`;
              })()}
            </span>
          </p>
          <Slider
            value={daysBefore}
            onChange={(_, v) => setDaysBefore(typeof v === 'number' ? v : 0)}
            min={0} max={30} step={1}
            marks={[{ value: 0, label: 'No dia' }, { value: 7, label: '7d' }, { value: 30, label: '30d' }]}
            valueLabelDisplay="auto"
            size="small"
          />
        </div>

        <FormControl fullWidth size="small">
          <InputLabel>Horário do envio</InputLabel>
          <Select
            value={sendAtHour}
            label="Horário do envio"
            onChange={e => setSendAtHour(Number(e.target.value))}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <MenuItem key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </ModernSection>

      <ModernSection
        icon={Send}
        title="Modo de envio"
        meta={<ModernPill tone={viaBaileys ? 'emerald' : 'blue'}>{channelLabel}</ModernPill>}
      >
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setViaBaileys(false)}
            className={cn(
              'flex-1 px-3 py-2 text-xs rounded-lg border-2 transition-colors text-left',
              !viaBaileys
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                : 'border-slate-200 dark:border-slate-700 hover:border-blue-300',
            )}
          >
            <p className="font-bold text-slate-900 dark:text-slate-100">WhatsApp Business (Cloud)</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Oficial Meta · requer template aprovado</p>
          </button>
          <button
            type="button"
            onClick={() => setViaBaileys(true)}
            className={cn(
              'flex-1 px-3 py-2 text-xs rounded-lg border-2 transition-colors text-left',
              viaBaileys
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                : 'border-slate-200 dark:border-slate-700 hover:border-emerald-300',
            )}
          >
            <p className="font-bold text-slate-900 dark:text-slate-100">WhatsApp Web (Baileys)</p>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Texto livre · sem template</p>
          </button>
        </div>

        {eligibleConnections.length > 1 && (
          <FormControl fullWidth size="small">
            <InputLabel>Enviar de</InputLabel>
            <Select
              value={connectionId}
              label="Enviar de"
              onChange={e => setConnectionId(e.target.value as string)}
            >
              {eligibleConnections.map(c => {
                const isUserOwned = c.ownerType === 'user';
                const ownerLabel = isUserOwned ? ' · pessoal' : ' · empresa';
                const phoneSuffix = c.phoneNumber ? ` (${c.phoneNumber})` : '';
                return (
                  <MenuItem key={c.id} value={c.id}>
                    {c.displayName}{phoneSuffix}{ownerLabel}
                  </MenuItem>
                );
              })}
            </Select>
          </FormControl>
        )}
        {eligibleConnections.length === 0 && (
          <div className="px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
            <p className="text-[10px] text-red-700 dark:text-red-400 leading-relaxed flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>
                Nenhum canal {viaBaileys ? 'Baileys' : 'Cloud'} conectado. Conecte um em
                Configurações → Canais antes de criar a campanha.
              </span>
            </p>
          </div>
        )}

        {viaBaileys ? (
          <TextField
            label="Mensagem"
            value={messageContent}
            onChange={e => setMessageContent(e.target.value)}
            fullWidth size="small" multiline minRows={3}
            helperText="Use {{name}} pra inserir o nome do cliente."
          />
        ) : (
          <TemplateSelector
            businessId={businessId}
            value={template}
            onChange={setTemplate}
            sampleRecipient={sampleRecipient}
            channel="whatsapp"
            csvColumns={[]}
          />
        )}
      </ModernSection>

      <ModernSection
        icon={Filter}
        title="Filtros (quem recebe)"
        meta={
          <ModernPill tone={todayMatchCount > 0 ? 'emerald' : 'slate'}>
            {todayMatchCount} hoje
          </ModernPill>
        }
      >
        {/* Callout principal: quando vai disparar de fato. Ajuda o operador a
            confirmar que a campanha está configurada certa antes de salvar. */}
        <div className={cn(
          'rounded-lg border px-3 py-2 text-[11px] leading-relaxed',
          todayMatchCount > 0
            ? 'bg-emerald-50/60 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
            : nextDispatchInfo
              ? 'bg-blue-50/60 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 text-blue-800 dark:text-blue-200'
              : 'bg-amber-50/60 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200',
        )}>
          {todayMatchCount > 0 ? (
            <>
              <strong>Vai disparar HOJE</strong> às {String(sendAtHour).padStart(2, '0')}:00 pra <strong>{todayMatchCount}</strong>{' '}
              {todayMatchCount === 1 ? 'pessoa' : 'pessoas'} (idempotente: cada uma recebe 1×/ano).
            </>
          ) : nextDispatchInfo ? (
            <>
              <strong>Próximo disparo:</strong>{' '}
              {nextDispatchInfo.date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}{' '}
              às {String(sendAtHour).padStart(2, '0')}:00 — <strong>{nextDispatchInfo.count}</strong>{' '}
              {nextDispatchInfo.count === 1 ? 'pessoa' : 'pessoas'}.
              {isFixedDate && <> Data festiva: <strong>{festiveLabel}</strong>.</>}
            </>
          ) : isFixedDate ? (
            <>
              <strong>Sem destinatários.</strong> Nenhum cliente passa nos filtros configurados.
              Ajuste os filtros abaixo pra incluir clientes na campanha.
            </>
          ) : (
            <>
              <strong>Sem disparo previsto.</strong> Nenhum cliente filtrado com{' '}
              <code className="bg-white/40 dark:bg-black/30 px-1 rounded">birthDate</code> válido.
              Verifique se os clientes têm a data preenchida no formato AAAA-MM-DD.
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {(() => {
              if (isFixedDate) {
                const main = `${previewCount} contato${previewCount !== 1 ? 's' : ''} no filtro`;
                return main;
              }
              const target = new Date();
              target.setDate(target.getDate() + daysBefore);
              const sameMonth = target.getMonth() === new Date().getMonth();
              const monthName = target.toLocaleDateString('pt-BR', { month: 'long' });
              const tail = sameMonth ? 'este mês' : `em ${monthName}`;
              const main = `${previewCount} aniversariante${previewCount !== 1 ? 's' : ''} ${tail}`;
              if (hasActiveFilters && totalInMonth !== previewCount) {
                return `${main} • ${totalInMonth} no total`;
              }
              return main;
            })()}
          </p>
          <button
            type="button"
            onClick={() => previewCount > 0 && setShowRecipients(s => !s)}
            disabled={previewCount === 0}
            className={cn(
              'text-[10px] text-amber-600 dark:text-amber-400 font-semibold',
              previewCount > 0 ? 'hover:underline cursor-pointer' : 'cursor-default opacity-50',
            )}
          >
            {previewCount > 0 && (showRecipients ? '▴ Ocultar' : '▾ Ver lista')}
          </button>
        </div>

        {showRecipients && previewCount > 0 && (
          <div className="rounded-lg border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/40 dark:bg-amber-500/[0.03] max-h-48 overflow-y-auto">
            <ul className="divide-y divide-amber-200/40 dark:divide-amber-500/10">
              {previewClients.map(c => {
                // Birthday: mostra DD/MM do aniversário. Fixed_date: não tem
                // data por-contato — exibe o tipo (PF/PJ) como contexto.
                const rightLabel = !isFixedDate && c.birthDate && c.birthDate.length >= 10
                  ? `${c.birthDate.slice(8, 10)}/${c.birthDate.slice(5, 7)}`
                  : c.tipo === 'pj' ? 'PJ' : 'PF';
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                  >
                    <span className="text-[12px] font-medium text-slate-800 dark:text-slate-100 truncate min-w-0 flex-1">
                      {c.name}
                    </span>
                    <span className="text-[10.5px] text-amber-700 dark:text-amber-400 font-mono flex-shrink-0">
                      {rightLabel}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <FormControl fullWidth size="small">
          <InputLabel>Tipo</InputLabel>
          <Select value={filterTipo} label="Tipo" onChange={e => setFilterTipo(e.target.value as 'pf' | 'pj' | 'all')}>
            <MenuItem value="all">Todos</MenuItem>
            <MenuItem value="pf">Pessoa Física</MenuItem>
            <MenuItem value="pj">Pessoa Jurídica</MenuItem>
          </Select>
        </FormControl>

        <FormControl fullWidth size="small">
          <InputLabel>Status (vazio = todos)</InputLabel>
          <Select
            multiple
            value={filterStatus}
            label="Status (vazio = todos)"
            onChange={e => setFilterStatus(typeof e.target.value === 'string' ? [] : e.target.value as LeadStatus[])}
            renderValue={(selected) => (selected as LeadStatus[]).map(s => STATUS_OPTIONS.find(o => o.value === s)?.label || s).join(', ')}
          >
            {STATUS_OPTIONS.map(s => (
              <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="Tags (separadas por vírgula, vazio = todas)"
          value={filterTagsInput}
          onChange={e => setFilterTagsInput(e.target.value)}
          fullWidth size="small"
          placeholder="ex: vip, recorrente"
        />
      </ModernSection>

      <ModernSection
        icon={ShieldCheck}
        title="Conformidade LGPD"
        meta={<ModernPill tone="emerald">LGPD</ModernPill>}
      >
        <FormControl fullWidth size="small">
          <InputLabel>Base legal LGPD</InputLabel>
          <Select value={consentBasis} label="Base legal LGPD" onChange={e => setConsentBasis(e.target.value as ConsentBasis)}>
            <MenuItem value="legitimate-interest">{CONSENT_BASIS_LABELS['legitimate-interest']}</MenuItem>
            <MenuItem value="transactional">{CONSENT_BASIS_LABELS['transactional']}</MenuItem>
            <MenuItem value="explicit">{CONSENT_BASIS_LABELS['explicit']}</MenuItem>
          </Select>
        </FormControl>
      </ModernSection>
    </ModernDialog>
  );
}
