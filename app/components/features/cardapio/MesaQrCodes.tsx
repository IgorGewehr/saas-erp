'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QrCode, Copy, ExternalLink, Check, Printer, Download, X, Settings2 } from 'lucide-react';
import QRCode from 'qrcode';
import { cn } from '@/lib/utils';
import { toast } from 'react-toastify';
import type { BusinessTable } from '@/lib/contracts/domain/tableSession';

function menuUrl(origin: string, slug: string, mesa?: string): string {
  const base = `${origin}/p/${slug}`;
  return mesa ? `${base}?mesa=${encodeURIComponent(mesa)}` : base;
}

async function svgFor(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 1, width: 240 });
}

export default function MesaQrCodes({
  slug, tables, businessName, onConfigure,
}: {
  slug: string;
  tables: BusinessTable[];
  businessName: string;
  onConfigure: () => void;
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = menuUrl(origin, slug);

  const [copied, setCopied] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [baseSvg, setBaseSvg] = useState('');
  const [tableSvgs, setTableSvgs] = useState<Record<string, string>>({});
  const [rangeInput, setRangeInput] = useState('');

  useEffect(() => {
    if (!origin) return;
    void svgFor(publicUrl).then(setBaseSvg).catch(() => {});
  }, [origin, publicUrl]);

  // Mesas efetivas: as configuradas, ou o intervalo digitado na hora.
  const effectiveTables = useMemo<BusinessTable[]>(() => {
    if (tables.length > 0) return tables;
    const n = parseInt(rangeInput, 10);
    if (Number.isFinite(n) && n > 0 && n <= 200) {
      return Array.from({ length: n }, (_, i) => ({ id: `n${i + 1}`, label: `Mesa ${i + 1}` }));
    }
    return [];
  }, [tables, rangeInput]);

  useEffect(() => {
    if (!showTables || !origin) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        effectiveTables.map(async t => [t.id, await svgFor(menuUrl(origin, slug, t.label))] as const),
      );
      if (!cancelled) setTableSvgs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [showTables, effectiveTables, origin, slug]);

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => toast.error('Não foi possível copiar.'));
  }, []);

  const downloadPng = useCallback(async (label: string, url: string) => {
    try {
      const dataUrl = await QRCode.toDataURL(url, { margin: 2, width: 600 });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `qr-${label.toLowerCase().replace(/\s+/g, '-')}.png`;
      a.click();
    } catch {
      toast.error('Não foi possível gerar o PNG.');
    }
  }, []);

  const printSheet = useCallback(async () => {
    if (effectiveTables.length === 0) {
      toast.warn('Configure as mesas primeiro.');
      return;
    }
    const cells = await Promise.all(effectiveTables.map(async t => {
      const svg = await svgFor(menuUrl(origin, slug, t.label));
      return `<div class="cell"><div class="qr">${svg}</div><div class="label">${t.label}</div><div class="biz">${businessName}</div></div>`;
    }));
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) { toast.error('Permita pop-ups para imprimir.'); return; }
    win.document.write(`<!doctype html><html><head><title>QR Codes das mesas</title><style>
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      body { font-family: system-ui, sans-serif; margin: 0; }
      .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14mm; }
      .cell { border: 1px dashed #bbb; border-radius: 10px; padding: 8mm; text-align: center; page-break-inside: avoid; }
      .qr svg { width: 55mm; height: 55mm; }
      .label { font-size: 20pt; font-weight: 800; margin-top: 4mm; }
      .biz { font-size: 10pt; color: #666; margin-top: 1mm; }
      h1 { font-size: 13pt; margin: 0 0 6mm; }
    </style></head><body>
      <h1>Escaneie para ver o cardápio e pedir — ${businessName}</h1>
      <div class="grid">${cells.join('')}</div>
      <script>window.onload = () => { window.print(); }</script>
    </body></html>`);
    win.document.close();
  }, [effectiveTables, origin, slug, businessName]);

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-14 h-14 flex-shrink-0 rounded-lg bg-white p-1 [&>svg]:w-full [&>svg]:h-full"
            dangerouslySetInnerHTML={{ __html: baseSvg }}
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Link do cardápio público</p>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{publicUrl}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => copy(publicUrl)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Abrir
          </a>
        </div>
      </div>

      <button
        onClick={() => setShowTables(v => !v)}
        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <QrCode className="w-4 h-4" /> Mesas & QR codes
      </button>

      <AnimatePresence>
        {showTables && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-2 space-y-3">
              {tables.length === 0 && (
                <div className="flex items-center gap-2">
                  <input
                    value={rangeInput}
                    onChange={e => setRangeInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="Quantidade de mesas (ex: 12)"
                    className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30"
                  />
                  <button
                    onClick={onConfigure}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    <Settings2 className="w-3.5 h-3.5" /> Configurar
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {effectiveTables.length} mesa{effectiveTables.length === 1 ? '' : 's'} · cada QR trava a mesa no checkout
                </p>
                <button
                  onClick={printSheet}
                  disabled={effectiveTables.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" /> Imprimir folha
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[380px] overflow-y-auto">
                {effectiveTables.map(t => (
                  <div key={t.id} className="rounded-xl border border-gray-200 dark:border-gray-800 p-2.5 text-center">
                    <div
                      className="w-full aspect-square bg-white rounded-lg p-1 [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: tableSvgs[t.id] || '' }}
                    />
                    <p className="mt-1.5 text-sm font-bold text-gray-900 dark:text-gray-100">{t.label}</p>
                    <button
                      onClick={() => downloadPng(t.label, menuUrl(origin, slug, t.label))}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                    >
                      <Download className="w-3 h-3" /> PNG
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Card mostrado quando o negócio ainda não tem slug configurado. */
export function CardapioLinkMissing({ onConfigure }: { onConfigure: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
          <QrCode className="w-5 h-5 text-red-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Link do cardápio ainda não configurado</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Defina um endereço curto para compartilhar e gerar QR codes por mesa.</p>
        </div>
      </div>
      <button
        onClick={onConfigure}
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
      >
        <Settings2 className="w-4 h-4" /> Definir link
      </button>
    </div>
  );
}
