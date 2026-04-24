import type { CRMPipelineStage, CRMActivityType, LeadStatus, LeadSource, BroadcastStatus, ContactProfile, ConversationTone, PriceSensitivity } from '@/lib/types';
import { formatDate } from '@/lib/utils/format';

// Pipeline
export const PIPELINE_STAGES: CRMPipelineStage[] = [
  { id: 'prospeccao', name: 'Prospecção', color: '#6B7280', order: 0, probability: 10 },
  { id: 'qualificacao', name: 'Qualificação', color: '#3B82F6', order: 1, probability: 25 },
  { id: 'proposta', name: 'Proposta', color: '#F59E0B', order: 2, probability: 50 },
  { id: 'negociacao', name: 'Negociação', color: '#8B5CF6', order: 3, probability: 75 },
  { id: 'fechamento', name: 'Fechamento', color: '#10B981', order: 4, probability: 90 },
];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  site: 'Site', indicacao: 'Indicação', whatsapp: 'WhatsApp', instagram: 'Instagram',
  facebook: 'Facebook', google_ads: 'Google Ads', linkedin: 'LinkedIn', evento: 'Evento',
  email: 'E-mail', telefone: 'Telefone', outro: 'Outro',
};

export const SOURCE_COLORS: Record<LeadSource, string> = {
  site: '#3B82F6', indicacao: '#10B981', whatsapp: '#25D366', instagram: '#E4405F',
  facebook: '#1877F2', google_ads: '#FBBC04', linkedin: '#0A66C2', evento: '#8B5CF6',
  email: '#EF4444', telefone: '#F59E0B', outro: '#6B7280',
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  novo: 'Novo', contatado: 'Contatado', qualificado: 'Qualificado',
  proposta: 'Proposta', negociacao: 'Negociação', ganho: 'Ganho', perdido: 'Perdido',
};

export const STATUS_COLORS: Record<LeadStatus, { bg: string; text: string }> = {
  novo: { bg: '#EFF6FF', text: '#2563EB' },
  contatado: { bg: '#F0FDF4', text: '#16A34A' },
  qualificado: { bg: '#FDF4FF', text: '#9333EA' },
  proposta: { bg: '#FEFCE8', text: '#CA8A04' },
  negociacao: { bg: '#FFF7ED', text: '#EA580C' },
  ganho: { bg: '#F0FDF4', text: '#166534' },
  perdido: { bg: '#FEF2F2', text: '#991B1B' },
};

export const KANBAN_COLUMNS: { status: LeadStatus; label: string; color: string }[] = [
  { status: 'novo', label: 'Novo', color: '#3B82F6' },
  { status: 'contatado', label: 'Contatado', color: '#10B981' },
  { status: 'qualificado', label: 'Qualificado', color: '#8B5CF6' },
  { status: 'proposta', label: 'Proposta', color: '#F59E0B' },
  { status: 'negociacao', label: 'Negociação', color: '#EA580C' },
  { status: 'ganho', label: 'Ganho', color: '#166534' },
  { status: 'perdido', label: 'Perdido', color: '#991B1B' },
];

export const ACTIVITY_LABELS: Record<CRMActivityType, string> = {
  ligacao: 'Ligação', email: 'E-mail', reuniao: 'Reunião',
  whatsapp: 'WhatsApp', tarefa: 'Tarefa', nota: 'Nota', proposta: 'Proposta',
};

export const ACTIVITY_COLORS: Record<CRMActivityType, string> = {
  ligacao: '#F59E0B', email: '#3B82F6', reuniao: '#8B5CF6',
  whatsapp: '#25D366', tarefa: '#10B981', nota: '#6B7280', proposta: '#DC2626',
};

export const ALL_SOURCES: LeadSource[] = ['site', 'indicacao', 'whatsapp', 'instagram', 'facebook', 'google_ads', 'linkedin', 'evento', 'email', 'telefone', 'outro'];
export const ALL_STATUSES: LeadStatus[] = ['novo', 'contatado', 'qualificado', 'proposta', 'negociacao', 'ganho', 'perdido'];
export const ALL_ACTIVITY_TYPES: CRMActivityType[] = ['ligacao', 'email', 'reuniao', 'whatsapp', 'tarefa', 'nota', 'proposta'];

