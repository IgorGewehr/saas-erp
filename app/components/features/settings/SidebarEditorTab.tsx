'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  RotateCcw,
  Check,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Users,
  Target,
  Calendar,
  MessageSquare,
  StickyNote,
  ShoppingCart,
  ClipboardList,
  ShoppingBag,
  DollarSign,
  Package,
  FileCheck2,
  Receipt,
  FileText,
  Settings,
  Kanban,
  BarChart3,
  ClipboardCheck,
  UtensilsCrossed,
  KeyRound,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type { SidebarPrefs, SidebarSectionPref } from '@/lib/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const PROTECTED_ITEMS = new Set(['Dashboard', 'Configurações']);

const DEFAULT_SECTIONS: SidebarSectionPref[] = [
  { key: 'principal', title: 'Principal', isCollapsed: false, items: ['Dashboard', 'Clientes', 'CRM', 'Agenda', 'Conversas', 'Notas', 'PDV'] },
  { key: 'gestao',    title: 'Gestão',    isCollapsed: false, items: ['Pedidos', 'Cardápio', 'Vendas', 'Kanban', 'Financeiro', 'Relatórios', 'Estoque', 'Compras', 'Senhas'] },
  { key: 'fiscal',    title: 'Fiscal',    isCollapsed: false, items: ['NFSe', 'NFCe', 'NFe'] },
  { key: 'sistema',   title: 'Sistema',   isCollapsed: false, items: ['Configurações'] },
];

const ITEM_ICONS: Record<string, React.ElementType> = {
  Dashboard: LayoutDashboard, Clientes: Users, CRM: Target, Agenda: Calendar,
  Conversas: MessageSquare, Notas: StickyNote, PDV: ShoppingCart,
  Vendas: ClipboardList, Compras: ShoppingBag, Financeiro: DollarSign,
  Estoque: Package, NFSe: FileCheck2, NFCe: Receipt, NFe: FileText,
  Configurações: Settings, Kanban: Kanban, Relatórios: BarChart3,
  Pedidos: ClipboardCheck, Cardápio: UtensilsCrossed, Senhas: KeyRound,
};

const ITEM_LABELS: Record<string, string> = {
  Dashboard: 'Dashboard', Clientes: 'Clientes', CRM: 'CRM', Agenda: 'Agenda',
  Conversas: 'Conversas', Notas: 'Notas', PDV: 'Ponto de Venda',
  Vendas: 'Vendas', Compras: 'Compras', Financeiro: 'Financeiro',
  Estoque: 'Estoque', NFSe: 'NFS-e', NFCe: 'NFC-e', NFe: 'NF-e',
  Configurações: 'Configurações', Kanban: 'Kanban', Relatórios: 'Relatórios',
  Pedidos: 'Pedidos', Cardápio: 'Cardápio', Senhas: 'Senhas',
};

// ─── Drag ID helpers ──────────────────────────────────────────────────────────

function sectionDragId(key: string) { return `section::${key}`; }
function itemDragId(sectionKey: string, itemId: string) { return `item::${sectionKey}::${itemId}`; }
function parseDragId(id: string): { type: 'section' | 'item'; sectionKey: string; itemId?: string } | null {
  if (id.startsWith('section::')) return { type: 'section', sectionKey: id.slice(9) };
  if (id.startsWith('item::')) {
    const [, sectionKey, itemId] = id.split('::');
    return { type: 'item', sectionKey, itemId };
  }
  return null;
}

// ─── Sortable Item Component ─────────────────────────────────────────────────

