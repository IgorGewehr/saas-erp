'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, IconButton, Chip, Select, MenuItem, FormControl, InputLabel, Tooltip, Slider,
} from '@mui/material';
import {
  Plus, Search, X, Phone, Mail, MessageSquare, Calendar, Clock, Edit3, Trash2,
  Users, DollarSign, TrendingUp, MoreVertical, Globe, Instagram, Facebook, Linkedin, Send,
  CheckCircle2, PhoneCall, Video, FileText, MessageCircle, BarChart3, Activity, Layers, Gauge,
  UserPlus, Briefcase, Tag, Hash, AlertTriangle, Heart, Shield, Zap, Brain,
  Sparkles, Filter, Crown, Settings2, GripVertical, Eye, EyeOff, ChevronUp, ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime, getInitials } from '@/lib/utils/format';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { db } from '@/lib/config/firebase';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CRMContact, CRMDeal, CRMPipelineStage, CRMStageConfig, CRMPipelineConfig, CRMActivity, CRMActivityType,
  LeadStatus, LeadSource, User, Broadcast, BroadcastStatus, ContactProfile,
} from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';

// ── Extracted sub-components ────────────────────────────────────────────────
import {
  PIPELINE_STAGES, SOURCE_LABELS, SOURCE_COLORS, STATUS_LABELS, STATUS_COLORS,
  ACTIVITY_LABELS, ACTIVITY_COLORS, ALL_SOURCES, ALL_STATUSES, ALL_ACTIVITY_TYPES,
  BROADCAST_STATUS_LABELS, ALL_PRESET_TAGS, getTagConfig, relativeTime,
  applyPhoneMask, stripPhoneMask, parseCurrencyInput, formatCurrencyInput,
  PROFILE_CONFIG, getScoreColor, getChurnLabel,
  DEFAULT_CRM_PIPELINE, getVisibleStages, getStageLabel,
  type CRMTab,
} from './shared';
import { KanbanBoard } from './KanbanBoard';
import { LeadDetailPanel } from './LeadDetailPanel';
import { ScheduleActionDialog } from './ScheduleActionDialog';
import AutomacoesTab from './AutomacoesTab';
import FormulariosTab from './FormulariosTab';
import MembershipsTab from './MembershipsTab';
import { SourceIcon } from './SourceIcon';

// ── Tab Config ──────────────────────────────────────────────────────────────



// ── Activity Icons (JSX — can't live in shared.ts) ─────────────────────────

