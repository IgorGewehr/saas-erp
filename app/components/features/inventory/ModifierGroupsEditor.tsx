'use client';

import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import {
  Plus, X, GripVertical, Trash2, ChevronDown, ChevronUp,
  Star, Sparkles, CircleDot, CheckSquare, MinusSquare,
  Sigma, Crown, Divide, Layers, HelpCircle, LayoutTemplate,
  ImagePlus, Loader2, Image as ImageIcon,
} from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import type {
  ProductModifierGroup, ProductModifierOption,
  ModifierSelectionType, ModifierPriceStrategy,
} from '@/lib/types';
import { MODIFIER_TEMPLATES, TEMPLATE_CATEGORIES, type ModifierTemplate } from './modifierTemplates';

function shortId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

interface Props {
  groups: ProductModifierGroup[];
  onChange: (groups: ProductModifierGroup[]) => void;
}

export default function ModifierGroupsEditor({ groups, onChange }: Props) {
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const addGroup = useCallback(() => {
    const next: ProductModifierGroup = {
      id: shortId(),
      name: '',
      required: false,
      minSelections: 0,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      options: [],
      sortOrder: groups.length,
    };
    onChange([...groups, next]);
  }, [groups, onChange]);

  const applyTemplate = useCallback((template: ModifierTemplate) => {
    const groupId = shortId();
    const newGroup: ProductModifierGroup = {
      ...template.group,
      id: groupId,
      sortOrder: groups.length,
      options: template.group.options.map((opt, idx) => ({
        ...opt,
        id: shortId(),
        sortOrder: idx,
      })),
    };
    onChange([...groups, newGroup]);
    setTemplatesOpen(false);
  }, [groups, onChange]);

  const updateGroup = useCallback((id: string, patch: Partial<ProductModifierGroup>) => {
    onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }, [groups, onChange]);

  const removeGroup = useCallback((id: string) => {
    if (!confirm('Remover este grupo de personalização?')) return;
    onChange(groups.filter((g) => g.id !== id));
  }, [groups, onChange]);

  const reorderGroups = useCallback((newOrder: ProductModifierGroup[]) => {
    onChange(newOrder.map((g, idx) => ({ ...g, sortOrder: idx })));
  }, [onChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-red-500" />
            Personalização / Montagem
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Crie grupos como <b>Tamanho</b>, <b>Sabores</b>, <b>Borda</b> ou <b>Adicionais</b>.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTemplatesOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-semibold rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <LayoutTemplate className="w-3.5 h-3.5" />
            Templates
          </button>
          <button
            type="button"
            onClick={addGroup}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Grupo vazio
          </button>
        </div>
      </div>

      {groups.length === 0 ? (
        <button
          type="button"
          onClick={() => setTemplatesOpen(true)}
          className="w-full p-6 rounded-xl bg-gradient-to-br from-red-50/50 to-amber-50/30 dark:from-red-900/10 dark:to-amber-900/5 border border-dashed border-red-200 dark:border-red-800 text-center hover:border-red-300 dark:hover:border-red-700 transition-colors group"
        >
          <div className="w-12 h-12 rounded-2xl bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900/30 flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
            <Sparkles className="w-5 h-5 text-red-500" />
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            Sem personalização
          </p>
          <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
            Comece com um <b className="text-red-600 dark:text-red-400">template pronto</b> ou crie do zero.
          </p>
          <p className="text-[11px] text-gray-400 mt-1.5">
            Produtos sem grupos vão direto pro carrinho.
          </p>
        </button>
      ) : (
        <Reorder.Group axis="y" values={groups} onReorder={reorderGroups} className="space-y-2">
          {groups.map((group) => (
            <Reorder.Item key={group.id} value={group}>
              <GroupCard
                group={group}
                onUpdate={(patch) => updateGroup(group.id, patch)}
                onRemove={() => removeGroup(group.id)}
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>
      )}

      <TemplatePicker
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onPick={applyTemplate}
      />
    </div>
  );
}

// ─── Template Picker ──────────────────────────────────────────────────────

function TemplatePicker({
  open, onClose, onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (template: ModifierTemplate) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<ModifierTemplate['category']>('pizzaria');
  if (!open) return null;

  const filtered = MODIFIER_TEMPLATES.filter(t => t.category === activeCategory);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, y: 20, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.96, y: 20, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-500/20 flex items-center justify-center">
                <LayoutTemplate className="w-4 h-4 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">Templates de Personalização</h2>
                <p className="text-xs text-gray-500">Clique para adicionar ao produto — você pode editar depois</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Category pills */}
          <div className="flex gap-2 px-6 pt-3 pb-2 overflow-x-auto scrollbar-hide border-b border-gray-100 dark:border-gray-800">
            {TEMPLATE_CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                  activeCategory === cat.id
                    ? 'bg-red-500 text-white shadow-sm'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                }`}
              >
                <span className="mr-1">{cat.emoji}</span>
                {cat.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-2">
            {filtered.map(template => (
              <button
                key={template.id}
                onClick={() => onPick(template)}
                className="w-full flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/40 hover:bg-red-50/60 dark:hover:bg-red-900/10 border border-gray-200 dark:border-gray-700 hover:border-red-200 dark:hover:border-red-800 rounded-xl transition-all text-left group"
              >
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-xl flex-shrink-0 group-hover:scale-105 transition-transform">
                  {template.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 dark:text-white">{template.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{template.description}</p>
                  <div className="flex items-center gap-1 flex-wrap mt-1.5">
                    {template.group.options.slice(0, 4).map((opt, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-gray-600 dark:text-gray-400">
                        {opt.name}{opt.additionalPrice > 0 ? ` +R$${opt.additionalPrice}` : ''}
                      </span>
                    ))}
                    {template.group.options.length > 4 && (
                      <span className="text-[10px] text-gray-400">+{template.group.options.length - 4}</span>
                    )}
                  </div>
                </div>
                <div className="self-center text-gray-300 group-hover:text-red-500 transition-colors flex-shrink-0">
                  <Plus className="w-4 h-4" />
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Group Card ────────────────────────────────────────────────────────────

function GroupCard({
  group, onUpdate, onRemove,
}: {
  group: ProductModifierGroup;
  onUpdate: (patch: Partial<ProductModifierGroup>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const addOption = useCallback(() => {
    const opt: ProductModifierOption = {
      id: shortId(),
      name: '',
      additionalPrice: 0,
      available: true,
      sortOrder: group.options.length,
    };
    onUpdate({ options: [...group.options, opt] });
  }, [group.options, onUpdate]);

  const updateOption = useCallback((id: string, patch: Partial<ProductModifierOption>) => {
    onUpdate({ options: group.options.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  }, [group.options, onUpdate]);

  const removeOption = useCallback((id: string) => {
    onUpdate({ options: group.options.filter((o) => o.id !== id) });
  }, [group.options, onUpdate]);

  const reorderOptions = useCallback((newOrder: ProductModifierOption[]) => {
    onUpdate({ options: newOrder.map((o, idx) => ({ ...o, sortOrder: idx })) });
  }, [onUpdate]);

  const handleSelectionTypeChange = (type: ModifierSelectionType) => {
    if (type === 'single') {
      onUpdate({ selectionType: 'single', maxSelections: 1, minSelections: Math.min(group.minSelections, 1) });
    } else {
      onUpdate({ selectionType: type, maxSelections: Math.max(group.maxSelections, 2) });
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <div className="cursor-grab active:cursor-grabbing p-1 text-gray-300 hover:text-gray-500">
          <GripVertical className="w-4 h-4" />
        </div>
        <input
          value={group.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Nome do grupo (ex: Tamanho, Sabores, Borda...)"
          className="flex-1 px-2.5 py-1.5 bg-transparent border-none outline-none text-sm font-semibold text-gray-900 dark:text-white placeholder-gray-400 focus:bg-gray-50 dark:focus:bg-gray-700/50 rounded-md"
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs font-medium text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-md">
            {group.options.length} {group.options.length === 1 ? 'opção' : 'opções'}
          </span>
          <button type="button" onClick={() => setExpanded(!expanded)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button type="button" onClick={onRemove} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
            <Trash2 className="w-4 h-4 text-red-500" />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3 border-t border-gray-100 dark:border-gray-700 pt-3">
              {/* Selection type — plain language */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                    Como o cliente escolhe?
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  {([
                    { val: 'single', label: 'Escolhe 1', icon: CircleDot, hint: 'Ex: Tamanho da pizza (P/M/G) — cliente marca só uma' },
                    { val: 'multiple', label: 'Pode marcar várias', icon: CheckSquare, hint: 'Ex: Sabores da pizza (até 3) — marca quantas quiser dentro do limite' },
                    { val: 'quantity', label: '+/- quantidade', icon: MinusSquare, hint: 'Ex: Bacon (pode pedir 2x, 3x) — cada extra tem um contador' },
                  ] as const).map((opt) => {
                    const Icon = opt.icon;
                    const active = group.selectionType === opt.val;
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => handleSelectionTypeChange(opt.val)}
                        title={opt.hint}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border-2 transition-all text-left ${
                          active
                            ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-red-500' : 'text-gray-400'}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-bold ${active ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}>
                            {opt.label}
                          </p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight mt-0.5 truncate">
                            {opt.val === 'single' ? 'radio' : opt.val === 'multiple' ? 'checkbox' : 'contador'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Required + Min/Max */}
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <button
                    type="button"
                    onClick={() => onUpdate({
                      required: !group.required,
                      minSelections: !group.required ? Math.max(1, group.minSelections) : 0,
                    })}
                    className={`w-9 h-5 rounded-full transition-colors relative ${group.required ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${group.required ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Obrigatório</span>
                </label>
                {group.selectionType !== 'single' && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="font-medium">Mín</span>
                    <input
                      type="number"
                      min={0}
                      max={group.maxSelections}
                      value={group.minSelections}
                      onChange={(e) => onUpdate({ minSelections: Math.max(0, Math.min(group.maxSelections, parseInt(e.target.value) || 0)) })}
                      className="w-12 px-1.5 py-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md text-xs text-center text-gray-900 dark:text-white"
                    />
                    <span className="font-medium">Máx</span>
                    <input
                      type="number"
                      min={Math.max(1, group.minSelections)}
                      value={group.maxSelections}
                      onChange={(e) => onUpdate({ maxSelections: Math.max(group.minSelections || 1, parseInt(e.target.value) || 1) })}
                      className="w-12 px-1.5 py-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md text-xs text-center text-gray-900 dark:text-white"
                    />
                  </div>
                )}
              </div>

              {/* Price strategy (only shown when multi-selection) */}
              {group.selectionType !== 'single' && (
                <div className="p-2.5 rounded-lg bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
                      <HelpCircle className="w-3 h-3" />
                      Quando marcam várias, como cobrar?
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    {([
                      { val: 'sum', label: 'Somar tudo', icon: Sigma, hint: 'Ex: Adicionais de hambúrguer (bacon + queijo + ovo = somam)' },
                      { val: 'max', label: 'Maior preço', icon: Crown, hint: 'Ex: Pizza com 2 sabores — paga o sabor mais caro' },
                      { val: 'avg', label: 'Preço médio', icon: Divide, hint: 'Média dos itens selecionados' },
                    ] as const).map((opt) => {
                      const Icon = opt.icon;
                      const active = group.priceStrategy === opt.val;
                      return (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => onUpdate({ priceStrategy: opt.val as ModifierPriceStrategy })}
                          title={opt.hint}
                          className={`flex items-center gap-1.5 p-2 rounded-lg border-2 transition-all text-left ${
                            active
                              ? 'border-amber-500 bg-white dark:bg-gray-800'
                              : 'border-transparent bg-white/50 dark:bg-gray-800/40 hover:border-amber-300'
                          }`}
                        >
                          <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-bold ${active ? 'text-amber-800 dark:text-amber-300' : 'text-gray-700 dark:text-gray-300'}`}>
                              {opt.label}
                            </p>
                            <p className="text-[9px] text-gray-500 dark:text-gray-400 leading-tight truncate">
                              {opt.hint.split('—')[0].replace('Ex:', '').trim()}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Options list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Opções disponíveis</p>
                  <button
                    type="button"
                    onClick={addOption}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Adicionar opção
                  </button>
                </div>

                {group.options.length === 0 ? (
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/30 text-center">
                    <p className="text-[11px] text-gray-400">Nenhuma opção cadastrada.</p>
                  </div>
                ) : (
                  <Reorder.Group axis="y" values={group.options} onReorder={reorderOptions} className="space-y-1.5">
                    {group.options.map((opt) => (
                      <Reorder.Item key={opt.id} value={opt}>
                        <OptionRow
                          option={opt}
                          onUpdate={(patch) => updateOption(opt.id, patch)}
                          onRemove={() => removeOption(opt.id)}
                        />
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Option Row ────────────────────────────────────────────────────────────

function OptionRow({
  option, onUpdate, onRemove,
}: {
  option: ProductModifierOption;
  onUpdate: (patch: Partial<ProductModifierOption>) => void;
  onRemove: () => void;
}) {
  const { business } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleImageUpload(file: File) {
    if (!business?.id) return;
    if (file.size > 3 * 1024 * 1024) {
      alert('Imagem muito grande (máx 3MB)');
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const storageRef = ref(storage, `products/${business.id}/modifiers/${option.id}_${Date.now()}.${ext}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      onUpdate({ imageUrl: url });
    } catch (err) {
      console.error('[ModifierImage] Upload error:', err);
      alert('Falha ao enviar imagem');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
      option.available
        ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
        : 'bg-gray-50 dark:bg-gray-800/40 border-gray-100 dark:border-gray-700 opacity-50'
    }`}>
      <div className="cursor-grab active:cursor-grabbing p-0.5 text-gray-300 hover:text-gray-500">
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      {/* Image */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        title={option.imageUrl ? 'Clique para trocar' : 'Adicionar imagem'}
        className={`relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 border transition-all ${
          option.imageUrl
            ? 'border-gray-200 dark:border-gray-600'
            : 'border-dashed border-gray-300 dark:border-gray-600 hover:border-red-300 dark:hover:border-red-700 bg-gray-50 dark:bg-gray-700/30'
        }`}
      >
        {uploading ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
          </div>
        ) : option.imageUrl ? (
          <>
            <img src={option.imageUrl} alt={option.name} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
              <ImagePlus className="w-4 h-4 text-white" />
            </div>
          </>
        ) : (
          <ImagePlus className="w-4 h-4 text-gray-400 m-auto" />
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageUpload(file);
          e.target.value = '';
        }}
      />

      <input
        value={option.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
        placeholder="Nome da opção"
        className="flex-1 min-w-0 px-2 py-1 bg-transparent border-none outline-none text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:bg-gray-50 dark:focus:bg-gray-700/50 rounded-md"
      />
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-[10px] text-gray-400 font-semibold">+R$</span>
        <input
          type="number"
          min={0}
          step={0.5}
          value={option.additionalPrice}
          onChange={(e) => onUpdate({ additionalPrice: parseFloat(e.target.value) || 0 })}
          className="w-16 px-1.5 py-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md text-xs text-right text-gray-900 dark:text-white"
        />
      </div>
      <button
        type="button"
        onClick={() => onUpdate({ isDefault: !option.isDefault })}
        title={option.isDefault ? 'Remover como padrão' : 'Marcar como padrão (pré-selecionado)'}
        className={`p-1.5 rounded-md transition-colors ${
          option.isDefault
            ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400'
            : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        <Star className="w-3.5 h-3.5" fill={option.isDefault ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        onClick={() => onUpdate({ available: !option.available })}
        title={option.available ? 'Disponível' : 'Indisponível'}
        className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
          option.available
            ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-400'
        }`}
      >
        {option.available ? 'ON' : 'OFF'}
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
      >
        <X className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" />
      </button>
    </div>
  );
}
