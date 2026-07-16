'use client';

/**
 * PrinterSetupDialog — configuração da impressora térmica da ESTAÇÃO.
 *
 * "Achar na porta do PC + deixar padrão": [Detectar impressora] abre o seletor
 * USB do navegador (Chrome/Edge), salva o dispositivo escolhido como padrão local
 * (localStorage por businessId) e permite testar. A largura (80/58mm) fica junto.
 *
 * WebUSB é Chrome/Edge; em navegadores sem suporte, a impressão cai no diálogo do
 * navegador (o dialog explica isso). No Windows, se o dispositivo estiver
 * reivindicado pelo driver do fabricante, a detecção/impressão falha — mostramos
 * a dica de usar WinUSB (Zadig) ou o fallback de diálogo.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Printer, Usb, X, CheckCircle2, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { buildTestReceipt, type PaperWidth } from '@/lib/services/printing/comandaEscpos';
import {
  isWebUsbSupported, getPrinterConfig, requestPrinter, setPaperWidth,
  clearPrinterConfig, printBytesToDevice, type PrinterConfig,
} from '@/lib/services/printing/webusbPrinter';

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: string;
  businessName: string;
}

export default function PrinterSetupDialog({ open, onClose, businessId, businessName }: Props) {
  const [config, setConfig] = useState<PrinterConfig | null>(null);
  const [width, setWidth] = useState<PaperWidth>(80);
  const [busy, setBusy] = useState<'detect' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = isWebUsbSupported();

  useEffect(() => {
    if (!open || !businessId) return;
    const cfg = getPrinterConfig(businessId);
    setConfig(cfg);
    setWidth(cfg?.paperWidth ?? 80);
    setError(null);
  }, [open, businessId]);

  async function handleDetect() {
    setBusy('detect'); setError(null);
    try {
      const cfg = await requestPrinter(businessId, width);
      setConfig(cfg);
      toast.success(`Impressora "${cfg.label}" definida como padrão.`);
    } catch (err) {
      // Cancelar o seletor USB rejeita com DOMException NotFoundError — benigno,
      // não é erro (detecção por TIPO, não pelo texto, que varia por locale).
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        // usuário fechou o seletor sem escolher — silencioso
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Não foi possível detectar: ${msg}`);
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    if (!config) return;
    setBusy('test'); setError(null);
    try {
      const bytes = buildTestReceipt(businessName, width);
      const sent = await printBytesToDevice({ ...config, paperWidth: width }, bytes);
      if (sent) toast.success('Teste enviado à impressora.');
      else setError('Impressora não encontrada. Reconecte e detecte novamente.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        `Falha ao imprimir: ${msg}. No Windows, o driver do fabricante pode estar ` +
        `reivindicando a impressora — use WinUSB (Zadig) ou o diálogo de impressão.`,
      );
    } finally {
      setBusy(null);
    }
  }

  function handleWidth(w: PaperWidth) {
    setWidth(w);
    if (config) { setPaperWidth(businessId, w); setConfig({ ...config, paperWidth: w }); }
  }

  function handleRemove() {
    clearPrinterConfig(businessId);
    setConfig(null);
    toast.info('Impressora padrão removida. A impressão usará o diálogo do navegador.');
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl border border-gray-100 dark:border-gray-800"
            initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-red-500" />
                <h2 className="font-display font-semibold text-gray-900 dark:text-white">Impressora térmica</h2>
              </div>
              <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {!supported && (
                <div className="flex gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-sm text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Este navegador não suporta impressão direta (WebUSB). Use Chrome ou Edge no computador; a impressão usará o diálogo do navegador.</span>
                </div>
              )}

              {/* Impressora padrão */}
              <div className="rounded-xl border border-gray-100 dark:border-gray-800 p-4">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Impressora padrão desta estação</p>
                {config ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{config.label}</span>
                    </div>
                    <button onClick={handleRemove} title="Remover padrão"
                      className="p-1.5 text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Nenhuma configurada — usando o diálogo do navegador.</p>
                )}
              </div>

              {/* Largura do papel */}
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Largura do papel</p>
                <div className="flex gap-2">
                  {([80, 58] as PaperWidth[]).map((w) => (
                    <button key={w} onClick={() => handleWidth(w)}
                      className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                        width === w
                          ? 'border-red-500 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                          : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                      }`}>
                      {w}mm
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex gap-2 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Ações */}
              <div className="flex gap-2 pt-1">
                <button onClick={handleDetect} disabled={!supported || busy !== null}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-4 py-2.5 text-sm font-medium">
                  {busy === 'detect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Usb className="w-4 h-4" />}
                  {config ? 'Trocar impressora' : 'Detectar impressora'}
                </button>
                <button onClick={handleTest} disabled={!config || busy !== null}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 text-gray-700 dark:text-gray-200 px-4 py-2.5 text-sm font-medium">
                  {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  Teste
                </button>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                A impressão usa a impressora padrão desta estação. Sem uma configurada (ou se o envio falhar), abre o diálogo de impressão do navegador automaticamente.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
