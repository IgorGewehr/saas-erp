'use client';

/**
 * BridgeNote — a barra `.bridge-note` do mockup: traduz por que "Resultado do
 * mês" (competência) diverge de "Como fecha o mês" (caixa), honestamente
 * derivada em `read-models/projecao-mes.ts` (ver o comentário lá sobre o gap
 * g3 — sem competência explícita, a diferença é sempre "o que já foi
 * realizado dentro do mês").
 */

import { Info } from 'lucide-react';
import { formatCurrency } from '@/lib/utils/format';
import type { BridgeCaixaCompetenciaNote } from '../read-models/projecao-mes';

export function BridgeNote({ note }: { note: BridgeCaixaCompetenciaNote }) {
  if (!note.show) return null;
  const competenciaFmt = formatCurrency(note.competenciaValue);
  const caixaFmt = formatCurrency(note.caixaValue);
  const diffFmt = formatCurrency(Math.abs(note.diffValue));
  const comparativo = note.diffValue >= 0 ? 'maior' : 'menor';
  const explicacao = note.diffValue >= 0
    ? `${diffFmt} já foi realizado (pago ou recebido) dentro do próprio mês`
    : `${diffFmt} ainda depende do que falta se mover no caixa além do resultado`;

  return (
    <div className="flex items-start gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 px-3.5 py-2.5 text-xs text-gray-600 dark:text-gray-400">
      <Info className="w-3.5 h-3.5 flex-none mt-0.5 text-gray-400 dark:text-gray-500" />
      <p className="leading-relaxed">
        <b className="text-gray-800 dark:text-gray-200 font-bold">{competenciaFmt}</b> de resultado (competência) é{' '}
        <b className="text-gray-800 dark:text-gray-200 font-bold">{comparativo}</b> que os{' '}
        <b className="text-gray-800 dark:text-gray-200 font-bold">{caixaFmt}</b> previstos no caixa porque {explicacao}.
      </p>
    </div>
  );
}
