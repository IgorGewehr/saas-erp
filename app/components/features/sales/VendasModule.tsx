'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, Plus, Search, Filter, X, Edit2, Trash2, ChevronDown,
  CheckCircle2, Clock, Package, FileText, Users, DollarSign, TrendingUp,
  MoreVertical, AlertCircle, ArrowRight, Printer, Receipt, Tag,
  CalendarClock, ShoppingBag, Building2, User,
} from 'lucide-react';
import {
  collection, query, where, orderBy, addDoc, updateDoc, deleteDoc, doc, onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useMutation } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type {
  Order, OrderStatus, OrderType, OrderItem, Client, Product,
  Payment, PaymentMethod,
} from '@/lib/types';
import { ORDER_STATUS_COLORS as STATUS_COLORS, ORDER_STATUS_LABELS as STATUS_LABELS } from '@/lib/types';
import { toast } from 'react-toastify';

// ─── Constants ───────────────────────────────────────────────────────────────

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  pdv: 'PDV',
  b2b: 'B2B',
  condicional: 'Condicional',
};

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'PIX' },
  { value: 'credito', label: 'Cartão de Crédito' },
  { value: 'debito', label: 'Cartão de Débito' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'outros', label: 'Outros' },
];

// Allowed next statuses from current status
const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  pendente:    ['confirmado', 'condicional', 'cancelado'],
  confirmado:  ['faturado', 'cancelado'],
  condicional: ['confirmado', 'cancelado'],
  faturado:    ['enviado', 'cancelado'],
  enviado:     ['entregue'],
  entregue:    [],
  cancelado:   [],
};

// ─── Order Status Badge ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── Item Row (in form) ───────────────────────────────────────────────────────

