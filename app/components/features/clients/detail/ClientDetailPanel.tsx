'use client';

/**
 * Painel lateral de detalhes do cliente.
 *
 * Shell de tabs (Perfil + Timeline) + composição dos sub-componentes:
 *   - ScoresSection (saúde/scores)
 *   - LoyaltyHistorySection (movimentações de pontos)
 *   - ClientTimeline (histórico agregado de eventos)
 *   - PointsAdjustModal (ajuste manual de pontos)
 *   - TierBadge (badge de tier do programa de fidelidade)
 *   - ClientAgentMemoryPanel (memória do agente IA — fora deste módulo)
 *
 * Fase 2 e 3 da modularização vão adicionar tabs novas (Canais, Campanhas)
 * — esse arquivo é o ponto natural de plug-in delas.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit2, X, Tag, Building2, User, Phone, Mail, MapPin, Calendar, Gift, Settings } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import type { Client, LoyaltyConfig } from '@/lib/types';
import { DEFAULT_LOYALTY_TIERS } from '@/lib/types';
import { STATUS_CONFIG, SOURCE_LABELS, TIPO_LABELS } from '../shared/constants';
import { TierBadge, getClientTier } from '../shared/loyalty';
import ClientAgentMemoryPanel from '../ClientAgentMemoryPanel';
import { ScoresSection } from './ScoresSection';
import { LoyaltyHistorySection } from './LoyaltyHistorySection';
import { ClientTimeline } from './ClientTimeline';
import { ChannelsTab } from './ChannelsTab';
import { CampaignsTab } from './CampaignsTab';
import { PointsAdjustModal } from './PointsAdjustModal';

export function ClientDetailPanel({
  client,
  onClose,
  onEdit,
  loyaltyConfig: loyaltyCfg,
  products = [],
}: {
  client: Client;
  onClose: () => void;
  onEdit: () => void;
  loyaltyConfig?: LoyaltyConfig;
  /** Lookup id→nome de produto pra renderizar acquisitionProductId humanizado.
   *  Mesma lista usada pelo ClientForm; mantém um único query no parent. */
  products?: Array<{ id: string; name: string }>;
}) {
  const { business, user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'perfil' | 'canais' | 'campanhas' | 'timeline'>('perfil');
  const [showPointsAdjust, setShowPointsAdjust] = useState(false);
  const [localPoints, setLocalPoints] = useState<number | null>(null);

  // Reset local points state whenever the selected client changes
  const prevClientId = useState(client.id);
  if (prevClientId[0] !== client.id) {
    prevClientId[1](client.id);
    setLocalPoints(null);
  }

  const displayPoints = localPoints ?? client.loyaltyPoints ?? 0;
  const tiers = loyaltyCfg?.tiers ?? DEFAULT_LOYALTY_TIERS;
  const loyaltyEnabled = loyaltyCfg?.isEnabled ?? false;
  const statusCfg = STATUS_CONFIG[client.status] || STATUS_CONFIG.ganho;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="h-full flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl overflow-hidden shadow-sm flex-shrink-0">
            {client.avatarUrl ? (
              <img src={client.avatarUrl} alt={client.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-white font-bold text-lg">
                {(client.name?.[0] || '?').toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">{client.name}</h3>
            {client.company && <p className="text-xs text-gray-500 dark:text-gray-400">{client.company}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors">
            <Edit2 className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 dark:border-gray-800 px-5 overflow-x-auto">
        {([
          { id: 'perfil',    label: 'Perfil' },
          { id: 'canais',    label: 'Canais' },
          { id: 'campanhas', label: 'Campanhas' },
          { id: 'timeline',  label: 'Timeline' },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap',
              activeTab === tab.id
                ? 'border-red-500 text-red-600 dark:text-red-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Canais */}
      {activeTab === 'canais' && (
        <ChannelsTab client={client} businessId={business?.id ?? ''} />
      )}

      {/* Tab: Campanhas */}
      {activeTab === 'campanhas' && (
        <CampaignsTab clientId={client.id} businessId={business?.id ?? ''} />
      )}

      {/* Tab: Timeline */}
      {activeTab === 'timeline' && (
        <ClientTimeline client={client} businessId={business?.id ?? ''} />
      )}

      {/* Tab: Perfil */}
      {activeTab === 'perfil' && (
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium', statusCfg.color)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', statusCfg.dot)} />
            {statusCfg.label}
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
            {client.tipo === 'pj' ? <Building2 className="w-3 h-3 inline mr-1" /> : <User className="w-3 h-3 inline mr-1" />}
            {TIPO_LABELS[client.tipo || 'pf']}
          </span>
        </div>

        {/* Tags */}
        {client.tags && client.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {client.tags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200/60 dark:border-red-500/20">
                <Tag className="w-2.5 h-2.5" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Total gasto</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(client.totalSpent || 0)}</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Compras</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{client.visitCount || 0}</p>
          </div>
          {(loyaltyEnabled || displayPoints > 0) && (
            <div className="col-span-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gift className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">Pontos de fidelidade</p>
                  <TierBadge points={displayPoints} tiers={tiers} />
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{displayPoints} pts</p>
                  <button
                    onClick={() => setShowPointsAdjust(true)}
                    className="p-1 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-500/30 transition-colors"
                    title="Ajustar pontos"
                  >
                    <Settings className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {/* Tier progress */}
              {(() => {
                const currentTier = getClientTier(displayPoints, tiers);
                const sorted = [...tiers].sort((a, b) => a.minPoints - b.minPoints);
                const nextTier = sorted.find(t => t.minPoints > displayPoints);
                if (!nextTier || !currentTier) return null;
                const range = nextTier.minPoints - currentTier.minPoints;
                if (range === 0) return null;
                const progress = Math.min(100, Math.max(0, ((displayPoints - currentTier.minPoints) / range) * 100));
                return (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] text-amber-600 dark:text-amber-400">
                      <span>{currentTier.name}</span>
                      <span>{nextTier.minPoints - displayPoints} pts para {nextTier.name}</span>
                    </div>
                    <div className="h-1.5 bg-amber-100 dark:bg-amber-900/40 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: nextTier.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </div>
                );
              })()}
              {/* Histórico de pontos */}
              <div className="border-t border-amber-100 dark:border-amber-800/30 pt-2">
                <p className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1.5">Histórico</p>
                <LoyaltyHistorySection clientId={client.id} businessId={business?.id ?? ''} />
              </div>
            </div>
          )}
        </div>

        {/* Scores / Health */}
        <ScoresSection client={client} />

        {/* Contacts */}
        <div className="space-y-2">
          {client.phone && (
            <a href={`tel:${client.phone}`} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors group">
              <Phone className="w-4 h-4 text-gray-400 group-hover:text-red-500 transition-colors" />
              <span className="text-sm text-gray-700 dark:text-gray-300">{client.phone}</span>
            </a>
          )}
          {client.whatsapp && (
            <a href={`https://wa.me/${client.whatsapp?.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors group">
              <Phone className="w-4 h-4 text-gray-400 group-hover:text-green-500 transition-colors" />
              <span className="text-sm text-gray-700 dark:text-gray-300">{client.whatsapp} (WA)</span>
            </a>
          )}
          {client.email && (
            <a href={`mailto:${client.email}`} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors group">
              <Mail className="w-4 h-4 text-gray-400 group-hover:text-red-500 transition-colors" />
              <span className="text-sm text-gray-700 dark:text-gray-300">{client.email}</span>
            </a>
          )}
          {/* Aniversário (PF) ou Fundação (PJ) — base pra automação futura
              de "feliz aniversário". Mostra quantos dias faltam pra vencer
              quando >= hoje, ou "hoje 🎂" quando bate. */}
          {client.birthDate && (() => {
            const isPj = client.tipo === 'pj';
            const label = isPj ? 'Fundação' : 'Nascimento';
            // Parse ISO YYYY-MM-DD como date local pra evitar shift de UTC.
            const [yStr, mStr, dStr] = client.birthDate.split('-');
            const year = Number(yStr); const month = Number(mStr); const day = Number(dStr);
            if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
            const formatted = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const thisYearAnniv = new Date(today.getFullYear(), month - 1, day);
            const nextAnniv = thisYearAnniv >= today
              ? thisYearAnniv
              : new Date(today.getFullYear() + 1, month - 1, day);
            const daysUntil = Math.round((nextAnniv.getTime() - today.getTime()) / 86400000);
            const isToday = daysUntil === 0;
            return (
              <div className="flex items-center gap-3 p-2.5 rounded-lg">
                <Calendar className="w-4 h-4 text-gray-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 dark:text-gray-300">{formatted}</p>
                  <p className={cn(
                    'text-[11px] mt-0.5',
                    isToday
                      ? 'text-amber-600 dark:text-amber-400 font-semibold'
                      : daysUntil <= 7
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-gray-400 dark:text-gray-500',
                  )}>
                    {isToday
                      ? `🎂 ${label} hoje!`
                      : `${label} · em ${daysUntil} dia${daysUntil === 1 ? '' : 's'}`}
                  </p>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Fiscal */}
        {(client.cpfCnpj || client.inscricaoEstadual) && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Dados Fiscais</p>
            {client.cpfCnpj && (
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-gray-500 dark:text-gray-400">{client.tipo === 'pj' ? 'CNPJ' : 'CPF'}</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{client.cpfCnpj}</span>
              </div>
            )}
            {client.inscricaoEstadual && (
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-gray-500 dark:text-gray-400">Insc. Estadual</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{client.inscricaoEstadual}</span>
              </div>
            )}
          </div>
        )}

        {/* Address */}
        {client.endereco && (client.endereco.logradouro || client.endereco.municipio) && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Endereço</p>
            <div className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
              <MapPin className="w-3.5 h-3.5 mt-0.5 text-gray-400 flex-shrink-0" />
              <span>
                {[client.endereco.logradouro, client.endereco.numero, client.endereco.complemento,
                  client.endereco.bairro, client.endereco.municipio, client.endereco.uf]
                  .filter(Boolean).join(', ')}
                {client.endereco.cep && ` — CEP ${client.endereco.cep}`}
              </span>
            </div>
          </div>
        )}

        {/* Notes */}
        {client.notes && (
          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Observações</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{client.notes}</p>
          </div>
        )}

        {/* Metadata */}
        <div className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Origem</span>
            <span className="text-xs text-gray-600 dark:text-gray-400">{SOURCE_LABELS[client.source] || client.source}</span>
          </div>
          {/* Aquisição (Fase 4) — produto e/ou label livre da oferta. Renderiza
              só quando há ao menos um dos dois preenchidos. Concatena com " · "
              quando ambos pra mostrar contexto completo (ex: "Rinoplastia Padrão · Black Friday"). */}
          {(client.acquisitionProductId || client.acquisitionOfferLabel) && (() => {
            const productName = client.acquisitionProductId
              ? products.find(p => p.id === client.acquisitionProductId)?.name
              : null;
            const parts: string[] = [];
            if (productName) parts.push(productName);
            if (client.acquisitionOfferLabel) parts.push(client.acquisitionOfferLabel);
            // Fallback: produto não encontrado mas id existe (lista ainda
            // carregando ou produto deletado) — mostra "Produto removido"
            // pra não esconder a info crítica.
            if (parts.length === 0 && client.acquisitionProductId) {
              parts.push('Produto removido');
            }
            return (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-400 flex-shrink-0">Aquisição</span>
                <span className="text-xs text-gray-600 dark:text-gray-400 text-right truncate" title={parts.join(' · ')}>
                  {parts.join(' · ')}
                </span>
              </div>
            );
          })()}
          {client.lastVisit && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Última compra</span>
              <span className="text-xs text-gray-600 dark:text-gray-400">{formatDate(client.lastVisit)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Cadastrado em</span>
            <span className="text-xs text-gray-600 dark:text-gray-400">{formatDate(client.createdAt)}</span>
          </div>
        </div>

        {/* Agent memory panel — what the AI remembers about this client (LGPD) */}
        <ClientAgentMemoryPanel contactId={client.id} contactName={client.name} />
      </div>
      )} {/* end perfil tab */}

      {/* Points adjust modal */}
      <AnimatePresence>
        {showPointsAdjust && user && (
          <PointsAdjustModal
            client={{ ...client, loyaltyPoints: displayPoints }}
            businessId={business?.id ?? ''}
            user={{ uid: user.uid, name: user.name }}
            onClose={() => setShowPointsAdjust(false)}
            onDone={newBalance => {
              setLocalPoints(newBalance);
              queryClient.invalidateQueries({ queryKey: ['loyalty-history', client.id] });
              queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
