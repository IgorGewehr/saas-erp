'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Plus, Search, Filter, X, Edit2, Trash2,
  Building2, CheckCircle2, Tag,
  TrendingUp, ShoppingCart, Star,
  Upload, UserCheck, Gift,
  FileDown, Settings, Plus as PlusIcon, Trophy, LayoutList, AlignJustify,
  Megaphone, MessageSquare, CheckSquare, FileSpreadsheet,
} from 'lucide-react';
import { collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, limit as firestoreLimit, writeBatch, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { useAppContext } from '@/app/app/AppContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { isActiveClient } from '@/lib/utils/clientFilters';
import { cn } from '@/lib/utils';
import type { Client, ClientDuplicateIgnore, LeadStatus, LoyaltyConfig, LoyaltyTier } from '@/lib/types';
import {
  subscribeClientDuplicateIgnores,
  addClientDuplicateIgnore,
  removeClientDuplicateIgnore,
  pairKeyOf,
} from '@/lib/services/clientDuplicateIgnores';
import { DEFAULT_LOYALTY_TIERS } from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';
import { toast } from 'react-toastify';
import { ClientTableView, type ClientSortField, type ClientSortDir } from './ClientTableView';
// Modais, form e detalhe: extraídos pra arquivos próprios nas Fases 1a/1b
// da modularização. ClientFormData vem do ClientForm pra que a mutationFn
// que persiste o cliente não precise re-declarar o shape do payload.
import { ClientEditDialog } from './ClientEditDialog';
import {
} from '@/app/components/ui/dialog';
import { ExportModal } from './ExportModal';
import { ImportModal } from './ImportModal';
import { ClientDetailPanel } from './detail/ClientDetailPanel';
import dynamicImport from 'next/dynamic';
const SpreadsheetView = dynamicImport(() => import('@/app/components/features/spreadsheets/SpreadsheetView'), { ssr: false });
// Constantes/helpers compartilhados — usados aqui (lista, filtros) e nos
// componentes extraídos. Ficam num ponto único pra rótulos/cores baterem.
import { STATUS_CONFIG, SOURCE_LABELS, TIPO_LABELS } from './shared/constants';
import { CHURN_CFG, getChurnLevel, type ChurnRiskLevel } from './shared/health';
import { digits, normEmail } from './shared/duplicates';
import { mergeClients } from './shared/mergeClients';
import { HealthBadge } from './shared/HealthBadge';
import { TierBadge } from './shared/loyalty';
import { OffersManagerModal } from './offers/OffersManagerModal';


// ─── Mapa de extrações (Fases 1a + 1b) ──────────────────────────────────────
// Refatoração reduziu este módulo de 3831 → ~1700 linhas. Componentes/helpers
// movidos para arquivos próprios pra abrir caminho pras tabs novas
// (Canais em Fase 2, Campanhas em Fase 3) plugarem no detail/ sem inflar
// este orquestrador:
//
//   Fase 1a (modais e form):
//     - ClientForm + ClientFormData + emptyForm + TagEditor   → ./ClientForm.tsx
//     - ExportModal + EXPORT_COLUMNS + downloadCSV            → ./ExportModal.tsx
//     - ImportModal + parsers de CSV (autoMap, normalize*)    → ./ImportModal.tsx
//
//   Fase 1b (detalhe + helpers compartilhados):
//     - ClientDetailPanel (shell + tabs Perfil/Timeline)      → ./detail/ClientDetailPanel.tsx
//     - ClientTimeline + TL_CFG + tlRelative                  → ./detail/ClientTimeline.tsx
//     - ScoresSection (gauge + barras de saúde)               → ./detail/ScoresSection.tsx
//     - PointsAdjustModal (ajuste manual de pontos)           → ./detail/PointsAdjustModal.tsx
//     - LoyaltyHistorySection + HISTORY_TYPE_CFG              → ./detail/LoyaltyHistorySection.tsx
//     - HealthBadge (usado em lista E detalhe)                → ./shared/HealthBadge.tsx
//     - TierBadge + getClientTier (usado em lista E detalhe)  → ./shared/loyalty.tsx
//
//   Helpers/constantes (usados nos extraídos + neste arquivo):
//     - findDuplicate + helpers de telefone BR                → ./shared/duplicates.ts
//     - STATUS_CONFIG, SOURCE_LABELS, TIPO_LABELS             → ./shared/constants.ts
//     - CHURN_CFG, getChurnLevel, getOverallColor             → ./shared/health.ts

// ─── Merge duplicates ────────────────────────────────────────────────────────

function detectDuplicates(clients: Client[]): [Client, Client][] {
  const active = clients.filter(isActiveClient);
  const pairs: [Client, Client][] = [];
  const seen = new Set<string>();

  const addPair = (a: Client, b: Client) => {
    const key = [a.id, b.id].sort().join('|');
    if (!seen.has(key)) { seen.add(key); pairs.push([a, b]); }
  };

  const byCpf  = new Map<string, Client[]>();
  const byMail = new Map<string, Client[]>();
  const byPhone = new Map<string, Client[]>();

  for (const c of active) {
    const cpf = digits(c.cpfCnpj);
    if (cpf.length >= 6) { const g = byCpf.get(cpf) ?? []; g.push(c); byCpf.set(cpf, g); }

    const mail = normEmail(c.email);
    if (mail) { const g = byMail.get(mail) ?? []; g.push(c); byMail.set(mail, g); }

    const ph = digits(c.phone || c.whatsapp || '').slice(-8);
    if (ph.length === 8) { const g = byPhone.get(ph) ?? []; g.push(c); byPhone.set(ph, g); }
  }

  for (const group of [...byCpf.values(), ...byMail.values(), ...byPhone.values()]) {
    for (let i = 0; i < group.length - 1; i++)
      for (let j = i + 1; j < group.length; j++)
        addPair(group[i], group[j]);
  }

  return pairs;
}

function MergeModal({
  clients,
  businessId,
  ignores,
  user,
  onClose,
  onDone,
}: {
  clients: Client[];
  businessId: string;
  /** Pares ignorados persistidos no Firestore (subscrição no parent). */
  ignores: ClientDuplicateIgnore[];
  /** Operador autenticado — pra audit field nos ignores. */
  user: { id: string; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const pairs = useMemo(() => detectDuplicates(clients), [clients]);
  // Map<pairKey, doc.id> pra remover pelo ID quando clicar "Desfazer".
  const ignoresByKey = useMemo(() => {
    const m = new Map<string, ClientDuplicateIgnore>();
    for (const ig of ignores) m.set(ig.pairKey, ig);
    return m;
  }, [ignores]);
  const [primaryIds, setPrimaryIds] = useState<Record<string, string>>({});
  const [fillEmpty, setFillEmpty] = useState<Record<string, boolean>>({});
  const [merging, setMerging] = useState<string | null>(null);
  const [merged, setMerged] = useState<Set<string>>(new Set());
  // Estado do batch "Mesclar tudo": progresso atual + total + flag de erro.
  const [batchMerging, setBatchMerging] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [confirmMergeAll, setConfirmMergeAll] = useState(false);
  // UI: mostra lista de pares ignorados (colapsada por default).
  const [showIgnored, setShowIgnored] = useState(false);
  // Optimistic: pares em flight (clicou Ignorar e ainda não voltou via
  // onSnapshot). Some assim que Firestore confirma a inserção.
  const [ignoringInFlight, setIgnoringInFlight] = useState<Set<string>>(new Set());

  const activePairs = pairs.filter(([a, b]) => {
    const key = pairKeyOf(a.id, b.id);
    return !ignoresByKey.has(key) && !merged.has(key) && !ignoringInFlight.has(key);
  });

  // Resolve clients dos pairs ignorados pra exibir nome/email no painel
  // "Desfazer". Se um dos clientes foi deletado (ex: mesclado em outro flow),
  // exibe o ID cru como fallback — operador ainda consegue desfazer pelo doc.id.
  const ignoredPairs = useMemo(() => {
    const byId = new Map(clients.map(c => [c.id, c]));
    return ignores.map(ig => ({
      ignore: ig,
      a: byId.get(ig.clientIdA) ?? null,
      b: byId.get(ig.clientIdB) ?? null,
    }));
  }, [ignores, clients]);

  const pairKey = (a: Client, b: Client) => pairKeyOf(a.id, b.id);

  const handleIgnore = async (a: Client, b: Client) => {
    const key = pairKey(a, b);
    setIgnoringInFlight(prev => new Set([...prev, key]));
    try {
      await addClientDuplicateIgnore({
        businessId,
        clientIdA: a.id,
        clientIdB: b.id,
        user,
      });
    } catch (err) {
      console.error('[Ignore pair] failed:', err);
      toast.error('Não foi possível ignorar o par. Tente novamente.');
    } finally {
      // Mesmo em erro, libera do in-flight; onSnapshot atualiza o estado.
      setIgnoringInFlight(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleUnignore = async (ignoreId: string) => {
    try {
      await removeClientDuplicateIgnore(ignoreId);
    } catch (err) {
      console.error('[Unignore pair] failed:', err);
      toast.error('Não foi possível desfazer. Tente novamente.');
    }
  };

  const handleMerge = async (a: Client, b: Client) => {
    const key = pairKey(a, b);
    const primaryId = primaryIds[key] ?? a.id;
    const primary   = primaryId === a.id ? a : b;
    const secondary = primaryId === a.id ? b : a;
    const fill = fillEmpty[key] ?? true;

    setMerging(key);
    try {
      await mergeClients({ primary, secondary, businessId, fillEmpty: fill });
      setMerged(prev => new Set([...prev, key]));
      onDone();
    } catch (err) {
      console.error('Merge error:', err);
    } finally {
      setMerging(null);
    }
  };

  // Mesclagem em lote: roda handleMerge sequencialmente em todos os pairs
  // ativos. Sequencial (não paralelo) porque mergeClients() faz writeBatch +
  // reassociações em coleções compartilhadas — paralelizar arrisca race em
  // conv/sales/etc. Cada par usa o primary atualmente selecionado (ou default
  // = primeiro do par).
  const handleMergeAll = async () => {
    setConfirmMergeAll(false);
    const pairsToProcess = [...activePairs];
    setBatchMerging({ done: 0, total: pairsToProcess.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < pairsToProcess.length; i++) {
      const [a, b] = pairsToProcess[i];
      try {
        await handleMerge(a, b);
      } catch (err) {
        failed++;
        console.error(`[Merge all] Failed pair ${i + 1}:`, err);
      }
      setBatchMerging({ done: i + 1, total: pairsToProcess.length, failed });
    }
    // Mantém o status visível por 1.2s pra usuário ver o "concluído"
    setTimeout(() => setBatchMerging(null), 1200);
  };

  const ClientCard = ({ client, isPrimary, onSelect }: { client: Client; isPrimary: boolean; onSelect: () => void }) => (
    <div
      onClick={onSelect}
      // `min-w-0` é o que conserta o overflow horizontal: sem ele, flex-1
      // não shrinka abaixo do tamanho intrínseco do conteúdo (nomes longos
      // como "COMERCIO DE ERVA MATE COR E SABOR LTDA" forçavam o card a
      // crescer e cortavam o segundo card no eixo X).
      className={cn(
        'flex-1 min-w-0 rounded-xl p-3 border-2 cursor-pointer transition-all',
        isPrimary
          ? 'border-emerald-400 dark:border-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/5'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
      )}
    >
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {(client.name?.[0] ?? '?').toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{client.name}</p>
          {client.company && <p className="text-[10px] text-gray-400 truncate">{client.company}</p>}
        </div>
        {isPrimary && (
          <span className="ml-auto flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            MANTER
          </span>
        )}
      </div>
      <div className="space-y-0.5 text-[10px] text-gray-500 dark:text-gray-400">
        {client.email  && <p className="truncate">✉ {client.email}</p>}
        {client.phone  && <p className="truncate">📞 {client.phone}</p>}
        {client.cpfCnpj && <p className="truncate">📄 {client.cpfCnpj}</p>}
        {(client.totalSpent ?? 0) > 0 && <p className="text-emerald-600 dark:text-emerald-400 font-medium truncate">💰 {formatCurrency(client.totalSpent ?? 0)}</p>}
        <p className="text-gray-300 dark:text-gray-600 truncate">Cadastro: {formatDate(client.createdAt)}</p>
      </div>
    </div>
  );

  // Portal pra escapar containing block do wrapper de tabs (will-change-transform).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-amber-500" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Duplicatas detectadas</h2>
              <p className="text-[10px] text-gray-400">
                {activePairs.length > 0 ? `${activePairs.length} par${activePairs.length > 1 ? 'es' : ''} encontrado${activePairs.length > 1 ? 's' : ''}` : 'Nenhuma duplicata pendente'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Botão "Mesclar tudo" — só aparece quando há ≥2 pares ativos.
                Mantém o "MANTER" atualmente selecionado em cada par (default
                = primeiro do par, mas usuário pode pré-selecionar antes). */}
            {activePairs.length >= 2 && !batchMerging && (
              <button
                onClick={() => setConfirmMergeAll(true)}
                disabled={!!merging}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mesclar tudo ({activePairs.length})
              </button>
            )}
            {batchMerging && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}>
                  <Star className="w-3 h-3 text-amber-600" />
                </motion.div>
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                  {batchMerging.done}/{batchMerging.total}
                  {batchMerging.failed > 0 && ` (${batchMerging.failed} falha${batchMerging.failed > 1 ? 's' : ''})`}
                </span>
              </div>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Confirmação inline pra "Mesclar tudo" — destrutivo, não dá pra desfazer
            sem restaurar manualmente (soft-delete só reativa o secundário). */}
        {confirmMergeAll && (
          <div className="px-6 py-3 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30 flex items-center justify-between gap-3 flex-shrink-0">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Mesclar todos os {activePairs.length} pares? O card verde "MANTER" de cada par será preservado; o outro será desativado.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setConfirmMergeAll(false)}
                className="px-3 py-1 rounded-lg text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleMergeAll}
                className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {activePairs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Tudo limpo!</p>
              <p className="text-xs text-gray-400 mt-1">Nenhuma duplicata encontrada na base de clientes.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {activePairs.map(([a, b]) => {
                const key = pairKey(a, b);
                const primaryId = primaryIds[key] ?? a.id;
                const fill = fillEmpty[key] ?? true;
                const isMerging = merging === key;

                return (
                  <div key={key} className="p-4 space-y-3">
                    {/* Cards */}
                    <div className="flex gap-2">
                      <ClientCard client={a} isPrimary={primaryId === a.id}
                        onSelect={() => setPrimaryIds(p => ({ ...p, [key]: a.id }))} />
                      <div className="flex items-center flex-shrink-0 text-gray-300 dark:text-gray-600 font-light text-lg">VS</div>
                      <ClientCard client={b} isPrimary={primaryId === b.id}
                        onSelect={() => setPrimaryIds(p => ({ ...p, [key]: b.id }))} />
                    </div>

                    {/* Options */}
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={fill}
                          onChange={e => setFillEmpty(p => ({ ...p, [key]: e.target.checked }))}
                          className="w-3.5 h-3.5 rounded accent-red-500"
                        />
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">
                          Copiar campos vazios + somar totais
                        </span>
                      </label>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleIgnore(a, b)}
                        disabled={!!batchMerging || ignoringInFlight.has(key)}
                        className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                      >
                        {ignoringInFlight.has(key) ? 'Ignorando...' : 'Ignorar este par'}
                      </button>
                      <button
                        onClick={() => handleMerge(a, b)}
                        disabled={isMerging || !!batchMerging}
                        className="flex-1 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {isMerging ? (
                          <>
                            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}>
                              <Star className="w-3 h-3" />
                            </motion.div>
                            Mesclando...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Mesclar — manter {primaryId === a.id ? (a.name ?? '').split(' ')[0] : (b.name ?? '').split(' ')[0]}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Painel "Ignorados" — colapsável. Aparece só se há pares ignorados
            no Firestore. Permite desfazer pra reverter um ignore acidental
            (o par volta a aparecer na lista ativa). */}
        {ignoredPairs.length > 0 && (
          <div className="border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
            <button
              onClick={() => setShowIgnored(v => !v)}
              className="w-full px-6 py-2.5 flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <span>
                {ignoredPairs.length} par{ignoredPairs.length > 1 ? 'es' : ''} ignorado{ignoredPairs.length > 1 ? 's' : ''}
              </span>
              <span className="text-[10px] text-gray-400">{showIgnored ? 'ocultar' : 'mostrar'}</span>
            </button>
            {showIgnored && (
              <div className="max-h-48 overflow-y-auto px-6 pb-2 divide-y divide-gray-100 dark:divide-gray-800/50">
                {ignoredPairs.map(({ ignore, a, b }) => (
                  <div key={ignore.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-gray-700 dark:text-gray-300 truncate">
                        {a?.name ?? `[deletado: ${ignore.clientIdA.slice(0, 8)}…]`}
                        <span className="text-gray-400 mx-1.5">↔</span>
                        {b?.name ?? `[deletado: ${ignore.clientIdB.slice(0, 8)}…]`}
                      </p>
                      <p className="text-[9px] text-gray-400 truncate">
                        Por {ignore.ignoredByName} · {formatDate(ignore.ignoredAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleUnignore(ignore.id)}
                      className="flex-shrink-0 px-2 py-1 rounded-md text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"
                    >
                      Desfazer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0">
          <p className="text-[10px] text-gray-400 text-center">
            Clicar no card verde seleciona qual registro será mantido. O outro é desativado e suas conversas, compras e agendamentos são transferidos.
          </p>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// ─── Loyalty Settings Modal ───────────────────────────────────────────────────

function LoyaltySettingsModal({
  current,
  businessId,
  onClose,
  onSaved,
}: {
  current?: LoyaltyConfig;
  businessId: string;
  onClose: () => void;
  onSaved: (cfg: LoyaltyConfig) => void;
}) {
  const [isEnabled, setIsEnabled] = useState(current?.isEnabled ?? false);
  const [pointsPerReal, setPointsPerReal] = useState(String(current?.pointsPerReal ?? 1));
  const [pointValue, setPointValue] = useState(String(current?.pointValueInCentavos ?? 1));
  const [minRedeem, setMinRedeem] = useState(String(current?.minPointsToRedeem ?? 100));
  const [expireDays, setExpireDays] = useState(String(current?.expirationDays ?? ''));
  const [tiers, setTiers] = useState<LoyaltyTier[]>(current?.tiers ?? DEFAULT_LOYALTY_TIERS);
  const [saving, setSaving] = useState(false);

  const updateTier = (i: number, patch: Partial<LoyaltyTier>) =>
    setTiers(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t));

  const handleSave = async () => {
    setSaving(true);
    const parsePositive = (raw: string, fallback: number, min = 1) =>
      Math.max(min, Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : fallback);
    const cfg: LoyaltyConfig = {
      isEnabled,
      pointsPerReal:        parsePositive(pointsPerReal, 1, 0),
      pointValueInCentavos: parsePositive(pointValue, 1),
      minPointsToRedeem:    parsePositive(minRedeem, 100),
      expirationDays: expireDays && Number.isFinite(Number(expireDays)) && Number(expireDays) > 0
        ? Number(expireDays) : null,
      tiers: tiers.filter(t => t.name.trim()).sort((a, b) => a.minPoints - b.minPoints),
    };
    try {
      await updateDoc(doc(db, 'businesses', businessId), { 'settings.loyalty': cfg, updatedAt: new Date().toISOString() });
      onSaved(cfg);
      onClose();
    } catch (err) {
      console.error('Loyalty settings save error:', err);
    } finally {
      setSaving(false);
    }
  };

  // Portal pra escapar containing block do wrapper de tabs (will-change-transform).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-amber-500" />
            </div>
            <h2 className="font-semibold text-gray-900 dark:text-white text-sm">Programa de Fidelidade</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Enable toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/60 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Ativar programa</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Clientes acumulam e resgatam pontos</p>
            </div>
            <button
              onClick={() => setIsEnabled(v => !v)}
              className={cn('w-11 h-6 rounded-full transition-colors relative', isEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600')}
            >
              <span className={cn('absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform', isEnabled ? 'translate-x-5' : 'translate-x-0.5')} />
            </button>
          </div>

          {/* Rules */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Regras de acúmulo e resgate</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Pontos por R$1 gasto', value: pointsPerReal, set: setPointsPerReal, hint: 'ex: 1' },
                { label: 'Centavos por ponto resgatado', value: pointValue, set: setPointValue, hint: 'ex: 1 = R$0,01/pt' },
                { label: 'Mínimo para resgatar (pts)', value: minRedeem, set: setMinRedeem, hint: 'ex: 100' },
                { label: 'Expiração (dias, vazio = nunca)', value: expireDays, set: setExpireDays, hint: 'ex: 365' },
              ].map(f => (
                <div key={f.label}>
                  <label className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider block mb-1">{f.label}</label>
                  <input
                    type="number"
                    value={f.value}
                    onChange={e => f.set(e.target.value)}
                    placeholder={f.hint}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Tiers */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tiers</p>
              <button
                onClick={() => setTiers(prev => [...prev, { name: '', minPoints: 0, color: '#6366F1', benefits: '' }])}
                className="text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 flex items-center gap-1"
              >
                <PlusIcon className="w-3 h-3" /> Adicionar tier
              </button>
            </div>
            <div className="space-y-2">
              {tiers.map((tier, i) => (
                <div key={i} className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-gray-200 dark:border-gray-700">
                  <input
                    type="color"
                    value={tier.color}
                    onChange={e => updateTier(i, { color: e.target.value })}
                    className="w-7 h-7 rounded-lg border-0 cursor-pointer bg-transparent flex-shrink-0"
                  />
                  <input
                    value={tier.name}
                    onChange={e => updateTier(i, { name: e.target.value })}
                    placeholder="Nome (ex: Ouro)"
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none"
                  />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input
                      type="number"
                      value={tier.minPoints}
                      onChange={e => updateTier(i, { minPoints: Number(e.target.value) })}
                      className="w-20 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none"
                      placeholder="Min pts"
                    />
                    <span className="text-[10px] text-gray-400">pts+</span>
                  </div>
                  <input
                    value={tier.benefits ?? ''}
                    onChange={e => updateTier(i, { benefits: e.target.value })}
                    placeholder="Benefício"
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none"
                  />
                  <button onClick={() => setTiers(prev => prev.filter((_, idx) => idx !== i))} className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar programa'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}




// ─── Main Module ─────────────────────────────────────────────────────────────

export default function ClientsModule() {
  const { business, user } = useAuth();
  const queryClient = useQueryClient();

  // Pares ignorados (persistidos em Firestore). Subscrito em tempo real
  // pra que badge "Duplicatas N" no header e estado do MergeModal fiquem
  // em sincronia entre dispositivos/operadores. Sem isso, ignorar um par
  // num dispositivo continuava a aparecer em outro.
  const [duplicateIgnores, setDuplicateIgnores] = useState<ClientDuplicateIgnore[]>([]);
  useEffect(() => {
    if (!business?.id) return;
    return subscribeClientDuplicateIgnores(business.id, setDuplicateIgnores);
  }, [business?.id]);
  const ignoredPairKeys = useMemo(
    () => new Set(duplicateIgnores.map(ig => ig.pairKey)),
    [duplicateIgnores],
  );

  const [clientsView, setClientsView] = useState<'list' | 'table'>(() => {
    if (typeof window === 'undefined') return 'list';
    return (localStorage.getItem('clients_view') as 'list' | 'table') ?? 'table';
  });
  const handleClientsView = (v: 'list' | 'table') => {
    setClientsView(v);
    localStorage.setItem('clients_view', v);
  };
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState<'all' | 'pf' | 'pj'>('all');
  const [filterStatus, setFilterStatus] = useState<LeadStatus | 'all'>('all');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterChurnRisk, setFilterChurnRisk] = useState<ChurnRiskLevel | 'all'>('all');
  // 'all' = sem filtro; 'this_month' = mês corrente; 'next_month' = próximo;
  // 1-12 = mês específico (1=janeiro, 12=dezembro). Útil pra preparar
  // promoções de aniversário antes de criar a campanha automatizada.
  const [filterBirthMonth, setFilterBirthMonth] = useState<'all' | 'this_month' | 'next_month' | number>('all');
  // Filtros Fase 5 — usam infra das fases 2/3/4:
  //   filterChannel: lê client.channelIdentities (fase 2);
  //   filterAcquisition: lê acquisitionOfferId/ProductId/OfferLabel (fases 4A+4B);
  //   filterCampaign: query broadcastMessages → set de contactIds (fase 3).
  const [filterChannel, setFilterChannel] = useState<'all' | 'whatsapp' | 'facebook' | 'instagram'>('all');
  // Quando true, filterChannel só conta clientes que têm conversation REAL no
  // canal (não só identifier cadastrado). Default false — manter retrocompat
  // com fluxo anterior. Toggle ao lado dos chips de canal no painel de filtros.
  const [filterChannelHasConv, setFilterChannelHasConv] = useState(false);
  // Valores possíveis (filter chain detecta cada um):
  //   'all' | 'with_offer_id' | 'with_product' | 'with_label' | 'none'
  //   'offer:${id}' | 'product:${id}' | productId raw (retrocompat)
  // String catch-all simplifica state mas perde narrowing — equality checks
  // no chain são exhaustivos.
  const [filterAcquisition, setFilterAcquisition] = useState<string>('all');
  const [filterCampaign, setFilterCampaign] = useState<string>('');  // broadcastId ou ''
  // Sort centralizado: dropdown de "Ordenar" e clicks nos headers do TableView
  // ambos atualizam esse state. Antes tinha `sortBy` aqui + state interno no
  // TableView que ignorava o sortBy → dropdown não fazia nada em modo tabela.
  const [sortField, setSortField] = useState<ClientSortField>('name');
  const [sortDir, setSortDir] = useState<ClientSortDir>('asc');
  // Helper pro toggle nos headers da tabela: clicar no mesmo field alterna
  // direção; clicar em outro reseta pra asc.
  const handleSortToggle = useCallback((field: ClientSortField) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showLoyaltySettings, setShowLoyaltySettings] = useState(false);
  const [showOffersManager, setShowOffersManager] = useState(false);
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig | undefined>(business?.settings?.loyalty);
  const isAdmin = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];
  const [showFilters, setShowFilters] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Client | null>(null);
  // Multi-seleção pra exclusão em massa (importação errada, etc.)
  // Selection mode é off por default — checkboxes só aparecem quando operador
  // clica "Selecionar". Reduz ruído visual no fluxo principal (consultar lista
  // e clicar em cliente pra ver detalhe).
  const [selectionMode, setSelectionMode] = useState(false);
  const [showSpreadsheetView, setShowSpreadsheetView] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Lock-scroll do wrapper de tab ativo enquanto qualquer modal estiver aberto.
  // Sem isso, com os modais portalados pra document.body, a página atrás
  // ainda fica scrollável.
  useEffect(() => {
    const anyOpen = showForm || showImport || showExport || showMerge || showLoyaltySettings || !!deleteConfirm || bulkDeleteOpen;
    if (!anyOpen) return;
    const el = document.querySelector<HTMLElement>(
      '.will-change-transform.pointer-events-auto.overflow-y-auto',
    );
    if (!el) return;
    const prevOverflow = el.style.overflowY;
    el.style.overflowY = 'hidden';
    return () => { el.style.overflowY = prevOverflow; };
  }, [showForm, showImport, showExport, showMerge, showLoyaltySettings, deleteConfirm, bulkDeleteOpen]);

  // ESC fecha o drawer de detalhe — UX padrão. Antes existia um effect aqui
  // que rolava a viewport pro topo no select (necessário porque o painel ficava
  // inline no flex layout e ficava fora de visão se o user estivesse scrollando
  // pra baixo). Agora o painel é drawer fixo flutuante — não precisa rolar
  // viewport, e fazê-lo é EXATAMENTE o bug reportado ("clicar embaixo joga
  // pra cima"). Removido junto com a refatoração de drawer.
  //
  // Guard contra modais por cima: se Edit modal (showForm), Delete confirm
  // (deleteConfirm), Bulk action ou Importar/Exportar estiver aberto, ESC
  // pertence ao modal — não fechar o drawer (modal está em z-50, drawer em
  // z-40, então o modal é o "elemento ativo"). Sem isso, ESC fecha drawer
  // injustamente e modal fica aberto sem contexto do cliente.
  useEffect(() => {
    if (!selectedClient) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showForm || deleteConfirm || showImport || showExport) return;
      setSelectedClient(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedClient, showForm, deleteConfirm, showImport, showExport]);

  // ─── Data fetching ──────────────────────────────────────────────────────────
  // Real-time listener (refactor de sincronização multi-user):
  //
  // ANTES: useQuery + getDocs com staleTime 3min. Operador A editava cliente,
  // operador B (outra aba/sessão) só via a mudança após refetch (window focus
  // ou após mutation própria).
  //
  // AGORA: onSnapshot direto. Mudanças propagam pra todas as sessões em tempo
  // real, incluindo edits via /api (admin SDK bypassa rules mas listeners
  // dos clients ainda recebem o evento de update).
  //
  // As chamadas de invalidateQueries(['clients', ...]) ao salvar continuam
  // úteis: invalidam o cache do Reports/Agenda (que ainda usam useQuery
  // com essa key), forçando refetch com dados frescos sem precisar de
  // window focus.
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    if (!business?.id) { setIsLoading(false); return; }
    setIsLoading(true);
    const q = query(
      collection(db, 'clients'),
      where('businessId', '==', business.id),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        // Filtra soft-deleted/merged no carregamento. Sem isso, o KPI "Total"
        // e o header "{n} clientes cadastrados" contavam docs que o operador
        // já tinha excluído (via bulk-delete do CRM ou merge de duplicatas),
        // gerando discrepância grande com /crm — que sempre filtra.
        const docs = snap.docs
          .map(d => ({ ...d.data(), id: d.id } as Client))
          .filter(isActiveClient);
        setClients(docs);
        setIsLoading(false);
      },
      (err) => {
        console.error('[Clients] snapshot error:', err);
        setIsLoading(false);
      },
    );
    return () => unsub();
  }, [business?.id]);

  // Produtos (id + nome) pra alimentar o select de "Aquisição" no form.
  // Carregamento leve — só os 2 campos necessários, mesmo que seja preciso
  // scan completo da coleção (Firestore não tem projection); cache 10min
  // pra evitar re-fetch a cada abertura do modal de cadastro.
  const { data: productsForAcquisition = [] } = useQuery({
    queryKey: ['products-acquisition-select', business?.id],
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      if (!business?.id) return [];
      const snap = await getDocs(query(
        collection(db, 'products'),
        where('businessId', '==', business.id),
      ));
      return snap.docs
        .map(d => ({ id: d.id, name: (d.data().name as string) || '(sem nome)' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!business?.id,
    staleTime: 10 * 60 * 1000,
  });

  // Ofertas (Fase 4B): id + name + isActive pra alimentar select e badge.
  // Cache 5min — operador pode criar oferta nova via OffersManagerModal e
  // ela já aparece ao reabrir o cadastro depois.
  const { data: offersForAcquisition = [] } = useQuery({
    queryKey: ['offers-acquisition-select', business?.id],
    queryFn: async (): Promise<Array<{ id: string; name: string; isActive: boolean }>> => {
      if (!business?.id) return [];
      const snap = await getDocs(query(
        collection(db, 'offers'),
        where('businessId', '==', business.id),
      ));
      return snap.docs
        .map(d => {
          const data = d.data();
          return {
            id: d.id,
            name: (data.name as string) || '(sem nome)',
            isActive: data.isActive !== false,
          };
        })
        // Ativas primeiro (alfabético), arquivadas depois — operador raramente
        // taga cliente novo com oferta arquivada, mas precisa visualizar pra
        // edit de cliente histórico.
        .sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    },
    enabled: !!business?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Lista enxuta de broadcasts (id + nome) pra alimentar filtro "Participou
  // de campanha". Cache 5min — broadcasts mudam pouco depois de criados.
  const { data: broadcastsForFilter = [] } = useQuery({
    queryKey: ['broadcasts-filter-select', business?.id],
    queryFn: async (): Promise<Array<{ id: string; name: string; createdAt: string }>> => {
      if (!business?.id) return [];
      const snap = await getDocs(query(
        collection(db, 'broadcasts'),
        where('businessId', '==', business.id),
      ));
      return snap.docs
        .map(d => ({
          id: d.id,
          name: (d.data().name as string) || '(sem nome)',
          createdAt: (d.data().createdAt as string) || '',
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    enabled: !!business?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Quando filterChannelHasConv está on, carrega o map (canal → set de
  // crmContactIds com conversation real). Só roda quando o toggle está
  // ativado E há um canal selecionado — economia óbvia. Limit 1000 cobre
  // business típico (raros têm > 1000 conversas no histórico vivo).
  const { data: contactIdsByChannel = new Map<string, Set<string>>() } = useQuery({
    queryKey: ['client-contacts-by-channel', business?.id],
    queryFn: async (): Promise<Map<string, Set<string>>> => {
      if (!business?.id) return new Map();
      const snap = await getDocs(query(
        collection(db, 'conversations'),
        where('businessId', '==', business.id),
        firestoreLimit(1000),
      ));
      const map = new Map<string, Set<string>>();
      snap.docs.forEach(d => {
        const data = d.data();
        const ch = data.channel as string | undefined;
        const cid = data.crmContactId as string | undefined;
        if (!ch || !cid) return;
        if (!map.has(ch)) map.set(ch, new Set());
        map.get(ch)!.add(cid);
      });
      return map;
    },
    enabled: !!business?.id && filterChannelHasConv && filterChannel !== 'all',
    staleTime: 5 * 60 * 1000,
  });

  // Quando filterCampaign está ativo, busca os contactIds que receberam essa
  // campanha. Usa o índice (businessId, broadcastId, createdAt) que já existia
  // pra outras telas — sem custo adicional. Limit 500 cobre 99% (campanhas
  // típicas vão pra 50-300 contatos; quem manda pra 500+ provavelmente não
  // está usando esse filtro pra recortar lista de clientes).
  const { data: campaignContactIds = new Set<string>() } = useQuery({
    queryKey: ['campaign-contact-ids', filterCampaign, business?.id],
    queryFn: async (): Promise<Set<string>> => {
      if (!filterCampaign || !business?.id) return new Set();
      const snap = await getDocs(query(
        collection(db, 'broadcastMessages'),
        where('businessId', '==', business.id),
        where('broadcastId', '==', filterCampaign),
        firestoreLimit(500),
      ));
      const ids = new Set<string>();
      snap.docs.forEach(d => {
        const cid = d.data().contactId as string | undefined;
        if (cid) ids.add(cid);
      });
      return ids;
    },
    enabled: !!filterCampaign && !!business?.id,
    staleTime: 2 * 60 * 1000,
  });

  // ─── Sync selectedClient com snapshot ───────────────────────────────────────
  // Quando outro usuário edita o cliente que está aberto no painel, o
  // snapshot atualiza `clients` mas `selectedClient` (state local) ficaria
  // congelado. Aqui sincronizamos: se o doc foi removido externamente, fecha
  // o painel; se foi atualizado, refresca a referência. Compara pelo
  // `updatedAt` pra evitar setState quando nada relevante mudou (Firestore
  // emite snapshot a cada metadata change, não só quando o doc muda).
  useEffect(() => {
    if (!selectedClient) return;
    const fresh = clients.find(c => c.id === selectedClient.id);
    if (!fresh) {
      setSelectedClient(null);
      return;
    }
    if (fresh.updatedAt !== selectedClient.updatedAt) {
      setSelectedClient(fresh);
    }
  }, [clients, selectedClient]);

  // ─── Pré-seleção via sessionStorage ─────────────────────────────────────────
  // Usado pelo Conversas → "Ver/editar contato" para abrir o cliente direto
  // quando navega pra cá. Limpa o storage após consumir (não persiste entre
  // navegações repetidas).
  useEffect(() => {
    if (!clients.length || selectedClient) return;
    let preselectId: string | null = null;
    try {
      preselectId = sessionStorage.getItem('aevo:preselectClientId');
    } catch { /* indisponível */ }
    if (!preselectId) return;
    const target = clients.find(c => c.id === preselectId);
    if (target) {
      setSelectedClient(target);
    }
    try {
      sessionStorage.removeItem('aevo:preselectClientId');
    } catch { /* ok */ }
  }, [clients, selectedClient]);

  // ─── Pré-seleção via AppContext (pendingOpenClientId) ───────────────────────
  // Padrão moderno (mesmo de pendingOpenConversationId em Conversas). Setado
  // pelo Conversas quando operador clica no card "Cliente vinculado" do panel
  // de Vincular cliente — pula direto pro detalhe sem o operador ter que buscar
  // de novo. Timeout 5s evita pendurar se a lista ainda não carregou.
  const { pendingOpenClientId, setPendingOpenClientId } = useAppContext();
  useEffect(() => {
    if (!pendingOpenClientId) return;
    const target = clients.find(c => c.id === pendingOpenClientId);
    if (target) {
      setSelectedClient(target);
      setPendingOpenClientId(null);
      return;
    }
    const t = setTimeout(() => setPendingOpenClientId(null), 5000);
    return () => clearTimeout(t);
  }, [pendingOpenClientId, clients, setPendingOpenClientId]);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  // saveClient foi extraído pra ClientEditDialog (reutilizado em Conversas).
  // delete fica aqui — não há reuso entre módulos.

  const { mutate: deleteClient, isPending: isDeleting } = useMutation({
    mutationFn: async (id: string) => {
      // Soft delete em vez de deleteDoc. Hard delete deixava órfãos em
      // conversations, sales, transactions, appointments, kanbanCards,
      // crmDeals, crmActivities — todos ainda apontavam pro doc fantasma.
      // Soft delete preserva a integridade histórica + audit trail e
      // permite rollback caso o operador tenha clicado errado.
      await updateDoc(doc(db, 'clients', id), {
        isActive: false,
        deletedAt: new Date().toISOString(),
        deletedBy: user?.uid || '',
        deletedByName: user?.name || '',
        updatedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
      toast.success('Cliente excluído');
      setDeleteConfirm(null);
      if (selectedClient?.id === deleteConfirm?.id) setSelectedClient(null);
    },
    onError: () => toast.error('Erro ao excluir cliente'),
  });

  // Soft-delete em massa via writeBatch (limite Firestore: 500 ops por batch).
  // Mantém o mesmo padrão do deleteClient single (isActive=false + deletedAt
  // pra preservar audit trail e referências em vendas/agendamentos/etc.).
  const { mutate: bulkDeleteClients, isPending: isBulkDeleting } = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const now = new Date().toISOString();
      const meta = {
        isActive: false,
        deletedAt: now,
        deletedBy: user?.uid || '',
        deletedByName: user?.name || '',
        updatedAt: now,
      };
      // Quebra em chunks de 500 (limite por writeBatch).
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const batch = writeBatch(db);
        for (const id of chunk) batch.update(doc(db, 'clients', id), meta);
        await batch.commit();
      }
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
      toast.success(`${ids.length} cliente(s) excluído(s)`);
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      // Se o cliente atualmente aberto foi um dos deletados, fecha o painel.
      if (selectedClient && ids.includes(selectedClient.id)) setSelectedClient(null);
    },
    onError: (err: Error) => toast.error(`Erro ao excluir clientes: ${err.message}`),
  });

  // ─── Filtered & sorted list ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    // Drop malformed entries + soft-deleted/merged (isActiveClient cobre essas
    // checagens; só falta o sanity check de name não-vazio).
    let list = clients.filter(c =>
      c && typeof c.name === 'string' && c.name.length > 0 && isActiveClient(c),
    );
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(term) ||
        c.cpfCnpj?.includes(term) ||
        c.email?.toLowerCase().includes(term) ||
        c.phone?.includes(term) ||
        c.company?.toLowerCase().includes(term)
      );
    }
    if (filterTipo !== 'all') list = list.filter(c => c.tipo === filterTipo);
    if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus);
    if (filterTags.length) {
      const wanted = filterTags.map(t => t.toLowerCase());
      list = list.filter(c => {
        const cTags = (c.tags || []).map(t => t.toLowerCase());
        return wanted.every(w => cTags.includes(w));
      });
    }
    if (filterChurnRisk !== 'all') {
      list = list.filter(c => {
        // Clients with no scores are treated as 'minimal' risk (not filtered out)
        const risk = c.scores?.churnRisk ?? 0;
        return getChurnLevel(risk) === filterChurnRisk;
      });
    }
    // Filtro por mês de aniversário. ISO YYYY-MM-DD; mês são chars 5-6 (1-based MM).
    if (filterBirthMonth !== 'all') {
      const today = new Date();
      const targetMonth: number =
        filterBirthMonth === 'this_month' ? today.getMonth() + 1 :
        filterBirthMonth === 'next_month' ? ((today.getMonth() + 1) % 12) + 1 :
        filterBirthMonth;
      list = list.filter(c => {
        if (!c.birthDate || c.birthDate.length < 7) return false;
        const month = Number(c.birthDate.slice(5, 7));
        return month === targetMonth;
      });
    }
    // Filtros Fase 5 — leem fields denormalizados (channelIdentities/socialMedia,
    // acquisition*) ou Set carregado via useQuery (campaignContactIds).
    if (filterChannel !== 'all') {
      list = list.filter(c => {
        // Quando "exigir conversa real" está on, ignora identifier cadastrado
        // — só conta cliente com conversation existente naquele canal. Set
        // lookup é O(1). Default off → comportamento legado (qualquer
        // identifier conta).
        if (filterChannelHasConv) {
          return contactIdsByChannel.get(filterChannel)?.has(c.id) ?? false;
        }
        const ci = c.channelIdentities?.[filterChannel];
        if (ci) return true;
        // Fallback pra socialMedia (FB/IG cadastrados manualmente)
        if (filterChannel === 'facebook') return !!c.socialMedia?.facebook;
        if (filterChannel === 'instagram') return !!c.socialMedia?.instagram;
        // WhatsApp também pode estar no campo `whatsapp`/`phone` legacy
        if (filterChannel === 'whatsapp') return !!c.whatsapp || !!c.phone;
        return false;
      });
    }
    if (filterAcquisition !== 'all') {
      list = list.filter(c => {
        if (filterAcquisition === 'with_offer_id') return !!c.acquisitionOfferId;
        if (filterAcquisition === 'with_product') return !!c.acquisitionProductId;
        if (filterAcquisition === 'with_label') return !!c.acquisitionOfferLabel;
        if (filterAcquisition === 'none') {
          return !c.acquisitionOfferId && !c.acquisitionProductId && !c.acquisitionOfferLabel;
        }
        // Prefixed strings: 'offer:${id}' / 'product:${id}'. Plain id sem
        // prefix continua significando productId pra retrocompat (estado
        // serializado ou shortcut antigo).
        if (filterAcquisition.startsWith('offer:')) {
          return c.acquisitionOfferId === filterAcquisition.slice('offer:'.length);
        }
        if (filterAcquisition.startsWith('product:')) {
          return c.acquisitionProductId === filterAcquisition.slice('product:'.length);
        }
        return c.acquisitionProductId === filterAcquisition;
      });
    }
    if (filterCampaign) {
      list = list.filter(c => campaignContactIds.has(c.id));
    }

    list.sort((a, b) => {
      // Sort especial quando filtrando por aniversário: ordena por dia do mês
      // (ascendente). Operador escaneando "quem faz no próximo mês" prefere
      // ver dia 1 → 31 em vez de alfabético.
      if (filterBirthMonth !== 'all') {
        const da = a.birthDate ? Number(a.birthDate.slice(8, 10)) : 99;
        const db = b.birthDate ? Number(b.birthDate.slice(8, 10)) : 99;
        if (da !== db) return da - db;
      }
      let cmp = 0;
      if (sortField === 'name')             cmp = a.name.localeCompare(b.name, 'pt-BR');
      else if (sortField === 'status')      cmp = (a.status || '').localeCompare(b.status || '');
      else if (sortField === 'totalSpent')  cmp = (a.totalSpent ?? 0) - (b.totalSpent ?? 0);
      else if (sortField === 'visitCount')  cmp = (a.visitCount ?? 0) - (b.visitCount ?? 0);
      else if (sortField === 'churnRisk')   cmp = (a.scores?.churnRisk ?? 0) - (b.scores?.churnRisk ?? 0);
      else if (sortField === 'createdAt')   cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      else if (sortField === 'lastContact') {
        const da = a.lastContactDate ?? a.updatedAt ?? '';
        const db2 = b.lastContactDate ?? b.updatedAt ?? '';
        cmp = da.localeCompare(db2);
      }
      // Tiebreaker estável: empate no critério principal cai no nome (asc).
      // Sem isso, dois clientes com mesmo totalSpent/churnRisk ficam em ordem
      // arbitrária a cada re-render, causando flicker visual.
      if (cmp === 0 && sortField !== 'name') {
        cmp = a.name.localeCompare(b.name, 'pt-BR');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [clients, search, filterTipo, filterStatus, filterTags, filterChurnRisk, filterBirthMonth, filterChannel, filterChannelHasConv, contactIdsByChannel, filterAcquisition, filterCampaign, campaignContactIds, sortField, sortDir]);

  // ─── Duplicate count (for badge) ─────────────────────────────────────────────
  // Conta só pairs ATIVOS — desconta os que o operador ignorou. Sem esse
  // filtro, o badge "Duplicatas N" continuava mostrando o par mesmo depois
  // de "Ignorar este par" porque o filtro vivia só no state local do modal.
  const dupeCount = useMemo(
    () => detectDuplicates(clients).filter(([a, b]) => !ignoredPairKeys.has(pairKeyOf(a.id, b.id))).length,
    [clients, ignoredPairKeys],
  );

  // ─── KPIs ────────────────────────────────────────────────────────────────────
  // `won` é o número de contatos no estágio final do pipeline (status='ganho').
  // Antes chamava 'active', o que era enganoso — "Ativos" parecia sinônimo de
  // "não-deletados" mas era na verdade o subset de status='ganho'. Soft-delete
  // já é filtrado no carregamento (ver onSnapshot acima), então clients.length
  // representa o total honesto de clientes vivos.
  const kpis = useMemo(() => {
    const won = clients.filter(c => c.status === 'ganho').length;
    const pj = clients.filter(c => c.tipo === 'pj').length;
    const totalSpent = clients.reduce((s, c) => s + (c.totalSpent || 0), 0);
    const withSpent = clients.filter(c => (c.totalSpent || 0) > 0);
    const avgTicket = withSpent.length > 0 ? totalSpent / withSpent.length : 0;
    return { total: clients.length, won, pj, totalSpent, avgTicket };
  }, [clients]);

  // ─── Form helpers ────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingClient(null);
    setShowForm(true);
  };

  const openEdit = (client: Client) => {
    setEditingClient(client);
    setShowForm(true);
    setSelectedClient(null);
  };

  // form state e formInitial migraram pra dentro do ClientEditDialog.

  // Aggregated tag suggestions across all clients (dedup, case-insensitive)
  const allTags = useMemo(() => {
    const seen = new Map<string, string>(); // lowercase → original
    for (const c of clients) {
      for (const t of c.tags || []) {
        const k = t.toLowerCase();
        if (!seen.has(k)) seen.set(k, t);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [clients]);

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
            <Users className="w-6 h-6 text-red-500" />
            Clientes
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{clients.length} clientes cadastrados</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowLoyaltySettings(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium rounded-xl transition-colors"
              title="Configurar programa de fidelidade"
            >
              <Trophy className="w-4 h-4 text-amber-500" />
              Fidelidade
              {loyaltyConfig?.isEnabled && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
            </button>
          )}
          {dupeCount > 0 && (
            <button
              onClick={() => setShowMerge(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-sm font-medium rounded-xl transition-colors"
            >
              <Users className="w-4 h-4" />
              Duplicatas
              <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {dupeCount}
              </span>
            </button>
          )}
          {/* Selecionar — toggle do selection mode. Sai do modo + zera seleção
              quando clicado de novo. Útil pra bulk delete sem sujar a tela
              com checkboxes durante consulta normal. */}
          <button
            onClick={() => {
              if (selectionMode) {
                // Sair do modo: limpa seleção pra evitar estado fantasma
                setSelectedIds(new Set());
              }
              setSelectionMode(v => !v);
            }}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors border',
              selectionMode
                ? 'border-red-300 dark:border-red-500/50 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
            )}
          >
            <CheckSquare className="w-4 h-4" />
            {selectionMode ? 'Sair da seleção' : 'Selecionar'}
          </button>
          <button
            onClick={() => setShowSpreadsheetView(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium rounded-xl transition-colors"
            title="Abrir lista como planilha"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Planilha
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium rounded-xl transition-colors"
          >
            <Upload className="w-4 h-4" />
            Importar
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium rounded-xl transition-colors"
          >
            <FileDown className="w-4 h-4" />
            Exportar
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Novo cliente
          </button>
        </div>
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total', value: kpis.total, icon: Users, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
          { label: 'Convertidos', value: kpis.won, icon: UserCheck, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
          { label: 'Receita total', value: formatCurrency(kpis.totalSpent), icon: TrendingUp, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-500/10', isStr: true },
          { label: 'Ticket médio', value: formatCurrency(kpis.avgTicket), icon: ShoppingCart, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10', isStr: true },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="surface rounded-2xl p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{kpi.label}</span>
              <div className={cn('p-1.5 rounded-lg', kpi.bg)}>
                <kpi.icon className={cn('w-4 h-4', kpi.color)} />
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {kpi.isStr ? kpi.value : kpi.value}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, CPF/CNPJ, telefone, e-mail..."
            className="w-full pl-10 pr-10 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(v => !v)}
            className={cn(
              'inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-colors',
              showFilters
                ? 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-800/60'
            )}
          >
            <Filter className="w-4 h-4" />
            Filtros
            {(filterTipo !== 'all' || filterStatus !== 'all' || filterTags.length > 0 || filterChurnRisk !== 'all' || filterBirthMonth !== 'all' || filterChannel !== 'all' || filterAcquisition !== 'all' || filterCampaign !== '') && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            )}
          </button>
          {/* Dropdown codifica field+dir num value composto pra parecer
              "preset de ordenação" pro user (esconde a complexidade do
              asc/desc — cada preset tem direção fixa). Click nos headers
              da tabela usa um caminho diferente (handleSortToggle), então
              ambos coexistem sem conflito. */}
          <select
            value={`${sortField}|${sortDir}`}
            onChange={e => {
              const [f, d] = e.target.value.split('|') as [ClientSortField, ClientSortDir];
              setSortField(f);
              setSortDir(d);
            }}
            className="px-3 py-2.5 bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 focus:outline-none"
          >
            <option value="name|asc">Nome A-Z</option>
            <option value="totalSpent|desc">Maior valor</option>
            <option value="createdAt|desc">Mais recentes</option>
            <option value="churnRisk|desc">Maior risco</option>
          </select>
          <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-xl">
            <button
              onClick={() => handleClientsView('list')}
              title="Visão lista"
              className={cn('p-1.5 rounded-[10px] transition-all',
                clientsView === 'list'
                  ? 'bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              )}>
              <AlignJustify size={15} />
            </button>
            <button
              onClick={() => handleClientsView('table')}
              title="Visão tabela"
              className={cn('p-1.5 rounded-[10px] transition-all',
                clientsView === 'table'
                  ? 'bg-white dark:bg-white/[0.12] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
              )}>
              <LayoutList size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Filters panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="surface rounded-xl p-4 flex flex-wrap gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Tipo</label>
                <div className="flex gap-2">
                  {(['all', 'pf', 'pj'] as const).map(t => (
                    <button key={t} onClick={() => setFilterTipo(t)}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        filterTipo === t
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}>
                      {t === 'all' ? 'Todos' : TIPO_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Status</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setFilterStatus('all')}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      filterStatus === 'all'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                    )}>
                    Todos
                  </button>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <button key={k} onClick={() => setFilterStatus(k as LeadStatus)}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        filterStatus === k
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      )}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Churn Risk filter */}
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">Risco de churn</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setFilterChurnRisk('all')}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      filterChurnRisk === 'all'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>Todos</button>
                  {(Object.entries(CHURN_CFG) as [ChurnRiskLevel, typeof CHURN_CFG[ChurnRiskLevel]][]).map(([key, cfg]) => (
                    <button key={key} onClick={() => setFilterChurnRisk(key)}
                      className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        filterChurnRisk === key
                          ? `${cfg.bg} ${cfg.color} ring-1 ring-current`
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Aniversário — preparação para campanhas. "Este mês" e
                  "Próximo mês" são atalhos pra fluxo recorrente; meses
                  específicos pra planejamento longo prazo. Quando filtro
                  está ativo, lista é re-ordenada por dia do mês. */}
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block inline-flex items-center gap-1.5">
                  <Gift className="w-3 h-3" />
                  Aniversário
                </label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setFilterBirthMonth('all')}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      filterBirthMonth === 'all'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>Todos</button>
                  <button onClick={() => setFilterBirthMonth('this_month')}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      filterBirthMonth === 'this_month'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>Este mês</button>
                  <button onClick={() => setFilterBirthMonth('next_month')}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      filterBirthMonth === 'next_month'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>Próximo mês</button>
                  <select
                    value={typeof filterBirthMonth === 'number' ? filterBirthMonth : ''}
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) return;
                      setFilterBirthMonth(Number(v));
                    }}
                    className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border-0 focus:outline-none focus:ring-1 focus:ring-red-400 cursor-pointer',
                      typeof filterBirthMonth === 'number'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>
                    <option value="">Mês específico…</option>
                    {['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].map((m, i) => (
                      <option key={i + 1} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>

              {allTags.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block flex items-center justify-between">
                    <span>Tags</span>
                    {filterTags.length > 0 && (
                      <button onClick={() => setFilterTags([])} className="text-[10px] text-red-500 hover:text-red-700 normal-case tracking-normal">Limpar</button>
                    )}
                  </label>
                  <div className="flex flex-wrap gap-2 max-w-xl">
                    {allTags.map(tag => {
                      const active = filterTags.some(t => t.toLowerCase() === tag.toLowerCase());
                      return (
                        <button
                          key={tag}
                          onClick={() => setFilterTags(prev => active ? prev.filter(t => t.toLowerCase() !== tag.toLowerCase()) : [...prev, tag])}
                          className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border',
                            active
                              ? 'bg-red-600 text-white border-red-600'
                              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-red-300'
                          )}
                        >
                          <Tag className="w-2.5 h-2.5" />
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Filtro Canal — checa channelIdentities (PSID/IGSID/wa real) +
                  fallback pra socialMedia/whatsapp/phone (cadastro manual).
                  Toggle "só com conversa" troca pra checagem em conversations
                  collection: cliente conta só se tem conversation real no canal. */}
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block flex items-center justify-between">
                  <span>Canal ativo</span>
                  {filterChannel !== 'all' && (
                    <button
                      onClick={() => setFilterChannelHasConv(v => !v)}
                      title="Quando ligado, só conta clientes com conversa real no canal (não basta ter o identifier cadastrado)"
                      className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium normal-case tracking-normal transition-colors',
                        filterChannelHasConv
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600',
                      )}
                    >
                      <MessageSquare className="w-2.5 h-2.5" />
                      Só com conversa
                    </button>
                  )}
                </label>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'whatsapp', 'facebook', 'instagram'] as const).map(ch => (
                    <button
                      key={ch}
                      onClick={() => setFilterChannel(ch)}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        filterChannel === ch
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}>
                      {ch === 'all' ? 'Todos' : ch === 'whatsapp' ? 'WhatsApp' : ch === 'facebook' ? 'Facebook' : 'Instagram'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filtro Aquisição (Fases 4A+4B) — chips fixos por categoria
                  + select com 2 grupos (Ofertas/Produtos). Quando seleção
                  específica, filterAcquisition vira "offer:${id}" ou
                  "product:${id}"; chips ficam inativos. */}
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">
                  Aquisição
                </label>
                <div className="flex flex-wrap gap-2">
                  {([
                    { id: 'all',           label: 'Todos' },
                    { id: 'with_offer_id', label: 'Com oferta' },
                    { id: 'with_product',  label: 'Com produto' },
                    { id: 'with_label',    label: 'Com label' },
                    { id: 'none',          label: 'Sem aquisição' },
                  ] as const).map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setFilterAcquisition(opt.id)}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        filterAcquisition === opt.id
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}>
                      {opt.label}
                    </button>
                  ))}
                  {(offersForAcquisition.length > 0 || productsForAcquisition.length > 0) && (() => {
                    const KNOWN_CHIPS = ['all', 'with_offer_id', 'with_product', 'with_label', 'none'];
                    const isSpecific = !KNOWN_CHIPS.includes(filterAcquisition);
                    return (
                      <select
                        value={isSpecific ? filterAcquisition : ''}
                        onChange={e => setFilterAcquisition(e.target.value || 'all')}
                        className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border-0 focus:outline-none focus:ring-1 focus:ring-red-400 cursor-pointer',
                          isSpecific
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                        )}>
                        <option value="">Específico…</option>
                        {offersForAcquisition.length > 0 && (
                          <optgroup label="Ofertas">
                            {offersForAcquisition.map(o => (
                              <option key={o.id} value={`offer:${o.id}`}>
                                {o.name}{!o.isActive ? ' (arquivada)' : ''}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {productsForAcquisition.length > 0 && (
                          <optgroup label="Produtos">
                            {productsForAcquisition.map(p => (
                              <option key={p.id} value={`product:${p.id}`}>{p.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    );
                  })()}
                </div>
              </div>

              {/* Filtro Campanha — só aparece se há broadcasts cadastrados.
                  Vazio = sem filtro; selecionar broadcastId carrega o set
                  de contactIds via useQuery e filtra a lista. */}
              {broadcastsForFilter.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 block">
                    Participou de campanha
                  </label>
                  <select
                    value={filterCampaign}
                    onChange={e => setFilterCampaign(e.target.value)}
                    className={cn('w-full sm:w-auto px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border-0 focus:outline-none focus:ring-1 focus:ring-red-400 cursor-pointer',
                      filterCampaign
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    )}>
                    <option value="">Todas (sem filtro)</option>
                    {broadcastsForFilter.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content area */}
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Client list */}
        <div className={cn('flex flex-col flex-1 min-w-0 overflow-hidden', selectedClient && 'hidden lg:flex')}>
          {/* Bulk action bar — só aparece quando há seleção. Posicionada acima
              da lista pra não atrapalhar o scroll. Ações são destrutivas, daí
              o destaque vermelho + confirmação obrigatória antes do delete. */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 mb-2 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                  {selectedIds.size} selecionado(s)
                </span>
                <button
                  onClick={() => {
                    const allIds = filtered.map(c => c.id);
                    setSelectedIds(allIds.every(id => selectedIds.has(id))
                      ? new Set()
                      : new Set(allIds));
                  }}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline"
                >
                  {filtered.every(c => selectedIds.has(c.id)) ? 'Limpar' : `Selecionar todos os ${filtered.length} filtrados`}
                </button>
              </div>
              <button
                onClick={() => setBulkDeleteOpen(true)}
                disabled={isBulkDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Excluir {selectedIds.size}
              </button>
            </div>
          )}
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl shimmer" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                <Users className="w-7 h-7 text-gray-400" />
              </div>
              <p className="text-gray-600 dark:text-gray-400 font-medium">
                {search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                {search ? 'Tente outros termos de busca' : 'Clique em "Novo cliente" para começar'}
              </p>
            </motion.div>
          ) : clientsView === 'table' ? (
            <ClientTableView
              clients={filtered}
              selectedClientId={selectedClient?.id ?? null}
              onSelectClient={setSelectedClient}
              selectedIds={selectedIds}
              // ClientTableView esconde a coluna de checkbox quando
              // onToggleSelectId é undefined. Passa só em selection mode pra
              // remover ruído visual no fluxo principal de consulta.
              onToggleSelectId={selectionMode ? (id) => setSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              }) : undefined}
              onToggleSelectAll={selectionMode ? () => {
                const allIds = filtered.map(c => c.id);
                const allSelected = allIds.every(id => selectedIds.has(id));
                setSelectedIds(allSelected ? new Set() : new Set(allIds));
              } : undefined}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSortToggle}
            />
          ) : (
            <div className="space-y-1.5 overflow-y-auto pr-1">
              {filtered.map((client, i) => {
                const statusCfg = STATUS_CONFIG[client.status] || STATUS_CONFIG.ganho;
                return (
                  <motion.div
                    key={client.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    onClick={() => setSelectedClient(client)}
                    className={cn(
                      'group flex items-center gap-3 p-3.5 rounded-xl cursor-pointer transition-all border',
                      selectedClient?.id === client.id
                        ? 'border-red-200 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5'
                        : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                    )}
                  >
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden">
                      {client.avatarUrl ? (
                        <img src={client.avatarUrl} alt={client.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white font-bold text-sm">
                          {(client.name?.[0] || '?').toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{client.name}</p>
                        {client.tipo === 'pj' && <Building2 className="w-3 h-3 text-gray-400 flex-shrink-0" />}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                        {client.cpfCnpj || client.phone || client.whatsapp || client.email || client.company || '—'}
                      </p>
                      {client.tags && client.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {client.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">
                              <Tag className="w-2 h-2" />{tag}
                            </span>
                          ))}
                          {client.tags.length > 3 && (
                            <span className="text-[9px] text-gray-400 self-center">+{client.tags.length - 3}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right col */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {/* Birthday badge — só aparece se aniversário <= 30 dias.
                          Cor amber pra urgência sem competir com status do CRM.
                          Útil pra operador escanear quem precisa de campanha. */}
                      {(() => {
                        if (!client.birthDate || client.birthDate.length < 10) return null;
                        const month = Number(client.birthDate.slice(5, 7));
                        const day = Number(client.birthDate.slice(8, 10));
                        if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const thisYear = new Date(today.getFullYear(), month - 1, day);
                        const next = thisYear >= today ? thisYear : new Date(today.getFullYear() + 1, month - 1, day);
                        const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400000);
                        if (daysUntil > 30) return null;
                        return (
                          <span className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
                            daysUntil === 0
                              ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 ring-1 ring-amber-400'
                              : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
                          )}>
                            🎂 {daysUntil === 0 ? 'Hoje!' : daysUntil === 1 ? 'Amanhã' : `${daysUntil}d`}
                          </span>
                        );
                      })()}
                      <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium', statusCfg.color)}>
                        <span className={cn('w-1 h-1 rounded-full', statusCfg.dot)} />
                        {statusCfg.label}
                      </span>
                      <HealthBadge client={client} />
                      {(client.totalSpent || 0) > 0 && (
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          {formatCurrency(client.totalSpent || 0)}
                        </span>
                      )}
                      {(client.loyaltyPoints || 0) > 0 && (
                        <>
                          <TierBadge points={client.loyaltyPoints ?? 0} tiers={loyaltyConfig?.tiers ?? DEFAULT_LOYALTY_TIERS} />
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                            <Gift className="w-2.5 h-2.5" />
                            {client.loyaltyPoints} pts
                          </span>
                        </>
                      )}
                      {/* Aquisição (Fases 4A+4B) — badge sutil. Prioridade:
                          1. Oferta formal (offerId → offers[].name) — mais específico
                          2. Produto (productId → products[].name)
                          3. Label livre (offerLabel) — texto direto
                          Fallbacks "Oferta/Produto removido" quando o id existe
                          mas o doc sumiu (race ou hard-delete). */}
                      {(client.acquisitionOfferId || client.acquisitionProductId || client.acquisitionOfferLabel) && (() => {
                        const offerName = client.acquisitionOfferId
                          ? offersForAcquisition.find(o => o.id === client.acquisitionOfferId)?.name
                          : null;
                        const productName = client.acquisitionProductId
                          ? productsForAcquisition.find(p => p.id === client.acquisitionProductId)?.name
                          : null;
                        const label = offerName
                          || productName
                          || client.acquisitionOfferLabel
                          || (client.acquisitionOfferId ? 'Oferta removida'
                            : client.acquisitionProductId ? 'Produto removido' : '');
                        if (!label) return null;
                        return (
                          <span
                            title={`Aquisição: ${label}`}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 max-w-[140px]"
                          >
                            <Megaphone className="w-2.5 h-2.5 flex-shrink-0" />
                            <span className="truncate">{label}</span>
                          </span>
                        );
                      })()}
                    </div>

                    {/* Actions (visible on hover) */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(client); }}
                        className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(client); }}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel renderizado via portal mais abaixo (drawer fixo direita).
            Antes vivia AQUI dentro do flex container ao lado da lista — quando
            abria, a lista perdia largura, re-flow do overflow-y-auto resetava
            scrollTop, mandando o user pra o topo. Usuário precisava re-scrollar
            cada vez que clicava num cliente lá embaixo. Drawer fixo resolve:
            lista permanece intocada (mesma largura, mesmo scroll), painel
            flutua sobre conteúdo à direita. */}
      </div>

      {/* Detail drawer — flutua sobre o conteúdo à direita. Sem backdrop:
          o operador continua clicando em outras linhas da lista (que ficam
          visíveis à esquerda do drawer) pra trocar o cliente em inspeção.
          Fecha via X (no próprio painel) ou ESC. */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {selectedClient && (
            <motion.div
              key="client-detail-drawer"
              initial={{ x: 480, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 480, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="fixed top-[60px] right-0 bottom-0 sm:top-[68px] sm:right-4 sm:bottom-4 w-full sm:w-[440px] max-w-[calc(100vw-2rem)] z-40 sm:rounded-2xl overflow-hidden border-l sm:border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl"
            >
              <ClientDetailPanel
                client={selectedClient}
                onClose={() => setSelectedClient(null)}
                onEdit={() => openEdit(selectedClient)}
                loyaltyConfig={loyaltyConfig}
                products={productsForAcquisition}
                offers={offersForAcquisition}
                allClients={clients}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Create/Edit modal — wrapper completo extraído pra ClientEditDialog
          (reutilizado em Conversas pra editar cliente sem trocar de tela). */}
      <ClientEditDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditingClient(null); }}
        client={editingClient}
        allClients={clients}
        tagSuggestions={allTags}
        products={productsForAcquisition}
        offers={offersForAcquisition}
        onManageOffers={isAdmin ? () => setShowOffersManager(true) : undefined}
      />

      {/* Loyalty settings modal */}
      <AnimatePresence>
        {showLoyaltySettings && (
          <LoyaltySettingsModal
            current={loyaltyConfig}
            businessId={business!.id}
            onClose={() => setShowLoyaltySettings(false)}
            onSaved={cfg => setLoyaltyConfig(cfg)}
          />
        )}
      </AnimatePresence>

      {/* Offers manager modal — admin-only (Fase 4B) */}
      <AnimatePresence>
        {showOffersManager && user && (
          <OffersManagerModal
            businessId={business!.id}
            user={{ uid: user.uid, name: user.name }}
            products={productsForAcquisition}
            onClose={() => setShowOffersManager(false)}
          />
        )}
      </AnimatePresence>

      {/* Merge duplicates modal */}
      <AnimatePresence>
        {showMerge && (
          <MergeModal
            clients={clients}
            businessId={business!.id}
            ignores={duplicateIgnores}
            user={{ id: user!.id, name: user!.name || user!.email || 'Operador' }}
            onClose={() => setShowMerge(false)}
            onDone={() => queryClient.invalidateQueries({ queryKey: ['clients', business?.id] })}
          />
        )}
      </AnimatePresence>

      {/* Import modal */}
      <AnimatePresence>
        {showImport && (
          <ImportModal
            existingClients={clients}
            businessId={business!.id}
            onClose={() => setShowImport(false)}
            onDone={() => {
              queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
              setShowImport(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* Export modal */}
      <AnimatePresence>
        {showExport && (
          <ExportModal
            allClients={clients}
            filteredClients={filtered}
            onClose={() => setShowExport(false)}
          />
        )}
      </AnimatePresence>

      {/* Spreadsheet view (overlay full-screen) */}
      {showSpreadsheetView && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 bg-black/40 p-4 flex items-stretch justify-center">
          <div className="w-full max-w-[1600px]">
            <SpreadsheetView
              collection="clients"
              onClose={() => setShowSpreadsheetView(false)}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* Bulk delete confirm — destrutiva, daí confirmação dura antes de prosseguir */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {bulkDeleteOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={(e) => { if (e.target === e.currentTarget && !isBulkDeleting) setBulkDeleteOpen(false); }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6"
              >
                <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-6 h-6 text-red-500" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-2">
                  Excluir {selectedIds.size} cliente(s)?
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
                  Os clientes selecionados serão desativados. Conversas, vendas e
                  agendamentos vinculados são preservados pra audit trail.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setBulkDeleteOpen(false)}
                    disabled={isBulkDeleting}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => bulkDeleteClients(Array.from(selectedIds))}
                    disabled={isBulkDeleting}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    {isBulkDeleting ? 'Excluindo...' : `Excluir ${selectedIds.size}`}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Delete confirm */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {deleteConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6"
              >
                <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="w-6 h-6 text-red-500" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white text-center mb-2">Excluir cliente?</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
                  <strong className="text-gray-700 dark:text-gray-300">{deleteConfirm.name}</strong> será removido permanentemente.
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setDeleteConfirm(null)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    Cancelar
                  </button>
                  <button
                    onClick={() => deleteClient(deleteConfirm.id)}
                    disabled={isDeleting}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    {isDeleting ? 'Excluindo...' : 'Excluir'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
