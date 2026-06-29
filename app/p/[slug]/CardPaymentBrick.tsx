'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { initMercadoPago, CardPayment } from '@mercadopago/sdk-react';
import type { ICardPaymentFormData, ICardPaymentBrickPayer } from '@mercadopago/sdk-react/esm/bricks/cardPayment/type';
import { CreditCard, CheckCircle2, Loader2, AlertCircle, RotateCcw, Clock } from 'lucide-react';

interface Props {
  orderId: string;
  trackingToken: string;
  publicKey: string;
  amount: number;
  orderNumber: number | null;
  businessName: string;
  payerEmail?: string;
  maxInstallments?: number;
  /** Encerra o checkout e volta ao cardápio (após aprovação). */
  onBackToMenu: () => void;
  /** Chamado uma vez quando o cartão é aprovado (pai limpa carrinho). */
  onApproved: () => void;
}

// 'analyzing' = cartão em análise antifraude (MP retorna pending/in_process) ou
// desfecho ambíguo; o estado é resolvido por POLLING do status, nunca por retry.
// 'review' = análise prolongada (timeout) → segue pendente, sem oferecer retry.
type CardPhase = 'form' | 'processing' | 'analyzing' | 'review' | 'approved' | 'declined';

const POLL_INTERVAL_MS = 3500;
const ANALYZE_TIMEOUT_MS = 120_000; // ~2min de análise antes de "acompanhe pelo WhatsApp"
const SETTLED = new Set(['paid', 'authorized']);
const CARD_DECLINED_FALLBACK = 'Pagamento recusado. Confira os dados e tente novamente.';