function SortableItem({
  sectionKey, itemId, isHidden, onToggleHidden, overlay,
}: {
  sectionKey: string;
  itemId: string;
  isHidden?: boolean;
  onToggleHidden?: (id: string) => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: itemDragId(sectionKey, itemId),
  });

  const Icon = ITEM_ICONS[itemId] ?? FileText;
  const label = ITEM_LABELS[itemId] ?? itemId;
  const isProtected = PROTECTED_ITEMS.has(itemId);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-all',
        isDragging && !overlay ? 'opacity-30' : 'opacity-100',
        overlay ? 'bg-white dark:bg-gray-800 shadow-lg border-slate-200 dark:border-gray-600' : 'bg-slate-50 dark:bg-gray-800/50 border-transparent hover:border-slate-200 dark:hover:border-gray-700',
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="p-0.5 text-slate-300 dark:text-gray-600 hover:text-slate-500 dark:hover:text-gray-400 cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical size={14} />
      </button>

      {/* Icon + label */}
      <Icon size={14} className="text-slate-400 dark:text-gray-500 shrink-0" />
      <span className={cn('text-sm flex-1', isHidden ? 'text-slate-400 dark:text-gray-500 line-through' : 'text-slate-700 dark:text-gray-300')}>
        {label}
      </span>

      {/* Protected badge */}
      {isProtected && (
        <span className="text-[9px] font-bold text-slate-400 dark:text-gray-600 uppercase tracking-widest">fixo</span>
      )}

      {/* Hide/show */}
      {!isProtected && onToggleHidden && (
        <button
          onClick={() => onToggleHidden(itemId)}
          className={cn('p-1 rounded transition-colors', isHidden ? 'text-slate-400 hover:text-emerald-500' : 'text-slate-400 hover:text-slate-600 dark:hover:text-gray-300')}
          title={isHidden ? 'Mostrar item' : 'Ocultar item'}
        >
          {isHidden ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      )}
    </div>
  );
}

// ─── Sortable Section Component ───────────────────────────────────────────────