const ACTIVITY_ICONS: Record<CRMActivityType, React.ReactNode> = {
  ligacao: <PhoneCall size={14} />, email: <Mail size={14} />, reuniao: <Video size={14} />,
  whatsapp: <MessageCircle size={14} />, tarefa: <CheckCircle2 size={14} />,
  nota: <FileText size={14} />, proposta: <Send size={14} />,
};

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
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [source, setSource] = useState<LeadSource>('outro');
  const [status, setStatus] = useState<LeadStatus>('novo');
  const [score, setScore] = useState(0);
  const [assignedTo, setAssignedTo] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [preferredChannel, setPreferredChannel] = useState<string>('');
  const [profile, setProfile] = useState<string>('');
  const [suggestedAction, setSuggestedAction] = useState('');
  const [aiSummary, setAiSummary] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? ''); setEmail(contact?.email ?? '');
      setPhone(contact?.phone ? applyPhoneMask(contact.phone) : '');
      setWhatsapp(contact?.whatsapp ? applyPhoneMask(contact.whatsapp) : '');
      setCompany(contact?.company ?? ''); setRole(contact?.role ?? '');
      setSource(contact?.source ?? 'outro'); setStatus(contact?.status ?? 'novo');
      setScore(contact?.score ?? 0); setAssignedTo(contact?.assignedTo ?? '');
      setTags(contact?.tags?.join(', ') ?? ''); setNotes(contact?.notes ?? '');
      setPreferredChannel(contact?.preferredChannel ?? '');
      setProfile(contact?.profile ?? '');
      setSuggestedAction(contact?.suggestedAction ?? '');
      setAiSummary(contact?.aiSummary ?? '');
      setShowAdvanced(!!(contact?.profile || contact?.suggestedAction || contact?.aiSummary || contact?.preferredChannel));
    }
  }, [open, contact]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const member = members.find((m) => m.id === assignedTo);
      const tagsList = tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      await onSave({
        name: name.trim(), email: email.trim() || undefined, phone: stripPhoneMask(phone) || undefined,
        whatsapp: stripPhoneMask(whatsapp) || undefined, company: company.trim() || undefined, role: role.trim() || undefined,
        source, status, score, assignedTo: assignedTo || undefined, assignedToName: member?.name || undefined,
        tags: tagsList.length > 0 ? tagsList : undefined, notes: notes.trim() || undefined,
        preferredChannel: (preferredChannel as CRMContact['preferredChannel']) || undefined,
        profile: (profile as CRMContact['profile']) || undefined,
        suggestedAction: suggestedAction.trim() || undefined,
        aiSummary: aiSummary.trim() || undefined,
      });
    } finally { setSaving(false); }
  };

  const inputSx = { '& .MuiOutlinedInput-root': { borderRadius: '10px' } };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center"><UserPlus size={18} className="text-white" /></div>
            <span className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{contact ? t('crm.dialog.editContact', 'Editar Contato') : t('crm.dialog.newContact', 'Novo Contato')}</span>
          </div>
          <IconButton onClick={onClose} size="small"><X size={18} /></IconButton>
        </div>
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <div className="space-y-4">
          {/* ── Dados Base ──────────────────────────── */}
          <TextField label={t('crm.form.nameReq', 'Nome *')} value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" sx={inputSx} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('crm.form.email', 'E-mail')} value={email} onChange={(e) => setEmail(e.target.value)} fullWidth size="small" type="email" sx={inputSx} />
            <TextField label={t('crm.form.phone', 'Telefone')} value={phone} onChange={(e) => setPhone(applyPhoneMask(e.target.value))} fullWidth size="small" sx={inputSx} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="WhatsApp" value={whatsapp} onChange={(e) => setWhatsapp(applyPhoneMask(e.target.value))} fullWidth size="small" sx={inputSx} />
            <TextField label={t('crm.form.company', 'Empresa')} value={company} onChange={(e) => setCompany(e.target.value)} fullWidth size="small" sx={inputSx} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('crm.form.role', 'Cargo')} value={role} onChange={(e) => setRole(e.target.value)} fullWidth size="small" sx={inputSx} />
            <FormControl size="small" fullWidth><InputLabel>{t('crm.filter.source', 'Origem')}</InputLabel><Select value={source} onChange={(e) => setSource(e.target.value as LeadSource)} label={t('crm.form.source', 'Origem')} sx={{ borderRadius: '10px' }}>{ALL_SOURCES.map((s) => <MenuItem key={s} value={s}>{t('crm.source.' + s, SOURCE_LABELS[s])}</MenuItem>)}</Select></FormControl>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormControl size="small" fullWidth><InputLabel>{t('crm.form.status', 'Status')}</InputLabel><Select value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)} label={t('crm.form.status', 'Status')} sx={{ borderRadius: '10px' }}>{stages.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}</Select></FormControl>
            <FormControl size="small" fullWidth><InputLabel>{t('crm.form.assignedTo', 'Responsável')}</InputLabel><Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} label={t('crm.form.assignedTo', 'Responsável')} sx={{ borderRadius: '10px' }}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem>{members.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}</Select></FormControl>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormControl size="small" fullWidth><InputLabel>{t('crm.form.preferredChannel', 'Canal Preferido')}</InputLabel><Select value={preferredChannel} onChange={(e) => setPreferredChannel(e.target.value)} label={t('crm.form.preferredChannel', 'Canal Preferido')} sx={{ borderRadius: '10px' }}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem><MenuItem value="whatsapp">WhatsApp</MenuItem><MenuItem value="facebook">Messenger</MenuItem><MenuItem value="instagram">Instagram</MenuItem></Select></FormControl>
            <FormControl size="small" fullWidth><InputLabel>{t('crm.form.profile', 'Perfil')}</InputLabel><Select value={profile} onChange={(e) => setProfile(e.target.value)} label={t('crm.form.profile', 'Perfil')} sx={{ borderRadius: '10px' }}><MenuItem value="">{t('crm.form.auto', 'Auto')}</MenuItem><MenuItem value="vip">👑 VIP</MenuItem><MenuItem value="regular">● {t('crm.profile.regular', 'Regular')}</MenuItem><MenuItem value="sporadic">◌ {t('crm.profile.sporadic', 'Esporádico')}</MenuItem><MenuItem value="new">✦ {t('crm.profile.new', 'Novo')}</MenuItem><MenuItem value="at_risk">⚠ {t('crm.profile.risk', 'Em Risco')}</MenuItem><MenuItem value="churned">✕ {t('crm.profile.churn', 'Perdido')}</MenuItem></Select></FormControl>
          </div>
          <div><p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Score: {score}</p><Slider value={score} onChange={(_, v) => setScore(v as number)} min={0} max={100} step={5} sx={{ color: score >= 80 ? '#10B981' : score >= 50 ? '#F59E0B' : '#94A3B8' }} /></div>
          <TextField label="Tags (separadas por vírgula)" value={tags} onChange={(e) => setTags(e.target.value)} fullWidth size="small" placeholder="quente, tem interesse" sx={inputSx} />
          <TextField label={t('crm.form.notes', 'Observações')} value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth size="small" multiline rows={2} sx={inputSx} />

          {/* ── Inteligência (toggle) ──────────────── */}
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors">
            <Zap size={13} />
            {showAdvanced ? t('crm.action.hideIntelligence', 'Ocultar campos de inteligência ▲') : t('crm.action.showIntelligence', 'Campos de inteligência ▼')}
          </button>
          {showAdvanced && (
            <div className="space-y-3 p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.06]">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t('crm.form.aiData', 'Dados para Agente IA')}</p>
              <TextField label={t('crm.form.suggestedAction', 'Próxima ação sugerida')} value={suggestedAction} onChange={(e) => setSuggestedAction(e.target.value)} fullWidth size="small" placeholder={t('crm.form.suggestedActionPlaceholder', 'Ligar para reativar, oferecer desconto...')} sx={inputSx} />
              <TextField label={t('crm.form.aiSummary', 'Resumo IA')} value={aiSummary} onChange={(e) => setAiSummary(e.target.value)} fullWidth size="small" multiline rows={3}
                placeholder={t('crm.form.aiSummaryPlaceholder', 'Ex: Cliente há 8 meses, sempre agenda corte + barba, cancelou 2x nos últimos 3 meses, score de churn alto')} sx={inputSx} />
            </div>
          )}
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving} sx={{ borderRadius: '10px', textTransform: 'none' }}>{t('crm.action.cancel', 'Cancelar')}</Button>
        <Button onClick={handleSubmit} disabled={saving || !name.trim()} variant="contained" sx={{ borderRadius: '10px', textTransform: 'none', bgcolor: '#DC2626', '&:hover': { bgcolor: '#B91C1C' } }}>{saving ? t('crm.action.saving', 'Salvando...') : contact ? t('crm.action.save', 'Salvar') : t('crm.action.createContact', 'Criar Contato')}</Button>
      </DialogActions>
    </Dialog>
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}><div className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center"><Briefcase size={18} className="text-white" /></div><span className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{deal ? t('crm.dialog.editDeal', 'Editar Deal') : t('crm.dialog.newDeal', 'Novo Deal')}</span></div><IconButton onClick={onClose} size="small"><X size={18} /></IconButton></div></DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <div className="space-y-4">
          <TextField label={t('crm.form.titleReq', 'Título *')} value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <FormControl size="small" fullWidth><InputLabel>{t('crm.form.contactReq', 'Contato *')}</InputLabel><Select value={contactId} onChange={(e) => setContactId(e.target.value)} label={t('crm.form.contactReq', 'Contato *')} sx={{ borderRadius: '10px' }}>{contacts.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}{c.company ? ` - ${c.company}` : ''}</MenuItem>)}</Select></FormControl>
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('crm.form.value', 'Valor (R$)')} value={valueStr} onChange={(e) => setValueStr(e.target.value)} fullWidth size="small" placeholder="0,00" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
            <FormControl size="small" fullWidth><InputLabel>{t('crm.form.stage', 'Etapa')}</InputLabel><Select value={stage} onChange={(e) => handleStageChange(e.target.value)} label={t('crm.form.stage', 'Etapa')} sx={{ borderRadius: '10px' }}>{PIPELINE_STAGES.map((s) => (<MenuItem key={s.id} value={s.id}><div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />{t('crm.stage.' + s.id, s.name)}</div></MenuItem>))}</Select></FormControl>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">{t('crm.form.prob', 'Probabilidade: ')}{probability}%</p><Slider value={probability} onChange={(_, v) => setProbability(v as number)} min={0} max={100} step={5} sx={{ color: '#DC2626' }} /></div>
            <TextField label={t('crm.form.expectedCloseDate', 'Previsão de Fechamento')} value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} fullWidth size="small" type="date" InputLabelProps={{ shrink: true }} inputProps={{ min: new Date().toISOString().split('T')[0] }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          </div>
          <FormControl size="small" fullWidth><InputLabel>{t('crm.form.assignedTo', 'Responsável')}</InputLabel><Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} label={t('crm.form.assignedTo', 'Responsável')} sx={{ borderRadius: '10px' }}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem>{members.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}</Select></FormControl>
          <TextField label={t('crm.form.notes', 'Observações')} value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth size="small" multiline rows={3} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving} sx={{ borderRadius: '10px', textTransform: 'none' }}>{t('crm.action.cancel', 'Cancelar')}</Button>
        <Button onClick={handleSubmit} disabled={saving || !title.trim() || !contactId} variant="contained" sx={{ borderRadius: '10px', textTransform: 'none', bgcolor: '#DC2626', '&:hover': { bgcolor: '#B91C1C' } }}>{saving ? t('crm.action.saving', 'Salvando...') : deal ? t('crm.action.save', 'Salvar') : t('crm.action.createDeal', 'Criar Deal')}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ==========================================
