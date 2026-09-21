'use client';

import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { resolveProductSpecs } from '@/lib/utils/productSpecs';
import {
  getActiveVariants,
  getDisplayPrice,
  productCategory,
} from '@/lib/utils/vitrineCatalog';
import type { Product } from '@/lib/types';

interface ProductInfoProps {
  product: Product;
  /** Cenário de negociação: o cliente vê o item, o vendedor decide quando falar de valor. */
  hidePrices?: boolean;
  /** Tipografia grande, pro modo apresentação. */
  large?: boolean;
}

/** Só campos "de vitrine": nunca custo, estoque nem margem. */
export function ProductInfo({ product, hidePrices = false, large = false }: ProductInfoProps) {
  const price = getDisplayPrice(product);
  const variants = getActiveVariants(product);
  const { specs, rest } = resolveProductSpecs(product);

  return (
    <div className="space-y-4">
      <div>
        <span className="inline-block rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {productCategory(product)}
        </span>
        <h2 className={cn('mt-2 font-display font-bold leading-tight text-gray-900 dark:text-white', large ? 'text-3xl' : 'text-xl')}>
          {product.name}
        </h2>
      </div>

      {!hidePrices && (
        <div>
          {price.amount > 0 ? (
            <>
              {price.isFrom && <p className="text-xs text-gray-500 dark:text-gray-400">a partir de</p>}
              <p className={cn('font-display font-bold text-gray-900 dark:text-white', large ? 'text-4xl' : 'text-2xl')}>
                {formatCurrency(price.amount)}
              </p>
            </>
          ) : (
            <p className={cn('font-semibold text-gray-500 dark:text-gray-400', large ? 'text-xl' : 'text-base')}>Sob consulta</p>
          )}
        </div>
      )}

      {variants.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Opções</h3>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {variants.map((variant) => (
              <li key={variant.id} className={cn('flex items-center justify-between gap-3 px-3 py-2.5', large && 'py-3.5 text-lg')}>
                <span className="font-medium text-gray-800 dark:text-gray-200">{variant.name}</span>
                {!hidePrices && (
                  <span className="whitespace-nowrap font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(variant.salePrice)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {specs.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Especificações</h3>
          <dl className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {specs.map((spec, position) => (
              <div key={`${spec.label}-${position}`} className={cn('grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2.5', large && 'py-3.5 text-lg')}>
                <dt className="text-gray-500 dark:text-gray-400">{spec.label}</dt>
                <dd className="font-medium text-gray-900 dark:text-gray-100">{spec.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {rest && (
        <p className={cn('whitespace-pre-line leading-relaxed text-gray-600 dark:text-gray-300', large && 'text-lg')}>{rest}</p>
      )}
    </div>
  );
}
