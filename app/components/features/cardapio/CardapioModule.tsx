'use client';

import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UtensilsCrossed, Search, Clock, Package, ImageOff, Plus, Tag, AlertCircle,
  Sparkles, ShoppingCart, X, ChevronRight, Minus, Leaf, Check, Ban, Undo2,
} from 'lucide-react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type {
  Product, ProductModifierGroup, ProductModifierOption,
  SelectedModifier, SelectedModifierOption, MenuCategory,
} from '@/lib/types';
import { computeModifierDelta, round2, validateAndCleanModifiers } from '@/lib/services/orders/pricing';
import { isOutOfStock, type StockResolver } from '@/lib/utils/menu-availability';
import { toast } from 'react-toastify';

type DietaryTag = NonNullable<Product['dietary']>[number];

const UNCATEGORIZED_ID = '__uncategorized__';

// ─── Dietary config (mirrors agent catalog route) ─────────────────────────────
const DIETARY_OPTIONS: { id: string; label: string; emoji: string; color: string }[] = [
  { id: 'vegan',       label: 'Vegano',       emoji: '🌱', color: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30' },
  { id: 'vegetarian',  label: 'Vegetariano',  emoji: '🥦', color: 'bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30' },
  { id: 'glutenfree',  label: 'Sem Glúten',   emoji: '🌾', color: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30' },
  { id: 'lactosefree', label: 'Sem Lactose',  emoji: '🥛', color: 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30' },
  { id: 'organic',     label: 'Orgânico',     emoji: '♻️', color: 'bg-lime-50 dark:bg-lime-500/15 text-lime-700 dark:text-lime-300 border-lime-200 dark:border-lime-500/30' },
  { id: 'picante',     label: 'Picante',      emoji: '🌶️', color: 'bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30' },
  { id: 'alcool',      label: 'Com Álcool',   emoji: '🍺', color: 'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30' },
  { id: 'kids',        label: 'Kids',         emoji: '👶', color: 'bg-pink-50 dark:bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-500/30' },
];

// ─── Cart ─────────────────────────────────────────────────────────────────────
// Cada linha é uma CONFIGURAÇÃO (produto + modificadores escolhidos), chaveada por
// `product.id + assinatura dos modificadores`. Assim o mesmo produto com opções
// diferentes vira linhas separadas — igual ao cardápio público (CatalogClient).
interface CartLine {
  product: Product;
  qty: number;
  unitPrice: number;                     // base + delta dos modificadores
  selectedModifiers?: SelectedModifier[];
}
type CartMap = Map<string, CartLine>;

function hasModifierGroups(p: Product): boolean {
  return !!(p.hasModifiers && p.modifierGroups && p.modifierGroups.length > 0);
}

/** Assinatura estável da seleção — chaveia a linha do carrinho p/ dedupe. */
function modifierSignature(selected: SelectedModifier[] | undefined): string {
  if (!selected || selected.length === 0) return 'plain';
  return selected
    .map(m => `${m.groupId}:${m.selectedOptions.map(o => `${o.optionId}x${o.quantity}`).sort().join('|')}`)
    .sort().join('||');
}

// ─── Product detail modal ──────────────────────────────────────────────────────
function ProductDetailModal({
  product, onClose, onAddToCart, cartQty, resolveStock,
}: {
  product: Product;
  onClose: () => void;
  onAddToCart: (p: Product, qty: number) => void;
  cartQty: number;
  resolveStock: StockResolver;
}) {
  const [qty, setQty] = useState(Math.max(1, cartQty));
  const hasComponents = !!(product.components && product.components.length > 0);
  const outOfStock = isOutOfStock(product, resolveStock);
  const dietaryTags = DIETARY_OPTIONS.filter(d => product.dietary?.includes(d.id as DietaryTag));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Image */}
        <div className="relative aspect-video bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <div className="flex items-center justify-center h-full">
              <ImageOff className="w-16 h-16 text-gray-300 dark:text-gray-700" />
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          {product.menuCategory && (
            <span className="absolute bottom-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 text-white backdrop-blur-sm">
              {product.menuCategory}
            </span>
          )}
          {hasComponents && (
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/90 text-white backdrop-blur-sm">
              <Sparkles className="w-2.5 h-2.5" /> Kit
            </span>
          )}
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">{product.name}</h2>
              {product.preparationTime && (
                <p className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                  <Clock className="w-3 h-3" /> {product.preparationTime} min de preparo
                </p>
              )}
            </div>
            <p className="text-2xl font-bold text-red-600 dark:text-red-400 flex-shrink-0">
              {formatCurrency(product.salePrice)}
            </p>
          </div>

          {product.menuDescription && (
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{product.menuDescription}</p>
          )}

          {/* Dietary tags */}
          {dietaryTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {dietaryTags.map(d => (
                <span key={d.id} className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border', d.color)}>
                  {d.emoji} {d.label}
                </span>
              ))}
            </div>
          )}

          {/* Components */}
          {hasComponents && product.components && product.components.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 border border-gray-100 dark:border-gray-800">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Composição do kit</p>
              <div className="space-y-1">
                {product.components.map(c => (
                  <div key={c.productId} className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span>{c.productName}</span>
                    <span className="font-medium text-gray-500">{c.quantity}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stock */}
          {!hasComponents && (
            <div className={cn(
              'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg',
              outOfStock
                ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
            )}>
              <Package className="w-3 h-3" />
              {outOfStock ? 'Esgotado' : `${product.currentStock} unidades disponíveis`}
            </div>
          )}

          {/* Qty + Add */}
          {!outOfStock && (
            <div className="flex items-center gap-3 pt-1">
              <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setQty(q => Math.max(1, q - 1))}
                  className="px-3 py-2.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-8 text-center font-bold text-gray-900 dark:text-white text-sm">{qty}</span>
                <button
                  onClick={() => setQty(q => q + 1)}
                  className="px-3 py-2.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={() => { onAddToCart(product, qty); onClose(); }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors"
              >
                <ShoppingCart className="w-4 h-4" />
                {formatCurrency(product.salePrice * qty)} · Adicionar
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Modifier picker ──────────────────────────────────────────────────────────
// Espelha o seletor do cardápio público (ProductDetailSheet): grupos
// single/multiple/quantity, min/max, isDefault, priceStrategy. O PREÇO passa pela
// fonte única `computeModifierDelta` e o gate final por `validateAndCleanModifiers`
// — exatamente o que o servidor (orders/public) aplica. Propaga `selectedModifiers`
// pra que estoque (buildOrderStockLines) e preço fiquem corretos como no público.
type SelectionState = Record<string, Record<string, number>>;

function buildDefaultSelection(product: Product): SelectionState {
  const state: SelectionState = {};
  for (const group of product.modifierGroups || []) {
    state[group.id] = {};
    for (const opt of group.options) {
      if (opt.isDefault && opt.available) state[group.id][opt.id] = 1;
    }
  }
  return state;
}

function countSelections(picked: Record<string, number>): number {
  return Object.values(picked).reduce((s, n) => s + n, 0);
}

function selectionToModifiers(groups: ProductModifierGroup[], selection: SelectionState): SelectedModifier[] {
  const out: SelectedModifier[] = [];
  for (const group of groups) {
    const entries = Object.entries(selection[group.id] || {}).filter(([, q]) => q > 0);
    if (entries.length === 0) continue;
    const selectedOptions: SelectedModifierOption[] = entries.map(([optId, qty]) => {
      const opt = group.options.find(o => o.id === optId)!;
      return { optionId: opt.id, optionName: opt.name, additionalPrice: opt.additionalPrice, quantity: qty };
    });
    out.push({ groupId: group.id, groupName: group.name, priceStrategy: group.priceStrategy, selectedOptions });
  }
  return out;
}

function ModifierPicker({
  product, onClose, onAdd,
}: {
  product: Product;
  onClose: () => void;
  onAdd: (product: Product, qty: number, selectedModifiers: SelectedModifier[], unitPrice: number) => void;
}) {
  const groups = useMemo(
    () => (product.modifierGroups || []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [product.modifierGroups],
  );
  const [selection, setSelection] = useState<SelectionState>(() => buildDefaultSelection(product));
  const [qty, setQty] = useState(1);
  const [triedSubmit, setTriedSubmit] = useState(false);

  const selectedModifiers = useMemo(() => selectionToModifiers(groups, selection), [groups, selection]);
  const unitPrice = useMemo(
    () => round2(product.salePrice + computeModifierDelta(selectedModifiers)),
    [product.salePrice, selectedModifiers],
  );
  const validation = useMemo(
    () => validateAndCleanModifiers(product, selectedModifiers),
    [product, selectedModifiers],
  );
  const allValid = 'clean' in validation;

  const groupValidation = useMemo(() => {
    const result: Record<string, { valid: boolean; count: number; message?: string }> = {};
    for (const group of groups) {
      const count = countSelections(selection[group.id] || {});
      const min = group.minSelections || (group.required ? 1 : 0);
      const max = group.maxSelections || 99;
      if (count < min) result[group.id] = { valid: false, count, message: min === 1 ? 'Escolha uma opção' : `Escolha ${min} opções` };
      else if (count > max) result[group.id] = { valid: false, count, message: `Máximo ${max} opções` };
      else result[group.id] = { valid: true, count };
    }
    return result;
  }, [groups, selection]);

  const toggleSingle = (groupId: string, optionId: string) =>
    setSelection(prev => ({ ...prev, [groupId]: { [optionId]: 1 } }));

  const toggleMultiple = (group: ProductModifierGroup, optionId: string) =>
    setSelection(prev => {
      const current = { ...(prev[group.id] || {}) };
      if (current[optionId]) delete current[optionId];
      else {
        if (countSelections(current) >= group.maxSelections) return prev;
        current[optionId] = 1;
      }
      return { ...prev, [group.id]: current };
    });

  const changeQty = (group: ProductModifierGroup, optionId: string, delta: number) =>
    setSelection(prev => {
      const current = { ...(prev[group.id] || {}) };
      const option = group.options.find(o => o.id === optionId);
      const newQty = (current[optionId] || 0) + delta;
      if (newQty <= 0) delete current[optionId];
      else {
        const maxForOption = option?.maxQuantity || group.maxSelections;
        if (newQty > maxForOption) return prev;
        const otherTotal = Object.entries(current).filter(([id]) => id !== optionId).reduce((s, [, q]) => s + q, 0);
        if (otherTotal + newQty > group.maxSelections) return prev;
        current[optionId] = newQty;
      }
      return { ...prev, [group.id]: current };
    });

  const handleAdd = () => {
    if (!allValid) { setTriedSubmit(true); return; }
    onAdd(product, qty, selectedModifiers, unitPrice);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 pb-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight truncate">{product.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">A partir de {formatCurrency(product.salePrice)}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Groups */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {groups.map(group => {
            const v = groupValidation[group.id];
            const hasError = triedSubmit && v && !v.valid;
            const options = group.options.filter(o => o.available).sort((a, b) => a.sortOrder - b.sortOrder);
            return (
              <div
                key={group.id}
                className={cn(
                  'rounded-2xl border',
                  hasError
                    ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'
                    : 'border-gray-200 dark:border-gray-800',
                )}
              >
                <div className="flex items-center justify-between p-3.5 pb-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm text-gray-900 dark:text-white">{group.name}</h3>
                      {group.required && (
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-red-500 text-white rounded-full">OBRIGATÓRIO</span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {group.selectionType === 'single'
                        ? 'Escolha 1 opção'
                        : group.minSelections > 0
                          ? `Escolha de ${group.minSelections} até ${group.maxSelections}`
                          : `Escolha até ${group.maxSelections}`}
                    </p>
                  </div>
                  <span className={cn(
                    'flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold',
                    hasError ? 'bg-red-500 text-white'
                      : (v?.count || 0) > 0 ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500',
                  )}>
                    {v?.count || 0} / {group.maxSelections}
                  </span>
                </div>
                <div className="px-2 pb-2 space-y-1">
                  {options.map(option => (
                    <ModifierOptionRow
                      key={option.id}
                      option={option}
                      group={group}
                      quantity={selection[group.id]?.[option.id] || 0}
                      disabled={
                        (selection[group.id]?.[option.id] || 0) === 0 &&
                        group.selectionType !== 'single' &&
                        (v?.count || 0) >= group.maxSelections
                      }
                      onToggleSingle={() => toggleSingle(group.id, option.id)}
                      onToggleMultiple={() => toggleMultiple(group, option.id)}
                      onChangeQty={delta => changeQty(group, option.id, delta)}
                    />
                  ))}
                </div>
                {hasError && (
                  <div className="flex items-center gap-1.5 px-4 pb-3">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">{v?.message}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-gray-100 dark:border-gray-800 p-4 flex items-center gap-3">
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setQty(q => Math.max(1, q - 1))}
              className="px-3 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-bold text-gray-900 dark:text-white text-sm">{qty}</span>
            <button
              onClick={() => setQty(q => q + 1)}
              className="px-3 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={handleAdd}
            className={cn(
              'flex-1 flex items-center justify-between px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors',
              allValid ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
            )}
          >
            <span>{allValid ? 'Adicionar' : ('error' in validation ? validation.error : 'Complete as opções')}</span>
            <span className="font-bold">{formatCurrency(unitPrice * qty)}</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ModifierOptionRow({
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
    <div className={cn(
      'flex items-center gap-3 p-3 rounded-xl transition-all',
      selected ? 'bg-red-50 dark:bg-red-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
      disabled && 'opacity-50',
    )}>
      {group.selectionType === 'single' ? (
        <button
          onClick={onToggleSingle}
          className={cn(
            'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all',
            selected ? 'border-red-500 bg-red-500' : 'border-gray-300 dark:border-gray-600',
          )}
        >
          {selected && <div className="w-2 h-2 rounded-full bg-white" />}
        </button>
      ) : group.selectionType === 'multiple' ? (
        <button
          onClick={onToggleMultiple}
          disabled={disabled && !selected}
          className={cn(
            'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all',
            selected ? 'border-red-500 bg-red-500' : 'border-gray-300 dark:border-gray-600',
          )}
        >
          {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </button>
      ) : null}

      <button
        onClick={group.selectionType === 'single' ? onToggleSingle : group.selectionType === 'multiple' ? onToggleMultiple : undefined}
        disabled={disabled && !selected}
        className="flex-1 min-w-0 text-left"
      >
        <p className={cn('text-sm font-semibold', selected ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-white')}>
          {option.name}
        </p>
        {option.description && <p className="text-[11px] text-gray-500 line-clamp-1">{option.description}</p>}
      </button>

      <div className="flex items-center gap-2 flex-shrink-0">
        {option.additionalPrice > 0 && (
          <span className={cn('text-xs font-bold', selected ? 'text-red-600 dark:text-red-400' : 'text-gray-500')}>
            +{formatCurrency(option.additionalPrice)}
          </span>
        )}
        {group.selectionType === 'quantity' && (
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
        )}
      </div>
    </div>
  );
}

// ─── Product card ─────────────────────────────────────────────────────────────
function ProductCard({
  product, cartQty, onOpen, onAdd, onToggleAvailability, resolveStock,
}: {
  product: Product;
  cartQty: number;
  onOpen: (p: Product) => void;
  onAdd: (p: Product) => void;
  onToggleAvailability: (p: Product) => void;
  resolveStock: StockResolver;
}) {
  const hasComponents = !!(product.components && product.components.length > 0);
  const hasMods = hasModifierGroups(product);
  const outOfStock = isOutOfStock(product, resolveStock);
  const manuallyMarkedOut = product.menuAvailable === false;
  const dietaryTags = DIETARY_OPTIONS.filter(d => product.dietary?.includes(d.id as DietaryTag));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group relative overflow-hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-lg hover:shadow-red-500/5 transition-shadow cursor-pointer',
        outOfStock && 'opacity-60',
      )}
      onClick={() => onOpen(product)}
    >
      {/* Image */}
      <div className="relative aspect-[4/3] bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="flex items-center justify-center h-full">
            <ImageOff className="w-10 h-10 text-gray-300 dark:text-gray-700" />
          </div>
        )}

        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
          {product.menuCategory && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 text-white backdrop-blur-sm truncate max-w-[65%]">
              {product.menuCategory}
            </span>
          )}
          {hasComponents && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/90 text-white backdrop-blur-sm flex-shrink-0 ml-auto">
              <Sparkles className="w-2.5 h-2.5" /> Kit
            </span>
          )}
        </div>

        {/* Cart qty badge */}
        {cartQty > 0 && !hasComponents && (
          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center shadow-lg ring-2 ring-white dark:ring-gray-900">
            {cartQty}
          </div>
        )}

        {outOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-500 text-white">ESGOTADO</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3.5 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 leading-tight flex-1 min-w-0 line-clamp-2">
            {product.name}
          </h3>
          <p className="text-sm font-bold text-red-600 dark:text-red-400 flex-shrink-0">
            {formatCurrency(product.salePrice)}
          </p>
        </div>

        {product.menuDescription && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2">{product.menuDescription}</p>
        )}

        {dietaryTags.length > 0 && (
          <div className="flex items-center gap-1">
            {dietaryTags.slice(0, 4).map(d => (
              <span key={d.id} className="text-[11px]" title={d.label}>{d.emoji}</span>
            ))}
            {dietaryTags.length > 4 && (
              <span className="text-[10px] text-gray-400">+{dietaryTags.length - 4}</span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center gap-2.5 text-[11px] text-gray-500 dark:text-gray-400">
            {product.preparationTime ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {product.preparationTime}m
              </span>
            ) : null}
            {!hasComponents && !hasMods && (
              <span className="inline-flex items-center gap-1">
                <Package className="w-3 h-3" />
                {product.currentStock}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Toggle rápido "esgotado hoje" — independente do outOfStock por
                estoque real (regra 5 de menu-availability.ts vence tudo). Só
                afeta a flag manual; item sem estoque real continua esgotado
                mesmo com menuAvailable=true. */}
            <button
              onClick={e => { e.stopPropagation(); onToggleAvailability(product); }}
              title={manuallyMarkedOut ? 'Restaurar disponibilidade' : 'Marcar esgotado hoje'}
              className={cn(
                'inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors flex-shrink-0',
                manuallyMarkedOut
                  ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/25'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-amber-100 dark:hover:bg-amber-500/15 hover:text-amber-700 dark:hover:text-amber-400',
              )}
            >
              {manuallyMarkedOut ? <Undo2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
            </button>
            {!outOfStock && (
              <button
                onClick={e => { e.stopPropagation(); onAdd(product); }}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors',
                  cartQty > 0
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white',
                )}
              >
                <Plus className="w-3 h-3" />
                {hasMods ? (cartQty > 0 ? `Escolher (${cartQty})` : 'Escolher') : cartQty > 0 ? `+1 (${cartQty})` : 'Adicionar'}
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Floating cart bar ────────────────────────────────────────────────────────
function CartBar({ cart, onClear, onCreateOrder }: {
  cart: CartMap;
  onClear: () => void;
  onCreateOrder: () => void;
}) {
  const items = Array.from(cart.values());
  const count = items.reduce((s, i) => s + i.qty, 0);
  const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);

  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 280 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-3 bg-gray-900 dark:bg-gray-800 text-white rounded-2xl shadow-2xl shadow-black/40 border border-white/10 whitespace-nowrap"
    >
      <div className="flex items-center gap-2">
        <div className="relative">
          <ShoppingCart className="w-5 h-5" />
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-[10px] font-bold flex items-center justify-center">
            {count}
          </span>
        </div>
        <span className="text-sm font-semibold">{formatCurrency(total)}</span>
      </div>
      <div className="w-px h-5 bg-white/20" />
      <button
        onClick={onClear}
        className="text-xs text-gray-400 hover:text-white transition-colors"
      >
        Limpar
      </button>
      <button
        onClick={onCreateOrder}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-xl text-xs font-bold transition-colors"
      >
        Criar Pedido
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

// ─── Main module ──────────────────────────────────────────────────────────────
export default function CardapioModule() {
  const { business } = useAuth();
  const { setActivePage } = useAppContext();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dietaryFilters, setDietaryFilters] = useState<string[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartMap>(new Map());

  // Real-time listener (refactor sync multi-user):
  //
  // ANTES: useQuery + getDocs com staleTime 60s. Cliente final via cardápio
  // desatualizado quando atendente alterava preço/disponibilidade no PDV
  // ou Estoque — refetch só ocorria a cada 60s ou no foco da janela.
  //
  // AGORA: onSnapshot. Toggle de isActive/isDeliverable em estoque reflete
  // imediatamente no cardápio aberto (mesmo em outra aba/dispositivo).
  // Crítico pra "esgotou item" — evita pedido de produto indisponível.
  const [products, setProducts] = useState<Product[]>([]);
  const [menuCategories, setMenuCategories] = useState<MenuCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    if (!business?.id) { setIsLoading(false); return; }
    setIsLoading(true);
    // Single-field — isDeliverable + isActive filtrados client-side
    // (evita composite index 3-field products/businessId+isDeliverable+isActive).
    const q = query(
      collection(db, 'products'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as Product))
          .filter(p => p.isActive !== false && (p as { isDeliverable?: boolean }).isDeliverable === true);
        setProducts(list);
        setIsLoading(false);
      },
      (err) => {
        console.error('[Cardapio] products snapshot error:', err);
        setIsLoading(false);
      },
    );
    return () => unsub();
  }, [business?.id]);

  // Categorias formais do cardápio (coleção menuCategories) — mesmo padrão do
  // InventoryModule. Dão ordem (sortOrder), cor e nome canônico; produtos legados
  // sem menuCategoryId caem no fallback pela string `menuCategory`.
  useEffect(() => {
    if (!business?.id) { setMenuCategories([]); return; }
    const q = query(
      collection(db, 'menuCategories'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map(d => ({ ...d.data(), id: d.id }) as MenuCategory)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        setMenuCategories(list);
      },
      (err) => console.error('[Cardapio] menuCategories snapshot error:', err),
    );
    return () => unsub();
  }, [business?.id]);

  // Toggle rápido de "esgotado hoje" direto no card — antes só dava pra marcar
  // abrindo o formulário completo de edição em Estoque, inviável durante o
  // rush. onSnapshot já propaga o novo estado pra todos os dispositivos
  // (inclusive o cardápio público) sem precisar de refresh.
  const handleToggleAvailability = async (product: Product) => {
    try {
      await updateDoc(doc(db, 'products', product.id), {
        menuAvailable: product.menuAvailable === false,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Cardapio] toggle menuAvailable failed:', err);
      toast.error('Não foi possível atualizar a disponibilidade do item.');
    }
  };

  // Sync selectedProduct com snapshot — fecha modal se produto foi
  // desativado/removido por outro user; refresca display se preço mudou.
  // Filtro do query já exclui isActive=false e isDeliverable=false, então
  // qualquer doc removido do `products` significa indisponível.
  useEffect(() => {
    if (!selectedProduct) return;
    const fresh = products.find(p => p.id === selectedProduct.id);
    if (!fresh) {
      setSelectedProduct(null);
      return;
    }
    if (fresh.updatedAt !== selectedProduct.updatedAt) {
      setSelectedProduct(fresh);
    }
  }, [products, selectedProduct]);

  // Mesmo guard pro seletor de modificadores: se o produto sumiu do snapshot
  // (desativado/removido) fecha; se mudou (preço/opções) reabre com a versão
  // fresca — evita precificar/debitar por definição obsoleta.
  useEffect(() => {
    if (!modifierProduct) return;
    const fresh = products.find(p => p.id === modifierProduct.id);
    if (!fresh) { setModifierProduct(null); return; }
    if (fresh.updatedAt !== modifierProduct.updatedAt) setModifierProduct(fresh);
  }, [products, modifierProduct]);

  // Resolve o estoque de um insumo (produto composto) pelo snapshot visível.
  // Insumo não presente → undefined → helper trata como não-bloqueante (igual
  // ao público, que não esgota composto sem conseguir resolver o insumo).
  const resolveStock = useMemo<StockResolver>(() => {
    const byId = new Map(products.map(p => [p.id, p.currentStock]));
    return (id: string) => byId.get(id);
  }, [products]);

  // Categorias formais (menuCategories ativas, já ordenadas por sortOrder) +
  // fallback pela string legada `menuCategory`/`category` — mesma lógica do
  // cardápio público (CatalogClient.categoryList).
  const categoryList = useMemo(() => {
    const known = new Map<string, { id: string; name: string; color?: string }>();
    for (const c of menuCategories) {
      if (c.isActive) known.set(c.id, { id: c.id, name: c.name, color: c.color });
    }
    const stringCats = new Set<string>();
    for (const p of products) {
      if (p.menuCategoryId && known.has(p.menuCategoryId)) continue;
      const cat = p.menuCategory || p.category;
      if (cat && !known.has(cat) && !stringCats.has(cat)) {
        stringCats.add(cat);
        known.set(cat, { id: cat, name: cat });
      }
    }
    return Array.from(known.values());
  }, [menuCategories, products]);

  // Produtos agrupados por id de categoria (menuCategoryId → fallback string →
  // UNCATEGORIZED). Aplica busca + filtros dietéticos aqui; o filtro de pill de
  // categoria é aplicado depois, em `visibleCategories`.
  const productsByCategory = useMemo(() => {
    const term = search.trim().toLowerCase();
    const map = new Map<string, Product[]>();
    for (const p of products) {
      if (dietaryFilters.length > 0) {
        const have = new Set(p.dietary || []);
        if (!dietaryFilters.every(f => have.has(f as DietaryTag))) continue;
      }
      if (term) {
        const hay = `${p.name} ${p.menuDescription || ''} ${p.menuCategory || ''}`.toLowerCase();
        if (!hay.includes(term)) continue;
      }
      const key = (p.menuCategoryId && categoryList.some(c => c.id === p.menuCategoryId))
        ? p.menuCategoryId
        : categoryList.find(c => c.name === (p.menuCategory || p.category))?.id
        || UNCATEGORIZED_ID;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return map;
  }, [products, categoryList, search, dietaryFilters]);

  // Categorias com pelo menos 1 item (respeitando busca/dietético) + "Outros".
  const availableCategories = useMemo(() => {
    const list: { id: string; name: string; color?: string }[] =
      categoryList.filter(c => (productsByCategory.get(c.id)?.length ?? 0) > 0);
    if ((productsByCategory.get(UNCATEGORIZED_ID)?.length ?? 0) > 0) {
      list.push({ id: UNCATEGORIZED_ID, name: 'Outros' });
    }
    return list;
  }, [categoryList, productsByCategory]);

  const visibleCategories = useMemo(
    () => categoryFilter === 'all'
      ? availableCategories
      : availableCategories.filter(c => c.id === categoryFilter),
    [availableCategories, categoryFilter],
  );

  const visibleCount = useMemo(
    () => visibleCategories.reduce((s, c) => s + (productsByCategory.get(c.id)?.length ?? 0), 0),
    [visibleCategories, productsByCategory],
  );

  // Soma da quantidade de TODAS as configurações de um produto — badge do card.
  const productQtyInCart = (productId: string) =>
    Array.from(cart.values()).reduce((s, l) => s + (l.product.id === productId ? l.qty : 0), 0);

  // Produto SEM modificadores: linha simples chaveada por product.id.
  const addPlain = (product: Product, qty = 1) => {
    setCart(prev => {
      const next = new Map(prev);
      const key = `${product.id}:plain`;
      const existing = next.get(key);
      next.set(key, { product, qty: (existing?.qty || 0) + qty, unitPrice: product.salePrice });
      return next;
    });
  };

  // Produto COM modificadores: linha por configuração (product.id + assinatura).
  const addConfigured = (
    product: Product, qty: number, selectedModifiers: SelectedModifier[], unitPrice: number,
  ) => {
    setCart(prev => {
      const next = new Map(prev);
      const key = `${product.id}:${modifierSignature(selectedModifiers)}`;
      const existing = next.get(key);
      next.set(key, {
        product,
        qty: (existing?.qty || 0) + qty,
        unitPrice,
        selectedModifiers: selectedModifiers.length > 0 ? selectedModifiers : undefined,
      });
      return next;
    });
  };

  // Roteia: produto com modificadores nunca é adicionado direto (mis-preço /
  // não debita insumos) — abre o seletor. Sem modificadores segue o fluxo simples.
  const openProduct = (product: Product) => {
    if (hasModifierGroups(product)) setModifierProduct(product);
    else setSelectedProduct(product);
  };
  const quickAdd = (product: Product) => {
    if (hasModifierGroups(product)) setModifierProduct(product);
    else addPlain(product, 1);
  };

  const handleCreateOrder = () => {
    const items = Array.from(cart.values()).map(({ product, qty, unitPrice, selectedModifiers }) => ({
      productId: product.id,
      productName: product.name,
      quantity: qty,
      unitPrice,
      total: round2(unitPrice * qty),
      imageUrl: product.imageUrl || undefined,
      ...(selectedModifiers ? { selectedModifiers, basePrice: product.salePrice } : {}),
    }));
    sessionStorage.setItem('pendingCartItems', JSON.stringify(items));
    setCart(new Map());
    setActivePage('Pedidos');
  };

  const toggleDietary = (id: string) =>
    setDietaryFilters(prev => prev.includes(id) ? prev.filter(d => d !== id) : [...prev, id]);

  const hasActiveFilters = dietaryFilters.length > 0 || categoryFilter !== 'all' || search.trim().length > 0;

  return (
    <div className="space-y-5 pb-28">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white font-display flex items-center gap-2.5">
            <UtensilsCrossed className="w-6 h-6 text-red-500" />
            Cardápio
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {products.length} {products.length === 1 ? 'item disponível' : 'itens disponíveis'} para entrega
          </p>
        </div>
      </motion.div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar no cardápio..."
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
        />
      </div>

      {/* Category filter */}
      {availableCategories.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-4 px-4 sm:mx-0 sm:px-0">
          <button
            onClick={() => setCategoryFilter('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0',
              categoryFilter === 'all'
                ? 'bg-red-600 text-white'
                : 'bg-white dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700',
            )}
          >
            Todas
          </button>
          {availableCategories.map(cat => {
            const active = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0',
                  active
                    ? 'bg-red-600 text-white'
                    : 'bg-white dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700',
                )}
                style={active && cat.color ? { backgroundColor: cat.color } : undefined}
              >
                {cat.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Dietary filters */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 -mx-4 px-4 sm:mx-0 sm:px-0">
        <Leaf className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        {DIETARY_OPTIONS.map(opt => {
          const active = dietaryFilters.includes(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => toggleDietary(opt.id)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors border flex-shrink-0',
                active
                  ? opt.color
                  : 'bg-white dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700',
              )}
            >
              {opt.emoji} {opt.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="aspect-[4/5] rounded-2xl shimmer" />
          ))}
        </div>
      ) : visibleCount === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-4">
            <UtensilsCrossed className="w-7 h-7 text-red-500" />
          </div>
          <p className="text-gray-700 dark:text-gray-200 font-semibold">
            {products.length === 0 ? 'Cardápio vazio' : 'Nenhum item encontrado'}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
            {products.length === 0
              ? 'Vá em Estoque, edite um produto e marque "Entrega" para exibi-lo aqui.'
              : 'Tente outros termos de busca ou limpe os filtros.'}
          </p>
          {hasActiveFilters && (
            <button
              onClick={() => { setDietaryFilters([]); setCategoryFilter('all'); setSearch(''); }}
              className="mt-4 px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Limpar filtros
            </button>
          )}
          {products.length === 0 && (
            <div className="mt-5 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-xs text-blue-700 dark:text-blue-300">
              <AlertCircle className="w-3.5 h-3.5" />
              Abra Estoque → produto → seção "Entrega & Cardápio"
            </div>
          )}
        </motion.div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="space-y-8">
            {visibleCategories.map(cat => {
              const items = productsByCategory.get(cat.id) || [];
              if (items.length === 0) return null;
              return (
                <motion.section key={cat.id} layout>
                  <h2 className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">
                    {cat.color ? (
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                    ) : (
                      <Tag className="w-3.5 h-3.5 text-red-500" />
                    )}
                    <span className="uppercase tracking-wider">{cat.name}</span>
                    <span className="text-[10px] font-medium text-gray-400 ml-1">({items.length})</span>
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {items.map(p => (
                      <ProductCard
                        key={p.id}
                        product={p}
                        cartQty={productQtyInCart(p.id)}
                        onOpen={openProduct}
                        onAdd={quickAdd}
                        onToggleAvailability={handleToggleAvailability}
                        resolveStock={resolveStock}
                      />
                    ))}
                  </div>
                </motion.section>
              );
            })}
          </div>
        </AnimatePresence>
      )}

      {/* Product detail modal (produtos SEM modificadores) */}
      <AnimatePresence>
        {selectedProduct && (
          <ProductDetailModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onAddToCart={addPlain}
            cartQty={productQtyInCart(selectedProduct.id)}
            resolveStock={resolveStock}
          />
        )}
      </AnimatePresence>

      {/* Modifier picker (produtos COM modificadores) */}
      <AnimatePresence>
        {modifierProduct && (
          <ModifierPicker
            product={modifierProduct}
            onClose={() => setModifierProduct(null)}
            onAdd={addConfigured}
          />
        )}
      </AnimatePresence>

      {/* Floating cart bar */}
      <AnimatePresence>
        {cart.size > 0 && (
          <CartBar
            cart={cart}
            onClear={() => setCart(new Map())}
            onCreateOrder={handleCreateOrder}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
