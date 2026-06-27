'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { initMercadoPago, CardPayment } from '@mercadopago/sdk-react';
import type { ICardPaymentFormData, ICardPaymentBrickPayer } from '@mercadopago/sdk-react/esm/bricks/cardPayment/type';
import { CreditCard, CheckCircle2, Loader2, AlertCircle, RotateCcw } from 'lucide-react';

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

type CardPhase = 'form' | 'processing' | 'approved' | 'declined';

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

  const handleSubmit = useCallback(
    async (formData: ICardPaymentFormData<ICardPaymentBrickPayer>): Promise<void> => {
      setPhase('processing');
      setDeclineReason(null);
      try {
        const res = await fetch(`/api/orders/${orderId}/pay-card`, {
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
        const data = await res.json();

        if (res.ok && data?.ok && (data.data?.status === 'paid' || data.data?.status === 'authorized')) {
          if (!approvedRef.current) {
            approvedRef.current = true;
            onApproved();
          }
          setPhase('approved');
          return; // resolve → não reabre o formulário
        }

        // Recusa NÃO é terminal: busca o motivo e permite nova tentativa.
        let reason = data?.error?.message || 'Pagamento recusado. Confira os dados e tente novamente.';
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

        setDeclineReason(reason);
        setPhase('declined');
        // Rejeita p/ o Brick não exibir tela de sucesso própria.
        throw new Error(reason);
      } catch (err) {
        if (!approvedRef.current) {
          setPhase(prev => (prev === 'approved' ? prev : 'declined'));
          setDeclineReason(prev => prev ?? (err instanceof Error ? err.message : 'Falha ao processar o cartão.'));
        }
        throw err instanceof Error ? err : new Error('Falha ao processar o cartão.');
      }
    },
    [orderId, trackingToken, payerEmail, onApproved],
  );

  const retry = useCallback(() => {
    setPhase('form');
    setDeclineReason(null);
    setBrickKey(k => k + 1);
  }, []);

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
