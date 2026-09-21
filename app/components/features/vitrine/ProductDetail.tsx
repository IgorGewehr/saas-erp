'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { getActiveVariants, getProductImageUrls } from '@/lib/utils/vitrineCatalog';
import { checkProductForProposal } from '@/lib/utils/vitrineProposal';
import type { Product, ProductVariant } from '@/lib/types';
import { ImageGallery } from './ImageGallery';
import { ProductInfo } from './ProductInfo';

interface ProductDetailProps {
  product: Product;
  onClose: () => void;
  /** Devolve o motivo quando a proposta não aceita o item (ex.: está em fechamento). */
  onAddToProposal: (product: Product, variant?: ProductVariant) => { ok: true } | { ok: false; reason: string };
  /** Chamado depois de adicionar — o módulo fecha o detalhe e avisa. */
  onAdded: (product: Product) => void;
}

/** Renderizado pelo módulo dentro de um portal em `document.body` (o wrapper da aba tem
 *  `will-change-transform`, que faria `fixed` rolar junto com o conteúdo da aba). */
export function ProductDetail({ product, onClose, onAddToProposal, onAdded }: ProductDetailProps) {
  const variants = getActiveVariants(product);
  const needsVariant = product.kind === 'variant' || (product.variants?.length ?? 0) > 0;

  const [variantId, setVariantId] = useState<string | null>(variants.length === 1 ? variants[0].id : null);
  const [rejection, setRejection] = useState<string | null>(null);

  const variant = variants.find((candidate) => candidate.id === variantId);
  const check = checkProductForProposal(product, variant);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleAdd = () => {
    const result = onAddToProposal(product, variant);
    if (result.ok) onAdded(product);
    else setRejection(result.reason);
  };

  const hint = rejection ?? (check.ok ? null : check.reason);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-6"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 32 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-gray-950 md:rounded-3xl"
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-2 dark:border-gray-800">
          <p className="truncate text-sm font-medium text-gray-500 dark:text-gray-400">Detalhes</p>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full text-gray-500 transition-colors active:bg-gray-100 dark:text-gray-400 dark:active:bg-gray-800"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="grid gap-6 p-5 md:grid-cols-2">
            <ImageGallery
              key={product.id}
              urls={getProductImageUrls(product)}
              alt={product.name}
              sizes="(min-width: 1024px) 480px, (min-width: 768px) 45vw, 100vw"
              priority
            />
            <ProductInfo product={product} />
          </div>
        </div>

        <div className="flex-shrink-0 space-y-3 border-t border-gray-100 p-4 dark:border-gray-800">
          {needsVariant && variants.length > 0 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide" role="radiogroup" aria-label="Opção">
              {variants.map((candidate) => {
                const on = candidate.id === variantId;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => { setVariantId(candidate.id); setRejection(null); }}
                    className={cn(
                      'h-11 shrink-0 touch-manipulation rounded-full px-4 text-sm font-medium transition-colors',
                      on
                        ? 'bg-red-600 text-white shadow-sm shadow-red-500/25'
                        : 'bg-gray-100 text-gray-600 active:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:active:bg-gray-700',
                    )}
                  >
                    {candidate.name} · {formatCurrency(candidate.salePrice)}
                  </button>
                );
              })}
            </div>
          )}
          {hint && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{hint}</p>}
          <button
            type="button"
            onClick={handleAdd}
            disabled={!check.ok}
            className="flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl bg-red-600 text-md font-semibold text-white shadow-sm shadow-red-500/25 transition-colors active:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
          >
            <Plus className="h-5 w-5" />
            Adicionar à proposta
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
