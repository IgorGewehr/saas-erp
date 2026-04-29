'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import type { CRMContact, LeadSource, CRMStageConfig } from '@/lib/types';
import { SOURCE_LABELS, SOURCE_COLORS } from './shared';

type SortField = 'name' | 'status' | 'score' | 'source' | 'assignedTo' | 'lastContact';
type SortDir = 'asc' | 'desc';

function relTime(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function scoreColor(s: number) {
  if (s >= 70) return 'bg-emerald-500';
  if (s >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

export function LeadTableView({
  contacts,
  stages,
  searchQuery,
  filterTags,
  filterSource,
  onSelectContact,
  selectedContactId,
}: {
  contacts: CRMContact[];
  stages: CRMStageConfig[];
  searchQuery: string;
  filterTags: string[];
  filterSource: LeadSource | 'all';
  onSelectContact: (c: CRMContact) => void;
  selectedContactId: string | null;
}) {
  const [sortField, setSortField] = useState<SortField>('lastContact');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const stageMap = useMemo(
    () => Object.fromEntries(stages.map(s => [s.id, s])),
    [stages],
  );
  const stageOrder = useMemo(
    () => Object.fromEntries(stages.map((s, i) => [s.id, i])),
    [stages],
  );

  const filtered = useMemo(() => {
    let result = [...contacts];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.company && c.company.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)),
      );
    }
    if (filterSource !== 'all') result = result.filter(c => c.source === filterSource);
    if (filterTags.length > 0) result = result.filter(c => filterTags.every(t => c.tags?.includes(t)));
    return result;
  }, [contacts, searchQuery, filterSource, filterTags]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'name') cmp = a.name.localeCompare(b.name, 'pt-BR');
    else if (sortField === 'status') cmp = (stageOrder[a.status] ?? 99) - (stageOrder[b.status] ?? 99);
    else if (sortField === 'score') cmp = (a.scores?.overall ?? a.score ?? 0) - (b.scores?.overall ?? b.score ?? 0);
    else if (sortField === 'source') cmp = a.source.localeCompare(b.source);
    else if (sortField === 'assignedTo') cmp = (a.assignedToName ?? '').localeCompare(b.assignedToName ?? '', 'pt-BR');
    else if (sortField === 'lastContact') {
      const da = a.lastContactDate ?? a.updatedAt ?? '';
      const db2 = b.lastContactDate ?? b.updatedAt ?? '';
      cmp = da.localeCompare(db2);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  }), [filtered, sortField, sortDir, stageOrder]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronsUpDown size={11} className="text-gray-300 dark:text-gray-600 shrink-0" />;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-red-500 shrink-0" />
      : <ChevronDown size={11} className="text-red-500 shrink-0" />;
  };

  const COLS: { field: SortField; label: string }[] = [
    { field: 'name',        label: 'Nome'           },
    { field: 'status',      label: 'Estágio'        },
    { field: 'score',       label: 'Score'          },
    { field: 'source',      label: 'Origem'         },
    { field: 'assignedTo',  label: 'Atribuído'      },
    { field: 'lastContact', label: 'Último contato' },
  ];

  return (
    <div className="flex-1 overflow-auto px-4 pb-6">
      <table className="w-full text-sm border-collapse min-w-[720px]">
        <thead className="sticky top-0 z-10 bg-white dark:bg-[#0a0e17]">
          <tr className="border-b border-gray-100 dark:border-white/[0.06]">
            {COLS.map(({ field, label }) => (
              <th
                key={field}
                onClick={() => toggleSort(field)}
                className="px-3 py-3 text-left text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 transition-colors whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  {label}
                  <SortIcon field={field} />
                </div>
              </th>
            ))}
            {/* Tags — non-sortable */}
            <th className="px-3 py-3 text-left text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider whitespace-nowrap">
              Tags
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((contact, i) => {
            const stage = stageMap[contact.status];
            const score = contact.scores?.overall ?? contact.score ?? 0;
            const isSelected = contact.id === selectedContactId;
            return (
              <motion.tr
                key={contact.id}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.015, 0.3) }}
                onClick={() => onSelectContact(contact)}
                className={cn(
                  'border-b border-gray-50 dark:border-white/[0.03] cursor-pointer transition-colors group',
                  isSelected
                    ? 'bg-red-50/60 dark:bg-red-500/[0.08]'
                    : 'hover:bg-gray-50/80 dark:hover:bg-white/[0.025]',
                )}
              >
                {/* Nome + company */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-300 shrink-0">
                      {getInitials(contact.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-white truncate text-[13px] leading-snug">
                        {contact.name}
                      </p>
                      {contact.company && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate leading-snug">{contact.company}</p>
                      )}
                    </div>
                  </div>
                </td>

                {/* Estágio */}
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {stage ? (
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                      style={{ backgroundColor: stage.color + '22', color: stage.color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                      {stage.name}
                    </span>
                  ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                </td>

                {/* Score */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-14 h-1.5 bg-gray-100 dark:bg-white/[0.08] rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', scoreColor(score))}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-bold text-gray-600 dark:text-gray-400 tabular-nums w-5 text-right">
                      {score}
                    </span>
                  </div>
                </td>

                {/* Origem */}
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span
                    className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-lg"
                    style={{
                      backgroundColor: (SOURCE_COLORS[contact.source] ?? '#6B7280') + '1a',
                      color: SOURCE_COLORS[contact.source] ?? '#6B7280',
                    }}
                  >
                    {SOURCE_LABELS[contact.source] ?? contact.source}
                  </span>
                </td>

                {/* Atribuído */}
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {contact.assignedToName ? (
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-400 to-violet-500 flex items-center justify-center text-[8px] font-bold text-white shrink-0">
                        {getInitials(contact.assignedToName)}
                      </div>
                      <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate max-w-[90px]">
                        {contact.assignedToName}
                      </span>
                    </div>
                  ) : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                </td>

                {/* Último contato */}
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className="text-[12px] text-gray-400 dark:text-gray-500 tabular-nums">
                    {relTime(contact.lastContactDate ?? contact.updatedAt)}
                  </span>
                </td>

                {/* Tags */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1 flex-wrap">
                    {(contact.tags ?? []).slice(0, 2).map(tag => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 whitespace-nowrap"
                      >
                        {tag}
                      </span>
                    ))}
                    {(contact.tags?.length ?? 0) > 2 && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">
                        +{(contact.tags?.length ?? 0) - 2}
                      </span>
                    )}
                  </div>
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>

      {sorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-gray-400 dark:text-gray-500">Nenhum lead encontrado</p>
          <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">Tente ajustar os filtros</p>
        </div>
      )}
    </div>
  );
}
