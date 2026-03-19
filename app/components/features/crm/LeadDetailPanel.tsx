'use client';

import { useMemo } from 'react';
import { Chip } from '@mui/material';
import {
  X, Edit3, Mail, Phone, Clock, MessageCircle, MessageSquare,
  Calendar, CalendarPlus, Trash2, Activity, CheckCircle2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatPhone, getInitials } from '@/lib/utils/format';
import {
  STATUS_LABELS, STATUS_COLORS, ACTIVITY_LABELS, ACTIVITY_COLORS,
  relativeTime,
} from './shared';
import { SourceIcon } from './SourceIcon';
import { TagPicker } from './TagSystem';
import type { CRMContact, CRMActivity, CRMActivityType } from '@/lib/types';

// Activity icons (React nodes need to be inline here since they can't be serialized in shared.ts)
const ACTIVITY_ICONS_MAP: Record<CRMActivityType, React.ReactNode> = {
  ligacao: <Phone size={12} />,
  email: <Mail size={12} />,
  reuniao: <Calendar size={12} />,
  whatsapp: <MessageCircle size={12} />,
  tarefa: <CheckCircle2 size={12} />,
  nota: <Edit3 size={12} />,
  proposta: <MessageSquare size={12} />,
};

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

  const handleToggleTag = (tag: string) => {
    if (currentTags.includes(tag)) {
      onTagsChange(currentTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...currentTags, tag]);
    }
  };

  const handleAddCustomTag = (tag: string) => {
    onTagsChange([...currentTags, tag]);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className="fixed inset-y-0 right-0 w-full max-w-[420px] bg-white dark:bg-[#0a0e17] border-l border-gray-100 dark:border-white/[0.06] shadow-2xl z-40 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
        <h2 className="font-display font-bold text-gray-900 dark:text-white text-base">Detalhes do Lead</h2>
        <div className="flex items-center gap-1.5">
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onEdit}
            className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
            <Edit3 size={14} />
          </motion.button>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onClose}
            className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
            <X size={14} />
          </motion.button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10">
        {/* Profile card */}
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-sm font-bold text-gray-600 dark:text-gray-300 shrink-0">
            {getInitials(contact.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-base font-bold text-gray-900 dark:text-white truncate">{contact.name}</p>
              <SourceIcon source={contact.source} />
            </div>
            {contact.company && (
              <p className="text-xs text-gray-400 dark:text-gray-500">{contact.role ? `${contact.role} · ` : ''}{contact.company}</p>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <Chip label={STATUS_LABELS[contact.status]} size="small" sx={{ backgroundColor: sc.bg, color: sc.text, fontWeight: 600, fontSize: '0.6rem', height: 20 }} />
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-md',
                contact.score >= 80 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                contact.score >= 50 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
                'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
              )}>
                Score: {contact.score}
              </span>
            </div>
          </div>
        </div>

        {/* Contact info */}
        <div className="space-y-2 p-3 bg-gray-50 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/[0.06]">
          {contact.email && (
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <Mail size={13} className="text-gray-400 dark:text-gray-500 shrink-0" />
              <span className="truncate">{contact.email}</span>
            </div>
          )}
          {contact.phone && (
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <Phone size={13} className="text-gray-400 dark:text-gray-500 shrink-0" />
              <span>{formatPhone(contact.phone)}</span>
            </div>
          )}
          {contact.whatsapp && (
            <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
              <MessageCircle size={13} className="shrink-0" />
              <span>WhatsApp: {formatPhone(contact.whatsapp)}</span>
            </div>
          )}
          {contact.lastContactDate && (
            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <Clock size={13} className="shrink-0" />
              <span>Último contato: {relativeTime(contact.lastContactDate)}</span>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Ações Rápidas</p>
          <div className="grid grid-cols-2 gap-2">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onSchedule}
              className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:border-red-300 dark:hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-400 transition-all">
              <CalendarPlus size={14} /> Agendar Contato
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onOpenInbox}
              className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all">
              <MessageSquare size={14} /> Enviar Mensagem
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onSchedule}
              className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:border-blue-300 dark:hover:border-blue-500/40 hover:text-blue-600 dark:hover:text-blue-400 transition-all">
              <Calendar size={14} /> Nova Consulta
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onDelete}
              className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:border-red-300 dark:hover:border-red-500/40 hover:text-red-600 dark:hover:text-red-400 transition-all">
              <Trash2 size={14} /> Excluir Lead
            </motion.button>
          </div>
        </div>

        {/* Tags */}
        <TagPicker currentTags={currentTags} onToggle={handleToggleTag} onAddCustom={handleAddCustomTag} />

        {/* Notes */}
        {contact.notes && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Observações</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed bg-gray-50 dark:bg-white/[0.02] rounded-xl p-3 border border-gray-100 dark:border-white/[0.06]">
              {contact.notes}
            </p>
          </div>
        )}

        {/* Activity Timeline */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Atividades Recentes</p>
          {contactActivities.length === 0 ? (
            <div className="text-center py-6 text-gray-300 dark:text-gray-600">
              <Activity size={20} className="mx-auto mb-1.5" />
              <p className="text-[11px]">Nenhuma atividade registrada</p>
            </div>
          ) : (
            <div className="space-y-2">
              {contactActivities.map((a) => {
                const actColor = ACTIVITY_COLORS[a.type];
                return (
                  <div key={a.id} className="flex items-start gap-2.5 py-2">
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
