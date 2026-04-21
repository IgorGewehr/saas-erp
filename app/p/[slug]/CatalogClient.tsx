'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import {
  ShoppingCart, Plus, Minus, X, ChevronRight, MapPin, Phone,
  CreditCard, Wallet, Banknote, QrCode, Truck, Store,
  CheckCircle2, Clock, Star, Search, ArrowLeft, AlertCircle,
  ChevronDown, Loader2, Package, Sparkles,
} from 'lucide-react';
import type {
  Business, Product, DeliveryOrderPaymentMethod, DeliveryType,
  MenuCategory, SelectedModifier,
} from '@/lib/types';
import ProductDetailSheet from './ProductDetailSheet';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CartItem {
  id: string;                          // unique per configuration (product + modifiers hash)
  product: Product;
  quantity: number;
  notes: string;
  selectedModifiers?: SelectedModifier[];
  unitPrice: number;                   // base + calculated modifier price
  basePrice: number;                   // product.salePrice (reference)
}

type CheckoutStep = 'cart' | 'delivery' | 'contact' | 'success';

interface CheckoutForm {
  deliveryType: DeliveryType;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  name: string;
  phone: string;
  paymentMethod: DeliveryOrderPaymentMethod;
  changeFor: string;
  notes: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function isBusinessOpen(hours: NonNullable<Business['settings']>['openingHours']): boolean {
  if (!hours || hours.length < 7) return true;
  const now = new Date();
  const dow = now.getDay();
  const day = hours[dow];
  if (!day?.isOpen) return false;
  const [oh, om] = (day.openTime || '00:00').split(':').map(Number);
  const [ch, cm] = (day.closeTime || '23:59').split(':').map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= oh * 60 + om && nowMin <= ch * 60 + cm;
}

/** Minimum starting price for a product (used for products with modifiers) */
function startingPrice(product: Product): number {
  const base = product.salePrice || 0;
  if (!product.hasModifiers || !product.modifierGroups?.length) return base;
  // Sum of cheapest required option from each required group
  let minExtra = 0;
  for (const group of product.modifierGroups) {
    if (!group.required || group.minSelections < 1 || group.options.length === 0) continue;
    const cheapest = Math.min(...group.options.filter(o => o.available).map(o => o.additionalPrice));
    if (!isNaN(cheapest) && cheapest > 0) minExtra += cheapest * group.minSelections;
  }
  return base + minExtra;
}

const PAYMENT_OPTIONS: { value: DeliveryOrderPaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: 'pix', label: 'PIX', icon: QrCode },
  { value: 'cartao_credito', label: 'Crédito', icon: CreditCard },
  { value: 'cartao_debito', label: 'Débito', icon: CreditCard },
  { value: 'dinheiro', label: 'Dinheiro', icon: Banknote },
  { value: 'voucher', label: 'Vale', icon: Wallet },
];

const DIETARY_LABELS: Record<string, string> = {
  vegan: '🌿 Vegano', vegetarian: '🥗 Veg.', glutenfree: '🌾 S/ Glúten',
  lactosefree: '🥛 S/ Lactose', picante: '🌶️ Picante', alcool: '🍺 Álcool', kids: '👶 Kids',
};

