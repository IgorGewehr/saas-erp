'use client';

/**
 * FechamentoCard — "Fechamento mensal" (mockup `relatorios.html`): o card-
 * estrela desta tela, o pacote completo pro contador. O projeto não tem
 * `jszip` instalado (plano não pediu a dependência nova pra este corte) —
 * "gerar fechamento" dispara os 3 documentos REAIS em sequência (DRE +
 * extrato geral + contas em aberto) em vez de fingir um `.zip` que não existe.
 */

import { useCallback, useState } from 'react';
import { CheckCircle2, Package, Send } from 'lucide-react';
import { toast } from 'react-toastify';
import type { BankAccount, Transaction } from '@/lib/types';
import { DocCard } from './DocCard';
import { exportDREPDF, exportTransactionsCSV, exportTransactionsPDF } from '@/lib/utils/financial-export';
import { toDREData, type DreRegimeResult } from '../../read-models/dre-mensal';
import { isOpenCommitment } from '../../read-models/recurrence-projection';
import { formatCurrency } from '@/lib/utils/format';

interface FechamentoCardProps {
  regimeLabel: string;
  resultado: DreRegimeResult;
  periodLabel: string;
  businessName: string;
  bankAccounts: BankAccount[];
  transactions: Transaction[];
  cashSessionsClosedCount: number;
  hasCaixa: boolean;
  conciliacaoPendentes: number;
}

type PacoteState = 'idle' | 'gerando' | 'pronto';

export function FechamentoCard({
  regimeLabel, resultado, periodLabel, businessName, bankAccounts, transactions,
  cashSessionsClosedCount, hasCaixa, conciliacaoPendentes,
}: FechamentoCardProps) {
  const [state, setState] = useState<PacoteState>('idle');
  const contasCount = bankAccounts.filter(a => a.isActive).length;
  const safeName = periodLabel.replace(/\s+/g, '_');

  const gerar = useCallback(async () => {
    if (state !== 'idle') return;
    setState('gerando');
    try {
      const realizados = transactions.filter(t => t.status === 'pago');
      const abertos = transactions.filter(t => isOpenCommitment(t));
      await exportDREPDF(toDREData(resultado), `${periodLabel} (${regimeLabel})`, businessName, `dre_${safeName}.pdf`);
      await new Promise(resolve => setTimeout(resolve, 250));
      await exportTransactionsPDF(realizados, businessName, periodLabel, `extrato_geral_${safeName}.pdf`);
      await new Promise(resolve => setTimeout(resolve, 250));
      exportTransactionsCSV(abertos, `contas_em_aberto_${safeName}.csv`);
      setState('pronto');
      toast.success('Fechamento gerado — 3 documentos, downloads iniciados');
    } catch {
      toast.error('Não foi possível gerar o fechamento completo.');
      setState('idle');
    }
  }, [state, transactions, resultado, periodLabel, regimeLabel, businessName, safeName]);

  const handleEnviar = useCallback(() => {
    toast.info('Envio direto pro contador chega em breve — os arquivos já foram baixados, envie por fora.');
  }, []);

  return (
    <DocCard icon={Package} title="Fechamento mensal" subtitle="O pacote completo pro contador" star className="lg:h-full">
      <div className="flex flex-col gap-1.5 mb-3">
        <CheckItem label="DRE do mês" />
        <CheckItem label="Extratos por conta" hint={`${contasCount} conta${contasCount !== 1 ? 's' : ''}`} />
        <CheckItem label="Contas em aberto" hint="a pagar e a receber" />
        {hasCaixa && (
          <CheckItem label="Fechamentos de caixa" hint={`${cashSessionsClosedCount} sessão${cashSessionsClosedCount !== 1 ? 'ões' : ''}`} />
        )}
        <CheckItem label="Pendências de conciliação" hint={`${conciliacaoPendentes} ${conciliacaoPendentes !== 1 ? 'itens' : 'item'}`} />
      </div>
      <div className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3">
        Resultado do mês: <b className="fin-num text-gray-700 dark:text-gray-300">{formatCurrency(resultado.resultado)} ({regimeLabel})</b>
      </div>

      <button
        onClick={gerar}
        disabled={state !== 'idle'}
        className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-[10px] bg-[hsl(var(--fin-primary))] text-white text-[13.5px] font-semibold shadow-[0_4px_14px_hsl(var(--fin-primary)/0.35)] hover:brightness-[1.06] hover:-translate-y-px transition-all disabled:opacity-80 disabled:translate-y-0"
      >
        {state === 'gerando' ? 'Gerando fechamento…' : state === 'pronto' ? (<><CheckCircle2 className="w-4 h-4" /> Pacote pronto</>) : 'Gerar fechamento'}
      </button>

      {state === 'pronto' && (
        <button
          onClick={handleEnviar}
          className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-[10px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <Send className="w-3.5 h-3.5" /> Enviar pacote
        </button>
      )}
    </DocCard>
  );
}

function CheckItem({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px] text-gray-700 dark:text-gray-300">
      <CheckCircle2 className="w-3.5 h-3.5 flex-none mt-0.5 text-[hsl(var(--fin-pos))]" />
      <span>{label}{hint && <span className="text-gray-400 dark:text-gray-500"> ({hint})</span>}</span>
    </div>
  );
}