export const BROADCAST_STATUS_LABELS: Record<BroadcastStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Rascunho', color: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-100 dark:bg-gray-800' },
  scheduled: { label: 'Agendada', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10' },
  sending: { label: 'Enviando', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-500/10' },
  sent: { label: 'Enviada', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  paused: { label: 'Pausada', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-500/10' },
  failed: { label: 'Falha', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10' },
};

// Tag System
export interface TagConfig {
  label: string;
  bg: string;
  text: string;
  dot: string;
}

export const TAG_PRESETS: Record<string, TagConfig> = {
  quente: { label: 'Quente', bg: 'bg-orange-500/15 dark:bg-orange-500/20', text: 'text-orange-600 dark:text-orange-300', dot: 'bg-orange-500' },
  'para prosseguir': { label: 'Para Prosseguir', bg: 'bg-blue-500/15 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-300', dot: 'bg-blue-500' },
  'falhou contato': { label: 'Falhou Contato', bg: 'bg-red-500/15 dark:bg-red-500/20', text: 'text-red-600 dark:text-red-300', dot: 'bg-red-500' },
  assinou: { label: 'Assinou', bg: 'bg-emerald-500/15 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-500' },
  'tem interesse': { label: 'Tem Interesse', bg: 'bg-purple-500/15 dark:bg-purple-500/20', text: 'text-purple-600 dark:text-purple-300', dot: 'bg-purple-500' },
};

export const ALL_PRESET_TAGS = Object.keys(TAG_PRESETS);

export function getTagConfig(tag: string): TagConfig {
  const preset = TAG_PRESETS[tag.toLowerCase()];
  if (preset) return preset;
  return { label: tag, bg: 'bg-gray-500/15 dark:bg-gray-500/20', text: 'text-gray-500 dark:text-gray-300', dot: 'bg-gray-500' };
}

// ── Profile & Scoring ──────────────────────────────────────────────────────

export const PROFILE_CONFIG: Record<ContactProfile, { label: string; emoji: string; bg: string; text: string; border: string }> = {
  vip:      { label: 'VIP',        emoji: '👑', bg: 'bg-amber-500/15 dark:bg-amber-500/20',   text: 'text-amber-600 dark:text-amber-400',   border: 'border-amber-400/30' },
  regular:  { label: 'Regular',    emoji: '●',  bg: 'bg-blue-500/15 dark:bg-blue-500/20',     text: 'text-blue-600 dark:text-blue-400',     border: 'border-blue-400/30' },
  sporadic: { label: 'Esporádico', emoji: '◌',  bg: 'bg-gray-500/15 dark:bg-gray-500/20',     text: 'text-gray-600 dark:text-gray-400',     border: 'border-gray-400/30' },
  new:      { label: 'Novo',       emoji: '✦',  bg: 'bg-emerald-500/15 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-400/30' },
  at_risk:  { label: 'Em Risco',   emoji: '⚠',  bg: 'bg-orange-500/15 dark:bg-orange-500/20', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-400/30' },
  churned:  { label: 'Perdido',    emoji: '✕',  bg: 'bg-red-500/15 dark:bg-red-500/20',       text: 'text-red-600 dark:text-red-400',       border: 'border-red-400/30' },
};

export const TONE_CONFIG: Record<ConversationTone, { label: string; emoji: string; color: string }> = {
  satisfied: { label: 'Satisfeito', emoji: '😊', color: 'text-emerald-500' },
  neutral:   { label: 'Neutro',     emoji: '😐', color: 'text-gray-400' },
  irritated: { label: 'Irritado',   emoji: '😤', color: 'text-red-500' },
};

export const SENSITIVITY_CONFIG: Record<PriceSensitivity, { label: string; color: string; bg: string }> = {
  low:    { label: 'Baixa',  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
  medium: { label: 'Média',  color: 'text-amber-600 dark:text-amber-400',     bg: 'bg-amber-500/10' },
  high:   { label: 'Alta',   color: 'text-red-600 dark:text-red-400',         bg: 'bg-red-500/10' },
};

export function getScoreColor(score: number): { text: string; bg: string; fill: string } {
  if (score >= 80) return { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/15', fill: '#10B981' };
  if (score >= 60) return { text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/15', fill: '#3B82F6' };
  if (score >= 40) return { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15', fill: '#F59E0B' };
  if (score >= 20) return { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/15', fill: '#EA580C' };
  return { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/15', fill: '#EF4444' };
}

export function getChurnLabel(risk: number): { label: string; color: string; bg: string } {
  if (risk >= 80) return { label: 'Crítico', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/15' };
  if (risk >= 60) return { label: 'Alto', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/15' };
  if (risk >= 40) return { label: 'Moderado', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/15' };
  if (risk >= 20) return { label: 'Baixo', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/15' };
  return { label: 'Mínimo', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/15' };
}

export function daysSince(isoStr?: string): number | null {
  if (!isoStr) return null;
  return Math.floor((Date.now() - new Date(isoStr).getTime()) / 86_400_000);
}

export function formatDaysSince(isoStr?: string): string {
  const d = daysSince(isoStr);
  if (d === null) return '-';
  if (d === 0) return 'Hoje';
  if (d === 1) return 'Ontem';
  if (d < 30) return `${d} dias`;
  if (d < 365) return `${Math.floor(d / 30)} meses`;
  return `${Math.floor(d / 365)}a ${Math.floor((d % 365) / 30)}m`;
}

// CRM Tab type
export type CRMTab = 'kanban' | 'atividades' | 'campanhas' | 'metricas' | 'automacoes' | 'formularios';

// Helpers
export function relativeTime(isoStr?: string): string {
  if (!isoStr) return '-';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return formatDate(isoStr);
}

export function applyPhoneMask(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function stripPhoneMask(value: string): string {
  return value.replace(/\D/g, '');
}

export function parseCurrencyInput(value: string): number {
  const cleaned = value.replace(/[^\d,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export function formatCurrencyInput(value: number): string {
  if (value === 0) return '';
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fullTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
