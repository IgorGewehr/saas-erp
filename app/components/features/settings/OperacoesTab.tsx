'use client';

/**
 * OperacoesTab — Operações comerciais travadas (M02.8/M02.9).
 *
 * `commercialOperations` (checkpoints do coordenador M02.2 — cotação, estoque,
 * benefícios, documento) é Admin-SDK-only pra leitura E escrita
 * (`firestore.rules`: `allow read, write: if false`) — por isso esta tela
 * consome `GET /api/admin/commercial-operations/stuck` em vez de ler
 * Firestore direto como AuditoriaTab.tsx faz com as coleções soft-delete.
 *
 * Read-only de propósito: retomada (replay do mesmo idempotencyKey pelo
 * canal de origem) e compensação manual continuam procedimento guiado,
 * documentado em docs/paridade/M02_RUNBOOK_OPERACOES.md — um botão de ação
 * aqui exigiria desenho próprio de segurança (qual efeito reexecutar) fora
 * do escopo deste painel.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/utils/format';
import type { StuckCommercialOperationSummary } from '@/lib/services/m02-commercial-audit';

const SOURCE_TYPE_LABEL: Record<string, string> = {
  sale: 'Venda (PDV)',
  deliveryOrder: 'Pedido (Delivery/Cardápio)',
  order: 'Pedido B2B/condicional',
};

const CHECKPOINT_LABEL: Record<string, string> = {
  input_validated: 'Entrada validada',
  benefits_reserved: 'Benefícios reservados',
  stock_applied: 'Estoque aplicado',
  document_persisted: 'Documento persistido',
  downstream_reconciled: 'Financeiro reconciliado',
  event_enqueued: 'Evento registrado',
};

export function OperacoesTab() {
  const { firebaseUser } = useAuth();
  const [operations, setOperations] = useState<StuckCommercialOperationSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/admin/commercial-operations/stuck', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Falha ao carregar operações');
      }
      setOperations(payload.operations as StuckCommercialOperationSummary[]);
    } catch (err) {
      console.error('[Operações] load failed:', err);
      setError(err instanceof Error ? err.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/5 border border-amber-200/60 dark:border-amber-500/20 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-900 flex items-center justify-center shadow-sm flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-0.5">Operações comerciais travadas</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              Checkouts (venda, pedido, delivery) que pararam no meio do caminho e não têm ninguém
              processando agora. Ver <strong>Runbook de operações</strong> pra decidir entre retomar
              ou compensar manualmente.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {operations !== null && `${operations.length} operação${operations.length === 1 ? '' : 'ões'} travada${operations.length === 1 ? '' : 's'}`}
        </p>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04] disabled:opacity-40 transition-colors"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Atualizar
        </button>
      </div>

      {error ? (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      ) : loading && operations === null ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : !operations || operations.length === 0 ? (
        <div className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-gray-800 rounded-2xl p-12 text-center">
          <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Nenhuma operação travada</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Todo checkout em andamento está sendo processado ou já concluiu.
          </p>
        </div>
      ) : (
        <ul className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
          {operations.map((op) => (
            <li key={op.operationId} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50/60 dark:hover:bg-white/[0.02]">
              <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 font-mono truncate">{op.operationId}</p>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 uppercase tracking-wider flex-shrink-0">
                    {SOURCE_TYPE_LABEL[op.sourceType] ?? op.sourceType}
                  </span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 uppercase tracking-wider flex-shrink-0">
                    {op.status}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {op.currentCheckpoint
                    ? `Parou em: ${CHECKPOINT_LABEL[op.currentCheckpoint] ?? op.currentCheckpoint}`
                    : 'Ainda não iniciou nenhum checkpoint'}
                  {' · '}{op.attempts} tentativa{op.attempts === 1 ? '' : 's'}
                  {op.updatedAt ? ` · atualizado ${formatDateTime(op.updatedAt)}` : ''}
                </p>
                {op.lastError?.message && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 truncate" title={op.lastError.message}>
                    {op.lastError.code ? `[${op.lastError.code}] ` : ''}{op.lastError.message}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}
