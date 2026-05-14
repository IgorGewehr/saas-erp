'use client';

/**
 * BaileysQrModal — modal compartilhado pro fluxo de pareamento de qualquer
 * ChannelConnection Baileys (sender empresa OU chip validador).
 *
 * Conecta no SSE `/api/whatsapp/connect?businessId=...&connectionId=...` que
 * stream-a os eventos: qr, connected, error, disconnected (com reason).
 *
 * Por que isolado em arquivo próprio: BusinessChannelsSection e
 * ValidatorChipSection compartilham este modal — extrair evita 180 linhas
 * duplicadas e garante que melhorias no fluxo (ex: timeout, retry) batem
 * nos dois lugares de uma vez.
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Smartphone, Loader2, X, Check, AlertCircle, QrCode } from 'lucide-react';
import { useAuth } from '@/app/components/providers/AuthProvider';

interface Props {
  businessId: string;
  connectionId: string;
  onClose: () => void;
  /** Customiza o título do modal — útil pra deixar claro que o validator
   *  é diferente do chip de envio ("Conectar chip validador" vs "WhatsApp Web"). */
  title?: string;
  subtitle?: string;
}

export default function BaileysQrModal({
  businessId,
  connectionId,
  onClose,
  title = 'WhatsApp Web',
  subtitle = 'Escaneie com seu celular',
}: Props) {
  const { firebaseUser } = useAuth();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'scanning' | 'connected' | 'error' | 'replaced'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    const connect = async () => {
      try {
        const token = await firebaseUser?.getIdToken();
        if (!token || cancelled) return;

        const qs = new URLSearchParams({ businessId, connectionId });
        const url = `/api/whatsapp/connect?${qs.toString()}`;

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          if (!cancelled) {
            setStatus('error');
            setErrorMsg('Falha ao conectar com o servidor.');
          }
          return;
        }

        const reader = response.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'qr') {
                setQrDataUrl(data.qr);
                setStatus('scanning');
              } else if (data.type === 'connected') {
                setStatus('connected');
                setTimeout(onClose, 800);
              } else if (data.type === 'error') {
                setStatus('error');
                setErrorMsg(data.message || 'Erro desconhecido');
              } else if (data.type === 'disconnected') {
                if (data.reason === 'logged_out') {
                  setStatus('error');
                  setErrorMsg('Sessão revogada pelo telefone. Escaneie o QR Code novamente.');
                } else if (data.reason === 'replaced') {
                  setStatus('replaced');
                  setErrorMsg(
                    typeof data.message === 'string' && data.message
                      ? data.message
                      : 'Outro dispositivo se conectou com este número. Para usar aqui, clique em "Reconectar" — isso vai desconectar o outro.',
                  );
                }
              }
            } catch { /* skip malformed line */ }
          }
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === 'AbortError')) {
          setStatus('error');
          setErrorMsg('Erro de conexão.');
          console.error('[BaileysQrModal] SSE error:', err);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      readerRef.current?.cancel().catch(() => {});
      readerRef.current = null;
      abortController.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, businessId]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 12 }}
        className="relative z-10 w-full max-w-sm bg-white dark:bg-[#111827] rounded-2xl shadow-2xl border border-black/[0.06] dark:border-white/[0.08] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#25D366]/15 flex items-center justify-center">
              <QrCode className="w-4 h-4 text-[#25D366]" />
            </div>
            <div>
              <h3 className="font-display font-bold text-gray-900 dark:text-white text-sm">{title}</h3>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">{subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-white/[0.06] flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-6 py-6 flex flex-col items-center">
          {status === 'connecting' && (
            <div className="w-[240px] h-[240px] rounded-2xl bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.06] flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 text-[#25D366] animate-spin" />
              <p className="text-xs text-gray-500 dark:text-gray-400">Gerando QR Code…</p>
            </div>
          )}
          {status === 'scanning' && qrDataUrl && (
            <div className="flex flex-col items-center gap-4">
              <div className="p-3 bg-white rounded-2xl shadow-lg border border-gray-100">
                <img src={qrDataUrl} alt="WhatsApp QR Code" className="w-[220px] h-[220px]" />
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <div className="w-1.5 h-1.5 rounded-full bg-[#25D366] animate-pulse" />
                Aguardando leitura do QR Code…
              </div>
            </div>
          )}
          {status === 'connected' && (
            <div className="w-[240px] h-[240px] rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex flex-col items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-full bg-[#25D366] flex items-center justify-center">
                <Check className="w-7 h-7 text-white" />
              </div>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Conectado!</p>
            </div>
          )}
          {status === 'error' && (
            <div className="w-[240px] h-[240px] rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 flex flex-col items-center justify-center gap-3 px-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
              <p className="text-xs text-red-700 dark:text-red-400 text-center">{errorMsg}</p>
            </div>
          )}
          {status === 'replaced' && (
            <div className="w-full max-w-[280px] rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex flex-col items-center justify-center gap-3 px-5 py-6">
              <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center">
                <Smartphone className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 text-center">
                Sessão substituída
              </p>
              <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 text-center leading-relaxed">
                {errorMsg}
              </p>
              <p className="text-[10px] text-amber-700/60 dark:text-amber-400/60 text-center mt-1">
                WhatsApp permite até 4 dispositivos vinculados; cada um precisa do próprio QR Code.
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
