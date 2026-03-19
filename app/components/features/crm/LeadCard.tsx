'use client';

import React from 'react';
import { Clock } from 'lucide-react';
import { Tooltip } from '@mui/material';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import { SOURCE_LABELS, relativeTime } from './shared';
import { SourceIcon } from './SourceIcon';
import { TagBadge } from './TagSystem';
import type { CRMContact } from '@/lib/types';

export function LeadCard({ contact, isSelected, onClick, onDragStart }: {
  contact: CRMContact;
  isSelected: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const tags = contact.tags || [];

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        'bg-white dark:bg-[#111827] border rounded-xl p-3 cursor-grab active:cursor-grabbing hover:shadow-lg hover:-translate-y-0.5 transition-all group',
        isSelected
          ? 'border-red-500/50 dark:border-red-500/40 shadow-red-500/10 shadow-md'
          : 'border-gray-100 dark:border-gray-700/50 hover:border-gray-200 dark:hover:border-gray-600',
      )}
    >
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300 shrink-0">
          {getInitials(contact.name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-tight">{contact.name}</p>
          {contact.company && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{contact.company}</p>
          )}
        </div>
        <Tooltip title={SOURCE_LABELS[contact.source]} arrow>
          <span className="shrink-0 mt-0.5"><SourceIcon source={contact.source} /></span>
        </Tooltip>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.slice(0, 3).map((tag) => <TagBadge key={tag} tag={tag} />)}
          {tags.length > 3 && (
            <span className="text-[9px] font-medium text-gray-400 dark:text-gray-500 px-1.5 py-0.5">+{tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-gray-50 dark:border-gray-800">
        <div className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
          <Clock size={10} />
          <span>{relativeTime(contact.lastContactDate || contact.updatedAt)}</span>
        </div>
        <div className={cn(
          'text-[10px] font-bold px-1.5 py-0.5 rounded-md',
          contact.score >= 80 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
          contact.score >= 50 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
          'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
        )}>
          {contact.score}
        </div>
      </div>

      {contact.assignedToName && (
        <div className="flex items-center gap-1.5 mt-2">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-500 flex items-center justify-center text-[7px] font-bold text-white">
            {getInitials(contact.assignedToName)}
          </div>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">{contact.assignedToName}</span>
        </div>
      )}
    </div>
  );
}
