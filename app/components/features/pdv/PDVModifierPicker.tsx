'use client';

/**
 * Seletor de MODIFICADORES do PDV (venda de balcão).
 *
 * Mesmo padrão do cardápio público (app/p/[slug]/ProductDetailSheet): a lógica
 * de preço/validação NÃO é reimplementada — reusa as funções PURAS de
 * `lib/services/orders/pricing` (computeModifierDelta + validateAndCleanModifiers),
 * fonte ÚNICA extraída do caminho público (referência de correção). Assim o preço
 * e as regras (obrigatório/min/max) ficam idênticos aos do público.
 *
 * Devolve o SelectedModifier[] limpo + unitPrice já com o delta aplicado; quem
 * grava a venda persiste isso no SaleItem e buildOrderStockLines debita os
 * insumos (linkedProductId) simetricamente.
 */

import { useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Minus, Check, AlertCircle } from 'lucide-react';
import type {
  Product, ProductModifierGroup, ProductModifierOption, SelectedModifier,
} from '@/lib/types';
import { computeModifierDelta, validateAndCleanModifiers, round2 } from '@/lib/services/orders/pricing';
import { formatCurrency } from '@/lib/utils/format';

interface Props {
  product: Product;
  onClose: () => void;
  onConfirm: (result: { selectedModifiers: SelectedModifier[]; unitPrice: number; basePrice: number }) => void;
}

type SelectionState = Record<string, Record<string, number>>;

function buildInitialSelection(product: Product): SelectionState {
  const state: SelectionState = {};
  for (const group of product.modifierGroups || []) {
    state[group.id] = {};
    group.options.forEach(opt => {
      if (opt.isDefault && opt.available) state[group.id][opt.id] = 1;
    });
  }
  return state;
}

function countSelections(picked: Record<string, number>): number {
  return Object.values(picked).reduce((s, n) => s + n, 0);
}

/** Converte o estado de UI em SelectedModifier[] (denormalizado). */
function toSelectedModifiers(product: Product, selection: SelectionState): SelectedModifier[] {
  const out: SelectedModifier[] = [];
  for (const group of product.modifierGroups || []) {
    const entries = Object.entries(selection[group.id] || {}).filter(([, q]) => q > 0);
    if (entries.length === 0) continue;
    const selectedOptions = entries.map(([optId, qty]) => {
      const opt = group.options.find(o => o.id === optId)!;
      return { optionId: opt.id, optionName: opt.name, additionalPrice: opt.additionalPrice, quantity: qty };
    });
    out.push({ groupId: group.id, groupName: group.name, priceStrategy: group.priceStrategy, selectedOptions });
  }
  return out;
}

