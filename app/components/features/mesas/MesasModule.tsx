'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Armchair, Plus, X, Clock, Receipt, ChefHat, Package, CheckCircle2, RotateCcw,
  Ban, Users, ArrowRight, Loader2, UtensilsCrossed, ClipboardList,
} from 'lucide-react';
import {
  collection, query, where, orderBy, onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { formatCurrency, formatDateTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import { toast } from 'react-toastify';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole, DeliveryOrder } from '@/lib/types';
import type { TableSession, BusinessTable } from '@/lib/contracts/domain/tableSession';
import { TABLE_SESSION_STATUS_LABELS } from '@/lib/contracts/domain/tableSession';

type Session = TableSession & { id: string };

const ORDERS_WINDOW_DAYS = 3;
function ordersWindowStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ORDERS_WINDOW_DAYS);
  return d.toISOString();
}

const STATUS_STYLE: Record<string, { ring: string; chip: string; dot: string }> = {
  aberta: {
    ring: 'border-emerald-300 dark:border-emerald-500/40',
    chip: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  fechada: {
    ring: 'border-amber-300 dark:border-amber-500/40',
    chip: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  paga: {
    ring: 'border-gray-200 dark:border-gray-700',
    chip: 'bg-gray-100 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300',
    dot: 'bg-gray-400',
  },
  cancelada: {
    ring: 'border-gray-200 dark:border-gray-700',
    chip: 'bg-gray-100 dark:bg-gray-700/40 text-gray-500',
    dot: 'bg-gray-400',
  },
};

const ORDER_STATUS_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  recebido: { label: 'Recebido', icon: ClipboardList, color: 'text-blue-600 dark:text-blue-400' },
  preparando: { label: 'Preparando', icon: ChefHat, color: 'text-amber-600 dark:text-amber-400' },
  pronto: { label: 'Pronto', icon: Package, color: 'text-violet-600 dark:text-violet-400' },
  entregue: { label: 'Entregue', icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400' },
  cancelado: { label: 'Cancelado', icon: Ban, color: 'text-gray-500' },
};

function elapsed(fromIso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(fromIso).getTime()) / 60000));
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  return `${h}h${String(mins % 60).padStart(2, '0')}`;
}

