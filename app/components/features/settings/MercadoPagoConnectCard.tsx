'use client';

/**
 * MercadoPagoConnectCard
 *
 * UI de conexão da conta Mercado Pago do DONO (Settings → Pagamentos).
 * Reusa o backend OAuth já existente:
 *   GET  /api/integrations/mercadopago/status      → PaymentAccountPublic
 *   POST /api/integrations/mercadopago/connect     → { authUrl }
 *   POST /api/integrations/mercadopago/disconnect  → { disconnected: true }
 *
 * O callback do MP devolve via popup com window.opener.postMessage({type:'mp_connected'}).
 * Detectamos isso por listener de `message` + fallback de polling (refetchInterval
 * enquanto 'connecting'), pra cobrir o caso de o popup ser bloqueado/fechado.
 *
 * Gate: só admin+ conecta/desconecta (ROLE_HIERARCHY) — espelha as rotas server.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import {
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ShieldCheck,
  Zap,
  RefreshCw,
  KeyRound,
  Banknote,
} from 'lucide-react';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { auth as firebaseAuth } from '@/lib/config/firebase';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { PaymentAccountPublic } from '@/contracts/domain/paymentAccount';

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

async function authedFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await firebaseAuth.currentUser?.getIdToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!json || json.ok !== true) {
    const msg = json && json.ok === false ? json.error.message : 'Falha na requisição';
    throw new Error(msg);
  }
  return json.data;
}

function maskPublicKey(key: string): string {
  if (!key) return '';
  if (key.length <= 14) return key;
  return `${key.slice(0, 12)}••••••••${key.slice(-4)}`;
}

export default function MercadoPagoConnectCard() {
  const { user, business } = useAuth();
  const canManage = ROLE_HIERARCHY[user?.role ?? 'viewer'] >= ROLE_HIERARCHY['admin'];

  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const {
    data,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<PaymentAccountPublic>({
    queryKey: ['mp-status', business?.id],
    queryFn: () => authedFetch<PaymentAccountPublic>('/api/integrations/mercadopago/status'),
    enabled: Boolean(business?.id),
    staleTime: 30_000,
    // Enquanto a janela de OAuth está aberta, faz polling como fallback caso o
    // postMessage não chegue (popup bloqueado, navegador estrito, etc.).
    refetchInterval: connecting ? 2500 : false,
  });

  const isConnected = Boolean(data?.mpConnected);

  // Quando o polling/refetch confirma a conexão, encerra o estado 'connecting'.
  useEffect(() => {
    if (connecting && isConnected) {
      setConnecting(false);
      toast.success('Mercado Pago conectado com sucesso!');
    }
  }, [connecting, isConnected]);

  // Listener do popup do callback (window.opener.postMessage).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // O callback é same-origin (nossa própria rota) — só aceitamos a nossa origem.
      if (e.origin !== window.location.origin) return;
      const payload = e.data as { type?: string } | undefined;
      if (!payload?.type) return;
      if (payload.type === 'mp_connected') {
        refetch();
        // O efeito acima fecha 'connecting' quando mpConnected vira true.
      } else if (payload.type === 'mp_error') {
        setConnecting(false);
        toast.error('Não foi possível conectar o Mercado Pago. Tente novamente.');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refetch]);

  const handleConnect = useCallback(async () => {
    if (!canManage) return;
    setConnecting(true);
    // Abre o popup SINCRONO no clique pra não ser bloqueado; navega depois.
    const popup = window.open('', 'mp_oauth', 'width=520,height=720,menubar=no,toolbar=no');
    popupRef.current = popup;
    try {
      const { authUrl } = await authedFetch<{ authUrl: string }>(
        '/api/integrations/mercadopago/connect',
        { method: 'POST', body: JSON.stringify({}) },
      );
      if (popup && !popup.closed) {
        popup.location.href = authUrl;
      } else {
        // Popup bloqueado: navega na mesma aba como fallback.
        window.location.href = authUrl;
      }
    } catch (err) {
      popup?.close();
      setConnecting(false);
      toast.error(err instanceof Error ? err.message : 'Falha ao iniciar conexão');
    }
  }, [canManage]);

  const handleVerify = useCallback(async () => {
    const res = await refetch();
    if (res.data?.mpConnected) {
      setConnecting(false);
      toast.success('Conta Mercado Pago conectada!');
    } else {
      toast.info('Ainda não detectamos a conexão. Conclua o login no Mercado Pago.');
    }
  }, [refetch]);

  const handleDisconnect = useCallback(async () => {
    if (!canManage) return;
    setDisconnecting(true);
    try {
      await authedFetch<{ disconnected: true }>('/api/integrations/mercadopago/disconnect', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refetch();
      setConfirmDisconnect(false);
      toast.success('Mercado Pago desconectado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao desconectar');
    } finally {
      setDisconnecting(false);
    }
  }, [canManage, refetch]);

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/40 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-48 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-full rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-10 w-44 rounded-xl bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    );
  }

  const needsReauth = Boolean(data?.mpNeedsReauth);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      aria-labelledby="mp-card-title"
      className="rounded-2xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/40 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start gap-3 p-6 pb-4">
        <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-sky-50 to-sky-100 dark:from-sky-500/20 dark:to-sky-500/10 flex items-center justify-center border border-sky-200/60 dark:border-sky-500/20">
          <CreditCard className="w-5 h-5 text-sky-500 dark:text-sky-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 id="mp-card-title" className="text-base font-bold text-gray-900 dark:text-white font-display">
              Mercado Pago
            </h3>
            {isConnected && !needsReauth && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Conectado
              </span>
            )}
            {isConnected && (
              <span
                className={
                  data?.mpLiveMode
                    ? 'inline-flex items-center gap-1 rounded-full bg-violet-50 dark:bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-400'
                    : 'inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400'
                }
              >
                {data?.mpLiveMode ? 'Produção' : 'Teste'}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Receba PIX e cartão dos seus pedidos online direto na sua conta.
          </p>
        </div>
      </div>

      {/* Reauth banner */}
      <AnimatePresence initial={false}>
        {isConnected && needsReauth && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mx-6 mb-4 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4"
            role="alert"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Reconexão necessária
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400/90">
                  Sua autorização do Mercado Pago expirou ou foi revogada. Reconecte para voltar a receber pagamentos.
                </p>
                {canManage && (
                  <button
                    type="button"
                    onClick={handleConnect}
                    disabled={connecting}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-white transition-colors"
                  >
                    {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Reconectar
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-6 pb-6">
        <AnimatePresence mode="wait" initial={false}>
          {isConnected ? (
            <motion.div
              key="connected"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {/* Connected state */}
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 p-4">
                <div className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="w-4 h-4" />
                  <span className="font-medium">Conta conectada e pronta para receber.</span>
                </div>
                {data?.mpPublicKey && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <KeyRound className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium">Chave pública:</span>
                    <code className="font-mono text-gray-700 dark:text-gray-300 break-all">
                      {maskPublicKey(data.mpPublicKey)}
                    </code>
                  </div>
                )}
              </div>

              {/* Post-connection checklist */}
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                  Próximos passos
                </p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                    <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-sky-100 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center text-xs font-bold">
                      1
                    </span>
                    <span>
                      Cadastre uma <strong>chave PIX</strong> na sua conta Mercado Pago para receber por PIX.{' '}
                      <a
                        href="https://www.mercadopago.com.br/adminmovements/pix-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400 hover:underline font-medium"
                      >
                        Abrir <ExternalLink className="w-3 h-3" />
                      </a>
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
                    <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-sky-100 dark:bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center text-xs font-bold">
                      2
                    </span>
                    <span>
                      Faça um pedido de teste no seu cardápio para confirmar que o pagamento aparece no seu painel do Mercado Pago.
                    </span>
                  </li>
                </ul>
              </div>

              {/* Disconnect */}
              {canManage && (
                <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-700/50">
                  <AnimatePresence mode="wait" initial={false}>
                    {confirmDisconnect ? (
                      <motion.div
                        key="confirm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="flex flex-wrap items-center gap-3"
                      >
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Desconectar? Você deixará de receber pagamentos online.
                        </p>
                        <div className="flex gap-2 ml-auto">
                          <button
                            type="button"
                            onClick={() => setConfirmDisconnect(false)}
                            disabled={disconnecting}
                            className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleDisconnect}
                            disabled={disconnecting}
                            className="inline-flex items-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 px-3 py-1.5 text-sm font-semibold text-white transition-colors"
                          >
                            {disconnecting && <Loader2 className="w-4 h-4 animate-spin" />}
                            Confirmar
                          </button>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.button
                        key="disconnect"
                        type="button"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={() => setConfirmDisconnect(true)}
                        className="text-sm font-medium text-red-600 dark:text-red-400 hover:underline"
                      >
                        Desconectar conta
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="disconnected"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {/* Sales pitch */}
              <div className="rounded-xl bg-gradient-to-br from-sky-50 to-emerald-50 dark:from-sky-500/10 dark:to-emerald-500/5 border border-sky-100 dark:border-sky-500/20 p-4">
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                  <strong className="text-gray-900 dark:text-white">
                    Receba PIX e cartão direto na sua conta
                  </strong>{' '}
                  — o dinheiro cai na hora, sem taxa da plataforma.
                </p>
                <ul className="mt-3 space-y-1.5">
                  <li className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <Banknote className="w-4 h-4 text-emerald-500 shrink-0" />
                    PIX aprovado na hora, sem intermediário.
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                    Cliente paga online ou na entrega — você escolhe.
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <ShieldCheck className="w-4 h-4 text-sky-500 shrink-0" />
                    Conexão segura via login do Mercado Pago. Não guardamos sua senha.
                  </li>
                </ul>
              </div>

              {canManage ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleConnect}
                    disabled={connecting}
                    className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 px-5 py-2.5 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
                  >
                    {connecting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Aguardando Mercado Pago…
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4" />
                        Conectar Mercado Pago
                      </>
                    )}
                  </button>

                  {connecting && (
                    <button
                      type="button"
                      onClick={handleVerify}
                      disabled={isFetching}
                      className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Já conectei? Verificar
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                  Apenas administradores podem conectar o Mercado Pago.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
