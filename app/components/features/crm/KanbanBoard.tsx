'use client';

import { useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { getWonStageId } from './shared';
import { LeadCard } from './LeadCard';
import type { CRMContact, CRMStageConfig, LeadStatus, LeadSource } from '@/lib/types';

export function KanbanBoard({ contacts, stages, onSelectContact, selectedContactId, onStatusChange, onNewContact, searchQuery, filterTags, filterSource, filterTipo, selectionMode, selectedIds, onToggleSelectId, onSelectAllInStage }: {
  contacts: CRMContact[];
  stages: CRMStageConfig[];
  onSelectContact: (c: CRMContact) => void;
  selectedContactId: string | null;
  onStatusChange: (contactId: string, newStatus: LeadStatus) => Promise<void>;
  onNewContact: () => void;
  searchQuery: string;
  filterTags: string[];
  filterSource: LeadSource | 'all';
  filterTipo: 'pf' | 'pj' | 'all';
  /** Quando true, cards mostram checkbox e clique alterna seleção em vez de
   *  abrir o painel de detalhe. Drag-and-drop é desabilitado nessa fase. */
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelectId?: (id: string) => void;
  /** Click no header da coluna em selectionMode → marca/desmarca todos os
   *  cards visíveis daquele stage (respeita filtros aplicados). */
  onSelectAllInStage?: (stageId: LeadStatus, ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const draggingRef = useRef<CRMContact | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
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
    if (filterTipo !== 'all') {
      // Contatos legados sem campo `tipo` são tratados como PF (default histórico
      // pré-Fase 4 — quando o CRM criava sempre com tipo='pf' hardcoded).
      result = result.filter((c) => (c.tipo ?? 'pf') === filterTipo);
    }
    if (filterTags.length > 0) {
      result = result.filter((c) => filterTags.every((tag) => c.tags?.includes(tag)));
    }
    return result;
  }, [contacts, searchQuery, filterSource, filterTipo, filterTags]);

  const handleDragStart = (e: React.DragEvent, contact: CRMContact) => {
    draggingRef.current = contact;
    setDraggingId(contact.id);
    e.dataTransfer.effectAllowed = 'move';
    // Required for Safari to recognise the drag gesture
    e.dataTransfer.setData('text/plain', contact.id);
  };

  const handleDragEnd = () => {
    draggingRef.current = null;
    setDraggingId(null);
    setDragOverStatus(null);
  };

  const handleDragEnter = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault();
    setDragOverStatus(status);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only reset when the cursor truly leaves the column (not just moving to a child)
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as HTMLElement).contains(related)) return;
    setDragOverStatus(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: LeadStatus) => {
    e.preventDefault();
    setDragOverStatus(null);
    const contact = draggingRef.current;
    draggingRef.current = null;
    setDraggingId(null);
    if (!contact || contact.status === targetStatus) return;
    try {
      await onStatusChange(contact.id, targetStatus);
    } catch (err) {
      console.error('[CRM] Drag-drop status update failed:', err);
    }
  };

  const totalLeads = filtered.length;
  const hotLeads = filtered.filter((c) => c.tags?.includes('quente')).length;
  const avgScore = totalLeads > 0
    ? Math.round(filtered.reduce((s, c) => s + (c.scores?.overall ?? c.score ?? 0), 0) / totalLeads)
    : 0;
  const wonStageId = getWonStageId(stages);
  const wonLeads = filtered.filter((c) => c.status === wonStageId).length;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      {/* KPI strip */}
      <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {[
          { label: t('crm.kanban.totalLeads', 'Total de Leads'), value: String(totalLeads), color: 'text-blue-600 dark:text-blue-400' },
          { label: t('crm.kanban.hotLeads', 'Leads Quentes'), value: String(hotLeads), color: 'text-orange-600 dark:text-orange-400' },
          { label: t('crm.kanban.avgScore', 'Score Médio'), value: String(avgScore), color: 'text-amber-600 dark:text-amber-400' },
          { label: t('crm.kanban.converted', 'Convertidos'), value: String(wonLeads), color: 'text-emerald-600 dark:text-emerald-400' },
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
      <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4 min-h-0" style={{ scrollbarWidth: 'thin' }}>
        <div className="flex gap-3 min-w-max h-full">
          {stages.map((stage, ci) => {
            const columnContacts = filtered
              .filter((c) => c.status === stage.id)
              .sort((a, b) => (b.scores?.overall ?? b.score) - (a.scores?.overall ?? a.score));
            const isDragOver = dragOverStatus === stage.id;

            return (
              <motion.div
                key={stage.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: ci * 0.05 }}
                className="w-[280px] shrink-0 flex flex-col h-full"
              >
                {/* Column header */}
                <div className="flex items-center justify-between mb-2.5 px-1">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stage.color }} />
                    <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">{stage.name}</h3>
                    <span className="text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                      {columnContacts.length}
                    </span>
                  </div>
                  {/* Shortcut em selectionMode: seleciona/limpa todos os cards
                      visíveis desse estágio. Útil pra "limpar coluna inteira". */}
                  {selectionMode && columnContacts.length > 0 && onSelectAllInStage && (
                    <button
                      onClick={() => onSelectAllInStage(stage.id, columnContacts.map(c => c.id))}
                      className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {columnContacts.every(c => selectedIds?.has(c.id)) ? 'Limpar' : 'Tudo'}
                    </button>
                  )}
                </div>

                {/* Drop zone */}
                <div
                  className={cn(
                    'flex-1 space-y-2.5 rounded-xl p-2.5 transition-colors duration-150 overflow-y-auto min-h-[120px]',
                    isDragOver
                      ? 'bg-red-50/50 dark:bg-red-500/[0.06] border-2 border-dashed border-red-400/50 dark:border-red-500/30'
                      : 'bg-gray-50/50 dark:bg-white/[0.015] border-2 border-transparent',
                  )}
                  onDragEnter={(e) => handleDragEnter(e, stage.id)}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, stage.id)}
                >
                  {columnContacts.map((contact) => (
                    <LeadCard
                      key={contact.id}
                      contact={contact}
                      isSelected={selectedContactId === contact.id}
                      isDragging={draggingId === contact.id}
                      selectionMode={selectionMode}
                      isChecked={selectedIds?.has(contact.id) ?? false}
                      // Em modo seleção, clique alterna o checkbox. Senão,
                      // abre o painel de detalhe (comportamento original).
                      onClick={() =>
                        selectionMode && onToggleSelectId
                          ? onToggleSelectId(contact.id)
                          : onSelectContact(contact)
                      }
                      onDragStart={(e) => handleDragStart(e, contact)}
                      onDragEnd={handleDragEnd}
                    />
                  ))}

                  {columnContacts.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-28 text-gray-300 dark:text-gray-600">
                      <Layers size={22} strokeWidth={1.5} />
                      <p className="text-xs mt-2">{t('crm.kanban.noLeads', 'Nenhum lead')}</p>
                      {stage.order === 0 && (
                        <button
                          onClick={onNewContact}
                          className="mt-2 text-xs font-semibold text-red-500 dark:text-red-400 hover:text-red-600 transition-colors"
                        >
                          + {t('crm.kanban.add', 'Adicionar')}
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
