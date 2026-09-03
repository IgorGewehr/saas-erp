'use client';

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardCheck, Plus, Search, Clock, MapPin, User as UserIcon, Bike, CheckCircle2,
  X, ChefHat, Package, Truck, XCircle, Edit3, Trash2, Phone, DollarSign,
  ChevronDown, ArrowRight, ArrowLeft, MessageSquare, Timer, Sparkles,
  LayoutGrid, List, Filter, Home, Volume2, VolumeX, Bell, Printer, Check, Ban,
  Receipt, FileCheck2, UtensilsCrossed, Armchair,
} from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot, getDocs, updateDoc,
  doc, limit,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { formatCurrency, formatDateTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import { isActiveClient } from '@/lib/utils/clientFilters';
import { toast } from 'react-toastify';
import { notifyLowStock } from '@/lib/services/notifications';
import type {
  DeliveryOrder, DeliveryOrderStatus, DeliveryOrderItem, DeliveryOrderChannel,
  DeliveryOrderPaymentMethod, DeliveryOrderPaymentStatus, DeliveryType,
  Product, Client, DeliveryOrderAddress, StockAlert, PaymentFsmStatus,
} from '@/lib/types';
import { DELIVERY_ORDER_STATUS_FLOW, DELIVERY_ORDER_STATUS_LABELS } from '@/lib/types';
import { assertTransitionDeliveryOrder } from '@/lib/contracts/fsm/deliveryOrder';
import { useNewOrderAlert } from '@/lib/hooks/useNewOrderAlert';
import { printOrder } from '@/lib/services/printing/printOrder';
import PrinterSetupDialog from './PrinterSetupDialog';
import EmitirNotaDialog from '@/app/components/features/fiscal/EmitirNotaDialog';
import { buildDeliveryOrderNfceInput } from '@/lib/services/fiscal/deliveryOrderNfce';

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

// Fluxo de etapas por tipo: RETIRADA não passa por 'saiu_entrega' (pronto→entregue
// direto, já permitido pela FSM). ENTREGA segue o fluxo completo. Sem deliveryType
// (retrocompat) usa o fluxo completo. Filtro só remove a etapa de logística de rota.
function statusFlowFor(deliveryType?: DeliveryType): OrderStatus[] {
  // Mesa (salão) e retirada não têm etapa de "saiu para entrega".
  if (deliveryType === 'retirada' || deliveryType === 'mesa') {
    return ORDER_STATUS_ORDER.filter(s => s !== 'saiu_entrega');
  }
  return ORDER_STATUS_ORDER;
}

// EF-01: janela do onSnapshot de pedidos. ANTES a subscription lia o HISTÓRICO
// INTEIRO sem limit ⇒ custo/latência O(idade do tenant). AGORA limita a uma
// janela recente (createdAt >= início do dia − N dias), usando o índice
// businessId+createdAt já existente. Ativos são sempre recentes; board oculta
// entregue/cancelado > 24h; KPIs de hoje ficam dentro da janela.
const ORDERS_WINDOW_DAYS = 30;

function ordersWindowStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ORDERS_WINDOW_DAYS);
  return d.toISOString();
}

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
  pix_online: 'Pix (online)',
  cartao_online: 'Cartão (online)',
};

const PAYMENT_FSM_LABELS: Record<PaymentFsmStatus, string> = {
  pending: 'Pendente',
  authorized: 'Autorizado',
  paid: 'Pago',
  failed: 'Falhou',
  refunded: 'Estornado',
  expired: 'Expirado',
};

// ─── Payment state derivation ────────────────────────────────────────────────
// A FSM de pagamento online (paymentFsmStatus) é a fonte da verdade quando
// existe; paymentStatus (fabricação manual / dinheiro-na-entrega) é o fallback.

/** Pedido cobrado online (Mercado Pago checkout ou método *_online). */
function isOnlineOrder(order: Order): boolean {
  return order.paymentProvider === 'mercadopago'
    || (typeof order.paymentMethod === 'string' && order.paymentMethod.endsWith('_online'));
}

/** Pagamento confirmado? Lê paymentFsmStatus (online), cai pra paymentStatus. */
function isOrderPaid(order: Order): boolean {
  return order.paymentFsmStatus
    ? order.paymentFsmStatus === 'paid'
    : order.paymentStatus === 'pago';
}

/** Rótulo do estado de pagamento pra UI (FSM tem prioridade). */
function orderPaymentLabel(order: Order): string {
  if (order.paymentFsmStatus) return PAYMENT_FSM_LABELS[order.paymentFsmStatus];
  return order.paymentStatus === 'pago' ? 'Pago' : 'A pagar';
}

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

/** Cronômetro ao vivo (mm:ss ou Hh mm) desde `iso` até `nowMs`, pra destacar há
 *  quanto tempo um pedido novo espera aceite na cozinha. */
