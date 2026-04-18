'use client';

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardCheck, Plus, Search, Clock, MapPin, User as UserIcon, Bike, CheckCircle2,
  X, ChefHat, Package, Truck, XCircle, Edit3, Trash2, Phone, DollarSign,
  ChevronDown, ArrowRight, ArrowLeft, MessageSquare, Timer, Sparkles,
  LayoutGrid, List, Filter, Home,
} from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, addDoc, updateDoc,
  doc, deleteDoc, getDocs, runTransaction, serverTimestamp, increment,
  limit as firestoreLimit,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDateTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import { toast } from 'react-toastify';
import { deductStock } from '@/lib/services/stock';
import type {
  DeliveryOrder, DeliveryOrderStatus, DeliveryOrderItem, DeliveryOrderChannel,
  DeliveryOrderPaymentMethod, DeliveryOrderPaymentStatus, DeliveryType,
  Product, Client, DeliveryOrderAddress,
} from '@/lib/types';
import { DELIVERY_ORDER_STATUS_FLOW, DELIVERY_ORDER_STATUS_LABELS } from '@/lib/types';

// Local aliases — keep JSX concise.
type Order = DeliveryOrder;
type OrderStatus = DeliveryOrderStatus;
type OrderItem = DeliveryOrderItem;
type OrderChannel = DeliveryOrderChannel;
type OrderPaymentMethod = DeliveryOrderPaymentMethod;
type OrderPaymentStatus = DeliveryOrderPaymentStatus;
type OrderAddress = DeliveryOrderAddress;
const ORDER_STATUS_ORDER = DELIVERY_ORDER_STATUS_FLOW;
const ORDER_STATUS_LABELS = DELIVERY_ORDER_STATUS_LABELS;

// ─── Status visuals ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OrderStatus, {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: React.ElementType;
  dot: string;
}> = {
  recebido: {
    label: 'Recebido', icon: ClipboardCheck, dot: 'bg-blue-500',
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    border: 'border-blue-200 dark:border-blue-500/30',
  },
  preparando: {
    label: 'Preparando', icon: ChefHat, dot: 'bg-amber-500',
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    border: 'border-amber-200 dark:border-amber-500/30',
  },
  pronto: {
    label: 'Pronto', icon: Package, dot: 'bg-violet-500',
    color: 'text-violet-700 dark:text-violet-300',
    bg: 'bg-violet-50 dark:bg-violet-500/10',
    border: 'border-violet-200 dark:border-violet-500/30',
  },
  saiu_entrega: {
    label: 'Saiu p/ Entrega', icon: Truck, dot: 'bg-orange-500',
    color: 'text-orange-700 dark:text-orange-300',
    bg: 'bg-orange-50 dark:bg-orange-500/10',
    border: 'border-orange-200 dark:border-orange-500/30',
  },
  entregue: {
    label: 'Entregue', icon: CheckCircle2, dot: 'bg-emerald-500',
    color: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    border: 'border-emerald-200 dark:border-emerald-500/30',
  },
  cancelado: {
    label: 'Cancelado', icon: XCircle, dot: 'bg-gray-500',
    color: 'text-gray-700 dark:text-gray-300',
    bg: 'bg-gray-100 dark:bg-gray-700/40',
    border: 'border-gray-300 dark:border-gray-600',
  },
};

const CHANNEL_ICONS: Record<OrderChannel, { icon: string; color: string }> = {
  whatsapp: { icon: '💬', color: 'text-emerald-500' },
  facebook: { icon: 'f', color: 'text-blue-500' },
  instagram: { icon: '📷', color: 'text-pink-500' },
  manual: { icon: '✍️', color: 'text-gray-500' },
  site: { icon: '🌐', color: 'text-indigo-500' },
};

const PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão de Crédito',
  cartao_debito: 'Cartão de Débito',
  pix: 'Pix',
  voucher: 'Voucher',
  outro: 'Outro',
};

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function isUrgent(order: Order): boolean {
  if (order.status === 'entregue' || order.status === 'cancelado') return false;
  const mins = (Date.now() - new Date(order.createdAt).getTime()) / 60_000;
  // Urgent if older than ETA + 10 min OR older than 45 min with no ETA set
  if (order.estimatedDeliveryAt) {
    return new Date(order.estimatedDeliveryAt).getTime() < Date.now();
  }
  return mins > 45;
}

// ─── Order Card (Kanban) ─────────────────────────────────────────────────────

