'use client';

/**
 * Aba "Campanhas" do detalhe do cliente.
 *
 * Lista as campanhas (broadcasts) que este cliente recebeu, com:
 *   - Nome da campanha + canal (WA Cloud / WA Web / FB / IG / email)
 *   - Data de envio
 *   - Status da mensagem específica (pending/sent/delivered/read/failed)
 *
 * Estratégia de query (2 hops, paralelizável):
 *   1. broadcastMessages where businessId == X and contactId == clientId
 *      orderBy createdAt desc limit 30. Requer índice composto adicionado em
 *      firestore.indexes.json. Limit 30 cobre 99% dos casos (cliente recebe
 *      poucas dezenas de campanhas no histórico relevante).
 *   2. broadcasts where __name__ in [unique broadcastIds]. Firestore `in`
 *      suporta até 30 IDs — alinha com o limit acima.
 *
 * Quando broadcast original foi apagado, a mensagem ainda mostra o status mas
 * com label "Campanha apagada". O contactId nas broadcastMessages só é setado
 * quando o recipiente foi vinculado a um cliente CRM no momento do envio
 * (ver Broadcast.audienceContactIds) — mensagens de listas paste-only sem
 * vínculo CRM não aparecem aqui.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  collection, query, where, getDocs, orderBy as fsOrderBy,
  limit as firestoreLimit, documentId,
} from 'firebase/firestore';
import {
  Megaphone, Clock, Check, CheckCheck, AlertTriangle, Send,
  Mail, BadgeCheck, Facebook as FacebookIcon, Instagram as InstagramIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { db } from '@/lib/config/firebase';
import { formatDate } from '@/lib/utils/format';
import type {
  Broadcast, BroadcastMessage, BroadcastChannel, BroadcastMessageStatus,
} from '@/lib/types';
import { WhatsAppIcon } from '@/app/components/features/crm/SourceIcon';

// Status display map — preserva ordem natural pending → sent → delivered → read,
// e failed como vermelho destacado. CheckCheck pra delivered/read espelha o
// padrão WhatsApp (1 check = sent, 2 = delivered, 2 azul = read).
const STATUS_CFG: Record<BroadcastMessageStatus, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  pending:   { label: 'Pendente',  icon: Clock,         color: 'text-gray-500',                                bg: 'bg-gray-100 dark:bg-gray-800/60' },
  sent:      { label: 'Enviada',   icon: Check,         color: 'text-blue-600 dark:text-blue-400',             bg: 'bg-blue-50 dark:bg-blue-500/10' },
  delivered: { label: 'Entregue',  icon: CheckCheck,    color: 'text-emerald-600 dark:text-emerald-400',       bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
  read:      { label: 'Lida',      icon: CheckCheck,    color: 'text-purple-600 dark:text-purple-400',         bg: 'bg-purple-50 dark:bg-purple-500/10' },
  failed:    { label: 'Falhou',    icon: AlertTriangle, color: 'text-red-600 dark:text-red-400',               bg: 'bg-red-50 dark:bg-red-500/10' },
};

// Map de canal pra ícone + label visível no card. Inclui email (broadcast pode
// ser por email no canal omnichannel completo) e os 3 omni padrão.
const CHANNEL_CFG: Record<BroadcastChannel, { label: string; icon: React.ElementType; color: string }> = {
  whatsapp:  { label: 'WhatsApp',  icon: WhatsAppIcon, color: '#25D366' },
  facebook:  { label: 'Facebook',  icon: FacebookIcon, color: '#0866FF' },
  instagram: { label: 'Instagram', icon: InstagramIcon, color: '#E1306C' },
  email:     { label: 'E-mail',    icon: Mail,         color: '#EF4444' },
};

interface CampaignRow {
  message: BroadcastMessage;
  broadcast: Broadcast | null; // null quando broadcast foi apagado
}

export function CampaignsTab({ client, businessId }: { client: { id: string }; businessId: string }) {
  // Step 1: messages do contato. Index: (businessId, contactId, createdAt DESC).
  const { data: messages = [], isLoading: loadingMsgs } = useQuery({
    queryKey: ['client-broadcast-messages', client.id, businessId],
    queryFn: async (): Promise<BroadcastMessage[]> => {
      const snap = await getDocs(query(
        collection(db, 'broadcastMessages'),
        where('businessId', '==', businessId),
        where('contactId', '==', client.id),
        fsOrderBy('createdAt', 'desc'),
        firestoreLimit(30),
      ));
      return snap.docs.map(d => ({ ...(d.data() as BroadcastMessage), id: d.id }));
    },
    enabled: !!client.id && !!businessId,
    staleTime: 60 * 1000,
  });

  // Step 2: broadcasts referenciados pelas mensagens (1 query `in` cobre até 30
  // broadcastIds, alinhado com o limit acima). Quando o cliente recebe a
  // mesma campanha múltiplas vezes (retry), broadcastIds duplicam — Set elimina.
  const broadcastIds = useMemo(
    () => Array.from(new Set(messages.map(m => m.broadcastId).filter(Boolean))),
    [messages],
  );

  const { data: broadcastsById = new Map<string, Broadcast>(), isLoading: loadingBroadcasts } = useQuery({
    queryKey: ['client-broadcasts-by-id', businessId, broadcastIds.join(',')],
    queryFn: async (): Promise<Map<string, Broadcast>> => {
      if (broadcastIds.length === 0) return new Map();
      const snap = await getDocs(query(
        collection(db, 'broadcasts'),
        where('businessId', '==', businessId),
        where(documentId(), 'in', broadcastIds.slice(0, 30)),
      ));
      const map = new Map<string, Broadcast>();
      snap.docs.forEach(d => map.set(d.id, { ...(d.data() as Broadcast), id: d.id }));
      return map;
    },
    enabled: broadcastIds.length > 0,
    staleTime: 5 * 60 * 1000, // broadcasts mudam pouco depois de criados
  });

  const rows: CampaignRow[] = useMemo(
    () => messages.map(m => ({ message: m, broadcast: broadcastsById.get(m.broadcastId) ?? null })),
    [messages, broadcastsById],
  );

  const isLoading = loadingMsgs || (broadcastIds.length > 0 && loadingBroadcasts);

  if (isLoading) {
    return (
      <div className="p-5 space-y-2.5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border border-gray-100 dark:border-gray-800 p-3 flex gap-3">
            <div className="w-9 h-9 rounded-xl shimmer flex-shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 rounded shimmer w-3/4" />
              <div className="h-2.5 rounded shimmer w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-5">
        <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center">
          <Megaphone className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            Nenhuma campanha enviada
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Quando você incluir este cliente em um broadcast (CRM → Campanhas),
            o histórico aparece aqui.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-2.5">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {rows.length} campanha{rows.length === 1 ? '' : 's'} enviada{rows.length === 1 ? '' : 's'} para este cliente.
      </p>

      {rows.map(({ message, broadcast }) => {
        const statusCfg = STATUS_CFG[message.status] ?? STATUS_CFG.pending;
        const StatusIcon = statusCfg.icon;
        const channelCfg = broadcast ? CHANNEL_CFG[broadcast.channel] : null;
        const ChannelIcon = channelCfg?.icon;
        const sentAt = message.sentAt || message.createdAt;

        return (
          <div
            key={message.id}
            className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 p-3 transition-colors hover:border-gray-300 dark:hover:border-gray-600"
          >
            <div className="flex items-start gap-3">
              {/* Channel icon — mesma técnica de cor por wrapper currentColor */}
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={channelCfg ? { backgroundColor: channelCfg.color + '18', color: channelCfg.color } : undefined}
              >
                {ChannelIcon ? <ChannelIcon className="w-4 h-4" /> : <Send className="w-4 h-4 text-gray-400" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {broadcast?.name ?? 'Campanha apagada'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                      {channelCfg && <span>{channelCfg.label}</span>}
                      {channelCfg && <span>·</span>}
                      <span>{sentAt ? formatDate(sentAt) : '—'}</span>
                      {/* Sessão de retry tag — só aparece se sessionIndex > 1
                          (1 = primeiro dispatch, padrão; 2+ = retomada parcial) */}
                      {message.sessionIndex && message.sessionIndex > 1 && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                            <BadgeCheck className="w-3 h-3" />
                            Retry #{message.sessionIndex}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status pill */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0',
                      statusCfg.bg, statusCfg.color,
                    )}
                  >
                    <StatusIcon className="w-3 h-3" />
                    {statusCfg.label}
                  </span>
                </div>

                {/* Erro detalhado quando falhou — operador entende o motivo
                    sem precisar abrir a campanha em CRM → Campanhas. */}
                {message.status === 'failed' && message.errorMessage && (
                  <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400 break-words line-clamp-2">
                    {message.errorMessage}
                  </p>
                )}

                {/* Read/delivered timing — útil quando operador quer saber
                    se o cliente abriu antes de uma ligação follow-up. */}
                {message.readAt && (
                  <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                    Lida em {formatDate(message.readAt)}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {messages.length === 30 && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center pt-2">
          Mostrando 30 mais recentes. Histórico completo no Firestore.
        </p>
      )}
    </div>
  );
}
