'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, IconButton, Chip, Select, MenuItem, FormControl, InputLabel, Tooltip, Slider, InputAdornment,
} from '@mui/material';
import {
  Plus, Search, X, Phone, Mail, MessageSquare, Calendar, Clock, Edit3, Trash2,
  Users, DollarSign, TrendingUp, MoreVertical, Globe, Instagram, Facebook, Linkedin, Send,
  CheckCircle2, PhoneCall, Video, FileText, MessageCircle, BarChart3, Activity, Layers, Gauge,
  UserPlus, Briefcase, Tag, Hash, AlertTriangle, Heart, Shield, Zap, Brain,
  Sparkles, Filter, Crown, Settings2, GripVertical, Eye, EyeOff, ChevronUp, ChevronDown,
  Download, Upload, GitBranch, LayoutList, LayoutDashboard, Megaphone, Radio, SlidersHorizontal,
  Check, Link as LinkIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime, getInitials } from '@/lib/utils/format';
import { isActiveClient } from '@/lib/utils/clientFilters';
import { validateCPF, validateCNPJ } from '@/lib/utils/validators';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { db } from '@/lib/config/firebase';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot, increment, writeBatch, limit as firestoreLimit, deleteField } from 'firebase/firestore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CRMContact, CRMDeal, CRMPipelineStage, CRMStageConfig, CRMPipelineConfig, CRMActivity, CRMActivityType,
  LeadStatus, LeadSource, User, Broadcast, BroadcastStatus, BroadcastRecipient, Client, ContactProfile, CRMAuditAction,
  Segment, SegmentFilter, SegmentFilterGroup, SegmentFilterOperator, BroadcastAudienceType, BroadcastChannel, ConversationChannel,
  BroadcastList, ConsentBasis, SendThrottle, ThrottlePresetKey,
  BirthdayCampaign,
} from '@/lib/types';
import { CONSENT_BASIS_LABELS, THROTTLE_PRESETS } from '@/lib/types';
import { getAuth } from 'firebase/auth';
import { ROLE_HIERARCHY } from '@/lib/types';
import { resolveClientAudience, matchesAudienceFilterGroups, audienceTagsToFilterGroups } from '@/lib/campaigns/audience';

// ── Extracted sub-components ────────────────────────────────────────────────
import {
  PIPELINE_STAGES, SOURCE_LABELS, SOURCE_COLORS, STATUS_LABELS, STATUS_COLORS,
  ACTIVITY_LABELS, ACTIVITY_COLORS, ALL_SOURCES, ALL_STATUSES, ALL_ACTIVITY_TYPES,
  BROADCAST_STATUS_LABELS, ALL_PRESET_TAGS, getTagConfig, relativeTime,
  applyPhoneMask, stripPhoneMask, parseCurrencyInput, formatCurrencyInput,
  PROFILE_CONFIG, getScoreColor, getChurnLabel,
  DEFAULT_CRM_PIPELINE, getVisibleStages, getStageLabel, getWonStageId,
  type CRMTab,
} from './shared';
import RecipientListInput from './RecipientListInput';
import BroadcastDetailDialog from './BroadcastDetailDialog';
import BirthdayCampaignDialog from './BirthdayCampaignDialog';
import {
  ModernDialog, ModernDialogActions, ModernCancelButton, ModernPrimaryButton,
  ModernSection, ModernPill, type ModernPillTone,
} from '@/app/components/ui/dialog';
import TemplateSelector, { type TemplateSelection, isTemplateSelectionValid } from './TemplateSelector';
import EmailBodyEditor from './EmailBodyEditor';
import { KanbanBoard } from './KanbanBoard';
import { LeadTableView } from './LeadTableView';
import { LeadDetailPanel } from './LeadDetailPanel';
import CreateKanbanTaskDialog from './CreateKanbanTaskDialog';
import { ScheduleActionDialog } from './ScheduleActionDialog';
import AutomacoesTab from './AutomacoesTab';
import FormulariosTab from './FormulariosTab';
import MembershipsTab from './MembershipsTab';
import SequenciasTab from './SequenciasTab';
import { SourceIcon } from './SourceIcon';

// ── Tab Config ──────────────────────────────────────────────────────────────



// ── Activity Icons (JSX — can't live in shared.ts) ─────────────────────────

const ACTIVITY_ICONS: Record<CRMActivityType, React.ReactNode> = {
  ligacao: <PhoneCall size={14} />, email: <Mail size={14} />, reuniao: <Video size={14} />,
  whatsapp: <MessageCircle size={14} />, tarefa: <CheckCircle2 size={14} />,
  nota: <FileText size={14} />, proposta: <Send size={14} />,
};

// Small icon wrapper for JSX in tab config
const GitBranchIcon = () => <GitBranch size={15} />;

// ── Audit helper ────────────────────────────────────────────────────────────

async function logAudit(opts: {
  businessId: string;
  userId: string;
  userName: string;
  action: CRMAuditAction;
  contactId?: string;
  dealId?: string;
  details?: string;
}) {
  try {
    await addDoc(collection(db, 'crmAuditLog'), {
      businessId: opts.businessId,
      userId: opts.userId,
      userName: opts.userName,
      action: opts.action,
      contactId: opts.contactId ?? null,
      dealId: opts.dealId ?? null,
      details: opts.details ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch { /* audit failures must never break the main flow */ }
}

// ==========================================
// LOADING SKELETON
// ==========================================

function CRMSkeleton() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col gap-4 p-4 sm:p-5 lg:p-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-14 rounded-lg shimmer" />
          <div className="h-4 w-32 rounded-lg shimmer" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-36 rounded-xl shimmer" />
          <div className="h-9 w-28 rounded-xl shimmer" />
        </div>
      </div>
      {/* Nav skeleton */}
      <div className="flex gap-1 shrink-0">
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="h-9 w-28 rounded-lg shimmer" />
        ))}
      </div>
      {/* Content skeleton */}
      <div className="flex-1 grid grid-cols-7 gap-3 min-h-0">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="rounded-xl shimmer" />
        ))}
      </div>
    </motion.div>
  );
}

// ==========================================
// CONTACT FORM DIALOG
// ==========================================

function ContactFormDialog({ open, onClose, onSave, contact, members, stages }: {
  open: boolean; onClose: () => void; onSave: (data: Partial<CRMContact>) => Promise<void>; contact: CRMContact | null; members: User[]; stages: CRMStageConfig[];
}) {
  const { t } = useTranslation();
  const [tipo, setTipo] = useState<'pf' | 'pj'>('pf');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [inscricaoEstadual, setInscricaoEstadual] = useState('');
  const [source, setSource] = useState<LeadSource>('outro');
  const [status, setStatus] = useState<LeadStatus>('novo');
  const [score, setScore] = useState(0);
  const [assignedTo, setAssignedTo] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [preferredChannel, setPreferredChannel] = useState<string>('');
  const [profile, setProfile] = useState<string>('');
  const [suggestedAction, setSuggestedAction] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTipo(contact?.tipo ?? 'pf');
      setName(contact?.name ?? ''); setEmail(contact?.email ?? '');
      setPhone(contact?.phone ? applyPhoneMask(contact.phone) : '');
      setWhatsapp(contact?.whatsapp ? applyPhoneMask(contact.whatsapp) : '');
      setCompany(contact?.company ?? ''); setRole(contact?.role ?? '');
      setCpfCnpj(contact?.cpfCnpj ?? '');
      setNomeFantasia(contact?.nomeFantasia ?? '');
      setInscricaoEstadual(contact?.inscricaoEstadual ?? '');
      setSource(contact?.source ?? 'outro'); setStatus(contact?.status ?? 'novo');
      setScore(contact?.score ?? 0); setAssignedTo(contact?.assignedTo ?? '');
      setTags(contact?.tags?.join(', ') ?? ''); setNotes(contact?.notes ?? '');
      setPreferredChannel(contact?.preferredChannel ?? '');
      setProfile(contact?.profile ?? '');
      setSuggestedAction(contact?.suggestedAction ?? '');
      setShowAdvanced(!!(contact?.profile || contact?.suggestedAction || contact?.preferredChannel));
    }
  }, [open, contact]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    // Validação CPF/CNPJ se preenchido — espelha ClientsModule.tsx:1012-1014.
    // Permite vazio (campo opcional pra leads); só rejeita se foi digitado e inválido.
    const cpfCnpjRaw = cpfCnpj.trim();
    if (cpfCnpjRaw) {
      const isValid = tipo === 'pj' ? validateCNPJ(cpfCnpjRaw) : validateCPF(cpfCnpjRaw);
      if (!isValid) {
        toast.error(`${tipo === 'pj' ? 'CNPJ' : 'CPF'} inválido — confira os dígitos`);
        return;
      }
    }
    setSaving(true);
    try {
      const member = members.find((m) => m.id === assignedTo);
      const tagsList = tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      await onSave({
        tipo,
        name: name.trim(), email: email.trim() || undefined, phone: stripPhoneMask(phone) || undefined,
        whatsapp: stripPhoneMask(whatsapp) || undefined, role: role.trim() || undefined,
        cpfCnpj: cpfCnpjRaw || undefined,
        // PF-only: `company` é "empresa onde a pessoa trabalha" — não faz sentido
        // pra PJ (o contato JÁ é a empresa). Limpa no save pra evitar lixo.
        company: tipo === 'pf' ? (company.trim() || undefined) : undefined,
        // PJ-only: só persiste se tipo === 'pj' pra não poluir docs PF
        nomeFantasia: tipo === 'pj' ? (nomeFantasia.trim() || undefined) : undefined,
        inscricaoEstadual: tipo === 'pj' ? (inscricaoEstadual.trim() || undefined) : undefined,
        source, status, score, assignedTo: assignedTo || undefined, assignedToName: member?.name || undefined,
        tags: tagsList.length > 0 ? tagsList : undefined, notes: notes.trim() || undefined,
        preferredChannel: (preferredChannel as CRMContact['preferredChannel']) || undefined,
        profile: (profile as CRMContact['profile']) || undefined,
        suggestedAction: suggestedAction.trim() || undefined,
      });
    } finally { setSaving(false); }
  };

  return (
    <ModernDialog
      open={open}
      onClose={onClose}
      icon={UserPlus}
      title={contact ? t('crm.dialog.editContact', 'Editar Contato') : t('crm.dialog.newContact', 'Novo Contato')}
      maxWidth="sm"
      footer={
        <ModernDialogActions>
          <ModernCancelButton onClick={onClose}>{t('crm.action.cancel', 'Cancelar')}</ModernCancelButton>
          <ModernPrimaryButton onClick={handleSubmit} disabled={saving || !name.trim()}>
            {saving ? t('crm.action.saving', 'Salvando...') : contact ? t('crm.action.save', 'Salvar') : t('crm.action.createContact', 'Criar Contato')}
          </ModernPrimaryButton>
        </ModernDialogActions>
      }
    >
      <ModernSection icon={UserPlus} title="Identificação">
        {/* Toggle PF/PJ — controla quais campos aparecem (CPF vs CNPJ, nome
            fantasia, IE). Default 'pf' pra manter compatibilidade com o fluxo
            antigo de criação rápida de contato. */}
        <div className="flex items-center gap-2 p-1 bg-gray-100 dark:bg-white/[0.04] rounded-xl w-fit">
          <button type="button" onClick={() => setTipo('pf')}
            className={cn('px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              tipo === 'pf'
                ? 'bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300')}>
            Pessoa Física
          </button>
          <button type="button" onClick={() => setTipo('pj')}
            className={cn('px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              tipo === 'pj'
                ? 'bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300')}>
            Pessoa Jurídica
          </button>
        </div>
        <TextField label={tipo === 'pj' ? 'Razão Social *' : 'Nome *'} value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" />
        {tipo === 'pj' && (
          <TextField label="Nome Fantasia" value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} fullWidth size="small" />
        )}
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('crm.form.email', 'E-mail')} value={email} onChange={(e) => setEmail(e.target.value)} fullWidth size="small" type="email" />
          <TextField label={t('crm.form.phone', 'Telefone')} value={phone} onChange={(e) => setPhone(applyPhoneMask(e.target.value))} fullWidth size="small" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="WhatsApp" value={whatsapp} onChange={(e) => setWhatsapp(applyPhoneMask(e.target.value))} fullWidth size="small" />
          <TextField label={tipo === 'pj' ? 'CNPJ' : 'CPF'} value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} fullWidth size="small" />
        </div>
        {tipo === 'pj' ? (
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Inscrição Estadual" value={inscricaoEstadual} onChange={(e) => setInscricaoEstadual(e.target.value)} fullWidth size="small" />
            <TextField label={t('crm.form.role', 'Setor / Atuação')} value={role} onChange={(e) => setRole(e.target.value)} fullWidth size="small" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('crm.form.company', 'Empresa')} value={company} onChange={(e) => setCompany(e.target.value)} fullWidth size="small" />
            <TextField label={t('crm.form.role', 'Cargo')} value={role} onChange={(e) => setRole(e.target.value)} fullWidth size="small" />
          </div>
        )}
      </ModernSection>

      <ModernSection icon={Tag} title="Classificação">
        <div className="grid grid-cols-2 gap-3">
          <FormControl size="small" fullWidth><InputLabel>{t('crm.filter.source', 'Origem')}</InputLabel><Select value={source} onChange={(e) => setSource(e.target.value as LeadSource)} label={t('crm.form.source', 'Origem')}>{ALL_SOURCES.map((s) => <MenuItem key={s} value={s}>{t('crm.source.' + s, SOURCE_LABELS[s])}</MenuItem>)}</Select></FormControl>
          <FormControl size="small" fullWidth><InputLabel>{t('crm.form.status', 'Status')}</InputLabel><Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)} label={t('crm.form.status', 'Status')}>{stages.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}</Select></FormControl>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormControl size="small" fullWidth><InputLabel>{t('crm.form.assignedTo', 'Responsável')}</InputLabel><Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} label={t('crm.form.assignedTo', 'Responsável')}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem>{members.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}</Select></FormControl>
          <FormControl size="small" fullWidth><InputLabel>{t('crm.form.preferredChannel', 'Canal Preferido')}</InputLabel><Select value={preferredChannel} onChange={(e) => setPreferredChannel(e.target.value)} label={t('crm.form.preferredChannel', 'Canal Preferido')}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem><MenuItem value="whatsapp">WhatsApp</MenuItem><MenuItem value="facebook">Messenger</MenuItem><MenuItem value="instagram">Instagram</MenuItem></Select></FormControl>
        </div>
        <FormControl size="small" fullWidth><InputLabel>{t('crm.form.profile', 'Perfil')}</InputLabel><Select value={profile} onChange={(e) => setProfile(e.target.value)} label={t('crm.form.profile', 'Perfil')}><MenuItem value="">{t('crm.form.auto', 'Auto')}</MenuItem><MenuItem value="vip">👑 VIP</MenuItem><MenuItem value="regular">● {t('crm.profile.regular', 'Regular')}</MenuItem><MenuItem value="sporadic">◌ {t('crm.profile.sporadic', 'Esporádico')}</MenuItem><MenuItem value="new">✦ {t('crm.profile.new', 'Novo')}</MenuItem><MenuItem value="at_risk">⚠ {t('crm.profile.risk', 'Em Risco')}</MenuItem><MenuItem value="churned">✕ {t('crm.profile.churn', 'Perdido')}</MenuItem></Select></FormControl>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/35 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Score</p>
            <ModernPill tone={score >= 80 ? 'emerald' : score >= 50 ? 'amber' : 'slate'}>{score}</ModernPill>
          </div>
          <Slider value={score} onChange={(_, v) => setScore(v as number)} min={0} max={100} step={5} sx={{ color: score >= 80 ? '#10B981' : score >= 50 ? '#F59E0B' : '#94A3B8' }} />
        </div>
      </ModernSection>

      <ModernSection icon={FileText} title="Notas & Inteligência">
        <TextField label="Tags (separadas por vírgula)" value={tags} onChange={(e) => setTags(e.target.value)} fullWidth size="small" placeholder="quente, tem interesse" />
        <TextField label={t('crm.form.notes', 'Observações')} value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth size="small" multiline rows={2} />
        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors">
          <Zap size={13} />
          {showAdvanced ? t('crm.action.hideIntelligence', 'Ocultar campos de inteligência ▲') : t('crm.action.showIntelligence', 'Campos de inteligência ▼')}
        </button>
        {showAdvanced && (
          <div className="space-y-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.06]">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t('crm.form.aiData', 'Dados para Agente IA')}</p>
            <TextField label={t('crm.form.suggestedAction', 'Próxima ação sugerida')} value={suggestedAction} onChange={(e) => setSuggestedAction(e.target.value)} fullWidth size="small" placeholder={t('crm.form.suggestedActionPlaceholder', 'Ligar para reativar, oferecer desconto...')} />
          </div>
        )}
      </ModernSection>
    </ModernDialog>
  );
}

// ==========================================
// DEAL FORM DIALOG
// ==========================================

function DealFormDialog({ open, onClose, onSave, deal, contacts, members }: {
  open: boolean; onClose: () => void; onSave: (data: Partial<CRMDeal>) => Promise<void>; deal: CRMDeal | null; contacts: CRMContact[]; members: User[];
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(''); const [contactId, setContactId] = useState(''); const [valueStr, setValueStr] = useState('');
  const [stage, setStage] = useState('prospeccao'); const [probability, setProbability] = useState(10);
  const [expectedCloseDate, setExpectedCloseDate] = useState(''); const [assignedTo, setAssignedTo] = useState('');
  const [notes, setNotes] = useState(''); const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setTitle(deal?.title ?? ''); setContactId(deal?.contactId ?? ''); setValueStr(deal?.value ? formatCurrencyInput(deal.value) : ''); setStage(deal?.stage ?? 'prospeccao'); setProbability(deal?.probability ?? 10); setExpectedCloseDate(deal?.expectedCloseDate ?? ''); setAssignedTo(deal?.assignedTo ?? ''); setNotes(deal?.notes ?? ''); }
  }, [open, deal]);

  const handleStageChange = (ns: string) => { setStage(ns); const s = PIPELINE_STAGES.find((s) => s.id === ns); if (s) setProbability(s.probability); };

  const handleSubmit = async () => {
    if (!title.trim() || !contactId) return; setSaving(true);
    try { const sc = contacts.find((c) => c.id === contactId); const member = members.find((m) => m.id === assignedTo); await onSave({ title: title.trim(), contactId, contactName: sc?.name ?? '', value: parseCurrencyInput(valueStr), stage, probability, expectedCloseDate: expectedCloseDate || undefined, assignedTo: assignedTo || undefined, assignedToName: member?.name || undefined, notes: notes.trim() || undefined }); }
    finally { setSaving(false); }
  };

  return (
    <ModernDialog
      open={open}
      onClose={onClose}
      icon={Briefcase}
      title={deal ? t('crm.dialog.editDeal', 'Editar Deal') : t('crm.dialog.newDeal', 'Novo Deal')}
      maxWidth="sm"
      footer={
        <ModernDialogActions>
          <ModernCancelButton onClick={onClose}>{t('crm.action.cancel', 'Cancelar')}</ModernCancelButton>
          <ModernPrimaryButton onClick={handleSubmit} disabled={saving || !title.trim() || !contactId}>
            {saving ? t('crm.action.saving', 'Salvando...') : deal ? t('crm.action.save', 'Salvar') : t('crm.action.createDeal', 'Criar Deal')}
          </ModernPrimaryButton>
        </ModernDialogActions>
      }
    >
      <ModernSection icon={Briefcase} title="Sobre o deal">
        <TextField label={t('crm.form.titleReq', 'Título *')} value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" />
        <FormControl size="small" fullWidth><InputLabel>{t('crm.form.contactReq', 'Contato *')}</InputLabel><Select value={contactId} onChange={(e) => setContactId(e.target.value)} label={t('crm.form.contactReq', 'Contato *')}>{contacts.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}{c.company ? ` - ${c.company}` : ''}</MenuItem>)}</Select></FormControl>
        <FormControl size="small" fullWidth><InputLabel>{t('crm.form.assignedTo', 'Responsável')}</InputLabel><Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} label={t('crm.form.assignedTo', 'Responsável')}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem>{members.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}</Select></FormControl>
        <TextField label={t('crm.form.notes', 'Observações')} value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth size="small" multiline rows={3} />
      </ModernSection>

      <ModernSection icon={DollarSign} title="Valor & Etapa">
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t('crm.form.value', 'Valor (R$)')} value={valueStr} onChange={(e) => setValueStr(e.target.value)} fullWidth size="small" placeholder="0,00" />
          <FormControl size="small" fullWidth><InputLabel>{t('crm.form.stage', 'Etapa')}</InputLabel><Select value={stage} onChange={(e) => handleStageChange(e.target.value)} label={t('crm.form.stage', 'Etapa')}>{PIPELINE_STAGES.map((s) => (<MenuItem key={s.id} value={s.id}><div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />{t('crm.stage.' + s.id, s.name)}</div></MenuItem>))}</Select></FormControl>
        </div>
        <div className="grid grid-cols-2 gap-3 items-start">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/35 px-3 py-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('crm.form.prob', 'Probabilidade')}</p>
              <ModernPill tone={probability >= 70 ? 'emerald' : probability >= 40 ? 'amber' : 'slate'}>{probability}%</ModernPill>
            </div>
            <Slider value={probability} onChange={(_, v) => setProbability(v as number)} min={0} max={100} step={5} sx={{ color: '#DC2626', mt: 0.5 }} />
          </div>
          <TextField label={t('crm.form.expectedCloseDate', 'Previsão de Fechamento')} value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} fullWidth size="small" type="date" InputLabelProps={{ shrink: true }} inputProps={{ min: new Date().toISOString().split('T')[0] }} />
        </div>
      </ModernSection>
    </ModernDialog>
  );
}

// ==========================================
// ACTIVITY FORM DIALOG
// ==========================================

