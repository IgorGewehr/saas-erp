'use client';

import React from 'react';
import { Clock, AlertTriangle, Zap } from 'lucide-react';
import { Tooltip } from '@mui/material';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import { SOURCE_LABELS, relativeTime, PROFILE_CONFIG, getScoreColor, getChurnLabel } from './shared';
import { SourceIcon } from './SourceIcon';
import { TagBadge } from './TagSystem';
import type { CRMContact } from '@/lib/types';

export function LeadCard({ contact, isSelected, isDragging, onClick, onDragStart, onDragEnd }: {
  contact: CRMContact;
  isSelected: boolean;
  isDragging?: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const tags = contact.tags || [];
  const profileCfg = contact.profile ? PROFILE_CONFIG[contact.profile] : null;
  const scores = contact.scores;
  const churnRisk = scores?.churnRisk ?? 0;
  const overallScore = scores?.overall ?? contact.score ?? 0;
  const scoreCfg = getScoreColor(overallScore);
  const hasHighChurn = churnRisk >= 60;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        'bg-white dark:bg-[#111827] border rounded-xl p-3.5 cursor-grab active:cursor-grabbing hover:shadow-lg hover:-translate-y-0.5 transition-all group',
        isDragging && 'opacity-40 scale-[0.97]',
        isSelected
          ? 'border-red-500/50 dark:border-red-500/40 shadow-red-500/10 shadow-md'
          : hasHighChurn
            ? 'border-orange-300/50 dark:border-orange-500/30 hover:border-orange-400 dark:hover:border-orange-400/50'
            : 'border-gray-100 dark:border-gray-700/50 hover:border-gray-200 dark:hover:border-gray-600',
      )}
    >
      {/* Profile & Name */}
      <div className="flex items-start gap-3 mb-2.5">
        <div className="relative">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300 shrink-0">
            {getInitials(contact.name)}
          </div>
          {profileCfg && (
            <span className="absolute -top-1 -right-1 text-xs" title={profileCfg.label}>{profileCfg.emoji}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-tight">{contact.name}</p>
          {contact.company && (
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{contact.company}</p>
          )}
        </div>
        <Tooltip title={SOURCE_LABELS[contact.source]} arrow>
          <span className="shrink-0 mt-0.5"><SourceIcon source={contact.source} /></span>
        </Tooltip>
      </div>

      {/* Profile badge + churn warning */}
      {(profileCfg || hasHighChurn) && (
        <div className="flex items-center gap-1.5 mb-2.5">
          {profileCfg && (
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-md border', profileCfg.bg, profileCfg.text, profileCfg.border)}>
              {profileCfg.label}
            </span>
          )}
          {hasHighChurn && (
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1', getChurnLabel(churnRisk).bg, getChurnLabel(churnRisk).color)}>
              <AlertTriangle size={10} /> Churn
            </span>
          )}
        </div>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {tags.slice(0, 3).map((tag) => <TagBadge key={tag} tag={tag} />)}
          {tags.length > 3 && (
            <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 px-1.5 py-0.5">+{tags.length - 3}</span>
          )}
        </div>
      )}

      {/* Suggested action preview */}
      {contact.suggestedAction && (
        <div className="flex items-center gap-2 mb-2.5 px-2.5 py-2 rounded-lg bg-amber-500/5 dark:bg-amber-500/10 border border-amber-200/30 dark:border-amber-500/15">
          <Zap size={12} className="text-amber-500 shrink-0" />
          <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium truncate">{contact.suggestedAction}</p>
        </div>
      )}

      {/* Footer: time + score bar */}
      <div className="flex items-center justify-between pt-2.5 border-t border-gray-50 dark:border-gray-800">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <Clock size={12} />
          <span>{relativeTime(contact.lastContactDate || contact.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          {scores && (
            <div className="w-14 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${overallScore}%`, backgroundColor: scoreCfg.fill }} />
            </div>
          )}
          <div className={cn('text-xs font-bold px-1.5 py-0.5 rounded-md', scoreCfg.bg, scoreCfg.text)}>
            {overallScore}
          </div>
        </div>
      </div>

      {/* Assigned user */}
      {contact.assignedToName && (
        <div className="flex items-center gap-2 mt-2.5">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-500 flex items-center justify-center text-[8px] font-bold text-white">
            {getInitials(contact.assignedToName)}
          </div>
          <span className="text-xs text-gray-400 dark:text-gray-500">{contact.assignedToName}</span>
        </div>
      )}
    </div>
  );
}
