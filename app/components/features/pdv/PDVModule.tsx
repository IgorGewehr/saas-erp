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
  User,
  Receipt,
  CreditCard,
  Banknote,
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
  ChevronRight,
  Printer,
  QrCode,
  MoreHorizontal,
  AlertCircle,
  Loader2,
  History,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime, generateId } from '@/lib/utils/format';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, doc } from 'firebase/firestore';
import { deductStock } from '@/lib/services/stock';
import { db } from '@/lib/config/firebase';
import type { Product, Service, CRMContact, Sale, SaleItem, Payment, PaymentMethod } from '@/lib/types';

// ==========================================
// TYPES & CONSTANTS
// ==========================================

type CatalogItem = (Product & { type: 'product' }) | (Service & { type: 'service' });

type MainView = 'pdv' | 'historico';

const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: React.ReactNode }[] = [
  { value: 'dinheiro', label: 'Dinheiro', icon: <Banknote size={18} /> },
  { value: 'pix', label: 'PIX', icon: <QrCode size={18} /> },
  { value: 'credito', label: 'Credito', icon: <CreditCard size={18} /> },
  { value: 'debito', label: 'Debito', icon: <Wallet size={18} /> },
  { value: 'boleto', label: 'Boleto', icon: <FileText size={18} /> },
  { value: 'outros', label: 'Outros', icon: <MoreHorizontal size={18} /> },
];

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  credito: 'Credito',
  debito: 'Debito',
  boleto: 'Boleto',
  outros: 'Outros',
};

function getCategoryIcon(category: string) {
  const icons: Record<string, React.ReactNode> = {
    Cabelo: <Scissors size={16} />,
    Unha: <Sparkles size={16} />,
    Estetica: <Heart size={16} />,
    Todos: <Star size={16} />,
  };
  return icons[category] || <Tag size={16} />;
}