function elapsedSince(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${pad(m)}:${pad(s)}`;
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
      {order.deliveryType === 'mesa' && (
        <div className="-mx-3 -mt-3 mb-2 px-3 py-1.5 rounded-t-xl bg-indigo-600 text-white flex items-center gap-1.5">
          <Armchair className="w-3.5 h-3.5" />
          <span className="text-[13px] font-bold tracking-wide uppercase">
            Mesa {order.tableNumber || '—'}
          </span>
          {order.tableSessionId && (
            <span className="ml-auto text-[9px] font-semibold bg-white/20 px-1.5 py-0.5 rounded">
              comanda
            </span>
          )}
        </div>
      )}
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
          ) : order.deliveryType === 'mesa' ? (
            <UtensilsCrossed className="w-3 h-3 text-gray-400" />
          ) : (
            <Home className="w-3 h-3 text-gray-400" />
          )}
          <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
            {order.deliveryType === 'entrega' ? 'Entrega'
              : order.deliveryType === 'mesa' ? `Mesa ${order.tableNumber || '?'}`
                : 'Retirada'}
          </span>
          <span className={cn(
            'ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold',
            isOrderPaid(order)
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
          )}>
            {orderPaymentLabel(order)}
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
  tableNumber: string;
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
    tableNumber: '',
    paymentMethod: 'pix',
    paymentStatus: 'pendente',
    changeFor: 0,
    customerNotes: '',
    internalNotes: '',
    estimatedMinutes: 45,
  };
}

function OrderFormDialog({
  open, onClose, onSave, initial, clients, products, isEditing, lockPayment, lockedTableLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: OrderFormData, idempotencyKey: string) => Promise<void>;
  initial: OrderFormData;
  clients: Client[];
  products: Product[];
  isEditing: boolean;
  /** Pedido pago via Mercado Pago: status/método de pagamento são geridos pelo
   *  webhook (paymentFsmStatus), edição manual é proibida (grupo 9). */
  lockPayment: boolean;
  /** Pedido criado a partir de uma comanda de mesa (tela Mesas) — tipo/mesa
   *  travados; o pedido é vinculado à sessão pelo caller. */
  lockedTableLabel?: string;
}) {
  const [form, setForm] = useState<OrderFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  // Grupo 11: chave de idempotência ESTÁVEL por sessão do formulário. Vira o doc
  // id do pedido (setDoc) ⇒ retries do mesmo formulário (duplo-clique, rede lenta)
  // colapsam num único pedido em vez de duplicar. Renovada a cada abertura.
  const idemKeyRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (open) {
      setForm(initial);
      setClientSearch(initial.clientName || '');
      setProductSearch('');
      idemKeyRef.current = crypto.randomUUID();
    }
  }, [open, initial]);

  const deliverableProducts = useMemo(
    // Produtos com variação exigem variantId na cotação comercial (M02.1), que o
    // formulário manual ainda não coleta (fica para a M02.5e) — sem esse filtro,
    // adicionar um desses produtos resultaria em VARIANT_REQUIRED sem UI para resolver.
    () => products.filter(p => p.isDeliverable && p.isActive && !(p as { variants?: unknown[] }).variants?.length),
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
      await onSave(form, idemKeyRef.current);
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
            {lockedTableLabel ? (
              <div className="rounded-xl border-2 border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 px-3 py-2.5 flex items-center gap-2">
                <Armchair className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">
                  Pedido para a comanda da {lockedTableLabel}
                </span>
              </div>
            ) : (
              <>
                <div>
                  <label className={labelCls}>Tipo de atendimento</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['entrega', 'retirada', 'mesa'] as DeliveryType[]).map(t => (
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
                        {t === 'entrega' ? <><Bike className="w-4 h-4" /> Entrega</>
                          : t === 'retirada' ? <><Home className="w-4 h-4" /> Retirada</>
                            : <><UtensilsCrossed className="w-4 h-4" /> Mesa</>}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Table number (if mesa) */}
                {form.deliveryType === 'mesa' && (
                  <div>
                    <label className={labelCls}>Número da mesa</label>
                    <input
                      value={form.tableNumber}
                      onChange={e => setForm(f => ({ ...f, tableNumber: e.target.value }))}
                      placeholder="Ex: 12"
                      className={inputCls}
                    />
                  </div>
                )}
              </>
            )}

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
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[11px] text-gray-500">{p.menuCategory || p.category}</span>
                              {p.dietary && p.dietary.length > 0 && (
                                <span className="text-[11px]">
                                  {p.dietary.slice(0, 4).map(d => ({
                                    vegan: '🌱', vegetarian: '🥦', glutenfree: '🌾',
                                    lactosefree: '🥛', organic: '♻️', picante: '🌶️',
                                    alcool: '🍺', kids: '👶',
                                  } as Record<string, string>)[d] || '').filter(Boolean).join('')}
                                </span>
                              )}
                            </div>
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
                <select className={cn(inputCls, lockPayment && 'opacity-60 cursor-not-allowed')}
                  disabled={lockPayment}
                  value={form.paymentMethod}
                  onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value as OrderPaymentMethod }))}>
                  {Object.entries(PAYMENT_METHOD_LABELS)
                    .filter(([k]) => !k.endsWith('_online')) // online só via checkout/webhook MP, não no pedido manual
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Status do Pagamento</label>
                <select className={cn(inputCls, lockPayment && 'opacity-60 cursor-not-allowed')}
                  disabled={lockPayment}
                  value={form.paymentStatus}
                  onChange={e => setForm(f => ({ ...f, paymentStatus: e.target.value as OrderPaymentStatus }))}>
                  <option value="pendente">Pendente</option>
                  <option value="pago">Pago</option>
                  <option value="estornado">Estornado</option>
                </select>
              </div>
            </div>
            {lockPayment && (
              <p className="-mt-3 text-[11px] text-gray-500 dark:text-gray-400">
                Pagamento online (Mercado Pago): status e método são controlados
                automaticamente pelo gateway e não podem ser editados manualmente.
              </p>
            )}

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
  order, onClose, onStatusChange, onEdit, onDelete, onEmitNfce, onGoToMesas,
}: {
  order: Order;
  onClose: () => void;
  onStatusChange: (status: OrderStatus) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  /** Abre o EmitirNotaDialog pré-preenchido pra emitir a NFC-e deste pedido. */
  onEmitNfce: () => void;
  /** Navega pra tela Mesas (pedido faz parte de uma comanda). */
  onGoToMesas: () => void;
}) {
  const cfg = STATUS_CONFIG[order.status];
  const statusFlow = statusFlowFor(order.deliveryType);
  const statusIdx = statusFlow.indexOf(order.status);
  const rawNextStatus = statusIdx >= 0 && statusIdx < statusFlow.length - 1
    ? statusFlow[statusIdx + 1]
    : null;
  // Pedido vinculado a uma comanda de mesa: a entrega/receita acontece 1x no
  // fechamento da conta pelo PDV (tela Mesas) — nunca aqui, senão duplica receita.
  const lockedByTableSession = !!order.tableSessionId && rawNextStatus === 'entregue';
  const nextStatus = lockedByTableSession ? null : rawNextStatus;
  const prevStatus = statusIdx > 0 ? statusFlow[statusIdx - 1] : null;

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
            isOrderPaid(order)
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
          )}>
            {orderPaymentLabel(order).toUpperCase()}
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

        {/* Mesa (salão) */}
        {order.deliveryType === 'mesa' && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Mesa</p>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30">
              <Armchair className="w-5 h-5 text-indigo-500 flex-shrink-0" />
              <span className="text-lg font-bold text-indigo-700 dark:text-indigo-300">
                Mesa {order.tableNumber || '(não informada)'}
              </span>
              {order.tableSessionId && (
                <span className="ml-auto text-[10px] font-semibold text-indigo-600/80 dark:text-indigo-400/80">
                  parte de uma comanda
                </span>
              )}
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
        {lockedByTableSession && order.status !== 'cancelado' && (
          <button onClick={onGoToMesas}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-md shadow-indigo-600/20">
            <Armchair className="w-4 h-4" />
            Fechar conta na tela de Mesas
          </button>
        )}
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
        {/* NFC-e: emitida → badge (idempotência visual); senão, entregue/pago → botão.
            Emissão real vive no EmitirNotaDialog + /api/fiscal/emit (não reimplementada aqui). */}
        {order.fiscalDocumentId ? (
          <a
            href={order.fiscalAccessKey ? `https://www.nfce.fazenda.gov.br/portal/consultarNFCe.aspx?p=${order.fiscalAccessKey}` : undefined}
            target={order.fiscalAccessKey ? '_blank' : undefined}
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            NFC-e emitida
            {order.fiscalAccessKey && (
              <span className="font-mono text-[10px] text-emerald-600/70 dark:text-emerald-400/70 truncate max-w-[140px]">
                {order.fiscalAccessKey.slice(0, 8)}…{order.fiscalAccessKey.slice(-4)}
              </span>
            )}
          </a>
        ) : (order.status === 'entregue' || isOrderPaid(order)) ? (
          <button onClick={onEmitNfce}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 text-xs font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20">
            <Receipt className="w-3.5 h-3.5" />
            Emitir NFC-e
          </button>
        ) : null}
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

