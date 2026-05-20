'use client';

/**
 * AuditoriaTab — Lixeira de soft-delete.
 *
 * Lista docs Tier 3 soft-deletados nos ultimos 30 dias, agrupados por colecao
 * (clients + conversations hoje; expandir conforme Fase 4 adicionar
 * kanbanBoards/services/channelConnections).
 *
 * Acoes:
 *   - Restaurar (admin+): limpa campos de soft-delete via restoreDoc()
 *   - Purgar permanentemente (founder only): hard-delete + log de auditoria
 *
 * Tudo gera entry em crmAuditLog pra trilha imutavel.
 *
 * Decisao: query Firestore usa `where('deletedAt', '>=', cutoff30d)` direto
 * — precisa de indice composto `businessId + deletedAt` em cada colecao
 * incluida (firestore.indexes.json). Sem o indice, Firestore retorna erro
 * direcionado pra criar via console.
 *
 * Ver docs/soft-delete-strategy.md §5 Fase 3.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { collection, query, where, getDocs, deleteDoc, addDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { restoreDoc } from '@/lib/services/softDelete';
import { ROLE_HIERARCHY } from '@/lib/types';
import { Trash2, RotateCcw, Inbox, AlertCircle, Users, MessageCircle, Loader2, Plug2, Briefcase } from 'lucide-react';
import { toast } from 'react-toastify';
import { formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils';

const RETENTION_DAYS = 30;

type CollectionKey = 'clients' | 'conversations' | 'channelConnections' | 'services';

interface DeletedRecord {
  id: string;
  collection: CollectionKey;
  name: string;
  deletedAt: string;
  deletedByName?: string;
}

const COLLECTION_LABEL: Record<CollectionKey, string> = {
  clients: 'Cliente',
  conversations: 'Conversa',
  channelConnections: 'Canal',
  services: 'Serviço',
};

const COLLECTION_ICON: Record<CollectionKey, React.ReactNode> = {
  clients: <Users className="w-4 h-4" />,
  conversations: <MessageCircle className="w-4 h-4" />,
  channelConnections: <Plug2 className="w-4 h-4" />,
  services: <Briefcase className="w-4 h-4" />,
};

async function fetchDeletedDocs(
  businessId: string,
  col: CollectionKey,
  cutoff: string,
  nameKey: (data: Record<string, unknown>) => string,
): Promise<DeletedRecord[]> {
  try {
    const snap = await getDocs(query(
      collection(db, col),
      where('businessId', '==', businessId),
      where('deletedAt', '>=', cutoff),
    ));
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        collection: col,
        name: nameKey(data),
        deletedAt: (data.deletedAt as string) || '',
        deletedByName: (data.deletedByName as string | undefined) || undefined,
      };
    });
  } catch (err) {
    console.warn(`[Auditoria] fetch ${col} failed:`, err);
    return [];
  }
}

export function AuditoriaTab() {
  const { user, business } = useAuth();
  const [records, setRecords] = useState<DeletedRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [colFilter, setColFilter] = useState<'all' | CollectionKey>('all');
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  const canRestore = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];
  const canPurge = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['founder'];

  const loadRecords = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
    const [clientsRecs, convsRecs, channelsRecs, servicesRecs] = await Promise.all([
      fetchDeletedDocs(
        business.id,
        'clients',
        cutoff,
        (data) => (data.name as string) || '(cliente sem nome)',
      ),
      fetchDeletedDocs(
        business.id,
        'conversations',
        cutoff,
        (data) => (data.customContactName as string) || (data.contactName as string) || (data.contactPhone as string) || '(conversa sem contato)',
      ),
      fetchDeletedDocs(
        business.id,
        'channelConnections',
        cutoff,
        (data) => {
          const dn = (data.displayName as string) || '';
          const tp = (data.type as string) || '';
          return dn ? `${dn} (${tp})` : `(canal ${tp || 'desconhecido'})`;
        },
      ),
      fetchDeletedDocs(
        business.id,
        'services',
        cutoff,
        (data) => (data.name as string) || '(serviço sem nome)',
      ),
    ]);
    const all = [...clientsRecs, ...convsRecs, ...channelsRecs, ...servicesRecs].sort((a, b) =>
      (b.deletedAt || '').localeCompare(a.deletedAt || ''),
    );
    setRecords(all);
    setLoading(false);
  }, [business?.id]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const filtered = useMemo(() => {
    if (colFilter === 'all') return records;
    return records.filter(r => r.collection === colFilter);
  }, [records, colFilter]);

  const counts = useMemo(() => ({
    all: records.length,
    clients: records.filter(r => r.collection === 'clients').length,
    conversations: records.filter(r => r.collection === 'conversations').length,
    channelConnections: records.filter(r => r.collection === 'channelConnections').length,
    services: records.filter(r => r.collection === 'services').length,
  }), [records]);

  const logAudit = useCallback(async (action: 'record_restored' | 'record_purged', rec: DeletedRecord) => {
    if (!business?.id || !user?.uid) return;
    try {
      await addDoc(collection(db, 'crmAuditLog'), {
        businessId: business.id,
        userId: user.uid,
        userName: user.name || user.uid,
        action,
        details: JSON.stringify({ collection: rec.collection, id: rec.id, name: rec.name }),
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      // Audit failure nao deve bloquear a acao principal
      console.warn('[Auditoria] audit log failed:', err);
    }
  }, [business?.id, user?.uid, user?.name]);

  const handleRestore = async (rec: DeletedRecord) => {
    if (!canRestore || !user?.uid) {
      toast.error('Apenas admin ou founder pode restaurar.');
      return;
    }
    setActionInFlight(rec.id);
    try {
      await restoreDoc(doc(db, rec.collection, rec.id));
      await logAudit('record_restored', rec);
      setRecords(prev => prev.filter(r => r.id !== rec.id));
      toast.success(`${COLLECTION_LABEL[rec.collection]} "${rec.name}" restaurado`);
    } catch (err) {
      console.error('[Auditoria] restore failed:', err);
      toast.error('Erro ao restaurar');
    } finally {
      setActionInFlight(null);
    }
  };

  const handlePurge = async (rec: DeletedRecord) => {
    if (!canPurge || !user?.uid) {
      toast.error('Apenas founder pode purgar permanentemente.');
      return;
    }
    if (!window.confirm(
      `Purgar PERMANENTEMENTE "${rec.name}"?\n\n` +
      `Esta operação é IRREVERSÍVEL. O registro será removido do banco.\n` +
      `Mensagens, vendas e outras referências históricas serão preservadas mas vão mostrar "[Excluído]".`,
    )) return;
    setActionInFlight(rec.id);
    try {
      await deleteDoc(doc(db, rec.collection, rec.id));
      await logAudit('record_purged', rec);
      setRecords(prev => prev.filter(r => r.id !== rec.id));
      toast.success(`"${rec.name}" purgado permanentemente`);
    } catch (err) {
      console.error('[Auditoria] purge failed:', err);
      toast.error('Erro ao purgar');
    } finally {
      setActionInFlight(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="bg-gradient-to-br from-rose-50 to-red-50 dark:from-rose-500/10 dark:to-red-500/5 border border-rose-200/60 dark:border-rose-500/20 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-gray-900 flex items-center justify-center shadow-sm flex-shrink-0">
            <Trash2 className="w-5 h-5 text-rose-500" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-0.5">Lixeira</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              Clientes e conversas soft-deletados nos últimos <strong>{RETENTION_DAYS} dias</strong>.
              Restaure pra reverter ou purgue permanentemente (founder only — LGPD).
            </p>
          </div>
        </div>
      </div>

      {/* Filtros de coleção */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { id: 'all',                label: 'Todos',     count: counts.all },
          { id: 'clients',            label: 'Clientes',  count: counts.clients },
          { id: 'conversations',      label: 'Conversas', count: counts.conversations },
          { id: 'channelConnections', label: 'Canais',    count: counts.channelConnections },
          { id: 'services',           label: 'Serviços',  count: counts.services },
        ] as const).map(opt => (
          <button
            key={opt.id}
            onClick={() => setColFilter(opt.id)}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors',
              colFilter === opt.id
                ? 'border-rose-500 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04]',
            )}
          >
            {opt.label}
            <span className={cn(
              'px-1.5 py-0.5 rounded-full text-[10px] tabular-nums',
              colFilter === opt.id
                ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
            )}>{opt.count}</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-gray-800 rounded-2xl p-12 text-center">
          <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Lixeira vazia</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Nenhum registro soft-deletado nos últimos {RETENTION_DAYS} dias.
          </p>
        </div>
      ) : (
        <ul className="bg-white dark:bg-white/[0.02] border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
          {filtered.map(rec => {
            const isBusy = actionInFlight === rec.id;
            return (
              <li key={`${rec.collection}-${rec.id}`} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50/60 dark:hover:bg-white/[0.02]">
                <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-white/[0.04] flex items-center justify-center text-gray-500 dark:text-gray-400 flex-shrink-0">
                  {COLLECTION_ICON[rec.collection]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{rec.name}</p>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 uppercase tracking-wider flex-shrink-0">
                      {COLLECTION_LABEL[rec.collection]}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                    Excluído {formatDate(rec.deletedAt)}
                    {rec.deletedByName ? ` por ${rec.deletedByName}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleRestore(rec)}
                    disabled={isBusy || !canRestore}
                    title={canRestore ? 'Restaurar' : 'Apenas admin/founder'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    Restaurar
                  </button>
                  <button
                    onClick={() => handlePurge(rec)}
                    disabled={isBusy || !canPurge}
                    title={canPurge ? 'Purgar permanentemente' : 'Apenas founder'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Footer com hint sobre purga */}
      {!canPurge && filtered.length > 0 && (
        <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Apenas o <strong>founder</strong> pode purgar registros permanentemente.
            Após {RETENTION_DAYS} dias na lixeira, registros são purgados automaticamente por LGPD.
          </p>
        </div>
      )}
    </motion.div>
  );
}
