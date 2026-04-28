'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Plus, Minus, Check, AlertCircle, Package,
  Sparkles, ChevronDown, Info,
} from 'lucide-react';
import type {
  Product, ProductModifierGroup, ProductModifierOption,
  SelectedModifier, SelectedModifierOption,
} from '@/lib/types';
import type { CartItem } from './CatalogClient';

function formatBRL(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function shortId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

interface Props {
  product: Product;
  initialCartItem: CartItem | null;
  onClose: () => void;
  onAdd: (cartItem: CartItem) => void;
}

// Selection state: map groupId → optionId → quantity
type SelectionState = Record<string, Record<string, number>>;

function buildInitialSelection(product: Product, initial: CartItem | null): SelectionState {
  const state: SelectionState = {};
  const groups = product.modifierGroups || [];

  for (const group of groups) {
    state[group.id] = {};
    // If editing, restore previous selection
    if (initial?.selectedModifiers) {
      const existing = initial.selectedModifiers.find(m => m.groupId === group.id);
      if (existing) {
        existing.selectedOptions.forEach(o => {
          state[group.id][o.optionId] = o.quantity;
        });
        continue;
      }
    }
    // Otherwise, pre-select default options
    group.options.forEach(opt => {
      if (opt.isDefault && opt.available) {
        state[group.id][opt.id] = 1;
      }
    });
  }
  return state;
}

function calculateGroupPrice(group: ProductModifierGroup, picked: Record<string, number>): number {
  const entries = Object.entries(picked).filter(([, qty]) => qty > 0);
  if (entries.length === 0) return 0;

  const prices: number[] = [];
  for (const [optId, qty] of entries) {
    const opt = group.options.find(o => o.id === optId);
    if (!opt) continue;
    for (let i = 0; i < qty; i++) prices.push(opt.additionalPrice);
  }

  if (prices.length === 0) return 0;
  switch (group.priceStrategy) {
    case 'max': return Math.max(...prices);
    case 'avg': return prices.reduce((a, b) => a + b, 0) / prices.length;
    case 'sum':
    default:    return prices.reduce((a, b) => a + b, 0);
  }
}

function countSelections(picked: Record<string, number>): number {
  return Object.values(picked).reduce((s, n) => s + n, 0);
}

export default function ProductDetailSheet({ product, initialCartItem, onClose, onAdd }: Props) {
  const [selection, setSelection] = useState<SelectionState>(() => buildInitialSelection(product, initialCartItem));
  const [quantity, setQuantity] = useState(initialCartItem?.quantity || 1);
  const [notes, setNotes] = useState(initialCartItem?.notes || '');
  const [triedSubmit, setTriedSubmit] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() =>
    (product.modifierGroups || []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
  [product.modifierGroups]);

  // ── Auto-scroll to next incomplete group ──────────────────────────────────
  const scrollToNextIncomplete = useCallback((afterGroupId: string, currentSelection: SelectionState) => {
    // Find the next group (after the one just modified) that is required and incomplete
    const idx = groups.findIndex(g => g.id === afterGroupId);
    if (idx < 0) return;
    for (let i = idx + 1; i < groups.length; i++) {
      const g = groups[i];
      const count = countSelections(currentSelection[g.id] || {});
      const min = g.minSelections || (g.required ? 1 : 0);
      if (count < min) {
        // This one still needs attention — scroll to it
        requestAnimationFrame(() => {
          const el = document.getElementById(`group-${g.id}`);
          const container = scrollContainerRef.current;
          if (!el || !container) return;
          const elTop = el.getBoundingClientRect().top;
          const containerTop = container.getBoundingClientRect().top;
          const delta = elTop - containerTop - 12; // small offset above
          container.scrollBy({ top: delta, behavior: 'smooth' });
        });
        return;
      }
    }
  }, [groups]);

  // Validate each group
  const groupValidation = useMemo(() => {
    const result: Record<string, { valid: boolean; count: number; message?: string }> = {};
    for (const group of groups) {
      const count = countSelections(selection[group.id] || {});
      const min = group.minSelections || (group.required ? 1 : 0);
      const max = group.maxSelections || 99;
      if (count < min) {
        result[group.id] = {
          valid: false,
          count,
          message: min === 1 ? 'Escolha uma opção' : `Escolha ${min} opções`,
        };
      } else if (count > max) {
        result[group.id] = { valid: false, count, message: `Máximo ${max} opções` };
      } else {
        result[group.id] = { valid: true, count };
      }
    }
    return result;
  }, [groups, selection]);

  const allValid = useMemo(
    () => Object.values(groupValidation).every(v => v.valid),
    [groupValidation],
  );

  const firstInvalidGroup = useMemo(
    () => groups.find(g => !groupValidation[g.id]?.valid),
    [groups, groupValidation],
  );

  // Calculate unit price
  const unitPrice = useMemo(() => {
    let total = product.salePrice;
    for (const group of groups) {
      total += calculateGroupPrice(group, selection[group.id] || {});
    }
    return total;
  }, [groups, selection, product.salePrice]);

  // ── Selection handlers ──────────────────────────────────────────────────────
  const toggleSingle = useCallback((groupId: string, optionId: string) => {
    setSelection(prev => {
      const next = { ...prev, [groupId]: { [optionId]: 1 } };
      // Auto-scroll: single-selection group now has 1 option — it's complete
      scrollToNextIncomplete(groupId, next);
      return next;
    });
  }, [scrollToNextIncomplete]);

  const toggleMultiple = useCallback((group: ProductModifierGroup, optionId: string) => {
    setSelection(prev => {
      const current = { ...(prev[group.id] || {}) };
      if (current[optionId]) {
        delete current[optionId];
      } else {
        const count = countSelections(current);
        if (count >= group.maxSelections) return prev;
        current[optionId] = 1;
      }
      const next = { ...prev, [group.id]: current };
      // Auto-scroll only when the group just reached its maximum (likely done)
      const newCount = countSelections(current);
      if (newCount === group.maxSelections) {
        scrollToNextIncomplete(group.id, next);
      }
      return next;
    });
  }, [scrollToNextIncomplete]);

  const changeQuantity = useCallback((group: ProductModifierGroup, optionId: string, delta: number) => {
    setSelection(prev => {
      const current = { ...(prev[group.id] || {}) };
      const option = group.options.find(o => o.id === optionId);
      const currentQty = current[optionId] || 0;
      const newQty = currentQty + delta;

      if (newQty <= 0) {
        delete current[optionId];
      } else {
        const maxForOption = option?.maxQuantity || group.maxSelections;
        if (newQty > maxForOption) return prev;
        // Check total limit
        const otherTotal = Object.entries(current)
          .filter(([id]) => id !== optionId)
          .reduce((s, [, q]) => s + q, 0);
        if (otherTotal + newQty > group.maxSelections) return prev;
        current[optionId] = newQty;
      }
      return { ...prev, [group.id]: current };
    });
  }, []);

  // ── Build CartItem on submit ────────────────────────────────────────────────
  const handleAddToCart = useCallback(() => {
    if (!allValid) {
      setTriedSubmit(true);
      // Scroll to first invalid group
      if (firstInvalidGroup) {
        const el = document.getElementById(`group-${firstInvalidGroup.id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    const selectedModifiers: SelectedModifier[] = [];
    for (const group of groups) {
      const entries = Object.entries(selection[group.id] || {}).filter(([, q]) => q > 0);
      if (entries.length === 0) continue;

      const selectedOptions: SelectedModifierOption[] = entries.map(([optId, qty]) => {
        const opt = group.options.find(o => o.id === optId)!;
        return {
          optionId: opt.id,
          optionName: opt.name,
          additionalPrice: opt.additionalPrice,
          quantity: qty,
        };
      });

      selectedModifiers.push({
        groupId: group.id,
        groupName: group.name,
        priceStrategy: group.priceStrategy,
        selectedOptions,
      });
    }

    // Build a stable signature for cart deduplication
    const signature = selectedModifiers
      .map(m => `${m.groupId}:${m.selectedOptions.map(o => `${o.optionId}x${o.quantity}`).sort().join('|')}`)
      .sort().join('||');
    const id = `${product.id}:${signature || 'plain'}:${notes || ''}` || shortId();

    onAdd({
      id,
      product,
      quantity,
      notes,
      selectedModifiers: selectedModifiers.length > 0 ? selectedModifiers : undefined,
      unitPrice,
      basePrice: product.salePrice,
    });
  }, [allValid, firstInvalidGroup, groups, selection, product, quantity, notes, unitPrice, onAdd]);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl max-h-[94dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>

        {/* Scrollable content */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overscroll-contain">

          {/* Hero image */}
          {product.imageUrl ? (
            <div className="relative w-full aspect-[16/10] bg-gray-100 dark:bg-gray-800 overflow-hidden">
              <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-white dark:from-gray-900 to-transparent" />
              <button
                onClick={onClose}
                className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <Package className="w-4 h-4 text-gray-400" />
                </div>
                <h2 className="font-bold text-gray-900 dark:text-white">Personalizar</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          )}

          {/* Product info */}
          <div className="px-5 pt-4 pb-3">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h1 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">{product.name}</h1>
              <span className="text-lg font-black text-gray-900 dark:text-white whitespace-nowrap">
                {formatBRL(product.salePrice)}
              </span>
            </div>
            {(product.menuDescription || product.description) && (
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {product.menuDescription || product.description}
              </p>
            )}
          </div>

          {/* Modifier groups */}
          <div className="space-y-2 pb-6">
            {groups.map(group => (
              <ModifierGroupSection
                key={group.id}
                group={group}
                picked={selection[group.id] || {}}
                validation={groupValidation[group.id]}
                showError={triedSubmit}
                onToggleSingle={(optId) => toggleSingle(group.id, optId)}
                onToggleMultiple={(optId) => toggleMultiple(group, optId)}
                onChangeQty={(optId, delta) => changeQuantity(group, optId, delta)}
              />
            ))}
          </div>

          {/* Notes */}
          <div className="px-5 pb-4">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Observações (opcional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Ex: sem cebola, caprichar no queijo..."
              className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight resize-none outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="flex-shrink-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-t border-gray-100 dark:border-gray-800 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-2xl p-1">
              <button
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="w-9 h-9 rounded-xl bg-white dark:bg-gray-700 flex items-center justify-center disabled:opacity-40 shadow-sm"
              >
                <Minus className="w-4 h-4 text-gray-700 dark:text-gray-300" />
              </button>
              <span className="w-8 text-center font-bold text-gray-900 dark:text-white">{quantity}</span>
              <button
                onClick={() => setQuantity(q => q + 1)}
                className="w-9 h-9 rounded-xl bg-white dark:bg-gray-700 flex items-center justify-center shadow-sm"
              >
                <Plus className="w-4 h-4 text-gray-700 dark:text-gray-300" />
              </button>
            </div>

            <button
              onClick={handleAddToCart}
              className={`flex-1 py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-between px-4 ${
                allValid
                  ? 'bg-red-500 hover:bg-red-600 text-white shadow-sm shadow-red-200 dark:shadow-red-900/40 active:scale-[0.98]'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              <span>{allValid ? 'Adicionar' : (firstInvalidGroup ? firstInvalidGroup.name + ' obrigatório' : 'Complete as opções')}</span>
              <span className="font-black">{formatBRL(unitPrice * quantity)}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ─── Modifier Group Section ──────────────────────────────────────────────────

function ModifierGroupSection({
  group, picked, validation, showError,
  onToggleSingle, onToggleMultiple, onChangeQty,
}: {
  group: ProductModifierGroup;
  picked: Record<string, number>;
  validation?: { valid: boolean; count: number; message?: string };
  showError: boolean;
  onToggleSingle: (optId: string) => void;
  onToggleMultiple: (optId: string) => void;
  onChangeQty: (optId: string, delta: number) => void;
}) {
  const hasError = showError && validation && !validation.valid;
  const count = validation?.count || 0;
  const availableOptions = group.options.filter(o => o.available).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div
      id={`group-${group.id}`}
      className={`mx-4 rounded-2xl border transition-all ${
        hasError
          ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-gray-900 dark:text-white text-sm">{group.name}</h3>
            {group.required && (
              <span className="text-[10px] font-bold px-2 py-0.5 bg-red-500 text-white rounded-full">
                OBRIGATÓRIO
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {group.description || (
              group.selectionType === 'single'
                ? 'Escolha 1 opção'
                : group.minSelections > 0
                  ? `Escolha de ${group.minSelections} até ${group.maxSelections}`
                  : `Escolha até ${group.maxSelections}`
            )}
          </p>
        </div>
        <div className={`flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold ${
          hasError
            ? 'bg-red-500 text-white'
            : count > 0
              ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
        }`}>
          {count} / {group.maxSelections}
        </div>
      </div>

      {/* Options */}
      <div className="px-2 pb-2 space-y-1">
        {availableOptions.map(option => (
          <OptionRow
            key={option.id}
            option={option}
            group={group}
            quantity={picked[option.id] || 0}
            onToggleSingle={() => onToggleSingle(option.id)}
            onToggleMultiple={() => onToggleMultiple(option.id)}
            onChangeQty={(delta) => onChangeQty(option.id, delta)}
            disabled={
              (picked[option.id] || 0) === 0 &&
              group.selectionType !== 'single' &&
              count >= group.maxSelections
            }
          />
        ))}
      </div>

      {hasError && (
        <div className="flex items-center gap-1.5 px-4 pb-3 -mt-1">
          <AlertCircle className="w-3.5 h-3.5 text-red-500" />
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">{validation?.message}</p>
        </div>
      )}
    </div>
  );
}

// ─── Option Row ──────────────────────────────────────────────────────────────

function OptionRow({
  option, group, quantity, disabled,
  onToggleSingle, onToggleMultiple, onChangeQty,
}: {
  option: ProductModifierOption;
  group: ProductModifierGroup;
  quantity: number;
  disabled: boolean;
  onToggleSingle: () => void;
  onToggleMultiple: () => void;
  onChangeQty: (delta: number) => void;
}) {
  const selected = quantity > 0;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
        selected ? 'bg-red-50 dark:bg-red-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      {/* Option image (optional) */}
      {option.imageUrl && (
        <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0">
          <img src={option.imageUrl} alt={option.name} className="w-full h-full object-cover" />
        </div>
      )}

      {/* Selector (radio/checkbox) */}
      {group.selectionType === 'single' ? (
        <button
          onClick={onToggleSingle}
          disabled={disabled}
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
            selected
              ? 'border-red-500 bg-red-500'
              : 'border-gray-300 dark:border-gray-600'
          }`}
        >
          {selected && <div className="w-2 h-2 rounded-full bg-white" />}
        </button>
      ) : group.selectionType === 'multiple' ? (
        <button
          onClick={onToggleMultiple}
          disabled={disabled && !selected}
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
            selected
              ? 'border-red-500 bg-red-500'
              : 'border-gray-300 dark:border-gray-600'
          }`}
        >
          {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </button>
      ) : null}

      {/* Option info — clickable for single/multiple, separate for quantity */}
      <button
        onClick={
          group.selectionType === 'single'
            ? onToggleSingle
            : group.selectionType === 'multiple'
              ? onToggleMultiple
              : undefined
        }
        disabled={disabled && !selected}
        className="flex-1 min-w-0 text-left"
      >
        <p className={`text-sm font-semibold ${selected ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-white'}`}>
          {option.name}
        </p>
        {option.description && (
          <p className="text-[11px] text-gray-500 line-clamp-1">{option.description}</p>
        )}
      </button>

      {/* Price / quantity control */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {option.additionalPrice > 0 && (
          <span className={`text-xs font-bold ${selected ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
            +{formatBRL(option.additionalPrice)}
          </span>
        )}
        {group.selectionType === 'quantity' ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onChangeQty(-1)}
              disabled={quantity === 0}
              className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center disabled:opacity-40"
            >
              <Minus className="w-3.5 h-3.5 text-gray-600 dark:text-gray-300" />
            </button>
            <span className="w-5 text-center font-bold text-sm text-gray-900 dark:text-white">{quantity}</span>
            <button
              onClick={() => onChangeQty(1)}
              disabled={disabled && quantity === 0}
              className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
