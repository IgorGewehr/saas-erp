'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingBag, Upload, Search, X, FileText, CheckCircle2, AlertCircle,
  Building2, Calendar, Package, DollarSign, TrendingDown, Clock,
  ChevronDown, ChevronRight, RefreshCw, Eye, Download, Filter,
  BarChart3, ArrowUpRight, Truck,
} from 'lucide-react';
import {
  collection, query, where, getDocs, updateDoc, doc, onSnapshot, writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useMutation } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type { PurchaseNote, PurchaseNoteStatus, Product } from '@/lib/types';
import { toast } from 'react-toastify';
import { applyStockOperation } from '@/lib/services/stock-server-client';
import type { PreparedPurchaseNote } from '@/lib/services/purchase-import-admin';
import { confirmPurchaseNote } from '@/lib/services/purchase-import-client';
import SuppliersPanel from './SuppliersPanel';
import PurchaseImportDialog from './PurchaseImportDialog';

type PurchasesArea = 'notes' | 'suppliers';

function PurchasesTabs(props: { active: PurchasesArea; onChange: (area: PurchasesArea) => void }) {
  return (
    <div className="mb-5 inline-flex w-fit rounded-xl bg-gray-100 p-1 dark:bg-gray-800/80">
      <button onClick={() => props.onChange('notes')} className={cn(
        'rounded-lg px-4 py-2 text-sm font-medium transition',
        props.active === 'notes' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white',
      )}>Notas de compra</button>
      <button onClick={() => props.onChange('suppliers')} className={cn(
        'rounded-lg px-4 py-2 text-sm font-medium transition',
        props.active === 'suppliers' ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white',
      )}>Fornecedores</button>
    </div>
  );
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<PurchaseNoteStatus, { label: string; color: string; icon: typeof Clock }> = {
  rascunho:   { label: 'Rascunho', color: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300', icon: FileText },
  pendente:   { label: 'Pendente', color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300', icon: Clock },
  processando:{ label: 'Processando', color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300', icon: RefreshCw },
  importada:  { label: 'Importada', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300', icon: CheckCircle2 },
  parcial:    { label: 'Parcial', color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300', icon: AlertCircle },
  falha:      { label: 'Falha', color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300', icon: AlertCircle },
  cancelada:  { label: 'Cancelada', color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300', icon: X },
  revertida:  { label: 'Revertida', color: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300', icon: RefreshCw },
};

// ─── Note Detail Panel ────────────────────────────────────────────────────────

function NoteDetailPanel({
  note,
  onClose,
  onPushToStock,
  onReview,
  onConfirm,
  isPushingStock,
  isConfirming,
}: {
  note: PurchaseNote;
  onClose: () => void;
  onPushToStock?: (note: PurchaseNote) => void;
  onReview?: (note: PurchaseNote) => void;
  onConfirm?: (note: PurchaseNote) => void;
  isPushingStock?: boolean;
  isConfirming?: boolean;
}) {
  const statusCfg = STATUS_CONFIG[note.status];
  const StatusIcon = statusCfg.icon;
  const usesSafeImport = note.schemaVersion === 2;
  const canPushToStock = !usesSafeImport && !note.stockImportedAt && note.status !== 'cancelada';
  const canEditReview = usesSafeImport && ['rascunho', 'pendente'].includes(note.status) && !note.stockImportedAt;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="h-full flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 overflow-y-auto"
    >
      <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-gray-800">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">NF-e {note.numero}/{note.serie}</h3>
          <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium mt-1.5', statusCfg.color)}>
            <StatusIcon className="w-3 h-3" />
            {statusCfg.label}
          </span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Supplier */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Fornecedor</p>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{note.supplierName}</p>
              <p className="text-xs text-gray-500">{note.supplierCnpj}</p>
            </div>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-1">Emissão</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatDate(note.issueDate)}</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-1">Importação</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">{formatDate(note.createdAt)}</p>
          </div>
        </div>

        {/* Items */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Itens ({note.items.length})</p>
          <div className="space-y-1.5">
            {note.items.map((item, i) => (
              <div key={item.lineId ?? i} className="flex items-start justify-between gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 dark:text-white truncate">{item.productName}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {item.quantity} {item.unit} · NCM: {item.ncm || '—'} · CFOP: {item.cfop || '—'}
                  </p>
                  {item.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{item.error}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{formatCurrency(item.total)}</span>
                  {item.importStatus && item.importStatus !== 'pending' && (
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      item.importStatus === 'imported' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                        : item.importStatus === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300')}>
                      {item.importStatus === 'imported' ? 'Importado' : item.importStatus === 'error' ? 'Erro' : 'Ignorado'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="surface rounded-xl p-4 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Produtos</span>
            <span className="text-gray-700 dark:text-gray-300">{formatCurrency(note.totalProducts)}</span>
          </div>
          {note.totalTaxes > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Impostos</span>
              <span className="text-gray-700 dark:text-gray-300">{formatCurrency(note.totalTaxes)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-base pt-1.5 border-t border-gray-100 dark:border-gray-800">
            <span className="text-gray-900 dark:text-white">Total</span>
            <span className="text-red-600 dark:text-red-400">{formatCurrency(note.totalValue)}</span>
          </div>
        </div>

        {/* Access key */}
        {note.accessKey && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Chave de acesso</p>
            <p className="text-xs font-mono text-gray-500 dark:text-gray-400 break-all leading-relaxed">
              {note.accessKey.match(/.{1,4}/g)?.join(' ')}
            </p>
          </div>
        )}

        {/* Notes */}
        {note.notes && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Observações</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">{note.notes}</p>
          </div>
        )}

        {/* Unmatched items (visible after a partial stock import) */}
        {note.unmatchedItems && note.unmatchedItems.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1.5">
              Itens sem match ({note.unmatchedItems.length})
            </p>
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
              {note.unmatchedItems.map((u, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="truncate">{u.productName}</span>
                  <span className="font-mono text-xs text-gray-400 ml-2">{u.cProd || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Push-to-stock action */}
        {canEditReview && onReview && (
          <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/20 dark:bg-blue-500/10">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {note.reviewedAt ? 'Itens revisados. Confirme para criar produtos, atualizar custo e lançar o estoque.' : 'Revise o destino de todos os itens antes de confirmar a entrada.'}
            </p>
            <div className={cn('grid gap-2', note.reviewedAt && 'sm:grid-cols-2')}>
              <button type="button" onClick={() => onReview(note)} className="w-full rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-500/10">
                {note.reviewedAt ? 'Editar revisão' : 'Revisar itens'}
              </button>
              {note.reviewedAt && onConfirm && <button type="button" onClick={() => onConfirm(note)} disabled={isConfirming} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {isConfirming ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <CheckCircle2 className="h-4 w-4" />}
                {isConfirming ? 'Confirmando...' : 'Confirmar entrada'}
              </button>}
            </div>
          </div>
        )}
        {usesSafeImport && note.status === 'processando' && (
          <div className="flex items-center gap-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
            <RefreshCw className="h-4 w-4 animate-spin" /> A entrada está sendo processada com segurança.
          </div>
        )}
        {canPushToStock && onPushToStock && (
          <button
            type="button"
            onClick={() => onPushToStock(note)}
            disabled={isPushingStock}
            className="w-full px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Package className="w-4 h-4" />
            {isPushingStock ? 'Lançando…' : 'Lançar no estoque'}
          </button>
        )}
        {note.stockImportedAt && (
          <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Lançado em {formatDate(note.stockImportedAt)}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Module ─────────────────────────────────────────────────────────────

export default function ComprasModule() {
  const { business, user } = useAuth();
  const [activeArea, setActiveArea] = useState<PurchasesArea>('notes');

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<PurchaseNoteStatus | 'all'>('all');
  const [selectedNote, setSelectedNote] = useState<PurchaseNote | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [reviewingNote, setReviewingNote] = useState<PreparedPurchaseNote | null>(null);

  // ─── Data — onSnapshot (sync multi-user) ───────────────────────────────────
  // ANTES: useQuery + getDocs com staleTime 2min. Comprador A importava NF-e
  // de compra e dava entrada em estoque, comprador B (em outra sessão) só
  // via a nota nova após 2min. Em equipe de compras isso geraria duplicidade
  // de lançamento (B também tenta dar entrada da mesma nota).
  // AGORA: onSnapshot. Notas novas aparecem em tempo real pra toda a equipe.
  const [notes, setNotes] = useState<PurchaseNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    if (!business?.id) { setIsLoading(false); return; }
    setIsLoading(true);
    // Single-field — sort por createdAt desc client-side (evita composite
    // index purchaseNotes/businessId+createdAt).
    const q = query(
      collection(db, 'purchaseNotes'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as PurchaseNote))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setNotes(list);
        setIsLoading(false);
      },
      (err) => { console.error('[Compras] purchaseNotes snapshot error:', err); setIsLoading(false); },
    );
    return () => unsub();
  }, [business?.id]);

  // Sync selectedNote — outro comprador atualiza status (importada → lançada),
  // ou nota é deletada externamente. Compara por updatedAt; se sem updatedAt
  // (campo opcional na schema), não dispara setState desnecessário.
  useEffect(() => {
    if (!selectedNote) return;
    const fresh = notes.find(n => n.id === selectedNote.id);
    if (!fresh) { setSelectedNote(null); return; }
    if ((fresh as { updatedAt?: string }).updatedAt !== (selectedNote as { updatedAt?: string }).updatedAt) {
      setSelectedNote(fresh);
    }
  }, [notes, selectedNote]);

  // ─── Push-to-stock mutation ──────────────────────────────────────────────────
  // Matches each PurchaseNoteItem to a local product by SKU (cProd) first, then
  // by exact name (case-insensitive). Matched items generate `entrada` stockMovements
  // and increment product.currentStock atomically. Unmatched items are recorded on
  // the note so the user can map them manually later.
  const { mutate: pushToStock, isPending: isPushingStock } = useMutation({
    mutationFn: async (note: PurchaseNote) => {
      if (!business?.id || !user) throw new Error('context');
      if (note.stockImportedAt) throw new Error('already_imported');

      // Load all products for this business
      const productsSnap = await getDocs(
        query(collection(db, 'products'), where('businessId', '==', business.id)),
      );
      const products = productsSnap.docs.map(d => ({ ...(d.data() as Product), id: d.id }));

      const bySku = new Map<string, Product>();
      const byName = new Map<string, Product>();
      for (const p of products) {
        if (p.sku) bySku.set(p.sku.trim().toLowerCase(), p);
        byName.set(p.name.trim().toLowerCase(), p);
      }

      const matched: Array<{ productId: string; quantity: number }> = [];
      const productIndex = new Map<string, Product>();
      const unmatched: Array<{ productName: string; quantity: number; cProd?: string }> = [];
      // Agrega qtd/valor da nota por produto para o custo médio móvel (base do CMV).
      // Só considera itens com unitPrice > 0 — bonificação/erro de preço não deve
      // zerar o costPrice do produto.
      const costAgg = new Map<string, { qtyNota: number; valueNota: number }>();

      for (const item of note.items) {
        const skuKey = item.cProd?.trim().toLowerCase();
        const nameKey = item.productName.trim().toLowerCase();
        const found = (skuKey && bySku.get(skuKey)) || byName.get(nameKey);
        if (found && item.quantity > 0) {
          matched.push({ productId: found.id, quantity: item.quantity });
          productIndex.set(found.id, found);
          if (item.unitPrice > 0) {
            const agg = costAgg.get(found.id) ?? { qtyNota: 0, valueNota: 0 };
            agg.qtyNota += item.quantity;
            agg.valueNota += item.quantity * item.unitPrice;
            costAgg.set(found.id, agg);
          }
        } else {
          unmatched.push({ productName: item.productName, quantity: item.quantity, cProd: item.cProd });
        }
      }

      if (matched.length === 0) {
        throw new Error('no_matches');
      }

      const stockResult = await applyStockOperation({
        businessId: business.id,
        type: 'entrada',
        lines: matched,
        operatorName: user.name,
        reason: `NF-e ${note.numero}/${note.serie} — ${note.supplierName}`,
        sourceType: 'purchase',
        sourceId: note.id,
        sourceDocument: { collection: 'purchaseNotes', id: note.id, existence: 'required' },
        idempotencyKey: `purchase:${note.id}:stock-import`,
        expandBom: false,
        negativeStockPolicy: 'prevent',
      });

      // ── Custo médio móvel (CMV/margem) ──────────────────────────────────────
      // Atualiza product.costPrice a partir do unitPrice da NF-e. productIndex
      // guarda o snapshot PRÉ-entrada (currentStock/costPrice antes desta nota),
      // então o custo médio pondera saldo antigo × custo antigo com a compra nova.
      // Sem saldo/custo prévio válido (denom ≤ 0), cai no "último custo" = unitPrice.
      if (costAgg.size > 0) {
        const costBatch = writeBatch(db);
        const nowCost = new Date().toISOString();
        let costUpdates = 0;
        for (const [productId, agg] of costAgg) {
          const product = productIndex.get(productId);
          if (!product || agg.qtyNota <= 0) continue;
          const prevStock = product.currentStock || 0;
          const prevCost = product.costPrice || 0;
          const denom = prevStock + agg.qtyNota;
          const avgUnitNota = agg.valueNota / agg.qtyNota;
          const newCost = denom > 0
            ? (prevStock * prevCost + agg.valueNota) / denom
            : avgUnitNota;
          const rounded = Math.round(newCost * 100) / 100;
          if (rounded > 0 && rounded !== prevCost) {
            costBatch.update(doc(db, 'products', productId), {
              costPrice: rounded,
              updatedAt: nowCost,
            });
            costUpdates++;
          }
        }
        if (costUpdates > 0) await costBatch.commit();
      }

      await updateDoc(doc(db, 'purchaseNotes', note.id), {
        status: 'importada' as PurchaseNoteStatus,
        stockImportedAt: new Date().toISOString(),
        stockMovementIds: stockResult.adjustments.map((item) => item.movementId),
        unmatchedItems: unmatched.length ? unmatched : undefined,
        updatedAt: new Date().toISOString(),
      });

      return { matchedCount: matched.length, unmatchedCount: unmatched.length };
    },
    onSuccess: ({ matchedCount, unmatchedCount }) => {
      // notes vem via onSnapshot — não precisa invalidar manualmente.
      // ['products', ...] não tem mais consumers via useQuery (Inventory/PDV
      // viraram onSnapshot), então invalidação seria no-op.
      if (unmatchedCount > 0) {
        toast.success(`${matchedCount} itens lançados. ${unmatchedCount} sem match — cadastre os produtos e reimporte.`);
      } else {
        toast.success(`${matchedCount} itens lançados no estoque.`);
      }
    },
    onError: (err: Error) => {
      if (err.message === 'already_imported') {
        toast.error('Esta nota já foi lançada no estoque');
      } else if (err.message === 'no_matches') {
        toast.error('Nenhum item bateu com produtos cadastrados. Cadastre ou vincule os SKUs antes.');
      } else {
        toast.error('Erro ao lançar no estoque');
        console.error('[Compras] Push to stock error:', err);
      }
    },
  });

  const { mutate: confirmReviewedNote, isPending: isConfirming } = useMutation({
    mutationFn: async (note: PurchaseNote) => {
      if (!business?.id) throw new Error('Empresa não encontrada.');
      return confirmPurchaseNote({ businessId: business.id, noteId: note.id });
    },
    onSuccess: (result) => {
      setSelectedNote(result.note as unknown as PurchaseNote);
      if (result.errorCount > 0) {
        toast.warning(`${result.importedCount} item(ns) importado(s) e ${result.errorCount} com erro.`);
      } else if (result.replayed) {
        toast.info('Esta entrada já havia sido confirmada; nenhum saldo foi duplicado.');
      } else {
        toast.success(`${result.importedCount} item(ns) lançado(s) no estoque${result.skippedCount ? `; ${result.skippedCount} ignorado(s)` : ''}.`);
      }
    },
    onError: (cause: Error) => toast.error(cause.message || 'Não foi possível confirmar a entrada.'),
  });

  // ─── Filtered list ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...notes];
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(n =>
        n.supplierName.toLowerCase().includes(term) ||
        n.supplierCnpj.includes(term) ||
        n.numero.includes(term) ||
        n.accessKey?.includes(term)
      );
    }
    if (filterStatus !== 'all') list = list.filter(n => n.status === filterStatus);
    return list;
  }, [notes, search, filterStatus]);

  // ─── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalValue = notes.reduce((s, n) => s + n.totalValue, 0);
    const imported = notes.filter(n => n.status === 'importada' || n.status === 'parcial').length;
    const pending = notes.filter(n => ['rascunho', 'pendente', 'processando'].includes(n.status)).length;
    const totalItems = notes.reduce((s, n) => s + n.items.length, 0);
    return { total: notes.length, totalValue, imported, pending, totalItems };
  }, [notes]);

  if (activeArea === 'suppliers') {
    return (
      <div className="flex h-full flex-col">
        <PurchasesTabs active={activeArea} onChange={setActiveArea} />
        <SuppliersPanel />
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <PurchasesTabs active={activeArea} onChange={setActiveArea} />
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"
      >
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white font-display flex items-center gap-2.5">
            <ShoppingBag className="w-6 h-6 text-red-500" />
            Compras
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Importação de notas fiscais de entrada
          </p>
        </div>
        <button
          onClick={() => {
            setReviewingNote(null);
            setShowImportModal(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          <Upload className="w-4 h-4" />
          Importar NF-e
        </button>
      </motion.div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total importado', value: formatCurrency(kpis.totalValue), icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10' },
          { label: 'Notas', value: kpis.total, icon: FileText, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
          { label: 'Importadas', value: kpis.imported, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
          { label: 'Pendentes', value: kpis.pending, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="surface rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{kpi.label}</span>
              <div className={cn('p-1.5 rounded-lg', kpi.bg)}><kpi.icon className={cn('w-4 h-4', kpi.color)} /></div>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{kpi.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por fornecedor, CNPJ, número..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as PurchaseNoteStatus | 'all')}
          className="px-3 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none">
          <option value="all">Todos os status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Content */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Notes list */}
        <div className={cn('flex-1 min-w-0 overflow-hidden flex flex-col', selectedNote && 'hidden lg:flex')}>
          {isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl shimmer" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                <ShoppingBag className="w-7 h-7 text-gray-400" />
              </div>
              <p className="text-gray-600 dark:text-gray-400 font-medium">Nenhuma nota de compra</p>
              <p className="text-sm text-gray-400 mt-1">Importe uma NF-e XML para começar</p>
            </div>
          ) : (
            <div className="space-y-2 overflow-y-auto pr-1">
              {filtered.map((note, i) => {
                const statusCfg = STATUS_CONFIG[note.status];
                const StatusIcon = statusCfg.icon;
                return (
                  <motion.div key={note.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.25) }}
                    onClick={() => setSelectedNote(note)}
                    className={cn(
                      'flex items-center gap-4 p-4 rounded-xl cursor-pointer transition-all border',
                      selectedNote?.id === note.id
                        ? 'border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5'
                        : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                    )}>
                    {/* Icon */}
                    <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-blue-500" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono text-gray-400">NF-e {note.numero}/{note.serie}</span>
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium', statusCfg.color)}>
                          <StatusIcon className="w-2.5 h-2.5" />
                          {statusCfg.label}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{note.supplierName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {note.items.length} {note.items.length === 1 ? 'item' : 'itens'} · {formatDate(note.issueDate)}
                      </p>
                    </div>

                    {/* Value */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-bold text-gray-900 dark:text-white">{formatCurrency(note.totalValue)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{note.supplierCnpj}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedNote && (
            <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800">
              <NoteDetailPanel
                note={selectedNote}
                onClose={() => setSelectedNote(null)}
                onPushToStock={pushToStock}
                onReview={(note) => {
                  setReviewingNote(note as unknown as PreparedPurchaseNote);
                  setShowImportModal(true);
                }}
                onConfirm={confirmReviewedNote}
                isPushingStock={isPushingStock}
                isConfirming={isConfirming}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Import modal */}
      <AnimatePresence>
        {showImportModal && business?.id && (
          <PurchaseImportDialog
            businessId={business.id}
            initialNote={reviewingNote}
            onClose={() => {
              setShowImportModal(false);
              setReviewingNote(null);
            }}
            onCompleted={(note) => {
              setShowImportModal(false);
              setReviewingNote(null);
              setSelectedNote(note as unknown as PurchaseNote);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
