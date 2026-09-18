'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { getDisplayPrice, getProductImageUrls, productCategory } from '@/lib/utils/vitrineCatalog';
import type { Product } from '@/lib/types';
import { CatalogImage, ImagePlaceholder } from './CatalogImage';

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
  /** Primeiras linhas do grid carregam sem lazy pra não abrir a vitrine com quadros vazios. */
  priority?: boolean;
}

function ProductCardImpl({ product, onSelect, priority = false }: ProductCardProps) {
  const cover = getProductImageUrls(product)[0];
  const price = getDisplayPrice(product);

  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      className={cn(
        'group touch-manipulation overflow-hidden rounded-2xl border border-gray-100 bg-white text-left shadow-sm',
        'transition-all active:scale-[0.98] active:shadow-none dark:border-gray-800 dark:bg-gray-900',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500',
      )}
    >
      <div className="relative aspect-[4/3] w-full bg-gray-100 dark:bg-gray-800">
        {cover ? (
          <CatalogImage
            key={cover}
            src={cover}
            alt={product.name}
            sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
            priority={priority}
          />
        ) : (
          <ImagePlaceholder />
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="text-xs text-gray-400 dark:text-gray-500">{productCategory(product)}</p>
        <p className="line-clamp-2 min-h-[2.5rem] font-semibold leading-snug text-gray-900 dark:text-white">{product.name}</p>
        <p className="pt-0.5 text-sm font-bold text-red-600 dark:text-red-400">
          {price.amount > 0 ? (
            <>
              {price.isFrom && <span className="mr-1 text-xs font-normal text-gray-500 dark:text-gray-400">a partir de</span>}
              {formatCurrency(price.amount)}
            </>
          ) : (
            <span className="font-medium text-gray-500 dark:text-gray-400">Sob consulta</span>
          )}
        </p>
      </div>
    </button>
  );
}

export const ProductCard = memo(ProductCardImpl);
