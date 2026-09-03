'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QrCode, Copy, ExternalLink, Check, Printer, Download, X, Settings2 } from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from 'react-toastify';
import type { BusinessTable } from '@/lib/contracts/domain/tableSession';

function menuUrl(origin: string, slug: string, mesa?: string): string {
  const base = `${origin}/p/${slug}`;
  return mesa ? `${base}?mesa=${encodeURIComponent(mesa)}` : base;
}

async function svgFor(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 1, width: 240 });
}

async function downloadPng(label: string, url: string) {
  try {
    const dataUrl = await QRCode.toDataURL(url, { margin: 2, width: 600 });
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qr-${label.toLowerCase().replace(/\s+/g, '-')}.png`;
    a.click();
  } catch {
    toast.error('Não foi possível gerar o PNG.');
  }
}

async function printSheet(origin: string, slug: string, businessName: string, tables: BusinessTable[]) {
  if (tables.length === 0) { toast.warn('Configure as mesas primeiro.'); return; }
  const cells = await Promise.all(tables.map(async t => {
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
}

// ─── Modal reutilizável (Cardápio + Mesas) ───────────────────────────────────
export function MesaQrSheet({
  slug, tables, businessName, onClose, onConfigure,
}: {
  slug: string;
  tables: BusinessTable[];
  businessName: string;
  onClose: () => void;
  onConfigure?: () => void;
}) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const [rangeInput, setRangeInput] = useState('');
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const effectiveTables = useMemo<BusinessTable[]>(() => {
    if (tables.length > 0) return tables;
    const n = parseInt(rangeInput, 10);
    if (Number.isFinite(n) && n > 0 && n <= 200) {
      return Array.from({ length: n }, (_, i) => ({ id: `n${i + 1}`, label: `Mesa ${i + 1}` }));
    }
    return [];
  }, [tables, rangeInput]);

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all([
        ['__base__', await svgFor(menuUrl(origin, slug))] as const,
        ...effectiveTables.map(async t => [t.id, await svgFor(menuUrl(origin, slug, t.label))] as const),
      ]);
      if (!cancelled) setSvgs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [effectiveTables, origin, slug]);

  const publicUrl = menuUrl(origin, slug);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="relative w-full sm:max-w-2xl bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center justify-between p-5 pb-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <QrCode className="w-5 h-5 text-red-500" /> QR codes das mesas
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Link base */}
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 p-3">
            <div
              className="w-12 h-12 flex-shrink-0 bg-white rounded p-0.5 [&>svg]:w-full [&>svg]:h-full"
              dangerouslySetInnerHTML={{ __html: svgs.__base__ || '' }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Cardápio público</p>
              <p className="text-sm text-gray-900 dark:text-gray-100 truncate">{publicUrl}</p>
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(publicUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>

          {tables.length === 0 && (
            <div className="flex items-center gap-2">
              <input
                value={rangeInput}
                onChange={e => setRangeInput(e.target.value.replace(/\D/g, ''))}
                placeholder="Quantas mesas? (ex: 12)"
                className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/30"
              />
              {onConfigure && (
                <button onClick={onConfigure} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">
                  <Settings2 className="w-3.5 h-3.5" /> Configurar
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {effectiveTables.length} mesa{effectiveTables.length === 1 ? '' : 's'} · o QR trava a mesa no checkout
            </p>
            <button
              onClick={() => printSheet(origin, slug, businessName, effectiveTables)}
              disabled={effectiveTables.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> Imprimir folha A4
            </button>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {effectiveTables.map(t => (
              <div key={t.id} className="rounded-xl border border-gray-200 dark:border-gray-800 p-2.5 text-center">
                <div
                  className="w-full aspect-square bg-white rounded-lg p-1 [&>svg]:w-full [&>svg]:h-full"
                  dangerouslySetInnerHTML={{ __html: svgs[t.id] || '' }}
                />
                <p className="mt-1.5 text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{t.label}</p>
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
    </motion.div>
  );
}

// ─── Card mostrado no topo do Cardápio ───────────────────────────────────────
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [baseSvg, setBaseSvg] = useState('');

  useEffect(() => {
    if (!origin) return;
    void svgFor(publicUrl).then(setBaseSvg).catch(() => {});
  }, [origin, publicUrl]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => toast.error('Não foi possível copiar.'));
  }, [publicUrl]);

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
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
          <button onClick={copy} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700">
            <ExternalLink className="w-3.5 h-3.5" /> Abrir
          </a>
          <button onClick={() => setSheetOpen(true)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 text-white">
            <QrCode className="w-3.5 h-3.5" /> QR por mesa
          </button>
        </div>
      </div>

      <AnimatePresence>
        {sheetOpen && (
          <MesaQrSheet
            slug={slug}
            tables={tables}
            businessName={businessName}
            onClose={() => setSheetOpen(false)}
            onConfigure={onConfigure}
          />
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