function SortableSection({
  section, hiddenItems, onToggleHidden, onRename, onDelete, onToggleCollapse, overlay,
}: {
  section: SidebarSectionPref;
  hiddenItems: Set<string>;
  onToggleHidden: (id: string) => void;
  onRename: (key: string, newTitle: string) => void;
  onDelete: (key: string) => void;
  onToggleCollapse: (key: string) => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sectionDragId(section.key),
  });
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(section.title);

  const isBuiltIn = ['principal', 'gestao', 'fiscal', 'sistema'].includes(section.key);
  const itemIds = section.items.map(id => itemDragId(section.key, id));

  const commitRename = () => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== section.title) onRename(section.key, trimmed);
    else setTitleValue(section.title);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-xl border transition-all',
        isDragging && !overlay ? 'opacity-30' : '',
        overlay ? 'bg-white dark:bg-gray-900 shadow-2xl border-slate-300 dark:border-gray-600' : 'bg-white dark:bg-gray-900 border-slate-200 dark:border-gray-800',
      )}
    >
      {/* Section header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Section drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="p-0.5 text-slate-300 dark:text-gray-600 hover:text-slate-500 cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical size={15} />
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => onToggleCollapse(section.key)}
          className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-gray-300 transition-colors"
          title={section.isCollapsed ? 'Expandir seção' : 'Recolher seção'}
        >
          {section.isCollapsed
            ? <ChevronRight size={14} className="text-slate-400" />
            : <ChevronDown size={14} className="text-slate-400" />}
        </button>

        {/* Title */}
        {editingTitle ? (
          <input
            autoFocus
            value={titleValue}
            onChange={e => setTitleValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setEditingTitle(false); setTitleValue(section.title); } }}
            className="flex-1 text-xs font-bold uppercase tracking-widest bg-transparent border-b border-red-400 outline-none text-red-500"
          />
        ) : (
          <button
            onClick={() => !isBuiltIn && setEditingTitle(true)}
            className={cn('flex-1 text-left text-xs font-bold uppercase tracking-widest text-red-500 dark:text-red-400', !isBuiltIn && 'hover:opacity-70 transition-opacity cursor-text')}
            title={isBuiltIn ? undefined : 'Clique para renomear'}
          >
            {section.title}
          </button>
        )}

        {/* Item count */}
        <span className="text-[10px] text-slate-400 dark:text-gray-600 font-medium">{section.items.length}</span>

        {/* Delete (custom sections only) */}
        {!isBuiltIn && (
          <button
            onClick={() => onDelete(section.key)}
            className="p-1 text-slate-300 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded"
            title="Excluir seção"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Items */}
      <AnimatePresence initial={false}>
        {!section.isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1">
              <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
                {section.items.map(itemId => (
                  <SortableItem
                    key={itemId}
                    sectionKey={section.key}
                    itemId={itemId}
                    isHidden={hiddenItems.has(itemId)}
                    onToggleHidden={onToggleHidden}
                    overlay={overlay}
                  />
                ))}
              </SortableContext>
              {section.items.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-gray-600 italic text-center py-2">
                  Seção vazia — arraste itens para cá
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main SidebarEditorTab ────────────────────────────────────────────────────

export default function SidebarEditorTab() {
  const { user, updateUserProfile } = useAuth();
  const [sections, setSections] = useState<SidebarSectionPref[]>(() =>
    user?.sidebarPrefs?.sections?.length ? user.sidebarPrefs.sections : DEFAULT_SECTIONS
  );
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(() =>
    new Set(user?.sidebarPrefs?.hiddenItems ?? [])
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Reset local state when user prefs change externally
  useEffect(() => {
    if (user?.sidebarPrefs?.sections?.length) {
      setSections(user.sidebarPrefs.sections);
      setHiddenItems(new Set(user.sidebarPrefs.hiddenItems ?? []));
    }
  }, [user?.uid]); // only on user change, not on every update

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeInfo = parseDragId(String(active.id));
    const overInfo = parseDragId(String(over.id));
    if (!activeInfo || !overInfo) return;
    if (activeInfo.type !== 'item') return; // section moves handled in dragEnd

    const fromKey = activeInfo.sectionKey;
    const toKey = overInfo.sectionKey;
    if (fromKey === toKey) return; // same section — handled by sortable

    // Moving item between sections
    const itemId = activeInfo.itemId!;
    setSections(prev => {
      const next = prev.map(s => ({ ...s, items: [...s.items] }));
      const from = next.find(s => s.key === fromKey);
      const to = next.find(s => s.key === toKey);
      if (!from || !to) return prev;
      from.items = from.items.filter(id => id !== itemId);
      // Insert at the position of the over item, or at end if over is the section itself
      const overItemId = overInfo.itemId;
      const insertIdx = overItemId ? to.items.indexOf(overItemId) : to.items.length;
      to.items.splice(insertIdx < 0 ? to.items.length : insertIdx, 0, itemId);
      return next;
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const activeInfo = parseDragId(String(active.id));
    const overInfo = parseDragId(String(over.id));
    if (!activeInfo || !overInfo) return;

    if (activeInfo.type === 'section' && overInfo.type === 'section') {
      // Reorder sections
      setSections(prev => {
        const oldIdx = prev.findIndex(s => s.key === activeInfo.sectionKey);
        const newIdx = prev.findIndex(s => s.key === overInfo.sectionKey);
        return oldIdx === newIdx ? prev : arrayMove(prev, oldIdx, newIdx);
      });
    } else if (activeInfo.type === 'item' && activeInfo.sectionKey === overInfo.sectionKey) {
      // Reorder within same section
      const sectionKey = activeInfo.sectionKey;
      setSections(prev => prev.map(s => {
        if (s.key !== sectionKey) return s;
        const oldIdx = s.items.indexOf(activeInfo.itemId!);
        const newIdx = s.items.indexOf(overInfo.itemId!);
        return oldIdx === newIdx ? s : { ...s, items: arrayMove(s.items, oldIdx, newIdx) };
      }));
    }
    // Cross-section moves already handled in dragOver
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  const toggleHidden = (itemId: string) => {
    if (PROTECTED_ITEMS.has(itemId)) return;
    setHiddenItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const renameSection = (key: string, newTitle: string) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, title: newTitle } : s));
  };

  const deleteSection = (key: string) => {
    setSections(prev => {
      const target = prev.find(s => s.key === key);
      if (!target) return prev;
      // Move items to first built-in section
      const orphans = target.items;
      return prev
        .filter(s => s.key !== key)
        .map((s, i) => i === 0 ? { ...s, items: [...s.items, ...orphans] } : s);
    });
  };

  const toggleCollapse = (key: string) => {
    setSections(prev => prev.map(s => s.key === key ? { ...s, isCollapsed: !s.isCollapsed } : s));
  };

  const addSection = () => {
    const newKey = `custom_${Date.now()}`;
    setSections(prev => [...prev, { key: newKey, title: 'Nova Seção', isCollapsed: false, items: [] }]);
  };

  const resetToDefault = () => {
    setSections(DEFAULT_SECTIONS);
    setHiddenItems(new Set());
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const prefs: SidebarPrefs = {
        sections: sections.map(s => ({ ...s, items: [...s.items] })),
        hiddenItems: [...hiddenItems],
      };
      await updateUserProfile({ sidebarPrefs: prefs } as Parameters<typeof updateUserProfile>[0]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error('[sidebar-editor] save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  // Active drag overlay rendering
  const activeInfo = activeId ? parseDragId(activeId) : null;
  const activeSectionData = activeInfo?.type === 'section'
    ? sections.find(s => s.key === activeInfo.sectionKey)
    : null;
  const activeItemSectionKey = activeInfo?.type === 'item' ? activeInfo.sectionKey : null;
  const activeItemId = activeInfo?.type === 'item' ? activeInfo.itemId : null;

  const sectionIds = sections.map(s => sectionDragId(s.key));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="text-base font-bold text-slate-900 dark:text-gray-100 font-display">Personalizar Sidebar</h3>
        <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">
          Arraste seções e itens para reorganizar. Use o olho para ocultar itens que não usa.
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {sections.map(section => (
              <SortableSection
                key={section.key}
                section={section}
                hiddenItems={hiddenItems}
                onToggleHidden={toggleHidden}
                onRename={renameSection}
                onDelete={deleteSection}
                onToggleCollapse={toggleCollapse}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }) }}>
          {activeSectionData && (
            <SortableSection
              section={activeSectionData}
              hiddenItems={hiddenItems}
              onToggleHidden={() => {}}
              onRename={() => {}}
              onDelete={() => {}}
              onToggleCollapse={() => {}}
              overlay
            />
          )}
          {activeItemId && activeItemSectionKey && (
            <SortableItem sectionKey={activeItemSectionKey} itemId={activeItemId} overlay />
          )}
        </DragOverlay>
      </DndContext>

      {/* Ocultos */}
      {hiddenItems.size > 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-gray-700 p-4">
          <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Itens ocultos — clique no olho para restaurar
          </p>
          <div className="flex flex-wrap gap-2">
            {[...hiddenItems].map(itemId => {
              const Icon = ITEM_ICONS[itemId] ?? FileText;
              return (
                <button
                  key={itemId}
                  onClick={() => toggleHidden(itemId)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-500 dark:text-gray-400 text-xs font-medium transition-colors"
                >
                  <Eye size={12} />
                  <Icon size={12} />
                  {ITEM_LABELS[itemId] ?? itemId}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <button
            onClick={addSection}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 text-sm text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Plus size={14} />
            Adicionar seção
          </button>
          <button
            onClick={resetToDefault}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-400 dark:text-gray-500 hover:text-slate-600 dark:hover:text-gray-300 transition-colors"
          >
            <RotateCcw size={13} />
            Restaurar padrão
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            'flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all',
            saved
              ? 'bg-emerald-500 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-200',
            saving && 'opacity-70',
          )}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saved ? 'Salvo!' : saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>

      <p className="text-xs text-slate-400 dark:text-gray-500">
        As alterações se aplicam apenas à sua conta. Itens marcados como "fixo" não podem ser ocultados.
      </p>
    </div>
  );
}