function formatBRL(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

// Idempotência: SDK reinicializa por public key. Evita reinit redundante entre
// remounts (cada chamada é barata, mas mantém o estado previsível).
let initializedKey: string | null = null;

export default function CardPaymentBrick({
  orderId, trackingToken, publicKey, amount, orderNumber, businessName,
  payerEmail, maxInstallments = 12, onBackToMenu, onApproved,
}: Props) {
  const [phase, setPhase] = useState<CardPhase>('form');
  const [declineReason, setDeclineReason] = useState<string | null>(null);
  const [brickKey, setBrickKey] = useState(0); // força remontar o Brick no retry
  const approvedRef = useRef(false);

  useEffect(() => {
    if (initializedKey !== publicKey) {
      initMercadoPago(publicKey, { locale: 'pt-BR' });
      initializedKey = publicKey;
    }
  }, [publicKey]);

  const markApproved = useCallback(() => {
    if (!approvedRef.current) {
      approvedRef.current = true;
      onApproved();
    }
    setPhase('approved');
  }, [onApproved]);

  // Motivo REAL da recusa via projeção pública do pedido (fallback: genérico).
  const resolveDeclineReason = useCallback(async (fallback?: string): Promise<string> => {
    let reason = fallback || CARD_DECLINED_FALLBACK;
    try {
      const st = await fetch(
        `/api/orders/${orderId}/status?token=${encodeURIComponent(trackingToken)}`,
        { cache: 'no-store' },
      );
      if (st.ok) {
        const sd = await st.json();
        if (sd?.lastPaymentDeclineReason) reason = sd.lastPaymentDeclineReason;
      }
    } catch { /* mantém a mensagem genérica */ }
    return reason;
  }, [orderId, trackingToken]);

  const handleSubmit = useCallback(
    async (formData: ICardPaymentFormData<ICardPaymentBrickPayer>): Promise<void> => {
      setPhase('processing');
      setDeclineReason(null);

      let res: Response;
      let data: { ok?: boolean; data?: { status?: string }; error?: { code?: string; message?: string } } | null;
      try {
        res = await fetch(`/api/orders/${orderId}/pay-card`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Chave nova por tentativa (cada cardToken é de uso único).
            'X-Idempotency-Key': `card-${orderId}-${formData.token}`,
          },
          body: JSON.stringify({
            cardToken: formData.token,
            installments: formData.installments,
            trackingToken,
            payerEmail: formData.payer?.email || payerEmail || undefined,
          }),
        });
        data = await res.json().catch(() => null);
      } catch {
        // Falha de REDE antes da resposta: a cobrança PODE ter sido criada no
        // servidor. NUNCA oferecemos retry aqui (novo cardToken+key → risco de
        // cobrança dupla) — confirmamos o desfecho real por polling.
        setPhase('analyzing');
        return;
      }

      // Aprovado de forma síncrona (paid/authorized).
      if (res.ok && data?.ok && (data.data?.status === 'paid' || data.data?.status === 'authorized')) {
        markApproved();
        return; // resolve → não reabre o formulário
      }

      // 'pending' = cartão em ANÁLISE antifraude (HTTP 200, NÃO é recusa). Entra
      // no MESMO polling de status até paid/authorized/failed. Tratar 'pending'
      // como recusa aqui era a causa da cobrança dupla (retry gerava 2ª cobrança).
      if (res.ok && data?.ok && data.data?.status === 'pending') {
        setPhase('analyzing');
        return;
      }

      // Liquidado em paralelo pelo webhook (409 "já está pago") → confirma via polling.
      if (res.status === 409 && /pago/i.test(data?.error?.message ?? '')) {
        setPhase('analyzing');
        return;
      }

      // RECUSA REAL: 402 PAYMENT_REQUIRED (card.status==='failed' no backend).
      // ÚNICO caminho que oferece "tentar de novo" — seguro porque nenhuma
      // cobrança foi capturada.
      if (res.status === 402 && data?.error?.code === 'PAYMENT_REQUIRED') {
        const reason = await resolveDeclineReason(data?.error?.message);
        setDeclineReason(reason);
        setPhase('declined');
        // Rejeita p/ o Brick não exibir tela de sucesso própria.
        throw new Error(reason);
      }

      // Demais respostas (validação/rate-limit/5xx): AMBÍGUAS quanto à cobrança.
      // Sem retry imediato (risco de duplicar) — verifica o desfecho por polling.
      setPhase('analyzing');
    },
    [orderId, trackingToken, payerEmail, markApproved, resolveDeclineReason],
  );

  // Polling do status enquanto o pagamento está EM ANÁLISE (pending/ambíguo).
  // Desfechos: aprovado (paid/authorized), recusado de fato (failed → libera
  // retry) ou timeout (segue pendente; cliente acompanha pelo WhatsApp).
  useEffect(() => {
    if (phase !== 'analyzing') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const poll = async () => {
      if (!active) return;
      if (Date.now() - startedAt > ANALYZE_TIMEOUT_MS) {
        setPhase('review');
        return;
      }
      try {
        const res = await fetch(
          `/api/orders/${orderId}/status?token=${encodeURIComponent(trackingToken)}`,
          { cache: 'no-store' },
        );
        if (active && res.ok) {
          const sd = await res.json();
          const st: string | undefined = sd?.paymentFsmStatus;
          if (st && SETTLED.has(st)) {
            markApproved();
            return; // para o loop ao confirmar
          }
          if (st === 'failed') {
            // Recusa confirmada (nenhuma captura) → permite nova tentativa.
            setDeclineReason(sd?.lastPaymentDeclineReason || CARD_DECLINED_FALLBACK);
            setPhase('declined');
            return;
          }
        }
      } catch { /* rede instável — tenta no próximo ciclo */ }
      if (active) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [phase, orderId, trackingToken, markApproved]);

  const retry = useCallback(() => {
    setPhase('form');
    setDeclineReason(null);
    setBrickKey(k => k + 1);
  }, []);

  // ── Em análise (antifraude / desfecho ambíguo → polling) ────────────────────
  if (phase === 'analyzing') {
    return (
      <div className="p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center justify-center text-center py-10"
        >
          <div className="relative w-24 h-24 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center mb-6">
            <Loader2 className="w-12 h-12 text-amber-500 animate-spin" />
          </div>
          <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-2">Pagamento em análise</h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs">
            Estamos confirmando seu pagamento de {formatBRL(amount)} com a operadora.
            Isso costuma levar alguns segundos — não feche esta tela.
          </p>
          <div className="mt-6 flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Aguardando confirmação...
          </div>
          <button
            onClick={onBackToMenu}
            className="mt-6 text-sm font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            Acompanhar depois / voltar
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Análise prolongada (timeout) — segue pendente, sem retry ────────────────
  if (phase === 'review') {
    return (
      <div className="p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center text-center py-10"
        >
          <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center mb-5">
            <Clock className="w-9 h-9 text-amber-500" />
          </div>
          <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2">Pagamento em análise</h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs">
            A operadora ainda está analisando seu pagamento de {formatBRL(amount)}
            {orderNumber ? ` (pedido #${String(orderNumber).padStart(4, '0')})` : ''}.
            Assim que confirmar, {businessName} prepara seu pedido — acompanhe pelo WhatsApp.
          </p>
          <button
            onClick={onBackToMenu}
            className="mt-7 px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl font-bold transition-all hover:scale-[1.02]"
          >
            Voltar ao cardápio
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Aprovado ────────────────────────────────────────────────────────────────
  if (phase === 'approved') {
    return (
      <div className="p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center justify-center text-center py-10"
        >
          <motion.div
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 11, stiffness: 220, delay: 0.05 }}
            className="relative w-24 h-24 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center mb-6"
          >
            <motion.span
              className="absolute inset-0 rounded-full bg-emerald-400/30"
              initial={{ scale: 1, opacity: 0.7 }}
              animate={{ scale: 1.7, opacity: 0 }}
              transition={{ duration: 1.1, repeat: 2, ease: 'easeOut' }}
            />
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
          </motion.div>
          <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-2">Pagamento aprovado!</h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs">
            {businessName} recebeu {formatBRL(amount)}
            {orderNumber ? ` (pedido #${String(orderNumber).padStart(4, '0')})` : ''} e já está preparando seu pedido.
          </p>
          <button
            onClick={onBackToMenu}
            className="mt-8 px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl font-bold transition-all hover:scale-[1.02]"
          >
            Voltar ao cardápio
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
      <div className="flex items-center gap-2 text-xs font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-full mb-4 w-fit">
        <CreditCard className="w-3.5 h-3.5" />
        Pague com cartão · {formatBRL(amount)}
      </div>

      <AnimatePresence>
        {phase === 'declined' && declineReason && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden mb-4"
          >
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-red-600 dark:text-red-400">{declineReason}</p>
                <button
                  onClick={retry}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-red-600 dark:text-red-400 hover:underline"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Tentar novamente
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Brick do MP — tokeniza o cartão no client; o PAN nunca toca nosso backend */}
      <div className={phase === 'declined' ? 'hidden' : 'block'}>
        <CardPayment
          key={brickKey}
          initialization={{ amount, payer: payerEmail ? { email: payerEmail } : undefined }}
          customization={{ paymentMethods: { maxInstallments } }}
          onSubmit={handleSubmit}
          locale="pt-BR"
        />
      </div>

      <AnimatePresence>
        {phase === 'processing' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-3xl"
          >
            <Loader2 className="w-8 h-8 animate-spin text-red-500" />
            <p className="mt-3 text-sm font-semibold text-gray-600 dark:text-gray-300">Processando pagamento...</p>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={onBackToMenu}
        className="mt-4 w-full text-center text-sm font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
      >
        Cancelar / voltar
      </button>
    </div>
  );
}
