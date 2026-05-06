'use client';

/**
 * BirthdayCampaignDialog — modal de criar/editar campanha recorrente de
 * aniversário. Diferente do BroadcastDetailDialog (one-shot, lista fixa):
 * é uma REGRA que o cron varre diariamente pra encontrar clientes cujo
 * `birthDate` bate com hoje + daysBeforeBirthday e dispara mensagem.
 *
 * NÃO dispara mensagens — só persiste a regra. Cron + send + idempotência
 * vêm em PR-C.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, FormControl, InputLabel, Button,
  FormControlLabel, Switch, Slider,
} from '@mui/material';
import { addDoc, updateDoc, doc, collection } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { toast } from 'react-toastify';
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

  // Reset / pre-fill quando abre. Dependência on `open` + editing.id evita
  // re-triggar em cada render do parent. O modal é unmount/remount via
  // `open` (Dialog do MUI), mas o useState mantém valor entre opens; este
  // effect garante reset limpo.
  useEffect(() => {
    if (!open) return;
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

  // Auto-seleciona quando há exatamente 1 — mesma lógica do dialog de Broadcast.
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

  // Preview: quantos clientes serão alvo no MÊS-ALVO (mês corrente +
  // daysBeforeBirthday). Antes preview ignorava o offset e mostrava só o
  // mês atual — operador com daysBefore=60 via "0 aniversariantes" mesmo
  // tendo lista cheia 2 meses à frente. Agora reflete a janela real.
  const filterTags = useMemo(() => filterTagsInput
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean), [filterTagsInput]);

  const previewCount = useMemo(() => {
    // Mês-alvo = mês de (hoje + daysBefore). Operador mudando o slider de
    // antecedência vê o preview se ajustar imediatamente.
    const target = new Date();
    target.setDate(target.getDate() + daysBefore);
    const targetMonth = target.getMonth() + 1;
    return clients.filter(c => {
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
    }).length;
  }, [clients, daysBefore, filterTipo, filterStatus, filterTags]);

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
      // Constrói payload removendo campos undefined — Firestore não aceita.
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

  // Sample contact pra preview do template — pega o primeiro cliente com
  // birthDate (representativo de quem vai receber). Vazio se não tiver.
  const sampleRecipient = useMemo(() => {
    const sample = clients.find(c => c.birthDate && c.tipo !== 'pj');
    if (!sample) return undefined;
    return {
      name: sample.name,
      phoneNumber: sample.phone || sample.whatsapp || '',
      email: sample.email || '',
    };
  }, [clients]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '1rem' } }}>
      <DialogTitle sx={{ fontWeight: 700, fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
        🎂 {editing ? 'Editar campanha de aniversariante' : 'Nova campanha de aniversariante'}
      </DialogTitle>
      <DialogContent className="space-y-4 !pt-2">
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          Esta campanha dispara automaticamente quando algum cliente faz aniversário.
          Use placeholders como <code className="bg-gray-100 dark:bg-white/[0.06] px-1 rounded">{'{{name}}'}</code> pra personalizar a mensagem.
        </p>

        <TextField
          label="Nome da campanha"
          placeholder="ex: Promoção 10% no aniversário"
          value={name} onChange={e => setName(e.target.value)} fullWidth size="small" autoFocus
        />

        <FormControlLabel
          control={<Switch checked={enabled} onChange={e => setEnabled(e.target.checked)} size="small" />}
          label={<span className="text-sm">Campanha ativa (dispara automaticamente)</span>}
        />

        {/* Quando dispara */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Quando dispara</p>

          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
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
        </div>

        {/* Canal */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Modo de envio</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setViaBaileys(false)}
              className={cn(
                'flex-1 px-3 py-2 text-xs rounded-lg border-2 transition-colors text-left',
                !viaBaileys
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                  : 'border-gray-200 dark:border-gray-700 hover:border-blue-300',
              )}
            >
              <p className="font-bold text-gray-900 dark:text-gray-100">WhatsApp Business (Cloud)</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Oficial Meta · requer template aprovado</p>
            </button>
            <button
              type="button"
              onClick={() => setViaBaileys(true)}
              className={cn(
                'flex-1 px-3 py-2 text-xs rounded-lg border-2 transition-colors text-left',
                viaBaileys
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                  : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300',
              )}
            >
              <p className="font-bold text-gray-900 dark:text-gray-100">WhatsApp Web (Baileys)</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Texto livre · sem template</p>
            </button>
          </div>
        </div>

        {/* Connection picker (>1) ou aviso (0) */}
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
            <p className="text-[10px] text-red-700 dark:text-red-400 leading-relaxed">
              Nenhum canal {viaBaileys ? 'Baileys' : 'Cloud'} conectado. Conecte um em
              Configurações → Canais antes de criar a campanha.
            </p>
          </div>
        )}

        {/* Conteúdo */}
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

        {/* Filtros — quem entra na campanha */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Filtros (quem recebe)</p>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
              {(() => {
                // Label do mês-alvo (mês de hoje + daysBefore). Quando
                // daysBefore=0 mostra "este mês"; antecedências grandes
                // mostram o nome do mês alvo pra o operador entender.
                const target = new Date();
                target.setDate(target.getDate() + daysBefore);
                const sameMonth = target.getMonth() === new Date().getMonth();
                const monthName = target.toLocaleDateString('pt-BR', { month: 'long' });
                const tail = sameMonth ? 'este mês' : `em ${monthName}`;
                return `~${previewCount} aniversariante${previewCount !== 1 ? 's' : ''} ${tail}`;
              })()}
            </span>
          </div>

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
        </div>

        {/* LGPD */}
        <FormControl fullWidth size="small">
          <InputLabel>Base legal LGPD</InputLabel>
          <Select value={consentBasis} label="Base legal LGPD" onChange={e => setConsentBasis(e.target.value as ConsentBasis)}>
            <MenuItem value="legitimate-interest">{CONSENT_BASIS_LABELS['legitimate-interest']}</MenuItem>
            <MenuItem value="transactional">{CONSENT_BASIS_LABELS['transactional']}</MenuItem>
            <MenuItem value="explicit">{CONSENT_BASIS_LABELS['explicit']}</MenuItem>
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions sx={{ padding: '12px 24px 16px' }}>
        <Button onClick={onClose} sx={{ color: 'rgb(107 114 128)' }}>Cancelar</Button>
        <Button
          onClick={handleSave}
          disabled={!canSave || saving}
          variant="contained"
          sx={{
            background: 'linear-gradient(to right, rgb(220 38 38), rgb(239 68 68))',
            textTransform: 'none', fontWeight: 600,
          }}
        >
          {saving ? 'Salvando…' : editing ? 'Atualizar' : 'Criar campanha'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
