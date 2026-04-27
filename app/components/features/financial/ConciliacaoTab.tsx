'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { collection, query, where, orderBy, getDocs, addDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { parseOFX, parseCSV, autoMatch, type AutoMatchConfig } from '@/lib/services/reconciliation';
import type { Transaction, BankAccount, BankStatementEntry } from '@/lib/types';
import {
  Upload, FileText, Check, X, AlertTriangle,
  Search, Loader2, Scale, Settings2, ChevronDown,
  Link2, CheckCircle2, Eye, BarChart3,
} from 'lucide-react';

type ItemStatus = 'matched' | 'review' | 'pending' | 'divergent' | 'ignored';

interface ConcilItem extends BankStatementEntry {
  matchedTxId?: string;
  confidence?: number;
  status: ItemStatus;
}

interface Props {
  businessId: string;
  transactions: Transaction[];
  bankAccounts: BankAccount[];
}

const STATUS_LABELS: Record<ItemStatus, string> = {
  matched:  'Conciliado',
  review:   'Revisar',
  pending:  'Pendente',
  divergent:'Divergente',
  ignored:  'Ignorado',
};

export default function ConciliacaoTab({ businessId, transactions, bankAccounts }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  // Selection
  const [selectedBankId, setSelectedBankId] = useState('');

  // Tolerance config
  const [showConfig, setShowConfig] = useState(false);
  const [amountTolerance, setAmountTolerance] = useState(0.01);
  const [dateTolerance, setDateTolerance] = useState(3);

  // Processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [items, setItems] = useState<ConcilItem[]>([]);
  const [fileName, setFileName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Filters
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ItemStatus>('all');

  // Manual match: which item is open for manual selection
  const [manualMatchIdx, setManualMatchIdx] = useState<number | null>(null);

  // Past imports + unreconciled report
  const [imports, setImports] = useState<Array<{
    id: string; fileName: string; importedAt: string;
    matched: number; pending: number; divergent: number; totalEntries: number;
  }>>([]);
  const [unreconciledCount, setUnreconciledCount] = useState<{ pending: number; divergent: number } | null>(null);

  // Load past imports and unreconciled summary
  useEffect(() => {
    if (!businessId) return;
    getDocs(query(
      collection(db, 'bankStatementImports'),
      where('businessId', '==', businessId),
      orderBy('importedAt', 'desc'),
    )).then(snap => {
      const rows = snap.docs.map(d => ({ ...d.data(), id: d.id } as (typeof imports)[0]));
      setImports(rows);
      // Aggregate unreconciled totals across all past imports
      const totals = rows.reduce((acc, r) => ({
        pending: acc.pending + (r.pending || 0),
        divergent: acc.divergent + (r.divergent || 0),
      }), { pending: 0, divergent: 0 });
      setUnreconciledCount(totals);
    }).catch(() => {});
  }, [businessId, saved]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'ofx' && ext !== 'csv') {
      alert('Formato não suportado. Use .ofx ou .csv');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Arquivo muito grande. Máximo 5MB.');
      return;
    }

    setIsProcessing(true);
    setFileName(file.name);
    setSaved(false);
    setManualMatchIdx(null);

    try {
      const content = await file.text();
      const parsed = ext === 'ofx' ? parseOFX(content) : parseCSV(content);

      if (parsed.length === 0) {
        alert('Nenhuma transação encontrada. Verifique o formato.');
        return;
      }

      const bankTx = selectedBankId
        ? transactions.filter(t => t.bankAccountId === selectedBankId)
        : transactions;

      const config: AutoMatchConfig = { amountTolerance, dateTolerance };
      const matches = autoMatch(parsed, bankTx, config);
      const matchMap = new Map(matches.map(m => [m.statementIdx, m]));

      const result: ConcilItem[] = parsed.map((entry, idx) => {
        const match = matchMap.get(idx);
        let status: ItemStatus = 'pending';
        if (match) {
          if (match.confidence >= 85) status = 'matched';
          else if (match.confidence >= 60) status = 'review';
          else status = 'divergent';
        }
        return { ...entry, matchedTxId: match?.transactionId, confidence: match?.confidence, status };
      });

      setItems(result);
    } catch (err) {
      console.error('Parse error:', err);
      alert('Erro ao processar arquivo');
    } finally {
      setIsProcessing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [transactions, selectedBankId, amountTolerance, dateTolerance]);

  const handleConfirm = (idx: number) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, status: 'matched' as ItemStatus } : item
    ));
  };

  const handleManualMatch = (idx: number, txId: string) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, matchedTxId: txId, confidence: 100, status: 'matched' as ItemStatus } : item
    ));
    setManualMatchIdx(null);
  };

  const handleIgnore = (idx: number) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, status: 'ignored' as ItemStatus } : item
    ));
  };

  const handleSaveReconciliation = useCallback(async () => {
    if (!user || !businessId || items.length === 0) return;
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const importRef = doc(collection(db, 'bankStatementImports'));

      const matched   = items.filter(i => i.status === 'matched').length;
      const pending   = items.filter(i => i.status === 'pending' || i.status === 'review').length;
      const divergent = items.filter(i => i.status === 'divergent').length;

      // First batch: always write the import summary doc
      const firstBatch = writeBatch(db);
      firstBatch.set(importRef, {
        businessId,
        bankAccountId: selectedBankId || null,
        fileName,
        format: fileName.endsWith('.ofx') ? 'ofx' : 'csv',
        totalEntries: items.length,
        matched, pending, divergent,
        importedAt: now,
        importedBy: user.uid,
        config: { amountTolerance, dateTolerance },
      });
      await firstBatch.commit();

      // Chunk remaining item docs into batches of 499 (Firestore hard limit is 500)
      const toWrite = items.filter(i => i.status !== 'ignored');
      const CHUNK = 499;
      for (let offset = 0; offset < toWrite.length; offset += CHUNK) {
        const chunk = toWrite.slice(offset, offset + CHUNK);
        const itemBatch = writeBatch(db);
        for (const item of chunk) {
          const itemRef = doc(collection(db, 'reconciliationItems'));
          itemBatch.set(itemRef, {
            businessId,
            bankAccountId: selectedBankId || null,
            importId: importRef.id,
            statementDate: item.date,
            statementDescription: item.description,
            statementAmount: item.amount,
            statementReference: item.reference || null,
            transactionId: item.matchedTxId || null,
            status: item.status === 'review' ? 'pending' : item.status,
            matchConfidence: item.confidence || null,
            ...(item.status === 'matched' ? { reconciledBy: user.uid, reconciledAt: now } : {}),
            createdAt: now,
          });
        }
        await itemBatch.commit();
      }

      setSaved(true);
    } catch (err) {
      console.error('Save error:', err);
      alert('Erro ao salvar conciliação');
    } finally {
      setIsSaving(false);
    }
  }, [user, businessId, items, selectedBankId, fileName, amountTolerance, dateTolerance]);

  const filteredItems = useMemo(() => items.filter(item => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (searchFilter && !item.description.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    return true;
  }), [items, statusFilter, searchFilter]);

  const stats = useMemo(() => ({
    total:    items.length,
    matched:  items.filter(i => i.status === 'matched').length,
    review:   items.filter(i => i.status === 'review').length,
    pending:  items.filter(i => i.status === 'pending').length,
    divergent:items.filter(i => i.status === 'divergent').length,
  }), [items]);

  // Candidate transactions for manual match (within ±7 days of item date)
  const getMatchCandidates = (item: ConcilItem): Transaction[] => {
    const entryMs = new Date(item.date + 'T00:00:00').getTime();
    return transactions
      .filter(tx => {
        const txDate = tx.paymentDate || tx.dueDate;
        if (!txDate) return false;
        const diff = Math.abs(new Date(txDate + 'T00:00:00').getTime() - entryMs) / 86400000;
        return diff <= 7;
      })
      .sort((a, b) => {
        const aAmt = Math.abs(Math.abs(a.amount) - Math.abs(item.amount));
        const bAmt = Math.abs(Math.abs(b.amount) - Math.abs(item.amount));
        return aAmt - bAmt;
      })
      .slice(0, 20);
  };

  const statusStyle: Record<ItemStatus, string> = {
    matched:  'bg-emerald-50/50 dark:bg-emerald-500/5 border-emerald-200/50 dark:border-emerald-500/10',
    review:   'bg-violet-50/50 dark:bg-violet-500/5 border-violet-200/60 dark:border-violet-500/15',
    divergent:'bg-red-50/50 dark:bg-red-500/5 border-red-200/50 dark:border-red-500/10',
    ignored:  'bg-gray-50 dark:bg-gray-800/30 border-gray-200/50 dark:border-gray-700/30 opacity-50',
    pending:  'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/60',
  };

  const iconStyle: Record<ItemStatus, string> = {
    matched:  'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-500',
    review:   'bg-violet-100 dark:bg-violet-500/10 text-violet-500',
    divergent:'bg-red-100 dark:bg-red-500/10 text-red-500',
    ignored:  'bg-gray-100 dark:bg-gray-700 text-gray-400',
    pending:  'bg-gray-100 dark:bg-gray-700 text-gray-400',
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">Conciliação Bancária</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Importe extratos e reconcilie com suas transações</p>
      </div>

      {/* Upload area */}
      {items.length === 0 && (
        <div className="space-y-4">
          {/* Bank + tolerance settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Conta bancária (opcional)
              </label>
              <select
                value={selectedBankId}
                onChange={e => setSelectedBankId(e.target.value)}
                className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              >
                <option value="">Todas as contas</option>
                {bankAccounts.filter(a => a.isActive).map(a => (
                  <option key={a.id} value={a.id}>{a.name} — {a.bankName}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => setShowConfig(v => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border transition-colors',
                  showConfig
                    ? 'border-violet-400 bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                )}
              >
                <Settings2 size={13} />
                Tolerâncias de match
                <ChevronDown size={12} className={cn('transition-transform', showConfig && 'rotate-180')} />
              </button>
            </div>
          </div>

          {/* Tolerance config panel */}
          <AnimatePresence>
            {showConfig && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 rounded-xl border border-violet-200 dark:border-violet-500/20 bg-violet-50/50 dark:bg-violet-500/5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-violet-700 dark:text-violet-400 mb-1.5 block">
                      Tolerância de valor (R$)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range" min="0" max="100" step="1"
                        value={amountTolerance * 100}
                        onChange={e => setAmountTolerance(Number(e.target.value) / 100)}
                        className="flex-1 accent-violet-600"
                      />
                      <span className="text-sm font-mono font-bold text-violet-700 dark:text-violet-400 w-16 text-right">
                        ±{amountTolerance.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-[11px] text-violet-500 mt-1">Diferença máxima de valor aceita como match</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-violet-700 dark:text-violet-400 mb-1.5 block">
                      Tolerância de data (dias)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range" min="0" max="14" step="1"
                        value={dateTolerance}
                        onChange={e => setDateTolerance(Number(e.target.value))}
                        className="flex-1 accent-violet-600"
                      />
                      <span className="text-sm font-mono font-bold text-violet-700 dark:text-violet-400 w-16 text-right">
                        ±{dateTolerance}d
                      </span>
                    </div>
                    <p className="text-[11px] text-violet-500 mt-1">Diferença máxima de data aceita como match</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Drop zone */}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isProcessing}
            className="w-full p-10 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-red-400 dark:hover:border-red-500/40 bg-gray-50/50 dark:bg-gray-800/30 transition-colors text-center group"
          >
            {isProcessing
              ? <Loader2 className="w-8 h-8 mx-auto text-red-500 animate-spin mb-2" />
              : <Upload className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 group-hover:text-red-400 mb-2 transition-colors" />
            }
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {isProcessing ? 'Processando...' : 'Clique para importar extrato'}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Formatos aceitos: .ofx, .csv (até 5MB)</p>
          </button>
          <input ref={fileRef} type="file" accept=".ofx,.csv" onChange={handleFileSelect} className="hidden" />

          {/* Unreconciled summary */}
          {unreconciledCount && (unreconciledCount.pending > 0 || unreconciledCount.divergent > 0) && (
            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 size={14} className="text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Itens não conciliados (histórico)</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  <span className="font-bold">{unreconciledCount.pending}</span> pendentes
                </span>
                <span className="text-sm text-red-600 dark:text-red-400">
                  <span className="font-bold">{unreconciledCount.divergent}</span> divergentes
                </span>
              </div>
            </div>
          )}

          {/* Past imports */}
          {imports.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Importações anteriores</p>
              {imports.slice(0, 5).map(imp => (
                <div key={imp.id} className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/60">
                  <FileText size={16} className="text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{imp.fileName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(imp.importedAt).toLocaleDateString('pt-BR')} · {imp.totalEntries} entradas ·{' '}
                      <span className="text-emerald-600 dark:text-emerald-400">{imp.matched} conciliadas</span>
                      {imp.pending > 0 && <span className="text-amber-600 dark:text-amber-400"> · {imp.pending} pendentes</span>}
                      {imp.divergent > 0 && <span className="text-red-600 dark:text-red-400"> · {imp.divergent} divergentes</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {items.length > 0 && (
        <>
          {/* Stats bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { label: 'Total',       value: stats.total,    cls: 'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/60 text-gray-900 dark:text-gray-100' },
              { label: 'Conciliados', value: stats.matched,  cls: 'bg-emerald-50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400' },
              { label: 'Revisar',     value: stats.review,   cls: 'bg-violet-50 dark:bg-violet-500/5 border-violet-200 dark:border-violet-500/20 text-violet-600 dark:text-violet-400' },
              { label: 'Pendentes',   value: stats.pending,  cls: 'bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-400' },
              { label: 'Divergentes', value: stats.divergent,cls: 'bg-red-50 dark:bg-red-500/5 border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400' },
            ].map(s => (
              <button
                key={s.label}
                onClick={() => setStatusFilter(
                  s.label === 'Total' ? 'all' :
                  s.label === 'Conciliados' ? 'matched' :
                  s.label === 'Revisar' ? 'review' :
                  s.label === 'Pendentes' ? 'pending' : 'divergent'
                )}
                className={cn('p-3 rounded-xl border text-center transition-all hover:shadow-sm', s.cls)}
              >
                <p className="text-xl font-bold">{s.value}</p>
                <p className="text-xs mt-0.5 opacity-70">{s.label}</p>
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                placeholder="Buscar por descrição..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['all', 'matched', 'review', 'pending', 'divergent'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap',
                    statusFilter === s ? 'bg-red-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  )}
                >
                  {s === 'all' ? 'Todos' : STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Items list */}
          <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {filteredItems.map((item) => {
              const realIdx = items.indexOf(item);
              const matchedTx = item.matchedTxId ? transactions.find(t => t.id === item.matchedTxId) : null;
              const isManualOpen = manualMatchIdx === realIdx;
              const candidates = isManualOpen ? getMatchCandidates(item) : [];

              return (
                <div
                  key={realIdx}
                  className={cn('rounded-xl border transition-colors', statusStyle[item.status])}
                >
                  <div className="flex items-center gap-3 p-3">
                    {/* Status icon */}
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', iconStyle[item.status])}>
                      {item.status === 'matched'  ? <Check size={14} /> :
                       item.status === 'review'   ? <Eye size={14} /> :
                       item.status === 'divergent' ? <AlertTriangle size={14} /> :
                       <Scale size={14} />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {item.description || '(sem descrição)'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {formatDate(item.date)}
                        {item.confidence !== undefined && ` · ${item.confidence}% match`}
                        {matchedTx && ` · → ${matchedTx.description}`}
                      </p>
                    </div>

                    {/* Amount */}
                    <p className={cn('text-sm font-bold shrink-0 tabular-nums', item.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {item.amount >= 0 ? '+' : ''}{formatCurrency(item.amount)}
                    </p>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {item.status === 'review' && (
                        <button
                          onClick={() => handleConfirm(realIdx)}
                          title="Confirmar match"
                          className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/20 transition-colors"
                        >
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      {(item.status === 'pending' || item.status === 'review' || item.status === 'divergent') && (
                        <button
                          onClick={() => setManualMatchIdx(isManualOpen ? null : realIdx)}
                          title="Match manual"
                          className={cn(
                            'p-1.5 rounded-lg transition-colors',
                            isManualOpen
                              ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                              : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600'
                          )}
                        >
                          <Link2 size={14} />
                        </button>
                      )}
                      {item.status !== 'matched' && item.status !== 'ignored' && (
                        <button
                          onClick={() => handleIgnore(realIdx)}
                          title="Ignorar"
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Manual match dropdown */}
                  {isManualOpen && (
                    <div className="border-t border-gray-200 dark:border-gray-700 p-3">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
                        Selecionar transação (±7 dias, ordenado por valor próximo)
                      </p>
                      {candidates.length === 0 ? (
                        <p className="text-xs text-gray-400 dark:text-gray-500 italic">Nenhuma transação próxima encontrada</p>
                      ) : (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {candidates.map(tx => (
                            <button
                              key={tx.id}
                              onClick={() => handleManualMatch(realIdx, tx.id)}
                              className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{tx.description}</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500">{formatDate(tx.paymentDate || tx.dueDate)} · {tx.category}</p>
                              </div>
                              <span className={cn('text-sm font-bold ml-3 shrink-0 tabular-nums', tx.type === 'receita' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                                {tx.type === 'receita' ? '+' : '-'}{formatCurrency(tx.amount)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredItems.length === 0 && (
              <p className="text-sm text-center text-gray-400 dark:text-gray-500 py-8">Nenhum item para este filtro</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={() => { setItems([]); setFileName(''); setSaved(false); setManualMatchIdx(null); }}
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              ← Nova importação
            </button>
            <button
              onClick={handleSaveReconciliation}
              disabled={isSaving || saved}
              className={cn(
                'px-5 py-2.5 text-sm font-medium rounded-xl transition-colors flex items-center gap-2',
                saved ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                'bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white'
              )}
            >
              {saved ? <Check size={16} /> : isSaving ? <Loader2 size={16} className="animate-spin" /> : <Scale size={16} />}
              {saved ? 'Salvo' : isSaving ? 'Salvando...' : 'Salvar conciliação'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
