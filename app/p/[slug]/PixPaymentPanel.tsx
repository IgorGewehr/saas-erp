'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, QrCode, Clock, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PixCharge {
  qrCode: string;        // copia-e-cola payload (EMV)
  copiaECola: string;    // idem (alias do backend)
  qrCodeBase64: string;  // PNG em base64 (sem prefixo data:)
  expiresAt: string;     // ISO 8601
  externalPaymentId: string;
}

interface Props {
  orderId: string;
  trackingToken: string;
  orderNumber: number | null;
  amount: number;
  pix: PixCharge;
  businessName: string;
  /** Chamado uma única vez quando o pagamento confirma (pai limpa carrinho). */
  onConfirmed: () => void;
  /** Encerra o checkout e volta ao cardápio. */
  onBackToMenu: () => void;
}

type PixPhase = 'waiting' | 'confirmed' | 'expired';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function qrSrc(base64: string): string {
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
}

const POLL_INTERVAL_MS = 3500;
const SETTLED = new Set(['paid', 'authorized']);

// ─── Component ────────────────────────────────────────────────────────────────

export default function PixPaymentPanel({
  orderId, trackingToken, orderNumber, amount, pix, businessName, onConfirmed, onBackToMenu,
}: Props) {
  const [phase, setPhase] = useState<PixPhase>('waiting');
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState<number>(() =>
    Math.max(0, new Date(pix.expiresAt).getTime() - Date.now()),
  );

  const confirmedRef = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Contagem regressiva de expiração ───────────────────────────────────────
  useEffect(() => {
    const expiresMs = new Date(pix.expiresAt).getTime();
    const tick = () => {
      const left = expiresMs - Date.now();
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        setPhase(p => (p === 'confirmed' ? p : 'expired'));
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pix.expiresAt]);

  // ── Confirmação PASSIVA por polling do status público ───────────────────────
  useEffect(() => {
    if (phase !== 'waiting') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active) return;
      try {
        const res = await fetch(
          `/api/orders/${orderId}/status?token=${encodeURIComponent(trackingToken)}`,
          { cache: 'no-store' },
        );
        if (active && res.ok) {
          const data = await res.json();
          if (data?.paymentFsmStatus && SETTLED.has(data.paymentFsmStatus)) {
            if (!confirmedRef.current) {
              confirmedRef.current = true;
              onConfirmed();
            }
            setPhase('confirmed');
            return; // para o loop ao confirmar
          }
        }
      } catch {
        // rede instável — ignora e tenta de novo no próximo ciclo
      }
      if (active) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, orderId, trackingToken, onConfirmed]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pix.copiaECola || pix.qrCode);
    } catch {
      // clipboard indisponível (HTTP/permite) — seleção manual ainda funciona
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }, [pix.copiaECola, pix.qrCode]);

  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  const timeLabel = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  return (
    <div className="p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
      <AnimatePresence mode="wait">

        {/* ── Confirmado ──────────────────────────────────────────────────── */}
        {phase === 'confirmed' ? (
          <motion.div
            key="confirmed"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center text-center py-10"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
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
            <motion.h3
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              className="text-2xl font-black text-gray-900 dark:text-white mb-2"
            >
              Pagamento confirmado!
            </motion.h3>
            <motion.p
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
              className="text-gray-500 dark:text-gray-400 text-sm max-w-xs"
            >
              {businessName} já recebeu seu pagamento de {formatBRL(amount)}
              {orderNumber ? ` (pedido #${String(orderNumber).padStart(4, '0')})` : ''} e está preparando tudo.
            </motion.p>
            <button
              onClick={onBackToMenu}
              className="mt-8 px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl font-bold transition-all hover:scale-[1.02]"
            >
              Voltar ao cardápio
            </button>
          </motion.div>

        ) : phase === 'expired' ? (
          /* ── Expirado ─────────────────────────────────────────────────── */
          <motion.div
            key="expired"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center text-center py-10"
          >
            <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center mb-5">
              <Clock className="w-9 h-9 text-amber-500" />
            </div>
            <h3 className="text-xl font-black text-gray-900 dark:text-white mb-2">Código PIX expirado</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs">
              O tempo para pagar este código acabou. Seu pedido foi registrado —
              {' '}fale com {businessName} pelo WhatsApp para concluir o pagamento.
            </p>
            <button
              onClick={onBackToMenu}
              className="mt-7 px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl font-bold transition-all hover:scale-[1.02]"
            >
              Voltar ao cardápio
            </button>
          </motion.div>

        ) : (
          /* ── Aguardando pagamento ──────────────────────────────────────── */
          <motion.div
            key="waiting"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1.5 rounded-full mb-4">
              <QrCode className="w-3.5 h-3.5" />
              Pague com PIX · {formatBRL(amount)}
            </div>

            {/* QR */}
            <div className="bg-white p-3 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
              <img
                src={qrSrc(pix.qrCodeBase64)}
                alt="QR Code PIX"
                className="w-52 h-52 object-contain"
              />
            </div>

            <p className="text-xs text-gray-400 mt-3 text-center max-w-xs">
              Abra o app do seu banco, escaneie o QR ou copie o código abaixo.
            </p>

            {/* Copia e cola */}
            <button
              onClick={handleCopy}
              className={`mt-4 w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-base transition-all active:scale-[0.98] ${
                copied
                  ? 'bg-emerald-500 text-white'
                  : 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/25'
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                {copied ? (
                  <motion.span key="done" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Check className="w-5 h-5" /> Copiado!
                  </motion.span>
                ) : (
                  <motion.span key="copy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Copy className="w-5 h-5" /> Copiar código PIX
                  </motion.span>
                )}
              </AnimatePresence>
            </button>

            {/* Código truncado p/ referência */}
            <p className="mt-3 w-full text-center text-[11px] font-mono text-gray-400 break-all line-clamp-2 px-2">
              {pix.copiaECola || pix.qrCode}
            </p>

            {/* Status + timer */}
            <div className="mt-5 w-full flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-800/60 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                <span className="font-medium">Aguardando pagamento...</span>
              </div>
              <div className={`flex items-center gap-1 text-xs font-bold ${remaining < 60000 ? 'text-red-500' : 'text-gray-400'}`}>
                <Clock className="w-3.5 h-3.5" />
                {timeLabel}
              </div>
            </div>

            <div className="mt-3 flex items-start gap-1.5 text-[11px] text-gray-400 px-1">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              <span>A confirmação é automática. Não feche esta tela após pagar.</span>
            </div>

            <button
              onClick={onBackToMenu}
              className="mt-4 text-sm font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              Pagar depois / voltar
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
