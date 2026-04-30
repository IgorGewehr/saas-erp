'use client';

/**
 * BroadcastDetailDialog — painel de detalhes de uma campanha
 *
 * Mostra:
 *  - Stats agregadas (total/sent/delivered/read/failed)
 *  - Lista paginada de BroadcastMessages (1 por recipiente)
 *  - Filtro por status (pending/sent/delivered/read/failed)
 *  - Botão "Reenviar falhados" que cria novo broadcast retry
 *
 * Real-time via onSnapshot — stats e mensagens atualizam quando webhook
 * Meta processa delivered/read.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, doc, query, where, orderBy, onSnapshot, limit as firestoreLimit } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/config/firebase';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { X, RefreshCw, Loader2, AlertTriangle, Check, CheckCheck, Clock, Send, Shield } from 'lucide-react';
import type { Broadcast, BroadcastMessage, BroadcastMessageStatus } from '@/lib/types';
import { CONSENT_BASIS_LABELS } from '@/lib/types';
import BroadcastMetricsPanel from './BroadcastMetricsPanel';

const STATUS_CFG: Record<BroadcastMessageStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:   { label: 'Pendente',  color: 'text-gray-500 bg-gray-100 dark:bg-white/[0.06]',                      icon: <Clock className="w-3 h-3" /> },
  sent:      { label: 'Enviada',   color: 'text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400',     icon: <Check className="w-3 h-3" /> },
  delivered: { label: 'Entregue',  color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400', icon: <CheckCheck className="w-3 h-3" /> },
  read:      { label: 'Lida',      color: 'text-purple-600 bg-purple-50 dark:bg-purple-500/10 dark:text-purple-400', icon: <CheckCheck className="w-3 h-3" /> },
  failed:    { label: 'Falhou',    color: 'text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-400',         icon: <AlertTriangle className="w-3 h-3" /> },
};

interface Props {
  broadcast: Broadcast;
  onClose: () => void;
  onRetryCreated?: (newBroadcastId: string) => void;
}

export default function BroadcastDetailDialog({ broadcast: initialBroadcast, onClose, onRetryCreated }: Props) {
  // Real-time do próprio broadcast doc — prop inicial é só seed.
  // Sem isso, status/recipients ficam stale após dispatch/resume e UI mostra
  // botões errados (ex: "Disparar agora" após envio bem-sucedido).
  const [broadcast, setBroadcast] = useState<Broadcast>(initialBroadcast);
  const [messages, setMessages] = useState<BroadcastMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<BroadcastMessageStatus | 'all'>('all');
  const [retrying, setRetrying] = useState(false);

  // Listener do broadcast doc (sincroniza status, recipients, stats)
  useEffect(() => {
    const ref = doc(db, 'broadcasts', initialBroadcast.id);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setBroadcast({ ...(snap.data() as Broadcast), id: snap.id });
      }
    });
    return () => unsub();
  }, [initialBroadcast.id]);

  // Real-time listener das mensagens deste broadcast (limit 500 — UI prática para listas grandes)
  useEffect(() => {
    const q = query(
      collection(db, 'broadcastMessages'),
      where('broadcastId', '==', broadcast.id),
      orderBy('createdAt', 'asc'),
      firestoreLimit(500),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setMessages(snap.docs.map(d => ({ ...(d.data() as BroadcastMessage), id: d.id })));
        setLoading(false);
      },
      (err) => {
        console.error('[BroadcastDetail] snapshot error:', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [broadcast.id]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: messages.length, pending: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    messages.forEach(m => { c[m.status] = (c[m.status] ?? 0) + 1; });
    return c;
  }, [messages]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return messages;
    return messages.filter(m => m.status === statusFilter);
  }, [messages, statusFilter]);

  const failedCount = counts.failed ?? 0;
  const pendingCount = counts.pending ?? 0;
  const [dispatching, setDispatching] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [cancelingSchedule, setCancelingSchedule] = useState(false);
  const canDispatch = broadcast.status === 'draft' && (broadcast.recipients?.length ?? 0) > 0;
  const canResume = broadcast.status === 'paused' && pendingCount > 0;
  const isScheduled = broadcast.status === 'scheduled';

  const handleCancelSchedule = async () => {
    if (!isScheduled) return;
    if (!confirm('Cancelar agendamento e voltar para rascunho?')) return;
    setCancelingSchedule(true);
    try {
      const { updateDoc, deleteField, doc: docRef } = await import('firebase/firestore');
      await updateDoc(docRef(db, 'broadcasts', broadcast.id), {
        status: 'draft',
        scheduledAt: deleteField(),
        updatedAt: new Date().toISOString(),
      });
      toast.success('Agendamento cancelado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cancelar');
    } finally {
      setCancelingSchedule(false);
    }
  };

  const handleDispatch = async () => {
    if (!canDispatch) return;
    if (!confirm(`Disparar campanha "${broadcast.name}" para ${broadcast.recipients?.length ?? 0} contato(s)?`)) return;
    setDispatching(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const body: Record<string, unknown> = {
        businessId: broadcast.businessId,
        broadcastId: broadcast.id,
        channel: broadcast.channel,
        recipients: broadcast.recipients ?? [],
        sendRate: broadcast.sendRate ?? 10,
        ...(broadcast.throttle ? { throttle: broadcast.throttle } : {}),
      };
      if (broadcast.templateName) body.templateName = broadcast.templateName;
      if (broadcast.templateLanguage) body.templateLanguage = broadcast.templateLanguage;
      if (broadcast.templateParams) body.templateParams = broadcast.templateParams;
      if (broadcast.messageContent) body.messageContent = broadcast.messageContent;
      if (broadcast.emailSubject) body.emailSubject = broadcast.emailSubject;
      if (broadcast.viaBaileys) body.viaBaileys = true;

      const res = await fetch('/api/broadcasts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const summary = data.paused
        ? `Pausada após ${data.stats.sent} envio(s)`
        : `Concluída — ${data.stats.sent} enviadas, ${data.stats.failed} falharam`;
      toast.success(summary);
    } catch (err) {
      console.error('[BroadcastDetail] dispatch failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao disparar campanha');
    } finally {
      setDispatching(false);
    }
  };

  const handleResume = async () => {
    if (!canResume) return;
    if (!confirm(`Retomar campanha com ${pendingCount} contato(s) pendentes?`)) return;
    setResuming(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      // Passo 1: prepara o broadcast (volta pra draft com recipients = pendentes)
      const prepRes = await fetch(`/api/broadcasts/${broadcast.id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId: broadcast.businessId }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) throw new Error(prepData.error || `HTTP ${prepRes.status}`);

      // Passo 2: dispara o envio. Usa SEMPRE os recipients retornados pelo resume
      // endpoint (não o broadcast.recipients local, que poderia estar stale).
      const recipients = prepData.recipients as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(recipients) || recipients.length === 0) {
        toast.warn('Nenhum recipiente pendente para retomar.');
        return;
      }
      const sendBody: Record<string, unknown> = {
        businessId: broadcast.businessId,
        broadcastId: broadcast.id,
        channel: broadcast.channel,
        recipients,
        sendRate: broadcast.sendRate ?? 10,
        ...(broadcast.throttle ? { throttle: broadcast.throttle } : {}),
      };
      if (broadcast.templateName) sendBody.templateName = broadcast.templateName;
      if (broadcast.templateLanguage) sendBody.templateLanguage = broadcast.templateLanguage;
      if (broadcast.templateParams) sendBody.templateParams = broadcast.templateParams;
      if (broadcast.messageContent) sendBody.messageContent = broadcast.messageContent;
      if (broadcast.emailSubject) sendBody.emailSubject = broadcast.emailSubject;
      if (broadcast.viaBaileys) sendBody.viaBaileys = true;

      const sendRes = await fetch('/api/broadcasts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(sendBody),
      });
      const sendData = await sendRes.json();
      if (!sendRes.ok) throw new Error(sendData.error || `HTTP ${sendRes.status}`);
      const summary = sendData.paused
        ? `Pausada novamente após ${sendData.stats.sent} envio(s)`
        : `Retomada concluída — ${sendData.stats.sent} enviadas, ${sendData.stats.failed} falharam`;
      toast.success(summary);
    } catch (err) {
      console.error('[BroadcastDetail] resume failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao retomar campanha');
    } finally {
      setResuming(false);
    }
  };

  const handleRetryFailed = async () => {
    if (failedCount === 0) return;
    if (!confirm(`Criar nova campanha de retry com ${failedCount} contato(s) que falharam?`)) return;
    setRetrying(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/broadcasts/${broadcast.id}/retry-failed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId: broadcast.businessId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(`Nova campanha criada com ${data.recipientsCount} contato(s) para retry.`);
      onRetryCreated?.(data.newBroadcastId);
    } catch (err) {
      console.error('[BroadcastDetail] retry failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao criar retry');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        className="w-full max-w-3xl max-h-[90vh] bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 truncate">{broadcast.name}</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              <span className="capitalize">{broadcast.channel}</span> · {messages.length} recipientes · status: <span className="font-semibold">{broadcast.status}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 5.12 — Auditoria LGPD */}
        {broadcast.consentBasis && (
          <div className="px-5 py-2.5 bg-amber-50/60 dark:bg-amber-500/5 border-b border-amber-100 dark:border-amber-500/10">
            <div className="flex items-start gap-2">
              <Shield className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
                <p className="text-amber-900 dark:text-amber-200">
                  <span className="font-semibold">Base legal:</span>{' '}
                  {CONSENT_BASIS_LABELS[broadcast.consentBasis]}
                </p>
                {broadcast.consentSource && (
                  <p className="text-amber-700/80 dark:text-amber-300/80">
                    Origem: {broadcast.consentSource}
                  </p>
                )}
                {broadcast.consentAcknowledgedAt && (
                  <p className="text-amber-600/70 dark:text-amber-400/70 text-[10px] mt-0.5">
                    Aprovado em {new Date(broadcast.consentAcknowledgedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    {broadcast.createdByName ? ` por ${broadcast.createdByName}` : ''}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stats agregadas */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 grid grid-cols-5 gap-2 text-center">
          {(['all', 'sent', 'delivered', 'read', 'failed'] as const).map(s => {
            const cfg = s === 'all'
              ? { label: 'Total', color: 'text-gray-700 dark:text-gray-200' }
              : { label: STATUS_CFG[s].label, color: STATUS_CFG[s].color.split(' ').find(c => c.startsWith('text-'))?.replace(/dark:.*/, '') || '' };
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s as BroadcastMessageStatus | 'all')}
                className={cn(
                  'p-2 rounded-lg border-2 transition-colors',
                  statusFilter === s
                    ? 'border-red-400 bg-red-50 dark:bg-red-500/10'
                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                )}
              >
                <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">{cfg.label}</p>
                <p className={cn('text-lg font-bold', s === 'all' ? 'text-gray-700 dark:text-gray-200' : cfg.color)}>
                  {counts[s] ?? 0}
                </p>
              </button>
            );
          })}
        </div>

        {/* Scheduled toolbar — só quando scheduled */}
        {isScheduled && broadcast.scheduledAt && (
          <div className="px-5 py-2.5 bg-blue-50 dark:bg-blue-500/5 border-b border-blue-100 dark:border-blue-500/10 flex items-center justify-between">
            <span className="text-xs text-blue-700 dark:text-blue-400">
              <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
              Agendada para {new Date(broadcast.scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
            <button
              type="button"
              onClick={handleCancelSchedule}
              disabled={cancelingSchedule}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-blue-300 dark:border-blue-500/30 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/10 disabled:opacity-50 transition-colors"
            >
              {cancelingSchedule ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
              Cancelar agendamento
            </button>
          </div>
        )}

        {/* Dispatch toolbar — só quando draft */}
        {canDispatch && (
          <div className="px-5 py-2.5 bg-emerald-50 dark:bg-emerald-500/5 border-b border-emerald-100 dark:border-emerald-500/10 flex items-center justify-between">
            <span className="text-xs text-emerald-700 dark:text-emerald-400">
              <Send className="w-3 h-3 inline mr-1 -mt-0.5" />
              Pronto para disparar — {broadcast.recipients?.length ?? 0} contato(s)
            </span>
            <button
              type="button"
              onClick={handleDispatch}
              disabled={dispatching}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
            >
              {dispatching ? <><Loader2 className="w-3 h-3 animate-spin" /> Disparando...</> : <><Send className="w-3 h-3" /> Disparar agora</>}
            </button>
          </div>
        )}

        {/* Resume toolbar — só quando paused com pendentes */}
        {canResume && (
          <div className="px-5 py-2.5 bg-amber-50 dark:bg-amber-500/5 border-b border-amber-100 dark:border-amber-500/10 flex items-center justify-between">
            <span className="text-xs text-amber-700 dark:text-amber-400">
              <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
              Pausada — {pendingCount} contato(s) pendentes
            </span>
            <button
              type="button"
              onClick={handleResume}
              disabled={resuming}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 transition-colors"
            >
              {resuming ? <><Loader2 className="w-3 h-3 animate-spin" /> Retomando...</> : <><Send className="w-3 h-3" /> Retomar envio</>}
            </button>
          </div>
        )}

        {/* Failed retry toolbar */}
        {failedCount > 0 && (
          <div className="px-5 py-2.5 bg-red-50 dark:bg-red-500/5 border-b border-red-100 dark:border-red-500/10 flex items-center justify-between">
            <span className="text-xs text-red-700 dark:text-red-400">
              <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
              {failedCount} contato(s) falharam no envio
            </span>
            <button
              onClick={handleRetryFailed}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
            >
              {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Reenviar falhados
            </button>
          </div>
        )}

        {/* 5.15 — Métricas agregadas (taxa entrega/leitura/falha + tempos médios) */}
        {messages.length > 0 && (
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
            <BroadcastMetricsPanel messages={messages} />
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-sm text-gray-400">Carregando mensagens…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">
              {messages.length === 0
                ? 'Nenhuma mensagem registrada — campanha ainda não foi disparada.'
                : `Nenhuma mensagem com status "${STATUS_CFG[statusFilter as BroadcastMessageStatus]?.label || statusFilter}".`}
            </div>
          ) : (
            <AnimatePresence>
              {filtered.map(msg => {
                const cfg = STATUS_CFG[msg.status];
                return (
                  <motion.div key={msg.id}
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                    className="px-5 py-3 border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-start gap-3">
                      <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full flex-shrink-0', cfg.color)}>
                        {cfg.icon} {cfg.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {msg.contactName || msg.recipientId}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">
                          {msg.recipientId}
                        </p>
                        {msg.errorMessage && (
                          <p className="text-[11px] text-red-600 dark:text-red-400 mt-1 leading-relaxed">
                            <strong>Erro:</strong> {msg.errorMessage}
                          </p>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 text-right flex-shrink-0">
                        {msg.sentAt && <p>enviado: {new Date(msg.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>}
                        {msg.deliveredAt && <p>entregue: {new Date(msg.deliveredAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>}
                        {msg.readAt && <p>lida: {new Date(msg.readAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {messages.length === 500 && (
          <div className="px-5 py-2 text-[10px] text-center text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/5 border-t border-amber-100 dark:border-amber-500/10">
            Mostrando primeiras 500 mensagens — campanhas maiores precisam de paginação completa
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
