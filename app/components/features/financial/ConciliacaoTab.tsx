'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { collection, query, where, orderBy, getDocs, addDoc, updateDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { parseOFX, parseCSV, autoMatch } from '@/lib/services/reconciliation';
import type { Transaction, BankAccount, ReconciliationItem, BankStatementEntry } from '@/lib/types';
import {
  Upload, FileText, Check, X, Link2, AlertTriangle,
  Search, ChevronDown, Loader2, Eye, Scale,
} from 'lucide-react';

interface Props {
  businessId: string;
  transactions: Transaction[];
  bankAccounts: BankAccount[];
}

export default function ConciliacaoTab({ businessId, transactions, bankAccounts }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Parsed entries + match results
  const [entries, setEntries] = useState<BankStatementEntry[]>([]);
  const [items, setItems] = useState<Array<BankStatementEntry & { matchedTxId?: string; confidence?: number; status: 'matched' | 'pending' | 'divergent' | 'ignored' }>>([]);
  const [fileName, setFileName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'matched' | 'pending' | 'divergent'>('all');

  // Past imports
  const [imports, setImports] = useState<Array<{ id: string; fileName: string; importedAt: string; matched: number; pending: number; totalEntries: number }>>([]);

  useEffect(() => {
    if (!businessId) return;
    getDocs(query(
      collection(db, 'bankStatementImports'),
      where('businessId', '==', businessId),
      orderBy('importedAt', 'desc'),
    )).then(snap => {
      setImports(snap.docs.map(d => ({ ...d.data(), id: d.id } as any)));
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

    try {
      const content = await file.text();
      const parsed = ext === 'ofx' ? parseOFX(content) : parseCSV(content);

      if (parsed.length === 0) {
        alert('Nenhuma transação encontrada no arquivo. Verifique o formato.');
        setIsProcessing(false);
        return;
      }

      setEntries(parsed);

      // Filter transactions for the selected bank account
      const bankTx = selectedBankId
        ? transactions.filter(t => t.bankAccountId === selectedBankId)
        : transactions;

      // Auto-match
      const matches = autoMatch(parsed, bankTx);
      const matchMap = new Map(matches.map(m => [m.statementIdx, m]));

      const result = parsed.map((entry, idx) => {
        const match = matchMap.get(idx);
        return {
          ...entry,
          matchedTxId: match?.transactionId,
          confidence: match?.confidence,
          status: (match ? (match.confidence >= 70 ? 'matched' : 'divergent') : 'pending') as 'matched' | 'pending' | 'divergent',
        };
      });

      setItems(result);
    } catch (err) {
      console.error('Parse error:', err);
      alert('Erro ao processar arquivo');
    } finally {
      setIsProcessing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [transactions, selectedBankId]);

  const handleManualMatch = (idx: number, txId: string) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, matchedTxId: txId, confidence: 100, status: 'matched' as const } : item
    ));
  };

  const handleIgnore = (idx: number) => {
    setItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, status: 'ignored' as const } : item
    ));
  };

  const handleSaveReconciliation = useCallback(async () => {
    if (!user || !businessId || items.length === 0) return;
    setIsSaving(true);

    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);

      // Save import record
      const importRef = doc(collection(db, 'bankStatementImports'));
      const matched = items.filter(i => i.status === 'matched').length;
      const pending = items.filter(i => i.status === 'pending').length;
      const divergent = items.filter(i => i.status === 'divergent').length;

      batch.set(importRef, {
        businessId,
        bankAccountId: selectedBankId || null,
        fileName,
        format: fileName.endsWith('.ofx') ? 'ofx' : 'csv',
        totalEntries: items.length,
        matched,
        pending,
        divergent,
        importedAt: now,
        importedBy: user.uid,
      });

      // Save individual reconciliation items
      for (const item of items) {
        if (item.status === 'ignored') continue;
        const itemRef = doc(collection(db, 'reconciliationItems'));
        batch.set(itemRef, {
          businessId,
          bankAccountId: selectedBankId || null,
          importId: importRef.id,
          statementDate: item.date,
          statementDescription: item.description,
          statementAmount: item.amount,
          statementReference: item.reference || null,
          transactionId: item.matchedTxId || null,
          status: item.status,
          matchConfidence: item.confidence || null,
          ...(item.status === 'matched' ? { reconciledBy: user.uid, reconciledAt: now } : {}),
          createdAt: now,
        });
      }

      await batch.commit();
      setSaved(true);
    } catch (err) {
      console.error('Save reconciliation error:', err);
      alert('Erro ao salvar conciliação');
    } finally {
      setIsSaving(false);
    }
  }, [user, businessId, items, selectedBankId, fileName]);

  const filteredItems = items.filter(item => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (searchFilter && !item.description.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: items.length,
    matched: items.filter(i => i.status === 'matched').length,
    pending: items.filter(i => i.status === 'pending').length,
    divergent: items.filter(i => i.status === 'divergent').length,
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 font-display">
            {t('financial.reconciliation.title', 'Conciliação Bancária')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('financial.reconciliation.desc', 'Importe extratos e reconcilie com suas transações')}
          </p>
        </div>
      </div>

      {/* Upload area */}
      {items.length === 0 && (
        <div className="space-y-4">
          {/* Bank account selector */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('financial.reconciliation.bankAccount', 'Conta bancária')} (opcional)
            </label>
            <select
              value={selectedBankId}
              onChange={(e) => setSelectedBankId(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="">Todas as contas</option>
              {bankAccounts.filter(a => a.isActive).map(a => (
                <option key={a.id} value={a.id}>{a.name} — {a.bankName}</option>
              ))}
            </select>
          </div>

          {/* Drop zone */}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isProcessing}
            className="w-full p-10 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-red-400 dark:hover:border-red-500/40 bg-gray-50/50 dark:bg-gray-800/30 transition-colors text-center group"
          >
            {isProcessing ? (
              <Loader2 className="w-8 h-8 mx-auto text-red-500 animate-spin mb-2" />
            ) : (
              <Upload className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 group-hover:text-red-400 mb-2 transition-colors" />
            )}
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {isProcessing ? 'Processando...' : 'Clique para importar extrato'}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Formatos aceitos: .ofx, .csv (até 5MB)
            </p>
          </button>
          <input ref={fileRef} type="file" accept=".ofx,.csv" onChange={handleFileSelect} className="hidden" />

          {/* Past imports */}
          {imports.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Importações anteriores
              </p>
              {imports.slice(0, 5).map(imp => (
                <div key={imp.id} className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/60">
                  <FileText size={16} className="text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{imp.fileName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(imp.importedAt).toLocaleDateString('pt-BR')} · {imp.totalEntries} entradas · {imp.matched} conciliadas
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/60 text-center">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</p>
              <p className="text-xs text-gray-500">Total</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 text-center">
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.matched}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">Conciliadas</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 text-center">
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{stats.pending}</p>
              <p className="text-xs text-amber-600 dark:text-amber-400">Pendentes</p>
            </div>
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 text-center">
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.divergent}</p>
              <p className="text-xs text-red-600 dark:text-red-400">Divergentes</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Buscar por descrição..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex gap-1">
              {(['all', 'matched', 'pending', 'divergent'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                    statusFilter === s
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  )}
                >
                  {s === 'all' ? 'Todos' : s === 'matched' ? 'Conciliados' : s === 'pending' ? 'Pendentes' : 'Divergentes'}
                </button>
              ))}
            </div>
          </div>

          {/* Items list */}
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {filteredItems.map((item, idx) => {
              const realIdx = items.indexOf(item);
              const matchedTx = item.matchedTxId ? transactions.find(t => t.id === item.matchedTxId) : null;
              return (
                <div
                  key={idx}
                  className={cn(
                    'p-3 rounded-xl border transition-colors',
                    item.status === 'matched' ? 'bg-emerald-50/50 dark:bg-emerald-500/5 border-emerald-200/50 dark:border-emerald-500/10' :
                    item.status === 'divergent' ? 'bg-red-50/50 dark:bg-red-500/5 border-red-200/50 dark:border-red-500/10' :
                    item.status === 'ignored' ? 'bg-gray-50 dark:bg-gray-800/30 border-gray-200/50 dark:border-gray-700/30 opacity-50' :
                    'bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/60'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                      item.status === 'matched' ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-500' :
                      item.status === 'divergent' ? 'bg-red-100 dark:bg-red-500/10 text-red-500' :
                      'bg-gray-100 dark:bg-gray-700 text-gray-400'
                    )}>
                      {item.status === 'matched' ? <Check size={14} /> :
                       item.status === 'divergent' ? <AlertTriangle size={14} /> :
                       <Scale size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.description || '(sem descrição)'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {item.date} {item.confidence ? `· ${item.confidence}% match` : ''}
                        {matchedTx && ` · → ${matchedTx.description}`}
                      </p>
                    </div>
                    <p className={cn(
                      'text-sm font-bold shrink-0',
                      item.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    )}>
                      {item.amount >= 0 ? '+' : ''}{formatCurrency(item.amount)}
                    </p>
                    {item.status !== 'matched' && item.status !== 'ignored' && (
                      <button
                        onClick={() => handleIgnore(realIdx)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 transition-colors"
                        title="Ignorar"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => { setItems([]); setEntries([]); setFileName(''); setSaved(false); }}
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              ← Nova importação
            </button>
            <button
              onClick={handleSaveReconciliation}
              disabled={isSaving || saved}
              className={cn(
                'px-5 py-2.5 text-sm font-medium rounded-xl transition-colors flex items-center gap-2',
                saved
                  ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white'
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
