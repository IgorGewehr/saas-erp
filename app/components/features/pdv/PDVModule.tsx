'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  IconButton,
  Chip,
  Divider,
  Autocomplete,
  Tooltip,
  InputAdornment,
} from '@mui/material';
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  X,
  Trash2,
  User,
  Receipt,
  CreditCard,
  Banknote,
  Smartphone,
  Wallet,
  Tag,
  Package,
  Scissors,
  Sparkles,
  Droplets,
  Brush,
  Heart,
  Star,
  CheckCircle2,
  FileText,
  Keyboard,
  Hash,
  Percent,
  DollarSign,
  ChevronRight,
  Printer,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import type { Product, Service, Client, SaleItem, Payment, PaymentMethod } from '@/lib/types';

// ==========================================
// MOCK DATA
// ==========================================

const MOCK_PRODUCTS: (Product & { type: 'product' })[] = [
  { id: 'p1', businessId: 'b1', name: 'Shampoo Profissional 1L', description: '', sku: 'SHP001', barcode: '', category: 'Cabelo', unit: 'UN', costPrice: 35, salePrice: 65, currentStock: 24, minStock: 5, isActive: true, createdAt: '', updatedAt: '', type: 'product' },
  { id: 'p2', businessId: 'b1', name: 'Condicionador Hidratante 500ml', description: '', sku: 'CND001', barcode: '', category: 'Cabelo', unit: 'UN', costPrice: 28, salePrice: 52, currentStock: 18, minStock: 5, isActive: true, createdAt: '', updatedAt: '', type: 'product' },
  { id: 'p3', businessId: 'b1', name: 'Máscara Capilar 300g', description: '', sku: 'MSK001', barcode: '', category: 'Cabelo', unit: 'UN', costPrice: 42, salePrice: 89, currentStock: 12, minStock: 3, isActive: true, createdAt: '', updatedAt: '', type: 'product' },
  { id: 'p4', businessId: 'b1', name: 'Óleo de Argan 60ml', description: '', sku: 'OIL001', barcode: '', category: 'Cabelo', unit: 'UN', costPrice: 22, salePrice: 45, currentStock: 30, minStock: 8, isActive: true, createdAt: '', updatedAt: '', type: 'product' },
  { id: 'p5', businessId: 'b1', name: 'Creme para Mãos 200ml', description: '', sku: 'CRM001', barcode: '', category: 'Estética', unit: 'UN', costPrice: 15, salePrice: 35, currentStock: 40, minStock: 10, isActive: true, createdAt: '', updatedAt: '', type: 'product' },
  { id: 'p6', businessId: 'b1', name: 'Esmalte Premium', description: '', sku: 'ESM001', barcode: '', category: 'Unha', unit: 'UN', costPrice: 8, salePrice: 22, currentStock: 60, minStock: 15, isActive: true, createdAt: '', updatedAt: '', type: 'product' },
  { id: 'p7', businessId: 'b1', name: 'Kit Manicure Completo', description: '', sku: 'KIT001', barcode: '', category: 'Unha', unit: 'UN', costPrice: 85, salePrice: 159, currentStock: 8, minStock: 2, isActive: true, createdAt: '', updatedAt: '', type: 'product' },
  { id: 'p8', businessId: 'b1', name: 'Protetor Solar FPS 50', description: '', sku: 'SUN001', barcode: '', category: 'Estética', unit: 'UN', costPrice: 30, salePrice: 65, currentStock: 22, minStock: 5, isActive: true, createdAt: '', updatedAt: '', type: 'product' },
  { id: 'p9', businessId: 'b1', name: 'Gel Modelador Forte 300g', description: '', sku: 'GEL001', barcode: '', category: 'Cabelo', unit: 'UN', costPrice: 18, salePrice: 38, currentStock: 15, minStock: 5, isActive: true, createdAt: '', updatedAt: '', type: 'product' },
  { id: 'p10', businessId: 'b1', name: 'Removedor de Cutícula 30ml', description: '', sku: 'RMV001', barcode: '', category: 'Unha', unit: 'UN', costPrice: 6, salePrice: 15, currentStock: 35, minStock: 10, isActive: true, createdAt: '', updatedAt: '', type: 'product' },
];

