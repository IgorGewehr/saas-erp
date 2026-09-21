'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { ExternalLink, FileText, Loader2, Share2 } from 'lucide-react';
import { loadLogoDataUrl } from '@/lib/pdf/loadLogo';
import { buildProposalDocument, type LetterheadInput, type ProposalDocumentInput } from '@/lib/pdf/proposalDocument';
import { cn } from '@/lib/utils';

export const PDF_VALIDITY_OPTIONS = [7, 15, 30] as const;
export const PDF_NOTES_MAX = 600;

type DocumentData = Omit<ProposalDocumentInput, 'business' | 'issuedAt' | 'validityDays' | 'notes'>;

interface ProposalPdfSectionProps {
  letterhead: LetterheadInput;
  /** Logo da empresa (URL do Storage) — melhor esforço; sem ele o timbre sai só com o nome. */
  logoUrl?: string;
  document: DocumentData;
  /** Só na proposta (ainda não fechada): validade e observações. */
  options?: {
    validityDays: number;
    notes: string;
    onValidityChange: (days: number) => void;
    onNotesChange: (text: string) => void;
  };
}

type PdfState =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'ready'; url: string; file: File; title: string };

/**
 * Gera o PDF e mostra "Compartilhar" / "Abrir" como botões de toque separados: no Safari do iPad
 * `navigator.share` e `window.open` só funcionam dentro do gesto do usuário, e gerar o PDF (async)
 * já gastou esse gesto — por isso são dois toques, não um.
 */
export function ProposalPdfSection({ letterhead, logoUrl, document: data, options }: ProposalPdfSectionProps) {
  const [state, setState] = useState<PdfState>({ status: 'idle' });
  const urlRef = useRef<string | null>(null);
  const isDeal = data.kind === 'deal';

  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  // O PDF pronto descreve a proposta de QUANDO foi gerado; qualquer mudança invalida.
  const signature = useMemo(
    () => JSON.stringify([data, letterhead, options?.validityDays, options?.notes]),
    [data, letterhead, options?.validityDays, options?.notes],
  );
  useEffect(() => {
    releaseUrl();
    setState({ status: 'idle' });
  }, [signature, releaseUrl]);
  useEffect(() => releaseUrl, [releaseUrl]);

  const generate = async () => {
    if (state.status === 'working') return;
    setState({ status: 'working' });
    try {
      const [logoDataUrl, { renderProposalPdf }] = await Promise.all([
        loadLogoDataUrl(logoUrl),
        import('@/lib/pdf/renderProposalPdf'),
      ]);
      const model = buildProposalDocument({
        ...data,
        business: letterhead,
        issuedAt: new Date(),
        ...(options ? { validityDays: options.validityDays, notes: options.notes } : {}),
      });
      const blob = await renderProposalPdf(model, { logoDataUrl });
      releaseUrl();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setState({ status: 'ready', url, file: new File([blob], model.fileName, { type: 'application/pdf' }), title: model.title });
    } catch (error) {
      console.error('[Vitrine] falha ao gerar PDF:', error);
      toast.error('Não foi possível gerar o PDF. Tente de novo.');
      setState({ status: 'idle' });
    }
  };

  const share = async () => {
    if (state.status !== 'ready') return;
    try {
      await navigator.share({ files: [state.file], title: state.title });
    } catch (error) {
      // Fechar a folha de compartilhamento (AbortError) não é erro.
      if ((error as { name?: string } | null)?.name !== 'AbortError') {
        toast.error('Não foi possível compartilhar. Use "Abrir PDF".');
      }
    }
  };

  const canShare = state.status === 'ready'
    && typeof navigator !== 'undefined'
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [state.file] });

  return (
    <section aria-label={isDeal ? 'PDF do negócio' : 'PDF da proposta'} className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {isDeal ? 'PDF do negócio' : 'PDF da proposta'}
      </h3>

      {options && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-300">Válida por</span>
            {PDF_VALIDITY_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={options.validityDays === days}
                onClick={() => options.onValidityChange(days)}
                className={cn(
                  'h-11 touch-manipulation rounded-full px-4 text-sm font-medium transition-colors',
                  options.validityDays === days
                    ? 'bg-red-600 text-white shadow-sm shadow-red-500/25'
                    : 'bg-gray-100 text-gray-600 active:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:active:bg-gray-700',
                )}
              >
                {days} dias
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Observações (opcional)</span>
            {/* 16px: abaixo disso o iPad dá zoom no foco do campo. */}
            <textarea
              value={options.notes}
              onChange={(event) => options.onNotesChange(event.target.value)}
              maxLength={PDF_NOTES_MAX}
              rows={3}
              placeholder="Ex.: inclui produção do spot; veiculação a partir da aprovação da arte."
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-[16px] text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </label>
        </>
      )}

      {state.status === 'ready' ? (
        <div className="space-y-2">
          <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">PDF pronto: {state.file.name}</p>
          <div className="flex flex-wrap gap-2">
            {canShare && (
              <button
                type="button"
                onClick={() => void share()}
                className="flex h-12 touch-manipulation items-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white active:bg-red-700"
              >
                <Share2 className="h-4 w-4" />
                Compartilhar
              </button>
            )}
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'flex h-12 touch-manipulation items-center gap-2 rounded-xl px-5 text-sm font-semibold',
                canShare
                  ? 'border border-gray-200 text-gray-700 active:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:active:bg-gray-900'
                  : 'bg-red-600 text-white active:bg-red-700',
              )}
            >
              <ExternalLink className="h-4 w-4" />
              Abrir PDF
            </a>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void generate()}
          disabled={state.status === 'working'}
          className="flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 active:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:active:bg-gray-900"
        >
          {state.status === 'working' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {state.status === 'working' ? 'Gerando PDF…' : 'Gerar PDF'}
        </button>
      )}
    </section>
  );
}
