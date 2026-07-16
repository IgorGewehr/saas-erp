'use client';

/**
 * DocActions — a fileira `.doc-actions` do mockup (PDF · Excel · Enviar) de
 * cada `DocCard`. PDF/Excel disparam download real (o `onPdf`/`onExcel` de
 * cada card já chama as funções de `lib/utils/financial-export.ts`); "Enviar"
 * é um stub honesto — o `Business` ainda não guarda contato de contador (nem
 * há canal de notificação plugado pra doc arbitrário), então avisamos em vez
 * de fingir um envio (mesmo padrão do `handleConnectBank` em BancarioTab).
 */

import { useCallback, useState } from 'react';
import { ChevronDown, Send } from 'lucide-react';
import { toast } from 'react-toastify';

type ActionState = 'idle' | 'loading' | 'done';

interface DocActionsProps {
  onPdf: () => void | Promise<void>;
  onExcel: () => void | Promise<void>;
}

const BTN_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-gray-200 dark:border-gray-800 ' +
  'bg-white dark:bg-gray-900 text-xs font-semibold text-gray-700 dark:text-gray-300 ' +
  'hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-70 disabled:cursor-default';

function useDocAction(action: () => void | Promise<void>, doneLabel: string) {
  const [state, setState] = useState<ActionState>('idle');
  const run = useCallback(async () => {
    if (state !== 'idle') return;
    setState('loading');
    try {
      await action();
      setState('done');
      toast.success(`${doneLabel} gerado — download iniciado`);
    } catch {
      toast.error(`Não foi possível gerar ${doneLabel.toLowerCase()}.`);
      setState('idle');
      return;
    }
    setTimeout(() => setState('idle'), 1300);
  }, [action, doneLabel, state]);
  return { state, run };
}

export function DocActions({ onPdf, onExcel }: DocActionsProps) {
  const pdf = useDocAction(onPdf, 'PDF');
  const excel = useDocAction(onExcel, 'Excel');

  const handleEnviar = useCallback(() => {
    toast.info('Envio direto pro contador chega em breve — baixe o PDF/Excel e envie por fora.');
  }, []);

  return (
    <div className="flex items-center gap-2">
      <button onClick={pdf.run} disabled={pdf.state !== 'idle'} className={BTN_CLASS}>
        {pdf.state === 'loading' ? 'Gerando…' : pdf.state === 'done' ? '✓ Gerado' : 'PDF'}
      </button>
      <button onClick={excel.run} disabled={excel.state !== 'idle'} className={BTN_CLASS}>
        {excel.state === 'loading' ? 'Gerando…' : excel.state === 'done' ? '✓ Gerado' : 'Excel'}
      </button>
      <button onClick={handleEnviar} className={BTN_CLASS + ' flex-1 justify-center'}>
        <Send className="w-3.5 h-3.5" /> Enviar <ChevronDown className="w-3 h-3" />
      </button>
    </div>
  );
}
