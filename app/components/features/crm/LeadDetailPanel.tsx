'use client';

import { useMemo } from 'react';
import { Chip } from '@mui/material';
import {
  X, Edit3, Mail, Phone, Clock, MessageCircle, MessageSquare,
  Calendar, CalendarPlus, Trash2, Activity, CheckCircle2,
  Brain, TrendingUp, TrendingDown, AlertTriangle, Heart,
  DollarSign, Target, Shield, Zap, Star, BarChart3,
  ThumbsUp, ThumbsDown, Timer, UserCheck, Ban, ArrowRight,
  Sparkles, Eye, MapPin, Hash,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatCurrency, formatPhone, getInitials } from '@/lib/utils/format';
import {
  STATUS_LABELS, STATUS_COLORS, ACTIVITY_LABELS, ACTIVITY_COLORS,
  PROFILE_CONFIG, TONE_CONFIG, SENSITIVITY_CONFIG,
  getScoreColor, getChurnLabel, formatDaysSince, relativeTime,
} from './shared';
import { SourceIcon } from './SourceIcon';
import { TagPicker } from './TagSystem';
import type { CRMContact, CRMActivity, CRMActivityType, ContactScores } from '@/lib/types';

const ACTIVITY_ICONS_MAP: Record<CRMActivityType, React.ReactNode> = {
  ligacao: <Phone size={12} />, email: <Mail size={12} />, reuniao: <Calendar size={12} />,
  whatsapp: <MessageCircle size={12} />, tarefa: <CheckCircle2 size={12} />,
  nota: <Edit3 size={12} />, proposta: <MessageSquare size={12} />,
};

// ── Score Ring ──────────────────────────────────────────────────────────────

function ScoreRing({ value, size = 44, stroke = 4, label }: { value: number; size?: number; stroke?: number; label: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const sc = getScoreColor(value);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor"
            strokeWidth={stroke} className="text-gray-100 dark:text-white/[0.06]" />
          <motion.circle
            cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={sc.fill}
            strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </svg>
        <span className={cn('absolute inset-0 flex items-center justify-center text-[10px] font-bold', sc.text)}>
          {value}
        </span>
      </div>
      <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500 text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Section Header ─────────────────────────────────────────────────────────

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <div className="w-5 h-5 rounded-md bg-red-500/10 dark:bg-red-500/15 flex items-center justify-center text-red-500 dark:text-red-400">
        {icon}
      </div>
      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{label}</p>
    </div>
  );
}

// ── Stat Row ───────────────────────────────────────────────────────────────

function StatRow({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="text-gray-400 dark:text-gray-500">{icon}</span>
        {label}
      </div>
      <span className={cn('text-xs font-semibold', accent || 'text-gray-800 dark:text-gray-200')}>{value}</span>
    </div>
  );
}

// ── Insight Chip ───────────────────────────────────────────────────────────

