'use client';

/**
 * Modal CRUD de ofertas — Fase 4B do módulo Clientes.
 *
 * Acessado via "Gerenciar ofertas" no ClientForm. Admin/founder cria/edita/
 * desativa; operador só lê (rule no firestore.rules cobre).
 *
 * Lista todas as ofertas do business (ativas + arquivadas) num único modal
 * com inline-edit. Campanha vencida (validUntil < hoje) recebe label visual
 * "expirada" mas continua selecionável — operador pode tagear cliente que
 * veio antes do fim mas só foi cadastrado depois.
 *
 * Sem stats agregados ainda — campos contactCount/conversionCount/totalRevenue
 * só são exibidos quando preenchidos (jobs futuros populam).
 */

import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  Megaphone, X, Plus, Edit2, Trash2, Power, PowerOff,
  Calendar, Package, Users as UsersIcon,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  collection, query, where, getDocs, addDoc, updateDoc,
  deleteDoc, doc, orderBy as fsOrderBy, deleteField,
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { db } from '@/lib/config/firebase';
import { formatDate } from '@/lib/utils/format';
import type { Offer, ConversationChannel } from '@/lib/types';

interface OfferFormData {
  name: string;
  description: string;
  productId: string;
  channel: '' | ConversationChannel | 'multi';
  validFrom: string;
  validUntil: string;
}

const emptyOfferForm: OfferFormData = {
  name: '', description: '', productId: '',
  channel: '', validFrom: '', validUntil: '',
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  facebook: 'Facebook',
  instagram: 'Instagram',
  multi: 'Multi-canal',
};

