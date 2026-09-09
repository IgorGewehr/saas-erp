'use client';

/**
 * Seletor de VARIAÇÃO do PDV (venda de balcão), M02.8.
 *
 * Mesmo padrão de PDVModifierPicker.tsx (popup isolado, Props mínimas) e do
 * seletor de variação já entregue no cardápio público (M02.5e,
 * app/p/[slug]/ProductDetailSheet.tsx) — radio simples, preço/estoque
 * SEMPRE lidos de `variant.*`, nunca do produto raiz (que não é o saldo/
 * preço real pra `kind:'variant'`).
 *
 * Antes desta fatia, clicar um produto com variação no PDV caía direto em
 * `addToCart`, que lê `product.currentStock`/`product.salePrice` (campos de
 * topo, sem sentido pra kind:'variant') — o item entrava no carrinho com
 * preço/estoque errados e o checkout SEMPRE rejeitava no servidor
 * (VARIANT_REQUIRED, commercial-quote.ts). O motor já era variant-aware
 * desde M02.1; faltava só esta UI.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Check } from 'lucide-react';
import type { Product, ProductVariant } from '@/lib/types';
import { formatCurrency } from '@/lib/utils/format';

interface Props {
  product: Product;
  onClose: () => void;
  onConfirm: (variant: ProductVariant) => void;
}

function variantAvailable(v: ProductVariant): boolean {
  return v.trackStock === false || v.currentStock > 0;
}

export default function PDVVariantPicker({ product, onClose, onConfirm }: Props) {
  const variants = (product.variants ?? []).filter((v) => v.isActive);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => variants.find(variantAvailable)?.id ?? variants[0]?.id ?? null,
  );
  const selected = variants.find((v) => v.id === selectedId) ?? null;

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
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 dark:text-white truncate">{product.name}</h2>
            <p className="text-xs text-gray-500">Escolha uma opção</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {variants.map((v) => {
            const available = variantAvailable(v);
            const isSelected = v.id === selectedId;
            return (
              <button
                key={v.id}
                onClick={() => available && setSelectedId(v.id)}
                disabled={!available}
                className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left ${
                  isSelected ? 'bg-red-50 dark:bg-red-500/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                } ${!available ? 'opacity-50' : ''}`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  isSelected ? 'border-red-500 bg-red-500' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </div>
                <span className={`flex-1 text-sm font-semibold ${isSelected ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-white'}`}>
                  {v.name}{!available ? ' (esgotado)' : ''}
                </span>
                <span className={`text-xs font-bold ${isSelected ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>
                  {formatCurrency(v.salePrice)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex-shrink-0 border-t border-gray-100 dark:border-gray-800 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || !variantAvailable(selected)}
            className={`w-full py-3 rounded-2xl font-bold text-sm transition-all flex items-center justify-between px-4 ${
              selected && variantAvailable(selected)
                ? 'bg-red-500 hover:bg-red-600 text-white active:scale-[0.98]'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            <span>Adicionar ao carrinho</span>
            <span className="font-black">{selected ? formatCurrency(selected.salePrice) : ''}</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