// ─── New-order reception bar ─────────────────────────────────────────────────
// Loop de recebimento da cozinha: destaca os pedidos aguardando ACEITE
// (status 'recebido'), com cronômetro ao vivo, controles de alerta (som/notif)
// e ações rápidas Aceitar / Recusar / Imprimir comanda por pedido.

function NewOrderCard({
  order, nowMs, onAccept, onReject, onPrint, onOpen,
}: {
  order: Order;
  nowMs: number;
  onAccept: (o: Order) => void;
  onReject: (o: Order) => void;
  onPrint: (o: Order) => void;
  onOpen: (o: Order) => void;
}) {
  const waitedMin = (nowMs - new Date(order.createdAt).getTime()) / 60000;
  const timerTone = waitedMin >= 15
    ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
    : waitedMin >= 7
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
      : 'bg-white/70 text-gray-700 dark:bg-black/30 dark:text-gray-200';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.92, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: -8 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="min-w-[260px] w-[260px] flex-shrink-0 rounded-2xl bg-white dark:bg-gray-900 border-2 border-amber-300 dark:border-amber-500/40 shadow-md shadow-amber-500/10 p-3 flex flex-col gap-2"
    >
      <button onClick={() => onOpen(order)} className="text-left">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {order.channel && (
              <span className={cn('text-[11px]', CHANNEL_ICONS[order.channel].color)}>
                {CHANNEL_ICONS[order.channel].icon}
              </span>
            )}
            <span className="text-[11px] font-mono font-bold text-gray-400 dark:text-gray-500">#{order.number}</span>
          </div>
          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums', timerTone)}>
            <Clock className="w-3 h-3" />
            {elapsedSince(order.createdAt, nowMs)}
          </span>
        </div>
        <p className="mt-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{order.clientName}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {order.items.slice(0, 2).map(i => `${i.quantity}× ${i.productName}`).join(', ')}
          {order.items.length > 2 ? ` +${order.items.length - 2}` : ''}
        </p>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          {order.deliveryType === 'entrega' ? <Bike className="w-3 h-3" />
            : order.deliveryType === 'mesa' ? <UtensilsCrossed className="w-3 h-3" />
              : <Home className="w-3 h-3" />}
          <span>
            {order.deliveryType === 'entrega' ? 'Entrega'
              : order.deliveryType === 'mesa' ? `Mesa ${order.tableNumber || '?'}`
                : 'Retirada'}
          </span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span className="font-semibold text-gray-700 dark:text-gray-300">{formatCurrency(order.total)}</span>
        </div>
      </button>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onAccept(order)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm shadow-emerald-600/20"
        >
          <Check className="w-3.5 h-3.5" />
          Aceitar
        </button>
        <button
          onClick={() => onPrint(order)}
          title="Imprimir comanda"
          className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <Printer className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onReject(order)}
          title="Recusar pedido"
          className="p-2 rounded-xl border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
        >
          <Ban className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