const UNCATEGORIZED_ID = '__uncategorized__';

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProductImage({ src, name }: { src?: string; name: string }) {
  const [error, setError] = useState(false);
  if (!src || error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700">
        <Package className="w-7 h-7 text-gray-300 dark:text-gray-600" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className="w-full h-full object-cover"
      onError={() => setError(true)}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  business: Business;
  products: Product[];
  categories: MenuCategory[];
}

export default function CatalogClient({ business, products, categories }: Props) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [step, setStep] = useState<CheckoutStep>('cart');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);

  const { scrollY } = useScroll();
  const headerOpacity = useTransform(scrollY, [0, 120], [1, 0]);
  const headerScale = useTransform(scrollY, [0, 120], [1, 0.95]);

  const categoryRefs = useRef<Record<string, HTMLElement | null>>({});
  const pillsContainerRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [form, setForm] = useState<CheckoutForm>({
    deliveryType: 'entrega',
    cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '',
    name: '', phone: '',
    paymentMethod: 'pix',
    changeFor: '',
    notes: '',
  });

  const deliveryFee = business.settings?.aiAgent?.pedidos?.deliveryFee ?? 0;
  const isOpen = isBusinessOpen(business.settings?.openingHours);
  const businessName = business.nomeFantasia || business.razaoSocial;

  // ── Build category → products map ──────────────────────────────────────────
  const categoryList = useMemo(() => {
    // Start with formal categories
    const known = new Map<string, { id: string; name: string; color?: string; description?: string }>();
    categories.forEach(c => {
      if (c.isActive) known.set(c.id, { id: c.id, name: c.name, color: c.color, description: c.description });
    });
    // Also include string-based menuCategory for legacy products (fallback)
    const seen = new Set(known.values());
    const stringCats = new Set<string>();
    products.forEach(p => {
      if (p.menuCategoryId && known.has(p.menuCategoryId)) return;
      const cat = p.menuCategory || p.category;
      if (cat && !known.has(cat) && !stringCats.has(cat)) {
        stringCats.add(cat);
        known.set(cat, { id: cat, name: cat });
      }
    });
    return Array.from(known.values());
  }, [categories, products]);

  const productsByCategory = useMemo(() => {
    const map = new Map<string, Product[]>();
    const term = search.trim().toLowerCase();

    for (const p of products) {
      // Apply search filter
      if (term) {
        const hay = `${p.name} ${p.menuDescription || ''} ${p.description || ''}`.toLowerCase();
        if (!hay.includes(term)) continue;
      }
      const key = p.menuCategoryId
        || categoryList.find(c => c.name === (p.menuCategory || p.category))?.id
        || UNCATEGORIZED_ID;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }

    // Sort each category's products by name
    map.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    return map;
  }, [products, categoryList, search]);

  const visibleCategories = useMemo(() => {
    const list = categoryList.filter(c => (productsByCategory.get(c.id)?.length ?? 0) > 0);
    if ((productsByCategory.get(UNCATEGORIZED_ID)?.length ?? 0) > 0) {
      list.push({ id: UNCATEGORIZED_ID, name: 'Outros' });
    }
    return list;
  }, [categoryList, productsByCategory]);

  // ── Cart helpers ─────────────────────────────────────────────────────────────
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);
  const cartSubtotal = useMemo(() => cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0), [cart]);
  const cartTotal = useMemo(() => cartSubtotal + (form.deliveryType === 'entrega' ? deliveryFee : 0), [cartSubtotal, deliveryFee, form.deliveryType]);

  const addSimpleToCart = useCallback((product: Product) => {
    setCart(prev => {
      // Match existing entry (no modifiers → same product id)
      const key = product.id + ':plain';
      const idx = prev.findIndex(i => i.id === key);
      if (idx >= 0) {
        return prev.map((i, n) => n === idx ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        id: key,
        product,
        quantity: 1,
        notes: '',
        unitPrice: product.salePrice,
        basePrice: product.salePrice,
      }];
    });
  }, []);

  const addCustomToCart = useCallback((cartItem: CartItem) => {
    setCart(prev => {
      // Check if same config exists (by signature)
      const idx = prev.findIndex(i => i.id === cartItem.id);
      if (idx >= 0) {
        return prev.map((i, n) => n === idx ? { ...i, quantity: i.quantity + cartItem.quantity } : i);
      }
      return [...prev, cartItem];
    });
  }, []);

  const decreaseQty = useCallback((itemId: string) => {
    setCart(prev => {
      const idx = prev.findIndex(i => i.id === itemId);
      if (idx < 0) return prev;
      if (prev[idx].quantity === 1) return prev.filter((_, n) => n !== idx);
      return prev.map((i, n) => n === idx ? { ...i, quantity: i.quantity - 1 } : i);
    });
  }, []);

  const increaseQty = useCallback((itemId: string) => {
    setCart(prev => prev.map(i => i.id === itemId ? { ...i, quantity: i.quantity + 1 } : i));
  }, []);

  const handleProductClick = useCallback((product: Product) => {
    if (product.hasModifiers && product.modifierGroups?.length) {
      setDetailProduct(product);
      setEditingCartItem(null);
    } else {
      addSimpleToCart(product);
    }
  }, [addSimpleToCart]);

  const getQtyForProduct = useCallback((productId: string) => {
    return cart.filter(i => i.product.id === productId).reduce((s, i) => s + i.quantity, 0);
  }, [cart]);

  // ── Scroll spy for category pills ──────────────────────────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = visible[0].target.getAttribute('data-cat-id');
          if (id) setActiveCategory(id);
        }
      },
      { rootMargin: '-140px 0px -60% 0px', threshold: 0 },
    );
    Object.values(categoryRefs.current).forEach(ref => ref && observer.observe(ref));
    return () => observer.disconnect();
  }, [visibleCategories]);

  // Auto-scroll active pill into view
  useEffect(() => {
    const pill = pillRefs.current[activeCategory];
    if (pill && pillsContainerRef.current) {
      pill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeCategory]);

  function handleCategoryClick(catId: string) {
    setActiveCategory(catId);
    const el = categoryRefs.current[catId];
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 120;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }

  // ── CEP auto-fill ─────────────────────────────────────────────────────────
  const [cepLoading, setCepLoading] = useState(false);
  useEffect(() => {
    const cep = form.cep.replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoading(true);
    fetch(`https://viacep.com.br/ws/${cep}/json/`)
      .then(r => r.json())
      .then(d => {
        if (!d.erro) {
          setForm(f => ({ ...f, logradouro: d.logradouro || '', bairro: d.bairro || '', municipio: d.localidade || '', uf: d.uf || '' }));
        }
      })
      .catch(() => {})
      .finally(() => setCepLoading(false));
  }, [form.cep]);

  // ── Submit order ──────────────────────────────────────────────────────────
  async function handleSubmit() {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const items = cart.map(i => ({
        productId: i.product.id,
        productName: i.product.name,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        basePrice: i.basePrice,
        total: i.unitPrice * i.quantity,
        notes: i.notes || undefined,
        imageUrl: i.product.imageUrl || undefined,
        selectedModifiers: i.selectedModifiers,
      }));

      const res = await fetch('/api/orders/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          clientName: form.name.trim(),
          clientPhone: form.phone.replace(/\D/g, ''),
          items,
          deliveryType: form.deliveryType,
          deliveryAddress: form.deliveryType === 'entrega' ? {
            cep: form.cep, logradouro: form.logradouro, numero: form.numero,
            complemento: form.complemento || undefined, bairro: form.bairro,
            municipio: form.municipio, uf: form.uf,
          } : undefined,
          deliveryFee: form.deliveryType === 'entrega' ? deliveryFee : 0,
          paymentMethod: form.paymentMethod,
          changeFor: form.paymentMethod === 'dinheiro' && form.changeFor ? parseFloat(form.changeFor) : undefined,
          customerNotes: form.notes || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao realizar pedido');
      setOrderId(data.orderId);
      setOrderNumber(data.orderNumber);
      setStep('success');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setIsSubmitting(false);
    }
  }

  function openCheckout() {
    setStep('cart');
    setCheckoutOpen(true);
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const addressValid = form.deliveryType === 'retirada' || (
    form.logradouro.trim().length > 2 && form.numero.trim().length > 0 && form.municipio.trim().length > 0
  );
  const contactValid = form.name.trim().length >= 2 && form.phone.replace(/\D/g, '').length >= 10;

  return (
    <div className="min-h-[100dvh] bg-gray-50 dark:bg-gray-950">

      {/* ── Hero Header ────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-20 -left-20 w-72 h-72 bg-red-500/20 rounded-full blur-3xl" />
          <div className="absolute top-10 right-0 w-56 h-56 bg-red-600/10 rounded-full blur-3xl" />
        </div>

        <motion.div
          style={{ opacity: headerOpacity, scale: headerScale }}
          className="relative z-10 max-w-2xl mx-auto px-4 pt-8 pb-6 safe-top"
        >
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Logo */}
            <div className="relative flex-shrink-0">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden border-2 border-white/10 shadow-2xl bg-white">
                {business.logo ? (
                  <img src={business.logo} alt={businessName} className="w-full h-full object-contain p-1" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-red-500 to-red-700">
                    <span className="text-2xl font-black text-white">
                      {businessName.charAt(0)}
                    </span>
                  </div>
                )}
              </div>
              <div className={`absolute -bottom-1 -right-1 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isOpen ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-white animate-pulse' : 'bg-white/70'}`} />
                {isOpen ? 'Aberto' : 'Fechado'}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-2xl font-black text-white tracking-tight leading-tight">{businessName}</h1>
              {business.settings?.aiAgent?.businessDescription && (
                <p className="text-xs sm:text-sm text-gray-300 mt-0.5 line-clamp-2">
                  {business.settings.aiAgent.businessDescription}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                {deliveryFee > 0 && (
                  <span className="flex items-center gap-1 text-[11px] sm:text-xs text-gray-300">
                    <Truck className="w-3 h-3" /> Entrega {formatBRL(deliveryFee)}
                  </span>
                )}
                {deliveryFee === 0 && (
                  <span className="flex items-center gap-1 text-[11px] sm:text-xs text-emerald-400 font-medium">
                    <Truck className="w-3 h-3" /> Frete grátis
                  </span>
                )}
                {business.settings?.openingHours && (
                  <span className="flex items-center gap-1 text-[11px] sm:text-xs text-gray-400">
                    <Clock className="w-3 h-3" />
                    {isOpen ? 'Aceitando pedidos' : 'Fora do horário'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Search + Categories (sticky) ────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 pt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar no cardápio..."
              className="w-full pl-9 pr-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl text-[16px] leading-tight text-gray-900 dark:text-white placeholder-gray-400 border-none outline-none focus:ring-2 focus:ring-red-400/40 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1">
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            )}
          </div>
        </div>

        {/* Category pills */}
        {visibleCategories.length > 0 && (
          <div ref={pillsContainerRef} className="flex gap-2 px-4 py-2.5 overflow-x-auto scrollbar-hide max-w-2xl mx-auto">
            {visibleCategories.map(cat => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  ref={(el) => { pillRefs.current[cat.id] = el; }}
                  onClick={() => handleCategoryClick(cat.id)}
                  className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                    active
                      ? 'bg-red-500 text-white shadow-sm shadow-red-200 dark:shadow-red-900'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                  style={active && cat.color ? { backgroundColor: cat.color } : undefined}
                >
                  {cat.name}
                  <span className={`ml-1.5 text-[10px] font-bold ${active ? 'opacity-80' : 'opacity-60'}`}>
                    {productsByCategory.get(cat.id)?.length || 0}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Product List by Category ───────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 pb-[calc(8rem+env(safe-area-inset-bottom,0px))] pt-4">
        {visibleCategories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
              <Package className="w-7 h-7 text-gray-300" />
            </div>
            <p className="font-semibold text-gray-500 dark:text-gray-400">Nenhum item encontrado</p>
            {search && <p className="text-sm text-gray-400 mt-1">Tente outro termo de busca</p>}
          </div>
        ) : (
          <div className="space-y-6">
            {visibleCategories.map(cat => {
              const list = productsByCategory.get(cat.id) || [];
              if (list.length === 0) return null;
              return (
                <section
                  key={cat.id}
                  ref={(el) => { categoryRefs.current[cat.id] = el; }}
                  data-cat-id={cat.id}
                  className="scroll-mt-32"
                >
                  <div className="flex items-center gap-2 mb-3">
                    {cat.color && (
                      <div className="w-1 h-6 rounded-full" style={{ backgroundColor: cat.color }} />
                    )}
                    <h2 className="text-lg font-black text-gray-900 dark:text-white tracking-tight">
                      {cat.name}
                    </h2>
                    <span className="text-xs text-gray-400 font-medium">· {list.length}</span>
                  </div>
                  {cat.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 -mt-2">{cat.description}</p>
                  )}
                  <div className="space-y-2">
                    {list.map((product, i) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        qty={getQtyForProduct(product.id)}
                        onClick={() => handleProductClick(product)}
                        delay={Math.min(i * 0.03, 0.2)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Floating Cart Bar ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {cartCount > 0 && !checkoutOpen && !detailProduct && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-40 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
          >
            <button
              onClick={openCheckout}
              className="max-w-2xl mx-auto flex items-center justify-between w-full bg-red-500 hover:bg-red-600 active:scale-[0.98] text-white px-5 py-4 rounded-2xl shadow-2xl shadow-red-500/30 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <span className="font-bold">{cartCount} {cartCount === 1 ? 'item' : 'itens'}</span>
              </div>
              <span className="font-bold text-lg">{formatBRL(cartSubtotal)}</span>
              <div className="flex items-center gap-1">
                <span className="font-semibold text-sm">Ver pedido</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Product Detail Sheet ──────────────────────────────────────────── */}
      <AnimatePresence>
        {detailProduct && (
          <ProductDetailSheet
            product={detailProduct}
            initialCartItem={editingCartItem}
            onClose={() => { setDetailProduct(null); setEditingCartItem(null); }}
            onAdd={(cartItem) => {
              addCustomToCart(cartItem);
              setDetailProduct(null);
              setEditingCartItem(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Checkout Sheet ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {checkoutOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => step !== 'success' && setCheckoutOpen(false)}
            />

            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl max-h-[92dvh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 bg-gray-200 dark:bg-gray-700 rounded-full" />
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                <div className="flex items-center gap-3">
                  {step !== 'cart' && step !== 'success' && (
                    <button onClick={() => setStep(step === 'delivery' ? 'cart' : 'delivery')}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                      <ArrowLeft className="w-4 h-4 text-gray-500" />
                    </button>
                  )}
                  <h2 className="font-bold text-gray-900 dark:text-white">
                    {step === 'cart' ? 'Seu Pedido' : step === 'delivery' ? 'Entrega' : step === 'contact' ? 'Confirmar' : 'Pedido Realizado!'}
                  </h2>
                </div>
                {step !== 'success' && (
                  <button onClick={() => setCheckoutOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                )}
              </div>

              {step !== 'success' && (
                <div className="flex gap-1.5 px-5 py-2 flex-shrink-0">
                  {(['cart', 'delivery', 'contact'] as CheckoutStep[]).map((s, i) => (
                    <div key={s} className={`h-1 flex-1 rounded-full transition-all ${
                      ['cart', 'delivery', 'contact'].indexOf(step) >= i
                        ? 'bg-red-500' : 'bg-gray-100 dark:bg-gray-800'
                    }`} />
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto overscroll-contain">
                <AnimatePresence mode="wait">

                  {/* ── Step: Cart ─────────────────────────────────────────── */}
                  {step === 'cart' && (
                    <motion.div key="cart"
                      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      className="p-5 space-y-3 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
                      {cart.map(item => (
                        <div key={item.id} className="flex items-start gap-3 pb-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
                          <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0">
                            <ProductImage src={item.product.imageUrl} name={item.product.name} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-sm text-gray-900 dark:text-white">{item.product.name}</p>
                              <span className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap">
                                {formatBRL(item.unitPrice * item.quantity)}
                              </span>
                            </div>
                            {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {item.selectedModifiers.map(mod => (
                                  <p key={mod.groupId} className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
                                    <span className="font-medium">{mod.groupName}:</span>{' '}
                                    {mod.selectedOptions.map(o =>
                                      o.quantity > 1 ? `${o.quantity}× ${o.optionName}` : o.optionName
                                    ).join(', ')}
                                  </p>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 mt-2">
                              <button onClick={() => decreaseQty(item.id)}
                                className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                                <Minus className="w-3.5 h-3.5 text-gray-600 dark:text-gray-300" />
                              </button>
                              <span className="w-5 text-center text-sm font-bold text-gray-900 dark:text-white">{item.quantity}</span>
                              <button onClick={() => increaseQty(item.id)}
                                className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center">
                                <Plus className="w-3.5 h-3.5 text-white" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Notes */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 mt-4">
                          Observações gerais
                        </label>
                        <textarea
                          value={form.notes}
                          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                          rows={2}
                          placeholder="Alguma observação para o pedido?"
                          className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight resize-none outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                        />
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4 space-y-1.5 mt-2">
                        <div className="flex justify-between text-sm text-gray-500">
                          <span>Subtotal</span>
                          <span>{formatBRL(cartSubtotal)}</span>
                        </div>
                        {deliveryFee > 0 && form.deliveryType === 'entrega' && (
                          <div className="flex justify-between text-sm text-gray-500">
                            <span>Entrega</span>
                            <span>{formatBRL(deliveryFee)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-bold text-base pt-1.5 border-t border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                          <span>Total</span>
                          <span className="text-red-600 dark:text-red-400">{formatBRL(cartTotal)}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => setStep('delivery')}
                        className="w-full bg-red-500 hover:bg-red-600 active:scale-[0.98] text-white py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 mt-2"
                      >
                        Continuar <ChevronRight className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}

                  {/* ── Step: Delivery ─────────────────────────────────────── */}
                  {step === 'delivery' && (
                    <motion.div key="delivery"
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                      className="p-5 space-y-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">

                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                          Como prefere receber?
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { value: 'entrega', label: 'Entrega', sub: deliveryFee > 0 ? formatBRL(deliveryFee) : 'Grátis', icon: Truck },
                            { value: 'retirada', label: 'Retirada', sub: 'No local', icon: Store },
                          ] as const).map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setForm(f => ({ ...f, deliveryType: opt.value }))}
                              className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all ${
                                form.deliveryType === opt.value
                                  ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                              }`}
                            >
                              <opt.icon className={`w-5 h-5 ${form.deliveryType === opt.value ? 'text-red-500' : 'text-gray-400'}`} />
                              <div className="text-left">
                                <p className={`font-semibold text-sm ${form.deliveryType === opt.value ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
                                  {opt.label}
                                </p>
                                <p className="text-xs text-gray-400">{opt.sub}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <AnimatePresence>
                        {form.deliveryType === 'entrega' && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="space-y-3 overflow-hidden"
                          >
                            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">
                              Endereço de entrega
                            </label>
                            <div className="relative">
                              <input
                                value={form.cep}
                                onChange={e => setForm(f => ({ ...f, cep: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                                placeholder="CEP (apenas números)"
                                inputMode="numeric"
                                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                              />
                              {cepLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />}
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <input
                                value={form.logradouro}
                                onChange={e => setForm(f => ({ ...f, logradouro: e.target.value }))}
                                placeholder="Rua / Av."
                                className="col-span-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                              />
                              <input
                                value={form.numero}
                                onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
                                placeholder="Nº"
                                className="px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                              />
                            </div>
                            <input
                              value={form.complemento}
                              onChange={e => setForm(f => ({ ...f, complemento: e.target.value }))}
                              placeholder="Complemento (apto, bloco...)"
                              className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                            />
                            <div className="grid grid-cols-3 gap-2">
                              <input
                                value={form.bairro}
                                onChange={e => setForm(f => ({ ...f, bairro: e.target.value }))}
                                placeholder="Bairro"
                                className="px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                              />
                              <input
                                value={form.municipio}
                                onChange={e => setForm(f => ({ ...f, municipio: e.target.value }))}
                                placeholder="Cidade"
                                className="col-span-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <button
                        onClick={() => setStep('contact')}
                        disabled={!addressValid}
                        className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] text-white py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2"
                      >
                        Continuar <ChevronRight className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}

                  {/* ── Step: Contact + Payment ─────────────────────────────── */}
                  {step === 'contact' && (
                    <motion.div key="contact"
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                      className="p-5 space-y-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">

                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                          Seus dados
                        </label>
                        <div className="space-y-2">
                          <input
                            value={form.name}
                            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="Seu nome completo"
                            className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                          />
                          <input
                            value={form.phone}
                            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                            placeholder="WhatsApp (DDD + número)"
                            type="tel"
                            inputMode="tel"
                            className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                          Pagamento
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          {PAYMENT_OPTIONS.map(opt => {
                            const Icon = opt.icon;
                            return (
                              <button
                                key={opt.value}
                                onClick={() => setForm(f => ({ ...f, paymentMethod: opt.value }))}
                                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                                  form.paymentMethod === opt.value
                                    ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                                }`}
                              >
                                <Icon className={`w-4 h-4 ${form.paymentMethod === opt.value ? 'text-red-500' : 'text-gray-400'}`} />
                                <span className={`text-xs font-semibold ${form.paymentMethod === opt.value ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                                  {opt.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {form.paymentMethod === 'dinheiro' && (
                          <input
                            value={form.changeFor}
                            onChange={e => setForm(f => ({ ...f, changeFor: e.target.value }))}
                            placeholder="Troco para quanto? (opcional)"
                            type="number"
                            className="mt-2 w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                          />
                        )}
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4 space-y-1">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Resumo</p>
                        {cart.map(i => (
                          <div key={i.id} className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                            <span className="truncate pr-2">{i.quantity}× {i.product.name}</span>
                            <span className="whitespace-nowrap">{formatBRL(i.unitPrice * i.quantity)}</span>
                          </div>
                        ))}
                        {deliveryFee > 0 && form.deliveryType === 'entrega' && (
                          <div className="flex justify-between text-sm text-gray-500 pt-1 border-t border-gray-200 dark:border-gray-700">
                            <span>Entrega</span><span>{formatBRL(deliveryFee)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-black text-base pt-1.5 border-t border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                          <span>Total</span>
                          <span className="text-red-600 dark:text-red-400">{formatBRL(cartTotal)}</span>
                        </div>
                      </div>

                      {submitError && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                          <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
                        </div>
                      )}

                      <button
                        onClick={handleSubmit}
                        disabled={!contactValid || isSubmitting}
                        className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] text-white py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? (
                          <><Loader2 className="w-5 h-5 animate-spin" /> Enviando...</>
                        ) : (
                          <>Confirmar Pedido · {formatBRL(cartTotal)}</>
                        )}
                      </button>
                    </motion.div>
                  )}

                  {/* ── Step: Success ───────────────────────────────────────── */}
                  {step === 'success' && (
                    <motion.div key="success"
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center justify-center p-8 text-center py-12 pb-[calc(3rem+env(safe-area-inset-bottom,0px))]">
                      <motion.div
                        initial={{ scale: 0 }} animate={{ scale: 1 }}
                        transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.1 }}
                        className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center mb-6"
                      >
                        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                      </motion.div>
                      <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-2">
                        Pedido Recebido!
                      </h3>
                      {orderNumber && (
                        <div className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-full mb-3">
                          <span className="text-sm text-gray-500">Pedido</span>
                          <span className="font-black text-gray-900 dark:text-white">#{String(orderNumber).padStart(4, '0')}</span>
                        </div>
                      )}
                      <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs">
                        {businessName} recebeu seu pedido e logo entrará em contato pelo WhatsApp.
                      </p>
                      <div className="mt-6 space-y-2 w-full max-w-xs">
                        <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl text-left">
                          {form.deliveryType === 'entrega' ? <Truck className="w-4 h-4 text-red-500 flex-shrink-0" /> : <Store className="w-4 h-4 text-red-500 flex-shrink-0" />}
                          <div>
                            <p className="text-xs text-gray-400">Modalidade</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                              {form.deliveryType === 'entrega' ? 'Entrega' : 'Retirada no local'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl text-left">
                          <Wallet className="w-4 h-4 text-red-500 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400">Pagamento</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                              {PAYMENT_OPTIONS.find(p => p.value === form.paymentMethod)?.label} · {formatBRL(cartTotal)}
                            </p>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => { setCheckoutOpen(false); setCart([]); setStep('cart'); }}
                        className="mt-8 px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl font-bold transition-all hover:scale-[1.02]"
                      >
                        Voltar ao cardápio
                      </button>
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────

function ProductCard({
  product, qty, onClick, delay,
}: {
  product: Product;
  qty: number;
  onClick: () => void;
  delay: number;
}) {
  const outOfStock = product.currentStock <= 0 && product.currentStock !== undefined && !product.hasModifiers && !product.components?.length;
  const hasModifiers = !!product.hasModifiers && !!product.modifierGroups?.length;
  const price = hasModifiers ? startingPrice(product) : product.salePrice;

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      whileTap={{ scale: outOfStock ? 1 : 0.98 }}
      onClick={outOfStock ? undefined : onClick}
      disabled={outOfStock}
      className={`w-full text-left flex gap-3 bg-white dark:bg-gray-900 rounded-2xl p-3 shadow-sm border border-gray-100 dark:border-gray-800 transition-all ${
        outOfStock ? 'opacity-50 cursor-not-allowed' : 'hover:border-red-200 dark:hover:border-red-900/50 active:bg-gray-50 dark:active:bg-gray-800/50'
      }`}
    >
      {(product.imageUrl) && (
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-800 relative">
          <ProductImage src={product.imageUrl} name={product.name} />
          {qty > 0 && (
            <div className="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center shadow-lg">
              {qty}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">{product.name}</h3>
            {product.dietary && product.dietary.length > 0 && (
              <div className="flex gap-1 flex-shrink-0">
                {product.dietary.slice(0, 2).map(d => (
                  <span key={d} className="text-[9px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-md text-gray-500">
                    {DIETARY_LABELS[d]?.split(' ')[0] || d}
                  </span>
                ))}
              </div>
            )}
          </div>
          {(product.menuDescription || product.description) && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2">
              {product.menuDescription || product.description}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between mt-2">
          <div className="flex items-baseline gap-1.5">
            {hasModifiers && (
              <span className="text-[10px] text-gray-400 font-medium">A partir de</span>
            )}
            <span className="text-base font-black text-gray-900 dark:text-white">
              {formatBRL(price)}
            </span>
          </div>

          {outOfStock ? (
            <span className="text-xs text-gray-400 font-medium">Esgotado</span>
          ) : hasModifiers ? (
            <div className="flex items-center gap-1 px-3 py-1.5 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl text-xs font-semibold">
              <Sparkles className="w-3 h-3" />
              Montar
            </div>
          ) : (
            <div className="flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded-xl text-xs font-semibold shadow-sm shadow-red-200 dark:shadow-red-900/40">
              <Plus className="w-3 h-3" />
              Adicionar
            </div>
          )}
        </div>
      </div>
    </motion.button>
  );
}
