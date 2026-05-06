'use client';

/**
 * Timeline agregada de eventos do cliente — aba "Timeline" do detalhe.
 *
 * Faz 4 queries paralelas (conversations / appointments / sales / transactions)
 * filtrando por businessId + clientId, mescla resultados, deduplica por ID e
 * ordena descendente. Cada query usa safeQuery pra que falha em uma coleção
 * (ex: rules bloqueando) não derrube as outras.
 *
 * Limita 20 docs por coleção (80 total) — render fluida, e operador raramente
 * precisa scroll passado disso. Visão completa fica pra módulo dedicado futuro.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { collection, query, where, getDocs, limit as firestoreLimit } from 'firebase/firestore';
import {
  History, Clock, MessageSquare, Calendar, ShoppingCart,
  TrendingUp, TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { db } from '@/lib/config/firebase';
import { formatCurrency } from '@/lib/utils/format';
import type { Client } from '@/lib/types';

type TimelineEventKind = 'conversation' | 'appointment' | 'sale' | 'transaction_in' | 'transaction_out';

interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  title: string;
  subtitle?: string;
  amount?: number;
  status?: string;
  timestamp: string;
}

const TL_CFG: Record<TimelineEventKind, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  conversation:    { icon: MessageSquare, color: 'text-blue-500',    bg: 'bg-blue-50 dark:bg-blue-500/10',    label: 'Conversa'    },
  appointment:     { icon: Calendar,      color: 'text-purple-500',  bg: 'bg-purple-50 dark:bg-purple-500/10', label: 'Agendamento' },
  sale:            { icon: ShoppingCart,  color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', label: 'Venda'    },
  transaction_in:  { icon: TrendingUp,    color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', label: 'Receita'  },
  transaction_out: { icon: TrendingDown,  color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-500/10',      label: 'Despesa'    },
};

const APPT_STATUS_LABEL: Record<string, string> = {
  agendado: 'Agendado', confirmado: 'Confirmado', concluido: 'Concluído',
  cancelado: 'Cancelado', 'no-show': 'Não compareceu', remarcado: 'Remarcado',
};
const CONV_STATUS_LABEL: Record<string, string> = { open: 'Aberta', waiting: 'Aguardando', resolved: 'Resolvida' };
const TX_STATUS_LABEL: Record<string, string> = { pendente: 'Pendente', pago: 'Pago', atrasado: 'Atrasado', cancelado: 'Cancelado' };
const CH_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram' };

function tlRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d > 365 ? '2-digit' : undefined });
  } catch { return '—'; }
}

async function safeQuery<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

export function ClientTimeline({ client, businessId }: { client: Client; businessId: string }) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['client-timeline', client.id, businessId],
    queryFn: async (): Promise<TimelineEvent[]> => {
      const all: TimelineEvent[] = [];

      const [convSnap, apptSnap, salesSnap, txSnap] = await Promise.all([
        safeQuery(() => getDocs(query(
          collection(db, 'conversations'),
          where('businessId', '==', businessId),
          where('crmContactId', '==', client.id),
          firestoreLimit(20),
        ))),
        safeQuery(() => getDocs(query(
          collection(db, 'appointments'),
          where('businessId', '==', businessId),
          where('clientId', '==', client.id),
          firestoreLimit(20),
        ))),
        safeQuery(() => getDocs(query(
          collection(db, 'sales'),
          where('businessId', '==', businessId),
          where('clientId', '==', client.id),
          firestoreLimit(20),
        ))),
        safeQuery(() => getDocs(query(
          collection(db, 'transactions'),
          where('businessId', '==', businessId),
          where('clientId', '==', client.id),
          firestoreLimit(20),
        ))),
      ]);

      convSnap?.docs?.forEach(d => {
        const v = d.data();
        all.push({
          id: `conv_${d.id}`, kind: 'conversation',
          title: `Conversa via ${CH_LABEL[v.channel] ?? v.channel}`,
          subtitle: v.lastMessage ? String(v.lastMessage).slice(0, 70) : undefined,
          status: v.status,
          timestamp: v.lastMessageAt || v.createdAt || '',
        });
      });

      apptSnap?.docs?.forEach(d => {
        const v = d.data();
        const dateStr = v.date ? `${v.date}T${v.startTime ?? '00:00'}` : (v.createdAt || '');
        all.push({
          id: `appt_${d.id}`, kind: 'appointment',
          title: v.serviceName || 'Agendamento',
          subtitle: v.professionalName ? `com ${v.professionalName} • ${v.date} ${v.startTime}` : `${v.date ?? ''} às ${v.startTime ?? ''}`,
          amount: v.price,
          status: v.status,
          timestamp: dateStr,
        });
      });

      salesSnap?.docs?.forEach(d => {
        const v = d.data();
        const items: Array<{ description: string }> = v.items || [];
        all.push({
          id: `sale_${d.id}`, kind: 'sale',
          title: `Venda — ${items.length} item${items.length !== 1 ? 's' : ''}`,
          subtitle: items.slice(0, 2).map(i => i.description).join(', ') || undefined,
          amount: v.total,
          status: v.status,
          timestamp: v.createdAt || '',
        });
      });

      txSnap?.docs?.forEach(d => {
        const v = d.data();
        all.push({
          id: `tx_${d.id}`, kind: v.type === 'receita' ? 'transaction_in' : 'transaction_out',
          title: v.description || (v.type === 'receita' ? 'Receita' : 'Despesa'),
          subtitle: v.category || undefined,
          amount: v.amount,
          status: v.status,
          timestamp: v.paymentDate || v.dueDate || v.createdAt || '',
        });
      });

      // Sort descending; empty timestamps go to end
      all.sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0;
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return b.timestamp.localeCompare(a.timestamp);
      });
      const seen = new Set<string>();
      return all.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
    },
    enabled: !!client.id && !!businessId,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-8 h-8 rounded-full shimmer flex-shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 rounded shimmer w-3/4" />
              <div className="h-2.5 rounded shimmer w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-5 text-center">
        <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
          <History className="w-5 h-5 text-gray-400" />
        </div>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Sem histórico ainda</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Conversas, compras e agendamentos aparecerão aqui
        </p>
      </div>
    );
  }

  return (
    <div className="relative px-5 py-4">
      {/* linha vertical */}
      <div className="absolute left-[2.35rem] top-4 bottom-4 w-px bg-gray-100 dark:bg-gray-800" />

      <div className="space-y-5">
        {events.map(ev => {
          const cfg = TL_CFG[ev.kind];
          const Icon = cfg.icon;
          const statusLabel =
            ev.kind === 'appointment'     ? APPT_STATUS_LABEL[ev.status ?? ''] :
            ev.kind === 'conversation'    ? CONV_STATUS_LABEL[ev.status ?? ''] :
            ev.kind === 'transaction_in' || ev.kind === 'transaction_out'
                                          ? TX_STATUS_LABEL[ev.status ?? '']   : undefined;

          return (
            <div key={ev.id} className="flex gap-3 relative">
              <div className={cn('w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center z-10 ring-2 ring-white dark:ring-gray-900', cfg.bg)}>
                <Icon className={cn('w-3.5 h-3.5', cfg.color)} />
              </div>
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-snug">
                      {ev.title}
                    </p>
                    {ev.subtitle && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{ev.subtitle}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {tlRelative(ev.timestamp)}
                    </span>
                    {ev.amount != null && ev.amount > 0 && (
                      <span className={cn('text-[10px] font-bold', cfg.color)}>
                        {formatCurrency(ev.amount)}
                      </span>
                    )}
                  </div>
                </div>
                {statusLabel && (
                  <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    {statusLabel}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