export default function MesasModule() {
  const { business, user, firebaseUser, userSectorIds } = useAuth();
  const { setActivePage } = useAppContext();

  const isAdmin = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin' as UserRole];
  const canOperate = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['operator' as UserRole];

  const configuredTables = useMemo<BusinessTable[]>(
    () => (business?.settings?.aiAgent?.pedidos?.tables ?? []) as BusinessTable[],
    [business?.settings?.aiAgent?.pedidos?.tables],
  );

  const [sessions, setSessions] = useState<Session[]>([]);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // ── Sessions (aberta + fechada) ──────────────────────────────────────────
  useEffect(() => {
    if (!business?.id) return;
    setLoading(true);
    const q = query(
      collection(db, 'tableSessions'),
      where('businessId', '==', business.id),
      where('status', 'in', ['aberta', 'fechada']),
      orderBy('openedAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setSessions(snap.docs.map(d => ({ ...(d.data() as TableSession), id: d.id })));
      setLoading(false);
    }, (err) => {
      console.error('[Mesas] sessions snapshot error:', err);
      setLoading(false);
    });
    return unsub;
  }, [business?.id]);

  // ── Linked orders (recent window, grouped client-side) ───────────────────
  useEffect(() => {
    if (!business?.id) return;
    const q = query(
      collection(db, 'deliveryOrders'),
      where('businessId', '==', business.id),
      where('createdAt', '>=', ordersWindowStartIso()),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setOrders(snap.docs.map(d => ({ ...(d.data() as DeliveryOrder), id: d.id })));
    }, (err) => console.error('[Mesas] orders snapshot error:', err));
    return unsub;
  }, [business?.id]);

  const ordersBySession = useMemo(() => {
    const map = new Map<string, DeliveryOrder[]>();
    for (const o of orders) {
      if (!o.tableSessionId) continue;
      if (!map.has(o.tableSessionId)) map.set(o.tableSessionId, []);
      map.get(o.tableSessionId)!.push(o);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    return map;
  }, [orders]);

  // Sector filter — admin vê tudo; demais só sessões do próprio setor / sem setor.
  const visibleSessions = useMemo(() => {
    if (isAdmin) return sessions;
    return sessions.filter(s => !s.sectorId || userSectorIds.includes(s.sectorId));
  }, [sessions, isAdmin, userSectorIds]);

  const sessionTotal = useCallback((s: Session): number => {
    const list = ordersBySession.get(s.id) ?? [];
    return list
      .filter(o => o.status !== 'cancelado')
      .reduce((acc, o) => acc + (o.total ?? 0), 0);
  }, [ordersBySession]);

  const selected = useMemo(
    () => visibleSessions.find(s => s.id === selectedId) ?? null,
    [visibleSessions, selectedId],
  );

  // ── API helpers ──────────────────────────────────────────────────────────
  const callApi = useCallback(async (path: string, body: Record<string, unknown>): Promise<unknown> => {
    if (!firebaseUser || !business?.id) throw new Error('Sessão expirada.');
    const token = await firebaseUser.getIdToken();
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ businessId: business.id, ...body }),
    });
    const payload = await res.json().catch(() => null) as { ok?: boolean; error?: string; data?: unknown } | null;
    if (!res.ok || !payload?.ok) throw new Error(payload?.error || 'Erro na operação.');
    return payload.data;
  }, [firebaseUser, business?.id]);

  const runAction = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusyAction(key);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro na operação.');
    } finally {
      setBusyAction(null);
    }
  }, []);

  const handleOpenTable = useCallback((tableLabel: string, tableId?: string) => {
    if (!tableLabel.trim()) return;
    void runAction('open', async () => {
      const data = await callApi('/api/table-sessions', {
        tableLabel: tableLabel.trim(),
        ...(tableId ? { tableId } : {}),
        ...(userSectorIds.length === 1 ? { sectorId: userSectorIds[0] } : {}),
      }) as { session: Session; created: boolean };
      setSelectedId(data.session.id);
      setOpenDialogOpen(false);
      toast.success(data.created ? `${data.session.tableLabel} aberta` : `${data.session.tableLabel} já estava aberta`);
    });
  }, [callApi, runAction, userSectorIds]);

  const handleClose = useCallback((s: Session) => {
    void runAction('close', async () => {
      await callApi(`/api/table-sessions/${s.id}/close`, {});
      toast.success('Conta fechada — envie pro PDV para cobrar.');
    });
  }, [callApi, runAction]);

  const handleReopen = useCallback((s: Session) => {
    void runAction('reopen', async () => {
      await callApi(`/api/table-sessions/${s.id}/reopen`, {});
      toast.info('Mesa reaberta.');
    });
  }, [callApi, runAction]);

  const handleCancel = useCallback((s: Session) => {
    if (typeof window !== 'undefined' && !window.confirm(`Cancelar ${s.tableLabel}? Pedidos ainda abertos serão cancelados.`)) return;
    const reason = typeof window !== 'undefined' ? window.prompt('Motivo (opcional):', '') ?? undefined : undefined;
    void runAction('cancel', async () => {
      await callApi(`/api/table-sessions/${s.id}/cancel`, reason ? { reason } : {});
      setSelectedId(null);
      toast.info('Mesa cancelada.');
    });
  }, [callApi, runAction]);

  const handleAddOrder = useCallback((s: Session) => {
    sessionStorage.setItem('pendingTableOrder', JSON.stringify({ tableSessionId: s.id, tableLabel: s.tableLabel }));
    setActivePage('Pedidos');
  }, [setActivePage]);

  const handleSendToPdv = useCallback((s: Session) => {
    const list = (ordersBySession.get(s.id) ?? []).filter(o => o.status !== 'cancelado');
    const items = list.flatMap(o => o.items.map(it => ({
      productId: it.productId,
      productName: it.productName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      total: it.total,
      ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
      ...(it.selectedModifiers ? { selectedModifiers: it.selectedModifiers, basePrice: it.basePrice } : {}),
    })));
    if (items.length === 0) {
      toast.warn('Nenhum item para cobrar nesta mesa.');
      return;
    }
    sessionStorage.setItem('pendingTableCheckout', JSON.stringify({
      tableSessionId: s.id,
      tableLabel: s.tableLabel,
      orderCount: list.length,
      items,
    }));
    setActivePage('PDV');
  }, [ordersBySession, setActivePage]);

  // ── Render ───────────────────────────────────────────────────────────────
  const openCount = visibleSessions.filter(s => s.status === 'aberta').length;
  const closedCount = visibleSessions.filter(s => s.status === 'fechada').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 p-4 md:p-6 pb-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white font-display flex items-center gap-2.5">
              <Armchair className="w-6 h-6 text-red-500" />
              Mesas
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {openCount} aberta{openCount === 1 ? '' : 's'} · {closedCount} aguardando pagamento
            </p>
          </div>
          {canOperate && (
            <button
              onClick={() => setOpenDialogOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors"
            >
              <Plus className="w-4 h-4" /> Abrir mesa
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">
        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => <div key={i} className="h-36 rounded-2xl shimmer" />)}
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-4">
                <Armchair className="w-7 h-7 text-red-500" />
              </div>
              <p className="text-gray-700 dark:text-gray-200 font-semibold">Nenhuma mesa aberta</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
                Abra uma mesa para começar a comanda, ou o hóspede abre sozinho ao escanear o QR code da mesa.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {visibleSessions.map(s => {
                const style = STATUS_STYLE[s.status] ?? STATUS_STYLE.paga;
                const list = ordersBySession.get(s.id) ?? [];
                const total = sessionTotal(s);
                const active = s.id === selectedId;
                return (
                  <motion.button
                    key={s.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => setSelectedId(active ? null : s.id)}
                    className={cn(
                      'text-left rounded-2xl border-2 bg-white dark:bg-gray-900 p-4 transition-all hover:shadow-lg',
                      style.ring,
                      active && 'ring-2 ring-red-500 ring-offset-2 dark:ring-offset-gray-950',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xl font-bold text-gray-900 dark:text-white font-display leading-tight">
                        {s.tableLabel}
                      </span>
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold', style.chip)}>
                        <span className={cn('w-1.5 h-1.5 rounded-full', style.dot)} />
                        {TABLE_SESSION_STATUS_LABELS[s.status]}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
                      <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{elapsed(s.openedAt)}</span>
                      <span className="inline-flex items-center gap-1"><Receipt className="w-3 h-3" />{list.length} ped.</span>
                      {s.guestCount ? <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{s.guestCount}</span> : null}
                    </div>
                    <p className="mt-2 text-lg font-bold text-red-600 dark:text-red-400">{formatCurrency(total)}</p>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>

        {/* Comanda panel */}
        <AnimatePresence>
          {selected && (
            <motion.aside
              key={selected.id}
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              className="w-full max-w-md flex-shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col"
            >
              <ComandaPanel
                session={selected}
                orders={ordersBySession.get(selected.id) ?? []}
                total={sessionTotal(selected)}
                busyAction={busyAction}
                canOperate={canOperate}
                onClose={() => setSelectedId(null)}
                onAddOrder={() => handleAddOrder(selected)}
                onCloseBill={() => handleClose(selected)}
                onReopen={() => handleReopen(selected)}
                onCancel={() => handleCancel(selected)}
                onSendToPdv={() => handleSendToPdv(selected)}
              />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {openDialogOpen && (
          <OpenTableDialog
            tables={configuredTables}
            openLabels={new Set(sessions.filter(s => s.status !== 'paga' && s.status !== 'cancelada').map(s => s.tableLabel))}
            busy={busyAction === 'open'}
            onClose={() => setOpenDialogOpen(false)}
            onOpen={handleOpenTable}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Comanda panel ───────────────────────────────────────────────────────────
function ComandaPanel({
  session, orders, total, busyAction, canOperate,
  onClose, onAddOrder, onCloseBill, onReopen, onCancel, onSendToPdv,
}: {
  session: Session;
  orders: DeliveryOrder[];
  total: number;
  busyAction: string | null;
  canOperate: boolean;
  onClose: () => void;
  onAddOrder: () => void;
  onCloseBill: () => void;
  onReopen: () => void;
  onCancel: () => void;
  onSendToPdv: () => void;
}) {
  const live = orders.filter(o => o.status !== 'cancelado');
  return (
    <>
      <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white font-display">{session.tableLabel}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Aberta {formatDateTime(session.openedAt)} · {session.openedByName}
            {session.guestName ? ` · ${session.guestName}` : ''}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {live.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
            Nenhum pedido ainda. Use "+ Pedido" ou o hóspede pede pelo QR.
          </p>
        )}
        {orders.map(order => {
          const meta = ORDER_STATUS_META[order.status] ?? ORDER_STATUS_META.recebido;
          const Icon = meta.icon;
          return (
            <div
              key={order.id}
              className={cn(
                'rounded-xl border border-gray-200 dark:border-gray-800 p-3',
                order.status === 'cancelado' && 'opacity-50',
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                  Pedido #{order.number}
                </span>
                <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', meta.color)}>
                  <Icon className="w-3 h-3" /> {meta.label}
                </span>
              </div>
              <div className="space-y-1">
                {order.items.map((it, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 text-[13px]">
                    <span className="text-gray-700 dark:text-gray-300">
                      {it.quantity}× {it.productName}
                      {it.selectedModifiers?.length ? (
                        <span className="block text-[11px] text-gray-400">
                          {it.selectedModifiers.map(m => m.selectedOptions.map(o => o.optionName).join(', ')).join(' · ')}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400 tabular-nums flex-shrink-0">
                      {formatCurrency(it.total)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-xs">
                <span className="text-gray-400">{formatDateTime(order.createdAt)}</span>
                <span className="font-semibold text-gray-700 dark:text-gray-300">{formatCurrency(order.total)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {session.status === 'fechada' ? 'Conta fechada' : 'Total parcial'}
          </span>
          <span className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(session.status === 'fechada' && session.subtotalSnapshot != null ? session.subtotalSnapshot : total)}
          </span>
        </div>

        {canOperate && session.status === 'aberta' && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onAddOrder}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Plus className="w-4 h-4" /> Pedido
            </button>
            <button
              onClick={onCloseBill}
              disabled={busyAction === 'close' || live.length === 0}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
            >
              {busyAction === 'close' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
              Fechar conta
            </button>
          </div>
        )}

        {canOperate && session.status === 'fechada' && (
          <>
            <button
              onClick={onSendToPdv}
              disabled={busyAction != null}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-bold text-sm transition-colors"
            >
              <UtensilsCrossed className="w-4 h-4" /> Enviar pro PDV e cobrar
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={onReopen}
              disabled={busyAction === 'reopen'}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {busyAction === 'reopen' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Reabrir mesa
            </button>
          </>
        )}

        {canOperate && (session.status === 'aberta' || session.status === 'fechada') && (
          <button
            onClick={onCancel}
            disabled={busyAction === 'cancel'}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
          >
            <Ban className="w-3.5 h-3.5" /> Cancelar mesa
          </button>
        )}
      </div>
    </>
  );
}

// ─── Open table dialog ───────────────────────────────────────────────────────
function OpenTableDialog({
  tables, openLabels, busy, onClose, onOpen,
}: {
  tables: BusinessTable[];
  openLabels: Set<string>;
  busy: boolean;
  onClose: () => void;
  onOpen: (label: string, id?: string) => void;
}) {
  const [freeLabel, setFreeLabel] = useState('');
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-5 pb-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Abrir mesa</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tables.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {tables.map(t => {
                const taken = openLabels.has(t.label);
                return (
                  <button
                    key={t.id}
                    disabled={busy}
                    onClick={() => onOpen(t.label, t.id)}
                    className={cn(
                      'aspect-square rounded-xl border-2 flex items-center justify-center text-sm font-bold transition-all',
                      taken
                        ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-500/10',
                    )}
                    title={taken ? 'Já aberta — abre a comanda existente' : undefined}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                {tables.length > 0 ? 'Ou digite outra mesa' : 'Nome / número da mesa'}
              </label>
              <input
                value={freeLabel}
                onChange={e => setFreeLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && freeLabel.trim()) onOpen(freeLabel.trim()); }}
                placeholder="Ex: Mesa 15, Varanda 2"
                className="mt-1 w-full px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30"
              />
            </div>
            <button
              onClick={() => freeLabel.trim() && onOpen(freeLabel.trim())}
              disabled={busy || !freeLabel.trim()}
              className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Abrir'}
            </button>
          </div>

          {tables.length === 0 && (
            <p className="text-[11px] text-gray-400">
              Dica: configure as mesas do salão em Configurações → Empresa para gerar QR codes por mesa.
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