// ACTIVITY FORM DIALOG
// ==========================================

function ActivityFormDialog({ open, onClose, onSave, activity, contacts, deals, members }: {
  open: boolean; onClose: () => void; onSave: (data: Partial<CRMActivity>) => Promise<void>; activity: CRMActivity | null; contacts: CRMContact[]; deals: CRMDeal[]; members: User[];
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<CRMActivityType>('tarefa'); const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [contactId, setContactId] = useState(''); const [dealId, setDealId] = useState(''); const [scheduledAt, setScheduledAt] = useState('');
  const [assignedTo, setAssignedTo] = useState(''); const [duration, setDuration] = useState(''); const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setType(activity?.type ?? 'tarefa'); setTitle(activity?.title ?? ''); setDescription(activity?.description ?? ''); setContactId(activity?.contactId ?? ''); setDealId(activity?.dealId ?? ''); setScheduledAt(activity?.scheduledAt ? activity.scheduledAt.slice(0, 16) : ''); setAssignedTo(activity?.assignedTo ?? ''); setDuration(activity?.duration ? String(activity.duration) : ''); }
  }, [open, activity]);

  const handleSubmit = async () => {
    if (!title.trim()) return; setSaving(true);
    try { const sc = contacts.find((c) => c.id === contactId); const sd = deals.find((d) => d.id === dealId); const member = members.find((m) => m.id === assignedTo); await onSave({ type, title: title.trim(), description: description.trim() || undefined, contactId: contactId || undefined, contactName: sc?.name || undefined, dealId: dealId || undefined, dealTitle: sd?.title || undefined, scheduledAt: scheduledAt || undefined, assignedTo: assignedTo || undefined, assignedToName: member?.name || undefined, duration: duration ? parseInt(duration, 10) : undefined, ...(activity ? {} : { isCompleted: false }) }); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ pb: 1 }}><div className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center"><Activity size={18} className="text-white" /></div><span className="text-base font-display font-bold text-gray-900 dark:text-gray-100">{activity ? t('crm.dialog.editActivity', 'Editar Atividade') : t('crm.dialog.newActivity', 'Nova Atividade')}</span></div><IconButton onClick={onClose} size="small"><X size={18} /></IconButton></div></DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <div className="space-y-4">
          <FormControl size="small" fullWidth><InputLabel>{t('crm.form.type', 'Tipo')}</InputLabel><Select value={type} onChange={(e) => setType(e.target.value as CRMActivityType)} label={t('crm.form.type', 'Tipo')} sx={{ borderRadius: '10px' }}>{ALL_ACTIVITY_TYPES.map((typeKey) => (<MenuItem key={typeKey} value={typeKey}><div className="flex items-center gap-2"><span style={{ color: ACTIVITY_COLORS[typeKey] }}>{ACTIVITY_ICONS[typeKey]}</span>{t('crm.activity.' + typeKey, ACTIVITY_LABELS[typeKey])}</div></MenuItem>))}</Select></FormControl>
          <TextField label={t('crm.form.titleReq', 'Título *')} value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <TextField label={t('crm.form.desc', 'Descrição')} value={description} onChange={(e) => setDescription(e.target.value)} fullWidth size="small" multiline rows={2} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          <div className="grid grid-cols-2 gap-3">
            <FormControl size="small" fullWidth><InputLabel>Contato</InputLabel><Select value={contactId} onChange={(e) => setContactId(e.target.value)} label="Contato" sx={{ borderRadius: '10px' }}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem>{contacts.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</Select></FormControl>
            <FormControl size="small" fullWidth><InputLabel>{t('crm.form.deal', 'Deal')}</InputLabel><Select value={dealId} onChange={(e) => setDealId(e.target.value)} label={t('crm.form.deal', 'Deal')} sx={{ borderRadius: '10px' }}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem>{deals.map((d) => <MenuItem key={d.id} value={d.id}>{d.title}</MenuItem>)}</Select></FormControl>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('crm.form.dateTime', 'Data/Hora')} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} fullWidth size="small" type="datetime-local" InputLabelProps={{ shrink: true }} sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
            <TextField label={t('crm.form.duration', 'Duração (min)')} value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} fullWidth size="small" sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }} />
          </div>
          <FormControl size="small" fullWidth><InputLabel>{t('crm.form.assignedTo', 'Responsável')}</InputLabel><Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} label={t('crm.form.assignedTo', 'Responsável')} sx={{ borderRadius: '10px' }}><MenuItem value="">{t('crm.form.none', 'Nenhum')}</MenuItem>{members.map((m) => <MenuItem key={m.id} value={m.id}>{m.name}</MenuItem>)}</Select></FormControl>
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={saving} sx={{ borderRadius: '10px', textTransform: 'none' }}>{t('crm.action.cancel', 'Cancelar')}</Button>
        <Button onClick={handleSubmit} disabled={saving || !title.trim()} variant="contained" sx={{ borderRadius: '10px', textTransform: 'none', bgcolor: '#DC2626', '&:hover': { bgcolor: '#B91C1C' } }}>{saving ? t('crm.action.saving', 'Salvando...') : activity ? t('crm.action.save', 'Salvar') : t('crm.action.createActivity', 'Criar Atividade')}</Button>
      </DialogActions>
    </Dialog>
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
// ACTIVITIES TAB (kept inline — tightly coupled to ACTIVITY_ICONS JSX)
// ==========================================

