'use client';

/**
 * Modal de vinculação manual de duplicata.
 *
 * Usado no ClientDetailPanel quando o operador identifica visualmente que dois
 * clientes são a mesma pessoa mas o detector automático (MergeModal em
 * ClientsModule) não pegou — comum quando os contatos divergem em todos os
 * campos comparados (CPF/email/telefone) mas o operador reconhece a pessoa
 * pelo nome, histórico ou outro sinal externo.
 *
 * Fluxo:
 *   1. Operador abre o painel do cliente A
 *   2. Clica "Vincular duplicata" → este modal
 *   3. Busca por nome/telefone/email/CPF e seleciona cliente B
 *   4. Escolhe qual manter como primary (default: A, que iniciou a ação)
 *   5. Mescla via mergeClients() — mesma lógica do MergeModal automático
 */

import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Search, X, Users, CheckCircle2, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { isActiveClient } from '@/lib/utils/clientFilters';
import type { Client } from '@/lib/types';
import { mergeClients } from '../shared/mergeClients';
import { digits, normEmail } from '../shared/duplicates';

export function ManualMergeModal({
  currentClient,
  allClients,
  businessId,
  onClose,
  onDone,
}: {
  currentClient: Client;
  allClients: Client[];
  businessId: string;
  onClose: () => void;
  /** Chamado após merge bem-sucedido. Recebe o id do registro DESATIVADO
   *  (secondary) — útil pro caller decidir se fecha o painel (caso o
   *  cliente atualmente aberto tenha virado o secondary). */
  onDone: (mergedSecondaryId: string) => void;
}) {
  const [step, setStep] = useState<'search' | 'confirm'>('search');
  const [otherClient, setOtherClient] = useState<Client | null>(null);
  const [primaryId, setPrimaryId] = useState<string>(currentClient.id);
  const [fillEmpty, setFillEmpty] = useState(true);
  const [merging, setMerging] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Candidatos: ativos, não-merged, excluindo o cliente atual. Cap em 50 pra
  // evitar renderizar lista gigante quando o termo é vazio/curto.
  const candidates = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const termDigits = digits(searchTerm);
    return allClients
      .filter(c => c.id !== currentClient.id && isActiveClient(c))
      .filter(c => {
        if (!term) return true;
        if (c.name?.toLowerCase().includes(term)) return true;
        if (normEmail(c.email).includes(term)) return true;
        if (c.company?.toLowerCase().includes(term)) return true;
        if (termDigits) {
          if (digits(c.phone).includes(termDigits)) return true;
          if (digits(c.whatsapp).includes(termDigits)) return true;
          if (digits(c.cpfCnpj).includes(termDigits)) return true;
        }
        return false;
      })
      .slice(0, 50);
  }, [allClients, currentClient.id, searchTerm]);

  const handleSelect = (c: Client) => {
    setOtherClient(c);
    setPrimaryId(currentClient.id);
    setStep('confirm');
  };

  const handleMerge = async () => {
    if (!otherClient || merging) return;
    const primary = primaryId === currentClient.id ? currentClient : otherClient;
    const secondary = primaryId === currentClient.id ? otherClient : currentClient;
    setMerging(true);
    try {
      await mergeClients({ primary, secondary, businessId, fillEmpty });
      onDone(secondary.id);
    } catch (err) {
      console.error('[ManualMerge] failed:', err);
      setMerging(false);
    }
  };

  if (typeof document === 'undefined') return null;

  const primaryFirstName = (
    primaryId === currentClient.id ? currentClient.name : otherClient?.name
  )?.split(' ')[0] || '';

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget && !merging) onClose(); }}
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
            {step === 'confirm' && !merging && (
              <button
                onClick={() => { setStep('search'); setOtherClient(null); }}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 flex-shrink-0"
                title="Voltar"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-amber-500" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900 dark:text-white text-sm">
                {step === 'search' ? 'Vincular duplicata' : 'Confirmar mesclagem'}
              </h2>
              <p className="text-[10px] text-gray-400 truncate">
                {step === 'search'
                  ? `Selecione o cliente que é a mesma pessoa que "${currentClient.name}"`
                  : 'Escolha qual registro será mantido'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={merging}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors flex-shrink-0 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'search' ? (
          <>
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por nome, telefone, email, CPF/CNPJ..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                />
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-2 min-h-[200px]">
              {candidates.length === 0 ? (
                <div className="text-center py-10 text-xs text-gray-400">
                  {searchTerm ? 'Nenhum cliente encontrado' : 'Digite para buscar...'}
                </div>
              ) : (
                <ul className="space-y-1">
                  {candidates.map(c => (
                    <li key={c.id}>
                      <button
                        onClick={() => handleSelect(c)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors text-left"
                      >
                        <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0">
                          {c.avatarUrl ? (
                            <img src={c.avatarUrl} alt={c.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white text-xs font-bold">
                              {(c.name?.[0] ?? '?').toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{c.name}</p>
                          <p className="text-[10px] text-gray-400 truncate">
                            {[c.phone, c.email, c.cpfCnpj].filter(Boolean).join(' · ') || 'Sem contato'}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          otherClient && (
            <div className="p-5 overflow-y-auto flex-1">
              <div className="flex items-stretch gap-3">
                <ClientCard
                  client={currentClient}
                  isPrimary={primaryId === currentClient.id}
                  onSelect={() => !merging && setPrimaryId(currentClient.id)}
                />
                <div className="flex items-center text-xs font-bold text-gray-400 flex-shrink-0">VS</div>
                <ClientCard
                  client={otherClient}
                  isPrimary={primaryId === otherClient.id}
                  onSelect={() => !merging && setPrimaryId(otherClient.id)}
                />
              </div>
              <label className={cn(
                'flex items-center gap-2 mt-4',
                merging ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              )}>
                <input
                  type="checkbox"
                  checked={fillEmpty}
                  onChange={e => setFillEmpty(e.target.checked)}
                  disabled={merging}
                  className="accent-red-500"
                />
                <span className="text-xs text-gray-700 dark:text-gray-300">Copiar campos vazios + somar totais</span>
              </label>
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={onClose}
                  disabled={merging}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleMerge}
                  disabled={merging}
                  className="flex-1 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {merging
                    ? 'Mesclando...'
                    : primaryFirstName
                      ? `Mesclar — manter ${primaryFirstName}`
                      : 'Mesclar'}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-3 text-center">
                Clicar no card verde seleciona qual registro será mantido. O outro é desativado e suas conversas, compras e agendamentos são transferidos.
              </p>
            </div>
          )
        )}
      </motion.div>
    </motion.div>,
    document.body
  );
}

function ClientCard({
  client,
  isPrimary,
  onSelect,
}: {
  client: Client;
  isPrimary: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      // `min-w-0` conserta overflow horizontal: sem ele, flex-1 não shrinka
      // abaixo do tamanho intrínseco do conteúdo (nomes longos forçam o card
      // a crescer e cortam o adjacente no eixo X).
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
        {client.email   && <p className="truncate">✉ {client.email}</p>}
        {client.phone   && <p className="truncate">📞 {client.phone}</p>}
        {client.cpfCnpj && <p className="truncate">📄 {client.cpfCnpj}</p>}
        {(client.totalSpent ?? 0) > 0 && (
          <p className="text-emerald-600 dark:text-emerald-400 font-medium truncate">💰 {formatCurrency(client.totalSpent ?? 0)}</p>
        )}
        <p className="text-gray-300 dark:text-gray-600 truncate">Cadastro: {formatDate(client.createdAt)}</p>
      </div>
    </div>
  );
}
