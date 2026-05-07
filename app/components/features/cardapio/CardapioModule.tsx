'use client';

import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UtensilsCrossed, Search, Clock, Package, ImageOff, Plus, Tag, AlertCircle,
  Sparkles, ShoppingCart, X, ChevronRight, Minus, Leaf,
} from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type { Product } from '@/lib/types';

type DietaryTag = NonNullable<Product['dietary']>[number];

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
interface CartItem { product: Product; qty: number }
type CartMap = Map<string, CartItem>;

// ─── Product detail modal ──────────────────────────────────────────────────────
function ProductDetailModal({
  product, onClose, onAddToCart, cartQty,
}: {
  product: Product;
  onClose: () => void;
  onAddToCart: (p: Product, qty: number) => void;
  cartQty: number;
}) {
  const [qty, setQty] = useState(Math.max(1, cartQty));
  const hasComponents = !!(product.components && product.components.length > 0);
  const outOfStock = !hasComponents && product.currentStock <= 0;
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

// ─── Product card ─────────────────────────────────────────────────────────────
function ProductCard({
  product, cartQty, onOpen, onAdd,
}: {
  product: Product;
  cartQty: number;
  onOpen: (p: Product) => void;
  onAdd: (p: Product) => void;
}) {
  const hasComponents = !!(product.components && product.components.length > 0);
  const outOfStock = !hasComponents && product.currentStock <= 0;
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
            {!hasComponents && (
              <span className="inline-flex items-center gap-1">
                <Package className="w-3 h-3" />
                {product.currentStock}
              </span>
            )}
          </div>
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
              {cartQty > 0 ? `+1 (${cartQty})` : 'Adicionar'}
            </button>
          )}
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
  const total = items.reduce((s, i) => s + i.product.salePrice * i.qty, 0);

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
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    if (!business?.id) { setIsLoading(false); return; }
    setIsLoading(true);
    const q = query(
      collection(db, 'products'),
      where('businessId', '==', business.id),
      where('isDeliverable', '==', true),
      where('isActive', '==', true),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProducts(snap.docs.map(d => ({ ...d.data(), id: d.id } as Product)));
        setIsLoading(false);
      },
      (err) => {
        console.error('[Cardapio] products snapshot error:', err);
        setIsLoading(false);
      },
    );
    return () => unsub();
  }, [business?.id]);

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

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.menuCategory) set.add(p.menuCategory);
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter(p => {
      if (categoryFilter !== 'all' && p.menuCategory !== categoryFilter) return false;
      if (dietaryFilters.length > 0) {
        const have = new Set(p.dietary || []);
        if (!dietaryFilters.every(f => have.has(f as DietaryTag))) return false;
      }
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        p.menuDescription?.toLowerCase().includes(term) ||
        p.menuCategory?.toLowerCase().includes(term)
      );
    });
  }, [products, search, categoryFilter, dietaryFilters]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Product[]>();
    const OTHER = 'Outros';
    for (const p of filtered) {
      const cat = p.menuCategory || OTHER;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(p);
    }
    for (const items of groups.values()) items.sort((a, b) => a.name.localeCompare(b.name));
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === OTHER) return 1;
      if (b === OTHER) return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const addToCart = (product: Product, qty = 1) => {
    setCart(prev => {
      const next = new Map(prev);
      const existing = next.get(product.id);
      next.set(product.id, { product, qty: (existing?.qty || 0) + qty });
      return next;
    });
  };

  const handleCreateOrder = () => {
    const items = Array.from(cart.values()).map(({ product, qty }) => ({
      productId: product.id,
      productName: product.name,
      quantity: qty,
      unitPrice: product.salePrice,
      total: product.salePrice * qty,
      imageUrl: product.imageUrl || undefined,
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
      {categories.length > 0 && (
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
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0',
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
            {grouped.map(([cat, items]) => (
              <motion.section key={cat} layout>
                <h2 className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">
                  <Tag className="w-3.5 h-3.5 text-red-500" />
                  <span className="uppercase tracking-wider">{cat}</span>
                  <span className="text-[10px] font-medium text-gray-400 ml-1">({items.length})</span>
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {items.map(p => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      cartQty={cart.get(p.id)?.qty || 0}
                      onOpen={setSelectedProduct}
                      onAdd={product => addToCart(product, 1)}
                    />
                  ))}
                </div>
              </motion.section>
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* Product detail modal */}
      <AnimatePresence>
        {selectedProduct && (
          <ProductDetailModal
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onAddToCart={addToCart}
            cartQty={cart.get(selectedProduct.id)?.qty || 0}
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
