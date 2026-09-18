'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Eye, EyeOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getProductImageUrls } from '@/lib/utils/vitrineCatalog';
import type { Product } from '@/lib/types';
import { ImageGallery } from './ImageGallery';
import { ProductInfo } from './ProductInfo';

interface PresentationModeProps {
  /** Lista já filtrada (busca/categoria) — o vendedor apresenta só o que filtrou. */
  products: Product[];
  onExit: () => void;
}

const NAV_BUTTON =
  'flex h-14 min-w-[8rem] touch-manipulation items-center justify-center gap-2 rounded-2xl px-5 text-md font-semibold transition-colors disabled:opacity-30';

/**
 * Tela cheia pra mostrar o catálogo ao cliente. Renderizado pelo módulo em portal no
 * `document.body`, só enquanto a aba Vitrine está ativa. A saída fica SEMPRE visível
 * (canto superior direito) e também responde ao Esc.
 */
export function PresentationMode({ products, onExit }: PresentationModeProps) {
  const [index, setIndex] = useState(0);
  const [hidePrices, setHidePrices] = useState(false);

  const total = products.length;
  // O catálogo é em tempo real: se a lista encolher com a apresentação aberta, o índice acompanha.
  const current = Math.min(index, Math.max(0, total - 1));
  const product = products[current];

  const goPrevious = useCallback(() => setIndex(Math.max(0, current - 1)), [current]);
  const goNext = useCallback(() => setIndex(Math.min(total - 1, current + 1)), [current, total]);

  useEffect(() => {
    if (total === 0) onExit();
  }, [total, onExit]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onExit();
      else if (event.key === 'ArrowLeft') goPrevious();
      else if (event.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goPrevious, goNext, onExit]);

  if (!product) return null;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Apresentação do catálogo"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[70] flex flex-col bg-white dark:bg-gray-950"
    >
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setHidePrices((hidden) => !hidden)}
          aria-pressed={hidePrices}
          className={cn(
            'flex h-12 touch-manipulation items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors',
            hidePrices
              ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400'
              : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300',
          )}
        >
          {hidePrices ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {hidePrices ? 'Mostrar preços' : 'Ocultar preços'}
        </button>

        <p className="text-sm font-medium tabular-nums text-gray-500 dark:text-gray-400" aria-live="polite">
          {current + 1} / {total}
        </p>

        <button
          type="button"
          onClick={onExit}
          className="flex h-12 touch-manipulation items-center gap-2 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white active:bg-gray-700 dark:bg-white dark:text-gray-900 dark:active:bg-gray-200"
        >
          <X className="h-4 w-4" />
          Sair
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AnimatePresence mode="wait">
          <motion.div
            key={product.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mx-auto grid max-w-6xl gap-6 p-5 landscape:grid-cols-[3fr_2fr]"
          >
            <ImageGallery
              urls={getProductImageUrls(product)}
              alt={product.name}
              sizes="(orientation: landscape) 60vw, 100vw"
              aspectClass="aspect-[4/3]"
              priority
            />
            <ProductInfo product={product} hidePrices={hidePrices} large />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 dark:border-gray-800">
        <button
          type="button"
          onClick={goPrevious}
          disabled={current === 0}
          className={cn(NAV_BUTTON, 'bg-gray-100 text-gray-800 active:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:active:bg-gray-700')}
        >
          <ChevronLeft className="h-5 w-5" />
          Anterior
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={current === total - 1}
          className={cn(NAV_BUTTON, 'bg-red-600 text-white active:bg-red-700')}
        >
          Próximo
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </motion.div>
  );
}