export function OffersManagerModal({
  businessId,
  user,
  products,
  onClose,
}: {
  businessId: string;
  user: { uid: string; name: string };
  products: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Offer | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<OfferFormData>(emptyOfferForm);
  const [showInactive, setShowInactive] = useState(false);

  const { data: offers = [], isLoading } = useQuery({
    queryKey: ['offers', businessId],
    queryFn: async (): Promise<Offer[]> => {
      const snap = await getDocs(query(
        collection(db, 'offers'),
        where('businessId', '==', businessId),
        fsOrderBy('createdAt', 'desc'),
      ));
      return snap.docs.map(d => ({ ...(d.data() as Offer), id: d.id }));
    },
    enabled: !!businessId,
    staleTime: 60 * 1000,
  });

  const visibleOffers = useMemo(
    () => showInactive ? offers : offers.filter(o => o.isActive !== false),
    [offers, showInactive],
  );

  // Stats on-demand (Fase 4C-2): conta clientes e campanhas vinculados
  // a cada oferta. Single query simples (where businessId ==), filtro client-side
  // pra evitar exigir índices compostos (`!=` requer ordering específica).
  // Cache 2min — operador abre modal poucas vezes por sessão.
  // Trade-off: download de TODOS os clients/broadcasts do business no open
  // do modal (raramente mais que 2k docs total). Não leak entre tenants
  // porque businessId já filtra. Pra business grande (10k+ clients) considerar
  // cron que denormaliza pro Offer.contactCount/broadcastCount em iteração futura.
  const { data: offerStats = { clients: new Map<string, number>(), broadcasts: new Map<string, number>() } } = useQuery({
    queryKey: ['offer-stats', businessId],
    queryFn: async () => {
      const [clientSnap, broadcastSnap] = await Promise.all([
        getDocs(query(collection(db, 'clients'), where('businessId', '==', businessId))),
        getDocs(query(collection(db, 'broadcasts'), where('businessId', '==', businessId))),
      ]);
      const clients = new Map<string, number>();
      const broadcasts = new Map<string, number>();
      clientSnap.docs.forEach(d => {
        const offerId = d.data().acquisitionOfferId as string | undefined;
        if (!offerId) return;
        clients.set(offerId, (clients.get(offerId) ?? 0) + 1);
      });
      broadcastSnap.docs.forEach(d => {
        const offerId = d.data().offerId as string | undefined;
        if (!offerId) return;
        broadcasts.set(offerId, (broadcasts.get(offerId) ?? 0) + 1);
      });
      return { clients, broadcasts };
    },
    enabled: !!businessId,
    staleTime: 2 * 60 * 1000,
  });

  const { mutate: saveOffer, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Nome é obrigatório');
      const now = new Date().toISOString();
      const payload: Record<string, unknown> = {
        businessId,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        productId: form.productId || undefined,
        channel: form.channel || undefined,
        validFrom: form.validFrom || undefined,
        validUntil: form.validUntil || undefined,
        isActive: editing?.isActive ?? true,
        updatedAt: now,
      };
      if (editing) {
        // updateDoc rejeita undefined — converte pra deleteField() pra limpar
        // campos opcionais quando user esvaziar (ex: tirou o produto vinculado).
        // Sem isso, edit mantém valores antigos no Firestore.
        const updatePayload = Object.fromEntries(
          Object.entries(payload).map(([k, v]) => [k, v === undefined ? deleteField() : v]),
        );
        await updateDoc(doc(db, 'offers', editing.id), updatePayload);
      } else {
        // addDoc: remove undefined pra não gravar campos vazios
        const cleaned = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
        await addDoc(collection(db, 'offers'), {
          ...cleaned,
          createdAt: now,
          createdBy: user.uid,
          createdByName: user.name,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers', businessId] });
      setShowForm(false);
      setEditing(null);
      setForm(emptyOfferForm);
      toast.success(editing ? 'Oferta atualizada!' : 'Oferta criada!');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Erro ao salvar oferta');
    },
  });

  const { mutate: toggleActive } = useMutation({
    mutationFn: async (offer: Offer) => {
      await updateDoc(doc(db, 'offers', offer.id), {
        isActive: !offer.isActive,
        updatedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers', businessId] });
    },
  });

  const { mutate: deleteOffer } = useMutation({
    mutationFn: async (offer: Offer) => {
      // Hard delete — clientes que tinham acquisitionOfferId apontando vão
      // mostrar "Oferta removida" via fallback no DetailPanel/badge. Preferimos
      // hard delete a soft (isActive=false já cobre arquivar sem perder histórico).
      await deleteDoc(doc(db, 'offers', offer.id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers', businessId] });
      toast.success('Oferta excluída');
    },
  });

  const startEdit = (o: Offer) => {
    setEditing(o);
    setForm({
      name: o.name,
      description: o.description ?? '',
      productId: o.productId ?? '',
      channel: o.channel ?? '',
      validFrom: o.validFrom ?? '',
      validUntil: o.validUntil ?? '',
    });
    setShowForm(true);
  };

  const startCreate = () => {
    setEditing(null);
    setForm(emptyOfferForm);
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditing(null);
    setForm(emptyOfferForm);
  };

  const inputCls = 'w-full bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-400 transition-all';
  const labelCls = 'block text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wider';

  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-2xl max-h-[calc(100vh-2rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700/50 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
              <Megaphone className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Ofertas</h3>
              <p className="text-[10px] text-gray-400">
                Catálogo reusável — vincule clientes via "Aquisição" no cadastro
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {showForm ? (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                {editing ? 'Editar oferta' : 'Nova oferta'}
              </h4>
              <div>
                <label className={labelCls}>Nome *</label>
                <input
                  className={inputCls}
                  placeholder="ex: Black Friday Rinoplastia 2026"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelCls}>Descrição (opcional)</label>
                <textarea
                  className={cn(inputCls, 'resize-none')}
                  rows={2}
                  placeholder="Detalhes internos sobre a oferta — não exibido pro cliente"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Produto associado</label>
                  <select
                    className={inputCls}
                    value={form.productId}
                    onChange={e => setForm(f => ({ ...f, productId: e.target.value }))}
                  >
                    <option value="">— Sem produto específico —</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Canal principal</label>
                  <select
                    className={inputCls}
                    value={form.channel}
                    onChange={e => setForm(f => ({ ...f, channel: e.target.value as OfferFormData['channel'] }))}
                  >
                    <option value="">— Não definido —</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                    <option value="multi">Multi-canal</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Válida de</label>
                  <input
                    className={inputCls}
                    type="date"
                    value={form.validFrom}
                    onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>Válida até</label>
                  <input
                    className={inputCls}
                    type="date"
                    value={form.validUntil}
                    onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={cancelForm}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => saveOffer()}
                  disabled={!form.name.trim() || isSaving}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-semibold"
                >
                  {isSaving ? 'Salvando...' : editing ? 'Atualizar' : 'Criar'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between gap-3 mb-3">
                <button
                  onClick={startCreate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nova oferta
                </button>
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={e => setShowInactive(e.target.checked)}
                    className="rounded accent-red-500"
                  />
                  Mostrar arquivadas
                </label>
              </div>

              {/* List */}
              {isLoading && (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-14 rounded-xl shimmer" />
                  ))}
                </div>
              )}

              {!isLoading && visibleOffers.length === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center">
                  <Megaphone className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Nenhuma oferta {showInactive ? '' : 'ativa'}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Crie a primeira pra rastrear acquisição por campanha.
                  </p>
                </div>
              )}

              {!isLoading && visibleOffers.length > 0 && (
                <div className="space-y-2">
                  {visibleOffers.map(o => {
                    const productName = o.productId
                      ? products.find(p => p.id === o.productId)?.name
                      : null;
                    const isExpired = o.validUntil
                      ? new Date(o.validUntil) < new Date()
                      : false;
                    return (
                      <div
                        key={o.id}
                        className={cn(
                          'rounded-xl border p-3 transition-colors',
                          !o.isActive && 'opacity-50',
                          'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                {o.name}
                              </span>
                              {!o.isActive && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">
                                  Arquivada
                                </span>
                              )}
                              {isExpired && o.isActive && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400">
                                  Expirada
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500 dark:text-gray-400 flex-wrap">
                              {productName && (
                                <span className="inline-flex items-center gap-1">
                                  <Package className="w-3 h-3" />
                                  {productName}
                                </span>
                              )}
                              {o.channel && (
                                <span>{CHANNEL_LABELS[o.channel] ?? o.channel}</span>
                              )}
                              {o.validFrom && (
                                <span className="inline-flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {formatDate(o.validFrom)}{o.validUntil ? ` → ${formatDate(o.validUntil)}` : ''}
                                </span>
                              )}
                              {(() => {
                                // Stats on-demand (Fase 4C-2): prioriza valor
                                // computado live sobre o denormalizado (que vem
                                // de jobs futuros). Quando 0, esconde o pill.
                                const liveClients = offerStats.clients.get(o.id) ?? 0;
                                const liveBroadcasts = offerStats.broadcasts.get(o.id) ?? 0;
                                const clientCount = liveClients || (o.contactCount ?? 0);
                                return (
                                  <>
                                    {clientCount > 0 && (
                                      <span className="inline-flex items-center gap-1">
                                        <UsersIcon className="w-3 h-3" />
                                        {clientCount} cliente{clientCount === 1 ? '' : 's'}
                                      </span>
                                    )}
                                    {liveBroadcasts > 0 && (
                                      <span className="inline-flex items-center gap-1">
                                        <Megaphone className="w-3 h-3" />
                                        {liveBroadcasts} campanha{liveBroadcasts === 1 ? '' : 's'}
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                            {o.description && (
                              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 line-clamp-1">
                                {o.description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => toggleActive(o)}
                              title={o.isActive ? 'Arquivar' : 'Reativar'}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600"
                            >
                              {o.isActive ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => startEdit(o)}
                              title="Editar"
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Excluir "${o.name}"? Clientes vinculados a esta oferta vão mostrar "Oferta removida".`)) {
                                  deleteOffer(o);
                                }
                              }}
                              title="Excluir"
                              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