function ActivityFormDialog({ open, onClose, onSave, activity, contacts, deals, members, defaultContactId }: {
  open: boolean; onClose: () => void; onSave: (data: Partial<CRMActivity>) => Promise<void>; activity: CRMActivity | null; contacts: CRMContact[]; deals: CRMDeal[]; members: User[];
  /** Pré-preenche o contato ao criar uma nova interação. Usado quando o dialog
   *  é aberto a partir do LeadDetailPanel — operador não precisa selecionar o
   *  contato de novo. Ignorado quando `activity` está presente (modo edição). */
  defaultContactId?: string;
}) {
  const { t } = useTranslation();
  // Default 'ligacao' — antes era 'tarefa', mas tarefas migraram pro Kanban
  // (Activities = log de INTERAÇÕES; Kanban = workflow com prazo). Quando
  // editing uma activity legacy do tipo 'tarefa', o select preserva o valor
  // mesmo sem aparecer em ALL_ACTIVITY_TYPES (MUI não filtra value desconhecido).
  const [type, setType] = useState<CRMActivityType>('ligacao'); const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [contactId, setContactId] = useState(''); const [dealId, setDealId] = useState(''); const [scheduledAt, setScheduledAt] = useState('');
  const [assignedTo, setAssignedTo] = useState(''); const [duration, setDuration] = useState(''); const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setType(activity?.type ?? 'ligacao'); setTitle(activity?.title ?? ''); setDescription(activity?.description ?? ''); setContactId(activity?.contactId ?? defaultContactId ?? ''); setDealId(activity?.dealId ?? ''); setScheduledAt(activity?.scheduledAt ? activity.scheduledAt.slice(0, 16) : ''); setAssignedTo(activity?.assignedTo ?? ''); setDuration(activity?.duration ? String(activity.duration) : ''); }
  }, [open, activity, defaultContactId]);

  const handleSubmit = async () => {
    if (!title.trim()) return; setSaving(true);
    try { const sc = contacts.find((c) => c.id === contactId); const sd = deals.find((d) => d.id === dealId); const member = members.find((m) => m.id === assignedTo); await onSave({ type, title: title.trim(), description: description.trim() || undefined, contactId: contactId || undefined, contactName: sc?.name || undefined, dealId: dealId || undefined, dealTitle: sd?.title || undefined, scheduledAt: scheduledAt || undefined, assignedTo: assignedTo || undefined, assignedToName: member?.name || undefined, duration: duration ? parseInt(duration, 10) : undefined, ...(activity ? {} : { isCompleted: false }) }); }
    finally { setSaving(false); }
  };

  return (
    <ModernDialog
      open={open}
      onClose={onClose}
      icon={Activity}
      title={activity ? t('crm.dialog.editActivity', 'Editar Atividade') : t('crm.dialog.newActivity', 'Nova Atividade')}
      maxWidth="sm"
      footer={
        <ModernDialogActions>
          <ModernCancelButton onClick={onClose}>{t('crm.action.cancel', 'Cancelar')}</ModernCancelButton>
          <ModernPrimaryButton onClick={handleSubmit} disabled={saving || !title.trim()}>
            {saving ? t('crm.action.saving', 'Salvando...') : activity ? t('crm.action.save', 'Salvar') : t('crm.action.createActivity', 'Criar Atividade')}
          </ModernPrimaryButton>
        </ModernDialogActions>
      }
    >
      <ModernSection icon={Activity} title="Detalhes">
        <FormControl size="small" fullWidth><InputLabel>{t('crm.form.type', 'Tipo')}</InputLabel><Select value={type} onChange={(e) => setType(e.target.value as CRMActivityType)} label={t('crm.form.type', 'Tipo')}>{ALL_ACTIVITY_TYPES.map((typeKey) => (<MenuItem key={typeKey} value={typeKey}><div className="flex items-center gap-2"><span style={{ color: ACTIVITY_COLORS[typeKey] }}>{ACTIVITY_ICONS[typeKey]}</span>{t('crm.activity.' + typeKey, ACTIVITY_LABELS[typeKey])}</div></MenuItem>))}</Select></FormControl>
        <TextField label={t('crm.form.titleReq', 'Título *')} value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" />
        <TextField label={t('crm.form.desc', 'Descrição')} value={description} onChange={(e) => setDescription(e.target.value)} fullWidth size="small" multiline rows={2} />
      </ModernSection>

      <ModernSection icon={Calendar} title="Contexto & Agendamento">
        <div className="grid grid-cols-2 gap-3">
          <FormControl size="small" fullWidth><InputLabel>Contato</InputLabel><Select value={contactId} onChange={(e) => setContactId(e.target.value)} label="Contato"><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem>{contacts.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl>
          <FormControl size="small" fullWidth><InputLabel>{t('crm.form.deal', 'Deal')}</InputLabel><Select value={dealId} onChange={(e) => setDealId(e.target.value)} label={t('crm.form.deal', 'Deal')}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem>{deals.map((d) => <MenuItem key={d.id} value={d.id}>{d.title}</MenuItem>)}</Select></FormControl>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t('crm.form.dateTime', 'Data/Hora')}
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            fullWidth size="small"
            type="datetime-local"
            InputLabelProps={{ shrink: true }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Calendar size={15} className={cn(scheduledAt ? 'text-emerald-500' : 'text-slate-400')} />
                </InputAdornment>
              ),
            }}
          />
          <TextField
            label={t('crm.form.duration', 'Duração (min)')}
            value={duration}
            onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))}
            fullWidth size="small"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Clock size={15} className="text-slate-400" />
                </InputAdornment>
              ),
            }}
          />
        </div>
        <FormControl size="small" fullWidth><InputLabel>{t('crm.form.assignedTo', 'Responsável')}</InputLabel><Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} label={t('crm.form.assignedTo', 'Responsável')}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem>{members.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}</Select></FormControl>
      </ModernSection>
    </ModernDialog>
  );
}

// ==========================================
// DELETE CONFIRM DIALOG
// ==========================================

