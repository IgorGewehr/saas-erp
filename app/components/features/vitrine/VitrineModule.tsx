'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { Package, Presentation, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useTabContext } from '@/app/components/layout/TabContext';
import { filterCatalog, getCatalogCategories } from '@/lib/utils/vitrineCatalog';
import type { Product } from '@/lib/types';
import { PresentationMode } from './PresentationMode';
import { ProductCard } from './ProductCard';
import { ProductDetail } from './ProductDetail';
import { useVitrineProducts } from './useVitrineProducts';

const PRIORITY_CARDS = 4;

export default function VitrineModule() {
  const { business } = useAuth();
  const { activeTabId, openTab } = useTabContext();
  const isActive = activeTabId === 'Vitrine';

  const { products, isLoading } = useVitrineProducts(business?.id, isActive);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);

  // As sobreposições vivem em portal no <body> e as abas ficam montadas em paralelo:
  // sem fechar ao sair da aba, o detalhe/apresentação cobriria o módulo que o usuário abriu.
  useEffect(() => {
    if (isActive) return;
    setSelectedId(null);
    setPresenting(false);
  }, [isActive]);

  const deferredSearch = useDeferredValue(search);
  const categories = useMemo(() => getCatalogCategories(products), [products]);
  // Catálogo em tempo real: se a última peça da categoria some, o filtro volta pra "Todos".
  const activeCategory = category && categories.includes(category) ? category : null;
  const visible = useMemo(
    () => filterCatalog(products, { search: deferredSearch, category: activeCategory }),
    [products, deferredSearch, activeCategory],
  );
  const selected = useMemo(() => products.find((product) => product.id === selectedId) ?? null, [products, selectedId]);

  const handleSelect = useCallback((product: Product) => setSelectedId(product.id), []);
  const handleCloseDetail = useCallback(() => setSelectedId(null), []);
  const handleExitPresentation = useCallback(() => setPresenting(false), []);

  const hasFilters = search.trim() !== '' || activeCategory !== null;
  const clearFilters = () => {
    setSearch('');
    setCategory(null);
  };

  return (
    <div className="mx-auto max-w-[1400px]">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-white">Vitrine</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Catálogo para mostrar ao cliente</p>
        </div>
        <button
          type="button"
          onClick={() => setPresenting(true)}
          disabled={visible.length === 0}
          className="flex h-12 touch-manipulation items-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white shadow-sm shadow-red-500/25 transition-colors active:bg-red-700 disabled:opacity-40"
        >
          <Presentation className="h-5 w-5" />
          Modo apresentação
        </button>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" aria-hidden />
        {/* 16px: abaixo disso o iPad dá zoom no foco do campo. */}
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome, categoria ou descrição"
          aria-label="Buscar no catálogo"
          className="h-12 w-full rounded-xl border border-gray-200 bg-white pl-12 pr-12 text-[16px] text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Limpar busca"
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 touch-manipulation items-center justify-center rounded-full text-gray-400 active:bg-gray-100 dark:active:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {categories.length > 1 && (
        <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide" role="tablist" aria-label="Categorias">
          {[null, ...categories].map((name) => {
            const selectedChip = name === activeCategory;
            return (
              <button
                key={name ?? '__all__'}
                type="button"
                role="tab"
                aria-selected={selectedChip}
                onClick={() => setCategory(name)}
                className={cn(
                  'h-11 shrink-0 touch-manipulation rounded-full px-5 text-sm font-medium transition-colors',
                  selectedChip
                    ? 'bg-red-600 text-white shadow-sm shadow-red-500/25'
                    : 'bg-gray-100 text-gray-600 active:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:active:bg-gray-700',
                )}
              >
                {name ?? 'Todos'}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, position) => (
              <div key={position} className="h-56 rounded-2xl shimmer" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            title="Seu catálogo está vazio"
            description={'Cadastre os itens em Estoque. Para serviços, ative "Não controlar estoque" no cadastro. Adicione fotos e, na descrição, linhas "Rótulo: valor" viram a tabela de especificações.'}
            action={{ label: 'Abrir Estoque', onClick: () => openTab('Estoque') }}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Nada encontrado"
            description="Nenhum item combina com a busca ou a categoria escolhida."
            action={hasFilters ? { label: 'Limpar filtros', onClick: clearFilters } : undefined}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {visible.map((product, position) => (
              <ProductCard key={product.id} product={product} onSelect={handleSelect} priority={position < PRIORITY_CARDS} />
            ))}
          </div>
        )}
      </div>

      {isActive && typeof document !== 'undefined' && createPortal(
        <>
          <AnimatePresence>
            {selected && !presenting && <ProductDetail key={selected.id} product={selected} onClose={handleCloseDetail} />}
          </AnimatePresence>
          <AnimatePresence>
            {presenting && <PresentationMode products={visible} onExit={handleExitPresentation} />}
          </AnimatePresence>
        </>,
        document.body,
      )}
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 px-6 py-16 text-center dark:border-gray-800">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
        <Package className="h-6 w-6 text-gray-400" />
      </div>
      <p className="text-md font-semibold text-gray-700 dark:text-gray-200">{title}</p>
      <p className="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">{description}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 h-12 touch-manipulation rounded-xl bg-gray-900 px-6 text-sm font-semibold text-white active:bg-gray-700 dark:bg-white dark:text-gray-900"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