export default function PDVModifierPicker({ product, onClose, onConfirm }: Props) {
  const groups = useMemo(
    () => (product.modifierGroups || []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [product.modifierGroups],
  );
  const [selection, setSelection] = useState<SelectionState>(() => buildInitialSelection(product));
  const [triedSubmit, setTriedSubmit] = useState(false);

  const selectedModifiers = useMemo(() => toSelectedModifiers(product, selection), [product, selection]);

  const unitPrice = useMemo(
    () => round2(product.salePrice + computeModifierDelta(selectedModifiers)),
    [product.salePrice, selectedModifiers],
  );

  // Validação vem da MESMA fonte do público (regras required/min/max).
  const validationError = useMemo(() => {
    const res = validateAndCleanModifiers(product, selectedModifiers);
    return 'error' in res ? res.error : null;
  }, [product, selectedModifiers]);

  const toggleSingle = useCallback((groupId: string, optionId: string) => {
    setSelection(prev => ({ ...prev, [groupId]: { [optionId]: 1 } }));
  }, []);

  const toggleMultiple = useCallback((group: ProductModifierGroup, optionId: string) => {
    setSelection(prev => {
      const current = { ...(prev[group.id] || {}) };
      if (current[optionId]) {
        delete current[optionId];
      } else {
        if (countSelections(current) >= group.maxSelections) return prev;
        current[optionId] = 1;
      }
      return { ...prev, [group.id]: current };
    });
  }, []);

  const changeQuantity = useCallback((group: ProductModifierGroup, optionId: string, delta: number) => {
    setSelection(prev => {
      const current = { ...(prev[group.id] || {}) };
      const option = group.options.find(o => o.id === optionId);
      const newQty = (current[optionId] || 0) + delta;
      if (newQty <= 0) {
        delete current[optionId];
      } else {
        const maxForOption = option?.maxQuantity || group.maxSelections;
        if (newQty > maxForOption) return prev;
        const otherTotal = Object.entries(current)
          .filter(([id]) => id !== optionId)
          .reduce((s, [, q]) => s + q, 0);
        if (otherTotal + newQty > group.maxSelections) return prev;
        current[optionId] = newQty;
      }
      return { ...prev, [group.id]: current };
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const res = validateAndCleanModifiers(product, selectedModifiers);
    if ('error' in res) { setTriedSubmit(true); return; }
    onConfirm({
      selectedModifiers: res.clean,
      unitPrice: round2(product.salePrice + computeModifierDelta(res.clean)),
      basePrice: product.salePrice,
    });
  }, [product, selectedModifiers, onConfirm]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        className="relative w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[90dvh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white truncate">{product.name}</h2>
            <p className="text-xs text-gray-500">Personalizar item</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Groups */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-2">
          {groups.map(group => {
            const picked = selection[group.id] || {};
            const count = countSelections(picked);
            const min = group.minSelections || (group.required ? 1 : 0);
            const invalid = triedSubmit && (count < min || (group.maxSelections > 0 && count > group.maxSelections));
            const availableOptions = group.options
              .filter(o => o.available !== false)
              .sort((a, b) => a.sortOrder - b.sortOrder);
            return (
              <div
                key={group.id}
                className={`rounded-2xl border transition-all ${
                  invalid
                    ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'
                    : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">{group.name}</h3>
                    {group.required && (
                      <span className="text-[10px] font-bold px-2 py-0.5 bg-red-500 text-white rounded-full">
                        OBRIGATÓRIO
                      </span>
                    )}
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                    invalid ? 'bg-red-500 text-white'
                      : count > 0 ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                  }`}>
                    {count}{group.maxSelections > 0 ? ` / ${group.maxSelections}` : ''}
                  </span>
                </div>
                <div className="px-2 pb-2 space-y-1">
                  {availableOptions.map(option => (
                    <OptionRow
                      key={option.id}
                      option={option}
                      group={group}
                      quantity={picked[option.id] || 0}
                      disabled={(picked[option.id] || 0) === 0 && group.selectionType !== 'single' && count >= group.maxSelections}
                      onToggleSingle={() => toggleSingle(group.id, option.id)}
                      onToggleMultiple={() => toggleMultiple(group, option.id)}
                      onChangeQty={(delta) => changeQuantity(group, option.id, delta)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-gray-100 dark:border-gray-800 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          {triedSubmit && validationError && (
            <div className="flex items-center gap-1.5 mb-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-500" />
              <p className="text-xs text-red-600 dark:text-red-400 font-medium">{validationError}</p>
            </div>
          )}
          <button
            onClick={handleConfirm}
            className={`w-full py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-between px-4 ${
              !validationError
                ? 'bg-red-500 hover:bg-red-600 text-white active:scale-[0.98]'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            <span>{!validationError ? 'Adicionar ao carrinho' : 'Complete as opções'}</span>
            <span className="font-black">{formatCurrency(unitPrice)}</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function OptionRow({
  option, group, quantity, disabled, onToggleSingle, onToggleMultiple, onChangeQty,
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
      {group.selectionType === 'single' ? (
        <button
          onClick={onToggleSingle}
          disabled={disabled}
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
            selected ? 'border-red-500 bg-red-500' : 'border-gray-300 dark:border-gray-600'
          }`}
        >
          {selected && <div className="w-2 h-2 rounded-full bg-white" />}
        </button>
      ) : group.selectionType === 'multiple' ? (
        <button
          onClick={onToggleMultiple}
          disabled={disabled && !selected}
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
            selected ? 'border-red-500 bg-red-500' : 'border-gray-300 dark:border-gray-600'
          }`}
        >
          {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </button>
      ) : null}

      <button
        onClick={group.selectionType === 'single' ? onToggleSingle : group.selectionType === 'multiple' ? onToggleMultiple : undefined}
        disabled={disabled && !selected}
        className="flex-1 min-w-0 text-left"
      >
        <p className={`text-sm font-semibold ${selected ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-white'}`}>
          {option.name}
        </p>
        {option.description && <p className="text-[11px] text-gray-500 line-clamp-1">{option.description}</p>}
      </button>

      <div className="flex items-center gap-2 flex-shrink-0">
        {option.additionalPrice > 0 && (
          <span className={`text-xs font-bold ${selected ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
            +{formatCurrency(option.additionalPrice)}
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