function getItemIcon(item: CatalogItem) {
  if (item.type === 'product') {
    const icons: Record<string, React.ReactNode> = {
      Cabelo: <Droplets size={20} className="text-blue-500" />,
      Unha: <Sparkles size={20} className="text-pink-500" />,
      Estetica: <Heart size={20} className="text-emerald-500" />,
    };
    return icons[item.category] || <Package size={20} className="text-slate-400 dark:text-gray-500" />;
  }
  const icons: Record<string, React.ReactNode> = {
    Cabelo: <Scissors size={20} className="text-red-500" />,
    Unha: <Brush size={20} className="text-pink-500" />,
    Estetica: <Heart size={20} className="text-emerald-500" />,
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
  const { t } = useTranslation();

  const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: React.ReactNode }[] = useMemo(() => [
    { value: 'dinheiro', label: t('pdv.payment.cash', 'Dinheiro'), icon: <Banknote size={18} /> },
    { value: 'pix', label: t('pdv.payment.pix', 'PIX'), icon: <QrCode size={18} /> },
    { value: 'credito', label: t('pdv.payment.credit', 'Crédito'), icon: <CreditCard size={18} /> },
    { value: 'debito', label: t('pdv.payment.debit', 'Débito'), icon: <Wallet size={18} /> },
    { value: 'boleto', label: t('pdv.payment.boleto', 'Boleto'), icon: <FileText size={18} /> },
    { value: 'outros', label: t('pdv.payment.other', 'Outros'), icon: <MoreHorizontal size={18} /> },
  ], [t]);

  const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = useMemo(() => ({
    dinheiro: t('pdv.payment.cash', 'Dinheiro'),
    pix: t('pdv.payment.pix', 'PIX'),
    credito: t('pdv.payment.credit', 'Crédito'),
    debito: t('pdv.payment.debit', 'Débito'),
    boleto: t('pdv.payment.boleto', 'Boleto'),
    outros: t('pdv.payment.other', 'Outros'),
  }), [t]);

  const { isDark } = useTheme();
  const { user, business } = useAuth();
  const queryClient = useQueryClient();

  // --- Main view ---
  const [mainView, setMainView] = useState<MainView>('pdv');

  // --- State ---
  const [activeTab, setActiveTab] = useState<'produtos' | 'servicos'>('produtos');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState(t('pdv.catalog.all', 'Todos'));
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedClient, setSelectedClient] = useState<CRMContact | null>(null);
  const [discountValue, setDiscountValue] = useState('');
  const [discountType, setDiscountType] = useState<'reais' | 'percent'>('reais');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [activePaymentMethod, setActivePaymentMethod] = useState<PaymentMethod | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [installments, setInstallments] = useState(1);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [saleComplete, setSaleComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);

  // NFC-e state
  const [emitirNfce, setEmitirNfce] = useState(false);
  const [cpfConsumidor, setCpfConsumidor] = useState('');
  const [nfceModalState, setNfceModalState] = useState<'idle' | 'emitting' | 'authorized' | 'error'>('idle');
  const [nfceResult, setNfceResult] = useState<{ accessKey?: string; danfeUrl?: string; error?: string } | null>(null);
  const pendingNfceRef = useRef<{
    saleId: string;
    cart: CartItem[];
    total: number;
    payments: Payment[];
    clientName: string;
    cpf: string;
  } | null>(null);

  // History view state
  const [historySearch, setHistorySearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => {
    if (mainView === 'pdv') {
      searchInputRef.current?.focus();
    }
  }, [mainView]);

  // --- Firestore Queries ---
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['products', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'products'),
        where('businessId', '==', business!.id),
        where('isActive', '==', true),
        orderBy('name', 'asc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Product));
    },
    enabled: !!business?.id,
  });

  const { data: services = [], isLoading: loadingServices } = useQuery({
    queryKey: ['services', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'services'),
        where('businessId', '==', business!.id),
        where('isActive', '==', true),
        orderBy('name', 'asc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Service));
    },
    enabled: !!business?.id,
  });

  const { data: clients = [], isLoading: loadingClients } = useQuery({
    queryKey: ['clients', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'clients'),
        where('businessId', '==', business!.id),
        where('isActive', '==', true),
        orderBy('name', 'asc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as CRMContact));
    },
    enabled: !!business?.id,
  });

  const { data: salesHistory = [], isLoading: loadingSales } = useQuery({
    queryKey: ['sales', business?.id],
    queryFn: async () => {
      const q = query(
        collection(db, 'sales'),
        where('businessId', '==', business!.id),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Sale));
    },
    enabled: !!business?.id,
  });

  const isLoading = loadingProducts || loadingServices || loadingClients;

  // --- Derived Data ---
  const categories = useMemo(() => {
    const todosLabel = t('pdv.catalog.all', 'Todos');
    const cats = new Set<string>();
    if (activeTab === 'produtos') {
      products.forEach(p => { if (p.category) cats.add(p.category); });
    } else {
      services.forEach(s => { if (s.category) cats.add(s.category); });
    }
    return [todosLabel, ...Array.from(cats).sort()];
  }, [activeTab, products, services]);

  const catalogItems: CatalogItem[] = useMemo(() => {
    const items: CatalogItem[] = activeTab === 'produtos'
      ? products.map(p => ({ ...p, type: 'product' as const }))
      : services.map(s => ({ ...s, type: 'service' as const }));
    return items.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategory === t('pdv.catalog.all', 'Todos') || item.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [activeTab, searchQuery, activeCategory, products, services]);

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

  // Filtered sales history
  const filteredSales = useMemo(() => {
    if (!historySearch.trim()) return salesHistory;
    const search = historySearch.toLowerCase();
    return salesHistory.filter(sale =>
      (sale.clientName && sale.clientName.toLowerCase().includes(search)) ||
      sale.id.toLowerCase().includes(search) ||
      sale.items.some(item => item.description.toLowerCase().includes(search))
    );
  }, [salesHistory, historySearch]);

  // --- Handlers ---
  const addToCart = useCallback((item: CatalogItem) => {
    setCart((prev) => {
      const idField = item.type === 'product' ? 'productId' : 'serviceId';
      const existing = prev.find((c) => c[idField] === item.id);
      if (existing) {
        // For products, check stock
        if (item.type === 'product') {
          const product = item as Product;
          if (existing.quantity >= product.currentStock) return prev;
        }
        return prev.map((c) =>
          c[idField] === item.id
            ? { ...c, quantity: c.quantity + 1, total: (c.quantity + 1) * c.unitPrice }
            : c,
        );
      }
      // For products, check if stock > 0
      if (item.type === 'product') {
        const product = item as Product;
        if (product.currentStock <= 0) return prev;
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
    const payment: Payment = {
      method: activePaymentMethod,
      amount,
    };
    if (activePaymentMethod === 'credito' && installments > 1) {
      payment.installments = installments;
    }
    setPayments((prev) => [...prev, payment]);
    setPaymentAmount('');
    setActivePaymentMethod(null);
    setInstallments(1);
  }, [activePaymentMethod, paymentAmount, installments]);

  const removePayment = useCallback((index: number) => {
    setPayments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const openConfirmation = useCallback(() => {
    if (cart.length === 0 || remaining > 0.01) return;
    setSaleError(null);
    setShowConfirmation(true);
  }, [cart.length, remaining]);

  // ==========================================
  // NFC-e EMISSION
  // ==========================================

  const emitNfce = useCallback(async (
    saleId: string,
    cartSnapshot: CartItem[],
    saleTotal: number,
    salePayments: Payment[],
    clientName: string,
    cpf: string,
  ) => {
    if (!business) return { success: false };

    setNfceModalState('emitting');
    setNfceResult(null);

    try {
      // Build items with fiscal data from products
      const nfceItems = cartSnapshot.map((item) => {
        const prod = item.productId ? products.find(p => p.id === item.productId) : null;
        return {
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: (item.discount || 0) > 0 ? item.discount : undefined,
          ncm: prod?.ncm || undefined,
          cfop: prod?.cfop ? Number(prod.cfop) : undefined,
          barcode: prod?.barcode || undefined,
          code: prod?.sku || item.productId || item.serviceId || undefined,
          unit: 'UN',
        };
      });

      // Map primary payment method
      const primaryPayment = salePayments[0];
      const paymentMethod = primaryPayment?.method || 'dinheiro';

      const nfcePayload = {
        type: 'nfce' as const,
        businessId: business.id,
        items: nfceItems,
        paymentMethod,
        paymentValue: saleTotal,
        cpfConsumidor: cpf.replace(/\D/g, '') || undefined,
        nomeConsumidor: clientName.trim() || undefined,
        presencaComprador: 1,
        naturezaOperacao: 'VENDA AO CONSUMIDOR FINAL',
      };

      const res = await fetch('/api/fiscal/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nfcePayload),
      });

      const json = await res.json();

      if (res.ok && json.success && json.data?.status === 'autorizado') {
        setNfceResult({
          accessKey: json.data.chaveAcesso,
        });
        setNfceModalState('authorized');

        // Invalidate fiscal documents cache
        queryClient.invalidateQueries({ queryKey: ['fiscalDocuments'] });

        return { success: true, accessKey: json.data.chaveAcesso };
      } else {
        const errorMsg = json.error || json.data?.mensagem || 'Erro desconhecido na emissão da NFC-e';
        setNfceResult({ error: errorMsg });
        setNfceModalState('error');
        return { success: false };
      }
    } catch (err) {
      console.error('NFC-e emission error:', err);
      setNfceResult({ error: err instanceof Error ? err.message : 'Erro de conexão ao emitir NFC-e' });
      setNfceModalState('error');
      return { success: false };
    }
  }, [business, products, queryClient]);

  const confirmSale = useCallback(async () => {
    if (!user || !business) return;

    // Validate CPF if NFC-e enabled and partially filled
    if (emitirNfce && cpfConsumidor) {
      const cpfDigits = cpfConsumidor.replace(/\D/g, '');
      if (cpfDigits.length > 0 && cpfDigits.length < 11) {
        setSaleError('CPF incompleto. Preencha os 11 dígitos ou deixe em branco.');
        return;
      }
    }

    setIsSaving(true);
    setSaleError(null);

    try {
      const now = new Date().toISOString();

      const saleData = {
        businessId: business.id,
        clientId: selectedClient?.id || null,
        clientName: selectedClient?.name || null,
        items: cart.map(item => ({
          id: generateId(),
          productId: item.productId || null,
          serviceId: item.serviceId || null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount || 0,
          total: item.quantity * item.unitPrice - (item.discount || 0),
        })),
        payments: payments,
        subtotal,
        discount: discountAmount,
        total,
        status: 'finalizada' as const,
        operatorId: user.uid,
        operatorName: user.name,
        createdAt: now,
        updatedAt: now,
      };

      const docRef = await addDoc(collection(db, 'sales'), saleData);

      // Deduct stock via centralized helper (supports composite products/BOM).
      const productIndex = new Map(products.map(p => [p.id, p]));
      const stockLines = cart
        .filter(item => item.productId)
        .map(item => ({ productId: item.productId!, quantity: item.quantity }));
      if (stockLines.length > 0) {
        await deductStock(db, stockLines, {
          businessId: business.id,
          operatorId: user.uid,
          operatorName: user.name,
          sourceId: docRef.id,
          reason: `Venda #${docRef.id.substring(0, 6)}`,
          productIndex,
        });
      }

      // Create financial transaction for the sale
      await addDoc(collection(db, 'transactions'), {
        businessId: business.id,
        type: 'receita',
        category: 'Vendas',
        description: `Venda ${selectedClient?.name ? `- ${selectedClient.name}` : ''}`,
        amount: total,
        dueDate: now.split('T')[0],
        paymentDate: now.split('T')[0],
        status: 'pago',
        clientId: selectedClient?.id || null,
        clientName: selectedClient?.name || null,
        saleId: docRef.id,
        paymentMethod: payments[0]?.method || 'dinheiro',
        createdAt: now,
        updatedAt: now,
      });

      // Update client stats
      if (selectedClient) {
        await updateDoc(doc(db, 'clients', selectedClient.id), {
          totalSpent: (selectedClient.totalSpent || 0) + total,
          visitCount: (selectedClient.visitCount || 0) + 1,
          lastVisit: now,
          updatedAt: now,
        });
      }

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });

      setLastSaleId(docRef.id);

      // NFC-e emission (if toggled on)
      if (emitirNfce) {
        // Save context for retry capability
        pendingNfceRef.current = {
          saleId: docRef.id,
          cart: [...cart],
          total,
          payments: [...payments],
          clientName: selectedClient?.name || '',
          cpf: cpfConsumidor,
        };

        // Close confirmation, show NFC-e modal
        setShowConfirmation(false);
        setIsSaving(false);

        await emitNfce(
          docRef.id,
          cart,
          total,
          payments,
          selectedClient?.name || '',
          cpfConsumidor,
        );

        // Don't auto-reset — user will close NFC-e modal manually
        return;
      }

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
        setInstallments(1);
        setEmitirNfce(false);
        setCpfConsumidor('');
        setLastSaleId(null);
      }, 2500);
    } catch (error) {
      console.error('Error finalizing sale:', error);
      setSaleError('Erro ao finalizar venda. Tente novamente.');
    } finally {
      setIsSaving(false);
    }
  }, [user, business, cart, selectedClient, payments, subtotal, discountAmount, total, products, queryClient, emitirNfce, cpfConsumidor, emitNfce]);

  const cancelSale = useCallback(() => {
    setCart([]);
    setPayments([]);
    setSelectedClient(null);
    setDiscountValue('');
    setActivePaymentMethod(null);
    setPaymentAmount('');
    setInstallments(1);
    setEmitirNfce(false);
    setCpfConsumidor('');
  }, []);

  const handleNfceRetry = useCallback(async () => {
    const ctx = pendingNfceRef.current;
    if (!ctx) return;
    await emitNfce(ctx.saleId, ctx.cart, ctx.total, ctx.payments, ctx.clientName, ctx.cpf);
  }, [emitNfce]);

  const handlePrintReceipt = useCallback(() => {
    // Build a printable receipt in a new window
    const receiptWindow = window.open('', '_blank', 'width=350,height=600');
    if (!receiptWindow) return;

    const itemsHtml = cart.map(item =>
      `<tr>
        <td style="text-align:left;padding:2px 0">${item.description}</td>
        <td style="text-align:center;padding:2px 4px">${item.quantity}</td>
        <td style="text-align:right;padding:2px 0">R$ ${(item.unitPrice * item.quantity).toFixed(2)}</td>
      </tr>`
    ).join('');

    const paymentsHtml = payments.map(p =>
      `<div style="display:flex;justify-content:space-between;font-size:12px">
        <span>${PAYMENT_METHOD_LABELS[p.method]}${p.installments && p.installments > 1 ? ` (${p.installments}x)` : ''}</span>
        <span>R$ ${p.amount.toFixed(2)}</span>
      </div>`
    ).join('');

    const businessName = business?.nomeFantasia || business?.razaoSocial || 'ServicePro';
    const businessCnpj = business?.cnpj || '';

    receiptWindow.document.write(`<!DOCTYPE html>
<html><head><title>Recibo</title>
<style>
  body{font-family:'Courier New',monospace;width:280px;margin:0 auto;padding:10px;font-size:12px}
  h2{text-align:center;margin:0 0 4px;font-size:14px}
  .center{text-align:center}
  .divider{border-top:1px dashed #000;margin:8px 0}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;border-bottom:1px solid #000;padding:2px 0;font-size:11px}
  .total-row{font-weight:bold;font-size:14px}
  @media print{body{width:72mm}}
</style></head><body>
  <h2>${businessName}</h2>
  ${businessCnpj ? `<p class="center" style="margin:0;font-size:10px">CNPJ: ${businessCnpj}</p>` : ''}
  <p class="center" style="margin:4px 0;font-size:10px">${new Date().toLocaleString('pt-BR')}</p>
  ${selectedClient ? `<p style="margin:4px 0;font-size:11px">Cliente: ${selectedClient.name}</p>` : ''}
  <div class="divider"></div>
  <table>
    <thead><tr><th>Item</th><th style="text-align:center">Qtd</th><th style="text-align:right">Valor</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <div class="divider"></div>
  <div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>R$ ${subtotal.toFixed(2)}</span></div>
  ${discountAmount > 0 ? `<div style="display:flex;justify-content:space-between"><span>Desconto</span><span>-R$ ${discountAmount.toFixed(2)}</span></div>` : ''}
  <div class="divider"></div>
  <div class="total-row" style="display:flex;justify-content:space-between"><span>TOTAL</span><span>R$ ${total.toFixed(2)}</span></div>
  <div class="divider"></div>
  <p style="font-size:11px;font-weight:bold;margin:4px 0">Pagamento:</p>
  ${paymentsHtml}
  ${change > 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px"><span>Troco</span><span>R$ ${change.toFixed(2)}</span></div>` : ''}
  ${nfceResult?.accessKey ? `<div class="divider"></div><p class="center" style="font-size:9px;word-break:break-all">Chave NFC-e: ${nfceResult.accessKey}</p>` : ''}
  <div class="divider"></div>
  <p class="center" style="font-size:10px;margin-top:8px">Obrigado pela preferência!</p>
<script>window.onload=function(){window.print()}</script>
</body></html>`);
    receiptWindow.document.close();
  }, [cart, payments, PAYMENT_METHOD_LABELS, business, selectedClient, subtotal, discountAmount, total, change, nfceResult]);

  const formatCpfInput = useCallback((value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }, []);

  // ==========================================
  // LOADING STATE
  // ==========================================
  if (isLoading) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-[calc(100vh-60px)] flex flex-col lg:flex-row gap-0 bg-slate-50 dark:bg-[#0B0F19]">
        <div className="w-full lg:w-[60%] flex flex-col border-r border-slate-200 dark:border-gray-800 bg-white dark:bg-[#0d1117] p-6 space-y-4">
          <div className="h-8 w-48 rounded-xl shimmer" />
          <div className="h-10 w-full rounded-xl shimmer" />
          <div className="h-8 w-64 rounded-xl shimmer" />
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 flex-1">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: i * 0.07 }}
                className="h-[110px] rounded-xl shimmer"
              />
            ))}
          </div>
        </div>
        <div className="w-full lg:w-[40%] flex flex-col bg-white dark:bg-[#111827] p-6 space-y-4">
          <div className="h-8 w-40 rounded-xl shimmer" />
          <div className="h-10 w-full rounded-xl shimmer" />
          <div className="flex-1 flex items-center justify-center">
            <div className="text-slate-300 dark:text-gray-600">
              <ShoppingCart size={48} strokeWidth={1.2} />
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // ==========================================
  // SALES HISTORY VIEW
  // ==========================================
  if (mainView === 'historico') {
    return (
      <div className="h-[calc(100vh-60px)] flex flex-col bg-slate-50 dark:bg-[#0B0F19]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-200 dark:border-gray-800 bg-white dark:bg-[#0d1117]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMainView('pdv')}
                className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-gray-800 flex items-center justify-center text-slate-500 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700 transition-colors"
              >
                <ChevronRight size={18} className="rotate-180" />
              </button>
              <div>
                <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-gray-100">{t('pdv.history.title', 'Histórico de Vendas')}</h1>
                <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">
                  {salesHistory.length} {salesHistory.length === 1 ? t('pdv.history.saleRegistered', 'venda registrada') : t('pdv.history.salesRegistered', 'vendas registradas')}
                </p>
              </div>
            </div>
          </div>
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder={t('pdv.history.searchPlaceholder', 'Buscar por cliente, produto ou ID da venda...')}
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700 rounded-xl text-sm text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
            />
          </div>
        </div>

        {/* Sales List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loadingSales ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 rounded-xl shimmer" />
              ))}
            </div>
          ) : filteredSales.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
              <Receipt size={40} strokeWidth={1.5} />
              <p className="mt-3 text-sm">{historySearch ? t('pdv.history.emptySearch', 'Nenhuma venda encontrada') : t('pdv.history.empty', 'Nenhuma venda registrada ainda')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSales.map((sale, index) => (
                <motion.button
                  key={sale.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  onClick={() => setSelectedSale(sale)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-white dark:bg-gray-800/60 border border-slate-200/80 dark:border-gray-700/80 hover:border-slate-300 dark:hover:border-gray-600 hover:shadow-sm transition-all text-left group"
                >
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                    sale.status === 'finalizada'
                      ? 'bg-emerald-50 dark:bg-emerald-500/10'
                      : sale.status === 'cancelada'
                        ? 'bg-red-50 dark:bg-red-500/10'
                        : 'bg-amber-50 dark:bg-amber-500/10',
                  )}>
                    <Receipt size={18} className={cn(
                      sale.status === 'finalizada'
                        ? 'text-emerald-500 dark:text-emerald-400'
                        : sale.status === 'cancelada'
                          ? 'text-red-500 dark:text-red-400'
                          : 'text-amber-500 dark:text-amber-400',
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900 dark:text-gray-100">
                        #{sale.id.substring(0, 6).toUpperCase()}
                      </p>
                      <Chip
                        label={sale.status === 'finalizada' ? t('pdv.status.finalized', 'Finalizada') : sale.status === 'cancelada' ? t('pdv.status.canceled', 'Cancelada') : t('pdv.status.open', 'Aberta')}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          backgroundColor: sale.status === 'finalizada'
                            ? (isDark ? 'rgba(16,185,129,0.1)' : '#ECFDF5')
                            : sale.status === 'cancelada'
                              ? (isDark ? 'rgba(239,68,68,0.1)' : '#FEF2F2')
                              : (isDark ? 'rgba(245,158,11,0.1)' : '#FFFBEB'),
                          color: sale.status === 'finalizada'
                            ? (isDark ? '#34d399' : '#059669')
                            : sale.status === 'cancelada'
                              ? (isDark ? '#f87171' : '#DC2626')
                              : (isDark ? '#fbbf24' : '#D97706'),
                        }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 truncate">
                      {sale.clientName || t('pdv.history.guestClient', 'Cliente avulso')} - {sale.items.length} {sale.items.length === 1 ? t('pdv.history.item', 'item') : t('pdv.history.items', 'itens')}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-gray-100">{formatCurrency(sale.total)}</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{formatDateTime(sale.createdAt)}</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 dark:text-gray-600 group-hover:text-slate-400 dark:group-hover:text-gray-500 transition-colors shrink-0" />
                </motion.button>
              ))}
            </div>
          )}
        </div>

        {/* Sale Detail Dialog */}
        <Dialog
          open={!!selectedSale}
          onClose={() => setSelectedSale(null)}
          maxWidth="sm"
          fullWidth
          PaperProps={{
            sx: {
              borderRadius: '20px',
              overflow: 'hidden',
              backgroundColor: isDark ? '#1f2937' : '#fff',
            },
          }}
        >
          {selectedSale && (
            <>
              <DialogTitle
                sx={{
                  fontFamily: '"Plus Jakarta Sans", sans-serif',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  color: isDark ? '#f3f4f6' : undefined,
                }}
              >
                <div className="flex items-center gap-3">
                  <Receipt size={20} className="text-red-600 dark:text-red-400" />
                  <span>{t('pdv.modal.sale', 'Venda')} #{selectedSale.id.substring(0, 6).toUpperCase()}</span>
                </div>
                <IconButton onClick={() => setSelectedSale(null)} size="small">
                  <X size={18} className={isDark ? 'text-gray-400' : ''} />
                </IconButton>
              </DialogTitle>
              <Divider />
              <DialogContent sx={{ backgroundColor: isDark ? '#1f2937' : undefined }}>
                <div className="space-y-4 py-2">
                  <div className="bg-slate-50 dark:bg-gray-800/50 rounded-xl p-4 border border-slate-100 dark:border-gray-700/50">
                    {/* Sale info */}
                    <div className="flex items-center justify-between text-sm mb-3">
                      <span className="text-slate-500 dark:text-gray-400">{t('pdv.modal.date', 'Data')}</span>
                      <span className="font-medium text-slate-900 dark:text-gray-100">{formatDateTime(selectedSale.createdAt)}</span>
                    </div>
                    {selectedSale.clientName && (
                      <div className="flex items-center justify-between text-sm mb-3">
                        <span className="text-slate-500 dark:text-gray-400">{t('pdv.modal.client', 'Cliente')}</span>
                        <span className="font-medium text-slate-900 dark:text-gray-100">{selectedSale.clientName}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm mb-3">
                      <span className="text-slate-500 dark:text-gray-400">{t('pdv.modal.operator', 'Operador')}</span>
                      <span className="font-medium text-slate-900 dark:text-gray-100">{selectedSale.operatorName}</span>
                    </div>
                    <Divider sx={{ my: 1.5, borderStyle: 'dashed', borderColor: isDark ? '#374151' : undefined }} />

                    {/* Items */}
                    <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('pdv.modal.items', 'Itens')}</p>
                    <div className="space-y-2">
                      {selectedSale.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-sm">
                          <div className="flex-1 min-w-0">
                            <span className="text-slate-700 dark:text-gray-300 truncate block">{item.description}</span>
                            <span className="text-xs text-slate-400 dark:text-gray-500">{item.quantity}x {formatCurrency(item.unitPrice)}</span>
                          </div>
                          <span className="font-medium text-slate-900 dark:text-gray-100 ml-4">
                            {formatCurrency(item.total)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <Divider sx={{ my: 1.5, borderStyle: 'dashed', borderColor: isDark ? '#374151' : undefined }} />

                    {/* Totals */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm text-slate-600 dark:text-gray-400">
                        <span>{t('pdv.modal.subtotal', 'Subtotal')}</span>
                        <span>{formatCurrency(selectedSale.subtotal)}</span>
                      </div>
                      {selectedSale.discount > 0 && (
                        <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                          <span>{t('pdv.modal.discount', 'Desconto')}</span>
                          <span>-{formatCurrency(selectedSale.discount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-bold text-slate-900 dark:text-gray-100 pt-1">
                        <span>{t('pdv.modal.total', 'Total')}</span>
                        <span>{formatCurrency(selectedSale.total)}</span>
                      </div>
                    </div>

                    <Divider sx={{ my: 1.5, borderStyle: 'dashed', borderColor: isDark ? '#374151' : undefined }} />

                    {/* Payments */}
                    <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('pdv.modal.payment', 'Pagamento')}</p>
                    <div className="space-y-1">
                      {selectedSale.payments.map((p, idx) => (
                        <div key={idx} className="flex justify-between text-sm text-slate-700 dark:text-gray-300">
                          <span>
                            {PAYMENT_METHOD_LABELS[p.method]}
                            {p.installments && p.installments > 1 ? ` (${p.installments}x)` : ''}
                          </span>
                          <span>{formatCurrency(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </DialogContent>
            </>
          )}
        </Dialog>
      </div>
    );
  }

  // ==========================================
  // PDV MAIN VIEW
  // ==========================================
  return (
    <div className="h-[calc(100vh-60px)] flex flex-col lg:flex-row gap-0 bg-slate-50 dark:bg-[#0B0F19]">
      {/* ========== LEFT PANEL - Catalog ========== */}
      <div className="w-full lg:w-[60%] flex flex-col border-r border-slate-200 dark:border-gray-800 bg-white dark:bg-[#0d1117]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 dark:border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-gray-100">{t('pdv.main.title', 'PDV')}</h1>
              <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">{t('pdv.main.subtitle', 'Ponto de Venda')}</p>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip title={t('pdv.main.historyTooltip', 'Histórico de vendas')}>
                <button
                  onClick={() => setMainView('historico')}
                  className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 bg-slate-50 dark:bg-gray-800/50 px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600 hover:text-slate-700 dark:hover:text-gray-300 transition-all"
                >
                  <History size={14} />
                  <span>{t('pdv.main.historyBtn', 'Histórico')}</span>
                </button>
              </Tooltip>
              <Tooltip title={t('pdv.main.shortcutsTooltip', 'Atalhos: Enter para buscar, Esc para limpar')}>
                <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-gray-500 bg-slate-50 dark:bg-gray-800/50 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700">
                  <Keyboard size={14} />
                  <span>{t('pdv.main.shortcutsBtn', 'Atalhos')}</span>
                </div>
              </Tooltip>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t('pdv.catalog.searchPlaceholder', 'Buscar produto ou serviço...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-gray-800/50 border border-slate-200 dark:border-gray-700 rounded-xl text-sm text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all"
            />
          </div>
        </div>

        {/* Product/Service Tabs */}
        <div className="px-6 pt-4 pb-0">
          <div className="flex gap-1 p-1 bg-slate-100 dark:bg-gray-800 rounded-xl w-fit">
            <button
              onClick={() => { setActiveTab('produtos'); setActiveCategory('Todos'); setSearchQuery(''); }}
              className={cn(
                'px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
                activeTab === 'produtos'
                  ? 'bg-white dark:bg-gray-700 text-slate-900 dark:text-gray-100 shadow-sm'
                  : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:text-gray-300',
              )}
            >
              <Package size={16} />
              {t('pdv.catalog.productsBtn', 'Produtos')}
              {products.length > 0 && (
                <span className="text-xs text-slate-400 dark:text-gray-500">({products.length})</span>
              )}
            </button>
            <button
              onClick={() => { setActiveTab('servicos'); setActiveCategory('Todos'); setSearchQuery(''); }}
              className={cn(
                'px-5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
                activeTab === 'servicos'
                  ? 'bg-white dark:bg-gray-700 text-slate-900 dark:text-gray-100 shadow-sm'
                  : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:text-gray-300',
              )}
            >
              <Scissors size={16} />
              {t('pdv.catalog.servicesBtn', 'Serviços')}
              {services.length > 0 && (
                <span className="text-xs text-slate-400 dark:text-gray-500">({services.length})</span>
              )}
            </button>
          </div>
        </div>

        {/* Category Filters */}
        <div className="px-6 py-3">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border',
                  activeCategory === cat
                    ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/20'
                    : 'bg-white dark:bg-gray-800 text-slate-500 dark:text-gray-400 border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600 hover:text-slate-700 dark:hover:text-gray-300',
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
                const outOfStock = item.type === 'product' && (item as Product).currentStock <= 0;
                return (
                  <motion.button
                    key={item.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: outOfStock ? 0.5 : 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.15, delay: index * 0.02 }}
                    whileHover={outOfStock ? {} : { y: -3, boxShadow: '0 12px 32px -8px rgba(0,0,0,0.12)' }}
                    whileTap={outOfStock ? {} : { scale: 0.97 }}
                    onClick={() => !outOfStock && addToCart(item)}
                    disabled={outOfStock}
                    className={cn(
                      'relative flex flex-col items-start p-3.5 rounded-xl border transition-all duration-200 text-left group',
                      outOfStock
                        ? 'bg-slate-50 dark:bg-gray-800/30 border-slate-200/50 dark:border-gray-700/50 cursor-not-allowed'
                        : inCartQty > 0
                          ? 'bg-gradient-to-br from-red-50 to-red-50/50 dark:from-red-500/10 dark:to-red-500/5 border-red-200 dark:border-red-500/30 shadow-sm shadow-red-100 dark:shadow-red-500/5'
                          : 'bg-white dark:bg-gray-800/60 border-slate-200/80 dark:border-gray-700/80 hover:border-slate-300 dark:hover:border-gray-600 hover:bg-slate-50/50 dark:hover:bg-gray-800/80',
                    )}
                  >
                    {inCartQty > 0 && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-br from-red-500 to-red-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-lg shadow-red-500/30"
                      >
                        {inCartQty}
                      </motion.div>
                    )}
                    {outOfStock && (
                      <div className="absolute top-2 right-2 text-[9px] font-bold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-1.5 py-0.5 rounded-md">
                        SEM ESTOQUE
                      </div>
                    )}
                    <div className="flex items-center justify-between w-full mb-2.5">
                      <div className={cn(
                        'w-9 h-9 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-110',
                        inCartQty > 0
                          ? 'bg-red-100 dark:bg-red-500/20'
                          : 'bg-slate-100 dark:bg-gray-700/80'
                      )}>
                        {getItemIcon(item)}
                      </div>
                      {item.type === 'service' && (
                        <span className="text-[9px] font-semibold text-slate-400 dark:text-gray-500 bg-slate-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-md">
                          {(item as Service).duration}min
                        </span>
                      )}
                    </div>
                    <span className="text-[13px] font-semibold text-slate-800 dark:text-gray-100 leading-snug mb-1.5 line-clamp-2 text-left w-full">
                      {item.name}
                    </span>
                    <div className="flex items-end justify-between w-full mt-auto">
                      <span className={cn(
                        'text-base font-bold leading-none',
                        outOfStock
                          ? 'text-slate-400 dark:text-gray-500'
                          : inCartQty > 0 ? 'text-red-600 dark:text-red-400' : 'text-red-500 dark:text-red-400'
                      )}>
                        {formatCurrency(price)}
                      </span>
                      {item.type === 'product' && (
                        <span className={cn(
                          'text-[10px] font-medium rounded-md px-1.5 py-0.5',
                          (item as Product).currentStock <= (item as Product).minStock
                            ? 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/10'
                            : 'text-slate-400 dark:text-gray-500 bg-slate-100/80 dark:bg-gray-700/50'
                        )}>
                          {(item as Product).currentStock} un
                        </span>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>

          {catalogItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500">
              <Search size={40} strokeWidth={1.5} />
              <p className="mt-3 text-sm">{t('pdv.catalog.emptyTitle', 'Nenhum item encontrado')}</p>
              <p className="text-xs text-slate-300 dark:text-gray-600 mt-1">
                {activeTab === 'produtos' ? t('pdv.catalog.emptyProductsDesc', 'Cadastre produtos no módulo de Estoque') : t('pdv.catalog.emptyServicesDesc', 'Cadastre serviços no módulo de Agenda')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ========== RIGHT PANEL - Cart/Checkout ========== */}
      <div className="w-full lg:w-[40%] flex flex-col bg-white dark:bg-[#111827]">
        {/* Cart Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 dark:border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                <ShoppingCart size={18} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-display font-bold text-slate-900 dark:text-gray-100">
                  {t('pdv.cart.newSale', 'Nova Venda')}
                </h2>
              </div>
            </div>
            <Chip
              label={`${cart.length} ${cart.length === 1 ? t('pdv.history.item', 'item') : t('pdv.history.items', 'itens')}`}
              size="small"
              sx={{
                backgroundColor: cart.length > 0
                  ? (isDark ? 'rgba(220,38,38,0.1)' : '#FEF2F2')
                  : (isDark ? '#1f2937' : '#F1F5F9'),
                color: cart.length > 0
                  ? (isDark ? '#f87171' : '#DC2626')
                  : (isDark ? '#9ca3af' : '#64748B'),
                fontWeight: 600,
                fontSize: '0.75rem',
              }}
            />
          </div>

          {/* Client Selector */}
          <Autocomplete
            options={clients}
            getOptionLabel={(option) => option.name}
            value={selectedClient}
            onChange={(_, value) => setSelectedClient(value)}
            size="small"
            loading={loadingClients}
            loadingText={t('pdv.cart.loadingClients', 'Carregando clientes...')}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder={t('pdv.cart.selectClient', 'Selecionar cliente (opcional)')}
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <InputAdornment position="start">
                        <User size={16} className="text-slate-400 dark:text-gray-500" />
                      </InputAdornment>
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: '12px',
                    backgroundColor: isDark ? '#1f2937' : '#F8FAFC',
                    color: isDark ? '#f3f4f6' : undefined,
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: isDark ? '#4b5563' : '#CBD5E1' },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#DC2626' },
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: isDark ? '#374151' : undefined },
                  },
                  '& .MuiInputBase-input::placeholder': { color: isDark ? '#6b7280' : undefined },
                }}
              />
            )}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <div className="flex items-center gap-3 py-1">
                  <div className="w-8 h-8 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center text-xs font-bold text-red-600 dark:text-red-400">
                    {option.name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-gray-100">{option.name}</p>
                    <p className="text-xs text-slate-400 dark:text-gray-500">{option.visitCount} {t('pdv.cart.visits', 'visitas')}</p>
                  </div>
                </div>
              </li>
            )}
            noOptionsText={t('pdv.catalog.emptyTitle', 'Nenhum cliente encontrado')}
          />
        </div>

        {/* Cart Items + Checkout (scrollable) */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-6 py-4">
          <AnimatePresence mode="popLayout">
            {cart.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-16 text-slate-300 dark:text-gray-600"
              >
                <ShoppingCart size={48} strokeWidth={1.2} />
                <p className="mt-3 text-sm text-slate-400 dark:text-gray-500">{t('pdv.cart.emptyTitle', 'Carrinho vazio')}</p>
                <p className="text-xs text-slate-300 dark:text-gray-600 mt-1">{t('pdv.cart.emptyDesc', 'Clique em um produto ou serviço para adicionar')}</p>
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
                    className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-gray-800/50 border border-slate-100 dark:border-gray-700/50 group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-gray-100 truncate">{item.description}</p>
                      <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">
                        {formatCurrency(item.unitPrice)} cada
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => updateQuantity(item.id, -1)}
                        className="w-7 h-7 rounded-lg bg-white dark:bg-gray-700 border border-slate-200 dark:border-gray-600 flex items-center justify-center text-slate-500 dark:text-gray-400 hover:border-red-300 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold text-slate-900 dark:text-gray-100">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, 1)}
                        className="w-7 h-7 rounded-lg bg-white dark:bg-gray-700 border border-slate-200 dark:border-gray-600 flex items-center justify-center text-slate-500 dark:text-gray-400 hover:border-red-300 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <p className="text-sm font-bold text-slate-900 dark:text-gray-100 w-20 text-right">
                      {formatCurrency(item.unitPrice * item.quantity)}
                    </p>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 dark:text-gray-600 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
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
          <div
            className="border-t border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/50 px-6 py-4 sticky bottom-0"
          >
            {/* Subtotal & Discount */}
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm text-slate-600 dark:text-gray-400">
                <span>{t('pdv.modal.subtotal', 'Subtotal')}</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600 dark:text-gray-400 whitespace-nowrap">Desconto</span>
                <div className="flex-1 flex items-center gap-1">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      placeholder="0"
                      min="0"
                      className="w-full pl-3 pr-8 py-1.5 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg text-sm text-slate-900 dark:text-gray-100 text-right focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                    />
                  </div>
                  <div className="flex p-0.5 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg">
                    <button
                      onClick={() => setDiscountType('reais')}
                      className={cn(
                        'px-2 py-1 rounded-md text-xs font-medium transition-colors',
                        discountType === 'reais'
                          ? 'bg-red-600 text-white'
                          : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:text-gray-300',
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
                          : 'text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:text-gray-300',
                      )}
                    >
                      %
                    </button>
                  </div>
                </div>
                {discountAmount > 0 && (
                  <span className="text-sm font-medium text-red-600 dark:text-red-400 whitespace-nowrap">
                    -{formatCurrency(discountAmount)}
                  </span>
                )}
              </div>
              <Divider sx={{ my: 1, borderColor: isDark ? '#374151' : undefined }} />
              <div className="flex justify-between items-center">
                <span className="text-lg font-bold text-slate-900 dark:text-gray-100">Total</span>
                <motion.span
                  key={total}
                  initial={{ scale: 1.1 }}
                  animate={{ scale: 1 }}
                  className="text-2xl font-display font-bold text-red-600 dark:text-red-400"
                >
                  {formatCurrency(total)}
                </motion.span>
              </div>
            </div>

            {/* Payment Methods */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Pagamento
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                {PAYMENT_METHODS.map((pm) => (
                  <button
                    key={pm.value}
                    onClick={() => {
                      setActivePaymentMethod(pm.value);
                      setInstallments(1);
                      if (!paymentAmount) {
                        setPaymentAmount(remaining.toFixed(2));
                      }
                    }}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl border text-xs font-medium transition-all',
                      activePaymentMethod === pm.value
                        ? 'bg-red-50 dark:bg-red-500/10 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400'
                        : 'bg-white dark:bg-gray-800 border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:border-slate-300 dark:hover:border-gray-600',
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
                  className="space-y-2 mb-3"
                >
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 dark:text-gray-500">R$</span>
                      <input
                        type="number"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder="0,00"
                        className="w-full pl-9 pr-3 py-2 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl text-sm text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
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
                  </div>

                  {/* Credit card installments */}
                  {activePaymentMethod === 'credito' && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-gray-400 whitespace-nowrap">Parcelas:</span>
                      <select
                        value={installments}
                        onChange={(e) => setInstallments(parseInt(e.target.value))}
                        className="flex-1 px-3 py-1.5 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg text-sm text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}x {n === 1 ? t('pdv.checkout.cash', 'à vista') : `${t('pdv.checkout.of', 'de')} ${formatCurrency((parseFloat(paymentAmount) || 0) / n)}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Payment List */}
              {payments.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {payments.map((p, idx) => (
                    <div key={idx} className="flex items-center justify-between py-1.5 px-3 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg border border-emerald-100 dark:border-emerald-500/20">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={14} className="text-emerald-500 dark:text-emerald-400" />
                        <span className="text-sm text-emerald-800 dark:text-emerald-300 font-medium">
                          {PAYMENT_METHOD_LABELS[p.method]}
                          {p.installments && p.installments > 1 ? ` (${p.installments}x)` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                          {formatCurrency(p.amount)}
                        </span>
                        <button
                          onClick={() => removePayment(idx)}
                          className="text-emerald-400 dark:text-emerald-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
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
                <div className="flex justify-between text-sm py-2 px-3 bg-slate-100 dark:bg-gray-800 rounded-lg">
                  {remaining > 0.01 ? (
                    <>
                      <span className="text-slate-600 dark:text-gray-400">{t('pdv.checkout.missing', 'Falta')}</span>
                      <span className="font-bold text-amber-600">{formatCurrency(remaining)}</span>
                    </>
                  ) : change > 0 ? (
                    <>
                      <span className="text-slate-600 dark:text-gray-400">{t('pdv.checkout.change', 'Troco')}</span>
                      <span className="font-bold text-emerald-600">{formatCurrency(change)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-600 dark:text-gray-400">Pagamento</span>
                      <span className="font-bold text-emerald-600">{t('pdv.checkout.complete', 'Completo')}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* NFC-e Toggle + CPF */}
            <div className="mb-3">
              <button
                type="button"
                onClick={() => setEmitirNfce(p => !p)}
                className={cn(
                  'flex items-center justify-between w-full px-3 py-2.5 rounded-xl border transition-all',
                  emitirNfce
                    ? 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10'
                    : 'border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800/50 hover:border-slate-300 dark:hover:border-gray-600',
                )}
              >
                <div className="flex items-center gap-2">
                  <FileText size={16} className={emitirNfce ? 'text-red-500 dark:text-red-400' : 'text-slate-400 dark:text-gray-500'} />
                  <span className={cn('text-sm font-medium', emitirNfce ? 'text-red-700 dark:text-red-300' : 'text-slate-600 dark:text-gray-400')}>
                    {t('pdv.checkout.emitNfce', 'Emitir NFC-e')}
                  </span>
                </div>
                <div className={cn(
                  'w-9 h-5 rounded-full transition-colors relative',
                  emitirNfce ? 'bg-red-500' : 'bg-slate-300 dark:bg-gray-600',
                )}>
                  <motion.div
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
                    animate={{ left: emitirNfce ? 18 : 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                </div>
              </button>

              <AnimatePresence>
                {emitirNfce && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 px-1">
                      <label className="text-xs text-slate-500 dark:text-gray-400 mb-1 block">
                        {t('pdv.checkout.cpfOnInvoice', 'CPF na nota (opcional)')}
                      </label>
                      <input
                        type="text"
                        value={cpfConsumidor}
                        onChange={(e) => setCpfConsumidor(formatCpfInput(e.target.value))}
                        placeholder="000.000.000-00"
                        className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg text-sm text-slate-900 dark:text-gray-100 placeholder:text-slate-300 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={cancelSale}
                variant="outlined"
                sx={{
                  color: isDark ? '#9ca3af' : '#64748B',
                  borderColor: isDark ? '#374151' : '#CBD5E1',
                  '&:hover': { borderColor: isDark ? '#4b5563' : '#94A3B8', backgroundColor: isDark ? '#1f2937' : '#F8FAFC' },
                  borderRadius: '12px',
                  textTransform: 'none',
                  fontWeight: 600,
                  flex: 1,
                }}
              >
                Cancelar
              </Button>
              <Button
                onClick={openConfirmation}
                variant="contained"
                disabled={cart.length === 0 || remaining > 0.01}
                sx={{
                  backgroundColor: '#DC2626',
                  '&:hover': { backgroundColor: '#B91C1C' },
                  '&.Mui-disabled': { backgroundColor: isDark ? '#7f1d1d' : '#FCA5A5', color: '#fff' },
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
          </div>
        )}
        </div>
      </div>

      {/* ========== CONFIRMATION DIALOG ========== */}
      <Dialog
        open={showConfirmation}
        onClose={() => !saleComplete && !isSaving && setShowConfirmation(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '20px',
            overflow: 'hidden',
            backgroundColor: isDark ? '#1f2937' : '#fff',
          },
        }}
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
                <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mb-6">
                  <CheckCircle2 size={40} className="text-emerald-500 dark:text-emerald-400" />
                </div>
              </motion.div>
              <motion.h3
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-xl font-display font-bold text-slate-900 dark:text-gray-100 mb-2"
              >
                {t('pdv.modal.saleFinishedTitle', 'Venda Finalizada!')}
              </motion.h3>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-sm text-slate-500 dark:text-gray-400"
              >
                {lastSaleId
                  ? `Venda #${lastSaleId.substring(0, 6).toUpperCase()} registrada com sucesso`
                  : 'Venda registrada com sucesso'}
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
                  color: isDark ? '#f3f4f6' : undefined,
                }}
              >
                <div className="flex items-center gap-3">
                  <Receipt size={20} className="text-red-600 dark:text-red-400" />
                  <span>Confirmar Venda</span>
                </div>
                <IconButton onClick={() => !isSaving && setShowConfirmation(false)} size="small" disabled={isSaving}>
                  <X size={18} className={isDark ? 'text-gray-400' : ''} />
                </IconButton>
              </DialogTitle>
              <Divider />
              <DialogContent sx={{ backgroundColor: isDark ? '#1f2937' : undefined }}>
                <div className="space-y-4 py-2">
                  {/* Error message */}
                  {saleError && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl"
                    >
                      <AlertCircle size={16} className="text-red-500 dark:text-red-400 shrink-0" />
                      <p className="text-sm text-red-700 dark:text-red-300">{saleError}</p>
                    </motion.div>
                  )}

                  {/* Receipt Preview */}
                  <div className="bg-slate-50 dark:bg-gray-800/50 rounded-xl p-4 border border-slate-100 dark:border-gray-700/50">
                    <div className="text-center mb-4">
                      <p className="text-xs text-slate-400 dark:text-gray-500 uppercase tracking-widest">{t('pdv.modal.receiptSummary', 'Resumo da Venda')}</p>
                      {selectedClient && (
                        <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">
                          Cliente: {selectedClient.name}
                        </p>
                      )}
                    </div>
                    <Divider sx={{ my: 1.5, borderStyle: 'dashed', borderColor: isDark ? '#374151' : undefined }} />
                    <div className="space-y-2">
                      {cart.map((item) => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <div className="flex-1 min-w-0">
                            <span className="text-slate-700 dark:text-gray-300 truncate block">{item.description}</span>
                            <span className="text-xs text-slate-400 dark:text-gray-500">{item.quantity}x {formatCurrency(item.unitPrice)}</span>
                          </div>
                          <span className="font-medium text-slate-900 dark:text-gray-100 ml-4">
                            {formatCurrency(item.unitPrice * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <Divider sx={{ my: 1.5, borderStyle: 'dashed', borderColor: isDark ? '#374151' : undefined }} />
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm text-slate-600 dark:text-gray-400">
                        <span>{t('pdv.modal.subtotal', 'Subtotal')}</span>
                        <span>{formatCurrency(subtotal)}</span>
                      </div>
                      {discountAmount > 0 && (
                        <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                          <span>{t('pdv.modal.discount', 'Desconto')}</span>
                          <span>-{formatCurrency(discountAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-bold text-slate-900 dark:text-gray-100 pt-1">
                        <span>{t('pdv.modal.total', 'Total')}</span>
                        <span>{formatCurrency(total)}</span>
                      </div>
                    </div>
                    <Divider sx={{ my: 1.5, borderStyle: 'dashed', borderColor: isDark ? '#374151' : undefined }} />
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase">Pagamento</p>
                      {payments.map((p, idx) => (
                        <div key={idx} className="flex justify-between text-sm text-slate-700 dark:text-gray-300">
                          <span>
                            {PAYMENT_METHOD_LABELS[p.method]}
                            {p.installments && p.installments > 1 ? ` (${p.installments}x)` : ''}
                          </span>
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
              <DialogActions sx={{ px: 3, py: 2, gap: 1, backgroundColor: isDark ? '#1f2937' : undefined }}>
                <Tooltip title={t('pdv.modal.printTooltip', 'Imprimir recibo')}>
                  <IconButton
                    onClick={handlePrintReceipt}
                    sx={{
                      border: `1px solid ${isDark ? '#374151' : '#E2E8F0'}`,
                      borderRadius: '12px',
                      color: isDark ? '#9ca3af' : '#64748B',
                    }}
                  >
                    <Printer size={18} />
                  </IconButton>
                </Tooltip>
                <div className="flex-1" />
                <Button
                  onClick={() => setShowConfirmation(false)}
                  disabled={isSaving}
                  sx={{ color: isDark ? '#9ca3af' : '#64748B', textTransform: 'none', fontWeight: 600, borderRadius: '12px' }}
                >
                  Voltar
                </Button>
                <Button
                  onClick={confirmSale}
                  variant="contained"
                  disabled={isSaving}
                  sx={{
                    backgroundColor: '#DC2626',
                    '&:hover': { backgroundColor: '#B91C1C' },
                    '&.Mui-disabled': { backgroundColor: isDark ? '#7f1d1d' : '#FCA5A5', color: '#fff' },
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 700,
                    px: 4,
                  }}
                >
                  {isSaving ? (
                    <div className="flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      {t('pdv.modal.savingBtn', 'Salvando...')}
                    </div>
                  ) : (
                    t('pdv.modal.confirmBtn', 'Confirmar Venda')
                  )}
                </Button>
              </DialogActions>
            </motion.div>
          )}
        </AnimatePresence>
      </Dialog>

      {/* ========== NFC-e EMISSION MODAL ========== */}
      <Dialog
        open={nfceModalState !== 'idle'}
        onClose={() => {
          if (nfceModalState === 'emitting') return; // can't close while emitting
          setNfceModalState('idle');
          setNfceResult(null);
          pendingNfceRef.current = null;
          // Reset sale state
          setCart([]);
          setPayments([]);
          setSelectedClient(null);
          setDiscountValue('');
          setActivePaymentMethod(null);
          setPaymentAmount('');
          setInstallments(1);
          setEmitirNfce(false);
          setCpfConsumidor('');
          setLastSaleId(null);
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '20px',
            overflow: 'hidden',
            backgroundColor: isDark ? '#1f2937' : '#fff',
          },
        }}
      >
        <AnimatePresence mode="wait">
          {/* Emitting State */}
          {nfceModalState === 'emitting' && (
            <motion.div
              key="nfce-emitting"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center py-16 px-8"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                className="w-16 h-16 rounded-full border-4 border-red-100 dark:border-red-500/20 border-t-red-500 dark:border-t-red-400 mb-6"
              />
              <h3 className="text-lg font-display font-bold text-slate-900 dark:text-gray-100 mb-2">
                {t('pdv.nfce.emittingTitle', 'Emitindo NFC-e...')}
              </h3>
              <p className="text-sm text-slate-500 dark:text-gray-400">
                {t('pdv.nfce.emittingDesc', 'Comunicando com a SEFAZ...')}
              </p>
            </motion.div>
          )}

          {/* Authorized State */}
          {nfceModalState === 'authorized' && (
            <motion.div
              key="nfce-authorized"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-12 px-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
              >
                <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center mb-6">
                  <CheckCircle2 size={40} className="text-emerald-500 dark:text-emerald-400" />
                </div>
              </motion.div>
              <motion.h3
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-xl font-display font-bold text-slate-900 dark:text-gray-100 mb-2"
              >
                {t('pdv.nfce.authorizedTitle', 'NFC-e Autorizada!')}
              </motion.h3>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-sm text-slate-500 dark:text-gray-400 mb-4"
              >
                {t('pdv.nfce.authorizedDesc', 'Nota fiscal emitida com sucesso')}
              </motion.p>
              {nfceResult?.accessKey && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="w-full bg-slate-50 dark:bg-gray-800/50 rounded-xl p-3 border border-slate-100 dark:border-gray-700/50 mb-6"
                >
                  <p className="text-xs text-slate-400 dark:text-gray-500 mb-1">{t('pdv.nfce.accessKey', 'Chave de Acesso')}</p>
                  <p className="text-xs font-mono text-slate-700 dark:text-gray-300 break-all leading-relaxed">
                    {nfceResult.accessKey}
                  </p>
                </motion.div>
              )}
              <div className="flex gap-3 w-full">
                <Button
                  onClick={handlePrintReceipt}
                  variant="outlined"
                  startIcon={<Printer size={16} />}
                  sx={{
                    flex: 1,
                    color: isDark ? '#9ca3af' : '#64748B',
                    borderColor: isDark ? '#374151' : '#CBD5E1',
                    '&:hover': { borderColor: isDark ? '#4b5563' : '#94A3B8', backgroundColor: isDark ? '#1f2937' : '#F8FAFC' },
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 600,
                  }}
                >
                  {t('pdv.nfce.printReceipt', 'Imprimir Cupom')}
                </Button>
                <Button
                  onClick={() => {
                    setNfceModalState('idle');
                    setNfceResult(null);
                    pendingNfceRef.current = null;
                    setCart([]);
                    setPayments([]);
                    setSelectedClient(null);
                    setDiscountValue('');
                    setActivePaymentMethod(null);
                    setPaymentAmount('');
                    setInstallments(1);
                    setEmitirNfce(false);
                    setCpfConsumidor('');
                    setLastSaleId(null);
                  }}
                  variant="contained"
                  sx={{
                    flex: 1,
                    backgroundColor: '#DC2626',
                    '&:hover': { backgroundColor: '#B91C1C' },
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 700,
                  }}
                >
                  {t('pdv.nfce.close', 'Fechar')}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Error State */}
          {nfceModalState === 'error' && (
            <motion.div
              key="nfce-error"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-12 px-8"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
              >
                <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center mb-6">
                  <X size={40} className="text-red-500 dark:text-red-400" />
                </div>
              </motion.div>
              <motion.h3
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-xl font-display font-bold text-slate-900 dark:text-gray-100 mb-2"
              >
                {t('pdv.nfce.errorTitle', 'Falha na Emissão')}
              </motion.h3>
              {nfceResult?.error && (
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="text-sm text-slate-500 dark:text-gray-400 mb-2 text-center max-w-sm"
                >
                  {nfceResult.error}
                </motion.p>
              )}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 }}
                className="text-xs text-slate-400 dark:text-gray-500 mb-6 text-center"
              >
                {t('pdv.nfce.saleRegistered', 'A venda foi registrada com sucesso. Apenas a emissão fiscal falhou.')}
              </motion.p>
              <div className="flex gap-3 w-full">
                <Button
                  onClick={handleNfceRetry}
                  variant="contained"
                  startIcon={<Loader2 size={16} />}
                  sx={{
                    flex: 1,
                    backgroundColor: '#DC2626',
                    '&:hover': { backgroundColor: '#B91C1C' },
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 700,
                  }}
                >
                  {t('pdv.nfce.retry', 'Tentar Novamente')}
                </Button>
                <Button
                  onClick={() => {
                    setNfceModalState('idle');
                    setNfceResult(null);
                    pendingNfceRef.current = null;
                    setCart([]);
                    setPayments([]);
                    setSelectedClient(null);
                    setDiscountValue('');
                    setActivePaymentMethod(null);
                    setPaymentAmount('');
                    setInstallments(1);
                    setEmitirNfce(false);
                    setCpfConsumidor('');
                    setLastSaleId(null);
                  }}
                  variant="outlined"
                  sx={{
                    flex: 1,
                    color: isDark ? '#9ca3af' : '#64748B',
                    borderColor: isDark ? '#374151' : '#CBD5E1',
                    '&:hover': { borderColor: isDark ? '#4b5563' : '#94A3B8', backgroundColor: isDark ? '#1f2937' : '#F8FAFC' },
                    borderRadius: '12px',
                    textTransform: 'none',
                    fontWeight: 600,
                  }}
                >
                  {t('pdv.nfce.closeWithoutEmit', 'Fechar sem emitir')}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Dialog>
    </div>
  );
}
