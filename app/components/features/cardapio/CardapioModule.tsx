'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UtensilsCrossed, Search, Filter, Clock, Package, ImageOff, ExternalLink,
  Plus, Tag, AlertCircle, Sparkles,
} from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type { Product } from '@/lib/types';

function ProductCard({ product, onAddToOrder }: { product: Product; onAddToOrder?: (p: Product) => void }) {
  const hasComponents = !!(product.components && product.components.length > 0);
  const outOfStock = !hasComponents && product.currentStock <= 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group relative overflow-hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-lg hover:shadow-red-500/5 transition-shadow',
        outOfStock && 'opacity-60',
      )}
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

        {/* Badges overlay */}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-2">
          {product.menuCategory && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/70 text-white backdrop-blur-sm">
              {product.menuCategory}
            </span>
          )}
          {hasComponents && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/90 text-white backdrop-blur-sm">
              <Sparkles className="w-2.5 h-2.5" /> Kit
            </span>
          )}
        </div>

        {outOfStock && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-500 text-white">ESGOTADO</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 leading-tight flex-1 min-w-0">
            {product.name}
          </h3>
          <p className="text-base font-bold text-red-600 dark:text-red-400 flex-shrink-0">
            {formatCurrency(product.salePrice)}
          </p>
        </div>

        {product.menuDescription && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{product.menuDescription}</p>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
            {product.preparationTime ? (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {product.preparationTime} min
              </span>
            ) : null}
            {!hasComponents && (
              <span className="inline-flex items-center gap-1">
                <Package className="w-3 h-3" />
                {product.currentStock} un
              </span>
            )}
          </div>
          {onAddToOrder && !outOfStock && (
            <button
              onClick={() => onAddToOrder(product)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold transition-colors"
            >
              <Plus className="w-3 h-3" />
              Adicionar
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function CardapioModule() {
  const { business } = useAuth();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products-menu', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(
        collection(db, 'products'),
        where('businessId', '==', business.id),
        where('isDeliverable', '==', true),
        where('isActive', '==', true),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Product));
    },
    enabled: !!business?.id,
    staleTime: 60 * 1000,
  });

  // Gather unique menu categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.menuCategory) set.add(p.menuCategory);
    }
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter(p => {
      if (categoryFilter !== 'all' && p.menuCategory !== categoryFilter) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        p.menuDescription?.toLowerCase().includes(term) ||
        p.menuCategory?.toLowerCase().includes(term)
      );
    });
  }, [products, search, categoryFilter]);

  // Group by category for display
  const grouped = useMemo(() => {
    const groups = new Map<string, Product[]>();
    const OTHER = 'Outros';
    for (const p of filtered) {
      const cat = p.menuCategory || OTHER;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(p);
    }
    // Sort each group by name
    for (const items of groups.values()) {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === OTHER) return 1;
      if (b === OTHER) return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  return (
    <div className="space-y-6">
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

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar no cardápio..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
          />
        </div>
        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:pb-0">
            <button
              onClick={() => setCategoryFilter('all')}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                categoryFilter === 'all'
                  ? 'bg-red-600 text-white'
                  : 'bg-white dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700',
              )}
            >
              Todas
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                  categoryFilter === cat
                    ? 'bg-red-600 text-white'
                    : 'bg-white dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700',
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="aspect-[4/5] rounded-2xl shimmer" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
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
            {grouped.map(([cat, items]) => (
              <motion.section key={cat} layout>
                <h2 className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">
                  <Tag className="w-3.5 h-3.5 text-red-500" />
                  <span className="uppercase tracking-wider">{cat}</span>
                  <span className="text-[10px] font-medium text-gray-400 ml-1">({items.length})</span>
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {items.map(p => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </div>
              </motion.section>
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
