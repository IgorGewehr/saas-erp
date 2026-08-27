'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  CloudDownload,
  FileCheck2,
  FileText,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import {
  getPurchaseFiscalSnapshot,
  runPurchaseFiscalAction,
} from '@/lib/services/purchase-import-client';
import type { PreparedPurchaseNote } from '@/lib/services/purchase-import-admin';
import type {
  PurchaseFiscalInboxItem,
  PurchaseFiscalSnapshot,
} from '@/lib/services/purchase-fiscal-sync-admin';

export default function PurchaseFiscalInboxDialog(props: {
  businessId: string;
  onClose: () => void;
  onManualUpload: () => void;
  onPrepared: (note: PreparedPurchaseNote) => void;
  onOpenNote: (noteId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<PurchaseFiscalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getPurchaseFiscalSnapshot(props.businessId)
      .then((value) => { if (active) setSnapshot(value); })
      .catch((cause: Error) => toast.error(cause.message))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [props.businessId]);

  async function run(action: 'sync' | 'hydrate' | 'prepare', item?: PurchaseFiscalInboxItem) {
    const key = item ? `${action}:${item.id}` : action;
    setActionKey(key);
    try {
      const result = await runPurchaseFiscalAction(action === 'sync'
        ? { businessId: props.businessId, action, maxPages: 3 }
        : { businessId: props.businessId, action, inboxId: item!.id });
      setSnapshot(result.snapshot);
      if (action === 'sync') {
        const operation = result.operation as { discovered?: number; hasMore?: boolean } | undefined;
        toast.success(`${operation?.discovered ?? 0} novo(s) documento(s) recebido(s).${operation?.hasMore ? ' Há mais páginas para sincronizar.' : ''}`);
      } else if (action === 'hydrate') {
        toast.success('XML completo disponível para preparação.');
      } else if (result.note) {
        toast.success('Compra preparada sem movimentar estoque ou financeiro.');
        props.onPrepared(result.note);
      }
    } catch (cause) {
      toast.error((cause as Error).message);
    } finally {
      setActionKey(null);
    }
  }

  const capabilities = snapshot?.diagnostics.capabilities;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900"
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
              <ShieldCheck className="h-5 w-5 text-red-500" /> Caixa de entrada fiscal
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Receba NF-e destinadas ao CNPJ. Nada entra no estoque ou financeiro automaticamente.
            </p>
          </div>
          <button onClick={props.onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
              <RefreshCw className="h-4 w-4 animate-spin" /> Carregando diagnóstico fiscal...
            </div>
          ) : !snapshot ? (
            <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">Não foi possível carregar a caixa fiscal.</div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  {snapshot.diagnostics.issues.map((issue, index) => (
                    <div key={`${issue.code}:${index}`} className={cn(
                      'flex gap-2 rounded-xl px-3 py-2.5 text-sm',
                      issue.severity === 'error' && 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
                      issue.severity === 'warning' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
                      issue.severity === 'info' && 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
                    )}>
                      {issue.severity === 'info' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
                <div className="flex min-w-52 flex-col gap-2">
                  <button
                    onClick={() => run('sync')}
                    disabled={!snapshot.diagnostics.canSync || actionKey !== null}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={cn('h-4 w-4', actionKey === 'sync' && 'animate-spin')} />
                    Sincronizar SEFAZ
                  </button>
                  <button onClick={props.onManualUpload} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                    <Upload className="h-4 w-4" /> Importar XML manualmente
                  </button>
                  <p className="text-center text-[11px] text-gray-400">
                    NSU {snapshot.state.ultimoNsu}{snapshot.state.hasMore ? ' · há mais páginas' : ''}
                  </p>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Documentos recebidos</h3>
                  <span className="text-xs text-gray-400">{snapshot.inbox.length} documento(s)</span>
                </div>
                {snapshot.inbox.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center dark:border-gray-700">
                    <FileText className="mx-auto mb-2 h-6 w-6 text-gray-400" />
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Nenhum documento na caixa fiscal</p>
                    <p className="mt-1 text-xs text-gray-400">Sincronize ou continue usando o upload manual.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {snapshot.inbox.map((item) => {
                      const hydrateKey = `hydrate:${item.id}`;
                      const prepareKey = `prepare:${item.id}`;
                      return (
                        <div key={item.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.issuerName || 'Emitente não informado'}</p>
                                <span className={cn(
                                  'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                  item.status === 'prepared' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' :
                                    item.xmlStatus === 'available' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' :
                                      'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
                                )}>
                                  {item.status === 'prepared' ? 'Compra preparada' : item.xmlStatus === 'available' ? 'XML disponível' : 'Resumo recebido'}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-gray-500">
                                NF-e {item.numero || '—'}/{item.serie || '—'} · {item.issueDate ? formatDate(item.issueDate) : 'data não informada'}
                                {item.totalValue !== undefined ? ` · ${formatCurrency(item.totalValue)}` : ''}
                              </p>
                              <p className="mt-1 truncate font-mono text-[10px] text-gray-400">{item.accessKey}</p>
                              {item.lastError && <p className="mt-1 text-xs text-red-500">{item.lastError} Você também pode solicitar o XML ao fornecedor.</p>}
                            </div>
                            <div className="shrink-0">
                              {item.status === 'prepared' && item.purchaseNoteId ? (
                                <button onClick={() => props.onOpenNote(item.purchaseNoteId!)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                                  <FileCheck2 className="h-4 w-4" /> Abrir compra
                                </button>
                              ) : item.xmlStatus === 'available' ? (
                                <button onClick={() => run('prepare', item)} disabled={actionKey !== null} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                                  <FileCheck2 className={cn('h-4 w-4', actionKey === prepareKey && 'animate-pulse')} /> Preparar compra
                                </button>
                              ) : capabilities?.manifestation && capabilities.download ? (
                                <button onClick={() => run('hydrate', item)} disabled={actionKey !== null} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                                  <CloudDownload className={cn('h-4 w-4', actionKey === hydrateKey && 'animate-bounce')} /> Manifestar e baixar
                                </button>
                              ) : (
                                <button onClick={props.onManualUpload} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                                  <Upload className="h-4 w-4" /> Enviar XML
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