function DeleteConfirmDialog({ open, title, message, onClose, onConfirm }: { open: boolean; title: string; message: string; onClose: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}><div className="flex items-center gap-2"><div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center"><AlertTriangle size={18} className="text-red-600 dark:text-red-400" /></div><span className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{title}</span></div></DialogTitle>
      <DialogContent><p className="text-sm text-gray-500 dark:text-gray-400">{message}</p></DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={loading} sx={{ borderRadius: '10px', textTransform: 'none' }}>{t('crm.action.cancel', 'Cancelar')}</Button>
        <Button onClick={async () => { setLoading(true); try { await onConfirm(); } finally { setLoading(false); } }} disabled={loading} variant="contained" color="error" sx={{ borderRadius: '10px', textTransform: 'none' }}>{loading ? t('crm.action.deleting', 'Excluindo...') : t('crm.action.delete', 'Excluir')}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ==========================================
// METRICS TAB — Intelligence Dashboard
// ==========================================

const ROTTING_DAYS_THRESHOLD = 7;

function MetricsTab({ deals, contacts, activities, stages, isDark, metrics, wonStatusId = 'ganho' }: {
  deals: CRMDeal[]; contacts: CRMContact[]; activities: CRMActivity[]; stages: CRMPipelineStage[]; isDark: boolean;
  metrics: { totalValue: number; weightedValue: number; avgDealSize: number; activeDeals: number; conversionRate: number; wonValue: number; wonDeals: number; rottingCount: number };
  wonStatusId?: LeadStatus;
}) {
  const { t } = useTranslation();
  const funnelData = useMemo(() => stages.map((s) => { const sd = deals.filter((d) => d.stage === s.id); return { name: t('crm.stage.' + s.id, s.name), value: sd.length, dealValue: sd.reduce((a, d) => a + d.value, 0), fill: s.color }; }), [deals, stages, t]);
  const sourceData = useMemo(() => { const c: Record<string, number> = {}; contacts.forEach((ct) => { c[ct.source] = (c[ct.source] || 0) + 1; }); return Object.entries(c).map(([s, v]) => ({ name: t('crm.source.' + s, SOURCE_LABELS[s as LeadSource] || s), value: v, color: SOURCE_COLORS[s as LeadSource] || '#6B7280' })).sort((a, b) => b.value - a.value); }, [contacts, t]);

  // ── Rotting deals ──────────────────────────────────────────
  const rottingDeals = useMemo(() => {
    const cutoff = Date.now() - ROTTING_DAYS_THRESHOLD * 86_400_000;
    return deals
      .filter(d => !d.closedDate && new Date(d.updatedAt).getTime() < cutoff)
      .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
      .slice(0, 6);
  }, [deals]);

  // ── Revenue forecast (next 6 months) ──────────────────────
  const forecastData = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return { key, label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), weighted: 0, optimistic: 0 };
    });
    for (const deal of deals) {
      if (!deal.expectedCloseDate || deal.closedDate) continue;
      const key = deal.expectedCloseDate.slice(0, 7);
      const m = months.find(m => m.key === key);
      if (m) {
        m.weighted  += deal.value * (deal.probability / 100);
        m.optimistic += deal.value;
      }
    }
    return months;
  }, [deals]);

  const hasForecast = forecastData.some(m => m.weighted > 0 || m.optimistic > 0);
  const convRate = contacts.length > 0 ? ((contacts.filter((c) => c.status === wonStatusId).length / contacts.length) * 100).toFixed(1) : '0';
  const avgScore = contacts.length > 0 ? (contacts.reduce((s, c) => s + (c.scores?.overall ?? c.score), 0) / contacts.length).toFixed(0) : '0';
  const tooltipStyle = { borderRadius: '12px', border: isDark ? '1px solid #374151' : '1px solid #E2E8F0', backgroundColor: isDark ? '#111827' : '#fff', color: isDark ? '#F1F5F9' : '#0F172A' };

  // ── Scoring analytics ─────────────────────────────────────
  const profileDistribution = useMemo(() => {
    const profileKeyMap: Record<string, string> = { vip: 'vip', regular: 'regular', sporadic: 'sporadic', new: 'new', at_risk: 'risk', churned: 'churn' };
    const dist: Record<string, number> = {};
    contacts.forEach((c) => { const p = c.profile || 'new'; dist[p] = (dist[p] || 0) + 1; });
    return Object.entries(dist).map(([profile, count]) => {
      const cfg = PROFILE_CONFIG[profile as ContactProfile] || PROFILE_CONFIG.new;
      const tKey = profileKeyMap[profile] || profile;
      return { profile, label: t('crm.profile.' + tKey, cfg.label), emoji: cfg.emoji, count, pct: contacts.length > 0 ? Math.round((count / contacts.length) * 100) : 0 };
    }).sort((a, b) => b.count - a.count);
  }, [contacts, t]);

  const churnRiskContacts = useMemo(() =>
    contacts.filter((c) => c.scores && c.scores.churnRisk >= 60)
      .sort((a, b) => (b.scores?.churnRisk ?? 0) - (a.scores?.churnRisk ?? 0))
      .slice(0, 5),
  [contacts]);

  const topValueContacts = useMemo(() =>
    contacts.filter((c) => c.totalSpent && c.totalSpent > 0)
      .sort((a, b) => (b.totalSpent ?? 0) - (a.totalSpent ?? 0))
      .slice(0, 5),
  [contacts]);

  const pendingActions = useMemo(() =>
    contacts.filter((c) => c.suggestedAction).slice(0, 6),
  [contacts]);

  const avgChurn = contacts.length > 0
    ? (contacts.reduce((s, c) => s + (c.scores?.churnRisk ?? 0), 0) / contacts.length).toFixed(0)
    : '0';

  const avgLoyalty = contacts.length > 0
    ? (contacts.reduce((s, c) => s + (c.scores?.loyalty ?? 0), 0) / contacts.length).toFixed(0)
    : '0';

  if (deals.length === 0 && contacts.length === 0) return <div className="flex flex-col items-center justify-center py-20 text-gray-400"><BarChart3 size={28} className="mb-4" /><p className="text-sm font-medium">{t('crm.metrics.noData', 'Sem dados para exibir')}</p></div>;

  return (
    <div className="space-y-6">
      {/* ── KPI Cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[
          { label: t('crm.metrics.conversion', 'Conversão'), value: `${convRate}%`, icon: <TrendingUp size={18} />, c: 'emerald' },
          { label: t('crm.metrics.avgScore', 'Score Médio'), value: avgScore, icon: <Gauge size={18} />, c: 'amber' },
          { label: t('crm.metrics.totalLeads', 'Total Leads'), value: String(contacts.length), icon: <Users size={18} />, c: 'blue' },
          { label: t('crm.metrics.wonValue', 'Valor Ganho'), value: formatCurrency(metrics.wonValue), icon: <DollarSign size={18} />, c: 'red' },
          { label: t('crm.metrics.rottingDeals', 'Deals Parados'), value: String(metrics.rottingCount), icon: <Clock size={18} />, c: metrics.rottingCount > 0 ? 'orange' : 'emerald' },
          { label: t('crm.metrics.weightedPipeline', 'Pipeline Ponderado'), value: formatCurrency(metrics.weightedValue), icon: <BarChart3 size={18} />, c: 'purple' },
        ].map((card, i) => {
          const cm: Record<string, { bg: string; txt: string }> = {
            emerald: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', txt: 'text-emerald-600 dark:text-emerald-400' },
            amber: { bg: 'bg-amber-50 dark:bg-amber-500/10', txt: 'text-amber-600 dark:text-amber-400' },
            blue: { bg: 'bg-blue-50 dark:bg-blue-500/10', txt: 'text-blue-600 dark:text-blue-400' },
            red: { bg: 'bg-red-50 dark:bg-red-500/10', txt: 'text-red-600 dark:text-red-400' },
            purple: { bg: 'bg-purple-50 dark:bg-purple-500/10', txt: 'text-purple-600 dark:text-purple-400' },
            orange: { bg: 'bg-orange-50 dark:bg-orange-500/10', txt: 'text-orange-600 dark:text-orange-400' },
          };
          const cc = cm[card.c] || cm.blue;
          return (
            <motion.div key={card.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-2xl p-4">
              <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-2.5', cc.bg, cc.txt)}>{card.icon}</div>
              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium mb-0.5">{card.label}</p>
              <p className="text-lg font-display font-bold text-gray-900 dark:text-gray-100">{card.value}</p>
            </motion.div>
          );
        })}
      </div>

      {/* ── Row 2: Funnel + Source ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-2xl p-5">
          <h3 className="text-base font-display font-bold text-gray-900 dark:text-gray-100 mb-4">{t('crm.metrics.funnel', 'Funil de Vendas')}</h3>
          <div className="space-y-3">{funnelData.map((s, i) => { const mx = Math.max(...funnelData.map((x) => x.value), 1); return <div key={s.name} className="flex items-center gap-3"><span className="text-sm text-gray-600 dark:text-gray-400 font-medium w-28 shrink-0">{s.name}</span><div className="flex-1 h-8 bg-gray-50 dark:bg-white/[0.02] rounded-lg overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${(s.value / mx) * 100}%` }} transition={{ duration: 0.6, delay: 0.3 + i * 0.1 }} className="h-full rounded-lg flex items-center px-3" style={{ backgroundColor: s.fill }}>{s.value > 0 && <span className="text-xs font-bold text-white">{s.value}</span>}</motion.div></div><span className="text-xs text-gray-400 font-medium w-20 text-right">{formatCurrency(s.dealValue)}</span></div>; })}</div>
        </div>
        {sourceData.length > 0 && (
          <div className="bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-2xl p-5">
            <h3 className="text-base font-display font-bold text-gray-900 dark:text-gray-100 mb-4">{t('crm.metrics.leadSource', 'Origem dos Leads')}</h3>
            <div className="flex items-center gap-6"><ResponsiveContainer width={150} height={150}><PieChart><Pie data={sourceData} cx="50%" cy="50%" innerRadius={40} outerRadius={68} paddingAngle={2} dataKey="value">{sourceData.map((e, i) => <Cell key={i} fill={e.color} />)}</Pie><RechartsTooltip contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer><div className="flex-1 space-y-2">{sourceData.map((s) => <div key={s.name} className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} /><span className="text-sm text-gray-600 dark:text-gray-400">{s.name}</span></div><span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{s.value}</span></div>)}</div></div>
          </div>
        )}
      </div>

      {/* ── Row 3: Segmentation + Churn Risk + Top Value ────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Profile Distribution */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center"><Shield size={16} className="text-purple-500" /></div>
            <h3 className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{t('crm.metrics.segmentation', 'Segmentação')}</h3>
          </div>
          <div className="space-y-3">
            {profileDistribution.map((p) => (
              <div key={p.profile} className="flex items-center gap-3">
                <span className="text-base w-6 text-center">{p.emoji}</span>
                <span className="text-sm text-gray-600 dark:text-gray-400 w-24">{p.label}</span>
                <div className="flex-1 h-5 bg-gray-50 dark:bg-white/[0.02] rounded-md overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${p.pct}%` }} transition={{ duration: 0.5 }}
                    className="h-full rounded-md bg-gradient-to-r from-red-500/70 to-red-500/40" />
                </div>
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 w-8 text-right">{p.count}</span>
              </div>
            ))}
            {profileDistribution.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">{t('crm.metrics.noProfileData', 'Sem dados de perfil')}</p>}
          </div>
        </motion.div>

        {/* Churn Risk Alerts */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl bg-orange-500/10 flex items-center justify-center"><AlertTriangle size={16} className="text-orange-500" /></div>
            <h3 className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{t('crm.metrics.churnRisk', 'Risco de Churn')}</h3>
          </div>
          <div className="space-y-2.5">
            {churnRiskContacts.map((c) => {
              const churnRisk = c.scores?.churnRisk ?? 0;
              const cl = getChurnLabel(churnRisk);
              return (
                <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.04]">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300">
                    {getInitials(c.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.suggestedAction || t('crm.metrics.reactivate', 'Reativar contato')}</p>
                  </div>
                  <span className={cn('text-xs font-bold px-2 py-1 rounded-md shrink-0', cl.bg, cl.color)}>
                    {churnRisk}%
                  </span>
                </div>
              );
            })}
            {churnRiskContacts.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">{t('crm.metrics.noRiskContact', 'Nenhum contato em risco')}</p>}
          </div>
        </motion.div>

        {/* Top Value Clients */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center"><DollarSign size={16} className="text-emerald-500" /></div>
            <h3 className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{t('crm.metrics.topClients', 'Top Clientes (Valor)')}</h3>
          </div>
          <div className="space-y-2.5">
            {topValueContacts.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.04]">
                <div className={cn('w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold',
                  i === 0 ? 'bg-amber-500/15 text-amber-600' : i === 1 ? 'bg-gray-300/30 text-gray-500' : i === 2 ? 'bg-orange-500/15 text-orange-500' : 'bg-gray-100 dark:bg-gray-800 text-gray-400')}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{c.name}</p>
                  {c.relationshipHistory?.servicesContracted?.[0] && (
                    <p className="text-xs text-gray-400 truncate">{c.relationshipHistory.servicesContracted[0]}</p>
                  )}
                </div>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                  {formatCurrency(c.totalSpent ?? 0)}
                </span>
              </div>
            ))}
            {topValueContacts.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">{t('crm.metrics.noValueData', 'Sem dados de valor')}</p>}
          </div>
        </motion.div>
      </div>

      {/* ── Row 4: Forecast de Receita ────────────────────────── */}
      {hasForecast && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center"><TrendingUp size={16} className="text-blue-500" /></div>
              <div>
                <h3 className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{t('crm.metrics.forecast', 'Previsão de Receita')}</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">{t('crm.metrics.forecastSub', 'Próximos 6 meses · valor ponderado pela probabilidade')}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">{t('crm.metrics.forecastTotal', 'Total esperado')}</p>
              <p className="text-sm font-bold text-blue-600 dark:text-blue-400">
                {formatCurrency(forecastData.reduce((s, m) => s + m.weighted, 0))}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 mb-3 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" />Esperado (ponderado)</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-200 dark:bg-blue-500/20 inline-block" />Otimista (100%)</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={forecastData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1F2937' : '#F3F4F6'} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: isDark ? '#6B7280' : '#9CA3AF' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: isDark ? '#6B7280' : '#9CA3AF' }} axisLine={false} tickLine={false}
                tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <RechartsTooltip contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [formatCurrency(value), name === 'optimistic' ? 'Otimista' : 'Esperado']} />
              <Bar dataKey="optimistic" fill={isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.12)'} radius={[4, 4, 0, 0]} />
              <Bar dataKey="weighted" fill="#3B82F6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {forecastData.every(m => m.weighted === 0) && deals.some(d => !d.expectedCloseDate && !d.closedDate) && (
            <p className="text-[10px] text-gray-400 text-center mt-2">
              {t('crm.metrics.forecastHint', 'Defina uma data de fechamento nos deals para aparecer aqui')}
            </p>
          )}
        </motion.div>
      )}

      {/* ── Row 5: Rotting Deals ──────────────────────────────── */}
      {rottingDeals.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
          className="bg-white dark:bg-[#111827] border border-orange-200/60 dark:border-orange-500/20 rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl bg-orange-500/10 flex items-center justify-center"><Clock size={16} className="text-orange-500" /></div>
            <div>
              <h3 className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{t('crm.metrics.rottingDeals', 'Deals Parados')}</h3>
              <p className="text-[10px] text-gray-400 mt-0.5">{t('crm.metrics.rottingDealsSub', `Sem atualização há mais de ${ROTTING_DAYS_THRESHOLD} dias`)}</p>
            </div>
            <span className="ml-auto text-xs font-semibold text-orange-600 dark:text-orange-400 bg-orange-500/10 px-2.5 py-0.5 rounded-full">
              {rottingDeals.length}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {rottingDeals.map((deal) => {
              const daysSince = Math.floor((Date.now() - new Date(deal.updatedAt).getTime()) / 86_400_000);
              const stage = stages.find(s => s.id === deal.stage);
              return (
                <div key={deal.id} className="flex items-start gap-3 p-3 rounded-xl bg-orange-50/50 dark:bg-orange-500/[0.04] border border-orange-100 dark:border-orange-500/10">
                  <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: stage?.color ?? '#F97316' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{deal.title}</p>
                    <p className="text-xs text-gray-400 truncate">{deal.contactName}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] font-medium text-orange-600 dark:text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-md">
                        {daysSince}d parado
                      </span>
                      <span className="text-[10px] text-gray-400">{stage?.name ?? deal.stage}</span>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-gray-700 dark:text-gray-300 flex-shrink-0">{formatCurrency(deal.value)}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Row 7: Pending Actions ────────────────────────────── */}
      {pendingActions.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center"><Zap size={16} className="text-amber-500" /></div>
            <h3 className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{t('crm.metrics.pendingActions', 'Ações Sugeridas Pendentes')}</h3>
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-full">{pendingActions.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingActions.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/5 dark:bg-amber-500/5 border border-amber-200/30 dark:border-amber-500/15">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300 shrink-0">
                  {getInitials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{c.name}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 font-medium truncate">{c.suggestedAction}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ==========================================
// SEGMENTS TAB — OR/AND filter builder
// ==========================================

type SegFieldType = 'string' | 'number' | 'select' | 'tags' | 'lifecycle' | 'tipo' | 'boolean' | 'channel';

interface SegFieldDef {
  id: string;
  label: string;
  type: SegFieldType;
  options?: { value: string; label: string }[];
}

const SEGMENT_FIELDS: SegFieldDef[] = [
  { id: 'status', label: 'Status', type: 'select',
    options: ALL_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] })) },
  { id: 'source', label: 'Origem', type: 'select',
    options: ALL_SOURCES.map(s => ({ value: s, label: SOURCE_LABELS[s] })) },
  { id: 'tipo', label: 'Tipo (PF/PJ)', type: 'select',
    options: [{ value: 'pf', label: 'Pessoa Física' }, { value: 'pj', label: 'Pessoa Jurídica' }] },
  { id: 'lifecycleStage', label: 'Etapa do ciclo', type: 'select',
    options: [
      { value: 'new_lead', label: 'Novo Lead' }, { value: 'contacted', label: 'Contatado' },
      { value: 'qualified', label: 'Qualificado' }, { value: 'proposal', label: 'Proposta' },
      { value: 'negotiation', label: 'Negociação' }, { value: 'customer', label: 'Cliente' },
      { value: 'churned', label: 'Churned' },
    ] },
  { id: 'score', label: 'Score geral', type: 'number' },
  { id: 'scores.churnRisk', label: 'Risco de churn (%)', type: 'number' },
  { id: 'scores.overall', label: 'Score IA', type: 'number' },
  { id: 'totalSpent', label: 'Total gasto (R$)', type: 'number' },
  { id: 'visitCount', label: 'Nº de compras', type: 'number' },
  { id: 'age', label: 'Idade', type: 'number' },
  { id: 'birthMonth', label: 'Mês de nascimento', type: 'select',
    options: ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
      .map((m, i) => ({ value: String(i + 1), label: m })) },
  { id: 'gender', label: 'Gênero', type: 'select',
    options: [{ value: 'M', label: 'Masculino' }, { value: 'F', label: 'Feminino' }, { value: 'O', label: 'Outro' }] },
  { id: 'preferredChannel', label: 'Canal preferido', type: 'select',
    options: [{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'facebook', label: 'Facebook' }, { value: 'instagram', label: 'Instagram' }] },
  { id: 'optInMarketing', label: 'Opt-in marketing', type: 'boolean',
    options: [{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }] },
  { id: 'tags', label: 'Tags', type: 'tags' },
  { id: 'company', label: 'Empresa (contém)', type: 'string' },
];

const OPS_BY_TYPE: Record<SegFieldType, { value: SegmentFilterOperator; label: string }[]> = {
  string:    [{ value: 'contains', label: 'contém' }, { value: 'not_contains', label: 'não contém' }, { value: 'eq', label: '=' }, { value: 'neq', label: '≠' }],
  number:    [{ value: 'gt', label: '>' }, { value: 'lt', label: '<' }, { value: 'eq', label: '=' }, { value: 'neq', label: '≠' }],
  select:    [{ value: 'eq', label: '=' }, { value: 'neq', label: '≠' }],
  tags:      [{ value: 'contains', label: 'inclui tag' }, { value: 'not_contains', label: 'não inclui tag' }],
  lifecycle: [{ value: 'eq', label: '=' }, { value: 'neq', label: '≠' }],
  tipo:      [{ value: 'eq', label: '=' }],
  boolean:   [{ value: 'eq', label: '=' }, { value: 'neq', label: '≠' }],
  channel:   [{ value: 'contains', label: 'teve conversa' }, { value: 'not_contains', label: 'não teve conversa' }],
};

const CAMPAIGN_AUDIENCE_FIELDS: SegFieldDef[] = [
  ...SEGMENT_FIELDS,
  { id: 'conversationChannel', label: 'Conversa no canal', type: 'channel',
    options: [{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'facebook', label: 'Facebook Page' }, { value: 'instagram', label: 'Instagram' }] },
  { id: 'hasWhatsapp', label: 'Tem WhatsApp válido', type: 'boolean',
    options: [{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }] },
  { id: 'hasFacebook', label: 'Tem ID Facebook', type: 'boolean',
    options: [{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }] },
  { id: 'hasInstagram', label: 'Tem ID Instagram', type: 'boolean',
    options: [{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }] },
  { id: 'hasEmail', label: 'Tem email válido', type: 'boolean',
    options: [{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }] },
];

interface AudienceConversationIndex {
  contactIdsByChannel: Map<ConversationChannel, Set<string>>;
  recipientIdsByChannel: Map<ConversationChannel, Map<string, string>>;
}

function makeEmptyAudienceConversationIndex(): AudienceConversationIndex {
  return {
    contactIdsByChannel: new Map(),
    recipientIdsByChannel: new Map(),
  };
}

function getCampaignDestinationLabel(channel: BroadcastChannel): string {
  if (channel === 'email') return 'email';
  if (channel === 'facebook') return 'ID Facebook';
  if (channel === 'instagram') return 'ID Instagram';
  return 'WhatsApp';
}

function evalFilter(contact: CRMContact, filter: SegmentFilter): boolean {
  return matchesAudienceFilterGroups(contact, [{ id: 'single', filters: [filter] }]);
}

function matchesSegmentGroups(contact: CRMContact, filterGroups: SegmentFilterGroup[]): boolean {
  if (!filterGroups.length) return true;
  return filterGroups.some(group => group.filters.every(f => evalFilter(contact, f)));
}

function makeFilter(): SegmentFilter { return { field: 'status', operator: 'eq', value: 'novo' }; }
function makeGroup(): SegmentFilterGroup { return { id: crypto.randomUUID(), filters: [makeFilter()] }; }
function makeCampaignAudienceGroup(): SegmentFilterGroup {
  return { id: crypto.randomUUID(), filters: [{ field: 'age', operator: 'gt', value: 30 }] };
}

function FilterRow({ filter, onChange, onRemove, fields = SEGMENT_FIELDS }: {
  filter: SegmentFilter;
  onChange: (f: SegmentFilter) => void;
  onRemove: () => void;
  fields?: SegFieldDef[];
}) {
  const fieldDef = fields.find(f => f.id === filter.field) ?? fields[0];
  const ops = OPS_BY_TYPE[fieldDef.type];

  const handleFieldChange = (fieldId: string) => {
    const def = fields.find(f => f.id === fieldId) ?? fields[0];
    const firstOp = OPS_BY_TYPE[def.type][0].value;
    const defaultVal = def.type === 'number' ? 0 : (def.options?.[0]?.value ?? '');
    onChange({ field: fieldId, operator: firstOp, value: defaultVal });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={filter.field} onChange={e => handleFieldChange(e.target.value)}
        className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none">
        {fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      <select value={filter.operator} onChange={e => onChange({ ...filter, operator: e.target.value as SegmentFilterOperator })}
        className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none">
        {ops.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
      </select>
      {fieldDef.options ? (
        <select value={filter.value as string} onChange={e => onChange({ ...filter, value: e.target.value })}
          className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none">
          {fieldDef.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type={fieldDef.type === 'number' ? 'number' : 'text'}
          value={filter.value as string | number}
          onChange={e => onChange({ ...filter, value: fieldDef.type === 'number' ? Number(e.target.value) : e.target.value })}
          className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none"
          placeholder={fieldDef.type === 'number' ? '0' : 'valor...'} />
      )}
      <button onClick={onRemove} className="p-1 text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors flex-shrink-0">
        <X size={13} />
      </button>
    </div>
  );
}

function SegmentsTab({ contacts, businessId, userId, userName }: {
  contacts: CRMContact[];
  businessId: string;
  userId: string;
  userName: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Segment | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Segment | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filterGroups, setFilterGroups] = useState<SegmentFilterGroup[]>([makeGroup()]);

  const { data: segments = [], isLoading } = useQuery({
    queryKey: ['segments', businessId],
    queryFn: async () => {
      const snap = await getDocs(query(
        collection(db, 'segments'),
        where('businessId', '==', businessId),
        orderBy('createdAt', 'desc'),
      ));
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Segment));
    },
    enabled: !!businessId,
    staleTime: 2 * 60 * 1000,
  });

  const openCreate = () => {
    setEditing(null);
    setName(''); setDescription('');
    setFilterGroups([makeGroup()]);
    setShowForm(true);
  };

  const openEdit = (seg: Segment) => {
    setEditing(seg);
    setName(seg.name);
    setDescription(seg.description ?? '');
    setFilterGroups(
      seg.filterGroups?.length
        ? seg.filterGroups
        : [{ id: crypto.randomUUID(), filters: seg.filters?.length ? seg.filters : [makeFilter()] }]
    );
    setShowForm(true);
  };

  const liveCount = useMemo(() => {
    const groups = filterGroups.filter(g => g.filters.length > 0);
    if (!groups.length) return contacts.length;
    return contacts.filter(c => matchesSegmentGroups(c, groups)).length;
  }, [contacts, filterGroups]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const now = new Date().toISOString();
    const groups = filterGroups.filter(g => g.filters.length > 0);
    const payload: Omit<Segment, 'id'> = {
      businessId,
      name: name.trim(),
      description: description.trim() || undefined,
      filters: groups[0]?.filters ?? [],
      filterGroups: groups,
      contactCount: liveCount,
      lastCalculatedAt: now,
      createdBy: userId,
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      if (editing) {
        await updateDoc(doc(db, 'segments', editing.id), payload);
      } else {
        await addDoc(collection(db, 'segments'), payload);
      }
      queryClient.invalidateQueries({ queryKey: ['segments', businessId] });
      toast.success(editing ? 'Segmento atualizado' : 'Segmento criado');
      setShowForm(false);
    } catch (err) {
      console.error('Segment save error:', err);
      toast.error('Erro ao salvar segmento');
    } finally { setSaving(false); }
  };

  const handleDelete = async (seg: Segment) => {
    try {
      await deleteDoc(doc(db, 'segments', seg.id));
      queryClient.invalidateQueries({ queryKey: ['segments', businessId] });
      toast.success('Segmento excluído');
      setDeleteConfirm(null);
    } catch { toast.error('Erro ao excluir'); }
  };

  const updateGroup = (gIdx: number, patch: Partial<SegmentFilterGroup>) =>
    setFilterGroups(prev => prev.map((g, i) => i === gIdx ? { ...g, ...patch } : g));

  const addFilter = (gIdx: number) =>
    updateGroup(gIdx, { filters: [...filterGroups[gIdx].filters, makeFilter()] });

  const updateFilter = (gIdx: number, fIdx: number, f: SegmentFilter) =>
    updateGroup(gIdx, { filters: filterGroups[gIdx].filters.map((ff, i) => i === fIdx ? f : ff) });

  const removeFilter = (gIdx: number, fIdx: number) => {
    const newFilters = filterGroups[gIdx].filters.filter((_, i) => i !== fIdx);
    if (newFilters.length === 0) {
      setFilterGroups(prev => prev.filter((_, i) => i !== gIdx));
    } else {
      updateGroup(gIdx, { filters: newFilters });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-display font-bold text-gray-900 dark:text-gray-100">Segmentos</h3>
          <p className="text-xs text-gray-400 mt-0.5">Grupos de contatos com filtros AND/OR para usar em campanhas</p>
        </div>
        <button onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors">
          <Plus size={14} />Novo segmento
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">{[0,1,2].map(i => <div key={i} className="h-20 rounded-2xl shimmer" />)}</div>
      ) : segments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
            <Filter size={22} className="text-gray-400" />
          </div>
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">Nenhum segmento criado</p>
          <p className="text-xs text-gray-400 mt-1">Crie segmentos para usar em campanhas com filtros avançados</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {segments.map(seg => {
            // Segments legados podem não ter filterGroups NEM filters — fallback p/ [].
            // Sem isso, group.filters.every(...) lança TypeError e quebra a aba inteira.
            const count = contacts.filter(c =>
              matchesSegmentGroups(c, seg.filterGroups?.length ? seg.filterGroups : [{ id: '', filters: seg.filters ?? [] }])
            ).length;
            const groupCount = seg.filterGroups?.length ?? 1;
            return (
              <motion.div key={seg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-4 p-4 bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-2xl hover:shadow-sm transition-shadow">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{seg.name}</h4>
                    <span className="text-[10px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
                      {groupCount} grupo{groupCount !== 1 ? 's' : ''} {groupCount > 1 ? '· OR' : ''}
                    </span>
                  </div>
                  {seg.description && <p className="text-xs text-gray-400 truncate">{seg.description}</p>}
                </div>
                <div className="text-center flex-shrink-0">
                  <p className="text-xl font-bold text-red-600 dark:text-red-400">{count}</p>
                  <p className="text-[10px] text-gray-400">contatos</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(seg)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                    <Edit3 size={14} />
                  </button>
                  <button onClick={() => setDeleteConfirm(seg)}
                    className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Create/Edit modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                  {editing ? 'Editar segmento' : 'Novo segmento'}
                </h3>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-2.5 py-1 rounded-full">
                    {liveCount} contatos
                  </span>
                  <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
                    <X size={15} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Name + description */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-1">Nome *</label>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Leads quentes qualificados"
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-1">Descrição (opcional)</label>
                    <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Para que serve este segmento..."
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30" />
                  </div>
                </div>

                {/* Filter groups */}
                <div className="space-y-3">
                  <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Filtros</p>

                  {filterGroups.map((group, gIdx) => (
                    <React.Fragment key={group.id}>
                      {gIdx > 0 && (
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                          <span className="text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded-full">OU</span>
                          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                        </div>
                      )}
                      <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                        {/* Group header */}
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
                          <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {filterGroups.length > 1 ? `Grupo ${gIdx + 1} — todas as condições` : 'Todas as condições'}
                          </p>
                          {filterGroups.length > 1 && (
                            <button onClick={() => setFilterGroups(prev => prev.filter((_, i) => i !== gIdx))}
                              className="text-[10px] text-red-500 hover:text-red-700 font-medium">Remover grupo</button>
                          )}
                        </div>
                        {/* Filters */}
                        <div className="p-3 space-y-2">
                          {group.filters.map((f, fIdx) => (
                            <React.Fragment key={fIdx}>
                              {fIdx > 0 && (
                                <p className="text-[9px] font-bold text-gray-400 uppercase px-1">E</p>
                              )}
                              <FilterRow
                                filter={f}
                                onChange={newF => updateFilter(gIdx, fIdx, newF)}
                                onRemove={() => removeFilter(gIdx, fIdx)}
                              />
                            </React.Fragment>
                          ))}
                          <button onClick={() => addFilter(gIdx)}
                            className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 flex items-center gap-1 mt-1">
                            <Plus size={11} />Adicionar condição
                          </button>
                        </div>
                      </div>
                    </React.Fragment>
                  ))}

                  <button onClick={() => setFilterGroups(prev => [...prev, makeGroup()])}
                    className="w-full py-2 rounded-xl border-2 border-dashed border-red-200 dark:border-red-500/20 text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/5 transition-colors flex items-center justify-center gap-1.5">
                    <Plus size={12} />Adicionar grupo (OU)
                  </button>
                </div>
              </div>

              <div className="flex gap-2 justify-end px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Cancelar
                </button>
                <button onClick={handleSave} disabled={saving || !name.trim()}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-40">
                  {saving ? 'Salvando...' : editing ? 'Atualizar' : 'Criar segmento'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6">
              <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Excluir segmento?</p>
              <p className="text-xs text-gray-500 mb-5"><strong>{deleteConfirm.name}</strong> será removido permanentemente.</p>
              <div className="flex gap-2">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">Cancelar</button>
                <button onClick={() => handleDelete(deleteConfirm)} className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold">Excluir</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ==========================================
// CAMPAIGNS TAB (kept inline — self-contained with onSnapshot)
// ==========================================

/**
 * Input numérico que mostra/edita valor em SEGUNDOS mas armazena em MS.
 * Usado nos campos de delay/pausa do throttle do broadcast.
 */
function ThrottleInput({ label, valueMs, onChangeMs }: {
  label: string;
  valueMs: number;
  onChangeMs: (ms: number) => void;
}) {
  return (
    <TextField
      label={label}
      type="number"
      size="small"
      fullWidth
      value={Math.round(valueMs / 1000)}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n) && n >= 0) onChangeMs(n * 1000);
      }}
      inputProps={{ min: 0, max: 3600 }}
      InputProps={{
        endAdornment: <InputAdornment position="end"><span className="text-[11px] font-semibold text-slate-400">s</span></InputAdornment>,
      }}
    />
  );
}

/**
 * Estimativa de tempo total do envio com base no throttle + count.
 * Usa o ponto médio dos delays (avg = (min + max) / 2).
 */
function ThrottleEstimate({ recipientCount, throttle }: {
  recipientCount: number;
  throttle: SendThrottle;
}) {
  if (recipientCount <= 0) return null;
  const avgDelay = (throttle.delayMinMs + throttle.delayMaxMs) / 2;
  let totalMs = avgDelay * (recipientCount - 1); // delays entre msgs
  if (throttle.batchSize && throttle.batchSize > 0 && throttle.batchPauseMinMs && throttle.batchPauseMaxMs) {
    const numBatches = Math.floor((recipientCount - 1) / throttle.batchSize);
    const avgBatchPause = (throttle.batchPauseMinMs + throttle.batchPauseMaxMs) / 2;
    totalMs += numBatches * avgBatchPause;
  }
  // Formata
  const totalSec = Math.round(totalMs / 1000);
  const min = Math.floor(totalSec / 60);
  const hr = Math.floor(min / 60);
  const formatted = hr >= 1
    ? `~${hr}h ${min % 60}min`
    : min >= 1 ? `~${min}min ${totalSec % 60}s`
    : `~${totalSec}s`;
  return (
    <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-relaxed">
      ⏱ Tempo estimado de envio: <strong className="text-gray-700 dark:text-gray-300">{formatted}</strong> para {recipientCount} mensagens (média).
    </p>
  );
}

/** Mini-barra de taxa para o card de campanha. */
function CampaignMiniBar({ label, rate, counts, color }: {
  label: string;
  rate: number;
  counts: string;
  color: 'blue' | 'purple';
}) {
  const cfg = color === 'blue'
    ? { bar: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-400' }
    : { bar: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-400' };
  const pct = Math.max(0, Math.min(1, rate)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-gray-500 dark:text-gray-400">{label}</span>
        <span className="tabular-nums">
          <span className={cn('font-bold', cfg.text)}>{Math.round(pct)}%</span>
          <span className="ml-1 text-gray-400">· {counts}</span>
        </span>
      </div>
      <div className="h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', cfg.bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CampaignsTab({ businessId }: { businessId: string }) {
  const { t } = useTranslation();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [openBroadcast, setOpenBroadcast] = useState<Broadcast | null>(null);
  // PR-B: campanhas recorrentes de aniversário. Coleção separada
  // (`birthdayCampaigns`) — não se misturam com broadcasts pontuais.
  const [birthdayCampaigns, setBirthdayCampaigns] = useState<BirthdayCampaign[]>([]);
  const [showNewBirthday, setShowNewBirthday] = useState(false);
  const [editingBirthday, setEditingBirthday] = useState<BirthdayCampaign | null>(null);
  const [formName, setFormName] = useState('');
  const [formChannel, setFormChannel] = useState<'whatsapp' | 'facebook' | 'instagram' | 'email'>('whatsapp');
  const [formViaBaileys, setFormViaBaileys] = useState(false);
  /**
   * ID da channelConnections/{id} escolhida pra disparar a campanha. Sem isso,
   * o backend cai em fallback `primary business` — o que esconde canais
   * pessoais de operador (ownerType='user') e quebra envios em ambientes que
   * só têm Baileys pessoal cadastrado. Empty string = "default" (deixa o
   * backend resolver).
   */
  const [formChannelConnectionId, setFormChannelConnectionId] = useState<string>('');
  // Lista de connections disponíveis pro operador (carregada via API que já
  // filtra por role: operator vê 'business' + suas próprias 'user'; admin vê tudo).
  const [availableConnections, setAvailableConnections] = useState<import('@/lib/types').ChannelConnection[]>([]);
  const [formAudienceType, setFormAudienceType] = useState<Extract<BroadcastAudienceType, 'all_contacts' | 'tags' | 'segment' | 'filtered_clients' | 'list'>>('list');
  const [formSegmentId, setFormSegmentId] = useState('');
  const [formAudienceFilterGroups, setFormAudienceFilterGroups] = useState<SegmentFilterGroup[]>([makeCampaignAudienceGroup()]);
  const [formRequireMarketingOptIn, setFormRequireMarketingOptIn] = useState(false);
  const [formTags, setFormTags] = useState('');
  const [formRecipients, setFormRecipients] = useState<BroadcastRecipient[]>([]);
  /** 5.8: nomes de colunas extras detectadas no último CSV importado — vão pro TemplateSelector. */
  const [formCsvColumns, setFormCsvColumns] = useState<string[]>([]);
  const [formMsgType, setFormMsgType] = useState<'template' | 'text'>('template');
  const [formTemplate, setFormTemplate] = useState<TemplateSelection | null>(null);
  const [formContent, setFormContent] = useState('');
  const [formEmailSubject, setFormEmailSubject] = useState('');
  // Oferta (Fase 4B do módulo Clientes) — vínculo opcional pra atribuição.
  // Quando set, recipientes que viram clientes herdam acquisitionOfferId.
  const [formOfferId, setFormOfferId] = useState<string>('');
  const [formScheduledAt, setFormScheduledAt] = useState(''); // datetime-local string ou ''
  /**
   * Limite opcional de recipientes a enviar (slice from start).
   * undefined = todos os recipients da lista. Útil para:
   *  - Teste com sub-conjunto antes do envio total
   *  - Envio escalonado (100 hoje, 100 amanhã)
   *  - Respeitar quota Baileys (~200/dia recomendado)
   */
  const [formRecipientLimit, setFormRecipientLimit] = useState<number | ''>('');
  /**
   * Throttle (anti-spam): delay aleatório entre msgs + batches com pausa longa.
   * Default = preset 'human'. Operador pode trocar preset OU customizar valores.
   */
  const [formThrottlePreset, setFormThrottlePreset] = useState<ThrottlePresetKey | 'custom'>('human');
  const [formThrottle, setFormThrottle] = useState<SendThrottle>(THROTTLE_PRESETS.human.throttle);
  const [saving, setSaving] = useState(false);
  // ── Listas reusáveis (BroadcastList) ────────────────────────────────────────
  // savedLists: cache local; selectedListId: lista carregada agora;
  // saveAsList + listSaveName: persistir o set atual após criar a campanha.
  const [savedLists, setSavedLists] = useState<BroadcastList[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [saveAsList, setSaveAsList] = useState(false);
  const [listSaveName, setListSaveName] = useState('');
  const [recipientResetKey, setRecipientResetKey] = useState(0);
  // ── LGPD: base legal obrigatória (5.12) ─────────────────────────────────────
  // consentBasis define a justificativa LGPD do envio. consentSource é texto
  // livre (ex: "Form da landing X"). consentAck flag de auto-confirmação.
  const [formConsentBasis, setFormConsentBasis] = useState<'' | 'explicit' | 'legitimate-interest' | 'transactional'>('');
  const [formConsentSource, setFormConsentSource] = useState('');
  const [formConsentAck, setFormConsentAck] = useState(false);
  const { user, business } = useAuth();
  // Detecta features disponíveis a partir de business.settings/channels
  type BusinessExtended = NonNullable<typeof business> & {
    settings?: { notificationServer?: { isConfigured?: boolean } };
    channels?: {
      whatsappBaileys?: { isConnected?: boolean };
      whatsapp?: { isConnected?: boolean; connectedVia?: string };
    };
  };
  const biz = business as BusinessExtended | undefined;
  const notificationServerReady = !!biz?.settings?.notificationServer?.isConfigured;
  // Baileys disponível: campo novo isolado OU legacy com connectedVia=baileys
  const baileysReady = !!(
    biz?.channels?.whatsappBaileys?.isConnected
    || (biz?.channels?.whatsapp?.connectedVia === 'baileys' && biz?.channels?.whatsapp?.isConnected)
  );

  // Carrega listas reusáveis salvas (atualiza ao abrir o dialog de Nova Campanha)
  const refreshSavedLists = useCallback(async () => {
    if (!businessId) return;
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`/api/broadcast-lists?businessId=${encodeURIComponent(businessId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setSavedLists(Array.isArray(data.lists) ? data.lists : []);
    } catch (err) {
      console.error('[CRM:Campaigns] Failed to load broadcast lists:', err);
    }
  }, [businessId]);

  useEffect(() => {
    if (showNew) refreshSavedLists();
  }, [showNew, refreshSavedLists]);

  // Carrega channelConnections disponíveis pro operador. A API filtra por role:
  // operator vê 'business' + suas próprias 'user'; admin/founder vê tudo.
  //
  // Dispara quando QUALQUER dialog que precisa do status (campanha normal OU
  // de aniversário) abre. Bug anterior: só observava `showNew` — abrir o
  // dialog de aniversário sem ter aberto a campanha normal antes deixava o
  // state `availableConnections` vazio, e o BirthdayCampaignDialog mostrava
  // tudo como desconectado mesmo com canais conectados.
  useEffect(() => {
    if (!businessId) return;
    if (!showNew && !showNewBirthday) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuth().currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch(`/api/channels/connections?businessId=${encodeURIComponent(businessId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setAvailableConnections((data.connections || []) as import('@/lib/types').ChannelConnection[]);
      } catch (err) {
        console.error('[CRM:Campaigns] Failed to load channel connections:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [showNew, showNewBirthday, businessId]);

  // Connections elegíveis pro canal + modo escolhidos. Filtra por type e
  // isConnected — desconectadas não dispararam.
  const eligibleConnections = useMemo(() => {
    if (formChannel === 'email') return [];
    return availableConnections.filter(c => {
      if (!c.isActive || !c.isConnected) return false;
      if (formChannel === 'whatsapp') {
        return formViaBaileys ? c.type === 'whatsapp_baileys' : c.type === 'whatsapp_cloud';
      }
      if (formChannel === 'facebook') return c.type === 'facebook';
      if (formChannel === 'instagram') return c.type === 'instagram';
      return false;
    });
  }, [availableConnections, formChannel, formViaBaileys]);

  // Auto-seleciona quando há exatamente 1 connection elegível, ou quando a
  // seleção atual deixa de ser elegível (ex: trocou Cloud→Baileys).
  useEffect(() => {
    if (formChannel === 'email') {
      if (formChannelConnectionId) setFormChannelConnectionId('');
      return;
    }
    if (eligibleConnections.length === 1) {
      const onlyId = eligibleConnections[0].id;
      if (formChannelConnectionId !== onlyId) setFormChannelConnectionId(onlyId);
      return;
    }
    if (formChannelConnectionId && !eligibleConnections.some(c => c.id === formChannelConnectionId)) {
      // Seleção atual não é mais válida — limpa pra forçar nova escolha.
      setFormChannelConnectionId('');
    }
  }, [eligibleConnections, formChannel, formChannelConnectionId]);

  // Carrega clientes para o auto-link do RecipientListInput (cache compartilhado com pipeline tab)
  const { data: existingClients = [] } = useQuery<Client[]>({
    queryKey: ['clients', businessId],
    queryFn: async () => {
      if (!businessId) return [];
      const q = query(collection(db, 'clients'), where('businessId', '==', businessId));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...(d.data() as Client), id: d.id })).filter(isActiveClient);
    },
    enabled: !!businessId,
    staleTime: 30 * 1000, // 30s — clientes recém-criados aparecem rápido pro auto-link
    gcTime: 5 * 60 * 1000,
  });

  const { data: availableSegments = [] } = useQuery<Segment[]>({
    queryKey: ['campaign-segments', businessId],
    queryFn: async () => {
      if (!businessId) return [];
      const snap = await getDocs(query(
        collection(db, 'segments'),
        where('businessId', '==', businessId),
        orderBy('createdAt', 'desc'),
      ));
      return snap.docs.map(d => ({ ...(d.data() as Segment), id: d.id }));
    },
    enabled: !!businessId && showNew,
    staleTime: 2 * 60 * 1000,
  });

  const { data: audienceConversationIndex = makeEmptyAudienceConversationIndex() } = useQuery<AudienceConversationIndex>({
    queryKey: ['campaign-audience-conversations', businessId],
    queryFn: async () => {
      if (!businessId) return makeEmptyAudienceConversationIndex();
      const snap = await getDocs(query(
        collection(db, 'conversations'),
        where('businessId', '==', businessId),
        firestoreLimit(5000),
      ));
      const index = makeEmptyAudienceConversationIndex();
      snap.docs.forEach(d => {
        const data = d.data();
        const channel = data.channel as ConversationChannel | undefined;
        const clientId = data.crmContactId as string | undefined;
        const recipientId = (data.contactExternalId as string | undefined)?.trim();
        if (!channel || !clientId) return;
        if (!index.contactIdsByChannel.has(channel)) index.contactIdsByChannel.set(channel, new Set());
        index.contactIdsByChannel.get(channel)!.add(clientId);
        if (recipientId) {
          if (!index.recipientIdsByChannel.has(channel)) index.recipientIdsByChannel.set(channel, new Map());
          index.recipientIdsByChannel.get(channel)!.set(clientId, recipientId);
        }
      });
      return index;
    },
    enabled: !!businessId && showNew,
    staleTime: 2 * 60 * 1000,
  });

  // Subscription: campanhas de aniversário. Coleção `birthdayCampaigns`,
  // ordenadas por createdAt desc igual a broadcasts. Erro silencioso —
  // ausência da coleção (primeira instalação) é OK; UI só mostra empty state.
  useEffect(() => {
    if (!businessId) return;
    const q = query(collection(db, 'birthdayCampaigns'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q,
      (snap) => setBirthdayCampaigns(snap.docs.map(d => ({ ...d.data(), id: d.id } as BirthdayCampaign))),
      (err) => console.warn('[CRM:Campaigns] birthdayCampaigns subscription:', err),
    );
    return () => unsub();
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    const q = query(collection(db, 'broadcasts'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => { setBroadcasts(snap.docs.map(d => ({ ...d.data(), id: d.id } as Broadcast))); setLoading(false); }, (err) => { console.error('[CRM:Campaigns] Error fetching broadcasts:', err); setLoading(false); });
    return () => unsub();
  }, [businessId]);

  // Ofertas (Fase 4B do módulo Clientes) — alimenta o select opcional na
  // criação de broadcast pra vincular campanha à oferta. Limit implícito
  // (typical 0-50 ofertas por business). Cache via React state — se o user
  // criar nova oferta no modal de Clientes durante uma sessão, precisa
  // recarregar a página pra aparecer aqui (acceptable trade-off).
  const [campaignOffers, setCampaignOffers] = useState<Array<{ id: string; name: string; isActive: boolean }>>([]);
  useEffect(() => {
    if (!businessId) return;
    const q = query(collection(db, 'offers'), where('businessId', '==', businessId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map(d => {
          const data = d.data();
          return {
            id: d.id,
            name: (data.name as string) || '(sem nome)',
            isActive: data.isActive !== false,
          };
        })
        .sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      setCampaignOffers(list);
    }, (err) => console.warn('[CRM:Campaigns] Error fetching offers:', err));
    return () => unsub();
  }, [businessId]);

  const selectedSegment = useMemo(
    () => availableSegments.find(seg => seg.id === formSegmentId) ?? null,
    [availableSegments, formSegmentId],
  );

  const effectiveAudienceFilterGroups = useMemo<SegmentFilterGroup[]>(() => {
    if (formAudienceType === 'all_contacts') return [];
    if (formAudienceType === 'tags') {
      return audienceTagsToFilterGroups(formTags.split(',').map(t => t.trim()).filter(Boolean));
    }
    if (formAudienceType === 'segment') {
      if (!selectedSegment) return [];
      return selectedSegment.filterGroups?.length
        ? selectedSegment.filterGroups
        : [{ id: 'segment-legacy', filters: selectedSegment.filters ?? [] }];
    }
    if (formAudienceType === 'filtered_clients') return formAudienceFilterGroups;
    return [];
  }, [formAudienceType, formTags, selectedSegment, formAudienceFilterGroups]);

  const resolvedClientAudience = useMemo(() => resolveClientAudience(
    existingClients,
    effectiveAudienceFilterGroups,
    {
      channel: formChannel,
      conversationContactIdsByChannel: audienceConversationIndex.contactIdsByChannel,
      conversationRecipientIdsByChannel: audienceConversationIndex.recipientIdsByChannel,
      requireMarketingOptIn: formRequireMarketingOptIn,
    },
  ), [existingClients, effectiveAudienceFilterGroups, formChannel, audienceConversationIndex, formRequireMarketingOptIn]);

  const audienceSelectionIncomplete =
    (formAudienceType === 'tags' && formTags.split(',').map(t => t.trim()).filter(Boolean).length === 0) ||
    (formAudienceType === 'segment' && !selectedSegment) ||
    (formAudienceType === 'filtered_clients' && !formAudienceFilterGroups.some(g => g.filters.length > 0));

  const activeRecipients = formAudienceType === 'list'
    ? formRecipients
    : audienceSelectionIncomplete
      ? []
      : resolvedClientAudience.recipients;

  const updateAudienceGroup = (gIdx: number, patch: Partial<SegmentFilterGroup>) =>
    setFormAudienceFilterGroups(prev => prev.map((g, i) => i === gIdx ? { ...g, ...patch } : g));

  const addAudienceFilter = (gIdx: number) =>
    updateAudienceGroup(gIdx, { filters: [...formAudienceFilterGroups[gIdx].filters, { field: 'status', operator: 'eq', value: 'ganho' }] });

  const updateAudienceFilter = (gIdx: number, fIdx: number, filter: SegmentFilter) =>
    updateAudienceGroup(gIdx, {
      filters: formAudienceFilterGroups[gIdx].filters.map((existing, i) => i === fIdx ? filter : existing),
    });

  const removeAudienceFilter = (gIdx: number, fIdx: number) => {
    const nextFilters = formAudienceFilterGroups[gIdx].filters.filter((_, i) => i !== fIdx);
    if (nextFilters.length === 0) {
      setFormAudienceFilterGroups(prev => prev.length > 1 ? prev.filter((_, i) => i !== gIdx) : [makeCampaignAudienceGroup()]);
    } else {
      updateAudienceGroup(gIdx, { filters: nextFilters });
    }
  };

  const setAudiencePreset = (preset: 'age30' | 'facebook' | 'tag') => {
    if (preset === 'age30') {
      setFormAudienceFilterGroups([{ id: crypto.randomUUID(), filters: [
        { field: 'age', operator: 'gt', value: 30 },
        { field: 'hasWhatsapp', operator: 'eq', value: 'true' },
      ] }]);
      return;
    }
    if (preset === 'facebook') {
      setFormAudienceFilterGroups([{ id: crypto.randomUUID(), filters: [
        { field: 'conversationChannel', operator: 'contains', value: 'facebook' },
      ] }]);
      return;
    }
    setFormAudienceFilterGroups([{ id: crypto.randomUUID(), filters: [
      { field: 'tags', operator: 'contains', value: 'remarketing' },
    ] }]);
  };

  const channelLabel = formChannel === 'email' ? 'Email' : 'WhatsApp';
  const audienceLabel = formAudienceType === 'list'
    ? 'Lista direta'
    : formAudienceType === 'filtered_clients'
      ? 'Clientes filtrados'
      : formAudienceType === 'segment'
        ? 'Segmento salvo'
        : formAudienceType === 'tags'
          ? 'Tags'
          : 'Todos os clientes';
  const createDisabled = saving
    || !formName.trim()
    || !formConsentBasis
    || !formConsentAck
    || activeRecipients.length === 0
    || (formChannel !== 'email' && eligibleConnections.length === 0);

  const handleCreate = async () => {
    if (!businessId || !user || !formName.trim()) return;
    if (formAudienceType === 'tags' && formTags.split(',').map(t => t.trim()).filter(Boolean).length === 0) {
      toast.error('Informe ao menos uma tag para montar a audiência.');
      return;
    }
    if (formAudienceType === 'segment' && !selectedSegment) {
      toast.error('Selecione um segmento salvo.');
      return;
    }
    if (formAudienceType === 'filtered_clients' && !formAudienceFilterGroups.some(g => g.filters.length > 0)) {
      toast.error('Adicione ao menos um filtro de cliente.');
      return;
    }
    if (activeRecipients.length === 0) {
      toast.error(formAudienceType === 'list'
        ? 'Adicione pelo menos um recipiente na lista.'
        : 'Nenhum cliente elegível com destino válido para este canal.');
      return;
    }
    // 5.12 — LGPD: base legal obrigatória + auto-confirmação do operador
    if (!formConsentBasis) {
      toast.error('Selecione a base legal LGPD antes de criar a campanha.');
      return;
    }
    if (!formConsentAck) {
      toast.error('Confirme que você possui base legal para enviar antes de prosseguir.');
      return;
    }
    // Email: nunca usa template, sempre texto livre + assunto
    if (formChannel === 'email') {
      if (!formEmailSubject.trim()) { toast.error('Digite o assunto do email.'); return; }
      // EmailBodyEditor produz HTML — validamos se há texto real, não só tags vazias.
      const emailBodyText = formContent.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      if (!emailBodyText) { toast.error('Digite o corpo do email.'); return; }
    } else if (formChannel === 'whatsapp' && formViaBaileys) {
      // Baileys: sem template — só texto livre
      if (!formContent.trim()) { toast.error('Digite o conteúdo da mensagem.'); return; }
    } else {
      if (formMsgType === 'template' && !isTemplateSelectionValid(formTemplate)) {
        toast.error('Selecione um template e preencha todas as variáveis.');
        return;
      }
      if (formMsgType === 'text' && !formContent.trim()) {
        toast.error('Digite o conteúdo da mensagem.');
        return;
      }
    }
    // Firestore tem limite de 1 MiB por documento. Estimativa conservadora ~80% do limite.
    const recipientsSizeEstimate = JSON.stringify(activeRecipients).length;
    if (recipientsSizeEstimate > 800_000) {
      toast.error(`Lista muito grande (${activeRecipients.length} contatos, ~${Math.round(recipientsSizeEstimate / 1024)}KB). Limite por campanha: ~10.000 contatos. Divida em múltiplas.`);
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      // Aplica limite de envio (slice do início). Vazio/undefined = enviar
      // todos. Útil para testes ou envio escalonado (ex: respeitar quota
      // Baileys ~200/dia).
      const limitNum = typeof formRecipientLimit === 'number' && formRecipientLimit > 0
        ? formRecipientLimit
        : null;
      const sourceRecipients = limitNum
        ? activeRecipients.slice(0, limitNum)
        : activeRecipients;
      const recipientsTotal = sourceRecipients.length;
      // Limpa undefined dentro de cada recipient (Firestore aceita undefined no top-level via SDK
      // mas armazena como null em arrays — preferimos omitir o campo)
      const cleanRecipients: BroadcastRecipient[] = sourceRecipients.map(r => {
            const cleaned: BroadcastRecipient = {};
            if (r.contactId) cleaned.contactId = r.contactId;
            if (r.name) cleaned.name = r.name;
            if (r.phoneNumber) cleaned.phoneNumber = r.phoneNumber;
            if (r.recipientId) cleaned.recipientId = r.recipientId;
            if (r.email) cleaned.email = r.email;
            // 5.8: preserva colunas CSV extras (necessárias se template usar csvColumn).
            if (r.customColumns && Object.keys(r.customColumns).length > 0) {
              cleaned.customColumns = r.customColumns;
            }
            return cleaned;
          });
      // Email e Baileys forçam messageType=text; outros canais respeitam a escolha
      const isBaileysSend = formChannel === 'whatsapp' && formViaBaileys;
      const effectiveMsgType = (formChannel === 'email' || isBaileysSend) ? 'text' : formMsgType;
      // Agendamento: se formScheduledAt está no futuro, status='scheduled'
      let scheduledAtIso: string | undefined;
      if (formScheduledAt) {
        const dt = new Date(formScheduledAt);
        if (isNaN(dt.getTime())) {
          toast.error('Data/hora de agendamento inválida.');
          return;
        }
        if (dt.getTime() <= Date.now()) {
          toast.error('Data/hora de agendamento deve estar no futuro.');
          return;
        }
        scheduledAtIso = dt.toISOString();
      }
      const initialStatus: BroadcastStatus = scheduledAtIso ? 'scheduled' : 'draft';

      // Throttle: limpa campos de batch undefined antes de gravar (Firestore
      // não armazena undefined em arrays/objects de forma consistente).
      const throttleClean: SendThrottle = { delayMinMs: formThrottle.delayMinMs, delayMaxMs: formThrottle.delayMaxMs };
      if (formThrottle.batchSize && formThrottle.batchSize > 0) {
        throttleClean.batchSize = formThrottle.batchSize;
        if (formThrottle.batchPauseMinMs) throttleClean.batchPauseMinMs = formThrottle.batchPauseMinMs;
        if (formThrottle.batchPauseMaxMs) throttleClean.batchPauseMaxMs = formThrottle.batchPauseMaxMs;
      }

      const payload: Record<string, unknown> = {
        businessId,
        name: formName.trim(),
        channel: formChannel,
        // ID da connection escolhida (ou auto-selected quando só há 1). Sem
        // isso, backend cai em fallback `primary business` — esconde canais
        // pessoais e quebra envios quando só há Baileys pessoal cadastrado.
        channelConnectionId: formChannelConnectionId || undefined,
        audienceType: formAudienceType,
        audienceTags: formAudienceType === 'tags' ? formTags.split(',').map(t => t.trim()).filter(Boolean) : [],
        audienceSegmentId: formAudienceType === 'segment' && selectedSegment ? selectedSegment.id : undefined,
        audienceFilterGroups: formAudienceType === 'filtered_clients' ? formAudienceFilterGroups : undefined,
        audienceSnapshotCount: recipientsTotal,
        audienceResolvedAt: now,
        audienceRequireMarketingOptIn: formRequireMarketingOptIn || undefined,
        messageType: effectiveMsgType,
        throttle: throttleClean,
        templateName: effectiveMsgType === 'template' && formTemplate ? formTemplate.name : undefined,
        templateLanguage: effectiveMsgType === 'template' && formTemplate ? formTemplate.language : undefined,
        templateParams: effectiveMsgType === 'template' && formTemplate ? formTemplate.params : undefined,
        // Persiste o body cru do template (com {{N}} placeholders) pra que
        // /api/broadcasts/send consiga renderizar o texto real por destinatário
        // quando der upsert da conversa. Sem isso a aba Conversas mostrava só
        // "[Template: nome]" em vez do conteúdo enviado.
        templateBody: effectiveMsgType === 'template' && formTemplate ? formTemplate.preview : undefined,
        messageContent: effectiveMsgType === 'text' ? formContent.trim() : undefined,
        emailSubject: formChannel === 'email' ? formEmailSubject.trim() : undefined,
        viaBaileys: isBaileysSend,
        scheduledAt: scheduledAtIso,
        status: initialStatus,
        stats: { total: recipientsTotal, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 },
        // Vínculo opcional com oferta (Fase 4B do módulo Clientes).
        offerId: formOfferId || undefined,
        // 5.12 LGPD — base legal + auditoria de quem aprovou
        consentBasis: formConsentBasis,
        consentSource: formConsentSource.trim() || undefined,
        consentAcknowledgedAt: now,
        consentAcknowledgedBy: user.uid,
        createdBy: user.uid,
        createdByName: user.name,
        createdAt: now,
        updatedAt: now,
      };
      payload.recipients = cleanRecipients;
      // Remove undefineds em primeiro nível
      Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
      await addDoc(collection(db, 'broadcasts'), payload);

      // Salva lista reusável (best-effort — falha aqui não invalida a campanha já criada).
      // Só roda quando audienceType=list, há recipientes e usuário marcou o checkbox
      // sem ter usado uma lista pré-existente (evita duplicar a mesma lista).
      if (
        formAudienceType === 'list' &&
        saveAsList &&
        !selectedListId &&
        cleanRecipients.length > 0 &&
        listSaveName.trim()
      ) {
        try {
          const token = await getAuth().currentUser?.getIdToken();
          if (token) {
            const res = await fetch('/api/broadcast-lists', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                businessId,
                name: listSaveName.trim(),
                recipients: cleanRecipients,
              }),
            });
            if (res.ok) {
              toast.success('Lista salva para reuso');
            } else {
              const err = await res.json().catch(() => ({}));
              toast.error(`Lista não foi salva: ${err.error || 'erro desconhecido'}`);
            }
          }
        } catch (err) {
          console.error('[CRM:Campaigns] Failed to save broadcast list:', err);
          toast.error('Lista não foi salva (campanha foi criada normalmente).');
        }
      }

      toast.success(t('crm.toast.campaignCreated', 'Campanha criada'));
      setShowNew(false);
      setFormName('');
      setFormRecipients([]);
      setFormCsvColumns([]);
      setFormTemplate(null);
      setFormContent('');
      setFormEmailSubject('');
      setFormViaBaileys(false);
      setFormChannelConnectionId('');
      setFormScheduledAt('');
      setFormOfferId('');
      setFormRecipientLimit('');
      setFormThrottlePreset('human');
      setFormThrottle(THROTTLE_PRESETS.human.throttle);
      setSelectedListId('');
      setFormAudienceType('list');
      setFormTags('');
      setFormSegmentId('');
      setFormAudienceFilterGroups([makeCampaignAudienceGroup()]);
      setFormRequireMarketingOptIn(false);
      setSaveAsList(false);
      setListSaveName('');
      setRecipientResetKey(k => k + 1);
      // Reset LGPD states (operador deve re-confirmar a cada nova campanha)
      setFormConsentBasis('');
      setFormConsentSource('');
      setFormConsentAck(false);
    } catch (err) {
      console.error('[CRM:Campaigns] Error creating broadcast:', err);
      toast.error(t('crm.toast.errorCreateCampaign', 'Erro ao criar campanha'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="space-y-4">{[0, 1, 2].map(i => <div key={i} className="h-24 rounded-2xl shimmer" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 font-display">{t('crm.campaign.title', 'Campanhas')}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {broadcasts.length} {broadcasts.length !== 1 ? 'pontuais' : 'pontual'}
            {birthdayCampaigns.length > 0 && (
              <> · {birthdayCampaigns.length} aniversário{birthdayCampaigns.length !== 1 ? '' : ''}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Botão de campanha de aniversário — visualmente secundário (outline)
              pra não competir com o CTA primário "Nova Campanha". O 🎂 deixa
              claro que é a feature recorrente, não one-shot. */}
          <button
            onClick={() => { setEditingBirthday(null); setShowNewBirthday(true); }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border-2 border-amber-400 text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-500/5 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"
          >
            <span className="text-base leading-none">🎂</span>
            Nova de aniversariante
          </button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-500 shadow-lg shadow-red-500/25">
            <Plus size={16} />{t('crm.action.newCampaign', 'Nova Campanha')}
          </button>
        </div>
      </div>

      {/* Seção de campanhas de aniversário — só aparece quando há ≥ 1.
          Lista compacta: nome, status, antecedência, hora, stats acumuladas. */}
      {birthdayCampaigns.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider px-1">
            🎂 Aniversariantes (recorrentes)
          </p>
          <div className="space-y-2">
            {birthdayCampaigns.map(bc => {
              const dayLabel = bc.daysBeforeBirthday === 0
                ? 'No dia'
                : `${bc.daysBeforeBirthday}d antes`;
              return (
                <motion.div
                  key={bc.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  onClick={() => { setEditingBirthday(bc); setShowNewBirthday(true); }}
                  className={cn(
                    'rounded-2xl border p-4 cursor-pointer transition-shadow hover:shadow-md',
                    bc.enabled
                      ? 'bg-amber-50/40 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20'
                      : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700/50 opacity-70',
                  )}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{bc.name}</h4>
                      <span className={cn(
                        'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                        bc.enabled
                          ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
                      )}>
                        {bc.enabled ? 'Ativa' : 'Pausada'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
                      <span>{dayLabel}</span>
                      <span>·</span>
                      <span>{String(bc.sendAtHour).padStart(2, '0')}:00</span>
                      <span>·</span>
                      <span className="capitalize">{bc.viaBaileys ? 'WA Web' : 'WA Cloud'}</span>
                    </div>
                  </div>
                  {(bc.stats.totalSent > 0 || bc.stats.totalFailed > 0) && (
                    <div className="mt-2 flex items-center gap-3 text-[11px]">
                      <span className="text-gray-500 dark:text-gray-400">
                        Enviadas: <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">{bc.stats.totalSent}</strong>
                      </span>
                      {bc.stats.totalDelivered > 0 && (
                        <span className="text-gray-500 dark:text-gray-400">
                          Entregues: <strong className="text-blue-600 dark:text-blue-400 tabular-nums">{bc.stats.totalDelivered}</strong>
                        </span>
                      )}
                      {bc.stats.totalRead > 0 && (
                        <span className="text-gray-500 dark:text-gray-400">
                          Lidas: <strong className="text-purple-600 dark:text-purple-400 tabular-nums">{bc.stats.totalRead}</strong>
                        </span>
                      )}
                      {bc.stats.totalFailed > 0 && (
                        <span className="text-gray-500 dark:text-gray-400">
                          Falhas: <strong className="text-red-600 dark:text-red-400 tabular-nums">{bc.stats.totalFailed}</strong>
                        </span>
                      )}
                      {bc.stats.lastRanAt && (
                        <span className="text-gray-400 dark:text-gray-500 ml-auto">
                          última: {new Date(bc.stats.lastRanAt).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {broadcasts.length === 0 && birthdayCampaigns.length === 0 ? <div className="text-center py-16 bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-700/50"><Send className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" /><p className="text-sm font-semibold text-gray-600 dark:text-gray-400">{t('crm.campaign.none', 'Nenhuma campanha')}</p></div>
      : <div className="space-y-3">
          {/* Header da seção pontuais — só renderiza se houver as duas listas
              coexistindo, pra orientar o operador. Quando só pontuais, header
              redundante (título "Campanhas" no topo já cobre). */}
          {broadcasts.length > 0 && birthdayCampaigns.length > 0 && (
            <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1 mt-2">
              Campanhas pontuais
            </p>
          )}
          {broadcasts.map((b) => {
          const sc = BROADCAST_STATUS_LABELS[b.status];
          // Taxas derivadas: deliveryRate sobre sent (não total), readRate sobre delivered.
          const deliveryRate = b.stats.sent > 0 ? b.stats.delivered / b.stats.sent : 0;
          const readRate = b.stats.delivered > 0 ? b.stats.read / b.stats.delivered : 0;
          // Taxa de falha sobre PROCESSADAS (sent + failed), não sobre total —
          // evita diluição quando há pile-up de pending no cron.
          const processed = b.stats.sent + b.stats.failed;
          const failureRate = processed > 0 ? b.stats.failed / processed : 0;
          return (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => setOpenBroadcast(b)}
              className="bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-700/50 p-5 hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{b.name}</h4>
                <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', sc.bg, sc.color)}>
                  {t('crm.broadcastStatus.' + b.status, sc.label)}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                <span className="capitalize">{b.channel}</span>
                <span>·</span>
                <span>{formatDate(b.createdAt)}</span>
                {b.stats.total > 0 && <><span>·</span><span>{b.stats.total} {b.stats.total !== 1 ? 'recipientes' : 'recipiente'}</span></>}
              </div>
              {b.stats.total > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5">
                  {/* Linha 1: barras visuais com taxa */}
                  <CampaignMiniBar
                    label={t('crm.campaign.delivered', 'Entregues')}
                    rate={deliveryRate}
                    counts={`${b.stats.delivered}/${b.stats.sent || b.stats.total}`}
                    color="blue"
                  />
                  <CampaignMiniBar
                    label={t('crm.campaign.read', 'Lidas')}
                    rate={readRate}
                    counts={`${b.stats.read}/${b.stats.delivered || b.stats.total}`}
                    color="purple"
                  />
                  {/* Linha 2: enviadas + falhas (falhas só se > 0) */}
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-500 dark:text-gray-400">{t('crm.campaign.sent', 'Enviadas')}</span>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">{b.stats.sent}</span>
                  </div>
                  {b.stats.failed > 0 ? (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-500 dark:text-gray-400">Falhas</span>
                      <span className="font-semibold text-red-600 dark:text-red-400 tabular-nums">
                        {b.stats.failed} <span className="text-[10px] text-red-500/70">({Math.round(failureRate * 100)}%)</span>
                      </span>
                    </div>
                  ) : <div />}
                </div>
              )}
            </motion.div>
          );
        })}</div>}
      <AnimatePresence>{openBroadcast && <BroadcastDetailDialog broadcast={openBroadcast} onClose={() => setOpenBroadcast(null)} onRetryCreated={() => setOpenBroadcast(null)} onDeleted={() => setOpenBroadcast(null)} />}</AnimatePresence>
      {user && (
        <BirthdayCampaignDialog
          open={showNewBirthday}
          onClose={() => { setShowNewBirthday(false); setEditingBirthday(null); }}
          businessId={businessId}
          user={{ uid: user.uid, name: user.name }}
          editing={editingBirthday}
          availableConnections={availableConnections}
          clients={existingClients}
        />
      )}
      <ModernDialog
        open={showNew}
        onClose={() => setShowNew(false)}
        icon={Megaphone}
        title={t('crm.dialog.newCampaign', 'Nova Campanha')}
        badges={formViaBaileys ? <ModernPill tone="amber">WhatsApp Web</ModernPill> : undefined}
        subtitle={
          <>
            <ModernPill tone="red"><Send size={12} />{channelLabel}</ModernPill>
            <ModernPill tone="blue"><Users size={12} />{audienceLabel}</ModernPill>
            <ModernPill tone={activeRecipients.length > 0 ? 'emerald' : 'slate'}>
              {activeRecipients.length} destinatário{activeRecipients.length === 1 ? '' : 's'}
            </ModernPill>
          </>
        }
        footer={
          <ModernDialogActions
            status={
              <>
                <ModernPill tone={activeRecipients.length > 0 ? 'emerald' : 'slate'}>
                  {activeRecipients.length} destinatário{activeRecipients.length === 1 ? '' : 's'}
                </ModernPill>
                <span className="truncate">{audienceLabel} · {channelLabel}</span>
              </>
            }
          >
            <ModernCancelButton onClick={() => setShowNew(false)}>
              {t('crm.action.cancel', 'Cancelar')}
            </ModernCancelButton>
            <ModernPrimaryButton
              onClick={handleCreate}
              disabled={createDisabled}
              startIcon={!saving ? <Send size={16} /> : undefined}
            >
              {saving ? t('crm.action.creating', 'Criando...') : t('crm.action.create', 'Criar')}
            </ModernPrimaryButton>
          </ModernDialogActions>
        }
      >
          <ModernSection
            icon={Settings2}
            title="Configuração"
            meta={<ModernPill tone="slate">1</ModernPill>}
          >
            <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-3">
              <TextField label={t('crm.form.name', 'Nome')} value={formName} onChange={(e) => setFormName(e.target.value)} fullWidth size="small" />
              <FormControl fullWidth size="small">
            <InputLabel>{t('crm.form.channel', 'Canal')}</InputLabel>
            <Select
              value={formChannel}
              label={t('crm.form.channel', 'Canal')}
              onChange={(e) => {
                const c = e.target.value as typeof formChannel;
                setFormChannel(c);
                // Email: força text, limpa template (Meta templates não se aplicam)
                if (c === 'email') setFormMsgType('text');
                // viaBaileys só faz sentido com whatsapp — limpa flag em outros canais
                if (c !== 'whatsapp') setFormViaBaileys(false);
                // Lista carregada pode virar incompatível ao trocar canal
                // (ex: lista 'phone' selecionada e usuário muda para email).
                // Limpa selectedListId + formRecipients quando incompatível.
                const newDesiredType = c === 'email' ? 'email' : 'phone';
                if (selectedListId) {
                  const list = savedLists.find(l => l.id === selectedListId);
                  if (list && list.type !== newDesiredType && list.type !== 'mixed') {
                    setSelectedListId('');
                    setFormRecipients([]);
                    setFormCsvColumns([]);
                    setRecipientResetKey(k => k + 1);
                    toast.info(`Lista "${list.name}" não é compatível com canal ${c}. Selecione outra ou cole nova lista.`);
                  }
                }
                // Mesmo sem lista, recipients colados manualmente podem ser do tipo errado
                // (ex: colou phones, troca para email). Resetamos para evitar confusão.
                if (formRecipients.length > 0 && !selectedListId) {
                  const firstHasPhone = !!formRecipients[0].phoneNumber;
                  const firstHasEmail = !!formRecipients[0].email;
                  const incompatible = (newDesiredType === 'phone' && !firstHasPhone)
                    || (newDesiredType === 'email' && !firstHasEmail);
                  if (incompatible) {
                    setFormRecipients([]);
                    setFormCsvColumns([]);
                    setRecipientResetKey(k => k + 1);
                  }
                }
              }}
            >
              {/* Apenas WhatsApp e Email suportam campanhas (envios outbound
                  iniciados pelo negócio). Facebook Messenger e Instagram
                  exigem que o cliente inicie a conversa primeiro — a API da
                  Meta proíbe cold outreach nesses canais. Messenger tem
                  Marketing Messages (paga, desde Jan/2026), mas exige opt-in
                  prévio em conversa anterior; Instagram não suporta broadcast
                  desde fev/2024. Voltam aqui se/quando integrarmos a API
                  específica de Marketing Messages com fluxo de opt-in. */}
              <MenuItem value="whatsapp">WhatsApp</MenuItem>
              <MenuItem value="email" disabled={!notificationServerReady}>
                Email {!notificationServerReady && '(configure notification-server)'}
              </MenuItem>
            </Select>
              </FormControl>
            </div>
          {/* Toggle Cloud vs Baileys — só aparece se ambos disponíveis */}
          {formChannel === 'whatsapp' && baileysReady && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Modo de envio</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormViaBaileys(false)}
                  className={cn(
                    'flex-1 px-3 py-2 text-xs rounded-lg border-2 transition-colors text-left',
                    !formViaBaileys
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300',
                  )}
                >
                  <p className="font-bold text-gray-900 dark:text-gray-100">WhatsApp Business (Cloud)</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Oficial Meta · requer template aprovado</p>
                </button>
                <button
                  type="button"
                  onClick={() => setFormViaBaileys(true)}
                  className={cn(
                    'flex-1 px-3 py-2 text-xs rounded-lg border-2 transition-colors text-left',
                    formViaBaileys
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                      : 'border-gray-200 dark:border-gray-700 hover:border-emerald-300',
                  )}
                >
                  <p className="font-bold text-gray-900 dark:text-gray-100">WhatsApp Web (Baileys)</p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Texto livre · sem template</p>
                </button>
              </div>
              {formViaBaileys && (
                <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                    ⚠️ <strong>Risco de banimento:</strong> envios em massa via Baileys violam ToS do WhatsApp.
                    Use com moderação (recomendado: ≤200 msgs/dia, delay ≥2s entre envios).
                  </p>
                </div>
              )}
            </div>
          )}
          {/* Seletor "Enviar de" — só aparece quando há mais de 1 connection
              elegível (na maioria dos negócios é 1 só, então fica oculto). */}
          {formChannel !== 'email' && eligibleConnections.length > 1 && (
            <FormControl fullWidth size="small">
              <InputLabel>Enviar de</InputLabel>
              <Select
                value={formChannelConnectionId}
                label="Enviar de"
                onChange={(e) => setFormChannelConnectionId(e.target.value as string)}
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
          {formChannel !== 'email' && eligibleConnections.length === 0 && (
            <div className="px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
              <p className="text-[10px] text-red-700 dark:text-red-400 leading-relaxed">
                Nenhum canal {formChannel === 'whatsapp' ? (formViaBaileys ? 'Baileys' : 'Cloud') : formChannel} conectado e disponível pra você.
                Conecte um em Configurações → Canais.
              </p>
            </div>
          )}
          </ModernSection>

          <ModernSection
            icon={Users}
            title="Audiência"
            meta={<ModernPill tone={activeRecipients.length > 0 ? 'emerald' : 'slate'}>{activeRecipients.length} prontos</ModernPill>}
          >
          <FormControl fullWidth size="small">
            <InputLabel>{t('crm.form.audience', 'Audiência')}</InputLabel>
            <Select value={formAudienceType} label={t('crm.form.audience', 'Audiência')} onChange={(e) => {
              const next = e.target.value as typeof formAudienceType;
              setFormAudienceType(next);
              // 5.8: csvColumns só fazem sentido para audienceType='list' (recipients
              // CSV importados). Se troca para all_contacts/tags/manual, limpa
              // colunas (e o TemplateSelector vai ocultar o optgroup) — evita
              // template stale apontando para colunas que não existem.
              if (next !== 'list' && formCsvColumns.length > 0) {
                setFormCsvColumns([]);
                // Se template já mapeou csvColumn, remapeia esses params para
                // 'literal' vazio — força operador a re-decidir antes de criar.
                if (formTemplate?.params.some(p => p.kind === 'csvColumn')) {
                  setFormTemplate({
                    ...formTemplate,
                    params: formTemplate.params.map(p =>
                      p.kind === 'csvColumn' ? { kind: 'literal', value: '' } : p
                    ),
                  });
                  toast.info('Mapeamentos de colunas CSV foram resetados — audiência mudou.');
                }
              }
            }}>
              <MenuItem value="list">Lista direta (cole ou CSV)</MenuItem>
              <MenuItem value="filtered_clients">Clientes cadastrados filtrados</MenuItem>
              <MenuItem value="segment">Segmento salvo</MenuItem>
              <MenuItem value="tags">{t('crm.form.byTags', 'Por tags')}</MenuItem>
              <MenuItem value="all_contacts">{t('crm.form.all', 'Todos os contatos CRM')}</MenuItem>
            </Select>
          </FormControl>
          {formAudienceType === 'tags' && (
            <TextField
              label={t('crm.form.tags', 'Tags')}
              value={formTags}
              onChange={(e) => setFormTags(e.target.value)}
              fullWidth
              size="small"
              helperText="Separe múltiplas tags por vírgula. O cliente precisa ter todas."
            />
          )}
          {formAudienceType === 'segment' && (
            <FormControl fullWidth size="small">
              <InputLabel>Segmento</InputLabel>
              <Select value={formSegmentId} label="Segmento" onChange={(e) => setFormSegmentId(e.target.value)}>
                <MenuItem value="">Selecione um segmento…</MenuItem>
                {availableSegments.map(seg => (
                  <MenuItem key={seg.id} value={seg.id}>
                    {seg.name} ({existingClients.filter(c => matchesAudienceFilterGroups(
                      c,
                      seg.filterGroups?.length ? seg.filterGroups : [{ id: 'legacy', filters: seg.filters ?? [] }],
                      {
                        channel: formChannel,
                        conversationContactIdsByChannel: audienceConversationIndex.contactIdsByChannel,
                        conversationRecipientIdsByChannel: audienceConversationIndex.recipientIdsByChannel,
                      },
                    )).length})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {formAudienceType === 'filtered_clients' && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Filtros de clientes</p>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => setAudiencePreset('age30')}
                    className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-[10px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700">
                    30+ WhatsApp
                  </button>
                  <button type="button" onClick={() => setAudiencePreset('facebook')}
                    className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-[10px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/20">
                    Facebook Page
                  </button>
                  <button type="button" onClick={() => setAudiencePreset('tag')}
                    className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-500/10 text-[10px] font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/20">
                    Tag remarketing
                  </button>
                </div>
              </div>

              {formAudienceFilterGroups.map((group, gIdx) => (
                <React.Fragment key={group.id}>
                  {gIdx > 0 && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                      <span className="text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded-full">OU</span>
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                    </div>
                  )}
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/60">
                      <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {formAudienceFilterGroups.length > 1 ? `Grupo ${gIdx + 1}` : 'Todas as condições'}
                      </p>
                      {formAudienceFilterGroups.length > 1 && (
                        <button type="button" onClick={() => setFormAudienceFilterGroups(prev => prev.filter((_, i) => i !== gIdx))}
                          className="text-[10px] text-red-500 hover:text-red-700 font-medium">
                          Remover grupo
                        </button>
                      )}
                    </div>
                    <div className="p-3 space-y-2">
                      {group.filters.map((filter, fIdx) => (
                        <React.Fragment key={`${group.id}-${fIdx}`}>
                          {fIdx > 0 && <p className="text-[9px] font-bold text-gray-400 uppercase px-1">E</p>}
                          <FilterRow
                            filter={filter}
                            fields={CAMPAIGN_AUDIENCE_FIELDS}
                            onChange={next => updateAudienceFilter(gIdx, fIdx, next)}
                            onRemove={() => removeAudienceFilter(gIdx, fIdx)}
                          />
                        </React.Fragment>
                      ))}
                      <button type="button" onClick={() => addAudienceFilter(gIdx)}
                        className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 flex items-center gap-1 mt-1">
                        <Plus size={11} />Adicionar condição
                      </button>
                    </div>
                  </div>
                </React.Fragment>
              ))}
              <button type="button" onClick={() => setFormAudienceFilterGroups(prev => [...prev, makeCampaignAudienceGroup()])}
                className="w-full py-2 rounded-xl border-2 border-dashed border-red-200 dark:border-red-500/20 text-xs font-semibold text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/5 transition-colors flex items-center justify-center gap-1.5">
                <Plus size={12} />Adicionar grupo (OU)
              </button>
            </div>
          )}
          {formAudienceType === 'list' && (() => {
            const desiredType = formChannel === 'email' ? 'email' : 'phone';
            // Filtra listas compatíveis com canal atual: 'mixed' serve para ambos.
            const compatibleLists = savedLists.filter(l => l.type === desiredType || l.type === 'mixed');
            const activeList = selectedListId ? savedLists.find(l => l.id === selectedListId) : null;
            return (
              <div className="space-y-3">
                {compatibleLists.length > 0 && (
                  <FormControl fullWidth size="small">
                    <InputLabel>Carregar lista salva</InputLabel>
                    <Select
                      value={selectedListId}
                      label="Carregar lista salva"
                      onChange={(e) => {
                        const id = e.target.value as string;
                        setSelectedListId(id);
                        if (!id) {
                          setFormRecipients([]);
                          setFormCsvColumns([]);
                          setRecipientResetKey(k => k + 1);
                          return;
                        }
                        const list = savedLists.find(l => l.id === id);
                        if (list) {
                          // Filtra recipientes incompatíveis (lista mixed em canal phone só usa phone)
                          const compatible = list.recipients.filter(r =>
                            desiredType === 'phone' ? !!r.phoneNumber : !!r.email
                          );
                          setFormRecipients(compatible);
                          // 5.8: extrai colunas extras únicas dos recipients da lista salva
                          const cols = new Set<string>();
                          for (const r of compatible) {
                            if (r.customColumns) {
                              for (const k of Object.keys(r.customColumns)) cols.add(k);
                            }
                          }
                          setFormCsvColumns(Array.from(cols));
                          if (compatible.length < list.recipients.length) {
                            toast.info(`${list.recipients.length - compatible.length} recipiente(s) ignorados (incompatíveis com canal ${formChannel}).`);
                          }
                          // Pré-preenche checkbox como falso — já existe, não duplica
                          setSaveAsList(false);
                          setListSaveName('');
                        }
                      }}
                    >
                      <MenuItem value="">— nenhuma (digitar/colar abaixo) —</MenuItem>
                      {compatibleLists.map(l => (
                        <MenuItem key={l.id} value={l.id}>
                          {l.name} ({l.recipientCount})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                {activeList ? (
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 truncate">
                        Usando lista: {activeList.name}
                      </p>
                      <p className="text-[11px] text-blue-600/80 dark:text-blue-400/80">
                        {formRecipients.length} recipiente(s) · criada por {activeList.createdByName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedListId('');
                        setFormRecipients([]);
                        setFormCsvColumns([]);
                        setRecipientResetKey(k => k + 1);
                      }}
                      className="text-xs font-semibold text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap"
                    >
                      Trocar lista
                    </button>
                  </div>
                ) : (
                  <>
                    <RecipientListInput
                      key={`recipient-input-${recipientResetKey}-${desiredType}`}
                      mode={desiredType}
                      onChange={(recipients, stats) => {
                        setFormRecipients(recipients);
                        // 5.8: armazena colunas extras pra disponibilizar no TemplateSelector.
                        setFormCsvColumns(stats.csvColumns);
                      }}
                      existingClients={existingClients}
                    />
                    {formRecipients.length > 0 && (
                      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={saveAsList}
                            onChange={(e) => setSaveAsList(e.target.checked)}
                            className="w-4 h-4 rounded accent-red-600"
                          />
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Salvar como lista reusável
                          </span>
                        </label>
                        {saveAsList && (
                          <TextField
                            label="Nome da lista"
                            value={listSaveName}
                            onChange={(e) => setListSaveName(e.target.value.slice(0, 120))}
                            placeholder="Ex: Clientes inativos · jan/2026"
                            fullWidth
                            size="small"
                            inputProps={{ maxLength: 120 }}
                          />
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
          {formAudienceType !== 'list' && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Audiência resolvida</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {audienceSelectionIncomplete ? 0 : resolvedClientAudience.matchedClients.length} cliente(s) encontrados · {activeRecipients.length} com destino válido
                  </p>
                </div>
                <span className={cn(
                  'text-xs font-bold px-2.5 py-1 rounded-full',
                  activeRecipients.length > 0
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400',
                )}>
                  {activeRecipients.length}
                </span>
              </div>
              {!audienceSelectionIncomplete && (
                <div className="flex items-center gap-3 flex-wrap text-[10px] text-gray-500 dark:text-gray-400">
                  {resolvedClientAudience.skipped.missingDestination > 0 && (
                    <span>{resolvedClientAudience.skipped.missingDestination} sem {getCampaignDestinationLabel(formChannel)}</span>
                  )}
                  {resolvedClientAudience.skipped.optInMissing > 0 && (
                    <span>{resolvedClientAudience.skipped.optInMissing} sem opt-in</span>
                  )}
                  {resolvedClientAudience.skipped.duplicateDestination > 0 && (
                    <span>{resolvedClientAudience.skipped.duplicateDestination} duplicado(s)</span>
                  )}
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formRequireMarketingOptIn}
                  onChange={(e) => setFormRequireMarketingOptIn(e.target.checked)}
                  className="w-4 h-4 rounded accent-red-600"
                />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Apenas clientes com opt-in marketing
                </span>
              </label>
            </div>
          )}
          {/* Limite de envio — agora toda audiência é materializada em recipients[]
              antes de criar a campanha, seja lista direta ou clientes filtrados. */}
          {activeRecipients.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/35 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">
                    Limite de envio
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {(() => {
                      const limit = typeof formRecipientLimit === 'number' && formRecipientLimit > 0
                        ? Math.min(formRecipientLimit, activeRecipients.length)
                        : activeRecipients.length;
                      return limit === activeRecipients.length
                        ? `Enviar para todos os ${activeRecipients.length} recipientes`
                        : `Enviar para os primeiros ${limit} de ${activeRecipients.length} recipientes`;
                    })()}
                  </p>
                </div>
                <TextField
                  type="number"
                  size="small"
                  value={formRecipientLimit}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') { setFormRecipientLimit(''); return; }
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n) && n > 0) {
                      setFormRecipientLimit(Math.min(n, activeRecipients.length));
                    }
                  }}
                  placeholder="todos"
                  inputProps={{ min: 1, max: activeRecipients.length, style: { textAlign: 'center' } }}
                  sx={{ width: 110 }}
                />
              </div>
              {formChannel === 'whatsapp' && formViaBaileys && (
                <div className="mt-2.5 flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200/70 dark:border-amber-500/20">
                  <AlertTriangle size={12} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                    Baileys recomenda no máximo <strong>200 envios/dia</strong> para reduzir risco de banimento.
                  </p>
                </div>
              )}
            </div>
          )}
          </ModernSection>

          {/* Velocidade de envio (throttle anti-spam) — sempre visível.
              Operador pode pré-configurar antes de colar a lista. Estimativa
              de tempo aparece só quando há recipientes (count > 0). */}
          <ModernSection
            icon={SlidersHorizontal}
            title="Entrega"
            meta={<ModernPill tone="slate">anti-spam</ModernPill>}
          >
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/35 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Velocidade de envio
                </p>
                <span className="text-[10px] text-gray-400">anti-spam / simulação humana</span>
              </div>

              {/* Preset buttons */}
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(THROTTLE_PRESETS) as ThrottlePresetKey[]).map(key => {
                  const preset = THROTTLE_PRESETS[key];
                  const isActive = formThrottlePreset === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setFormThrottlePreset(key);
                        setFormThrottle({ ...preset.throttle });
                      }}
                      className={cn(
                        'px-2 py-2 text-left rounded-lg border-2 transition-colors',
                        isActive
                          ? key === 'fast' ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10'
                            : key === 'human' ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10'
                            : 'border-amber-400 bg-amber-50 dark:bg-amber-500/10'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
                      )}
                    >
                      <p className="text-[10px] font-bold text-gray-900 dark:text-gray-100 leading-tight">
                        {preset.label}
                      </p>
                      <p className="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">
                        {preset.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Botão customizar */}
              <button
                type="button"
                onClick={() => setFormThrottlePreset(p => p === 'custom' ? 'human' : 'custom')}
                className="text-[10px] font-semibold text-red-600 dark:text-red-400 hover:underline"
              >
                {formThrottlePreset === 'custom' ? '↑ Voltar pros presets' : '⚙ Personalizar valores'}
              </button>

              {/* Inputs customizados */}
              {formThrottlePreset === 'custom' && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <ThrottleInput
                    label="Delay mín entre msgs (s)"
                    valueMs={formThrottle.delayMinMs}
                    onChangeMs={(ms) => setFormThrottle(t => ({ ...t, delayMinMs: ms }))}
                  />
                  <ThrottleInput
                    label="Delay máx entre msgs (s)"
                    valueMs={formThrottle.delayMaxMs}
                    onChangeMs={(ms) => setFormThrottle(t => ({ ...t, delayMaxMs: ms }))}
                  />
                  <div className="col-span-2">
                    <TextField
                      label="Tamanho do lote"
                      type="number"
                      size="small"
                      fullWidth
                      value={formThrottle.batchSize ?? 0}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setFormThrottle(t => ({ ...t, batchSize: Number.isFinite(n) && n >= 0 ? n : 0 }));
                      }}
                      inputProps={{ min: 0, max: 1000 }}
                      helperText="0 = sem batching"
                    />
                  </div>
                  {(formThrottle.batchSize ?? 0) > 0 && (
                    <>
                      <ThrottleInput
                        label="Pausa mín entre lotes (s)"
                        valueMs={formThrottle.batchPauseMinMs ?? 60_000}
                        onChangeMs={(ms) => setFormThrottle(t => ({ ...t, batchPauseMinMs: ms }))}
                      />
                      <ThrottleInput
                        label="Pausa máx entre lotes (s)"
                        valueMs={formThrottle.batchPauseMaxMs ?? 180_000}
                        onChangeMs={(ms) => setFormThrottle(t => ({ ...t, batchPauseMaxMs: ms }))}
                      />
                    </>
                  )}
                </div>
              )}

              {/* Estimativa só aparece com count > 0 (lista colada).
                  Antes disso, operador vê só os presets/inputs. */}
              {activeRecipients.length > 0 && (
                <ThrottleEstimate
                  recipientCount={
                    typeof formRecipientLimit === 'number' && formRecipientLimit > 0
                      ? Math.min(formRecipientLimit, activeRecipients.length)
                      : activeRecipients.length
                  }
                  throttle={formThrottle}
                />
              )}
            </div>
          </ModernSection>

          <ModernSection
            icon={MessageSquare}
            title="Mensagem"
            meta={<ModernPill tone={formMsgType === 'template' ? 'blue' : 'slate'}>{formChannel === 'email' || formViaBaileys ? 'Texto' : formMsgType === 'template' ? 'Template' : 'Texto'}</ModernPill>}
          >

          {/* Tipo de mensagem aparece só para canais Meta sem Baileys.
              Email = sempre texto livre. Baileys = sempre texto livre (sem template). */}
          {formChannel !== 'email' && !(formChannel === 'whatsapp' && formViaBaileys) && (
            <FormControl fullWidth size="small"><InputLabel>{t('crm.form.type', 'Tipo')}</InputLabel><Select value={formMsgType} label={t('crm.form.type', 'Tipo')} onChange={(e) => setFormMsgType(e.target.value as typeof formMsgType)}><MenuItem value="template">{t('crm.form.template', 'Template')}</MenuItem><MenuItem value="text">{t('crm.form.text', 'Texto')}</MenuItem></Select></FormControl>
          )}
          {formChannel === 'email' && (
            <TextField label="Assunto do email" value={formEmailSubject} onChange={(e) => setFormEmailSubject(e.target.value)} fullWidth size="small" />
          )}
          {/* TemplateSelector só para Cloud (não-email, não-baileys) com tipo template */}
          {formChannel !== 'email' && !(formChannel === 'whatsapp' && formViaBaileys) && formMsgType === 'template' ? (
            <TemplateSelector
              businessId={businessId}
              value={formTemplate}
              onChange={setFormTemplate}
              sampleRecipient={activeRecipients[0]}
              channel={formChannel}
              csvColumns={formAudienceType === 'list' ? formCsvColumns : []}
            />
          ) : formChannel === 'email' ? (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Corpo do email</p>
              <EmailBodyEditor
                value={formContent}
                onChange={setFormContent}
                placeholder="Escreva o corpo do email — use a barra de formatação para negrito, links e listas."
                minRows={8}
              />
            </div>
          ) : (
            <TextField
              label={t('crm.form.content', 'Conteúdo')}
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              fullWidth
              multiline
              rows={3}
              size="small"
            />
          )}
          {/* Agendamento opcional — se preenchido, broadcast começa em status='scheduled'
              e é disparado automaticamente quando o cron processar (a cada 1min). */}
          <div className="space-y-2">
            <TextField
              label="Agendar para (opcional)"
              type="datetime-local"
              value={formScheduledAt}
              onChange={(e) => setFormScheduledAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
              helperText={formScheduledAt ? undefined : 'Deixe vazio para disparar manualmente'}
              fullWidth
              size="small"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Calendar size={16} className={cn(
                      formScheduledAt ? 'text-emerald-500' : 'text-slate-400'
                    )} />
                  </InputAdornment>
                ),
                endAdornment: formScheduledAt ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => setFormScheduledAt('')}
                      sx={{ color: 'rgb(148 163 184)', '&:hover': { color: 'rgb(220 38 38)' } }}
                      title="Limpar agendamento"
                    >
                      <X size={14} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              }}
            />
            {formScheduledAt && (() => {
              const date = new Date(formScheduledAt);
              if (Number.isNaN(date.getTime())) return null;
              const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
              const formatted = new Intl.DateTimeFormat('pt-BR', {
                weekday: 'short', day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit',
              }).format(date);
              return (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/70 dark:border-emerald-500/20">
                  <Clock size={13} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
                    Disparo automático em <strong className="font-bold capitalize">{formatted}</strong>
                    <span className="text-emerald-600/70 dark:text-emerald-400/70 ml-1">· {tz}</span>
                  </p>
                </div>
              );
            })()}
          </div>

          {/* Vínculo com oferta (Fase 4B do módulo Clientes) — opcional, só
              aparece quando o business tem ofertas cadastradas. Permite atribuir
              ROI e identificar qual campanha trouxe quais clientes. */}
          {campaignOffers.length > 0 && (
            <FormControl fullWidth size="small">
              <InputLabel>Vincular oferta (opcional)</InputLabel>
              <Select
                value={formOfferId}
                label="Vincular oferta (opcional)"
                onChange={(e) => setFormOfferId(e.target.value)}
                renderValue={(selected) => {
                  if (!selected) return <span className="text-slate-400">— Sem oferta vinculada —</span>;
                  const offer = campaignOffers.find(o => o.id === selected);
                  if (!offer) return selected;
                  return (
                    <span className="inline-flex items-center gap-1.5">
                      <Tag size={13} className="text-red-500" />
                      {offer.name}{!offer.isActive && <span className="text-[10px] text-slate-400">· arquivada</span>}
                    </span>
                  );
                }}
                displayEmpty
              >
                <MenuItem value=""><span className="text-slate-400">— Sem oferta vinculada —</span></MenuItem>
                {campaignOffers.map(o => (
                  <MenuItem key={o.id} value={o.id}>
                    <div className="flex items-center gap-2">
                      <Tag size={13} className="text-red-500" />
                      <span>{o.name}</span>
                      {!o.isActive && <ModernPill tone="slate">arquivada</ModernPill>}
                    </div>
                  </MenuItem>
                ))}
              </Select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 px-0.5">
                Quando set, a campanha fica vinculada à oferta — útil pra atribuição e relatórios futuros.
              </p>
            </FormControl>
          )}
          </ModernSection>

          {/* 5.12 LGPD — base legal do envio (obrigatório) */}
          <ModernSection
            icon={Shield}
            title="Compliance"
            meta={<ModernPill tone={formConsentBasis && formConsentAck ? 'emerald' : 'amber'}>LGPD</ModernPill>}
          >
          <div className="rounded-xl border-2 border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5 p-3 space-y-3">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-amber-900 dark:text-amber-200">Base legal LGPD</p>
                <p className="text-[10px] text-amber-700 dark:text-amber-300/80 leading-relaxed mt-0.5">
                  Você precisa ter uma base legal válida para enviar essa campanha.
                  Esta informação fica registrada em auditoria.
                </p>
              </div>
            </div>
            <FormControl fullWidth size="small" required>
              <InputLabel>Base legal *</InputLabel>
              <Select
                value={formConsentBasis}
                label="Base legal *"
                onChange={(e) => setFormConsentBasis(e.target.value as typeof formConsentBasis)}
              >
                <MenuItem value="">Selecione…</MenuItem>
                {(Object.keys(CONSENT_BASIS_LABELS) as ConsentBasis[]).map(k => (
                  <MenuItem key={k} value={k}>{CONSENT_BASIS_LABELS[k]}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Origem do consentimento (opcional)"
              value={formConsentSource}
              onChange={(e) => setFormConsentSource(e.target.value.slice(0, 200))}
              placeholder="Ex: Form da landing X · jan/2026"
              fullWidth
              size="small"
              inputProps={{ maxLength: 200 }}
              helperText="Texto livre — descreva onde os contatos consentiram receber comunicações."
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <LinkIcon size={14} className="text-amber-500" />
                  </InputAdornment>
                ),
              }}
            />
            <button
              type="button"
              onClick={() => setFormConsentAck(!formConsentAck)}
              className={cn(
                'w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all',
                formConsentAck
                  ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/40'
                  : 'border-amber-300/70 dark:border-amber-500/30 bg-white/60 dark:bg-slate-950/30 hover:border-amber-400 dark:hover:border-amber-500/50'
              )}
            >
              <div className={cn(
                'flex-shrink-0 mt-0.5 w-5 h-5 rounded-md flex items-center justify-center transition-all',
                formConsentAck
                  ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                  : 'bg-white dark:bg-slate-800 border-2 border-amber-300 dark:border-amber-500/40'
              )}>
                {formConsentAck && <Check size={13} strokeWidth={3} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn(
                  'text-[11px] leading-relaxed transition-colors',
                  formConsentAck
                    ? 'text-emerald-900 dark:text-emerald-200 font-medium'
                    : 'text-amber-900 dark:text-amber-200'
                )}>
                  Confirmo que possuo base legal para enviar esta campanha aos
                  recipientes selecionados, conforme <strong>LGPD art. 7º</strong>.
                </p>
              </div>
            </button>
          </div>
          </ModernSection>
      </ModernDialog>
    </div>
  );
}

// ==========================================
// MAIN ORCHESTRATOR
// ==========================================

// ─── Pipeline Settings Modal ──────────────────────────────────────────────────

function PipelineSettingsModal({
  current,
  businessId,
  onClose,
  onSaved,
}: {
  current?: CRMPipelineConfig;
  businessId: string;
  onClose: () => void;
  onSaved: (cfg: CRMPipelineConfig) => void;
}) {
  const [stages, setStages] = useState<CRMStageConfig[]>(
    current?.stages?.length ? [...current.stages].sort((a, b) => a.order - b.order) : [...DEFAULT_CRM_PIPELINE]
  );
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<CRMStageConfig>) =>
    setStages(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    setStages(prev => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, idx) => ({ ...s, order: idx }));
    });
  };

  const setWon = (i: number) =>
    setStages(prev => prev.map((s, idx) => ({ ...s, isWon: idx === i, isLost: idx === i ? false : s.isLost })));

  const setLost = (i: number) =>
    setStages(prev => prev.map((s, idx) => ({ ...s, isLost: idx === i, isWon: idx === i ? false : s.isWon })));

  const handleSave = async () => {
    setSaving(true);
    const cfg: CRMPipelineConfig = {
      stages: stages.map((s, idx) => ({ ...s, order: idx })),
    };
    try {
      await updateDoc(doc(db, 'businesses', businessId), {
        'settings.crmPipeline': cfg,
        updatedAt: new Date().toISOString(),
      });
      onSaved(cfg);
      onClose();
    } catch (err) {
      console.error('Pipeline save error:', err);
      toast.error('Erro ao salvar configurações do pipeline');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
              <Settings2 className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Configurar Pipeline</h2>
              <p className="text-[10px] text-gray-400">Renomeie, reordene e personalize os estágios</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stage list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Legend */}
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-2 px-2 pb-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
            <span />
            <span>Nome do estágio</span>
            <span className="text-center">Ganho</span>
            <span className="text-center">Perdido</span>
            <span className="text-center">Visível</span>
            <span />
          </div>

          {stages.map((stage, i) => (
            <div key={stage.id} className={cn(
              'grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-2 items-center p-2.5 rounded-xl border transition-colors',
              stage.isVisible === false
                ? 'border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 opacity-60'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
            )}>
              {/* Color + name */}
              <input
                type="color"
                value={stage.color}
                onChange={e => update(i, { color: e.target.value })}
                className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent flex-shrink-0"
              />
              <input
                value={stage.name}
                onChange={e => update(i, { name: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-red-500/30"
              />

              {/* Won toggle */}
              <button
                onClick={() => setWon(i)}
                title="Marcar como estágio de ganho"
                className={cn('w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all text-[10px]',
                  stage.isWon ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-300'
                )}
              >W</button>

              {/* Lost toggle */}
              <button
                onClick={() => setLost(i)}
                title="Marcar como estágio de perda"
                className={cn('w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all text-[10px]',
                  stage.isLost ? 'border-red-500 bg-red-500 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-300'
                )}
              >L</button>

              {/* Visibility toggle */}
              <button
                onClick={() => update(i, { isVisible: stage.isVisible === false ? true : false })}
                title={stage.isVisible === false ? 'Mostrar no kanban' : 'Ocultar do kanban'}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {stage.isVisible === false
                  ? <EyeOff className="w-3.5 h-3.5" />
                  : <Eye className="w-3.5 h-3.5" />}
              </button>

              {/* Reorder */}
              <div className="flex flex-col gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="p-0.5 text-gray-300 dark:text-gray-600 hover:text-gray-500 disabled:opacity-20 transition-colors">
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === stages.length - 1}
                  className="p-0.5 text-gray-300 dark:text-gray-600 hover:text-gray-500 disabled:opacity-20 transition-colors">
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}

          <p className="text-[10px] text-gray-400 text-center pt-1">
            W = estágio de conversão (verde) · L = estágio de perda (vermelho) · Olho = visível no kanban
          </p>
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar pipeline'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM EXPORT CSV MODAL
// ─────────────────────────────────────────────────────────────────────────────

const CRM_EXPORT_COLUMNS: { key: string; label: string }[] = [
  { key: 'name', label: 'Nome' },
  { key: 'email', label: 'E-mail' },
  { key: 'phone', label: 'Telefone' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'company', label: 'Empresa' },
  { key: 'role', label: 'Cargo' },
  { key: 'source', label: 'Origem' },
  { key: 'stageName', label: 'Status' },
  { key: 'score', label: 'Score' },
  { key: 'tagsStr', label: 'Tags' },
  { key: 'notes', label: 'Notas' },
  { key: 'assignedToName', label: 'Responsável' },
  { key: 'createdAt', label: 'Criado em' },
];

function CRMExportModal({ contacts, stages, onClose }: { contacts: CRMContact[]; stages: CRMStageConfig[]; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(CRM_EXPORT_COLUMNS.map(c => c.key)));

  const toggle = (key: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const handleExport = () => {
    const cols = CRM_EXPORT_COLUMNS.filter(c => selected.has(c.key));
    const esc = (v: string) => (v.includes(';') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : v;
    const header = cols.map(c => c.label).join(';');
    const rows = contacts.map(c => cols.map(col => {
      let val = '';
      if (col.key === 'tagsStr') val = (c.tags ?? []).join(', ');
      else if (col.key === 'stageName') val = getStageLabel(stages, c.status);
      else if (col.key === 'source') val = SOURCE_LABELS[c.source] ?? c.source;
      else if (col.key === 'createdAt') val = formatDate(c.createdAt) || '';
      else val = String((c as unknown as Record<string, unknown>)[col.key] ?? '');
      return esc(val);
    }).join(';'));
    const csv = '﻿' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crm_contatos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center"><Download size={18} className="text-white" /></div>
            <span className="text-base font-display font-bold text-gray-900 dark:text-gray-100">Exportar Contatos</span>
          </div>
          <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
        </div>
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Selecione as colunas ({contacts.length} contatos)</p>
        <div className="grid grid-cols-2 gap-2">
          {CRM_EXPORT_COLUMNS.map(col => (
            <label key={col.key} className={cn('flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all text-sm',
              selected.has(col.key)
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-gray-700 text-gray-500')}>
              <input type="checkbox" checked={selected.has(col.key)} onChange={() => toggle(col.key)} className="w-3.5 h-3.5 accent-emerald-500" />
              {col.label}
            </label>
          ))}
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} variant="outlined" sx={{ borderRadius: '10px' }}>Cancelar</Button>
        <Button onClick={handleExport} variant="contained" disabled={selected.size === 0}
          sx={{ borderRadius: '10px', bgcolor: '#10b981', '&:hover': { bgcolor: '#059669' } }}>
          Exportar CSV
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM IMPORT CSV MODAL
// ─────────────────────────────────────────────────────────────────────────────

const CRM_IMPORT_FIELDS: { key: string; label: string; aliases: string[] }[] = [
  { key: 'name', label: 'Nome', aliases: ['nome', 'name', 'contato'] },
  { key: 'email', label: 'E-mail', aliases: ['email', 'e-mail'] },
  { key: 'phone', label: 'Telefone', aliases: ['telefone', 'phone', 'tel', 'fone'] },
  { key: 'whatsapp', label: 'WhatsApp', aliases: ['whatsapp', 'wpp', 'zap'] },
  { key: 'company', label: 'Empresa', aliases: ['empresa', 'company'] },
  { key: 'role', label: 'Cargo', aliases: ['cargo', 'role', 'função', 'funcao'] },
  { key: 'source', label: 'Origem', aliases: ['origem', 'source', 'canal'] },
  { key: 'status', label: 'Status', aliases: ['status', 'estagio', 'estágio', 'stage'] },
  { key: 'score', label: 'Score', aliases: ['score', 'pontuação', 'pontuacao'] },
  { key: 'tags', label: 'Tags', aliases: ['tags', 'etiquetas'] },
  { key: 'notes', label: 'Notas', aliases: ['notas', 'notes', 'observações', 'obs'] },
  { key: 'assignedToName', label: 'Responsável', aliases: ['responsavel', 'responsável', 'assigned'] },
];

const CRM_SOURCE_NORM: Record<string, LeadSource> = {
  whatsapp: 'whatsapp', facebook: 'facebook', instagram: 'instagram', linkedin: 'linkedin',
  indicacao: 'indicacao', indicação: 'indicacao', site: 'site', website: 'site',
  google: 'google_ads', google_ads: 'google_ads', evento: 'evento', email: 'email',
  telefone: 'telefone', outro: 'outro', other: 'outro',
};

const CRM_STATUS_NORM: Record<string, LeadStatus> = {
  novo: 'novo', new: 'novo',
  contatado: 'contatado', contato: 'contatado', contacted: 'contatado',
  qualificado: 'qualificado', qualified: 'qualificado',
  proposta: 'proposta', proposal: 'proposta',
  negociacao: 'negociacao', negociação: 'negociacao', negotiation: 'negociacao',
  ganho: 'ganho', fechado: 'ganho', won: 'ganho', closed: 'ganho',
  perdido: 'perdido', lost: 'perdido',
};

function crmAutoMap(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    const hl = h.toLowerCase().trim();
    out[h] = CRM_IMPORT_FIELDS.find(f => f.aliases.some(a => hl.includes(a)))?.key ?? '';
  }
  return out;
}

function CRMImportModal({ onClose, businessId, onImported }: { onClose: () => void; businessId: string; onImported: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rawData, setRawData] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    import('papaparse').then(({ default: Papa }) => {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (result) => {
          const data = result.data as Record<string, string>[];
          const hdrs = result.meta.fields ?? [];
          setRawData(data); setHeaders(hdrs); setMapping(crmAutoMap(hdrs)); setStep(2);
        },
      });
    });
  };

  const handleImport = async () => {
    setImporting(true);
    const now = new Date().toISOString();
    try {
      const BATCH_SIZE = 400; // Firestore batch max is 500
      let count = 0;
      let batch = writeBatch(db);
      let batchCount = 0;

      for (const row of rawData) {
        const contact: Record<string, unknown> = { businessId, createdAt: now, updatedAt: now, score: 0, status: 'novo' as LeadStatus, source: 'outro' as LeadSource };
        for (const [header, fieldKey] of Object.entries(mapping)) {
          if (!fieldKey) continue;
          const raw = (row[header] ?? '').trim();
          if (!raw) continue;
          if (fieldKey === 'score') contact.score = Number(raw) || 0;
          else if (fieldKey === 'tags') contact.tags = raw.split(',').map(t => t.trim()).filter(Boolean);
          else if (fieldKey === 'source') contact.source = CRM_SOURCE_NORM[raw.toLowerCase()] ?? 'outro';
          else if (fieldKey === 'status') contact.status = CRM_STATUS_NORM[raw.toLowerCase()] ?? 'novo';
          else contact[fieldKey] = raw;
        }
        if (!contact.name) continue;
        // Detecta tipo automaticamente pelos dígitos do cpfCnpj: 14 → PJ, 11 → PF.
        // Fallback PF mantém comportamento antigo (linha 3404 hardcodava 'pf').
        // Operador pode corrigir manualmente depois pelo dialog de edição.
        const digits = String(contact.cpfCnpj ?? '').replace(/\D/g, '');
        contact.tipo = digits.length === 14 ? 'pj' : 'pf';
        batch.set(doc(collection(db, 'clients')), contact);
        count++;
        batchCount++;
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
        }
      }
      if (batchCount > 0) await batch.commit();
      toast.success(`${count} contato(s) importado(s) com sucesso!`);
      onImported();
      onClose();
    } catch (err) {
      console.error('[CRM] Import error:', err);
      toast.error('Erro ao importar contatos');
    } finally { setImporting(false); }
  };

  const preview = rawData.slice(0, 5);
  const mappedHeaders = Object.entries(mapping).filter(([, v]) => v);

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center"><Upload size={18} className="text-white" /></div>
            <div>
              <span className="text-base font-display font-bold text-gray-900 dark:text-gray-100">Importar Contatos</span>
              <div className="flex items-center gap-1 mt-0.5">
                {([1, 2, 3] as const).map((s, i) => (
                  <React.Fragment key={s}>
                    {i > 0 && <div className={cn('w-8 h-0.5 transition-colors', step > s - 1 ? 'bg-blue-400' : 'bg-gray-200 dark:bg-gray-700')} />}
                    <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors',
                      step > s ? 'bg-blue-500 text-white' : step === s ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-400')}>
                      {step > s ? '✓' : s}
                    </div>
                  </React.Fragment>
                ))}
                <span className="text-xs text-gray-400 ml-1">{step === 1 ? 'Upload' : step === 2 ? 'Mapeamento' : 'Confirmar'}</span>
              </div>
            </div>
          </div>
          <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
        </div>
      </DialogTitle>

      <DialogContent sx={{ pt: '12px !important' }}>
        {step === 1 && (
          <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => fileRef.current?.click()}>
            <Upload size={36} className="text-gray-300 dark:text-gray-600 mb-3" />
            <p className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Clique para selecionar um arquivo CSV</p>
            <p className="text-xs text-gray-400 mt-1">Separador: vírgula ou ponto-e-vírgula</p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-300">{fileName}</span> — {rawData.length} linha(s). Mapeie as colunas:
            </p>
            <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
              {headers.map(h => (
                <div key={h} className="flex items-center gap-2 p-2.5 bg-gray-50 dark:bg-white/[0.04] rounded-lg border border-gray-100 dark:border-gray-700">
                  <span className="text-xs font-mono text-gray-500 flex-1 truncate" title={h}>{h}</span>
                  <span className="text-gray-300 text-xs">→</span>
                  <select value={mapping[h] ?? ''} onChange={e => setMapping(prev => ({ ...prev, [h]: e.target.value }))}
                    className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400">
                    <option value="">— Ignorar —</option>
                    {CRM_IMPORT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Prévia dos primeiros {Math.min(5, rawData.length)} de {rawData.length} contatos:
            </p>
            <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-white/[0.04]">
                    {mappedHeaders.map(([h]) => <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      {mappedHeaders.map(([h]) => <td key={h} className="px-3 py-2 text-gray-600 dark:text-gray-400 max-w-[140px] truncate">{row[h] ?? ''}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} variant="outlined" sx={{ borderRadius: '10px' }}>Cancelar</Button>
        {step === 2 && <>
          <Button onClick={() => setStep(1)} variant="outlined" sx={{ borderRadius: '10px' }}>Voltar</Button>
          <Button onClick={() => setStep(3)} disabled={!Object.values(mapping).some(v => v === 'name')}
            variant="contained" sx={{ borderRadius: '10px', bgcolor: '#3b82f6', '&:hover': { bgcolor: '#2563eb' } }}>
            Avançar
          </Button>
        </>}
        {step === 3 && <>
          <Button onClick={() => setStep(2)} variant="outlined" sx={{ borderRadius: '10px' }}>Voltar</Button>
          <Button onClick={handleImport} variant="contained" disabled={importing}
            sx={{ borderRadius: '10px', bgcolor: '#3b82f6', '&:hover': { bgcolor: '#2563eb' } }}>
            {importing ? 'Importando...' : `Importar ${rawData.length} contatos`}
          </Button>
        </>}
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CRMModule() {
  const { t } = useTranslation();

  const TABS: { key: CRMTab; label: string; icon: React.ReactNode; desc: string }[] = useMemo(() => [
    { key: 'kanban', label: t('crm.tab.kanban', 'Pipeline'), icon: <Layers size={15} />, desc: t('crm.tab.kanban_desc', 'Kanban de leads') },
    { key: 'campanhas', label: t('crm.tab.campaigns', 'Campanhas'), icon: <Send size={15} />, desc: t('crm.tab.campaigns_desc', 'Broadcasts') },
    { key: 'segmentos', label: t('crm.tab.segments', 'Segmentos'), icon: <Filter size={15} />, desc: t('crm.tab.segments_desc', 'Filtros AND/OR') },
    { key: 'metricas', label: t('crm.tab.metrics', 'Inteligência'), icon: <Brain size={15} />, desc: t('crm.tab.metrics_desc', 'Scores e insights') },
    { key: 'automacoes', label: t('crm.tab.automations', 'Automações'), icon: <Zap size={15} />, desc: t('crm.tab.automations_desc', 'Regras automáticas') },
    { key: 'sequencias', label: t('crm.tab.sequences', 'Sequências'), icon: <GitBranchIcon />, desc: t('crm.tab.sequences_desc', 'Follow-up multi-passo') },
    { key: 'formularios', label: t('crm.tab.forms', 'Formulários'), icon: <FileText size={15} />, desc: t('crm.tab.forms_desc', 'Fichas de anamnese') },
    { key: 'planos', label: t('crm.tab.plans', 'Planos'), icon: <Crown size={15} />, desc: t('crm.tab.plans_desc', 'Assinaturas recorrentes') },
  ], [t]);
  const { isDark } = useTheme();
  const { user, business } = useAuth();
  const { setActivePage } = useAppContext();
  const queryClient = useQueryClient();

  const isAdmin = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];
  const [pipelineConfig, setPipelineConfig] = useState<CRMPipelineConfig | undefined>(business?.settings?.crmPipeline);
  // Sync with remote business changes (e.g. another admin saves pipeline from another device)
  useEffect(() => {
    setPipelineConfig(business?.settings?.crmPipeline);
  }, [business?.settings?.crmPipeline]);
  const [showPipelineSettings, setShowPipelineSettings] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvMenuOpen, setCsvMenuOpen] = useState(false);
  const csvMenuRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!csvMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (csvMenuRef.current && !csvMenuRef.current.contains(e.target as Node)) setCsvMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [csvMenuOpen]);

  // Effective visible stages — recomputed when config changes
  const stages = useMemo(() => getVisibleStages(pipelineConfig), [pipelineConfig]);

  const [activeTab, setActiveTab] = useState<CRMTab>('kanban');
  const [pipelineView, setPipelineView] = useState<'kanban' | 'table'>(() => {
    if (typeof window === 'undefined') return 'kanban';
    return (localStorage.getItem('crm_pipeline_view') as 'kanban' | 'table') ?? 'kanban';
  });
  const handlePipelineView = (v: 'kanban' | 'table') => {
    setPipelineView(v);
    localStorage.setItem('crm_pipeline_view', v);
  };
  const [selectedContact, setSelectedContact] = useState<CRMContact | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterSource, setFilterSource] = useState<LeadSource | 'all'>('all');
  const [filterTipo, setFilterTipo] = useState<'pf' | 'pj' | 'all'>('all');
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleContact, setScheduleContact] = useState<CRMContact | null>(null);

  // Team members
  const [members, setMembers] = useState<User[]>([]);
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'users'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => { setMembers(snap.docs.map((d) => ({ ...d.data(), id: d.id } as User))); }, (err) => console.error('[CRM] Error fetching team members:', err));
    return () => unsub();
  }, [business?.id]);

  // Data fetching — listeners em tempo real (refactor sync multi-user):
  //
  // ANTES: 3x useQuery + getDocs sem staleTime explícito (caía no global,
  // antes 5min, agora 30s). Vendedor A movia deal de etapa, vendedor B só
  // via mudança após refetch — em pipeline drag&drop colaborativo isso é
  // crítico (B podia mover o mesmo deal pra outro stage assumindo dados
  // antigos, criando confusão).
  //
  // AGORA: onSnapshot pra contacts/deals/activities. Mudanças propagam
  // imediatamente em todos os boards Kanban e timeline de atividade.
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [deals, setDeals] = useState<CRMDeal[]>([]);
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [lc, setLc] = useState(true);
  const [ld, setLd] = useState(true);
  const [la, setLa] = useState(true);
  // Helper local — sort por createdAt desc usado pra contacts/deals/activities.
  // Mantido client-side pra evitar composite indexes (clients/businessId+
  // createdAt, crmDeals/businessId+createdAt, etc.).
  const sortByCreatedAtDesc = <T extends { createdAt?: string }>(arr: T[]): T[] =>
    arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  useEffect(() => {
    if (!business?.id) { setLc(false); return; }
    setLc(true);
    const q = query(collection(db, 'clients'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return { ...data, id: d.id, status: (data.status ?? 'novo') as CRMContact['status'], source: (data.source ?? 'outro') as CRMContact['source'], score: data.score ?? 0 } as CRMContact;
      }).filter(isActiveClient);
      setContacts(sortByCreatedAtDesc(list));
      setLc(false);
    }, (err) => { console.error('[CRM] contacts snapshot error:', err); setLc(false); });
    return () => unsub();
  }, [business?.id]);
  useEffect(() => {
    if (!business?.id) { setLd(false); return; }
    setLd(true);
    const q = query(collection(db, 'crmDeals'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ ...d.data(), id: d.id } as CRMDeal));
      setDeals(sortByCreatedAtDesc(list));
      setLd(false);
    }, (err) => { console.error('[CRM] deals snapshot error:', err); setLd(false); });
    return () => unsub();
  }, [business?.id]);
  useEffect(() => {
    if (!business?.id) { setLa(false); return; }
    setLa(true);
    const q = query(collection(db, 'crmActivities'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ ...d.data(), id: d.id } as CRMActivity));
      setActivities(sortByCreatedAtDesc(list));
      setLa(false);
    }, (err) => { console.error('[CRM] activities snapshot error:', err); setLa(false); });
    return () => unsub();
  }, [business?.id]);

  const isLoading = lc || ld || la;
  const ROTTING_DAYS = 7;
  const pipelineMetrics = useMemo(() => {
    const tv = deals.reduce((s, d) => s + d.value, 0);
    const wv = deals.reduce((s, d) => s + d.value * (d.probability / 100), 0);
    const wd = deals.filter((d) => d.stage === 'fechamento' || d.closedDate);
    const wdv = wd.reduce((s, d) => s + d.value, 0);
    const rottingCutoff = Date.now() - ROTTING_DAYS * 86_400_000;
    const rottingCount = deals.filter(d => !d.closedDate && new Date(d.updatedAt).getTime() < rottingCutoff).length;
    return {
      totalValue: tv, weightedValue: wv,
      avgDealSize: wd.length > 0 ? wdv / wd.length : 0,
      activeDeals: deals.length,
      conversionRate: deals.length > 0 ? (wd.length / deals.length) * 100 : 0,
      wonValue: wdv, wonDeals: wd.length, rottingCount,
    };
  }, [deals]);

  // Dialog states
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null);
  // Modal pra criar tarefa Kanban a partir do detalhe do contato. Substitui
  // o caso de uso "atividade tipo tarefa" — Activities CRM ficam só pra
  // log de interações; tarefas com prazo+responsáveis vivem no Kanban.
  const [kanbanTaskContact, setKanbanTaskContact] = useState<CRMContact | null>(null);
  const [deleteContactConfirm, setDeleteContactConfirm] = useState<CRMContact | null>(null);
  const [dealDialogOpen, setDealDialogOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<CRMDeal | null>(null);
  const [deleteDealConfirm, setDeleteDealConfirm] = useState<CRMDeal | null>(null);
  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState<CRMActivity | null>(null);
  const [deleteActivityConfirm, setDeleteActivityConfirm] = useState<CRMActivity | null>(null);

  // CRUD handlers with hardened error logging
  const handleSaveContact = useCallback(async (data: Partial<CRMContact>) => {
    if (!business?.id || !user) return;
    const now = new Date().toISOString();
    try {
      if (editingContact) {
        // Update: undefined → deleteField() pra limpar campos apagados pelo
        // operador. Sem isso, trocar tipo PJ→PF deixava nomeFantasia/IE
        // órfãos no doc (campos invisíveis na UI mas presentes no Firestore).
        // Mesmo padrão de ClientsModule.tsx:1074-1077.
        const updatePayload = Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, v === undefined ? deleteField() : v]),
        );
        await updateDoc(doc(db, 'clients', editingContact.id), { ...updatePayload, updatedAt: now });
        toast.success(t('crm.toast.contactUpdated', 'Contato atualizado!'));
        void logAudit({ businessId: business.id, userId: user.uid, userName: user.name, action: 'contact_updated', contactId: editingContact.id, details: `Dados editados` });
      } else {
        // Create: filtra undefined pra não gravar chaves vazias no doc novo.
        const createPayload = Object.fromEntries(
          Object.entries(data).filter(([, v]) => v !== undefined),
        );
        // tipo vem do form (default 'pf' no dialog). Antes era hardcoded — agora
        // CRM suporta PJ no funil, então o form decide.
        const ref = await addDoc(collection(db, 'clients'), { ...createPayload, businessId: business.id, tipo: (data.tipo ?? 'pf'), score: data.score ?? 0, status: data.status ?? 'novo', source: data.source ?? 'outro', createdAt: now, updatedAt: now });
        toast.success(t('crm.toast.contactCreated', 'Contato criado!'));
        void logAudit({ businessId: business.id, userId: user.uid, userName: user.name, action: 'contact_created', contactId: ref.id, details: data.name });
      }
      queryClient.invalidateQueries({ queryKey: ['clients', business.id] });
      setContactDialogOpen(false); setEditingContact(null);
    } catch (err) { console.error('[CRM] Error saving contact:', err); toast.error(t('crm.toast.errorSaveContact', 'Erro ao salvar contato')); }
  }, [business?.id, user, editingContact, queryClient, t]);

  const handleDeleteContact = useCallback(async () => {
    if (!deleteContactConfirm || !business?.id || !user) return;
    try {
      // Deals/Activities são CRM-internos e não têm referências em outros módulos —
      // hard delete OK pra eles. Mas o contato em `clients` é referenciado por
      // conversations, sales, transactions, appointments, kanbanCards. Hard delete
      // deixava órfãos; agora soft delete espelhando ClientsModule (linha ~1113).
      const dealsToDelete = deals.filter(d => d.contactId === deleteContactConfirm.id);
      for (const d of dealsToDelete) await deleteDoc(doc(db, 'crmDeals', d.id));
      const activitiesToDelete = activities.filter(a => a.contactId === deleteContactConfirm.id);
      for (const a of activitiesToDelete) await deleteDoc(doc(db, 'crmActivities', a.id));
      void logAudit({ businessId: business.id, userId: user.uid, userName: user.name, action: 'contact_deleted', contactId: deleteContactConfirm.id, details: deleteContactConfirm.name });
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'clients', deleteContactConfirm.id), {
        isActive: false,
        deletedAt: now,
        deletedBy: user.uid,
        deletedByName: user.name || '',
        updatedAt: now,
      });
      toast.success(t('crm.toast.contactDeleted', 'Contato excluído'));
      queryClient.invalidateQueries({ queryKey: ['clients', business.id] });
      queryClient.invalidateQueries({ queryKey: ['crmDeals', business.id] });
      queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] });
      setDeleteContactConfirm(null);
    } catch (err) { console.error('[CRM] Error deleting contact:', err); toast.error(t('crm.toast.errorDelete', 'Erro ao excluir')); }
  }, [deleteContactConfirm, business?.id, user, queryClient, t, deals, activities]);

  const handleSaveDeal = useCallback(async (data: Partial<CRMDeal>) => {
    if (!business?.id || !user) return; const now = new Date().toISOString();
    try {
      if (editingDeal) {
        await updateDoc(doc(db, 'crmDeals', editingDeal.id), { ...data, updatedAt: now });
        toast.success(t('crm.toast.dealUpdated', 'Deal atualizado!'));
        void logAudit({ businessId: business.id, userId: user.uid, userName: user.name, action: 'deal_updated', contactId: editingDeal.contactId, dealId: editingDeal.id, details: data.title ?? editingDeal.title });
      } else {
        const ref = await addDoc(collection(db, 'crmDeals'), { ...data, businessId: business.id, stage: data.stage ?? 'prospeccao', probability: data.probability ?? 10, value: data.value ?? 0, createdAt: now, updatedAt: now });
        toast.success(t('crm.toast.dealCreated', 'Deal criado!'));
        void logAudit({ businessId: business.id, userId: user.uid, userName: user.name, action: 'deal_created', contactId: data.contactId, dealId: ref.id, details: data.title });
      }
      queryClient.invalidateQueries({ queryKey: ['crmDeals', business.id] }); setDealDialogOpen(false); setEditingDeal(null);
    } catch (err) { console.error('[CRM] Error saving deal:', err); toast.error(t('crm.toast.errorSaveDeal', 'Erro ao salvar deal')); }
  }, [business?.id, user, editingDeal, queryClient, t]);

  const handleDeleteDeal = useCallback(async () => {
    if (!deleteDealConfirm || !business?.id || !user) return;
    try {
      void logAudit({ businessId: business.id, userId: user.uid, userName: user.name, action: 'deal_deleted', contactId: deleteDealConfirm.contactId, dealId: deleteDealConfirm.id, details: deleteDealConfirm.title });
      await deleteDoc(doc(db, 'crmDeals', deleteDealConfirm.id));
      toast.success(t('crm.toast.dealDeleted', 'Deal excluído')); queryClient.invalidateQueries({ queryKey: ['crmDeals', business.id] }); setDeleteDealConfirm(null);
    } catch (err) { console.error('[CRM] Error deleting deal:', err); toast.error(t('crm.toast.errorDelete', 'Erro ao excluir')); }
  }, [deleteDealConfirm, business?.id, user, queryClient, t]);

  const handleSaveActivity = useCallback(async (data: Partial<CRMActivity>) => { if (!business?.id || !user) return; const now = new Date().toISOString(); try { if (editingActivity) { await updateDoc(doc(db, 'crmActivities', editingActivity.id), { ...data, updatedAt: now }); toast.success(t('crm.toast.activityUpdated', 'Atividade atualizada!')); } else { await addDoc(collection(db, 'crmActivities'), { ...data, businessId: business.id, isCompleted: false, createdAt: now, updatedAt: now }); toast.success(t('crm.toast.activityCreated', 'Atividade registrada!')); } queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] }); setActivityDialogOpen(false); setEditingActivity(null); } catch (err) { console.error('[CRM] Error saving activity:', err); toast.error(t('crm.toast.errorSaveActivity', 'Erro ao salvar atividade')); } }, [business?.id, user, editingActivity, queryClient]);

  const handleToggleActivity = useCallback(async (a: CRMActivity) => { if (!business?.id) return; try { await updateDoc(doc(db, 'crmActivities', a.id), { isCompleted: !a.isCompleted, completedAt: !a.isCompleted ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }); queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] }); } catch (err) { console.error('[CRM] Error toggling activity:', err); toast.error(t('crm.toast.errorUpdate', 'Erro ao atualizar')); } }, [business?.id, queryClient]);

  const handleDeleteActivity = useCallback(async () => { if (!deleteActivityConfirm || !business?.id) return; try { await deleteDoc(doc(db, 'crmActivities', deleteActivityConfirm.id)); toast.success(t('crm.toast.activityDeleted', 'Atividade excluída')); queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] }); setDeleteActivityConfirm(null); } catch (err) { console.error('[CRM] Error deleting activity:', err); toast.error(t('crm.toast.errorDelete', 'Erro ao excluir')); } }, [deleteActivityConfirm, business?.id, queryClient]);

  const handleStatusChange = useCallback(async (contactId: string, newStatus: LeadStatus) => {
    if (!business?.id || !user) return;
    // Optimistic update direto no useState — antes era via queryClient.setQueryData
    // mas após refactor pra onSnapshot (contacts deixou de ter useQuery cache),
    // setQueryData virou no-op. Mexer no useState local mantém o efeito de drag&drop
    // instantâneo; o snapshot subsequente reconcilia com o servidor.
    const prevContact = contacts.find(c => c.id === contactId);
    setContacts((old) => old.map((c) => c.id === contactId ? { ...c, status: newStatus } : c));
    try {
      await updateDoc(doc(db, 'clients', contactId), { status: newStatus, updatedAt: new Date().toISOString() });
      if (prevContact) {
        void logAudit({ businessId: business.id, userId: user.uid, userName: user.name, action: 'status_changed', contactId, details: `${getStageLabel(stages, prevContact.status)} → ${getStageLabel(stages, newStatus)}` });
      }
    } catch (err) {
      console.error('[CRM] Error changing lead status:', err);
      toast.error(t('crm.toast.errorMoveLead', 'Erro ao mover lead'));
      // Revert: snapshot vai trazer estado correto do Firestore — não precisa
      // restaurar manualmente. Em <1s o card volta pro lugar.
    }
  }, [business?.id, user, contacts, t, stages]);

  const handleTagsChange = useCallback(async (contactId: string, tags: string[]) => {
    if (!business?.id || !user) return;
    try {
      await updateDoc(doc(db, 'clients', contactId), { tags, updatedAt: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: ['clients', business.id] });
      void logAudit({ businessId: business.id, userId: user.uid, userName: user.name, action: 'tags_changed', contactId, details: tags.join(', ') || '(sem tags)' });
    } catch (err) { console.error('[CRM] Error updating tags:', err); toast.error(t('crm.toast.errorUpdateTags', 'Erro ao atualizar tags')); }
  }, [business?.id, user, queryClient, t]);

  // Quick stats for header
  const hotLeads = contacts.filter((c) => c.scores?.churnRisk && c.scores.churnRisk >= 60).length;
  const activeDealsCount = deals.filter((d) => d.stage !== 'fechamento').length;

  if (isLoading) return <CRMSkeleton />;

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ═══════════════════════════════════════════════════════════
          HEADER — clean, no icon, integrated stats
          ═══════════════════════════════════════════════════════════ */}
      <div className="shrink-0 px-5 sm:px-6 lg:px-8 pt-5 sm:pt-6 lg:pt-7 pb-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
          {/* Title + quick stats */}
          <div className="flex items-center gap-5">
            <h1 className="text-3xl font-display font-bold text-gray-900 dark:text-gray-100 tracking-tight">CRM</h1>
            <div className="hidden sm:flex items-center gap-4 pl-5 border-l border-gray-200 dark:border-gray-700/50">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="font-semibold text-gray-800 dark:text-gray-200">{contacts.length}</span>
                <span className="text-gray-400">{t('crm.header.contacts', 'contatos')}</span>
              </div>
              {activeDealsCount > 0 && (
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-semibold text-blue-600 dark:text-blue-400">{activeDealsCount}</span>
                  <span className="text-gray-400">{t('crm.header.activeDeals', 'deals ativos')}</span>
                </div>
              )}
              {hotLeads > 0 && (
                <div className="flex items-center gap-1.5 text-sm">
                  <AlertTriangle size={14} className="text-orange-500" />
                  <span className="font-semibold text-orange-600 dark:text-orange-400">{hotLeads}</span>
                  <span className="text-gray-400">{t('crm.header.atRisk', 'em risco')}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2.5">
            {/* Search — only on pipeline tab */}
            {activeTab === 'kanban' && (
              <div className="relative hidden sm:block">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder={t('crm.action.search', 'Buscar...')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 py-2.5 w-52 bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700/50 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 focus:bg-white dark:focus:bg-white/[0.06] transition-all" />
              </div>
            )}

            {/* Filter — only on pipeline */}
            {activeTab === 'kanban' && (
              <>
                <Tooltip title={t('crm.action.filterByTags', 'Filtrar por tags')} arrow>
                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }}
                    onClick={() => setShowTagFilter(!showTagFilter)}
                    className={cn('inline-flex items-center gap-1.5 px-3 py-2.5 border rounded-xl text-sm font-medium transition-all',
                      showTagFilter || filterTags.length > 0
                        ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400'
                        : 'bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400')}>
                    <Filter size={15} />
                    {filterTags.length > 0 && <span className="text-xs bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center leading-none">{filterTags.length}</span>}
                  </motion.button>
                </Tooltip>
                <FormControl size="small" sx={{ minWidth: 110 }} className="hidden sm:block">
                  <Select value={filterSource} onChange={(e) => setFilterSource(e.target.value as typeof filterSource)}
                    displayEmpty sx={{ borderRadius: '12px', fontSize: '0.875rem', height: 42, bgcolor: isDark ? 'rgba(255,255,255,0.04)' : '#F9FAFB' }}>
                    <MenuItem value="all"><span className="text-gray-400">{t('crm.filter.source', 'Origem')}</span></MenuItem>
                    {ALL_SOURCES.map((s) => <MenuItem key={s} value={s}>{t('crm.source.' + s, SOURCE_LABELS[s])}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 100 }} className="hidden sm:block">
                  <Select value={filterTipo} onChange={(e) => setFilterTipo(e.target.value as typeof filterTipo)}
                    displayEmpty sx={{ borderRadius: '12px', fontSize: '0.875rem', height: 42, bgcolor: isDark ? 'rgba(255,255,255,0.04)' : '#F9FAFB' }}>
                    <MenuItem value="all"><span className="text-gray-400">Tipo</span></MenuItem>
                    <MenuItem value="pf">Pessoa Física</MenuItem>
                    <MenuItem value="pj">Pessoa Jurídica</MenuItem>
                  </Select>
                </FormControl>
              </>
            )}

            {/* Pipeline view toggle — only on kanban tab */}
            {activeTab === 'kanban' && (
              <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-white/[0.06] rounded-xl">
                <button
                  onClick={() => handlePipelineView('kanban')}
                  title="Visão Kanban"
                  className={cn('p-1.5 rounded-[10px] transition-all',
                    pipelineView === 'kanban'
                      ? 'bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                  )}>
                  <LayoutDashboard size={15} />
                </button>
                <button
                  onClick={() => handlePipelineView('table')}
                  title="Visão Lista"
                  className={cn('p-1.5 rounded-[10px] transition-all',
                    pipelineView === 'table'
                      ? 'bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                  )}>
                  <LayoutList size={15} />
                </button>
              </div>
            )}

            {/* CSV Import/Export dropdown */}
            <div className="relative" ref={csvMenuRef}>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }}
                onClick={() => setCsvMenuOpen(v => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 rounded-xl text-sm font-medium hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
                <Download size={14} />
                <Upload size={14} />
              </motion.button>
              <AnimatePresence>
                {csvMenuOpen && (
                  <motion.div initial={{ opacity: 0, y: 4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.97 }} transition={{ duration: 0.1 }}
                    className="absolute right-0 top-full mt-1.5 w-44 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 overflow-hidden">
                    <button onClick={() => { setCsvMenuOpen(false); setShowExportModal(true); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
                      <Download size={15} className="text-emerald-500" /> Exportar CSV
                    </button>
                    <button onClick={() => { setCsvMenuOpen(false); setShowImportModal(true); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
                      <Upload size={15} className="text-blue-500" /> Importar CSV
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }}
              onClick={() => { setEditingContact(null); setContactDialogOpen(true); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-white/[0.06] border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold text-sm hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
              <UserPlus size={16} /> Contato
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.95 }}
              onClick={() => { setEditingDeal(null); setDealDialogOpen(true); }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl font-semibold text-sm shadow-sm shadow-red-500/20 dark:shadow-red-900/30">
              <Plus size={17} /> Novo Deal
            </motion.button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            NAVIGATION — underline tabs, clean and minimal
            ═══════════════════════════════════════════════════════════ */}
        <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700/50 -mx-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap rounded-t-lg',
                  isActive
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300',
                )}>
                <span className={cn(isActive ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-500')}>{tab.icon}</span>
                {tab.label}
                {isActive && (
                  <motion.div layoutId="crm-tab-underline"
                    className="absolute bottom-0 left-2 right-2 h-[2px] bg-red-500 dark:bg-red-400 rounded-full"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
                )}
              </button>
            );
          })}
          {/* Pipeline settings gear — only on kanban tab, admin only */}
          {activeTab === 'kanban' && isAdmin && (
            <button
              onClick={() => setShowPipelineSettings(true)}
              className="ml-auto mr-1 p-2 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Configurar estágios do pipeline"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TAG FILTER BAR — collapsible. Só faz sentido na aba Pipeline
          (filterTags é consumido só pela KanbanBoard/lista). State
          showTagFilter persiste — bar reaparece quando volta pra kanban.
          ═══════════════════════════════════════════════════════════ */}
      <AnimatePresence>{showTagFilter && activeTab === 'kanban' && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden shrink-0 px-5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5 flex-wrap py-3 mt-2">
            <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mr-1">Tags:</span>
            {ALL_PRESET_TAGS.map((tag) => {
              const cfg = getTagConfig(tag);
              const isActiveTag = filterTags.includes(tag);
              return (
                <button key={tag} onClick={() => setFilterTags(isActiveTag ? filterTags.filter((t) => t !== tag) : [...filterTags, tag])}
                  className={cn('flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-all',
                    isActiveTag ? cn(cfg.bg, cfg.text, 'border-current/20') : 'bg-transparent border-gray-200 dark:border-gray-700 text-gray-400')}>
                  <span className={cn('w-2 h-2 rounded-full', isActiveTag ? cfg.dot : 'bg-gray-400')} />
                  {cfg.label}
                </button>
              );
            })}
            {filterTags.length > 0 && <button onClick={() => setFilterTags([])} className="text-xs font-semibold text-gray-400 hover:text-red-500 ml-1">{t('crm.action.clear', 'Limpar')}</button>}
          </div>
        </motion.div>
      )}</AnimatePresence>

      {/* ═══════════════════════════════════════════════════════════
          CONTENT — full remaining height
          ═══════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-5 sm:px-6 lg:px-8 pt-4 pb-5">
        <AnimatePresence mode="wait">
          <motion.div key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18 }}
            className="flex-1 flex flex-col min-h-0 h-full">

            {activeTab === 'kanban' && pipelineView === 'kanban' && (
              <KanbanBoard contacts={contacts}
                stages={stages}
                onSelectContact={(c) => { setSelectedContact(c); setDetailOpen(true); }}
                selectedContactId={selectedContact?.id || null}
                onStatusChange={handleStatusChange}
                onNewContact={() => { setEditingContact(null); setContactDialogOpen(true); }}
                searchQuery={searchQuery} filterTags={filterTags} filterSource={filterSource} filterTipo={filterTipo} />
            )}

            {activeTab === 'kanban' && pipelineView === 'table' && (
              <LeadTableView
                contacts={contacts}
                stages={stages}
                searchQuery={searchQuery}
                filterTags={filterTags}
                filterSource={filterSource}
                filterTipo={filterTipo}
                onSelectContact={(c) => { setSelectedContact(c); setDetailOpen(true); }}
                selectedContactId={selectedContact?.id || null}
              />
            )}

            {activeTab === 'campanhas' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <CampaignsTab businessId={business?.id || ''} />
              </div>
            )}

            {activeTab === 'segmentos' && (
              <div className="flex-1 overflow-y-auto min-h-0 p-1">
                <SegmentsTab
                  contacts={contacts}
                  businessId={business?.id || ''}
                  userId={user?.uid || ''}
                  userName={user?.name || ''}
                />
              </div>
            )}

            {activeTab === 'metricas' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <MetricsTab deals={deals} contacts={contacts} activities={activities}
                  stages={PIPELINE_STAGES} isDark={isDark} metrics={pipelineMetrics}
                  wonStatusId={getWonStageId(stages)} />
              </div>
            )}
            {activeTab === 'automacoes' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <AutomacoesTab businessId={business?.id || ''} userId={user?.uid || ''} userName={user?.name || ''} isDark={isDark} />
              </div>
            )}
            {activeTab === 'sequencias' && (
              <div className="flex-1 overflow-y-auto min-h-0 p-1">
                <SequenciasTab businessId={business?.id || ''} userId={user?.uid || ''} userName={user?.name || ''} contacts={contacts} />
              </div>
            )}
            {activeTab === 'formularios' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <FormulariosTab businessId={business?.id || ''} userId={user?.uid || ''} userName={user?.name || ''} isDark={isDark} />
              </div>
            )}
            {activeTab === 'planos' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <MembershipsTab businessId={business?.id || ''} userId={user?.uid || ''} isDark={isDark} gatewayConfigured={!!business?.settings?.paymentGateway?.isActive} />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          OVERLAYS & DIALOGS
          ═══════════════════════════════════════════════════════════ */}

      {/* CSV Export/Import modals */}
      {showExportModal && <CRMExportModal contacts={contacts} stages={stages} onClose={() => setShowExportModal(false)} />}
      {showImportModal && <CRMImportModal businessId={business?.id ?? ''} onClose={() => setShowImportModal(false)} onImported={() => queryClient.invalidateQueries({ queryKey: ['clients', business?.id] })} />}

      {/* Pipeline settings modal */}
      <AnimatePresence>
        {showPipelineSettings && (
          <PipelineSettingsModal
            current={pipelineConfig}
            businessId={business!.id}
            onClose={() => setShowPipelineSettings(false)}
            onSaved={cfg => setPipelineConfig(cfg)}
          />
        )}
      </AnimatePresence>

      {/* Lead Detail Panel */}
      <AnimatePresence>
        {detailOpen && selectedContact && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm z-30" onClick={() => setDetailOpen(false)} />
            <LeadDetailPanel contact={selectedContact} activities={activities}
              stages={stages}
              onClose={() => setDetailOpen(false)}
              onEdit={() => { setEditingContact(selectedContact); setContactDialogOpen(true); setDetailOpen(false); }}
              onDelete={() => { setDeleteContactConfirm(selectedContact); setDetailOpen(false); }}
              onTagsChange={(tags) => handleTagsChange(selectedContact.id, tags)}
              onSchedule={() => { setScheduleContact(selectedContact); setScheduleDialogOpen(true); }}
              onOpenConversations={() => { setDetailOpen(false); setActivePage('Conversas'); }}
              onCreateKanbanTask={() => setKanbanTaskContact(selectedContact)}
              onLogActivity={() => { setEditingActivity(null); setActivityDialogOpen(true); }} />
          </>
        )}
      </AnimatePresence>

      {/* Schedule Dialog */}
      {scheduleContact && (
        <ScheduleActionDialog open={scheduleDialogOpen}
          onClose={() => { setScheduleDialogOpen(false); setScheduleContact(null); }}
          contact={scheduleContact} businessId={business?.id || ''} userId={user?.uid || ''} userName={user?.name || ''}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['crmActivities', business?.id] })} />
      )}

      {/* Form Dialogs */}
      <ContactFormDialog open={contactDialogOpen} onClose={() => { setContactDialogOpen(false); setEditingContact(null); }} onSave={handleSaveContact} contact={editingContact} members={members} stages={stages} />
      {kanbanTaskContact && business?.id && user && (
        <CreateKanbanTaskDialog
          open={!!kanbanTaskContact}
          onClose={() => setKanbanTaskContact(null)}
          contact={kanbanTaskContact}
          businessId={business.id}
          user={{ uid: user.uid, name: user.name }}
          onCreated={() => { setKanbanTaskContact(null); setActivePage('Kanban'); }}
        />
      )}
      <DealFormDialog open={dealDialogOpen} onClose={() => { setDealDialogOpen(false); setEditingDeal(null); }} onSave={handleSaveDeal} deal={editingDeal} contacts={contacts} members={members} />
      {/* Pré-popula contactId quando o dialog é aberto via botão "Logar" do
          LeadDetailPanel — operador não precisa selecionar o contato de novo. */}
      <ActivityFormDialog
        open={activityDialogOpen}
        onClose={() => { setActivityDialogOpen(false); setEditingActivity(null); }}
        onSave={handleSaveActivity}
        activity={editingActivity}
        contacts={contacts} deals={deals} members={members}
        defaultContactId={detailOpen && selectedContact ? selectedContact.id : undefined}
      />

      {/* Delete Confirmations */}
      <DeleteConfirmDialog open={!!deleteContactConfirm} title="Excluir Contato" message={`Excluir "${deleteContactConfirm?.name}"?`} onClose={() => setDeleteContactConfirm(null)} onConfirm={handleDeleteContact} />
      <DeleteConfirmDialog open={!!deleteDealConfirm} title="Excluir Deal" message={`Excluir "${deleteDealConfirm?.title}"?`} onClose={() => setDeleteDealConfirm(null)} onConfirm={handleDeleteDeal} />
      <DeleteConfirmDialog open={!!deleteActivityConfirm} title="Excluir Atividade" message={`Excluir "${deleteActivityConfirm?.title}"?`} onClose={() => setDeleteActivityConfirm(null)} onConfirm={handleDeleteActivity} />
    </div>
  );
}