function ItemRow({
  item,
  products,
  onChange,
  onRemove,
}: {
  item: OrderItem & { _key: string };
  products: Product[];
  onChange: (key: string, field: keyof OrderItem, value: string | number) => void;
  onRemove: (key: string) => void;
}) {
  const inputCls = 'w-full bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 transition-all';

  const handleProductSelect = (productId: string) => {
    const prod = products.find(p => p.id === productId);
    if (prod) {
      onChange(item._key, 'productId', prod.id);
      onChange(item._key, 'productName', prod.name);
      onChange(item._key, 'unitPrice', prod.salePrice);
      onChange(item._key, 'unit', prod.unit || 'UN');
      onChange(item._key, 'ncm', prod.ncm || '');
    }
  };

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 grid grid-cols-12 gap-2">
        <div className="col-span-5">
          <select
            className={inputCls}
            value={item.productId || ''}
            onChange={e => handleProductSelect(e.target.value)}
          >
            <option value="">Selecione ou digite</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {!item.productId && (
          <div className="col-span-5">
            <input className={inputCls} placeholder="Nome do item" value={item.productName}
              onChange={e => onChange(item._key, 'productName', e.target.value)} />
          </div>
        )}
        <div className="col-span-2">
          <input className={inputCls} type="number" min="1" placeholder="Qtd" value={item.quantity}
            onChange={e => onChange(item._key, 'quantity', parseFloat(e.target.value) || 1)} />
        </div>
        <div className="col-span-2">
          <input className={inputCls} type="number" min="0" step="0.01" placeholder="Preço unit." value={item.unitPrice}
            onChange={e => onChange(item._key, 'unitPrice', parseFloat(e.target.value) || 0)} />
        </div>
        <div className="col-span-2">
          <input className={inputCls} type="number" min="0" placeholder="Desconto" value={item.discount || ''}
            onChange={e => onChange(item._key, 'discount', parseFloat(e.target.value) || 0)} />
        </div>
        <div className="col-span-1 flex items-center justify-end">
          <span className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
            {formatCurrency(item.total)}
          </span>
        </div>
      </div>
      <button onClick={() => onRemove(item._key)}
        className="mt-1 p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Order Form ───────────────────────────────────────────────────────────────

type ItemWithKey = OrderItem & { _key: string };

interface OrderFormData {
  type: OrderType;
  clientId: string;
  clientName: string;
  clientCpfCnpj: string;
  items: ItemWithKey[];
  discount: number;
  paymentMethod: PaymentMethod;
  paymentTerms: string;
  deliveryDate: string;
  conditionalExpiresAt: string;
  notes: string;
  internalNotes: string;
}

function OrderForm({
  initial,
  clients,
  products,
  onSave,
  onCancel,
  isSaving,
}: {
  initial: OrderFormData;
  clients: Client[];
  products: Product[];
  onSave: (data: OrderFormData) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<OrderFormData>(initial);

  const setField = <K extends keyof OrderFormData>(key: K, value: OrderFormData[K]) =>
    setForm(f => ({ ...f, [key]: value }));

  const addItem = () => {
    const key = `item_${Date.now()}`;
    setForm(f => ({
      ...f,
      items: [...f.items, { _key: key, productName: '', quantity: 1, unitPrice: 0, total: 0 }],
    }));
  };

  const updateItem = (key: string, field: keyof OrderItem, value: string | number) => {
    setForm(f => ({
      ...f,
      items: f.items.map(it => {
        if (it._key !== key) return it;
        const updated = { ...it, [field]: value };
        updated.total = (updated.quantity || 1) * (updated.unitPrice || 0) - (updated.discount || 0);
        return updated;
      }),
    }));
  };

  const removeItem = (key: string) =>
    setForm(f => ({ ...f, items: f.items.filter(it => it._key !== key) }));

  const handleClientSelect = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    setForm(f => ({
      ...f,
      clientId,
      clientName: client?.name || '',
      clientCpfCnpj: client?.cpfCnpj || '',
    }));
  };

  const subtotal = form.items.reduce((s, it) => s + it.total, 0);
  const total = subtotal - (form.discount || 0);

  const inputCls = 'w-full bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-400 transition-all';
  const labelCls = 'block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider';

  return (
    <div className="space-y-6">
      {/* Type selector */}
      <div>
        <label className={labelCls}>Tipo de venda</label>
        <div className="grid grid-cols-3 gap-2">
          {(['b2b', 'condicional', 'pdv'] as OrderType[]).map(t => (
            <button key={t} type="button" onClick={() => setField('type', t)}
              className={cn(
                'flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all',
                form.type === t
                  ? 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
              )}>
              {t === 'b2b' ? <Building2 className="w-3.5 h-3.5" /> : t === 'condicional' ? <CalendarClock className="w-3.5 h-3.5" /> : <ShoppingBag className="w-3.5 h-3.5" />}
              {ORDER_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        {form.type === 'condicional' && (
          <div className="mt-2 flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Venda condicional: o cliente leva o produto e decide se vai ficar ou não. O pedido fica pendente até o retorno.
            </p>
          </div>
        )}
      </div>

      {/* Client */}
      <div>
        <label className={labelCls}>Cliente</label>
        <select className={inputCls} value={form.clientId} onChange={e => handleClientSelect(e.target.value)}>
          <option value="">Selecionar cliente</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.cpfCnpj ? ` — ${c.cpfCnpj}` : ''}</option>
          ))}
        </select>
      </div>

      {/* Items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={labelCls}>Itens</label>
          <button type="button" onClick={addItem}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-100 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Adicionar item
          </button>
        </div>
        {form.items.length === 0 ? (
          <div className="py-8 flex flex-col items-center text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
            <Package className="w-8 h-8 mb-2" />
            <p className="text-sm">Nenhum item adicionado</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Headers */}
            <div className="grid grid-cols-12 gap-2 px-0 text-xs text-gray-400 font-medium">
              <div className="col-span-5">Produto</div>
              <div className="col-span-2">Qtd</div>
              <div className="col-span-2">Preço unit.</div>
              <div className="col-span-2">Desconto</div>
              <div className="col-span-1 text-right">Total</div>
            </div>
            {form.items.map(item => (
              <ItemRow key={item._key} item={item} products={products}
                onChange={updateItem} onRemove={removeItem} />
            ))}
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="surface rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500 dark:text-gray-400">Subtotal</span>
          <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">Desconto geral</span>
          <input
            type="number" min="0" step="0.01" value={form.discount || ''}
            onChange={e => setField('discount', parseFloat(e.target.value) || 0)}
            className="w-28 bg-transparent border-b border-gray-200 dark:border-gray-700 text-sm text-right text-gray-900 dark:text-white focus:outline-none focus:border-red-400 transition-colors pb-0.5"
            placeholder="0,00"
          />
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
          <span className="font-semibold text-gray-900 dark:text-white">Total</span>
          <span className="text-xl font-bold text-red-600 dark:text-red-400">{formatCurrency(total)}</span>
        </div>
      </div>

      {/* Payment & delivery */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Forma de pagamento</label>
          <select className={inputCls} value={form.paymentMethod}
            onChange={e => setField('paymentMethod', e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Condição de pagamento</label>
          <input className={inputCls} placeholder="Ex: 30/60/90 dias, À vista..." value={form.paymentTerms}
            onChange={e => setField('paymentTerms', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Data de entrega prevista</label>
          <input className={inputCls} type="date" value={form.deliveryDate}
            onChange={e => setField('deliveryDate', e.target.value)} />
        </div>
        {form.type === 'condicional' && (
          <div>
            <label className={labelCls}>Prazo para devolução</label>
            <input className={inputCls} type="date" value={form.conditionalExpiresAt}
              onChange={e => setField('conditionalExpiresAt', e.target.value)} />
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Observações ao cliente</label>
          <textarea className={cn(inputCls, 'resize-none')} rows={2} value={form.notes}
            onChange={e => setField('notes', e.target.value)}
            placeholder="Obs visíveis ao cliente..." />
        </div>
        <div>
          <label className={labelCls}>Observações internas</label>
          <textarea className={cn(inputCls, 'resize-none')} rows={2} value={form.internalNotes}
            onChange={e => setField('internalNotes', e.target.value)}
            placeholder="Obs internas (não aparecem ao cliente)..." />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel}
          className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          Cancelar
        </button>
        <button type="button" onClick={() => onSave(form)}
          disabled={form.items.length === 0 || total <= 0 || isSaving}
          className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
          {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Criar pedido
        </button>
      </div>
    </div>
  );
}

// ─── Order Detail Panel ───────────────────────────────────────────────────────

function OrderDetailPanel({
  order,
  onClose,
  onStatusChange,
}: {
  order: Order;
  onClose: () => void;
  onStatusChange: (id: string, status: OrderStatus) => void;
}) {
  const nextStatuses = NEXT_STATUS[order.status] || [];
  const subtotal = order.items.reduce((s, i) => s + i.total, 0);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="h-full flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-gray-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 dark:text-white">Pedido #{order.id.slice(-6).toUpperCase()}</h3>
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              {ORDER_TYPE_LABELS[order.type]}
            </span>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 p-5 space-y-5">
        {/* Client */}
        {order.clientName && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Cliente</p>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-500/20 flex items-center justify-center text-red-600 dark:text-red-400 font-bold text-sm">
                {order.clientName[0].toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{order.clientName}</p>
                {order.clientCpfCnpj && <p className="text-xs text-gray-500">{order.clientCpfCnpj}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Items */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Itens</p>
          <div className="space-y-1.5">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">{item.productName}</span>
                  <span className="text-gray-500 dark:text-gray-400 ml-1.5">× {item.quantity}</span>
                </div>
                <span className="font-semibold text-gray-700 dark:text-gray-300">{formatCurrency(item.total)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="surface rounded-xl p-4 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Subtotal</span>
            <span className="text-gray-700 dark:text-gray-300">{formatCurrency(subtotal)}</span>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Desconto</span>
              <span className="text-red-500">−{formatCurrency(order.discount)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold pt-1.5 border-t border-gray-100 dark:border-gray-800">
            <span className="text-gray-900 dark:text-white">Total</span>
            <span className="text-red-600 dark:text-red-400 text-lg">{formatCurrency(order.total)}</span>
          </div>
        </div>

        {/* Dates */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Criado em</span>
            <span className="text-gray-700 dark:text-gray-300">{formatDate(order.createdAt)}</span>
          </div>
          {order.deliveryDate && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Entrega prevista</span>
              <span className="text-gray-700 dark:text-gray-300">{formatDate(order.deliveryDate)}</span>
            </div>
          )}
          {order.conditionalExpiresAt && (
            <div className="flex justify-between text-sm">
              <span className="text-amber-600 dark:text-amber-400">Prazo condicional</span>
              <span className="text-amber-700 dark:text-amber-300 font-medium">{formatDate(order.conditionalExpiresAt)}</span>
            </div>
          )}
        </div>

        {/* Notes */}
        {order.notes && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Observações</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{order.notes}</p>
          </div>
        )}

        {/* Status actions */}
        {nextStatuses.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Avançar status</p>
            <div className="flex flex-wrap gap-2">
              {nextStatuses.map(next => (
                <button
                  key={next}
                  onClick={() => onStatusChange(order.id, next)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                >
                  <ArrowRight className="w-3 h-3" />
                  {STATUS_LABELS[next]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Fiscal action */}
        {order.status === 'confirmado' && !order.fiscalDocId && (
          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Emitir NF-e</span>
            </div>
            <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
              Pedido confirmado. Você pode emitir a nota fiscal agora.
            </p>
            <button className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors">
              Emitir NF-e
            </button>
          </div>
        )}

        {/* Status history */}
        {order.statusHistory && order.statusHistory.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Histórico</p>
            <div className="space-y-2">
              {[...order.statusHistory].reverse().map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 mt-1.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-gray-700 dark:text-gray-300">{STATUS_LABELS[h.status]}</span>
                    <span className="text-gray-400 ml-1.5">{formatDate(h.timestamp)}</span>
                    {h.note && <p className="text-gray-500 mt-0.5">{h.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Module ─────────────────────────────────────────────────────────────

export default function VendasModule() {
  const { business, user } = useAuth();

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'all'>('all');
  const [filterType, setFilterType] = useState<OrderType | 'all'>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Lock-scroll do wrapper de tab ativo enquanto o modal de novo pedido está
  // aberto. selectedOrder é painel lateral inline, não modal, então não trava.
  useEffect(() => {
    if (!showForm) return;
    const el = document.querySelector<HTMLElement>(
      '.will-change-transform.pointer-events-auto.overflow-y-auto',
    );
    if (!el) return;
    const prevOverflow = el.style.overflowY;
    el.style.overflowY = 'hidden';
    return () => { el.style.overflowY = prevOverflow; };
  }, [showForm]);

  // ─── Data — onSnapshot (refactor sync multi-user) ───────────────────────────
  // ANTES: 3x useQuery + getDocs com staleTime 2-5min. Vendedor A criava
  // orçamento, vendedor B (em outra sessão) só via mudança de status após
  // 2min — em equipe comercial isso atrapalha (gerente cobra status que já
  // foi atualizado).
  // AGORA: onSnapshot pra orders/clients/products. Real-time em todas as
  // sessões.
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    if (!business?.id) { setIsLoading(false); return; }
    setIsLoading(true);
    const q = query(collection(db, 'orders'), where('businessId', '==', business.id), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setOrders(snap.docs.map(d => ({ ...d.data(), id: d.id } as Order)));
      setIsLoading(false);
    }, (err) => { console.error('[Vendas] orders snapshot error:', err); setIsLoading(false); });
    return () => unsub();
  }, [business?.id]);

  const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'clients'), where('businessId', '==', business.id), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setClients(snap.docs.map(d => ({ ...d.data(), id: d.id } as Client)));
    }, (err) => console.error('[Vendas] clients snapshot error:', err));
    return () => unsub();
  }, [business?.id]);

  const [products, setProducts] = useState<Product[]>([]);
  useEffect(() => {
    if (!business?.id) return;
    const q = query(collection(db, 'products'), where('businessId', '==', business.id), orderBy('name', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setProducts(snap.docs.map(d => ({ ...d.data(), id: d.id } as Product)));
    }, (err) => console.error('[Vendas] products snapshot error:', err));
    return () => unsub();
  }, [business?.id]);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const { mutate: createOrder, isPending: isCreating } = useMutation({
    mutationFn: async (data: OrderFormData) => {
      const now = new Date().toISOString();
      const subtotal = data.items.reduce((s, i) => s + i.total, 0);
      const total = subtotal - (data.discount || 0);
      const items = data.items.map(({ _key, ...rest }) => rest);

      const payload: Omit<Order, 'id'> = {
        businessId: business!.id,
        type: data.type,
        status: data.type === 'condicional' ? 'condicional' : 'pendente',
        clientId: data.clientId || undefined,
        clientName: data.clientName || undefined,
        clientCpfCnpj: data.clientCpfCnpj || undefined,
        items,
        subtotal,
        discount: data.discount || 0,
        total,
        paymentMethod: data.paymentMethod,
        paymentTerms: data.paymentTerms || undefined,
        deliveryDate: data.deliveryDate || undefined,
        conditionalExpiresAt: data.conditionalExpiresAt || undefined,
        notes: data.notes || undefined,
        internalNotes: data.internalNotes || undefined,
        operatorId: user!.uid,
        operatorName: user!.name,
        statusHistory: [{
          status: data.type === 'condicional' ? 'condicional' : 'pendente',
          timestamp: now,
          userId: user!.uid,
          userName: user!.name,
        }],
        createdAt: now,
        updatedAt: now,
      };

      await addDoc(collection(db, 'orders'), payload);
    },
    onSuccess: () => {
      // onSnapshot no listener acima recebe o doc novo automaticamente — sem
      // precisar invalidar cache de useQuery.
      toast.success('Pedido criado com sucesso!');
      setShowForm(false);
    },
    onError: (err) => {
      console.error('[Vendas] Create error:', err);
      toast.error('Erro ao criar pedido');
    },
  });

  const { mutate: changeStatus } = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OrderStatus }) => {
      const now = new Date().toISOString();
      const order = orders.find(o => o.id === id);
      const history = [
        ...(order?.statusHistory || []),
        { status, timestamp: now, userId: user!.uid, userName: user!.name },
      ];
      await updateDoc(doc(db, 'orders', id), { status, statusHistory: history, updatedAt: now });
    },
    onSuccess: (_, { id, status }) => {
      // Snapshot atualiza orders automaticamente; aqui só sincroniza o
      // selectedOrder em viewing pra refletir status na UI imediatamente.
      toast.success(`Status atualizado para: ${STATUS_LABELS[status]}`);
      setSelectedOrder(prev => prev?.id === id ? { ...prev, status, updatedAt: new Date().toISOString() } : prev);
    },
    onError: () => toast.error('Erro ao atualizar status'),
  });

  // ─── Filtered list ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...orders];
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(o =>
        o.clientName?.toLowerCase().includes(term) ||
        o.id.toLowerCase().includes(term) ||
        o.items.some(i => i.productName.toLowerCase().includes(term))
      );
    }
    if (filterStatus !== 'all') list = list.filter(o => o.status === filterStatus);
    if (filterType !== 'all') list = list.filter(o => o.type === filterType);
    return list;
  }, [orders, search, filterStatus, filterType]);

  // ─── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalRevenue = orders.filter(o => o.status === 'entregue').reduce((s, o) => s + o.total, 0);
    const pending = orders.filter(o => ['pendente', 'confirmado'].includes(o.status)).length;
    const conditional = orders.filter(o => o.status === 'condicional').length;
    const avgOrder = orders.length > 0 ? orders.reduce((s, o) => s + o.total, 0) / orders.length : 0;
    return { totalRevenue, pending, conditional, avgOrder, total: orders.length };
  }, [orders]);

  const formInitial: OrderFormData = {
    type: 'b2b', clientId: '', clientName: '', clientCpfCnpj: '',
    items: [], discount: 0, paymentMethod: 'boleto', paymentTerms: '',
    deliveryDate: '', conditionalExpiresAt: '', notes: '', internalNotes: '',
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white font-display flex items-center gap-2.5">
            <ClipboardList className="w-6 h-6 text-red-500" />
            Vendas
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Pedidos B2B, vendas condicionais e faturamento
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Novo pedido
        </button>
      </motion.div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Receita entregue', value: formatCurrency(kpis.totalRevenue), icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', isStr: true },
          { label: 'Pedidos pendentes', value: kpis.pending, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
          { label: 'Condicionais', value: kpis.conditional, icon: CalendarClock, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
          { label: 'Ticket médio', value: formatCurrency(kpis.avgOrder), icon: DollarSign, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-500/10', isStr: true },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="surface rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{kpi.label}</span>
              <div className={cn('p-1.5 rounded-lg', kpi.bg)}><kpi.icon className={cn('w-4 h-4', kpi.color)} /></div>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{kpi.isStr ? kpi.value : kpi.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por cliente, produto..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as OrderStatus | 'all')}
          className="px-3 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none">
          <option value="all">Todos os status</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value as OrderType | 'all')}
          className="px-3 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none">
          <option value="all">Todos os tipos</option>
          {Object.entries(ORDER_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Content */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Order list */}
        <div className={cn('flex-1 min-w-0 overflow-hidden flex flex-col', selectedOrder && 'hidden lg:flex')}>
          {isLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-xl shimmer" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <ClipboardList className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500 dark:text-gray-400 font-medium">Nenhum pedido encontrado</p>
              <p className="text-sm text-gray-400 mt-1">Crie o primeiro pedido com o botão acima</p>
            </div>
          ) : (
            <div className="space-y-2 overflow-y-auto pr-1">
              {filtered.map((order, i) => (
                <motion.div key={order.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.25) }}
                  onClick={() => setSelectedOrder(order)}
                  className={cn(
                    'flex items-center gap-4 p-4 rounded-xl cursor-pointer transition-all border',
                    selectedOrder?.id === order.id
                      ? 'border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5'
                      : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                  )}>
                  {/* Type icon */}
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                    order.type === 'condicional' ? 'bg-amber-100 dark:bg-amber-500/20' : 'bg-blue-100 dark:bg-blue-500/20')}>
                    {order.type === 'condicional'
                      ? <CalendarClock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                      : <ClipboardList className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-gray-400">#{order.id.slice(-6).toUpperCase()}</span>
                      <StatusBadge status={order.status} />
                      {order.type !== 'b2b' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500">
                          {ORDER_TYPE_LABELS[order.type]}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {order.clientName || 'Sem cliente'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {order.items.length} {order.items.length === 1 ? 'item' : 'itens'} · {formatDate(order.createdAt)}
                    </p>
                  </div>

                  {/* Total */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-bold text-gray-900 dark:text-white">{formatCurrency(order.total)}</p>
                    {order.paymentMethod && (
                      <p className="text-xs text-gray-400 mt-0.5">{PAYMENT_METHODS.find(m => m.value === order.paymentMethod)?.label}</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedOrder && (
            <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800">
              <OrderDetailPanel
                order={selectedOrder}
                onClose={() => setSelectedOrder(null)}
                onStatusChange={(id, status) => changeStatus({ id, status })}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Create order modal — portal pra escapar containing block do wrapper
          de tabs (will-change-transform em app/page.tsx). */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showForm && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl">
                <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                      <ClipboardList className="w-4 h-4 text-red-500" />
                    </div>
                    <h2 className="font-semibold text-gray-900 dark:text-white">Novo pedido</h2>
                  </div>
                  <button onClick={() => setShowForm(false)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-6">
                  <OrderForm
                    initial={formInitial}
                    clients={clients}
                    products={products}
                    onSave={createOrder}
                    onCancel={() => setShowForm(false)}
                    isSaving={isCreating}
                  />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