function InsightChip({ text, variant = 'neutral' }: { text: string; variant?: 'positive' | 'negative' | 'neutral' | 'warning' }) {
  const styles = {
    positive: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    negative: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    neutral: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  };
  return (
    <span className={cn('inline-flex items-center text-[10px] font-medium px-2 py-1 rounded-lg border', styles[variant])}>
      {text}
    </span>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────

export function LeadDetailPanel({ contact, activities, onClose, onEdit, onDelete, onTagsChange, onSchedule, onOpenInbox }: {
  contact: CRMContact;
  activities: CRMActivity[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTagsChange: (tags: string[]) => void;
  onSchedule: () => void;
  onOpenInbox: () => void;
}) {
  const contactActivities = useMemo(
    () => activities
      .filter((a) => a.contactId === contact.id)
      .sort((a, b) => (b.scheduledAt || b.createdAt).localeCompare(a.scheduledAt || a.createdAt))
      .slice(0, 8),
    [activities, contact.id],
  );

  const currentTags = contact.tags || [];
  const sc = STATUS_COLORS[contact.status];
  const profileCfg = contact.profile ? PROFILE_CONFIG[contact.profile] : null;
  const rh = contact.relationshipHistory;
  const bi = contact.behavioralInsights;
  const scores = contact.scores;
  const churn = scores ? getChurnLabel(scores.churnRisk) : null;

  const handleToggleTag = (tag: string) => {
    onTagsChange(currentTags.includes(tag) ? currentTags.filter((t) => t !== tag) : [...currentTags, tag]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className="fixed inset-y-0 right-0 w-full max-w-[460px] bg-white dark:bg-[#0a0e17] border-l border-gray-100 dark:border-white/[0.06] shadow-2xl z-40 flex flex-col overflow-hidden"
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-white/[0.06] shrink-0 bg-gradient-to-r from-white to-gray-50/50 dark:from-[#0a0e17] dark:to-[#0f1525]">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-red-500" />
          <h2 className="font-display font-bold text-gray-900 dark:text-white text-sm">Perfil 360°</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onEdit}
            className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
            <Edit3 size={13} />
          </motion.button>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onClose}
            className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
            <X size={13} />
          </motion.button>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10">

        {/* ── Profile Card ────────────────────────────────────── */}
        <div className="flex items-start gap-3">
          <div className="relative">
            <div className="w-13 h-13 rounded-xl bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-sm font-bold text-gray-600 dark:text-gray-300 shrink-0" style={{ width: 52, height: 52 }}>
              {getInitials(contact.name)}
            </div>
            {profileCfg && (
              <span className="absolute -top-1 -right-1 text-xs" title={profileCfg.label}>{profileCfg.emoji}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-base font-bold text-gray-900 dark:text-white truncate">{contact.name}</p>
              <SourceIcon source={contact.source} />
            </div>
            {contact.company && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500">{contact.role ? `${contact.role} · ` : ''}{contact.company}</p>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <Chip label={STATUS_LABELS[contact.status]} size="small" sx={{ backgroundColor: sc.bg, color: sc.text, fontWeight: 600, fontSize: '0.6rem', height: 20 }} />
              {profileCfg && (
                <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-md border', profileCfg.bg, profileCfg.text, profileCfg.border)}>
                  {profileCfg.label}
                </span>
              )}
              {churn && scores!.churnRisk >= 60 && (
                <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5', churn.bg, churn.color)}>
                  <AlertTriangle size={9} /> Churn {churn.label}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── AI Summary Card ─────────────────────────────────── */}
        {contact.aiSummary && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="relative p-3.5 rounded-xl bg-gradient-to-br from-violet-500/5 to-blue-500/5 dark:from-violet-500/10 dark:to-blue-500/10 border border-violet-200/50 dark:border-violet-500/20">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles size={12} className="text-violet-500" />
              <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider">Resumo IA</span>
            </div>
            <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{contact.aiSummary}</p>
          </motion.div>
        )}

        {/* ── Suggested Action ────────────────────────────────── */}
        {contact.suggestedAction && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-200/50 dark:border-amber-500/20">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
              <Zap size={13} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-0.5">Próxima Ação</p>
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{contact.suggestedAction}</p>
            </div>
            <ArrowRight size={14} className="text-amber-400 shrink-0" />
          </motion.div>
        )}

        {/* ── Scores ──────────────────────────────────────────── */}
        {scores && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <SectionHeader icon={<BarChart3 size={11} />} label="Scores de Inteligência" />
            <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.06]">
              <div className="flex items-center justify-around">
                <ScoreRing value={scores.loyalty} label="Fidelidade" />
                <ScoreRing value={scores.value} label="Valor" />
                <ScoreRing value={scores.engagement} label="Engajamento" />
                <ScoreRing value={scores.churnRisk} label="Risco Churn" />
                <ScoreRing value={scores.overall} size={52} stroke={5} label="Geral" />
              </div>
              {scores.lastCalculatedAt && (
                <p className="text-[9px] text-gray-400 dark:text-gray-600 text-center mt-2.5">
                  Calculado {relativeTime(scores.lastCalculatedAt)}
                </p>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Contact Info ────────────────────────────────────── */}
        <div className="space-y-1 p-3 bg-gray-50 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/[0.06]">
          {contact.email && (
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <Mail size={12} className="text-gray-400 dark:text-gray-500 shrink-0" />
              <span className="truncate">{contact.email}</span>
            </div>
          )}
          {contact.phone && (
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <Phone size={12} className="text-gray-400 dark:text-gray-500 shrink-0" />
              <span>{formatPhone(contact.phone)}</span>
            </div>
          )}
          {contact.whatsapp && (
            <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
              <MessageCircle size={12} className="shrink-0" />
              <span>WhatsApp: {formatPhone(contact.whatsapp)}</span>
            </div>
          )}
          {contact.preferredChannel && (
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <Star size={12} className="text-amber-400 shrink-0" />
              <span>Canal preferido: <strong className="capitalize">{contact.preferredChannel}</strong></span>
            </div>
          )}
          {contact.lastContactDate && (
            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <Clock size={12} className="shrink-0" />
              <span>Último contato: {relativeTime(contact.lastContactDate)}</span>
            </div>
          )}
        </div>

        {/* ── Relationship History ────────────────────────────── */}
        {rh && (Object.keys(rh).length > 0) && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <SectionHeader icon={<Heart size={11} />} label="Histórico de Relacionamento" />
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.06] space-y-0.5">
              {rh.firstContactDate && (
                <StatRow icon={<Calendar size={12} />} label="Cliente há" value={formatDaysSince(rh.firstContactDate)} />
              )}
              {rh.totalAppointments != null && (
                <StatRow icon={<Target size={12} />} label="Agendamentos" value={`${rh.completedAppointments ?? 0} / ${rh.totalAppointments}`} />
              )}
              {rh.attendanceRate != null && (
                <StatRow icon={<UserCheck size={12} />} label="Taxa de comparecimento"
                  value={`${rh.attendanceRate}%`}
                  accent={rh.attendanceRate >= 80 ? 'text-emerald-600 dark:text-emerald-400' : rh.attendanceRate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'} />
              )}
              {rh.noShowCount != null && rh.noShowCount > 0 && (
                <StatRow icon={<Ban size={12} />} label="Faltas" value={rh.noShowCount} accent="text-red-600 dark:text-red-400" />
              )}
              {rh.cancelledAppointments != null && rh.cancelledAppointments > 0 && (
                <StatRow icon={<X size={12} />} label="Cancelamentos" value={rh.cancelledAppointments} accent="text-orange-600 dark:text-orange-400" />
              )}
              {rh.avgDaysBetweenVisits != null && (
                <StatRow icon={<Timer size={12} />} label="Intervalo médio" value={`${rh.avgDaysBetweenVisits} dias`} />
              )}
              {rh.lastVisitDate && (
                <StatRow icon={<Clock size={12} />} label="Última visita" value={formatDaysSince(rh.lastVisitDate)} />
              )}
              {rh.lastServiceName && (
                <StatRow icon={<Zap size={12} />} label="Último serviço" value={rh.lastServiceName} />
              )}
              {rh.totalSpent != null && (
                <StatRow icon={<DollarSign size={12} />} label="Total gasto" value={formatCurrency(rh.totalSpent)}
                  accent="text-emerald-600 dark:text-emerald-400" />
              )}
              {rh.avgTicket != null && (
                <StatRow icon={<Hash size={12} />} label="Ticket médio" value={formatCurrency(rh.avgTicket)} />
              )}
              {rh.servicesContracted && rh.servicesContracted.length > 0 && (
                <div className="pt-2 mt-1 border-t border-gray-100 dark:border-white/[0.04]">
                  <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 mb-1.5">Serviços contratados</p>
                  <div className="flex flex-wrap gap-1">
                    {rh.servicesContracted.map((s) => (
                      <span key={s} className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Behavioral Insights ─────────────────────────────── */}
        {bi && (Object.keys(bi).length > 0) && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <SectionHeader icon={<Eye size={11} />} label="Insights Comportamentais" />
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.06] space-y-3">

              {/* Tone & Sensitivity */}
              <div className="flex items-center gap-3">
                {bi.conversationTone && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400">Tom:</span>
                    <span className={cn('text-sm', TONE_CONFIG[bi.conversationTone].color)}>
                      {TONE_CONFIG[bi.conversationTone].emoji}
                    </span>
                    <span className={cn('text-[10px] font-semibold', TONE_CONFIG[bi.conversationTone].color)}>
                      {TONE_CONFIG[bi.conversationTone].label}
                    </span>
                  </div>
                )}
                {bi.priceSensitivity && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400">Preço:</span>
                    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-md', SENSITIVITY_CONFIG[bi.priceSensitivity].bg, SENSITIVITY_CONFIG[bi.priceSensitivity].color)}>
                      {SENSITIVITY_CONFIG[bi.priceSensitivity].label}
                    </span>
                  </div>
                )}
              </div>

              {/* Preferred Professional */}
              {bi.preferredProfessional && (
                <div className="flex items-center gap-2 text-xs">
                  <UserCheck size={12} className="text-blue-400" />
                  <span className="text-gray-500 dark:text-gray-400">Preferência:</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-200">&quot;{bi.preferredProfessional}&quot;</span>
                </div>
              )}

              {/* Preferred Times */}
              {bi.preferredTimes && bi.preferredTimes.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">Horários preferidos</p>
                  <div className="flex flex-wrap gap-1">
                    {bi.preferredTimes.map((t) => <InsightChip key={t} text={t} variant="positive" />)}
                  </div>
                </div>
              )}

              {/* Preferences */}
              {bi.preferences && bi.preferences.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">Preferências mencionadas</p>
                  <div className="flex flex-wrap gap-1">
                    {bi.preferences.map((p) => <InsightChip key={p} text={`"${p}"`} variant="neutral" />)}
                  </div>
                </div>
              )}

              {/* Recurring Objections */}
              {bi.recurringObjections && bi.recurringObjections.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1">
                    <ThumbsDown size={10} /> Objeções recorrentes
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {bi.recurringObjections.map((o) => <InsightChip key={o} text={`"${o}"`} variant="warning" />)}
                  </div>
                </div>
              )}

              {/* Cancellation Reasons */}
              {bi.cancellationReasons && bi.cancellationReasons.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1">
                    <Ban size={10} /> Motivos de cancelamento
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {bi.cancellationReasons.map((r) => <InsightChip key={r} text={r} variant="negative" />)}
                  </div>
                </div>
              )}

              {/* Inquired but not booked */}
              {bi.uncontractedServices && bi.uncontractedServices.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1">
                    <Eye size={10} /> Perguntou mas não contratou
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {bi.uncontractedServices.map((s) => <InsightChip key={s} text={s} variant="warning" />)}
                  </div>
                </div>
              )}

              {/* Inquired times but never closed */}
              {bi.inquiredButNotBooked && bi.inquiredButNotBooked.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1">
                    <Clock size={10} /> Horários perguntados mas nunca fechou
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {bi.inquiredButNotBooked.map((h) => <InsightChip key={h} text={h} variant="neutral" />)}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Quick Actions ───────────────────────────────────── */}
        <div className="space-y-2">
          <SectionHeader icon={<Zap size={11} />} label="Ações Rápidas" />
          <div className="grid grid-cols-2 gap-2">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onSchedule}
              className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:border-red-300 dark:hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-400 transition-all">
              <CalendarPlus size={14} /> Agendar
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onOpenInbox}
              className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all">
              <MessageSquare size={14} /> Mensagem
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onSchedule}
              className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:border-blue-300 dark:hover:border-blue-500/40 hover:text-blue-600 dark:hover:text-blue-400 transition-all">
              <Calendar size={14} /> Consulta
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onDelete}
              className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:border-red-300 dark:hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-400 transition-all">
              <Trash2 size={14} /> Excluir
            </motion.button>
          </div>
        </div>

        {/* ── Tags ────────────────────────────────────────────── */}
        <TagPicker currentTags={currentTags} onToggle={handleToggleTag} onAddCustom={(tag) => onTagsChange([...currentTags, tag])} />

        {/* ── Notes ───────────────────────────────────────────── */}
        {contact.notes && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Observações</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed bg-gray-50 dark:bg-white/[0.02] rounded-xl p-3 border border-gray-100 dark:border-white/[0.06]">
              {contact.notes}
            </p>
          </div>
        )}

        {/* ── Activity Timeline ───────────────────────────────── */}
        <div className="space-y-2">
          <SectionHeader icon={<Activity size={11} />} label="Atividades Recentes" />
          {contactActivities.length === 0 ? (
            <div className="text-center py-6 text-gray-300 dark:text-gray-600">
              <Activity size={20} className="mx-auto mb-1.5" />
              <p className="text-[11px]">Nenhuma atividade registrada</p>
            </div>
          ) : (
            <div className="space-y-2">
              {contactActivities.map((a, i) => {
                const actColor = ACTIVITY_COLORS[a.type];
                return (
                  <motion.div key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}
                    className="flex items-start gap-2.5 py-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${actColor}15`, color: actColor }}>
                      {a.isCompleted ? <CheckCircle2 size={12} /> : ACTIVITY_ICONS_MAP[a.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-xs font-semibold', a.isCompleted ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-200')}>
                        {a.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                        <span className="font-medium px-1 py-0.5 rounded" style={{ backgroundColor: `${actColor}15`, color: actColor }}>
                          {ACTIVITY_LABELS[a.type]}
                        </span>
                        <span>{relativeTime(a.scheduledAt || a.createdAt)}</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
