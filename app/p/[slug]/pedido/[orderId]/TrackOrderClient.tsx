'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, ChefHat, PackageCheck, Truck, CheckCircle2,
  Clock, Copy, Check, QrCode, AlertCircle, Loader2, XCircle,
  RefreshCw, Wallet, PartyPopper,
} from 'lucide-react';
import type { DeliveryOrderStatus, DeliveryOrderPaymentStatus } from '@/lib/types';
import type { PaymentFsmStatus } from '@/lib/contracts/fsm/payment';

/**
 * TrackOrderClient — acompanhamento em tempo (quase) real de um pedido público.
 *
 * Faz polling de GET /api/orders/[id]/status?token= a cada POLL_MS. A resposta é
 * a projeção mínima da rota (não confiar em outros campos). Token vem do server
 * component (capability URL). 404 → pedido inexistente/expirado (não distingue).
 */

const POLL_MS = 5000;
// Após este nº de ciclos sem mudança de estado, pausamos o polling (≈5 min) e
// oferecemos refresh manual. Evita polling eterno/consumo quando nada mais muda
// pela tela (ex.: PIX expirado/recusado com pedido ainda não finalizado).
const MAX_IDLE_CYCLES = 60;

// Projeção mínima devolvida por /api/orders/[id]/status (R6: confiamos no shape).
interface OrderStatusResponse {
  status: DeliveryOrderStatus;
  paymentFsmStatus?: PaymentFsmStatus;
  paymentStatus?: DeliveryOrderPaymentStatus;
  number: number;
  paymentExpiresAt?: string;
  qrCode?: string;
  copiaECola?: string;
  qrCodeBase64?: string;
  lastPaymentDeclineReason?: string;
}

// ── Timeline de FABRICAÇÃO (espelha lib/contracts/fsm/deliveryOrder.ts) ───────
const FAB_STEPS: { key: DeliveryOrderStatus; label: string; icon: typeof ClipboardList }[] = [
  { key: 'recebido', label: 'Recebido', icon: ClipboardList },
  { key: 'preparando', label: 'Preparando', icon: ChefHat },
  { key: 'pronto', label: 'Pronto', icon: PackageCheck },
  { key: 'saiu_entrega', label: 'Saiu para entrega', icon: Truck },
  { key: 'entregue', label: 'Entregue', icon: CheckCircle2 },
];

function isTerminal(s?: OrderStatusResponse): boolean {
  if (!s) return false;
  const orderDone = s.status === 'entregue' || s.status === 'cancelado';
  const fsm = s.paymentFsmStatus;
  // Sem pagamento online (sem fsm) → o dinheiro não muda mais via polling.
  const paySettled = !fsm || fsm === 'paid' || fsm === 'refunded' || fsm === 'expired' || fsm === 'failed';
  return orderDone && paySettled;
}

// Assinatura dos campos exibidos: se não muda entre ciclos, contamos como "idle".
function statusSig(s: OrderStatusResponse): string {
  return `${s.status}|${s.paymentFsmStatus ?? ''}|${s.paymentStatus ?? ''}`;
}

