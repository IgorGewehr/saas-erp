'use client';

/**
 * Client agent memory inspector (LGPD-friendly).
 *
 * Shows the structured facts the AI agent has gathered about a specific client
 * across conversations. Lets admins/managers:
 *   - See what the agent "remembers" (preferences, allergies, patterns)
 *   - Remove a single fact (e.g. outdated)
 *   - Clear all memory (LGPD "right to be forgotten")
 *
 * The agent continues to work without memory — it just loses the cross-
 * conversation personalization.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getAuth } from 'firebase/auth';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { Brain, Trash2, AlertTriangle, RefreshCw, ShieldCheck, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'react-toastify';

interface MemoryFact {
  id: string;
  text: string;
  evidence?: string;
  confidence: number;
  validUntil?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

interface Props {
  contactId: string;
  contactName?: string;
}

export default function ClientAgentMemoryPanel({ contactId, contactName }: Props) {
  const { user } = useAuth();
  const canManage = user && ['founder', 'admin', 'manager'].includes(user.role || 'viewer');
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [busyFactId, setBusyFactId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error('sem autenticação');
      const res = await fetch(`/api/agent/memory/admin?contactId=${encodeURIComponent(contactId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFacts(data.data.facts || []);
    } catch (err) {
      console.warn('[agentMemory] load failed', err);
      setFacts([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const removeFact = async (factId: string) => {
    setBusyFactId(factId);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(
        `/api/agent/memory/admin?contactId=${encodeURIComponent(contactId)}&factId=${encodeURIComponent(factId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFacts((prev) => prev.filter((f) => f.id !== factId));
      toast.success('Fato removido');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao remover');
    } finally {
      setBusyFactId(null);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/agent/memory/admin?contactId=${encodeURIComponent(contactId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFacts([]);
      setConfirmClearOpen(false);
      toast.success('Memória do agente limpa');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao limpar');
    } finally {
      setClearing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-3">
        <Loader2 className="w-3 h-3 animate-spin" />
        Carregando memória do agente...
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-500" />
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Memória do agente</h4>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium">
            {facts.length} {facts.length === 1 ? 'fato' : 'fatos'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={load}
            disabled={isLoading}
            className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Recarregar"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          {canManage && facts.length > 0 && (
            <button
              onClick={() => setConfirmClearOpen(true)}
              className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              title="Limpar memória (LGPD)"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {facts.length === 0 ? (
        <div className="text-xs text-gray-400 italic py-2">
          O agente ainda não guardou nenhum fato sobre {contactName || 'este cliente'}.
        </div>
      ) : (
        <ul className="space-y-1.5">
          <AnimatePresence initial={false}>
            {facts.map((fact) => (
              <motion.li
                key={fact.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6, height: 0 }}
                transition={{ duration: 0.15 }}
                className="group flex items-start gap-2 p-2 rounded-lg bg-violet-50/40 dark:bg-violet-950/20 border border-violet-200/50 dark:border-violet-900/30"
              >
                <ShieldCheck className={cn('w-3 h-3 mt-0.5 flex-shrink-0', confidenceColor(fact.confidence))} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-900 dark:text-gray-100">{fact.text}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                    <span>conf. {Math.round(fact.confidence * 100)}%</span>
                    {fact.evidence && <span className="truncate">· {fact.evidence}</span>}
                    <span>· {timeSince(fact.updatedAt)}</span>
                  </div>
                </div>
                {canManage && (
                  <button
                    onClick={() => removeFact(fact.id)}
                    disabled={busyFactId === fact.id}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-500/20 text-gray-400 hover:text-red-600 transition-all"
                    title="Remover este fato"
                  >
                    {busyFactId === fact.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {/* Confirm clear modal */}
      <AnimatePresence>
        {confirmClearOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => !clearing && setConfirmClearOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-5 max-w-md w-full"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Limpar memória do agente?</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Vai remover {facts.length} {facts.length === 1 ? 'fato guardado' : 'fatos guardados'} sobre este contato.
                    O agente segue funcionando normalmente, mas perde a personalização acumulada.
                    Operação irreversível — útil para LGPD.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setConfirmClearOpen(false)}
                  disabled={clearing}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={clearAll}
                  disabled={clearing}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {clearing && <Loader2 className="w-3 h-3 animate-spin" />}
                  {clearing ? 'Limpando...' : 'Limpar tudo'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return 'text-emerald-500';
  if (c >= 0.5) return 'text-amber-500';
  return 'text-gray-400';
}

function timeSince(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days > 30) return `${Math.floor(days / 30)}m atrás`;
    if (days > 0) return `${days}d atrás`;
    const hours = Math.floor(diff / 3_600_000);
    if (hours > 0) return `${hours}h atrás`;
    const mins = Math.floor(diff / 60_000);
    return mins > 1 ? `${mins}min atrás` : 'agora';
  } catch {
    return '';
  }
}