function OrderCard({
  order, onClick, isDragging,
}: {
  order: Order;
  onClick: () => void;
  isDragging?: boolean;
}) {
  const urgent = isUrgent(order);
  const statusCfg = STATUS_CONFIG[order.status];

  return (
    <motion.button
      layout
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'group w-full text-left rounded-xl bg-white dark:bg-gray-900 border p-3 shadow-sm hover:shadow-md transition-all',
        urgent ? 'border-red-300 dark:border-red-500/40' : 'border-gray-200 dark:border-gray-800',
        isDragging && 'opacity-50 rotate-1',
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {order.channel && (
            <span className={cn('text-[11px]', CHANNEL_ICONS[order.channel].color)}>
              {CHANNEL_ICONS[order.channel].icon}
            </span>
          )}
          <span className="text-[11px] font-mono font-bold text-gray-400 dark:text-gray-500">#{order.number}</span>
          {urgent && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 text-[9px] font-bold">
              <Timer className="w-2.5 h-2.5" />
              ATRASADO
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap flex-shrink-0">
          {timeSince(order.createdAt)}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
          {(order.clientName[0] || '?').toUpperCase()}
        </div>
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate flex-1">
          {order.clientName}
        </p>
      </div>

      <div className="space-y-1 mb-2">
        {order.items.slice(0, 3).map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-600 dark:text-gray-400 truncate">
              <span className="font-semibold text-gray-900 dark:text-gray-100 mr-1">{item.quantity}×</span>
              {item.productName}
            </span>
          </div>
        ))}
        {order.items.length > 3 && (
          <p className="text-[10px] text-gray-400">+{order.items.length - 3} itens</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-1.5">
          {order.deliveryType === 'entrega' ? (
            <Bike className="w-3 h-3 text-gray-400" />
          ) : (
            <Home className="w-3 h-3 text-gray-400" />
          )}
          <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
            {order.deliveryType === 'entrega' ? 'Entrega' : 'Retirada'}
          </span>
          <span className={cn(
            'ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold',
            order.paymentStatus === 'pago'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
          )}>
            {order.paymentStatus === 'pago' ? 'Pago' : 'A pagar'}
          </span>
        </div>
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {formatCurrency(order.total)}
        </span>
      </div>
    </motion.button>
  );
}

// ─── Kanban Column ───────────────────────────────────────────────────────────

function KanbanColumn({
  status, orders, onCardClick, onDrop, draggedId,
}: {
  status: OrderStatus;
  orders: Order[];
  onCardClick: (o: Order) => void;
  onDrop: (orderId: string, newStatus: OrderStatus) => void;
  draggedId: string | null;
}) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  const [isOver, setIsOver] = useState(false);

  const totalValue = orders.reduce((s, o) => s + o.total, 0);

  return (
    <div
      className={cn(
        'flex flex-col min-w-[280px] w-[280px] h-full rounded-2xl border transition-all',
        cfg.bg, cfg.border,
        isOver && 'ring-2 ring-red-400 ring-offset-2 ring-offset-white dark:ring-offset-gray-950',
      )}
      onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const id = e.dataTransfer.getData('text/plain');
        if (id) onDrop(id, status);
      }}
    >
      <div className={cn('flex items-center justify-between p-3 border-b', cfg.border)}>
        <div className="flex items-center gap-2">
          <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center bg-white dark:bg-gray-900 shadow-sm')}>
            <Icon className={cn('w-4 h-4', cfg.color)} />
          </div>
          <div>
            <p className={cn('text-xs font-bold uppercase tracking-wider', cfg.color)}>{cfg.label}</p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">{orders.length} pedidos · {formatCurrency(totalValue)}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {orders.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-xs text-gray-400 dark:text-gray-500">
            Sem pedidos
          </div>
        ) : (
          orders.map(o => (
            <div
              key={o.id}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', o.id); }}
            >
              <OrderCard
                order={o}
                onClick={() => onCardClick(o)}
                isDragging={draggedId === o.id}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Order Form Dialog ───────────────────────────────────────────────────────

interface OrderFormData {
  clientId: string;
  clientName: string;
  clientPhone: string;
  items: OrderItem[];
  deliveryType: DeliveryType;
  deliveryFee: number;
  discount: number;
  address: OrderAddress;
  paymentMethod: OrderPaymentMethod;
  paymentStatus: OrderPaymentStatus;
  changeFor: number;
  customerNotes: string;
  internalNotes: string;
  estimatedMinutes: number;
}

function emptyOrderForm(): OrderFormData {
  return {
    clientId: '',
    clientName: '',
    clientPhone: '',
    items: [],
    deliveryType: 'entrega',
    deliveryFee: 0,
    discount: 0,
    address: {},
    paymentMethod: 'pix',
    paymentStatus: 'pendente',
    changeFor: 0,
    customerNotes: '',
    internalNotes: '',
    estimatedMinutes: 45,
  };
}

function OrderFormDialog({
  open, onClose, onSave, initial, clients, products, isEditing,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: OrderFormData) => Promise<void>;
  initial: OrderFormData;
  clients: Client[];
  products: Product[];
  isEditing: boolean;
}) {
  const [form, setForm] = useState<OrderFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial);
      setClientSearch(initial.clientName || '');
      setProductSearch('');
    }
  }, [open, initial]);

  const deliverableProducts = useMemo(
    () => products.filter(p => p.isDeliverable && p.isActive),
    [products],
  );

  const filteredClients = useMemo(() => {
    const q = clientSearch.toLowerCase();
    if (!q) return clients.slice(0, 8);
    return clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.whatsapp?.includes(q),
    ).slice(0, 8);
  }, [clients, clientSearch]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase();
    if (!q) return deliverableProducts.slice(0, 10);
    return deliverableProducts
      .filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.menuCategory?.toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [deliverableProducts, productSearch]);

  const subtotal = form.items.reduce((s, i) => s + i.total, 0);
  const total = Math.max(0, subtotal + (form.deliveryFee || 0) - (form.discount || 0));

  const addItem = (p: Product) => {
    const existing = form.items.find(i => i.productId === p.id);
    if (existing) {
      setForm(f => ({
        ...f,
        items: f.items.map(i =>
          i.productId === p.id
            ? { ...i, quantity: i.quantity + 1, total: (i.quantity + 1) * i.unitPrice }
            : i),
      }));
    } else {
      setForm(f => ({
        ...f,
        items: [...f.items, {
          productId: p.id,
          productName: p.name,
          quantity: 1,
          unitPrice: p.salePrice,
          total: p.salePrice,
          ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
        }],
      }));
    }
    setProductSearch('');
    setShowProductDropdown(false);
  };

  const updateQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setForm(f => ({ ...f, items: f.items.filter(i => i.productId !== productId) }));
      return;
    }
    setForm(f => ({
      ...f,
      items: f.items.map(i =>
        i.productId === productId
          ? { ...i, quantity: qty, total: qty * i.unitPrice }
          : i),
    }));
  };

  const handleSubmit = async () => {
    if (!form.clientName.trim() || form.items.length === 0) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const selectClient = (c: Client) => {
    setForm(f => ({
      ...f,
      clientId: c.id,
      clientName: c.name,
      clientPhone: c.whatsapp || c.phone || '',
      address: c.endereco ? {
        cep: c.endereco.cep,
        logradouro: c.endereco.logradouro,
        numero: c.endereco.numero,
        complemento: c.endereco.complemento,
        bairro: c.endereco.bairro,
        municipio: c.endereco.municipio,
        uf: c.endereco.uf,
      } : f.address,
    }));
    setClientSearch(c.name);
    setShowClientDropdown(false);
  };

  if (!open) return null;

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400';
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-3xl max-h-[90vh] overflow-hidden bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col"
        >
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">
              {isEditing ? 'Editar Pedido' : 'Novo Pedido'}
            </h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Cliente */}
            <div>
              <label className={labelCls}>Cliente *</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={clientSearch}
                  onChange={e => {
                    setClientSearch(e.target.value);
                    setForm(f => ({ ...f, clientName: e.target.value, clientId: '' }));
                    setShowClientDropdown(true);
                  }}
                  onFocus={() => setShowClientDropdown(true)}
                  onBlur={() => setTimeout(() => setShowClientDropdown(false), 150)}
                  placeholder="Buscar cliente ou digitar nome..."
                  className={cn(inputCls, 'pl-10')}
                />
                <AnimatePresence>
                  {showClientDropdown && filteredClients.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto"
                    >
                      {filteredClients.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectClient(c)}
                          className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2"
                        >
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white text-xs font-bold">
                            {c.name[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{c.name}</p>
                            <p className="text-[11px] text-gray-500 truncate">{c.whatsapp || c.phone || 'Sem telefone'}</p>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <input
                value={form.clientPhone}
                onChange={e => setForm(f => ({ ...f, clientPhone: e.target.value }))}
                placeholder="Telefone/WhatsApp"
                className={cn(inputCls, 'mt-2')}
              />
            </div>

            {/* Delivery type */}
            <div>
              <label className={labelCls}>Tipo de atendimento</label>
              <div className="grid grid-cols-2 gap-2">
                {(['entrega', 'retirada'] as DeliveryType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, deliveryType: t }))}
                    className={cn(
                      'flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all',
                      form.deliveryType === t
                        ? 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400',
                    )}
                  >
                    {t === 'entrega' ? <><Bike className="w-4 h-4" /> Entrega</> : <><Home className="w-4 h-4" /> Retirada</>}
                  </button>
                ))}
              </div>
            </div>

            {/* Address (if delivery) */}
            {form.deliveryType === 'entrega' && (
              <div>
                <label className={labelCls}>Endereço de Entrega</label>
                <div className="grid grid-cols-3 gap-2">
                  <input placeholder="CEP" className={inputCls}
                    value={form.address.cep || ''}
                    onChange={e => setForm(f => ({ ...f, address: { ...f.address, cep: e.target.value } }))} />
                  <input placeholder="Logradouro" className={cn(inputCls, 'col-span-2')}
                    value={form.address.logradouro || ''}
                    onChange={e => setForm(f => ({ ...f, address: { ...f.address, logradouro: e.target.value } }))} />
                  <input placeholder="Nº" className={inputCls}
                    value={form.address.numero || ''}
                    onChange={e => setForm(f => ({ ...f, address: { ...f.address, numero: e.target.value } }))} />
                  <input placeholder="Complemento" className={cn(inputCls, 'col-span-2')}
                    value={form.address.complemento || ''}
                    onChange={e => setForm(f => ({ ...f, address: { ...f.address, complemento: e.target.value } }))} />
                  <input placeholder="Bairro" className={cn(inputCls, 'col-span-2')}
                    value={form.address.bairro || ''}
                    onChange={e => setForm(f => ({ ...f, address: { ...f.address, bairro: e.target.value } }))} />
                  <input placeholder="Cidade/UF" className={inputCls}
                    value={form.address.municipio ? `${form.address.municipio}${form.address.uf ? '/' + form.address.uf : ''}` : ''}
                    onChange={e => {
                      const [mun, uf] = e.target.value.split('/');
                      setForm(f => ({ ...f, address: { ...f.address, municipio: mun, uf: uf?.trim().toUpperCase() } }));
                    }} />
                  <input placeholder="Ponto de referência" className={cn(inputCls, 'col-span-3')}
                    value={form.address.reference || ''}
                    onChange={e => setForm(f => ({ ...f, address: { ...f.address, reference: e.target.value } }))} />
                </div>
              </div>
            )}

            {/* Items */}
            <div>
              <label className={labelCls}>Itens do pedido *</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={productSearch}
                  onChange={e => { setProductSearch(e.target.value); setShowProductDropdown(true); }}
                  onFocus={() => setShowProductDropdown(true)}
                  onBlur={() => setTimeout(() => setShowProductDropdown(false), 150)}
                  placeholder="Buscar produto do cardápio..."
                  className={cn(inputCls, 'pl-10')}
                />
                <AnimatePresence>
                  {showProductDropdown && filteredProducts.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute z-10 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-56 overflow-y-auto"
                    >
                      {filteredProducts.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addItem(p)}
                          className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2"
                        >
                          <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 overflow-hidden flex-shrink-0">
                            {p.imageUrl
                              ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                              : <Package className="w-4 h-4 m-2.5 text-gray-400" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.name}</p>
                            <p className="text-[11px] text-gray-500">{p.menuCategory || p.category}</p>
                          </div>
                          <p className="text-sm font-bold text-red-600 dark:text-red-400">{formatCurrency(p.salePrice)}</p>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {form.items.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {form.items.map(item => (
                    <div key={item.productId} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800">
                      <span className="flex-1 text-sm text-gray-900 dark:text-gray-100 truncate">{item.productName}</span>
                      <div className="flex items-center gap-1 bg-white dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700">
                        <button type="button" onClick={() => updateQty(item.productId, item.quantity - 1)}
                          className="px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-l-md">−</button>
                        <span className="px-2 text-xs font-bold min-w-[24px] text-center">{item.quantity}</span>
                        <button type="button" onClick={() => updateQty(item.productId, item.quantity + 1)}
                          className="px-2 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-r-md">+</button>
                      </div>
                      <span className="w-20 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {formatCurrency(item.total)}
                      </span>
                      <button type="button" onClick={() => updateQty(item.productId, 0)}
                        className="p-1 rounded text-gray-400 hover:text-red-500">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Taxa de entrega</label>
                <input type="number" step="0.01" min="0"
                  value={form.deliveryFee || ''}
                  onChange={e => setForm(f => ({ ...f, deliveryFee: Number(e.target.value) || 0 }))}
                  placeholder="0,00"
                  className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Desconto</label>
                <input type="number" step="0.01" min="0"
                  value={form.discount || ''}
                  onChange={e => setForm(f => ({ ...f, discount: Number(e.target.value) || 0 }))}
                  placeholder="0,00"
                  className={inputCls} />
              </div>
            </div>

            {/* Payment */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Pagamento</label>
                <select className={inputCls}
                  value={form.paymentMethod}
                  onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value as OrderPaymentMethod }))}>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Status do Pagamento</label>
                <select className={inputCls}
                  value={form.paymentStatus}
                  onChange={e => setForm(f => ({ ...f, paymentStatus: e.target.value as OrderPaymentStatus }))}>
                  <option value="pendente">Pendente</option>
                  <option value="pago">Pago</option>
                  <option value="estornado">Estornado</option>
                </select>
              </div>
            </div>

            {form.paymentMethod === 'dinheiro' && form.paymentStatus !== 'pago' && (
              <div>
                <label className={labelCls}>Troco para quanto?</label>
                <input type="number" step="0.01" min="0"
                  value={form.changeFor || ''}
                  onChange={e => setForm(f => ({ ...f, changeFor: Number(e.target.value) || 0 }))}
                  placeholder="Ex.: 50,00"
                  className={inputCls} />
              </div>
            )}

            {/* ETA + Notes */}
            <div>
              <label className={labelCls}>Previsão (min)</label>
              <input type="number" min={5} max={240}
                value={form.estimatedMinutes}
                onChange={e => setForm(f => ({ ...f, estimatedMinutes: Number(e.target.value) || 45 }))}
                className={cn(inputCls, 'w-32')} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Observação do cliente</label>
                <textarea rows={2} className={cn(inputCls, 'resize-none')}
                  value={form.customerNotes}
                  onChange={e => setForm(f => ({ ...f, customerNotes: e.target.value }))}
                  placeholder="Sem cebola, bem passado..." />
              </div>
              <div>
                <label className={labelCls}>Nota interna</label>
                <textarea rows={2} className={cn(inputCls, 'resize-none')}
                  value={form.internalNotes}
                  onChange={e => setForm(f => ({ ...f, internalNotes: e.target.value }))}
                  placeholder="Visível apenas para equipe..." />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">Subtotal: {formatCurrency(subtotal)}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Total: <span className="text-red-600 dark:text-red-400">{formatCurrency(total)}</span>
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} disabled={saving}
                className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
                Cancelar
              </button>
              <button onClick={handleSubmit} disabled={saving || !form.clientName.trim() || form.items.length === 0}
                className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold shadow-sm">
                {saving ? 'Salvando...' : isEditing ? 'Salvar Alterações' : 'Criar Pedido'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Order Detail Drawer ─────────────────────────────────────────────────────

function OrderDetailDrawer({
  order, onClose, onStatusChange, onEdit, onDelete,
}: {
  order: Order;
  onClose: () => void;
  onStatusChange: (status: OrderStatus) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const cfg = STATUS_CONFIG[order.status];
  const statusIdx = ORDER_STATUS_ORDER.indexOf(order.status);
  const nextStatus = statusIdx >= 0 && statusIdx < ORDER_STATUS_ORDER.length - 1
    ? ORDER_STATUS_ORDER[statusIdx + 1]
    : null;
  const prevStatus = statusIdx > 0 ? ORDER_STATUS_ORDER[statusIdx - 1] : null;

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      className="fixed top-0 right-0 bottom-0 z-40 w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-2xl overflow-y-auto"
    >
      {/* Header */}
      <div className={cn('p-5 border-b', cfg.border, cfg.bg)}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono font-bold">PEDIDO #{order.number}</p>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-0.5">{order.clientName}</h2>
            {order.clientPhone && (
              <a href={`tel:${order.clientPhone}`} className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-red-500 mt-1">
                <Phone className="w-3 h-3" />
                {order.clientPhone}
              </a>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/40 dark:hover:bg-black/20 text-gray-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold', cfg.color, 'bg-white/70 dark:bg-black/20')}>
          <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
          {cfg.label}
          <span className="text-gray-400">·</span>
          <span className="text-gray-500 dark:text-gray-400 font-medium">{timeSince(order.createdAt)} atrás</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-5 space-y-5">
        {/* Items */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Itens</p>
          <div className="space-y-1.5">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/40">
                <span className="w-7 h-7 rounded-md bg-white dark:bg-gray-900 flex items-center justify-center text-xs font-bold text-red-600">
                  {item.quantity}×
                </span>
                <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">{item.productName}</span>
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(item.total)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="bg-gray-50 dark:bg-gray-800/40 rounded-xl p-3 space-y-1">
          <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
            <span>Subtotal</span>
            <span>{formatCurrency(order.subtotal)}</span>
          </div>
          {(order.deliveryFee || 0) > 0 && (
            <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
              <span>Entrega</span>
              <span>{formatCurrency(order.deliveryFee!)}</span>
            </div>
          )}
          {(order.discount || 0) > 0 && (
            <div className="flex justify-between text-xs text-emerald-600">
              <span>Desconto</span>
              <span>−{formatCurrency(order.discount!)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold text-gray-900 dark:text-gray-100 pt-1 border-t border-gray-200 dark:border-gray-700">
            <span>Total</span>
            <span className="text-red-600 dark:text-red-400">{formatCurrency(order.total)}</span>
          </div>
        </div>

        {/* Payment */}
        <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
          <DollarSign className="w-4 h-4 text-gray-400" />
          <div className="flex-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Pagamento</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {order.paymentMethod ? PAYMENT_METHOD_LABELS[order.paymentMethod] : '—'}
              {order.paymentMethod === 'dinheiro' && order.changeFor ? ` · Troco p/ ${formatCurrency(order.changeFor)}` : ''}
            </p>
          </div>
          <span className={cn(
            'px-2 py-0.5 rounded-full text-[10px] font-bold',
            order.paymentStatus === 'pago'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
          )}>
            {order.paymentStatus.toUpperCase()}
          </span>
        </div>

        {/* Delivery */}
        {order.deliveryType === 'entrega' && order.deliveryAddress && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Entrega</p>
            <div className="flex items-start gap-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
              <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                {[
                  order.deliveryAddress.logradouro,
                  order.deliveryAddress.numero,
                  order.deliveryAddress.complemento,
                ].filter(Boolean).join(', ')}
                <br />
                {[order.deliveryAddress.bairro, order.deliveryAddress.municipio, order.deliveryAddress.uf].filter(Boolean).join(' · ')}
                {order.deliveryAddress.cep && ` · CEP ${order.deliveryAddress.cep}`}
                {order.deliveryAddress.reference && (
                  <>
                    <br />
                    <span className="text-gray-500 italic">Ref: {order.deliveryAddress.reference}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Notes */}
        {order.customerNotes && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
            <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1">Obs. do cliente</p>
            <p className="text-xs text-amber-800 dark:text-amber-200">{order.customerNotes}</p>
          </div>
        )}
        {order.internalNotes && (
          <div className="p-3 rounded-xl bg-gray-100 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700">
            <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Nota interna</p>
            <p className="text-xs text-gray-700 dark:text-gray-300">{order.internalNotes}</p>
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 p-4 space-y-2">
        {order.status !== 'entregue' && order.status !== 'cancelado' && (
          <div className="flex gap-2">
            {prevStatus && (
              <button onClick={() => onStatusChange(prevStatus)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ArrowLeft className="w-3.5 h-3.5" />
                Voltar
              </button>
            )}
            {nextStatus && (
              <button onClick={() => onStatusChange(nextStatus)}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-md shadow-red-600/20">
                Avançar para {STATUS_CONFIG[nextStatus].label}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
            <Edit3 className="w-3.5 h-3.5" />
            Editar
          </button>
          {order.status !== 'cancelado' && (
            <button onClick={() => onStatusChange('cancelado')}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-500/30 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10">
              <XCircle className="w-3.5 h-3.5" />
              Cancelar
            </button>
          )}
          <button onClick={onDelete}
            className="px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/30 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Module ─────────────────────────────────────────────────────────────

type ViewMode = 'board' | 'list';

export default function OrdersModule() {
  const { user, business } = useAuth();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [prefillFromConversation, setPrefillFromConversation] = useState<{
    clientId: string;
    clientName: string;
    clientPhone: string;
    channel?: OrderChannel;
    conversationId?: string;
    contactExternalId?: string;
  } | null>(null);

  // Detect incoming prefill from ConversasModule's "Criar Pedido" button
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem('pendingOrderPrefill');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      setPrefillFromConversation(data);
      setEditingOrder(null);
      setFormOpen(true);
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem('pendingOrderPrefill');
  }, []);

  // Real-time orders subscription
  useEffect(() => {
    if (!business?.id) return;
    setLoading(true);
    const q = query(
      collection(db, 'deliveryOrders'),
      where('businessId', '==', business.id),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setOrders(snap.docs.map(d => ({ ...d.data(), id: d.id } as Order)));
      setLoading(false);
    }, (err) => {
      console.error('[Orders] Subscription error:', err);
      setLoading(false);
    });
    return unsub;
  }, [business?.id]);

  // Related data
  const { data: clients = [] } = useQuery({
    queryKey: ['clients', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(collection(db, 'clients'), where('businessId', '==', business.id), orderBy('name'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Client));
    },
    enabled: !!business?.id,
    staleTime: 3 * 60 * 1000,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products', business?.id],
    queryFn: async () => {
      if (!business?.id) return [];
      const q = query(collection(db, 'products'), where('businessId', '==', business.id));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ ...d.data(), id: d.id } as Product));
    },
    enabled: !!business?.id,
    staleTime: 2 * 60 * 1000,
  });

  // Filtered orders
  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter(o =>
      o.clientName.toLowerCase().includes(term) ||
      o.clientPhone?.includes(term) ||
      String(o.number).includes(term) ||
      o.items.some(i => i.productName.toLowerCase().includes(term)),
    );
  }, [orders, search]);

  // Group by status (for board)
  const byStatus = useMemo(() => {
    const groups: Record<OrderStatus, Order[]> = {
      recebido: [], preparando: [], pronto: [], saiu_entrega: [], entregue: [], cancelado: [],
    };
    for (const o of filteredOrders) {
      // Hide delivered/cancelled older than 24h from board to keep it clean
      if (viewMode === 'board' && (o.status === 'entregue' || o.status === 'cancelado')) {
        const age = Date.now() - new Date(o.updatedAt).getTime();
        if (age > 24 * 60 * 60 * 1000) continue;
      }
      groups[o.status].push(o);
    }
    return groups;
  }, [filteredOrders, viewMode]);

  // KPIs
  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayOrders = orders.filter(o => o.createdAt.startsWith(today));
    const todayRevenue = todayOrders
      .filter(o => o.status !== 'cancelado')
      .reduce((s, o) => s + o.total, 0);
    const active = orders.filter(o => o.status !== 'entregue' && o.status !== 'cancelado').length;
    const urgent = orders.filter(isUrgent).length;
    // Avg prep+delivery time for today's delivered orders
    const delivered = todayOrders.filter(o => o.status === 'entregue' && o.deliveredAt);
    const avgTime = delivered.length > 0
      ? delivered.reduce((s, o) => s + (new Date(o.deliveredAt!).getTime() - new Date(o.createdAt).getTime()), 0) / delivered.length / 60000
      : 0;
    return { todayCount: todayOrders.length, todayRevenue, active, urgent, avgTime: Math.round(avgTime) };
  }, [orders]);

  // Get next sequential order number
  const getNextOrderNumber = useCallback(async (): Promise<number> => {
    if (!business?.id) return 1;
    const q = query(
      collection(db, 'deliveryOrders'),
      where('businessId', '==', business.id),
      orderBy('number', 'desc'),
      firestoreLimit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return 1;
    return (snap.docs[0].data().number || 0) + 1;
  }, [business?.id]);

  // Persist new/edit
  const persistOrder = async (data: OrderFormData) => {
    if (!business?.id || !user) return;
    const now = new Date().toISOString();
    const subtotal = data.items.reduce((s, i) => s + i.total, 0);
    const total = Math.max(0, subtotal + (data.deliveryFee || 0) - (data.discount || 0));
    const estimatedDeliveryAt = new Date(Date.now() + data.estimatedMinutes * 60000).toISOString();

    try {
      if (editingOrder) {
        const payload: Partial<Order> = {
          clientId: data.clientId || undefined,
          clientName: data.clientName.trim(),
          clientPhone: data.clientPhone || undefined,
          items: data.items,
          subtotal,
          deliveryFee: data.deliveryFee || undefined,
          discount: data.discount || undefined,
          total,
          deliveryType: data.deliveryType,
          deliveryAddress: data.deliveryType === 'entrega' ? data.address : undefined,
          paymentMethod: data.paymentMethod,
          paymentStatus: data.paymentStatus,
          changeFor: data.changeFor || undefined,
          customerNotes: data.customerNotes || undefined,
          internalNotes: data.internalNotes || undefined,
          estimatedDeliveryAt,
          updatedAt: now,
        };
        const cleaned = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
        await updateDoc(doc(db, 'deliveryOrders',editingOrder.id), cleaned);
        toast.success('Pedido atualizado');
      } else {
        const number = await getNextOrderNumber();
        const payload: Omit<Order, 'id'> = {
          businessId: business.id,
          number,
          status: 'recebido',
          clientId: data.clientId || undefined,
          clientName: data.clientName.trim(),
          clientPhone: data.clientPhone || undefined,
          channel: prefillFromConversation?.channel || 'manual',
          conversationId: prefillFromConversation?.conversationId,
          contactExternalId: prefillFromConversation?.contactExternalId,
          items: data.items,
          subtotal,
          deliveryFee: data.deliveryFee || undefined,
          discount: data.discount || undefined,
          total,
          deliveryType: data.deliveryType,
          deliveryAddress: data.deliveryType === 'entrega' ? data.address : undefined,
          paymentMethod: data.paymentMethod,
          paymentStatus: data.paymentStatus,
          changeFor: data.changeFor || undefined,
          customerNotes: data.customerNotes || undefined,
          internalNotes: data.internalNotes || undefined,
          estimatedDeliveryAt,
          createdAt: now,
          updatedAt: now,
        };
        const cleaned = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)) as Omit<Order, 'id'>;
        await addDoc(collection(db, 'deliveryOrders'), cleaned);
        toast.success(`Pedido #${number} criado!`);
      }
      setEditingOrder(null);
      setPrefillFromConversation(null);
      setFormOpen(false);
    } catch (err) {
      console.error('[Orders] Save failed:', err);
      toast.error('Erro ao salvar pedido');
    }
  };

  // Status change — deducts stock on transition into "preparando" (idempotent).
  const handleStatusChange = async (order: Order, newStatus: OrderStatus) => {
    if (!business?.id || !user) return;
    const now = new Date().toISOString();
    try {
      const patch: Record<string, unknown> = { status: newStatus, updatedAt: now };

      // Deduct stock when entering 'preparando' for the first time
      if (newStatus === 'preparando' && !order.stockDeductedAt) {
        const productIndex = new Map(products.map(p => [p.id, p]));
        const stockLines = order.items.map(i => ({ productId: i.productId, quantity: i.quantity }));
        await deductStock(db, stockLines, {
          businessId: business.id,
          operatorId: user.uid,
          operatorName: user.name,
          sourceId: order.id,
          reason: `Pedido #${order.number}`,
          productIndex,
        });
        patch.stockDeductedAt = now;
      }
      if (newStatus === 'entregue') {
        patch.deliveredAt = now;
      }

      await updateDoc(doc(db, 'deliveryOrders',order.id), patch);
      setSelectedOrder(prev => prev && prev.id === order.id ? { ...prev, ...patch, status: newStatus } as Order : prev);
      toast.success(`Pedido #${order.number}: ${STATUS_CONFIG[newStatus].label}`);

      // Auto-notify customer via original channel (if agent enabled). Fire-and-forget.
      if (business.settings?.aiAgent?.enabled && business.settings?.aiAgent?.pedidos?.notifyOnStatusChange) {
        void notifyStatusChange('order', order.id, newStatus, business.id);
      }
    } catch (err) {
      console.error('[Orders] Status change failed:', err);
      toast.error('Erro ao alterar status');
    }
  };

  async function notifyStatusChange(kind: 'order' | 'appointment', id: string, newStatus: string, businessId: string) {
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) return;
      await fetch('/api/conversations/status-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId, kind, id, newStatus }),
      });
    } catch (err) {
      console.warn('[Orders] status-notify failed:', err);
    }
  }

  const handleDelete = async (order: Order) => {
    if (!confirm(`Excluir o pedido #${order.number}? Esta ação não pode ser desfeita.`)) return;
    try {
      await deleteDoc(doc(db, 'deliveryOrders',order.id));
      setSelectedOrder(null);
      toast.info('Pedido excluído');
    } catch (err) {
      console.error('[Orders] Delete failed:', err);
      toast.error('Erro ao excluir');
    }
  };

  const formInitial = useMemo<OrderFormData>(() => {
    if (editingOrder) {
      return {
        clientId: editingOrder.clientId || '',
        clientName: editingOrder.clientName,
        clientPhone: editingOrder.clientPhone || '',
        items: [...editingOrder.items],
        deliveryType: editingOrder.deliveryType,
        deliveryFee: editingOrder.deliveryFee || 0,
        discount: editingOrder.discount || 0,
        address: editingOrder.deliveryAddress || {},
        paymentMethod: editingOrder.paymentMethod || 'pix',
        paymentStatus: editingOrder.paymentStatus,
        changeFor: editingOrder.changeFor || 0,
        customerNotes: editingOrder.customerNotes || '',
        internalNotes: editingOrder.internalNotes || '',
        estimatedMinutes: editingOrder.estimatedDeliveryAt
          ? Math.max(5, Math.round((new Date(editingOrder.estimatedDeliveryAt).getTime() - new Date(editingOrder.createdAt).getTime()) / 60000))
          : 45,
      };
    }
    if (prefillFromConversation) {
      const base = emptyOrderForm();
      // Best-effort: match client by id first, else by phone
      const matched = prefillFromConversation.clientId
        ? clients.find(c => c.id === prefillFromConversation.clientId)
        : clients.find(c => c.whatsapp === prefillFromConversation.clientPhone || c.phone === prefillFromConversation.clientPhone);
      return {
        ...base,
        clientId: matched?.id || prefillFromConversation.clientId || '',
        clientName: matched?.name || prefillFromConversation.clientName,
        clientPhone: prefillFromConversation.clientPhone,
        address: matched?.endereco ? {
          cep: matched.endereco.cep,
          logradouro: matched.endereco.logradouro,
          numero: matched.endereco.numero,
          complemento: matched.endereco.complemento,
          bairro: matched.endereco.bairro,
          municipio: matched.endereco.municipio,
          uf: matched.endereco.uf,
        } : base.address,
      };
    }
    return emptyOrderForm();
  }, [editingOrder, prefillFromConversation, clients]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 p-4 md:p-6 pb-3 space-y-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white font-display flex items-center gap-2.5">
              <ClipboardCheck className="w-6 h-6 text-red-500" />
              Pedidos
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Gerencie todos os pedidos em tempo real
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-xl p-0.5">
              <button
                onClick={() => setViewMode('board')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all',
                  viewMode === 'board' ? 'bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400',
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Kanban
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all',
                  viewMode === 'list' ? 'bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400',
                )}
              >
                <List className="w-3.5 h-3.5" />
                Lista
              </button>
            </div>
            <button
              onClick={() => { setEditingOrder(null); setFormOpen(true); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold shadow-sm shadow-red-600/20"
            >
              <Plus className="w-4 h-4" />
              Novo Pedido
            </button>
          </div>
        </div>

        {/* KPIs strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KPIMini label="Hoje" value={String(kpis.todayCount)} icon={ClipboardCheck} accent="text-blue-500" />
          <KPIMini label="Receita" value={formatCurrency(kpis.todayRevenue)} icon={DollarSign} accent="text-emerald-500" />
          <KPIMini label="Em andamento" value={String(kpis.active)} icon={Timer} accent="text-amber-500" />
          <KPIMini
            label="Atrasados"
            value={String(kpis.urgent)}
            icon={Sparkles}
            accent={kpis.urgent > 0 ? 'text-red-500' : 'text-gray-400'}
            alert={kpis.urgent > 0}
          />
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por #, cliente, telefone ou item..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-4">
              <ClipboardCheck className="w-8 h-8 text-red-500" />
            </div>
            <p className="text-gray-700 dark:text-gray-200 font-semibold">Nenhum pedido ainda</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Clique em "Novo Pedido" para começar</p>
          </div>
        ) : viewMode === 'board' ? (
          <div className="h-full overflow-x-auto overflow-y-hidden p-4">
            <div className="flex gap-3 h-full pb-2">
              {ORDER_STATUS_ORDER.map(status => (
                <KanbanColumn
                  key={status}
                  status={status}
                  orders={byStatus[status]}
                  onCardClick={setSelectedOrder}
                  onDrop={(orderId, newStatus) => {
                    const order = orders.find(o => o.id === orderId);
                    if (order && order.status !== newStatus) {
                      handleStatusChange(order, newStatus);
                    }
                  }}
                  draggedId={draggedId}
                />
              ))}
              {byStatus.cancelado.length > 0 && (
                <KanbanColumn
                  status="cancelado"
                  orders={byStatus.cancelado}
                  onCardClick={setSelectedOrder}
                  onDrop={(orderId, newStatus) => {
                    const order = orders.find(o => o.id === orderId);
                    if (order && order.status !== newStatus) handleStatusChange(order, newStatus);
                  }}
                  draggedId={draggedId}
                />
              )}
            </div>
          </div>
        ) : (
          // List view
          <div className="h-full overflow-y-auto p-4 space-y-2">
            {filteredOrders.map(o => {
              const cfg = STATUS_CONFIG[o.status];
              const StatusIcon = cfg.icon;
              return (
                <motion.button
                  key={o.id}
                  layout
                  onClick={() => setSelectedOrder(o)}
                  whileHover={{ x: 2 }}
                  className="w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:shadow-md transition-all flex items-center gap-4"
                >
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', cfg.bg)}>
                    <StatusIcon className={cn('w-5 h-5', cfg.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-gray-400">#{o.number}</span>
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{o.clientName}</span>
                      {isUrgent(o) && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400">ATRASADO</span>}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      {o.items.slice(0, 2).map(i => `${i.quantity}× ${i.productName}`).join(', ')}
                      {o.items.length > 2 ? ` +${o.items.length - 2}` : ''}
                    </p>
                  </div>
                  <div className={cn('px-2.5 py-1 rounded-full text-[10px] font-bold', cfg.bg, cfg.color)}>
                    {cfg.label}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-bold text-gray-900 dark:text-gray-100">{formatCurrency(o.total)}</p>
                    <p className="text-[10px] text-gray-400">{timeSince(o.createdAt)} atrás</p>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {/* Form dialog */}
      <OrderFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingOrder(null); setPrefillFromConversation(null); }}
        onSave={persistOrder}
        initial={formInitial}
        clients={clients}
        products={products}
        isEditing={!!editingOrder}
      />

      {/* Detail drawer */}
      <AnimatePresence>
        {selectedOrder && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedOrder(null)}
              className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
            />
            <OrderDetailDrawer
              order={selectedOrder}
              onClose={() => setSelectedOrder(null)}
              onStatusChange={(s) => handleStatusChange(selectedOrder, s)}
              onEdit={() => { setEditingOrder(selectedOrder); setSelectedOrder(null); setFormOpen(true); }}
              onDelete={() => handleDelete(selectedOrder)}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function KPIMini({ label, value, icon: Icon, accent, alert }: { label: string; value: string; icon: React.ElementType; accent: string; alert?: boolean }) {
  return (
    <motion.div
      whileHover={{ y: -1 }}
      className={cn(
        'bg-white dark:bg-gray-900 border rounded-xl p-3 flex items-center gap-3 transition-colors',
        alert ? 'border-red-300 dark:border-red-500/40' : 'border-gray-200 dark:border-gray-800',
      )}
    >
      <div className={cn('w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-800/60 flex items-center justify-center')}>
        <Icon className={cn('w-4 h-4', accent)} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{value}</p>
      </div>
    </motion.div>
  );
}

export type { OrderFormData };