const MOCK_SERVICES: (Service & { type: 'service' })[] = [
  { id: 's1', businessId: 'b1', name: 'Corte Feminino', description: '', duration: 60, price: 85, category: 'Cabelo', color: '#DC2626', isActive: true, createdAt: '', updatedAt: '', type: 'service' },
  { id: 's2', businessId: 'b1', name: 'Corte Masculino', description: '', duration: 30, price: 55, category: 'Cabelo', color: '#DC2626', isActive: true, createdAt: '', updatedAt: '', type: 'service' },
  { id: 's3', businessId: 'b1', name: 'Escova Progressiva', description: '', duration: 180, price: 280, category: 'Cabelo', color: '#F59E0B', isActive: true, createdAt: '', updatedAt: '', type: 'service' },
  { id: 's4', businessId: 'b1', name: 'Coloração Completa', description: '', duration: 120, price: 190, category: 'Cabelo', color: '#8B5CF6', isActive: true, createdAt: '', updatedAt: '', type: 'service' },
  { id: 's5', businessId: 'b1', name: 'Mechas / Luzes', description: '', duration: 150, price: 250, category: 'Cabelo', color: '#F59E0B', isActive: true, createdAt: '', updatedAt: '', type: 'service' },
  { id: 's6', businessId: 'b1', name: 'Manicure', description: '', duration: 45, price: 40, category: 'Unha', color: '#EC4899', isActive: true, createdAt: '', updatedAt: '', type: 'service' },
  { id: 's7', businessId: 'b1', name: 'Pedicure', description: '', duration: 50, price: 45, category: 'Unha', color: '#EC4899', isActive: true, createdAt: '', updatedAt: '', type: 'service' },
  { id: 's8', businessId: 'b1', name: 'Limpeza de Pele', description: '', duration: 90, price: 120, category: 'Estética', color: '#10B981', isActive: true, createdAt: '', updatedAt: '', type: 'service' },
  { id: 's9', businessId: 'b1', name: 'Design de Sobrancelha', description: '', duration: 30, price: 35, category: 'Estética', color: '#10B981', isActive: true, createdAt: '', updatedAt: '', type: 'service' },
  { id: 's10', businessId: 'b1', name: 'Hidratação Capilar', description: '', duration: 60, price: 95, category: 'Cabelo', color: '#3B82F6', isActive: true, createdAt: '', updatedAt: '', type: 'service' },
];

const MOCK_CLIENTS: Client[] = [
  { id: 'c1', businessId: 'b1', tipo: 'pf', nome: 'Maria Silva', cpfCnpj: '12345678901', email: 'maria@email.com', phone: '11999887766', isActive: true, totalSpent: 2450, visitCount: 12, lastVisit: '2026-03-10', createdAt: '', updatedAt: '' },
  { id: 'c2', businessId: 'b1', tipo: 'pf', nome: 'João Santos', cpfCnpj: '98765432100', email: 'joao@email.com', phone: '11988776655', isActive: true, totalSpent: 890, visitCount: 5, lastVisit: '2026-03-08', createdAt: '', updatedAt: '' },
  { id: 'c3', businessId: 'b1', tipo: 'pf', nome: 'Ana Oliveira', cpfCnpj: '11122233344', email: 'ana@email.com', phone: '11977665544', isActive: true, totalSpent: 3200, visitCount: 18, lastVisit: '2026-03-12', createdAt: '', updatedAt: '' },
  { id: 'c4', businessId: 'b1', tipo: 'pf', nome: 'Pedro Costa', cpfCnpj: '55566677788', phone: '11966554433', isActive: true, totalSpent: 420, visitCount: 3, createdAt: '', updatedAt: '' },
  { id: 'c5', businessId: 'b1', tipo: 'pf', nome: 'Carla Mendes', cpfCnpj: '99988877766', phone: '11955443322', isActive: true, totalSpent: 1580, visitCount: 9, lastVisit: '2026-03-11', createdAt: '', updatedAt: '' },
  { id: 'c6', businessId: 'b1', tipo: 'pj', nome: 'Salão Beleza & Cia', cpfCnpj: '12345678000190', phone: '1133224455', isActive: true, totalSpent: 5600, visitCount: 4, createdAt: '', updatedAt: '' },
];

type CatalogItem = (Product & { type: 'product' }) | (Service & { type: 'service' });

const CATEGORIES = ['Todos', 'Cabelo', 'Unha', 'Estética'];