function ActivitiesTab({ activities, onEdit, onDelete, onToggle, onNew }: {
  activities: CRMActivity[]; onEdit: (a: CRMActivity) => void; onDelete: (a: CRMActivity) => void; onToggle: (a: CRMActivity) => void; onNew: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const sorted = useMemo(() => { let r = [...activities]; if (filter === 'pending') r = r.filter((a) => !a.isCompleted); if (filter === 'completed') r = r.filter((a) => a.isCompleted); return r.sort((a, b) => (b.completedAt || b.scheduledAt || b.createdAt).localeCompare(a.completedAt || a.scheduledAt || a.createdAt)); }, [activities, filter]);
  const pending = activities.filter((a) => !a.isCompleted);
  const completed = activities.filter((a) => a.isCompleted);
  const todayStr = new Date().toISOString().split('T')[0];
  const todayActs = activities.filter((a) => (a.scheduledAt || a.completedAt || '').startsWith(todayStr));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[{ label: t('crm.tab.pending', 'Pendentes'), value: pending.length, color: 'text-amber-600 dark:text-amber-400', delay: 0 }, { label: t('crm.tab.today', 'Hoje'), value: todayActs.length, color: 'text-red-600 dark:text-red-400', delay: 0.06 }, { label: t('crm.tab.completed', 'Concluídas'), value: completed.length, color: 'text-emerald-600 dark:text-emerald-400', delay: 0.12 }].map((k) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k.delay }} className="bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-2xl p-4">
            <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium mb-1">{k.label}</p>
            <p className={cn('text-xl font-display font-bold', k.color)}>{k.value}</p>
          </motion.div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-0.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl w-fit">
          {[{ key: 'all' as const, label: t('crm.tab.all', 'Todas') }, { key: 'pending' as const, label: t('crm.tab.pending', 'Pendentes') }, { key: 'completed' as const, label: t('crm.tab.completed', 'Concluídas') }].map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={cn('px-4 py-1.5 rounded-lg text-xs font-medium transition-all', filter === f.key ? 'bg-gray-900 dark:bg-gray-700 text-white' : 'text-gray-500 dark:text-gray-400')}>{f.label}</button>
          ))}
        </div>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onNew} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg"><Plus size={14} /> {t('crm.action.newActivity', 'Nova Atividade')}</motion.button>
      </div>
      <div className="space-y-3">
        {sorted.map((activity, i) => { const ac = ACTIVITY_COLORS[activity.type]; const ds = activity.completedAt || activity.scheduledAt || activity.createdAt; return (
          <motion.div key={activity.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className={cn('bg-white dark:bg-[#111827] border rounded-xl p-4 hover:shadow-md transition-all flex gap-4 group', activity.isCompleted ? 'border-gray-100 dark:border-gray-700/50' : 'border-l-4 border-gray-100 dark:border-gray-700/50')} style={!activity.isCompleted ? { borderLeftColor: ac } : undefined}>
            <button onClick={() => onToggle(activity)} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 hover:scale-110 transition-transform" style={{ backgroundColor: `${ac}15`, color: ac }}>{activity.isCompleted ? <CheckCircle2 size={14} /> : ACTIVITY_ICONS[activity.type]}</button>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2"><div><p className={cn('text-sm font-semibold', activity.isCompleted ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-200')}>{activity.title}</p>{activity.description && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{activity.description}</p>}</div><div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"><IconButton size="small" onClick={() => onEdit(activity)}><Edit3 size={13} className="text-gray-400" /></IconButton><IconButton size="small" onClick={() => onDelete(activity)}><Trash2 size={13} className="text-gray-400 hover:text-red-500" /></IconButton></div></div>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-gray-400 dark:text-gray-500"><span className="font-medium px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${ac}15`, color: ac }}>{t('crm.activity.' + activity.type, ACTIVITY_LABELS[activity.type])}</span>{activity.contactName && <span className="font-medium text-gray-500 dark:text-gray-400">{activity.contactName}</span>}{activity.dealTitle && <span>· {activity.dealTitle}</span>}<span>· {formatDateTime(ds)}</span>{activity.duration && <span>· {activity.duration}min</span>}{activity.assignedToName && <span>· {activity.assignedToName}</span>}</div>
            </div>
          </motion.div>
        ); })}
      </div>
      {sorted.length === 0 && activities.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500"><div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4"><Activity size={28} strokeWidth={1.5} /></div><p className="text-sm font-medium mb-1">{t('crm.tab.noActivity', 'Nenhuma atividade registrada')}</p><motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onNew} className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl font-semibold text-sm"><Plus size={16} /> {t('crm.action.newActivity', 'Nova Atividade')}</motion.button></div>
      )}
    </div>
  );
}