function NewOrderReceptionBar({
  orders, onAccept, onReject, onPrint, onOpen,
  soundOn, toggleSound, notifPermission, onRequestNotif,
  autoPrint, onToggleAutoPrint,
}: {
  orders: Order[];
  onAccept: (o: Order) => void;
  onReject: (o: Order) => void;
  onPrint: (o: Order) => void;
  onOpen: (o: Order) => void;
  soundOn: boolean;
  toggleSound: () => void;
  notifPermission: 'default' | 'granted' | 'denied' | 'unsupported';
  onRequestNotif: () => void;
  autoPrint: boolean;
  onToggleAutoPrint: () => void;
}) {
  // Cronômetro ao vivo: um único tick de 1s re-renderiza todos os cards.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden rounded-2xl border-2 border-amber-300 dark:border-amber-500/40 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <motion.span
            animate={{ scale: [1, 1.15, 1] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
            className="relative flex items-center justify-center w-8 h-8 rounded-xl bg-amber-500 text-white shadow-sm"
          >
            <Bell className="w-4 h-4" />
          </motion.span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300 font-display leading-tight">
              Novos Pedidos · {orders.length}
            </p>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 truncate">
              Aguardando aceite da cozinha
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={onToggleAutoPrint}
            title="Imprimir comanda automaticamente ao aceitar"
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors',
              autoPrint
                ? 'bg-amber-600 border-amber-600 text-white'
                : 'bg-white/70 dark:bg-black/20 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300',
            )}
          >
            <Printer className="w-3.5 h-3.5" />
            Auto-imprimir
          </button>
          {notifPermission !== 'granted' && notifPermission !== 'unsupported' && (
            <button
              onClick={onRequestNotif}
              title="Permitir notificações no desktop"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border bg-white/70 dark:bg-black/20 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-white"
            >
              <Bell className="w-3.5 h-3.5" />
              Notificar
            </button>
          )}
          <button
            onClick={toggleSound}
            title={soundOn ? 'Silenciar alerta sonoro' : 'Ativar alerta sonoro'}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors',
              soundOn
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'bg-white/70 dark:bg-black/20 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300',
            )}
          >
            {soundOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            {soundOn ? 'Som on' : 'Som off'}
          </button>
        </div>
      </div>

      <div className="flex gap-2.5 overflow-x-auto px-4 pb-3 pt-1">
        <AnimatePresence mode="popLayout" initial={false}>
          {orders.map(o => (
            <NewOrderCard
              key={o.id}
              order={o}
              nowMs={nowMs}
              onAccept={onAccept}
              onReject={onReject}
              onPrint={onPrint}
              onOpen={onOpen}
            />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── Main Module ─────────────────────────────────────────────────────────────

type ViewMode = 'board' | 'list';

const AUTO_PRINT_PREF_KEY = 'orders:autoPrintOnAccept';

export default function OrdersModule() {
  const { user, business, firebaseUser } = useAuth();
  const { setActivePage } = useAppContext();

  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | DeliveryType>('all');
  const [printerSetupOpen, setPrinterSetupOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  // Pedido em emissão de NFC-e — quando setado, abre o EmitirNotaDialog
  // pré-preenchido. Null = fechado.
  const [nfceOrder, setNfceOrder] = useState<Order | null>(null);

  // Preferência local (por dispositivo) de imprimir a comanda ao aceitar.
  const [autoPrintOnAccept, setAutoPrintOnAccept] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setAutoPrintOnAccept(window.localStorage.getItem(AUTO_PRINT_PREF_KEY) === '1');
  }, []);
  const toggleAutoPrint = useCallback(() => {
    setAutoPrintOnAccept(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(AUTO_PRINT_PREF_KEY, next ? '1' : '0');
      }
      return next;
    });
  }, []);
  const [prefillFromConversation, setPrefillFromConversation] = useState<{
    clientId: string;
    clientName: string;
    clientPhone: string;
    channel?: OrderChannel;
    conversationId?: string;
    contactExternalId?: string;
  } | null>(null);
  const [prefillCartItems, setPrefillCartItems] = useState<OrderItem[]>([]);
  // Pedido vindo da tela Mesas ("+ Pedido") — vincula à comanda da mesa.
  const [prefillTableSession, setPrefillTableSession] = useState<{ tableSessionId: string; tableLabel: string } | null>(null);

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

  // Detect cart items from Cardápio module
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem('pendingCartItems');
    if (!raw) return;
    try {
      const items = JSON.parse(raw);
      if (Array.isArray(items) && items.length > 0) {
        setPrefillCartItems(items as OrderItem[]);
        setEditingOrder(null);
        setFormOpen(true);
      }
    } catch { /* ignore */ }
    sessionStorage.removeItem('pendingCartItems');
  }, []);

  // Detect "+ Pedido" handoff from the Mesas module
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem('pendingTableOrder');
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { tableSessionId?: string; tableLabel?: string };
      if (data.tableSessionId && data.tableLabel) {
        setPrefillTableSession({ tableSessionId: data.tableSessionId, tableLabel: data.tableLabel });
        setEditingOrder(null);
        setFormOpen(true);
      }
    } catch { /* ignore */ }
    sessionStorage.removeItem('pendingTableOrder');
  }, []);

  // Real-time orders subscription
  useEffect(() => {
    if (!business?.id) return;
    setLoading(true);
    const q = query(
      collection(db, 'deliveryOrders'),
      where('businessId', '==', business.id),
      where('createdAt', '>=', ordersWindowStartIso()),
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

  // Products — onSnapshot (refactor sync multi-user): em ambiente delivery
  // multi-atendente o preço/disponibilidade muda o tempo todo (Estoque), então
  // o cardápio no formulário precisa ser tempo real.
  //
  // EF-02: clients, ao contrário, alimentam APENAS o autocomplete do formulário.
  // ANTES: onSnapshot da coleção INTEIRA ⇒ listener persistente re-disparava a
  // cada escrita em qualquer cliente do tenant. AGORA: getDocs one-shot por
  // business (sem tempo real). Single-field query + sort client-side (evita
  // composite index). Refetch ao reabrir o módulo/trocar de business cobre o
  // caso de cliente novo cadastrado via Conversas.
  const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    const q = query(collection(db, 'clients'), where('businessId', '==', business.id), limit(2000));
    getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        const list = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as Client))
          .filter(isActiveClient)
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setClients(list);
      })
      .catch((err) => console.error('[Orders] clients load error:', err));
    return () => { cancelled = true; };
  }, [business?.id]);

  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'products'), where('businessId', '==', business.id));
    const unsub = onSnapshot(q, (snap) => {
      setProducts(snap.docs.map(d => ({ ...d.data(), id: d.id } as Product)));
    }, (err) => console.error('[Orders] products snapshot error:', err));
    return () => unsub();
  }, [business?.id]);

  // Sync selectedOrder com snapshot. Em ambiente delivery multi-atendente,
  // se outro user muda o status/dados do pedido aberto no painel, atualiza
  // a referência. Se o pedido for deletado externamente, fecha o painel.
  useEffect(() => {
    if (!selectedOrder) return;
    const fresh = orders.find(o => o.id === selectedOrder.id);
    if (!fresh) { setSelectedOrder(null); return; }
    if (fresh.updatedAt !== selectedOrder.updatedAt) setSelectedOrder(fresh);
  }, [orders, selectedOrder]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter(o => {
      if (typeFilter !== 'all' && o.deliveryType !== typeFilter) return false;
      if (!term) return true;
      return o.clientName.toLowerCase().includes(term)
        || o.clientPhone?.includes(term)
        || String(o.number).includes(term)
        || o.tableNumber?.toLowerCase().includes(term)
        || o.items.some(i => i.productName.toLowerCase().includes(term));
    });
  }, [orders, search, typeFilter]);

  const typeCounts = useMemo(() => {
    const c = { entrega: 0, retirada: 0, mesa: 0 };
    for (const o of orders) {
      if (o.status === 'entregue' || o.status === 'cancelado') continue;
      if (o.deliveryType && o.deliveryType in c) c[o.deliveryType as keyof typeof c]++;
    }
    return c;
  }, [orders]);

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

  // Loop de recebimento: pedidos aguardando aceite ('recebido'). Não passa pelo
  // filtro de busca — a cozinha precisa ver TODO pedido novo até dar aceite.
  const newOrders = useMemo(
    () => orders.filter(o => o.status === 'recebido'),
    [orders],
  );

  const businessName = business?.nomeFantasia || business?.razaoSocial || 'Estabelecimento';

  // Alerta sonoro em loop + notificação desktop enquanto houver pedido não-aceito.
  const { soundOn, toggleSound, notifPermission, requestNotif } = useNewOrderAlert(newOrders.length);

  // KPIs
  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayOrders = orders.filter(o => o.createdAt.startsWith(today));
    // Grupo 10: receita POTENCIAL (todos os pedidos não-cancelados de hoje,
    // inclusive não-entregues/não-pagos). NÃO é a receita reconhecida do
    // Financeiro — essa é lançada por competência só na entrega, pelo núcleo
    // server-side (transitionDeliveryOrderAdmin). KPI rotulado "Receita
    // potencial" pra não confundir.
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

  // Persist new/edit
  const persistOrder = async (data: OrderFormData, idempotencyKey: string) => {
    if (!business?.id || !user) return;
    const estimatedDeliveryAt = new Date(Date.now() + data.estimatedMinutes * 60000).toISOString();

    try {
      if (editingOrder) {
        // M02_EDICAO_PEDIDO_POS_EFEITO: edição delega ao endpoint autenticado
        // server-side (editDeliveryOrderAdmin, mesma função usada pelo agente)
        // — o estoque já é debitado NA CRIAÇÃO do pedido (núcleo comercial),
        // então trocar itens aqui exige reconciliar estoque, não só sobrescrever
        // o documento. O servidor bloqueia a troca de itens/valores quando o
        // pedido já saiu de 'recebido' (cancelar e criar novo é o caminho).
        // Grupo 9: pedido Mercado Pago tem status/método controlados pelo
        // webhook (paymentFsmStatus) — o servidor já ignora esses campos nesse caso.
        const payload = {
          clientId: data.clientId || undefined,
          clientName: data.clientName.trim(),
          clientPhone: data.clientPhone || undefined,
          items: data.items,
          deliveryFee: data.deliveryFee || undefined,
          discount: data.discount || undefined,
          deliveryType: data.deliveryType,
          deliveryAddress: data.deliveryType === 'entrega' ? data.address : undefined,
          tableNumber: data.deliveryType === 'mesa' ? (data.tableNumber || undefined) : undefined,
          paymentMethod: data.paymentMethod,
          paymentStatus: data.paymentStatus,
          changeFor: data.changeFor || undefined,
          customerNotes: data.customerNotes || undefined,
          internalNotes: data.internalNotes || undefined,
          estimatedDeliveryAt,
        };
        const cleaned = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
        await editOrder(editingOrder.id, cleaned);
        toast.success('Pedido atualizado');
      } else {
        // M02.5b: criação delega preço, modificadores, zona de entrega, desconto
        // manual e estoque ao núcleo comercial (mesmo usado pelo PDV/cardápio
        // público) via rota autenticada — servidor recalcula tudo, não confia
        // no que o formulário manda. Idempotência é do núcleo (chave do form).
        if (!firebaseUser) {
          toast.error('Sessão expirada. Entre novamente.');
          return;
        }
        const token = await firebaseUser.getIdToken();
        const response = await fetch('/api/orders/manual', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            businessId: business.id,
            clientId: data.clientId || undefined,
            clientName: data.clientName.trim(),
            clientPhone: data.clientPhone || undefined,
            items: data.items,
            deliveryType: data.deliveryType,
            deliveryAddress: data.deliveryType === 'entrega' ? data.address : undefined,
            tableNumber: data.deliveryType === 'mesa' ? (data.tableNumber || undefined) : undefined,
            tableSessionId: prefillTableSession?.tableSessionId,
            manualDeliveryFee: data.deliveryFee || undefined,
            discount: data.discount || undefined,
            discountReason: data.discount ? 'Desconto manual no pedido' : undefined,
            paymentMethod: data.paymentMethod,
            paymentStatus: data.paymentStatus,
            changeFor: data.changeFor || undefined,
            customerNotes: data.customerNotes || undefined,
            internalNotes: data.internalNotes || undefined,
            estimatedMinutes: data.estimatedMinutes || undefined,
            originChannel: prefillFromConversation?.channel || 'manual',
            conversationId: prefillFromConversation?.conversationId,
            contactExternalId: prefillFromConversation?.contactExternalId,
            idempotencyKey,
          }),
        });
        const payload = await response.json().catch(() => null) as {
          ok?: boolean;
          error?: string;
          data?: { orderNumber: number };
        } | null;
        if (!response.ok || !payload?.ok || !payload.data) {
          throw new Error(payload?.error || 'Erro ao criar pedido');
        }
        toast.success(`Pedido #${payload.data.orderNumber} criado!`);
      }
      setEditingOrder(null);
      setPrefillFromConversation(null);
      setPrefillCartItems([]);
      setPrefillTableSession(null);
      setFormOpen(false);
    } catch (err) {
      console.error('[Orders] Save failed:', err);
      toast.error('Erro ao salvar pedido');
    }
  };

  // M02_EDICAO_PEDIDO_POS_EFEITO: edição delega ao endpoint autenticado
  // server-side (editDeliveryOrderAdmin) — reconcilia estoque quando itens
  // mudam com o pedido ainda em 'recebido', ou rejeita (409) se já saiu dali.
  const editOrder = useCallback(async (
    orderId: string,
    patch: Record<string, unknown>,
  ): Promise<void> => {
    if (!business?.id || !firebaseUser) throw new Error('Sessão expirada. Entre novamente.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/orders/${orderId}/edit`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ businessId: business.id, patch }),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || 'Erro ao editar pedido');
    }
  }, [business?.id, firebaseUser]);

  // M02.5d: transição de status delega ao endpoint autenticado server-side
  // (mesma função usada pelo agente — transitionDeliveryOrderAdmin), que
  // centraliza FSM, gate X1, receita de entrega (com fidelidade) e restauro de
  // estoque no cancelamento. Substitui os writes diretos e o lançamento de
  // receita/restauro de estoque que antes eram feitos aqui pelo SDK cliente.
  const transitionOrder = useCallback(async (
    orderId: string,
    status: OrderStatus,
    reason?: string,
  ): Promise<{ stockAlerts: StockAlert[] }> => {
    if (!business?.id || !firebaseUser) throw new Error('Sessão expirada. Entre novamente.');
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/orders/${orderId}/transition`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ businessId: business.id, status, reason }),
    });
    const payload = await response.json().catch(() => null) as {
      ok?: boolean;
      error?: string;
      data?: { status: OrderStatus; stockAlerts: StockAlert[] };
    } | null;
    if (!response.ok || !payload?.ok || !payload.data) {
      throw new Error(payload?.error || 'Erro ao alterar pedido');
    }
    return { stockAlerts: payload.data.stockAlerts };
  }, [business?.id, firebaseUser]);

  // Status change — o servidor decide/aplica os efeitos (estoque, receita,
  // fidelidade); aqui só a UX otimista (feedback imediato) + pós-efeitos client
  // (toasts, notificação, fiscal).
  const handleStatusChange = async (order: Order, newStatus: OrderStatus) => {
    if (!business?.id || !user) return;
    try {
      // Pré-checagens client-side (UX otimista — o servidor revalida de qualquer forma).
      if (newStatus !== order.status) {
        assertTransitionDeliveryOrder(order.status, newStatus);
      }
      if (newStatus === 'entregue' && isOnlineOrder(order) && order.paymentFsmStatus !== 'paid') {
        toast.error('Pedido online ainda não foi pago — não é possível entregar.');
        return;
      }

      const { stockAlerts } = await transitionOrder(order.id, newStatus);

      if (newStatus === 'entregue') {
        // Fiscal: auto-emissão de NFC-e na conclusão (opt-in). Fire-and-forget —
        // a receita/entrega já foi efetivada no servidor; a nota nunca bloqueia o pedido.
        void autoEmitNfceIfEnabled(order);
      }

      setSelectedOrder(prev => prev && prev.id === order.id ? { ...prev, status: newStatus } as Order : prev);
      toast.success(`Pedido #${order.number}: ${STATUS_CONFIG[newStatus].label}`);

      // Estoque baixo após dedução do pedido (só relevante em 'preparando' de
      // pedidos legados sem stockDeductedAt): toast + notif (best-effort).
      if (stockAlerts.length > 0) {
        stockAlerts.forEach(a => {
          const icon = a.severity === 'zeroed' ? '🚨' : '⚠️';
          const msg = a.severity === 'zeroed'
            ? `${icon} ${a.productName} esgotou`
            : `${icon} ${a.productName} no estoque mínimo (${a.newStock}/${a.minStock})`;
          toast.warning(msg, { autoClose: 6000 });
        });
        void notifyLowStock(db, {
          businessId: business.id,
          alerts: stockAlerts,
          actorId: user.uid,
          actorName: user.name,
          sourceLabel: `Pedido #${order.number}`,
        });
      }

      // Auto-notify customer via original channel (if agent enabled). Fire-and-forget.
      if (business.settings?.aiAgent?.enabled && business.settings?.aiAgent?.pedidos?.notifyOnStatusChange) {
        void notifyStatusChange('order', order.id, newStatus, business.id);
      }
    } catch (err) {
      console.error('[Orders] Status change failed:', err);
      const msg = err instanceof Error && err.message.startsWith('DeliveryOrder FSM:')
        ? 'Transição de status inválida'
        : err instanceof Error && (err.message.startsWith('ONLINE_UNPAID') || err.message.includes('pagamento online'))
          ? 'Pedido online ainda não foi pago'
          : 'Erro ao alterar status';
      toast.error(msg);
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

  // Auto-emissão de NFC-e na conclusão do pedido (opt-in via Settings → Fiscal).
  // Best-effort: só dispara quando o flag está ligado e a nota ainda não existe
  // (o route /api/fiscal/emit-order reforça a idempotência por fiscalDocumentId —
  // o guard local só evita o round-trip). Nunca lança: a entrega já foi efetivada.
  async function autoEmitNfceIfEnabled(order: Order) {
    if (!business?.fiscal?.nfceConfig?.autoEmit) return;
    if (order.fiscalDocumentId) return;
    // Fiscal: a NFC-e é montada sobre a MERCADORIA cheia (soma dos itens) e um
    // único tender no método do pedido. Ainda não modelamos (a) desconto de cupom
    // como vDesc nem (b) gift card como pagamento em voucher (tPag 12). Auto-emitir
    // um pedido com cupom OU gift card distorceria base/tender — então pulamos a
    // auto-emissão e deixamos o operador emitir manualmente (ciente dos valores).
    // Follow-up: modelar couponDiscount (vDesc) e giftCardAmount (voucher) no emit.
    if ((order.couponDiscount ?? order.discount ?? 0) > 0 || (order.giftCardAmount ?? 0) > 0) {
      console.info('[Orders] auto-emit NFC-e pulada: pedido com cupom/gift card (emitir manual).');
      return;
    }
    try {
      const { getAuth } = await import('firebase/auth');
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(`/api/fiscal/emit-order/${order.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.warn('[Orders] auto-emit NFC-e falhou:', res.status);
      }
    } catch (err) {
      console.warn('[Orders] auto-emit NFC-e error:', err);
    }
  }

  const handleDelete = async (order: Order) => {
    if (!business?.id) return;
    if (!confirm(`Cancelar o pedido #${order.number}? O pedido fica no histórico marcado como cancelado.`)) return;
    if (!user) return;
    try {
      // Idempotente: se já cancelado, skip.
      if (order.status === 'cancelado') {
        setSelectedOrder(null);
        toast.info('Pedido já estava cancelado');
        return;
      }
      // M02.5d: FSM validada server-side (fecha o gap desta função, que antes
      // não validava a transição — um pedido já 'entregue' não pode mais ser
      // "excluído" sem reverter a receita explicitamente).
      await transitionOrder(order.id, 'cancelado');
      setSelectedOrder(null);
      toast.info('Pedido cancelado');
    } catch (err) {
      console.error('[Orders] Delete failed:', err);
      const msg = err instanceof Error && err.message.startsWith('DeliveryOrder FSM:')
        ? 'Transição de status inválida (pedido já entregue?)'
        : 'Erro ao cancelar';
      toast.error(msg);
    }
  };

  // Aceite do pedido novo: recebido→preparando (reusa handleStatusChange, que já
  // valida a FSM e faz a baixa de estoque). Opcionalmente imprime a comanda.
  const handleAccept = useCallback(async (order: Order) => {
    await handleStatusChange(order, 'preparando');
    if (autoPrintOnAccept) void printOrder(order, businessName, business?.id || '');
  }, [handleStatusChange, autoPrintOnAccept, businessName, business?.id]);

  // Recusa do pedido novo: recebido→cancelado com motivo. Reusa o MESMO caminho
  // de cancelamento server-side (transitionOrder).
  const handleReject = useCallback(async (order: Order) => {
    if (!business?.id || !user) return;
    if (order.status === 'cancelado') return;
    const reason = (typeof window !== 'undefined'
      ? window.prompt(`Recusar o pedido #${order.number}? Informe o motivo:`, '')
      : '') ?? undefined;
    if (reason === undefined) return; // cancelou o prompt
    try {
      // Pré-checagem client-side (UX otimista — o servidor revalida de qualquer forma).
      assertTransitionDeliveryOrder(order.status, 'cancelado');
      await transitionOrder(order.id, 'cancelado', reason.trim() || undefined);
      setSelectedOrder(prev => prev && prev.id === order.id ? null : prev);
      toast.info(`Pedido #${order.number} recusado`);
      if (business.settings?.aiAgent?.enabled && business.settings?.aiAgent?.pedidos?.notifyOnStatusChange) {
        void notifyStatusChange('order', order.id, 'cancelado', business.id);
      }
    } catch (err) {
      console.error('[Orders] Reject failed:', err);
      const msg = err instanceof Error && err.message.startsWith('DeliveryOrder FSM:')
        ? 'Transição de status inválida'
        : 'Erro ao recusar pedido';
      toast.error(msg);
    }
  }, [business, user, transitionOrder]);

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
        tableNumber: editingOrder.tableNumber || '',
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
    if (prefillTableSession) {
      return {
        ...emptyOrderForm(),
        deliveryType: 'mesa',
        tableNumber: prefillTableSession.tableLabel,
        items: prefillCartItems,
      };
    }
    if (prefillCartItems.length > 0) {
      return { ...emptyOrderForm(), items: prefillCartItems };
    }
    return emptyOrderForm();
  }, [editingOrder, prefillFromConversation, prefillCartItems, prefillTableSession, clients]);

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
              onClick={() => setPrinterSetupOpen(true)}
              title="Configurar impressora"
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800/60 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
            >
              <Printer className="w-4 h-4" />
            </button>
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
          <KPIMini label="Receita potencial" value={formatCurrency(kpis.todayRevenue)} icon={DollarSign} accent="text-emerald-500" />
          <KPIMini label="Em andamento" value={String(kpis.active)} icon={Timer} accent="text-amber-500" />
          <KPIMini
            label="Atrasados"
            value={String(kpis.urgent)}
            icon={Sparkles}
            accent={kpis.urgent > 0 ? 'text-red-500' : 'text-gray-400'}
            alert={kpis.urgent > 0}
          />
        </div>

        {/* Search + type filter */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por #, cliente, telefone, mesa ou item..."
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
            />
          </div>
          <div className="flex items-center bg-gray-100 dark:bg-gray-800/60 rounded-xl p-0.5 self-start">
            {([
              ['all', 'Todos', null],
              ['entrega', 'Entrega', typeCounts.entrega],
              ['retirada', 'Retirada', typeCounts.retirada],
              ['mesa', 'Mesa', typeCounts.mesa],
            ] as const).map(([val, lbl, count]) => (
              <button
                key={val}
                onClick={() => setTypeFilter(val)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap',
                  typeFilter === val ? 'bg-white dark:bg-gray-900 shadow-sm text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400',
                )}
              >
                {lbl}
                {count != null && count > 0 && (
                  <span className="px-1 rounded bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 text-[10px]">{count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loop de recebimento — pedidos aguardando aceite */}
      <AnimatePresence initial={false}>
        {newOrders.length > 0 && (
          <div key="new-orders-bar" className="flex-shrink-0 px-4 md:px-6 pt-3">
            <NewOrderReceptionBar
              orders={newOrders}
              onAccept={handleAccept}
              onReject={handleReject}
              onPrint={(o) => { void printOrder(o, businessName, business?.id || '').then(r => { if (r.method === 'webusb') toast.success('Comanda enviada à impressora'); }); }}
              onOpen={setSelectedOrder}
              soundOn={soundOn}
              toggleSound={toggleSound}
              notifPermission={notifPermission}
              onRequestNotif={() => { void requestNotif(); }}
              autoPrint={autoPrintOnAccept}
              onToggleAutoPrint={toggleAutoPrint}
            />
          </div>
        )}
      </AnimatePresence>

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
        onClose={() => { setFormOpen(false); setEditingOrder(null); setPrefillFromConversation(null); setPrefillCartItems([]); setPrefillTableSession(null); }}
        onSave={persistOrder}
        initial={formInitial}
        clients={clients}
        products={products}
        isEditing={!!editingOrder}
        lockPayment={editingOrder?.paymentProvider === 'mercadopago'}
        lockedTableLabel={prefillTableSession?.tableLabel}
      />

      <PrinterSetupDialog
        open={printerSetupOpen}
        onClose={() => setPrinterSetupOpen(false)}
        businessId={business?.id || ''}
        businessName={businessName}
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
              onEmitNfce={() => { setNfceOrder(selectedOrder); setSelectedOrder(null); }}
              onGoToMesas={() => { setSelectedOrder(null); setActivePage('Mesas'); }}
            />
          </>
        )}
      </AnimatePresence>

      {/* Emissão de NFC-e do pedido — reusa o dialog fiscal existente, pré-preenchido
          via buildDeliveryOrderNfceInput. A emissão real (certificado + SEFAZ) e o
          writeback fiscalDocumentId/accessKey vivem no /api/fiscal/emit. */}
      <EmitirNotaDialog
        open={!!nfceOrder}
        onClose={() => setNfceOrder(null)}
        type="nfce"
        onSuccess={() => setNfceOrder(null)}
        prefillNFCe={nfceOrder && business ? buildDeliveryOrderNfceInput(nfceOrder, business) : undefined}
      />
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
