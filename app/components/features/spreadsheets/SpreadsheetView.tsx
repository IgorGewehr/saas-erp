'use client';

/**
 * SpreadsheetView — visualização tipo planilha SOBRE uma coleção existente
 * (clients/products/transactions). Read-only no MVP.
 *
 * Comportamento:
 *  1. Subscribe à coleção source (onSnapshot, multi-tenant filter).
 *  2. Constrói IWorkbookData via view-adapter.
 *  3. Re-renderiza quando docs mudam — força um remount do editor (key=docs.length)
 *     pra que o snapshot novo seja recarregado. Não é tão eficiente quanto
 *     atualizar células in-place, mas Univer não expõe API estável pra isso
 *     ainda — refinar quando precisar (volume típico < 500 docs cobre via remount).
 *
 * Uso típico: aberto via modal ou aba dentro de cada módulo
 * (ClientsModule, InventoryModule, FinancialModule).
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { collection, onSnapshot, query, where, orderBy, limit as fLimit } from 'firebase/firestore';
import { Loader2, Download, FileSpreadsheet, X } from 'lucide-react';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { buildWorkbookFromCollection, getCollectionLabel } from './view-adapter';
import type { SpreadsheetSourceCollection, SpreadsheetViewConfig } from '@/lib/types';

const SpreadsheetEditor = dynamic(() => import('./SpreadsheetEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-6 h-6 animate-spin text-red-500" />
    </div>
  ),
});

interface SpreadsheetViewProps {
  collection: SpreadsheetSourceCollection;
  config?: Partial<SpreadsheetViewConfig>;
  /** Quando passado, renderiza um botão de fechar no header. */
  onClose?: () => void;
}

const DEFAULT_LIMIT = 500;

export default function SpreadsheetView({ collection: collectionName, config, onClose }: SpreadsheetViewProps) {
  const { business } = useAuth();
  const [docs, setDocs] = useState<Array<Record<string, unknown> & { id: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Counter incrementado a cada snapshot — usado como `key` do editor pra
  // forçar remount quando os dados mudam. Só `docs.length` não bastava
  // (50 docs antes / 50 depois com conteúdo trocado não dispararia remount).
  const [snapshotVersion, setSnapshotVersion] = useState(0);

  // ─── Subscribe ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!business?.id) { setIsLoading(false); return; }
    setIsLoading(true);

    // Query base: businessId + ordering. Filtros adicionais do config são
    // aplicados client-side (compositem index seria caro pra cobrir todo
    // combinator). Limit protege contra views gigantes.
    const sortKey = config?.sort?.field || 'createdAt';
    const sortDir = config?.sort?.direction || 'desc';
    const max = config?.limit ?? DEFAULT_LIMIT;

    const q = query(
      collection(db, collectionName),
      where('businessId', '==', business.id),
      orderBy(sortKey, sortDir),
      fLimit(max),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        let list = snap.docs.map(d => ({ ...d.data(), id: d.id } as Record<string, unknown> & { id: string }));

        // Aplicar filtros client-side (subset operacional do filtering nativo).
        if (config?.filters && config.filters.length > 0) {
          list = list.filter(doc =>
            config.filters!.every(f => {
              const v = doc[f.field];
              switch (f.op) {
                case '==': return v === f.value;
                case '!=': return v !== f.value;
                case '>':  return typeof v === 'number' && v > Number(f.value);
                case '<':  return typeof v === 'number' && v < Number(f.value);
                case '>=': return typeof v === 'number' && v >= Number(f.value);
                case '<=': return typeof v === 'number' && v <= Number(f.value);
                default:   return true;
              }
            })
          );
        }

        setDocs(list);
        setSnapshotVersion(v => v + 1);
        setIsLoading(false);
      },
      (err) => {
        console.error(`[SpreadsheetView:${collectionName}] snapshot error:`, err);
        setError(err.message || 'Erro ao carregar dados');
        setIsLoading(false);
      },
    );
    return () => unsub();
  }, [business?.id, collectionName, config]);

  // ─── Snapshot do workbook ───────────────────────────────────────────────────
  const snapshot = useMemo(
    () => buildWorkbookFromCollection({
      collection: collectionName,
      docs,
      columns: config?.columns,
    }),
    [docs, collectionName, config?.columns],
  );

  // Key força remount do editor a cada snapshot do Firestore. Custo:
  // perder scroll/seleção do user. Aceito pra view-only — refinar pra
  // patching in-place fica pra fase posterior se virar UX issue.
  const editorKey = `${collectionName}-${snapshotVersion}`;

  // ─── Export XLSX ────────────────────────────────────────────────────────────
  // Implementação básica: gera CSV inline e dispara download. .xlsx real
  // exigiria @univerjs/preset-sheets-advanced (importer XLSX) — deixar pra
  // fase 3 se cliente pedir.
  const handleExportCsv = () => {
    if (docs.length === 0) return;
    const sheets = (snapshot.sheets as Record<string, unknown>);
    const firstSheet = sheets[Object.keys(sheets)[0]] as { cellData: Record<number, Record<number, { v: unknown }>> };
    const cells = firstSheet.cellData;
    const rowIdxs = Object.keys(cells).map(Number).sort((a, b) => a - b);
    const lines: string[] = [];
    for (const r of rowIdxs) {
      const row = cells[r];
      const colIdxs = Object.keys(row).map(Number).sort((a, b) => a - b);
      const cells_ = colIdxs.map(c => {
        const v = row[c]?.v ?? '';
        const s = String(v ?? '');
        // Escape CSV: aspas duplas + envolver se tiver vírgula/aspas/quebra
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      });
      lines.push(cells_.join(','));
    }
    const csv = lines.join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getCollectionLabel(collectionName).toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700/50">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {getCollectionLabel(collectionName)} — visualização tabular
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {isLoading ? 'Carregando...' : `${docs.length} ${docs.length === 1 ? 'registro' : 'registros'} · somente leitura`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={docs.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Exportar como CSV (Excel abre direto)"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
              title="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Editor / states */}
      <div className="flex-1 min-h-0 relative">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full p-4">
            <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">Erro ao carregar dados</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md text-center">{error}</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-red-500" />
          </div>
        ) : (
          <SpreadsheetEditor key={editorKey} snapshot={snapshot} readOnly />
        )}
      </div>
    </div>
  );
}
