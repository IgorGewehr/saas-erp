'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { getProductImageUrls } from '@/lib/utils/vitrineCatalog';
import type { Product } from '@/lib/types';
import { ImageGallery } from './ImageGallery';
import { ProductInfo } from './ProductInfo';

interface ProductDetailProps {
  product: Product;
  onClose: () => void;
}

/** Renderizado pelo módulo dentro de um portal em `document.body` (o wrapper da aba tem
 *  `will-change-transform`, que faria `fixed` rolar junto com o conteúdo da aba). */
export function ProductDetail({ product, onClose }: ProductDetailProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

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
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto overscroll-contain rounded-t-3xl bg-white shadow-2xl dark:bg-gray-950 md:rounded-3xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white/95 px-4 py-2 dark:border-gray-800 dark:bg-gray-950/95">
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
      </motion.div>
    </motion.div>
  );
}
