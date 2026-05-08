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
import { addDoc, updateDoc, deleteDoc, doc, collection } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { toast } from 'react-toastify';
import { Cake, Clock, Send, Filter, ShieldCheck, Trash2, AlertTriangle } from 'lucide-react';
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

export default function BirthdayCampaignDialog({
  open, onClose, businessId, user, editing, availableConnections, clients,
}: Props) {
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
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
      setDaysBefore(0); setSendAtHour(9);
      setViaBaileys(false); setConnectionId('');
      setMessageContent(DEFAULT_MESSAGE); setTemplate(null);
      setFilterTipo('all'); setFilterStatus([]); setFilterTagsInput('');
      setConsentBasis('legitimate-interest');
      return;
    }
    setName(editing.name);
    setEnabled(editing.enabled);
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
  const eligibleConnections = useMemo(() => availableConnections.filter(c => {
    if (!c.isActive || !c.isConnected) return false;
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

  // Preview: aniversariantes no mês-alvo (mês corrente + daysBeforeBirthday).
  const totalInMonth = useMemo(() => {
    const target = new Date();
    target.setDate(target.getDate() + daysBefore);
    const targetMonth = target.getMonth() + 1;
    return clients.filter(c => {
      if (!c.birthDate || c.birthDate.length < 7) return false;
      const month = Number(c.birthDate.slice(5, 7));
      return month === targetMonth;
    }).length;
  }, [clients, daysBefore]);

  const previewClients = useMemo(() => {
    const target = new Date();
    target.setDate(target.getDate() + daysBefore);
    const targetMonth = target.getMonth() + 1;
    return clients
      .filter(c => {
        if (!c.birthDate || c.birthDate.length < 7) return false;
        const month = Number(c.birthDate.slice(5, 7));
        if (month !== targetMonth) return false;
        if (filterTipo !== 'all' && c.tipo !== filterTipo) return false;
        if (filterStatus.length && !filterStatus.includes(c.status)) return false;
        if (filterTags.length) {
          const cTags = (c.tags || []).map(t => t.toLowerCase());
          if (!filterTags.every(t => cTags.includes(t))) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const dayA = Number(a.birthDate!.slice(8, 10));
        const dayB = Number(b.birthDate!.slice(8, 10));
        return dayA - dayB;
      });
  }, [clients, daysBefore, filterTipo, filterStatus, filterTags]);
  const previewCount = previewClients.length;

  // Quantos disparam HOJE (MM-DD === hoje + daysBefore exato). Diferente do
  // preview mensal acima — que conta o mês inteiro pra dar visão geral. Esse
  // contador reflete o que o cron vai mandar se a campanha rodar agora.
  const todayMatchCount = useMemo(() => {
    const target = new Date();
    target.setDate(target.getDate() + daysBefore);
    const targetMm = String(target.getMonth() + 1).padStart(2, '0');
    const targetDd = String(target.getDate()).padStart(2, '0');
    const targetMmDd = `${targetMm}-${targetDd}`;
    return previewClients.filter(c => c.birthDate?.slice(5, 10) === targetMmDd).length;
  }, [previewClients, daysBefore]);

  // Próximo dia em que pelo menos UM cliente filtrado faz aniversário (com
  // o offset daysBefore aplicado). Útil pra mostrar ao operador "vai disparar
  // em DD/MM". Se não houver nenhum no próximo ano, volta null.
  const nextDispatchInfo = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Mapa de MM-DD → quantos clientes batem nesse dia (após filtros)
    const filtered = clients.filter(c => {
      if (!c.birthDate || c.birthDate.length < 10) return false;
      if (filterTipo !== 'all' && c.tipo !== filterTipo) return false;
      if (filterStatus.length && !filterStatus.includes(c.status)) return false;
      if (filterTags.length) {
        const cTags = (c.tags || []).map(t => t.toLowerCase());
        if (!filterTags.every(t => cTags.includes(t))) return false;
      }
      return true;
    });
    if (filtered.length === 0) return null;
    // Pra cada dia dos próximos 366 dias, calcula a data-alvo (date + daysBefore)
    // e verifica quantos clientes têm birthDate.MM-DD === target.MM-DD.
    for (let dayOffset = 0; dayOffset < 366; dayOffset++) {
      const runDate = new Date(today);
      runDate.setDate(runDate.getDate() + dayOffset);
      const targetDate = new Date(runDate);
      targetDate.setDate(targetDate.getDate() + daysBefore);
      const targetMm = String(targetDate.getMonth() + 1).padStart(2, '0');
      const targetDd = String(targetDate.getDate()).padStart(2, '0');
      const targetMmDd = `${targetMm}-${targetDd}`;
      const matches = filtered.filter(c => c.birthDate!.slice(5, 10) === targetMmDd).length;
      if (matches > 0) {
        return { date: runDate, count: matches };
      }
    }
    return null;
  }, [clients, daysBefore, filterTipo, filterStatus, filterTags]);

  const [showRecipients, setShowRecipients] = useState(false);

  const hasActiveFilters = filterTipo !== 'all' || filterStatus.length > 0 || filterTags.length > 0;

  const canSave = useMemo(() => {
    if (!name.trim()) return false;
    if (eligibleConnections.length > 0 && !connectionId) return false;
    if (viaBaileys) return messageContent.trim().length > 0;
    return isTemplateSelectionValid(template);
  }, [name, connectionId, eligibleConnections.length, viaBaileys, messageContent, template]);

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

      const payload: Partial<BirthdayCampaign> = {
        businessId,
        name: name.trim(),
        enabled,
        daysBeforeBirthday: daysBefore,
        sendAtHour,
        channel: 'whatsapp',
        viaBaileys,
        ...(connectionId ? { channelConnectionId: connectionId } : {}),
        ...(viaBaileys
          ? { messageContent: messageContent.trim() }
          : {
              templateName: template?.name,
              templateLanguage: template?.language,
              templateParams: template?.params,
              templateBody: template?.preview,
            }),
        filters: filtersClean,
        consentBasis,
        consentAcknowledgedAt: now,
        consentAcknowledgedBy: user.uid,
        updatedAt: now,
      };

      if (editing) {
        await updateDoc(doc(db, 'birthdayCampaigns', editing.id), payload);
        toast.success('Campanha atualizada');
      } else {
        await addDoc(collection(db, 'birthdayCampaigns'), {
          ...payload,
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

  return (
    <ModernDialog
      open={open}
      onClose={onClose}
      icon={Cake}
      title={editing ? 'Editar campanha de aniversariante' : 'Nova campanha de aniversariante'}
      maxWidth="sm"
      badges={
        editing
          ? <ModernPill tone={enabled ? 'emerald' : 'slate'}>{enabled ? 'Ativa' : 'Pausada'}</ModernPill>
          : undefined
      }
      subtitle={
        <>
          <ModernPill tone="amber"><Cake size={12} />Recorrente</ModernPill>
          <ModernPill tone="red"><Send size={12} />{channelLabel}</ModernPill>
          <ModernPill tone="blue"><Clock size={12} />{dayLabel} · {String(sendAtHour).padStart(2, '0')}:00</ModernPill>
          <ModernPill tone={todayMatchCount > 0 ? 'emerald' : 'slate'}>
            {todayMatchCount} hoje
          </ModernPill>
          <ModernPill tone="slate">{previewCount} no mês</ModernPill>
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
        Esta campanha dispara automaticamente quando algum cliente faz aniversário.
        Use placeholders como <code className="bg-slate-100 dark:bg-white/[0.06] px-1 rounded">{'{{name}}'}</code> pra personalizar a mensagem.
      </p>

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
              {daysBefore === 0 ? 'no dia do aniversário' : `${daysBefore} dia${daysBefore === 1 ? '' : 's'} antes`}
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
                const day = c.birthDate!.slice(8, 10);
                const month = c.birthDate!.slice(5, 7);
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                  >
                    <span className="text-[12px] font-medium text-slate-800 dark:text-slate-100 truncate min-w-0 flex-1">
                      {c.name}
                    </span>
                    <span className="text-[10.5px] text-amber-700 dark:text-amber-400 font-mono flex-shrink-0">
                      {day}/{month}
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
            <MenuItem value="pf">Pessoa Física (aniversário)</MenuItem>
            <MenuItem value="pj">Pessoa Jurídica (fundação)</MenuItem>
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