export default function TrackOrderClient({
  orderId,
  token,
  businessName,
  businessLogo,
}: {
  orderId: string;
  token: string;
  businessName?: string;
  businessLogo?: string;
}) {
  const [data, setData] = useState<OrderStatusResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const notFoundRef = useRef(false);
  const idleCountRef = useRef(0);
  const lastSigRef = useRef<string | null>(null);

  const fetchStatus = useCallback(async (): Promise<OrderStatusResponse | null> => {
    if (!token) {
      notFoundRef.current = true;
      setNotFound(true);
      setLoading(false);
      return null;
    }
    try {
      const res = await fetch(
        `/api/orders/${orderId}/status?token=${encodeURIComponent(token)}`,
        { cache: 'no-store' },
      );
      if (res.status === 404) {
        notFoundRef.current = true;
        setNotFound(true);
        setLoading(false);
        return null;
      }
      if (res.status === 429) {
        // Rate-limited: mantém dados atuais, tenta de novo no próximo ciclo.
        return data;
      }
      if (!res.ok) return data;
      const json = (await res.json()) as OrderStatusResponse;
      setData(json);
      setLoading(false);
      return json;
    } catch {
      // Rede instável: não derruba a tela, mantém último estado.
      return data;
    }
  }, [orderId, token, data]);

  // Polling com setTimeout encadeado. Pausa em: estado terminal, 404, ou após
  // MAX_IDLE_CYCLES sem mudança de estado. Pausado → refresh manual reativa.
  useEffect(() => {
    if (paused) return;
    cancelledRef.current = false;
    const tick = async () => {
      const latest = await fetchStatus();
      if (cancelledRef.current) return;
      if (notFoundRef.current) return; // pedido inexistente/expirado → para
      if (latest && isTerminal(latest)) {
        setPaused(true); // chegou ao fim → exibição final, para de pollar
        return;
      }
      if (latest) {
        const sig = statusSig(latest);
        if (sig === lastSigRef.current) {
          idleCountRef.current += 1;
        } else {
          lastSigRef.current = sig;
          idleCountRef.current = 0;
        }
        if (idleCountRef.current >= MAX_IDLE_CYCLES) {
          setPaused(true); // nada muda há muito tempo → pausa, oferece refresh
          return;
        }
      }
      timerRef.current = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // fetchStatus muda quando `data` muda; o encadeamento já cuida do loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, token, paused]);

  // Refresh manual (botão "Atualizar"): busca uma vez; se ainda houver o que
  // acompanhar, retoma o polling automático.
  const refreshNow = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const latest = await fetchStatus();
    setRefreshing(false);
    if (latest && !isTerminal(latest) && !notFoundRef.current) {
      idleCountRef.current = 0;
      lastSigRef.current = statusSig(latest);
      setPaused(false); // retoma o loop automático
    }
  }, [fetchStatus, refreshing]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">
      <Header name={businessName} logo={businessLogo} />

      <main className="max-w-md mx-auto px-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))]">
        <AnimatePresence mode="wait">
          {loading && !data && !notFound && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-24 text-gray-400"
            >
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p className="text-sm">Carregando seu pedido…</p>
            </motion.div>
          )}

          {notFound && (
            <NotFoundCard key="notfound" />
          )}

          {data && !notFound && (
            <motion.div
              key="content"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-5 pt-5"
            >
              <OrderNumberBadge
                number={data.number}
                status={data.status}
                paused={paused}
                refreshing={refreshing}
                onRefresh={refreshNow}
              />
              <FabricationTimeline status={data.status} />
              <PaymentSection data={data} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────
function Header({ name, logo }: { name?: string; logo?: string }) {
  return (
    <header className="sticky top-0 z-10 backdrop-blur bg-white/80 dark:bg-gray-950/80 border-b border-gray-100 dark:border-gray-800">
      <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 overflow-hidden flex items-center justify-center flex-shrink-0">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={name ?? ''} referrerPolicy="no-referrer" className="w-full h-full object-contain p-0.5" />
          ) : (
            <PackageCheck className="w-4 h-4 text-red-500" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 leading-none mb-0.5">
            Acompanhar pedido
          </p>
          <p className="text-sm font-bold truncate">{name ?? 'Seu pedido'}</p>
        </div>
      </div>
    </header>
  );
}

// ─── Order number badge ────────────────────────────────────────────────────────
function OrderNumberBadge({
  number,
  status,
  paused,
  refreshing,
  onRefresh,
}: {
  number: number;
  status: DeliveryOrderStatus;
  paused: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const cancelled = status === 'cancelado';
  return (
    <div className="flex items-center justify-between">
      <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-full">
        <span className="text-xs text-gray-400">Pedido</span>
        <span className="font-black">#{String(number).padStart(4, '0')}</span>
      </div>
      {paused ? (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Atualizando…' : 'Atualizar'}
        </button>
      ) : !cancelled ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
          <RefreshCw className="w-3 h-3 animate-spin [animation-duration:3s]" />
          Atualizando…
        </span>
      ) : null}
    </div>
  );
}

// ─── Fabrication timeline ──────────────────────────────────────────────────────
function FabricationTimeline({ status }: { status: DeliveryOrderStatus }) {
  if (status === 'cancelado') {
    return (
      <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-5 flex items-start gap-3">
        <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-red-700 dark:text-red-300">Pedido cancelado</p>
          <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-0.5">
            Este pedido foi cancelado. Em caso de dúvida, entre em contato com o estabelecimento.
          </p>
        </div>
      </div>
    );
  }

  const currentIdx = FAB_STEPS.findIndex(s => s.key === status);
  const delivered = status === 'entregue';

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      {delivered && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-2 mb-5 text-emerald-600 dark:text-emerald-400"
        >
          <PartyPopper className="w-5 h-5" />
          <p className="font-bold">Pedido entregue. Bom apetite!</p>
        </motion.div>
      )}
      <ol className="relative">
        {FAB_STEPS.map((step, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          const Icon = step.icon;
          const isLast = i === FAB_STEPS.length - 1;
          return (
            <li key={step.key} className="relative flex gap-3 pb-6 last:pb-0">
              {!isLast && (
                <span
                  className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${
                    done ? 'bg-red-500' : 'bg-gray-200 dark:bg-gray-800'
                  }`}
                />
              )}
              <div
                className={`relative z-[1] w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                  done
                    ? 'bg-red-500 text-white'
                    : active
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                }`}
              >
                {active && (
                  <motion.span
                    className="absolute inset-0 rounded-full bg-red-500/40"
                    animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                  />
                )}
                <Icon className="w-4 h-4 relative" />
              </div>
              <div className="pt-1">
                <p
                  className={`text-sm font-semibold ${
                    active
                      ? 'text-gray-900 dark:text-white'
                      : done
                        ? 'text-gray-600 dark:text-gray-300'
                        : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </p>
                {active && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-xs text-red-500 font-medium mt-0.5"
                  >
                    Etapa atual
                  </motion.p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ─── Payment section ───────────────────────────────────────────────────────────
function PaymentSection({ data }: { data: OrderStatusResponse }) {
  const fsm = data.paymentFsmStatus;
  const legacy = data.paymentStatus;

  // PIX pendente com cobrança ativa → mostra copia-e-cola + QR + timer.
  const pixPending =
    fsm === 'pending' && (!!data.copiaECola || !!data.qrCode);

  const paid = fsm === 'paid' || legacy === 'pago';
  const refunded = fsm === 'refunded' || legacy === 'estornado';

  if (pixPending) {
    return <PixPanel data={data} />;
  }

  let tone: 'ok' | 'warn' | 'bad' | 'muted';
  let icon: typeof Wallet;
  let title: string;
  let subtitle: string;

  if (paid) {
    tone = 'ok';
    icon = CheckCircle2;
    title = 'Pagamento confirmado';
    subtitle = 'Recebemos seu pagamento.';
  } else if (refunded) {
    tone = 'muted';
    icon = RefreshCw;
    title = 'Pagamento estornado';
    subtitle = 'O valor foi devolvido.';
  } else if (fsm === 'expired') {
    tone = 'warn';
    icon = Clock;
    title = 'PIX expirado';
    subtitle = 'O tempo para pagar via PIX acabou. Fale com o estabelecimento.';
  } else if (fsm === 'failed') {
    tone = 'bad';
    icon = XCircle;
    title = 'Pagamento recusado';
    subtitle = data.lastPaymentDeclineReason || 'Não foi possível processar o pagamento.';
  } else {
    // Sem pagamento online (paga na entrega) ou aguardando.
    tone = 'muted';
    icon = Wallet;
    title = 'Pagamento pendente';
    subtitle = 'O pagamento será feito na entrega/retirada.';
  }

  const toneCls: Record<typeof tone, string> = {
    ok: 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
    warn: 'border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
    bad: 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300',
    muted: 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300',
  };
  const Icon = icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border p-4 flex items-start gap-3 ${toneCls[tone]}`}
    >
      <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-bold text-sm">{title}</p>
        <p className="text-xs opacity-80 mt-0.5">{subtitle}</p>
      </div>
    </motion.div>
  );
}

// ─── PIX panel (copia-e-cola + QR + timer) ─────────────────────────────────────
function PixPanel({ data }: { data: OrderStatusResponse }) {
  const [copied, setCopied] = useState(false);
  const code = data.copiaECola || data.qrCode || '';

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponível — usuário pode selecionar manualmente */
    }
  }, [code]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <QrCode className="w-5 h-5 text-red-500" />
        <p className="font-bold">Pague com PIX</p>
      </div>

      <PixTimer expiresAt={data.paymentExpiresAt} />

      {data.qrCodeBase64 && (
        <div className="flex justify-center my-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${data.qrCodeBase64}`}
            alt="QR Code PIX"
            className="w-48 h-48 rounded-xl bg-white p-2"
          />
        </div>
      )}

      <p className="text-xs text-gray-400 mb-2">Ou copie o código PIX:</p>
      <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 p-3 mb-3">
        <p className="text-[11px] font-mono break-all text-gray-600 dark:text-gray-300 leading-relaxed">
          {code}
        </p>
      </div>

      <button
        onClick={copy}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl font-bold transition-all hover:scale-[1.01] active:scale-[0.99]"
      >
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.span
              key="copied"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2"
            >
              <Check className="w-4 h-4" /> Copiado!
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-2"
            >
              <Copy className="w-4 h-4" /> Copiar código PIX
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <p className="text-[11px] text-gray-400 text-center mt-3">
        Assim que o pagamento for confirmado, esta tela atualiza sozinha.
      </p>
    </motion.div>
  );
}

// ─── PIX countdown ─────────────────────────────────────────────────────────────
function PixTimer({ expiresAt }: { expiresAt?: string }) {
  const expiryMs = useMemo(() => {
    if (!expiresAt) return null;
    const ms = Date.parse(expiresAt);
    return Number.isNaN(ms) ? null : ms;
  }, [expiresAt]);

  const [remaining, setRemaining] = useState<number>(() =>
    expiryMs ? Math.max(0, expiryMs - Date.now()) : 0,
  );

  useEffect(() => {
    if (!expiryMs) return;
    const id = setInterval(() => {
      setRemaining(Math.max(0, expiryMs - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [expiryMs]);

  if (!expiryMs) return null;

  const expired = remaining <= 0;
  const totalSec = Math.floor(remaining / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');

  return (
    <div
      className={`flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold ${
        expired
          ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
          : 'bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-200'
      }`}
    >
      <Clock className="w-4 h-4" />
      {expired ? 'Tempo esgotado' : <>Expira em {mm}:{ss}</>}
    </div>
  );
}

// ─── Not found / expired ───────────────────────────────────────────────────────
function NotFoundCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center text-center py-24"
    >
      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-5">
        <AlertCircle className="w-8 h-8 text-gray-400" />
      </div>
      <h2 className="text-lg font-black mb-2">Pedido não encontrado</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
        Este link de acompanhamento é inválido ou expirou. Confira o link enviado
        ou entre em contato com o estabelecimento.
      </p>
    </motion.div>
  );
}
