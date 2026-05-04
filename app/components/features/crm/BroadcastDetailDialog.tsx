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
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, doc, query, where, orderBy, onSnapshot, limit as firestoreLimit } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/config/firebase';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { X, RefreshCw, Loader2, AlertTriangle, Check, CheckCheck, Clock, Send, Shield, RotateCcw, Trash2, Pause } from 'lucide-react';
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
  /** Chamado depois de apagar — para o pai remover da lista/fechar painel. */
  onDeleted?: (broadcastId: string) => void;
}

export default function BroadcastDetailDialog({ broadcast: initialBroadcast, onClose, onRetryCreated, onDeleted }: Props) {
  // Real-time do próprio broadcast doc — prop inicial é só seed.
  // Sem isso, status/recipients ficam stale após dispatch/resume e UI mostra
  // botões errados (ex: "Disparar agora" após envio bem-sucedido).
  const [broadcast, setBroadcast] = useState<Broadcast>(initialBroadcast);
  const [messages, setMessages] = useState<BroadcastMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<BroadcastMessageStatus | 'all'>('all');
  const [retrying, setRetrying] = useState(false);

  // Lock the tab scroll container while open. Como agora portalamos pra
  // document.body, buscamos o wrapper de tab ativo via classes (ele tem
  // will-change-transform + pointer-events-auto + overflow-y-auto).
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(
      '.will-change-transform.pointer-events-auto.overflow-y-auto',
    );
    if (!el) return;
    const prevOverflow = el.style.overflowY;
    const prevScroll = el.scrollTop;
    el.style.overflowY = 'hidden';
    return () => {
      el.style.overflowY = prevOverflow;
      el.scrollTop = prevScroll;
    };
  }, []);

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

  // Carga das mensagens em duas etapas:
  //  1. Tenta onSnapshot (real-time, UX ideal)
  //  2. Se snapshot falhar (sem index, rules, etc) OU vier vazio com stats > 0,
  //     fallback para fetch via /api/broadcasts/[id]/messages (admin SDK).
  // Re-fetch a cada 5s enquanto status='sending' para refletir progresso mesmo
  // quando o snapshot está bloqueado.
  useEffect(() => {
    let snapshotErrored = false;

    const fetchViaApi = async () => {
      try {
        const token = await getAuth().currentUser?.getIdToken();
        const url = `/api/broadcasts/${broadcast.id}/messages?businessId=${encodeURIComponent(broadcast.businessId)}&limit=500`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        // 404 = route não compilada ainda (dev server precisa restart depois
        // de adicionar nova route). Não polui console com error.
        if (res.status === 404) {
          console.warn('[BroadcastDetail] /messages route não disponível (404) — dev server pode precisar restart');
          return;
        }
        if (!res.ok) {
          console.warn(`[BroadcastDetail] /messages retornou HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        const apiMessages = (data.messages || []) as BroadcastMessage[];
        if (apiMessages.length > 0) setMessages(apiMessages);
      } catch (err) {
        console.warn('[BroadcastDetail] API fallback failed:', err);
      } finally {
        setLoading(false);
      }
    };

    const q = query(
      collection(db, 'broadcastMessages'),
      where('businessId', '==', broadcast.businessId),
      where('broadcastId', '==', broadcast.id),
      orderBy('createdAt', 'asc'),
      firestoreLimit(500),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map(d => ({ ...(d.data() as BroadcastMessage), id: d.id }));
        setMessages(docs);
        setLoading(false);
        // Se snapshot voltou vazio mas o broadcast.stats indica que deveria haver
        // mensagens (sent/failed > 0), tenta API. Pode acontecer se index ainda
        // não está deployado e snapshot dá empty silenciosamente.
        const expected = (broadcast.stats?.sent || 0) + (broadcast.stats?.failed || 0);
        if (docs.length === 0 && expected > 0) {
          fetchViaApi();
        }
      },
      (err) => {
        // Index ausente, rules bloqueando, etc — usa API fallback
        console.warn('[BroadcastDetail] snapshot error, using API fallback:', err);
        snapshotErrored = true;
        fetchViaApi();
      }
    );

    // Polling complementar enquanto envio ativo (status='sending'): garante
    // visibilidade de progresso mesmo se snapshot estiver bloqueado.
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    if (broadcast.status === 'sending' || snapshotErrored) {
      pollTimer = setInterval(fetchViaApi, 5_000);
    }

    return () => {
      unsub();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [broadcast.id, broadcast.businessId, broadcast.status, broadcast.stats?.sent, broadcast.stats?.failed]);

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
  // Erro mais recente entre as mensagens falhadas — exibido no banner pra não
  // exigir scroll e abrir a lista pra descobrir a causa.
  const latestFailedError = useMemo(() => {
    const failed = messages.filter(m => m.status === 'failed' && m.errorMessage);
    if (failed.length === 0) return null;
    failed.sort((a, b) => (b.sentAt || b.createdAt || '').localeCompare(a.sentAt || a.createdAt || ''));
    return failed[0].errorMessage || null;
  }, [messages]);

  // Detecta erro específico de Baileys offline pra mostrar botão de reconnect
  const isBaileysOffline = !!latestFailedError
    && /WhatsApp Web não está conectado|reconectando \(timeout/i.test(latestFailedError);

  const handleBaileysReconnect = async () => {
    setReconnecting(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch('/api/whatsapp/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId: broadcast.businessId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      if (data.status === 'no_session') {
        toast.warn('Sessão WhatsApp não existe no servidor. Reconecte via Configurações (escaneando QR Code).');
      } else if (data.status === 'already_active') {
        toast.info(data.isConnected ? 'Sessão já ativa.' : 'Sessão em reconexão...');
      } else {
        toast.success('Restauração da sessão iniciada. Aguarde alguns segundos e tente novamente.');
      }
    } catch (err) {
      console.error('[BroadcastDetail] reconnect failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao reconectar');
    } finally {
      setReconnecting(false);
    }
  };
  const [dispatching, setDispatching] = useState(false);
  /**
   * Quantidade a disparar nesta rodada. `null` = enviar todos (default).
   * Quando definido para N < total, status final fica 'paused' e operador
   * usa Retomar pra mandar o resto.
   */
  const [dispatchAmount, setDispatchAmount] = useState<number | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [cancelingSchedule, setCancelingSchedule] = useState(false);
  const canDispatch = broadcast.status === 'draft' && (broadcast.recipients?.length ?? 0) > 0;
  // Resume: confia no status do broadcast doc, não em pendingCount (que pode
  // ainda não ter carregado se o snapshot está atrasado/bloqueado por index).
  // O endpoint /resume é idempotente e responde graciosamente se não houver pendentes.
  const canResume = broadcast.status === 'paused';
  const isScheduled = broadcast.status === 'scheduled';
  const isStuckSending = broadcast.status === 'sending';
  // Heurística pra "campanha presa": status='sending' + 0 messages criadas + startedAt > 2min
  // ou simplesmente status='sending' (operador pode forçar reset mesmo enquanto processa).
  const stuckMinutes = broadcast.startedAt
    ? Math.floor((Date.now() - new Date(broadcast.startedAt).getTime()) / 60_000)
    : 0;
  const looksStuck = isStuckSending && (messages.length === 0 || stuckMinutes >= 2);

  const handleCancelSchedule = async () => {
    if (!isScheduled) return;
    if (!confirm('Cancelar agendamento e voltar para rascunho?')) return;
    setCancelingSchedule(true);
    try {
      // Usa endpoint dedicado com runTransaction. updateDoc client-side direto
      // tinha race com o cron /process-scheduled (cron CAS scheduled→sending
      // podia rodar entre a leitura do cliente e o update, deixando broadcast
      // disparado depois do operador "cancelar").
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/broadcasts/${broadcast.id}/cancel-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId: broadcast.businessId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(data.message || 'Agendamento cancelado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cancelar');
    } finally {
      setCancelingSchedule(false);
    }
  };

  const handleDispatch = async () => {
    if (!canDispatch) return;
    const total = broadcast.recipients?.length ?? 0;
    const limit = dispatchAmount && dispatchAmount > 0 && dispatchAmount < total ? dispatchAmount : null;
    const targetCount = limit ?? total;
    const confirmMsg = limit
      ? `Disparar primeira parte da campanha "${broadcast.name}" — ${limit} de ${total} contato(s)?\n\nOs ${total - limit} restantes ficarão pendentes e podem ser enviados depois via "Retomar".`
      : `Disparar campanha "${broadcast.name}" para ${total} contato(s)?`;
    if (!confirm(confirmMsg)) return;
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
        ...(limit ? { maxRecipients: limit } : {}),
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
      const summary = data.partial
        ? `Parte enviada — ${data.stats.sent}/${targetCount} disparadas. ${data.stats.pending} pendentes (use Retomar).`
        : data.paused
          ? `Pausada após ${data.stats.sent} envio(s)`
          : `Concluída — ${data.stats.sent} enviadas, ${data.stats.failed} falharam`;
      toast.success(summary);
      setDispatchAmount(null);
    } catch (err) {
      // "Failed to fetch" / TypeError = client desconectou (timeout proxy ~5min,
      // throttle longo, conexão perdida). O backend continua processando: o
      // status do broadcast e os broadcastMessages são a fonte da verdade
      // (sincronizados via onSnapshot). NÃO marca como erro nesse caso.
      const isNetworkAbort = err instanceof TypeError
        || (err instanceof Error && /failed to fetch|network|aborted/i.test(err.message));
      if (isNetworkAbort) {
        console.warn('[BroadcastDetail] dispatch fetch timed out client-side — backend continua processando');
        toast.info('Envio em andamento — pode demorar. Acompanhe o progresso aqui (atualiza em tempo real). Use "Pausar" se precisar interromper.');
      } else {
        console.error('[BroadcastDetail] dispatch failed:', err);
        toast.error(err instanceof Error ? err.message : 'Erro ao disparar campanha');
      }
    } finally {
      setDispatching(false);
    }
  };

  const handlePause = async () => {
    if (broadcast.status !== 'sending') return;
    if (!confirm(`Pausar a campanha "${broadcast.name}"?\n\nMensagens já em envio concluem; demais ficam pendentes (use Retomar depois).`)) return;
    setPausing(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/broadcasts/${broadcast.id}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId: broadcast.businessId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(data.message || 'Pausa solicitada.');
    } catch (err) {
      console.error('[BroadcastDetail] pause failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao pausar campanha');
    } finally {
      setPausing(false);
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
      // Mesmo padrão do dispatch: timeout client não é falha real
      const isNetworkAbort = err instanceof TypeError
        || (err instanceof Error && /failed to fetch|network|aborted/i.test(err.message));
      if (isNetworkAbort) {
        console.warn('[BroadcastDetail] resume fetch timed out client-side — backend continua processando');
        toast.info('Retomada em andamento — acompanhe o progresso aqui (atualiza em tempo real).');
      } else {
        console.error('[BroadcastDetail] resume failed:', err);
        toast.error(err instanceof Error ? err.message : 'Erro ao retomar campanha');
      }
    } finally {
      setResuming(false);
    }
  };

  const handleReset = async () => {
    if (!isStuckSending && !canResume) return;
    const msgWarning = messages.length > 0
      ? `Isto APAGARÁ ${messages.length} mensagem(ns) já registrada(s) (incluindo enviadas/entregues/lidas).\n\n`
      : '';
    if (!confirm(
      `Resetar a campanha "${broadcast.name}"?\n\n${msgWarning}A campanha voltará para Rascunho e ficará pronta para disparar novamente.`
    )) return;
    setResetting(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/broadcasts/${broadcast.id}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessId: broadcast.businessId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(data.message || 'Campanha resetada.');
    } catch (err) {
      console.error('[BroadcastDetail] reset failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao resetar campanha');
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async () => {
    if (broadcast.status === 'sending') {
      toast.warn('Use "Resetar" antes de apagar uma campanha em envio.');
      return;
    }
    const msgInfo = messages.length > 0
      ? `Isto também apagará ${messages.length} mensagem(ns) registrada(s).\n\n`
      : '';
    if (!confirm(
      `Apagar PERMANENTEMENTE a campanha "${broadcast.name}"?\n\n${msgInfo}Esta ação não pode ser desfeita.`
    )) return;
    setDeleting(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const url = `/api/broadcasts/${broadcast.id}?businessId=${encodeURIComponent(broadcast.businessId)}`;
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(data.message || 'Campanha apagada.');
      onDeleted?.(broadcast.id);
      onClose();
    } catch (err) {
      console.error('[BroadcastDetail] delete failed:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao apagar campanha');
    } finally {
      setDeleting(false);
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

  // Portal pra escapar containing block do wrapper de tabs
  // (will-change-transform em app/page.tsx quebra position:fixed, fazia
  // o modal aparecer cortado/deslocado conforme o scroll da página).
  if (typeof document === 'undefined') return null;
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}
        className="w-full max-w-3xl max-h-[calc(100vh-2rem)] bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
        {/* Header — usa recipients.length como fonte primária (broadcastMessages
            podem ter sido apagadas em reset, mas recipients persiste). */}
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-base text-gray-900 dark:text-gray-100 truncate">{broadcast.name}</h3>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              <span className="capitalize">{broadcast.channel}</span> · {(broadcast.recipients?.length ?? messages.length)} recipientes · status: <span className="font-semibold">{broadcast.status}</span>
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleDelete}
              disabled={deleting || broadcast.status === 'sending'}
              title={broadcast.status === 'sending' ? 'Resete antes de apagar' : 'Apagar campanha'}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>
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

        {/* Dispatch toolbar — só quando draft. Inclui opção de envio parcial. */}
        {canDispatch && (() => {
          const total = broadcast.recipients?.length ?? 0;
          const targetCount = dispatchAmount && dispatchAmount > 0 && dispatchAmount < total ? dispatchAmount : total;
          const isPartial = targetCount < total;
          // Presets de porcentagem
          const presets: { label: string; value: number }[] = [
            { label: '25%', value: Math.max(1, Math.floor(total * 0.25)) },
            { label: '50%', value: Math.max(1, Math.floor(total * 0.5)) },
            { label: '75%', value: Math.max(1, Math.floor(total * 0.75)) },
            { label: '100%', value: total },
          ];
          return (
            <div className="px-5 py-3 bg-emerald-50 dark:bg-emerald-500/5 border-b border-emerald-100 dark:border-emerald-500/10 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-emerald-700 dark:text-emerald-400">
                  <Send className="w-3 h-3 inline mr-1 -mt-0.5" />
                  {isPartial
                    ? <>Disparar <strong>{targetCount}</strong> de {total} contato(s) · {total - targetCount} ficam pendentes</>
                    : <>Pronto para disparar — {total} contato(s)</>
                  }
                </span>
                <button
                  type="button"
                  onClick={handleDispatch}
                  disabled={dispatching}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-colors"
                >
                  {dispatching
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Disparando...</>
                    : <><Send className="w-3 h-3" /> {isPartial ? `Disparar ${targetCount}` : 'Disparar agora'}</>
                  }
                </button>
              </div>
              {/* Linha 2: presets % + input numérico */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold text-emerald-700/70 dark:text-emerald-400/70 uppercase tracking-wider">
                  Quantos:
                </span>
                {presets.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setDispatchAmount(p.value === total ? null : p.value)}
                    className={cn(
                      'px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors',
                      targetCount === p.value
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/10',
                    )}
                  >
                    {p.label} ({p.value})
                  </button>
                ))}
                <span className="text-[10px] text-emerald-700/70 dark:text-emerald-400/70 ml-1">ou</span>
                <input
                  type="number"
                  min={1}
                  max={total}
                  value={dispatchAmount ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') { setDispatchAmount(null); return; }
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n) && n > 0) {
                      setDispatchAmount(Math.min(n, total));
                    }
                  }}
                  placeholder={`todos (${total})`}
                  className="w-20 px-2 py-0.5 text-[10px] text-center bg-white dark:bg-white/[0.04] border border-emerald-200 dark:border-emerald-500/20 rounded-md text-emerald-900 dark:text-emerald-200 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                />
              </div>
            </div>
          );
        })()}

        {/* Sending/stuck toolbar — campanha em processamento. Mostra Pausar
            sempre que sending; mostra Resetar adicional quando aparenta travada. */}
        {isStuckSending && (
          <div className={cn(
            'px-5 py-2.5 border-b flex items-center justify-between gap-3 flex-wrap',
            looksStuck
              ? 'bg-orange-50 dark:bg-orange-500/5 border-orange-100 dark:border-orange-500/10'
              : 'bg-blue-50 dark:bg-blue-500/5 border-blue-100 dark:border-blue-500/10',
          )}>
            <span className={cn(
              'text-xs',
              looksStuck ? 'text-orange-700 dark:text-orange-400' : 'text-blue-700 dark:text-blue-400',
            )}>
              {looksStuck ? (
                <>
                  <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
                  Campanha parece travada — {messages.length === 0
                    ? 'nenhuma mensagem foi registrada'
                    : `sem progresso há ${stuckMinutes}min`}
                </>
              ) : (
                <>
                  <Loader2 className="w-3 h-3 inline mr-1 -mt-0.5 animate-spin" />
                  Em processamento — {counts.sent ?? 0} enviadas / {pendingCount} pendentes
                </>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePause}
                disabled={pausing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 transition-colors"
              >
                {pausing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pause className="w-3 h-3" />}
                Pausar
              </button>
              {looksStuck && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={resetting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50 transition-colors"
                >
                  {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Resetar
                </button>
              )}
            </div>
          </div>
        )}

        {/* Resume toolbar — sempre que status='paused'. Se pendingCount=0
            (snapshot ainda carregando ou index pendente), o endpoint /resume
            usa adminDb e responde com a contagem real. */}
        {canResume && (
          <div className="px-5 py-2.5 bg-amber-50 dark:bg-amber-500/5 border-b border-amber-100 dark:border-amber-500/10 flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs text-amber-700 dark:text-amber-400">
              <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
              Pausada {pendingCount > 0 ? <>— {pendingCount} contato(s) pendentes</> : <>— clique em Retomar para continuar</>}
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

        {/* Failed retry toolbar — inclui o erro mais recente no próprio banner
            pra evitar scroll/clique adicional pra descobrir a causa. */}
        {failedCount > 0 && (
          <div className="px-5 py-2.5 bg-red-50 dark:bg-red-500/5 border-b border-red-100 dark:border-red-500/10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-xs text-red-700 dark:text-red-400 font-medium">
                  <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
                  {failedCount} contato(s) falharam no envio
                </span>
                {latestFailedError && (
                  <div className="mt-1.5 text-[11px] leading-relaxed text-red-800 dark:text-red-300 bg-red-100/60 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-md px-2 py-1.5">
                    <span className="font-semibold">Erro:</span> {latestFailedError}
                    {isBaileysOffline && (
                      <button
                        type="button"
                        onClick={handleBaileysReconnect}
                        disabled={reconnecting}
                        className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 hover:bg-red-700 text-white text-[10px] font-semibold disabled:opacity-50"
                      >
                        {reconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Tentar reconectar
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={handleRetryFailed}
                disabled={retrying}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 flex-shrink-0"
              >
                {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Reenviar falhados
              </button>
            </div>
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
    </motion.div>,
    document.body,
  );
}
