'use client';

import { useState, useMemo } from 'react';
import { Layers, Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { KANBAN_COLUMNS } from './shared';
import { LeadCard } from './LeadCard';
import type { CRMContact, LeadStatus, LeadSource } from '@/lib/types';

export function KanbanBoard({ contacts, onSelectContact, selectedContactId, onStatusChange, onNewContact, searchQuery, filterTags, filterSource }: {
  contacts: CRMContact[];
  onSelectContact: (c: CRMContact) => void;
  selectedContactId: string | null;
  onStatusChange: (contactId: string, newStatus: LeadStatus) => Promise<void>;
  onNewContact: () => void;
  searchQuery: string;
  filterTags: string[];
  filterSource: LeadSource | 'all';
}) {
  const [draggingContact, setDraggingContact] = useState<CRMContact | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<LeadStatus | null>(null);

  const filtered = useMemo(() => {
    let result = [...contacts];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.company && c.company.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q))
      );
    }
    if (filterSource !== 'all') result = result.filter((c) => c.source === filterSource);
    if (filterTags.length > 0) {
      result = result.filter((c) =>
        filterTags.every((tag) => c.tags?.includes(tag))
      );
    }
    return result;
  }, [contacts, searchQuery, filterSource, filterTags]);

  const handleDragStart = (e: React.DragEvent, contact: CRMContact) => {
    setDraggingContact(contact);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', contact.id);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggingContact(null);
    setDragOverStatus(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
  };

  const handleDragOver = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStatus(status);
  };

  const handleDragLeave = () => {
    setDragOverStatus(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: LeadStatus) => {
    e.preventDefault();
    setDragOverStatus(null);
    if (!draggingContact) return;
    if (draggingContact.status === targetStatus) {
      setDraggingContact(null);
      return;
    }
    try {
      await onStatusChange(draggingContact.id, targetStatus);
    } catch (err) {
      console.error('[CRM] Failed to update lead status via drag-and-drop:', err);
    }
    setDraggingContact(null);
  };

  const totalLeads = filtered.length;
  const hotLeads = filtered.filter((c) => c.tags?.includes('quente')).length;
  const avgScore = totalLeads > 0 ? Math.round(filtered.reduce((s, c) => s + (c.scores?.overall ?? c.score), 0) / totalLeads) : 0;
  const wonLeads = filtered.filter((c) => c.status === 'ganho').length;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      {/* KPI strip */}
      <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {[
          { label: 'Total de Leads', value: String(totalLeads), color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10' },
          { label: 'Leads Quentes', value: String(hotLeads), color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10' },
          { label: 'Score Médio', value: String(avgScore), color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
          { label: 'Convertidos', value: String(wonLeads), color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-[#111827] border border-gray-100 dark:border-gray-700/50 rounded-xl shrink-0"
          >
            <span className={cn('text-xl font-display font-bold', kpi.color)}>{kpi.value}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500 font-medium whitespace-nowrap">{kpi.label}</span>
          </motion.div>
        ))}
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-auto pb-4 min-h-0" style={{ scrollbarWidth: 'thin' }}>
        <div className="flex gap-3 min-w-max h-full" onDragEnd={handleDragEnd}>
          {KANBAN_COLUMNS.map((col, ci) => {
            const columnContacts = filtered
              .filter((c) => c.status === col.status)
              .sort((a, b) => (b.scores?.overall ?? b.score) - (a.scores?.overall ?? a.score));
            const isDragOver = dragOverStatus === col.status;

            return (
              <motion.div
                key={col.status}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: ci * 0.05 }}
                className="w-[280px] shrink-0 flex flex-col h-full"
                onDragOver={(e) => handleDragOver(e, col.status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.status)}
              >
                {/* Column header */}
                <div className="flex items-center justify-between mb-2.5 px-1">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: col.color }} />
                    <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{col.label}</h3>
                    <span className="text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                      {columnContacts.length}
                    </span>
                  </div>
                </div>

                {/* Cards area */}
                <div
                  className={cn(
                    'flex-1 space-y-2.5 rounded-xl p-2.5 transition-all duration-200 overflow-y-auto',
                    isDragOver
                      ? 'bg-red-50/50 dark:bg-red-500/[0.06] border-2 border-dashed border-red-400/50 dark:border-red-500/30'
                      : 'bg-gray-50/50 dark:bg-white/[0.015] border-2 border-transparent',
                  )}
                >
                  {columnContacts.map((contact) => (
                    <LeadCard
                      key={contact.id}
                      contact={contact}
                      isSelected={selectedContactId === contact.id}
                      onClick={() => onSelectContact(contact)}
                      onDragStart={(e) => handleDragStart(e, contact)}
                    />
                  ))}

                  {columnContacts.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-300 dark:text-gray-600">
                      <Layers size={22} strokeWidth={1.5} />
                      <p className="text-xs mt-2">Nenhum lead</p>
                      {col.status === 'novo' && (
                        <button onClick={onNewContact} className="mt-2 text-xs font-semibold text-red-500 dark:text-red-400 hover:text-red-600 transition-colors">
                          + Adicionar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
