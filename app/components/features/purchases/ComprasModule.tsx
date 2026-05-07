'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingBag, Upload, Search, X, FileText, CheckCircle2, AlertCircle,
  Building2, Calendar, Package, DollarSign, TrendingDown, Clock,
  ChevronDown, ChevronRight, RefreshCw, Eye, Download, Filter,
  BarChart3, ArrowUpRight, Truck,
} from 'lucide-react';
import {
  collection, query, where, orderBy, getDocs, addDoc, updateDoc, doc, onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useMutation } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import type { PurchaseNote, PurchaseNoteItem, PurchaseNoteStatus, Product } from '@/lib/types';
import { toast } from 'react-toastify';
import { addStock } from '@/lib/services/stock';

// ─── XML Parser (regex-based, no DOM needed) ─────────────────────────────────

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[^:>]+:)?${name}>`, 'i'));
  return m ? m[1].trim() : '';
}

function allTags(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[^:>]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[^:>]+:)?${name}>`, 'gi');
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

function tagAttr(xml: string, name: string, attr: string): string {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${name}[^\\s>]*\\s[^>]*${attr}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

interface ParsedNFe {
  accessKey: string;
  numero: string;
  serie: string;
  issueDate: string;
  supplierName: string;
  supplierCnpj: string;
  items: PurchaseNoteItem[];
  totalProducts: number;
  totalTaxes: number;
  totalValue: number;
}

function parseNFeXml(xml: string): ParsedNFe | null {
  try {
    const ide = tag(xml, 'ide');
    const emit = tag(xml, 'emit');
    const total = tag(xml, 'total');
    const icmsTot = tag(xml, 'ICMSTot');

    const numero = tag(ide, 'nNF');
    const serie = tag(ide, 'serie');
    const issueDate = tag(ide, 'dhEmi') || tag(ide, 'dEmi');

    const supplierName = tag(emit, 'xNome') || tag(emit, 'xFant');
    const supplierCnpj = tag(emit, 'CNPJ');

    // Access key from infNFe Id or chNFe
    const accessKeyMatch = xml.match(/chNFe[^>]*>(\d{44})</);
    const accessKeyFromId = xml.match(/Id="NFe(\d{44})"/);
    const accessKey = accessKeyMatch ? accessKeyMatch[1] : (accessKeyFromId ? accessKeyFromId[1] : '');

    // Items
    const detBlocks = allTags(xml, 'det');
    const items: PurchaseNoteItem[] = detBlocks.map(det => {
      const prod = tag(det, 'prod');
      const imposto = tag(det, 'imposto');
      const icmsBlock = tag(imposto, 'ICMS');
      const pisBlock = tag(imposto, 'PIS');
      const cofinsBlock = tag(imposto, 'COFINS');
      const ipiBlock = tag(imposto, 'IPI');

      return {
        cProd: tag(prod, 'cProd'),
        productName: tag(prod, 'xProd'),
        ncm: tag(prod, 'NCM'),
        cfop: tag(prod, 'CFOP'),
        unit: tag(prod, 'uCom') || 'UN',
        quantity: parseFloat(tag(prod, 'qCom') || '0'),
        unitPrice: parseFloat(tag(prod, 'vUnCom') || '0'),
        total: parseFloat(tag(prod, 'vProd') || '0'),
        icms: parseFloat(tag(icmsBlock, 'vICMS') || '0') || undefined,
        ipi: parseFloat(tag(ipiBlock, 'vIPI') || '0') || undefined,
        pis: parseFloat(tag(pisBlock, 'vPIS') || '0') || undefined,
        cofins: parseFloat(tag(cofinsBlock, 'vCOFINS') || '0') || undefined,
      };
    });

    const totalProducts = parseFloat(tag(icmsTot, 'vProd') || '0');
    const totalTaxes = parseFloat(tag(icmsTot, 'vNF') || '0') - totalProducts;
    const totalValue = parseFloat(tag(icmsTot, 'vNF') || '0');

    if (!numero || !supplierCnpj) return null;

    return { accessKey, numero, serie, issueDate: issueDate.split('T')[0], supplierName, supplierCnpj, items, totalProducts, totalTaxes, totalValue };
  } catch (err) {
    console.error('[Compras] XML parse error:', err);
    return null;
  }
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<PurchaseNoteStatus, { label: string; color: string; icon: typeof Clock }> = {
  pendente:   { label: 'Pendente', color: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300', icon: Clock },
  importada:  { label: 'Importada', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300', icon: CheckCircle2 },
  cancelada:  { label: 'Cancelada', color: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300', icon: X },
};

// ─── XML Upload Zone ──────────────────────────────────────────────────────────

function XmlUploadZone({ onParsed }: { onParsed: (data: ParsedNFe, xml: string) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (!file.name.endsWith('.xml')) {
      toast.error('Apenas arquivos XML são suportados');
      return;
    }
    setIsProcessing(true);
    try {
      const xml = await file.text();
      const parsed = parseNFeXml(xml);
      if (!parsed) {
        toast.error('Arquivo XML inválido ou não reconhecido como NF-e');
        return;
      }
      onParsed(parsed, xml);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'relative flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl cursor-pointer transition-all',
        isDragging
          ? 'border-red-400 bg-red-50 dark:bg-red-500/10'
          : 'border-gray-200 dark:border-gray-700 hover:border-red-300 dark:hover:border-red-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/30'
      )}
      onClick={() => fileInputRef.current?.click()}
    >
      <input ref={fileInputRef} type="file" accept=".xml" className="hidden" onChange={handleFileChange} />
      {isProcessing ? (
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Processando XML...</p>
        </div>
      ) : (
        <>
          <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center mb-3 transition-colors',
            isDragging ? 'bg-red-100 dark:bg-red-500/20' : 'bg-gray-100 dark:bg-gray-800')}>
            <Upload className={cn('w-7 h-7 transition-colors', isDragging ? 'text-red-500' : 'text-gray-400')} />
          </div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Arraste o XML da NF-e ou clique para selecionar
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Suporte a NF-e versão 4.0 · Arquivo .xml
          </p>
        </>
      )}
    </div>
  );
}

// ─── Import Preview ───────────────────────────────────────────────────────────

function ImportPreview({
  parsed,
  xml,
  onConfirm,
  onCancel,
  isSaving,
}: {
  parsed: ParsedNFe;
  xml: string;
  onConfirm: (note: Omit<PurchaseNote, 'id'>) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [notes, setNotes] = useState('');

  const handleConfirm = () => {
    const now = new Date().toISOString();
    onConfirm({
      accessKey: parsed.accessKey,
      numero: parsed.numero,
      serie: parsed.serie,
      issueDate: parsed.issueDate,
      supplierName: parsed.supplierName,
      supplierCnpj: parsed.supplierCnpj,
      items: parsed.items,
      totalProducts: parsed.totalProducts,
      totalTaxes: parsed.totalTaxes,
      totalValue: parsed.totalValue,
      status: 'pendente',
      notes: notes || undefined,
      xml,
      createdAt: now,
      updatedAt: now,
    } as Omit<PurchaseNote, 'id'>);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* Supplier */}
      <div className="surface rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">{parsed.supplierName}</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">CNPJ: {parsed.supplierCnpj}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-gray-400">NF-e nº {parsed.numero}-{parsed.serie}</p>
            <p className="text-xs text-gray-400">{formatDate(parsed.issueDate)}</p>
          </div>
        </div>
      </div>

      {/* Items */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Itens ({parsed.items.length})</p>
        <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
          {parsed.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-3 bg-gray-50 dark:bg-gray-800/60 rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.productName}</p>
                <p className="text-xs text-gray-500">{item.quantity} {item.unit} × {formatCurrency(item.unitPrice)}</p>
              </div>
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 ml-3">{formatCurrency(item.total)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Totals */}
      <div className="surface rounded-xl p-4 space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Produtos</span>
          <span className="text-gray-700 dark:text-gray-300">{formatCurrency(parsed.totalProducts)}</span>
        </div>
        {parsed.totalTaxes > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Impostos</span>
            <span className="text-gray-700 dark:text-gray-300">{formatCurrency(parsed.totalTaxes)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-base pt-1.5 border-t border-gray-100 dark:border-gray-800">
          <span className="text-gray-900 dark:text-white">Total NF-e</span>
          <span className="text-red-600 dark:text-red-400">{formatCurrency(parsed.totalValue)}</span>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Observações</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          className="w-full bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-400 resize-none transition-all"
          placeholder="Observações opcionais sobre esta nota..."
        />
      </div>

      <div className="flex gap-3">
        <button onClick={onCancel}
          className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          Cancelar
        </button>
        <button onClick={handleConfirm} disabled={isSaving}
          className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {isSaving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Importar nota
        </button>
      </div>
    </motion.div>
  );
}

// ─── Note Detail Panel ────────────────────────────────────────────────────────

function NoteDetailPanel({
  note,
  onClose,
  onPushToStock,
  isPushingStock,
}: {
  note: PurchaseNote;
  onClose: () => void;
  onPushToStock?: (note: PurchaseNote) => void;
  isPushingStock?: boolean;
}) {
  const statusCfg = STATUS_CONFIG[note.status];
  const StatusIcon = statusCfg.icon;
  const canPushToStock = !note.stockImportedAt && note.status !== 'cancelada';

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
              <div key={i} className="flex items-start justify-between text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white truncate">{item.productName}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {item.quantity} {item.unit} · NCM: {item.ncm || '—'} · CFOP: {item.cfop || '—'}
                  </p>
                </div>
                <span className="font-semibold text-gray-700 dark:text-gray-300 ml-2 flex-shrink-0">{formatCurrency(item.total)}</span>
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

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<PurchaseNoteStatus | 'all'>('all');
  const [selectedNote, setSelectedNote] = useState<PurchaseNote | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [parsedXml, setParsedXml] = useState<{ data: ParsedNFe; xml: string } | null>(null);

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

      for (const item of note.items) {
        const skuKey = item.cProd?.trim().toLowerCase();
        const nameKey = item.productName.trim().toLowerCase();
        const found = (skuKey && bySku.get(skuKey)) || byName.get(nameKey);
        if (found && item.quantity > 0) {
          matched.push({ productId: found.id, quantity: item.quantity });
          productIndex.set(found.id, found);
        } else {
          unmatched.push({ productName: item.productName, quantity: item.quantity, cProd: item.cProd });
        }
      }

      if (matched.length === 0) {
        throw new Error('no_matches');
      }

      await addStock(db, matched, {
        businessId: business.id,
        operatorId: user.uid,
        operatorName: user.name,
        purchaseId: note.id,
        reason: `NF-e ${note.numero}/${note.serie} — ${note.supplierName}`,
        productIndex,
      });

      await updateDoc(doc(db, 'purchaseNotes', note.id), {
        status: 'importada' as PurchaseNoteStatus,
        stockImportedAt: new Date().toISOString(),
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

  // ─── Import mutation ─────────────────────────────────────────────────────────
  const { mutate: importNote, isPending: isImporting } = useMutation({
    mutationFn: async (note: Omit<PurchaseNote, 'id'>) => {
      // Check for duplicate by accessKey
      if (note.accessKey) {
        const existing = notes.find(n => n.accessKey === note.accessKey);
        if (existing) throw new Error('duplicate');
      }
      await addDoc(collection(db, 'purchaseNotes'), {
        ...note,
        businessId: business!.id,
      });
    },
    onSuccess: () => {
      // notes vem via onSnapshot — não precisa invalidar.
      toast.success('Nota importada com sucesso!');
      setShowImportModal(false);
      setParsedXml(null);
    },
    onError: (err: Error) => {
      if (err.message === 'duplicate') {
        toast.error('Esta NF-e já foi importada anteriormente');
      } else {
        toast.error('Erro ao importar nota');
        console.error('[Compras] Import error:', err);
      }
    },
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
    const imported = notes.filter(n => n.status === 'importada').length;
    const pending = notes.filter(n => n.status === 'pendente').length;
    const totalItems = notes.reduce((s, n) => s + n.items.length, 0);
    return { total: notes.length, totalValue, imported, pending, totalItems };
  }, [notes]);

  const handleParsed = (data: ParsedNFe, xml: string) => {
    setParsedXml({ data, xml });
  };

  const handleCancelParsed = () => {
    setParsedXml(null);
    setShowImportModal(false);
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
            <ShoppingBag className="w-6 h-6 text-red-500" />
            Compras
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Importação de notas fiscais de entrada
          </p>
        </div>
        <button
          onClick={() => setShowImportModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          <Upload className="w-4 h-4" />
          Importar NF-e
        </button>
      </motion.div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total importado', value: formatCurrency(kpis.totalValue), icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10', isStr: true },
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
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{kpi.isStr ? kpi.value : kpi.value}</p>
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
                isPushingStock={isPushingStock}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Import modal */}
      <AnimatePresence>
        {showImportModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget && !parsedXml) { setShowImportModal(false); } }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl shadow-2xl">
              <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                    <Upload className="w-4 h-4 text-red-500" />
                  </div>
                  <h2 className="font-semibold text-gray-900 dark:text-white">Importar NF-e</h2>
                </div>
                <button onClick={handleCancelParsed}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6">
                {!parsedXml ? (
                  <>
                    <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        Selecione o arquivo XML da NF-e fornecida pelo seu fornecedor.
                        O sistema irá extrair automaticamente os dados da nota.
                      </p>
                    </div>
                    <XmlUploadZone onParsed={handleParsed} />
                  </>
                ) : (
                  <ImportPreview
                    parsed={parsedXml.data}
                    xml={parsedXml.xml}
                    onConfirm={importNote}
                    onCancel={handleCancelParsed}
                    isSaving={isImporting}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