function getCategoryIcon(category: string) {
  const icons: Record<string, React.ReactNode> = {
    Cabelo: <Scissors size={16} />,
    Unha: <Sparkles size={16} />,
    Estética: <Heart size={16} />,
    Todos: <Star size={16} />,
  };
  return icons[category] || <Tag size={16} />;
}

function getItemIcon(item: CatalogItem) {
  if (item.type === 'product') {
    const icons: Record<string, React.ReactNode> = {
      Cabelo: <Droplets size={20} className="text-blue-500" />,
      Unha: <Sparkles size={20} className="text-pink-500" />,
      Estética: <Heart size={20} className="text-emerald-500" />,
    };
    return icons[item.category] || <Package size={20} className="text-slate-400" />;
  }
  const icons: Record<string, React.ReactNode> = {
    Cabelo: <Scissors size={20} className="text-red-500" />,
    Unha: <Brush size={20} className="text-pink-500" />,
    Estética: <Heart size={20} className="text-emerald-500" />,
  };
  return icons[(item as Service & { type: 'service' }).category || ''] || <Star size={20} className="text-amber-500" />;
}

// ==========================================
// COMPONENT
// ==========================================

interface CartItem extends SaleItem {
  itemType: 'product' | 'service';
}

export default function PDVModule() {
  // --- State ---
  const [activeTab, setActiveTab] = useState<'produtos' | 'servicos'>('produtos');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [discountValue, setDiscountValue] = useState('');
  const [discountType, setDiscountType] = useState<'reais' | 'percent'>('reais');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activePaymentMethod, setActivePaymentMethod] = useState<PaymentMethod | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [saleComplete, setSaleComplete] = useState(false);
  const [saleNumber, setSaleNumber] = useState(1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // --- Derived ---
  const catalogItems: CatalogItem[] = useMemo(() => {
    const items: CatalogItem[] = activeTab === 'produtos' ? MOCK_PRODUCTS : MOCK_SERVICES;
    return items.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategory === 'Todos' || item.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [activeTab, searchQuery, activeCategory]);

  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  }, [cart]);

  const discountAmount = useMemo(() => {
    const val = parseFloat(discountValue) || 0;
    if (discountType === 'percent') {
      return (subtotal * val) / 100;
    }
    return val;
  }, [discountValue, discountType, subtotal]);

  const total = useMemo(() => {
    return Math.max(0, subtotal - discountAmount);
  }, [subtotal, discountAmount]);

  const totalPaid = useMemo(() => {
    return payments.reduce((sum, p) => sum + p.amount, 0);
  }, [payments]);

  const remaining = useMemo(() => {
    return Math.max(0, total - totalPaid);
  }, [total, totalPaid]);

  const change = useMemo(() => {
    if (totalPaid > total) return totalPaid - total;
    return 0;
  }, [totalPaid, total]);

  const cartItemCount = useCallback(
    (itemId: string) => {
      const found = cart.find((c) => c.productId === itemId || c.serviceId === itemId);
      return found?.quantity || 0;
    },
    [cart],
  );

  // --- Handlers ---
  const addToCart = useCallback((item: CatalogItem) => {
    setCart((prev) => {
      const idField = item.type === 'product' ? 'productId' : 'serviceId';
      const existing = prev.find((c) => c[idField] === item.id);
      if (existing) {
        return prev.map((c) =>
          c[idField] === item.id
            ? { ...c, quantity: c.quantity + 1, total: (c.quantity + 1) * c.unitPrice }
            : c,
        );
      }
      const price = item.type === 'product' ? (item as Product).salePrice : (item as Service).price;
      const newItem: CartItem = {
        id: `cart-${Date.now()}`,
        productId: item.type === 'product' ? item.id : undefined,
        serviceId: item.type === 'service' ? item.id : undefined,
        description: item.name,
        quantity: 1,
        unitPrice: price,
        discount: 0,
        total: price,
        itemType: item.type,
      };
      return [...prev, newItem];
    });
  }, []);

  const updateQuantity = useCallback((cartItemId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((c) => {
          if (c.id !== cartItemId) return c;
          const newQty = c.quantity + delta;
          if (newQty <= 0) return null;
          return { ...c, quantity: newQty, total: newQty * c.unitPrice };
        })
        .filter(Boolean) as CartItem[];
    });
  }, []);

  const removeFromCart = useCallback((cartItemId: string) => {
    setCart((prev) => prev.filter((c) => c.id !== cartItemId));
  }, []);

  const addPayment = useCallback(() => {
    if (!activePaymentMethod || !paymentAmount) return;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) return;
    setPayments((prev) => [...prev, { method: activePaymentMethod, amount }]);
    setPaymentAmount('');
    setActivePaymentMethod(null);
  }, [activePaymentMethod, paymentAmount]);

  const removePayment = useCallback((index: number) => {
    setPayments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const finalizeSale = useCallback(() => {
    if (cart.length === 0 || remaining > 0.01) return;
    setShowConfirmation(true);
  }, [cart.length, remaining]);

  const confirmSale = useCallback(() => {
    setSaleComplete(true);
    setTimeout(() => {
      setSaleComplete(false);
      setShowConfirmation(false);
      setCart([]);
      setPayments([]);
      setSelectedClient(null);
      setDiscountValue('');
      setActivePaymentMethod(null);
      setPaymentAmount('');
      setSaleNumber((n) => n + 1);
    }, 2500);
  }, []);

  const cancelSale = useCallback(() => {
    setCart([]);
    setPayments([]);
    setSelectedClient(null);
    setDiscountValue('');
    setActivePaymentMethod(null);
    setPaymentAmount('');
  }, []);

  const paymentMethodConfig: { method: PaymentMethod; label: string; icon: React.ReactNode }[] = [
    { method: 'dinheiro', label: 'Dinheiro', icon: <Banknote size={18} /> },
    { method: 'pix', label: 'PIX', icon: <Smartphone size={18} /> },
    { method: 'credito', label: 'Crédito', icon: <CreditCard size={18} /> },
    { method: 'debito', label: 'Débito', icon: <Wallet size={18} /> },
  ];

  const paymentMethodLabels: Record<PaymentMethod, string> = {
    dinheiro: 'Dinheiro',
    pix: 'PIX',
    credito: 'Crédito',
    debito: 'Débito',
    boleto: 'Boleto',
    outros: 'Outros',
  };

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div className="h-full flex flex-col lg:flex-row gap-0 bg-slate-50 min-h-[calc(100vh-80px)]">
      {/* ========== LEFT PANEL - Catalog ========== */}
      <div className="w-full lg:w-[60%] flex flex-col border-r border-slate-200 bg-white">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-display font-bold text-slate-900">PDV</h1>
              <p className="text-sm text-slate-500 mt-0.5">Ponto de Venda</p>
            </div>
            <Tooltip title="Atalhos: Enter para buscar, Esc para limpar">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                <Keyboard size={14} />
                <span>Atalhos</span>
              </div>
            </Tooltip>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Buscar produto ou serviço..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
            />
          </div>
        </div>

        {/* Product/Service Tabs */}
        <div className="px-6 pt-4 pb-0">
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
            <button
              onClick={() => { setActiveTab('produtos'); setActiveCategory('Todos'); setSearchQuery(''); }}
              className={cn(
                'px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
                activeTab === 'produtos'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Package size={16} />
              Produtos
            </button>
            <button
              onClick={() => { setActiveTab('servicos'); setActiveCategory('Todos'); setSearchQuery(''); }}
              className={cn(
                'px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
                activeTab === 'servicos'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Scissors size={16} />
              Serviços
            </button>
          </div>
        </div>

        {/* Category Filters */}
        <div className="px-6 py-3">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border',
                  activeCategory === cat
                    ? 'bg-red-50 text-red-600 border-red-200'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700',
                )}
              >
                {getCategoryIcon(cat)}
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Product/Service Grid */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
            <AnimatePresence mode="popLayout">
              {catalogItems.map((item, index) => {
                const price = item.type === 'product'
                  ? (item as Product).salePrice
                  : (item as Service).price;
                const inCartQty = cartItemCount(item.id);
                return (
                  <motion.button
                    key={item.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.15, delay: index * 0.02 }}
                    whileHover={{ y: -2, boxShadow: '0 8px 25px -5px rgba(0,0,0,0.08)' }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => addToCart(item)}
                    className={cn(
                      'relative flex flex-col items-start p-4 rounded-xl border transition-colors text-left',
                      inCartQty > 0
                        ? 'bg-red-50/50 border-red-200'
                        : 'bg-white border-slate-200 hover:border-slate-300',
                    )}
                  >
                    {inCartQty > 0 && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md"
                      >
                        {inCartQty}
                      </motion.div>
                    )}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                        {getItemIcon(item)}
                      </div>
                    </div>
                    <span className="text-sm font-medium text-slate-900 leading-tight mb-1 line-clamp-2">
                      {item.name}
                    </span>
                    <div className="flex items-center gap-2 mt-auto pt-1">
                      <span className="text-base font-bold text-red-600">
                        {formatCurrency(price)}
                      </span>
                    </div>
                    {item.type === 'product' && (
                      <span className="text-[10px] text-slate-400 mt-1">
                        Estoque: {(item as Product).currentStock}
                      </span>
                    )}
                    {item.type === 'service' && (
                      <span className="text-[10px] text-slate-400 mt-1">
                        {(item as Service).duration} min
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>

          {catalogItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Search size={40} strokeWidth={1.5} />
              <p className="mt-3 text-sm">Nenhum item encontrado</p>
            </div>
          )}
        </div>
      </div>

      {/* ========== RIGHT PANEL - Cart/Checkout ========== */}
      <div className="w-full lg:w-[40%] flex flex-col bg-white">
        {/* Cart Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
                <ShoppingCart size={18} className="text-red-600" />
              </div>
              <div>
                <h2 className="text-lg font-display font-bold text-slate-900">
                  Venda <span className="text-red-600">#{String(saleNumber).padStart(3, '0')}</span>
                </h2>
              </div>
            </div>
            <Chip
              label={`${cart.length} ${cart.length === 1 ? 'item' : 'itens'}`}
              size="small"
              sx={{
                backgroundColor: cart.length > 0 ? '#FEF2F2' : '#F1F5F9',
                color: cart.length > 0 ? '#DC2626' : '#64748B',
                fontWeight: 600,
                fontSize: '0.75rem',
              }}
            />
          </div>

          {/* Client Selector */}
          <Autocomplete
            options={MOCK_CLIENTS}
            getOptionLabel={(option) => option.nome}
            value={selectedClient}
            onChange={(_, value) => setSelectedClient(value)}
            size="small"
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Selecionar cliente (opcional)"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <InputAdornment position="start">
                        <User size={16} className="text-slate-400" />
                      </InputAdornment>
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '12px',
                    backgroundColor: '#F8FAFC',
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#CBD5E1' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                  },
                }}
              />
            )}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <div className="flex items-center gap-3 py-1">
                  <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-xs font-bold text-red-600">
                    {option.nome.split(' ').map(n => n[0]).slice(0, 2).join('')}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{option.nome}</p>
                    <p className="text-xs text-slate-400">{option.visitCount} visitas</p>
                  </div>
                </div>
              </li>
            )}
            noOptionsText="Nenhum cliente encontrado"
          />
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <AnimatePresence mode="popLayout">
            {cart.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-16 text-slate-300"
              >
                <ShoppingCart size={48} strokeWidth={1.2} />
                <p className="mt-3 text-sm text-slate-400">Carrinho vazio</p>
                <p className="text-xs text-slate-300 mt-1">Clique em um produto ou serviço para adicionar</p>
              </motion.div>
            ) : (
              <div className="space-y-2">
                {cart.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{item.description}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatCurrency(item.unitPrice)} cada
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:border-red-300 hover:text-red-600 transition-colors"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold text-slate-900">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:border-red-300 hover:text-red-600 transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <p className="text-sm font-bold text-slate-900 w-20 text-right">
                      {formatCurrency(item.unitPrice * item.quantity)}
                    </p>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:bg-red-50 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Checkout Section */}
        {cart.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-t border-slate-200 bg-slate-50/50 px-6 py-4"
          >
            {/* Subtotal & Discount */}
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600 whitespace-nowrap">Desconto</span>
                <div className="flex-1 flex items-center gap-1">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      placeholder="0"
                      min="0"
                      className="w-full pl-3 pr-8 py-1.5 bg-white border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                    />
                  </div>
                  <div className="flex p-0.5 bg-white border border-slate-200 rounded-lg">
                    <button
                      onClick={() => setDiscountType('reais')}
                      className={cn(
                        'px-2 py-1 rounded-md text-xs font-medium transition-colors',
                        discountType === 'reais'
                          ? 'bg-red-600 text-white'
                          : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      R$
                    </button>
                    <button
                      onClick={() => setDiscountType('percent')}
                      className={cn(
                        'px-2 py-1 rounded-md text-xs font-medium transition-colors',
                        discountType === 'percent'
                          ? 'bg-red-600 text-white'
                          : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      %
                    </button>
                  </div>
                </div>
                {discountAmount > 0 && (
                  <span className="text-sm font-medium text-red-600 whitespace-nowrap">
                    -{formatCurrency(discountAmount)}
                  </span>
                )}
              </div>
              <Divider sx={{ my: 1 }} />
              <div className="flex justify-between items-center">
                <span className="text-lg font-bold text-slate-900">Total</span>
                <motion.span
                  key={total}
                  initial={{ scale: 1.1 }}
                  animate={{ scale: 1 }}
                  className="text-2xl font-display font-bold text-red-600"
                >
                  {formatCurrency(total)}
                </motion.span>
              </div>
            </div>

            {/* Payment Methods */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Pagamento
              </p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {paymentMethodConfig.map((pm) => (
                  <button
                    key={pm.method}
                    onClick={() => {
                      setActivePaymentMethod(pm.method);
                      if (!paymentAmount) {
                        setPaymentAmount(remaining.toFixed(2));
                      }
                    }}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl border text-xs font-medium transition-all',
                      activePaymentMethod === pm.method
                        ? 'bg-red-50 border-red-300 text-red-600'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300',
                    )}
                  >
                    {pm.icon}
                    <span>{pm.label}</span>
                  </button>
                ))}
              </div>

              {activePaymentMethod && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="flex gap-2 mb-3"
                >
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">R$</span>
                    <input
                      type="number"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="0,00"
                      className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                    />
                  </div>
                  <Button
                    onClick={addPayment}
                    variant="contained"
                    size="small"
                    sx={{
                      backgroundColor: '#DC2626',
                      '&:hover': { backgroundColor: '#B91C1C' },
                      borderRadius: '12px',
                      textTransform: 'none',
                      fontWeight: 600,
                      minWidth: 80,
                    }}
                  >
                    Adicionar
                  </Button>
                </motion.div>
              )}

              {/* Payment List */}
              {payments.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {payments.map((p, idx) => (
                    <div key={idx} className="flex items-center justify-between py-1.5 px-3 bg-emerald-50 rounded-lg border border-emerald-100">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={14} className="text-emerald-500" />
                        <span className="text-sm text-emerald-800 font-medium">
                          {paymentMethodLabels[p.method]}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-emerald-700">
                          {formatCurrency(p.amount)}
                        </span>
                        <button
                          onClick={() => removePayment(idx)}
                          className="text-emerald-400 hover:text-red-500 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Remaining / Change */}
              {payments.length > 0 && (
                <div className="flex justify-between text-sm py-2 px-3 bg-slate-100 rounded-lg">
                  {remaining > 0.01 ? (
                    <>
                      <span className="text-slate-600">Falta</span>
                      <span className="font-bold text-amber-600">{formatCurrency(remaining)}</span>
                    </>
                  ) : change > 0 ? (
                    <>
                      <span className="text-slate-600">Troco</span>
                      <span className="font-bold text-emerald-600">{formatCurrency(change)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-600">Pagamento</span>
                      <span className="font-bold text-emerald-600">Completo</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={cancelSale}
                variant="outlined"
                sx={{
                  color: '#64748B',
                  borderColor: '#CBD5E1',
                  '&:hover': { borderColor: '#94A3B8', backgroundColor: '#F8FAFC' },
                  borderRadius: '12px',
                  textTransform: 'none',
                  fontWeight: 600,
                  flex: 1,
                }}
              >
                Cancelar
              </Button>
              <Tooltip title="Emitir Nota Fiscal">
                <IconButton
                  sx={{
                    border: '1px solid #CBD5E1',
                    borderRadius: '12px',
                    color: '#64748B',
                    '&:hover': { borderColor: '#94A3B8', backgroundColor: '#F8FAFC' },
                  }}
                >
                  <FileText size={18} />
                </IconButton>
              </Tooltip>
              <Button
                onClick={finalizeSale}
                variant="contained"
                disabled={cart.length === 0 || remaining > 0.01}
                sx={{
                  backgroundColor: '#DC2626',
                  '&:hover': { backgroundColor: '#B91C1C' },
                  '&.Mui-disabled': { backgroundColor: '#FCA5A5', color: '#fff' },
                  borderRadius: '12px',
                  textTransform: 'none',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  flex: 2,
                  py: 1.3,
                }}
              >
                Finalizar Venda
              </Button>
            </div>
          </motion.div>
        )}
      </div>

      {/* ========== CONFIRMATION DIALOG ========== */}
      <Dialog
        open={showConfirmation}
        onClose={() => !saleComplete && setShowConfirmation(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '20px', overflow: 'hidden' } }}
      >
        <AnimatePresence mode="wait">
          {saleComplete ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-16 px-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
              >
                <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-6">
                  <CheckCircle2 size={40} className="text-emerald-500" />
                </div>
              </motion.div>
              <motion.h3
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-xl font-display font-bold text-slate-900 mb-2"
              >
                Venda Finalizada!
              </motion.h3>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-sm text-slate-500"
              >
                Venda #{String(saleNumber).padStart(3, '0')} registrada com sucesso
              </motion.p>
            </motion.div>
          ) : (
            <motion.div
              key="confirm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <DialogTitle
                sx={{
                  fontFamily: '"Plus Jakarta Sans", sans-serif',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div className="flex items-center gap-3">
                  <Receipt size={20} className="text-red-600" />
                  <span>Confirmar Venda</span>
                </div>
                <IconButton onClick={() => setShowConfirmation(false)} size="small">
                  <X size={18} />
                </IconButton>
              </DialogTitle>
              <Divider />
              <DialogContent>
                <div className="space-y-4 py-2">
                  {/* Receipt Preview */}
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="text-center mb-4">
                      <p className="text-xs text-slate-400 uppercase tracking-widest">Resumo da Venda</p>
                      <p className="text-sm font-bold text-slate-900 mt-1">
                        Venda #{String(saleNumber).padStart(3, '0')}
                      </p>
                      {selectedClient && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          Cliente: {selectedClient.nome}
                        </p>
                      )}
                    </div>
                    <Divider sx={{ my: 1.5, borderStyle: 'dashed' }} />
                    <div className="space-y-2">
                      {cart.map((item) => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <div className="flex-1 min-w-0">
                            <span className="text-slate-700 truncate block">{item.description}</span>
                            <span className="text-xs text-slate-400">{item.quantity}x {formatCurrency(item.unitPrice)}</span>
                          </div>
                          <span className="font-medium text-slate-900 ml-4">
                            {formatCurrency(item.unitPrice * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <Divider sx={{ my: 1.5, borderStyle: 'dashed' }} />
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm text-slate-600">
                        <span>Subtotal</span>
                        <span>{formatCurrency(subtotal)}</span>
                      </div>
                      {discountAmount > 0 && (
                        <div className="flex justify-between text-sm text-red-600">
                          <span>Desconto</span>
                          <span>-{formatCurrency(discountAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-bold text-slate-900 pt-1">
                        <span>Total</span>
                        <span>{formatCurrency(total)}</span>
                      </div>
                    </div>
                    <Divider sx={{ my: 1.5, borderStyle: 'dashed' }} />
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-500 uppercase">Pagamento</p>
                      {payments.map((p, idx) => (
                        <div key={idx} className="flex justify-between text-sm text-slate-700">
                          <span>{paymentMethodLabels[p.method]}</span>
                          <span>{formatCurrency(p.amount)}</span>
                        </div>
                      ))}
                      {change > 0 && (
                        <div className="flex justify-between text-sm text-emerald-600 font-medium">
                          <span>Troco</span>
                          <span>{formatCurrency(change)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </DialogContent>
              <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
                <Tooltip title="Imprimir recibo">
                  <IconButton
                    sx={{
                      border: '1px solid #E2E8F0',
                      borderRadius: '12px',
                      color: '#64748B',
                    }}
                  >
                    <Printer size={18} />
                  </IconButton>
                </Tooltip>
                <div className="flex-1" />
                <Button
                  onClick={() => setShowConfirmation(false)}
                  sx={{ color: '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '12px' }}
                >
                  Voltar
                </Button>
                <Button
                  onClick={confirmSale}
                  variant="contained"
                  sx={{
                    backgroundColor: '#DC2626',
                    '&:hover': { backgroundColor: '#B91C1C' },
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 700,
                    px: 4,
                  }}
                >
                  Confirmar Venda
                </Button>
              </DialogActions>
            </motion.div>
          )}
        </AnimatePresence>
      </Dialog>
    </div>
  );
}