// ==========================================
// METRICS TAB — Intelligence Dashboard
// ==========================================

const ROTTING_DAYS_THRESHOLD = 7;

function MetricsTab({ deals, contacts, activities, stages, isDark, metrics }: {
  deals: CRMDeal[]; contacts: CRMContact[]; activities: CRMActivity[]; stages: CRMPipelineStage[]; isDark: boolean;
  metrics: { totalValue: number; weightedValue: number; avgDealSize: number; activeDeals: number; conversionRate: number; wonValue: number; wonDeals: number; rottingCount: number };
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
  const convRate = contacts.length > 0 ? ((contacts.filter((c) => c.status === 'ganho').length / contacts.length) * 100).toFixed(1) : '0';
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
              const cl = getChurnLabel(c.scores!.churnRisk);
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
                    {c.scores!.churnRisk}%
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
// CAMPAIGNS TAB (kept inline — self-contained with onSnapshot)
// ==========================================

function CampaignsTab({ businessId }: { businessId: string }) {
  const { t } = useTranslation();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [formName, setFormName] = useState('');
  const [formChannel, setFormChannel] = useState<'whatsapp' | 'facebook' | 'instagram'>('whatsapp');
  const [formAudienceType, setFormAudienceType] = useState<'all_contacts' | 'tags' | 'manual'>('all_contacts');
  const [formTags, setFormTags] = useState('');
  const [formMsgType, setFormMsgType] = useState<'template' | 'text'>('template');
  const [formTemplate, setFormTemplate] = useState('');
  const [formContent, setFormContent] = useState('');
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!businessId) return;
    const q = query(collection(db, 'broadcasts'), where('businessId', '==', businessId), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => { setBroadcasts(snap.docs.map(d => ({ ...d.data(), id: d.id } as Broadcast))); setLoading(false); }, (err) => { console.error('[CRM:Campaigns] Error fetching broadcasts:', err); setLoading(false); });
    return () => unsub();
  }, [businessId]);

  const handleCreate = async () => {
    if (!businessId || !user || !formName.trim()) return; setSaving(true);
    try { const now = new Date().toISOString(); await addDoc(collection(db, 'broadcasts'), { businessId, name: formName.trim(), channel: formChannel, audienceType: formAudienceType, audienceTags: formAudienceType === 'tags' ? formTags.split(',').map(t => t.trim()).filter(Boolean) : [], messageType: formMsgType, templateName: formMsgType === 'template' ? formTemplate.trim() : undefined, messageContent: formMsgType === 'text' ? formContent.trim() : undefined, status: 'draft' as BroadcastStatus, stats: { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 }, createdBy: user.uid, createdByName: user.name, createdAt: now, updatedAt: now }); toast.success(t('crm.toast.campaignCreated', 'Campanha criada')); setShowNew(false); setFormName(''); }
    catch (err) { console.error('[CRM:Campaigns] Error creating broadcast:', err); toast.error(t('crm.toast.errorCreateCampaign', 'Erro ao criar campanha')); } finally { setSaving(false); }
  };

  if (loading) return <div className="space-y-4">{[0, 1, 2].map(i => <div key={i} className="h-24 rounded-2xl shimmer" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><div><h3 className="text-base font-bold text-gray-900 dark:text-gray-100 font-display">{t('crm.campaign.title', 'Campanhas')}</h3><p className="text-xs text-gray-500 dark:text-gray-400">{broadcasts.length} {t('crm.campaign.campaignsSuffix', 'campanha{{s}}', { s: broadcasts.length !== 1 ? 's' : '' })}</p></div><button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-red-500 shadow-lg shadow-red-500/25"><Plus size={16} />{t('crm.action.newCampaign', 'Nova Campanha')}</button></div>
      {broadcasts.length === 0 ? <div className="text-center py-16 bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-700/50"><Send className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" /><p className="text-sm font-semibold text-gray-600 dark:text-gray-400">{t('crm.campaign.none', 'Nenhuma campanha')}</p></div>
      : <div className="space-y-3">{broadcasts.map((b) => { const sc = BROADCAST_STATUS_LABELS[b.status]; return <motion.div key={b.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-700/50 p-5 hover:shadow-md transition-shadow"><div className="flex items-center gap-2"><h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{b.name}</h4><span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', sc.bg, sc.color)}>{t('crm.broadcastStatus.' + b.status, sc.label)}</span></div><div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400"><span className="capitalize">{b.channel}</span><span>·</span><span>{formatDate(b.createdAt)}</span></div>{b.stats.total > 0 && <div className="mt-3 grid grid-cols-4 gap-3">{[{ l: t('crm.campaign.total', 'Total'), v: b.stats.total, c: '' }, { l: t('crm.campaign.sent', 'Enviadas'), v: b.stats.sent, c: 'text-emerald-600 dark:text-emerald-400' }, { l: t('crm.campaign.delivered', 'Entregues'), v: `${Math.round((b.stats.delivered / b.stats.total) * 100)}%`, c: 'text-blue-600 dark:text-blue-400' }, { l: t('crm.campaign.read', 'Lidas'), v: `${b.stats.delivered > 0 ? Math.round((b.stats.read / b.stats.delivered) * 100) : 0}%`, c: 'text-purple-600 dark:text-purple-400' }].map((s) => <div key={s.l}><p className="text-[10px] text-gray-400 uppercase tracking-wider">{s.l}</p><p className={cn('text-sm font-bold text-gray-900 dark:text-gray-100', s.c)}>{s.v}</p></div>)}</div>}</motion.div>; })}</div>}
      <Dialog open={showNew} onClose={() => setShowNew(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '1rem' } }}>
        <DialogTitle sx={{ fontWeight: 700, fontFamily: '"Plus Jakarta Sans", sans-serif' }}>{t('crm.dialog.newCampaign', 'Nova Campanha')}</DialogTitle>
        <DialogContent className="space-y-4 !pt-2">
          <TextField label={t('crm.form.name', 'Nome')} value={formName} onChange={(e) => setFormName(e.target.value)} fullWidth size="small" />
          <FormControl fullWidth size="small"><InputLabel>{t('crm.form.channel', 'Canal')}</InputLabel><Select value={formChannel} label={t('crm.form.channel', 'Canal')} onChange={(e) => setFormChannel(e.target.value as typeof formChannel)}><MenuItem value="whatsapp">WhatsApp</MenuItem><MenuItem value="facebook">Messenger</MenuItem><MenuItem value="instagram">Instagram</MenuItem></Select></FormControl>
          <FormControl fullWidth size="small"><InputLabel>{t('crm.form.audience', 'Audiência')}</InputLabel><Select value={formAudienceType} label={t('crm.form.audience', 'Audiência')} onChange={(e) => setFormAudienceType(e.target.value as typeof formAudienceType)}><MenuItem value="all_contacts">{t('crm.form.all', 'Todos')}</MenuItem><MenuItem value="tags">{t('crm.form.byTags', 'Por tags')}</MenuItem><MenuItem value="manual">{t('crm.form.manual', 'Manual')}</MenuItem></Select></FormControl>
          {formAudienceType === 'tags' && <TextField label={t('crm.form.tags', 'Tags')} value={formTags} onChange={(e) => setFormTags(e.target.value)} fullWidth size="small" />}
          <FormControl fullWidth size="small"><InputLabel>{t('crm.form.type', 'Tipo')}</InputLabel><Select value={formMsgType} label={t('crm.form.type', 'Tipo')} onChange={(e) => setFormMsgType(e.target.value as typeof formMsgType)}><MenuItem value="template">{t('crm.form.template', 'Template')}</MenuItem><MenuItem value="text">{t('crm.form.text', 'Texto')}</MenuItem></Select></FormControl>
          {formMsgType === 'template' ? <TextField label="Template" value={formTemplate} onChange={(e) => setFormTemplate(e.target.value)} fullWidth size="small" /> : <TextField label={t('crm.form.content', 'Conteúdo')} value={formContent} onChange={(e) => setFormContent(e.target.value)} fullWidth multiline rows={3} size="small" />}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={() => setShowNew(false)}>{t('crm.action.cancel', 'Cancelar')}</Button><Button onClick={handleCreate} variant="contained" disabled={saving || !formName.trim()} sx={{ bgcolor: '#DC2626', '&:hover': { bgcolor: '#B91C1C' }, borderRadius: '0.75rem' }}>{saving ? t('crm.action.creating', 'Criando...') : t('crm.action.create', 'Criar')}</Button></DialogActions>
      </Dialog>
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

export default function CRMModule() {
  const { t } = useTranslation();

  const TABS: { key: CRMTab; label: string; icon: React.ReactNode; desc: string }[] = useMemo(() => [
    { key: 'kanban', label: t('crm.tab.kanban', 'Pipeline'), icon: <Layers size={15} />, desc: t('crm.tab.kanban_desc', 'Kanban de leads') },
    { key: 'atividades', label: t('crm.tab.activities', 'Atividades'), icon: <Activity size={15} />, desc: t('crm.tab.activities_desc', 'Tarefas e follow-ups') },
    { key: 'campanhas', label: t('crm.tab.campaigns', 'Campanhas'), icon: <Send size={15} />, desc: t('crm.tab.campaigns_desc', 'Broadcasts') },
    { key: 'metricas', label: t('crm.tab.metrics', 'Inteligência'), icon: <Brain size={15} />, desc: t('crm.tab.metrics_desc', 'Scores e insights') },
    { key: 'automacoes', label: t('crm.tab.automations', 'Automações'), icon: <Zap size={15} />, desc: t('crm.tab.automations_desc', 'Regras automáticas') },
    { key: 'formularios', label: t('crm.tab.forms', 'Formulários'), icon: <FileText size={15} />, desc: t('crm.tab.forms_desc', 'Fichas de anamnese') },
    { key: 'planos', label: t('crm.tab.plans', 'Planos'), icon: <Crown size={15} />, desc: t('crm.tab.plans_desc', 'Assinaturas recorrentes') },
  ], [t]);
  const { isDark } = useTheme();
  const { user, business } = useAuth();
  const { setActivePage } = useAppContext();
  const queryClient = useQueryClient();

  const isAdmin = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];
  const [pipelineConfig, setPipelineConfig] = useState<CRMPipelineConfig | undefined>(business?.settings?.crmPipeline);
  const [showPipelineSettings, setShowPipelineSettings] = useState(false);

  // Effective visible stages — recomputed when config changes
  const stages = useMemo(() => getVisibleStages(pipelineConfig), [pipelineConfig]);

  const [activeTab, setActiveTab] = useState<CRMTab>('kanban');
  const [selectedContact, setSelectedContact] = useState<CRMContact | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterSource, setFilterSource] = useState<LeadSource | 'all'>('all');
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

  // Data fetching
  const { data: contacts = [], isLoading: lc } = useQuery({ queryKey: ['clients', business?.id], queryFn: async () => { const q = query(collection(db, 'clients'), where('businessId', '==', business!.id), orderBy('createdAt', 'desc')); const snap = await getDocs(q); return snap.docs.map((d) => { const data = d.data(); return { ...data, id: d.id, status: (data.status ?? 'novo') as CRMContact['status'], source: (data.source ?? 'outro') as CRMContact['source'], score: data.score ?? 0 } as CRMContact; }).filter((c) => c.tipo !== 'pj'); }, enabled: !!business?.id });
  const { data: deals = [], isLoading: ld } = useQuery({ queryKey: ['crmDeals', business?.id], queryFn: async () => { const q = query(collection(db, 'crmDeals'), where('businessId', '==', business!.id), orderBy('createdAt', 'desc')); const snap = await getDocs(q); return snap.docs.map((d) => ({ ...d.data(), id: d.id } as CRMDeal)); }, enabled: !!business?.id });
  const { data: activities = [], isLoading: la } = useQuery({ queryKey: ['crmActivities', business?.id], queryFn: async () => { const q = query(collection(db, 'crmActivities'), where('businessId', '==', business!.id), orderBy('createdAt', 'desc')); const snap = await getDocs(q); return snap.docs.map((d) => ({ ...d.data(), id: d.id } as CRMActivity)); }, enabled: !!business?.id });

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
    // Firestore rejects undefined values — strip them
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) { if (v !== undefined) clean[k] = v; }
    try {
      if (editingContact) {
        await updateDoc(doc(db, 'clients', editingContact.id), { ...clean, updatedAt: now });
        toast.success(t('crm.toast.contactUpdated', 'Contato atualizado!'));
      } else {
        await addDoc(collection(db, 'clients'), { ...clean, businessId: business.id, tipo: 'pf', score: data.score ?? 0, status: data.status ?? 'novo', source: data.source ?? 'outro', createdAt: now, updatedAt: now });
        toast.success(t('crm.toast.contactCreated', 'Contato criado!'));
      }
      queryClient.invalidateQueries({ queryKey: ['clients', business.id] });
      setContactDialogOpen(false); setEditingContact(null);
    } catch (err) { console.error('[CRM] Error saving contact:', err); toast.error(t('crm.toast.errorSaveContact', 'Erro ao salvar contato')); }
  }, [business?.id, user, editingContact, queryClient]);

  const handleDeleteContact = useCallback(async () => {
    if (!deleteContactConfirm || !business?.id) return;
    try {
      // Cascade: delete deals linked to this contact
      const dealsSnap = await getDocs(query(collection(db, 'crmDeals'), where('businessId', '==', business.id), where('contactId', '==', deleteContactConfirm.id)));
      for (const d of dealsSnap.docs) await deleteDoc(doc(db, 'crmDeals', d.id));
      // Cascade: delete activities linked to this contact
      const activitiesSnap = await getDocs(query(collection(db, 'crmActivities'), where('businessId', '==', business.id), where('contactId', '==', deleteContactConfirm.id)));
      for (const a of activitiesSnap.docs) await deleteDoc(doc(db, 'crmActivities', a.id));
      // Delete the contact itself
      await deleteDoc(doc(db, 'clients', deleteContactConfirm.id));
      toast.success(t('crm.toast.contactDeleted', 'Contato excluído'));
      queryClient.invalidateQueries({ queryKey: ['clients', business.id] });
      queryClient.invalidateQueries({ queryKey: ['crmDeals', business.id] });
      queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] });
      setDeleteContactConfirm(null);
    } catch (err) { console.error('[CRM] Error deleting contact:', err); toast.error(t('crm.toast.errorDelete', 'Erro ao excluir')); }
  }, [deleteContactConfirm, business?.id, queryClient]);

  const handleSaveDeal = useCallback(async (data: Partial<CRMDeal>) => { if (!business?.id || !user) return; const now = new Date().toISOString(); try { if (editingDeal) { await updateDoc(doc(db, 'crmDeals', editingDeal.id), { ...data, updatedAt: now }); toast.success(t('crm.toast.dealUpdated', 'Deal atualizado!')); } else { await addDoc(collection(db, 'crmDeals'), { ...data, businessId: business.id, stage: data.stage ?? 'prospeccao', probability: data.probability ?? 10, value: data.value ?? 0, createdAt: now, updatedAt: now }); toast.success(t('crm.toast.dealCreated', 'Deal criado!')); } queryClient.invalidateQueries({ queryKey: ['crmDeals', business.id] }); setDealDialogOpen(false); setEditingDeal(null); } catch (err) { console.error('[CRM] Error saving deal:', err); toast.error(t('crm.toast.errorSaveDeal', 'Erro ao salvar deal')); } }, [business?.id, user, editingDeal, queryClient]);

  const handleDeleteDeal = useCallback(async () => { if (!deleteDealConfirm || !business?.id) return; try { await deleteDoc(doc(db, 'crmDeals', deleteDealConfirm.id)); toast.success(t('crm.toast.dealDeleted', 'Deal excluído')); queryClient.invalidateQueries({ queryKey: ['crmDeals', business.id] }); setDeleteDealConfirm(null); } catch (err) { console.error('[CRM] Error deleting deal:', err); toast.error(t('crm.toast.errorDelete', 'Erro ao excluir')); } }, [deleteDealConfirm, business?.id, queryClient]);

  const handleSaveActivity = useCallback(async (data: Partial<CRMActivity>) => { if (!business?.id || !user) return; const now = new Date().toISOString(); try { if (editingActivity) { await updateDoc(doc(db, 'crmActivities', editingActivity.id), { ...data, updatedAt: now }); toast.success(t('crm.toast.activityUpdated', 'Atividade atualizada!')); } else { await addDoc(collection(db, 'crmActivities'), { ...data, businessId: business.id, isCompleted: false, createdAt: now, updatedAt: now }); toast.success(t('crm.toast.activityCreated', 'Atividade registrada!')); } queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] }); setActivityDialogOpen(false); setEditingActivity(null); } catch (err) { console.error('[CRM] Error saving activity:', err); toast.error(t('crm.toast.errorSaveActivity', 'Erro ao salvar atividade')); } }, [business?.id, user, editingActivity, queryClient]);

  const handleToggleActivity = useCallback(async (a: CRMActivity) => { if (!business?.id) return; try { await updateDoc(doc(db, 'crmActivities', a.id), { isCompleted: !a.isCompleted, completedAt: !a.isCompleted ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }); queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] }); } catch (err) { console.error('[CRM] Error toggling activity:', err); toast.error(t('crm.toast.errorUpdate', 'Erro ao atualizar')); } }, [business?.id, queryClient]);

  const handleDeleteActivity = useCallback(async () => { if (!deleteActivityConfirm || !business?.id) return; try { await deleteDoc(doc(db, 'crmActivities', deleteActivityConfirm.id)); toast.success(t('crm.toast.activityDeleted', 'Atividade excluída')); queryClient.invalidateQueries({ queryKey: ['crmActivities', business.id] }); setDeleteActivityConfirm(null); } catch (err) { console.error('[CRM] Error deleting activity:', err); toast.error(t('crm.toast.errorDelete', 'Erro ao excluir')); } }, [deleteActivityConfirm, business?.id, queryClient]);

  const handleStatusChange = useCallback(async (contactId: string, newStatus: LeadStatus) => {
    if (!business?.id) return;
    const qk = ['clients', business.id] as const;
    // Optimistic update — card moves instantly, no snap-back
    queryClient.setQueryData(qk, (old: CRMContact[] = []) =>
      old.map((c) => c.id === contactId ? { ...c, status: newStatus } : c)
    );
    try {
      await updateDoc(doc(db, 'clients', contactId), { status: newStatus, updatedAt: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: qk });
    } catch (err) {
      console.error('[CRM] Error changing lead status:', err);
      toast.error(t('crm.toast.errorMoveLead', 'Erro ao mover lead'));
      queryClient.invalidateQueries({ queryKey: qk }); // revert on failure
    }
  }, [business?.id, queryClient, t]);

  const handleTagsChange = useCallback(async (contactId: string, tags: string[]) => { if (!business?.id) return; try { await updateDoc(doc(db, 'clients', contactId), { tags, updatedAt: new Date().toISOString() }); queryClient.invalidateQueries({ queryKey: ['clients', business.id] }); } catch (err) { console.error('[CRM] Error updating tags:', err); toast.error(t('crm.toast.errorUpdateTags', 'Erro ao atualizar tags')); } }, [business?.id, queryClient]);

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
            {/* Search — only on pipeline/activities tabs */}
            {(activeTab === 'kanban' || activeTab === 'atividades') && (
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
              </>
            )}

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
          TAG FILTER BAR — collapsible
          ═══════════════════════════════════════════════════════════ */}
      <AnimatePresence>{showTagFilter && (
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

            {activeTab === 'kanban' && (
              <KanbanBoard contacts={contacts}
                stages={stages}
                onSelectContact={(c) => { setSelectedContact(c); setDetailOpen(true); }}
                selectedContactId={selectedContact?.id || null}
                onStatusChange={handleStatusChange}
                onNewContact={() => { setEditingContact(null); setContactDialogOpen(true); }}
                searchQuery={searchQuery} filterTags={filterTags} filterSource={filterSource} />
            )}

            {activeTab === 'atividades' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <ActivitiesTab activities={activities}
                  onEdit={(a) => { setEditingActivity(a); setActivityDialogOpen(true); }}
                  onDelete={(a) => setDeleteActivityConfirm(a)}
                  onToggle={handleToggleActivity}
                  onNew={() => { setEditingActivity(null); setActivityDialogOpen(true); }} />
              </div>
            )}

            {activeTab === 'campanhas' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <CampaignsTab businessId={business?.id || ''} />
              </div>
            )}

            {activeTab === 'metricas' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <MetricsTab deals={deals} contacts={contacts} activities={activities}
                  stages={PIPELINE_STAGES} isDark={isDark} metrics={pipelineMetrics} />
              </div>
            )}
            {activeTab === 'automacoes' && (
              <div className="flex-1 overflow-y-auto min-h-0">
                <AutomacoesTab businessId={business?.id || ''} userId={user?.uid || ''} userName={user?.name || ''} isDark={isDark} />
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
              onOpenConversations={() => { setDetailOpen(false); setActivePage('Conversas'); }} />
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
      <DealFormDialog open={dealDialogOpen} onClose={() => { setDealDialogOpen(false); setEditingDeal(null); }} onSave={handleSaveDeal} deal={editingDeal} contacts={contacts} members={members} />
      <ActivityFormDialog open={activityDialogOpen} onClose={() => { setActivityDialogOpen(false); setEditingActivity(null); }} onSave={handleSaveActivity} activity={editingActivity} contacts={contacts} deals={deals} members={members} />

      {/* Delete Confirmations */}
      <DeleteConfirmDialog open={!!deleteContactConfirm} title="Excluir Contato" message={`Excluir "${deleteContactConfirm?.name}"?`} onClose={() => setDeleteContactConfirm(null)} onConfirm={handleDeleteContact} />
      <DeleteConfirmDialog open={!!deleteDealConfirm} title="Excluir Deal" message={`Excluir "${deleteDealConfirm?.title}"?`} onClose={() => setDeleteDealConfirm(null)} onConfirm={handleDeleteDeal} />
      <DeleteConfirmDialog open={!!deleteActivityConfirm} title="Excluir Atividade" message={`Excluir "${deleteActivityConfirm?.title}"?`} onClose={() => setDeleteActivityConfirm(null)} onConfirm={handleDeleteActivity} />
    </div>
  );
}
