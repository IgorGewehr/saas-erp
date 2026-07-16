'use client';

/**
 * VisaoGeralTab — Fase 2 do plano: os 5 blocos do santo-graal, dados reais do
 * tenant, zero tabela/CRUD (só leitura + navegação pras abas donas do número):
 *
 *  ① HeroDecomposition — "Você pode tirar até" (banco+gaveta − compromissos
 *     15d/imposto − colchão), decomposição clicável.
 *  ② CashTimeline — o caixa nos próximos 30 dias (realizado sólido + previsto
 *     tracejado + marcador do 1º dia negativo). Único gráfico da tela.
 *  ③ ProfitCard — lucro do mês (competência), margem traduzida + frase-ponte
 *     caixa×competência.
 *  ④ NextDueStrip — próximos 7 dias, cartões clicáveis.
 *  ⑤ ConsultorLine — Super Consultor, 1 frase determinística + IA opcional.
 */

import { useMemo } from 'react';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { usePeriod } from '../state/PeriodContext';
import { useFinTransactions, useFinBankAccounts, useFinDasRecords } from '../hooks/useFinancialData';
import { useConsultorInsight } from '../hooks/useConsultorInsight';
import { HeroDecomposition, type DecompositionRow } from '../components/HeroDecomposition';
import { ProfitCard } from '../components/ProfitCard';
import { CashTimeline } from '../components/charts/CashTimeline';
import { NextDueStrip } from '../components/NextDueStrip';
import { ConsultorLine } from '../components/ConsultorLine';
import { computeDisponivelRetirada } from '../read-models/disponivel-retirada';
import { computeProjecaoCaixa } from '../read-models/projecao-caixa';
import { computeResultadoDoMes } from '../read-models/resultado-do-mes';
import { computeVencimentosProximos } from '../read-models/vencimentos-proximos';
import { pickVisaoGeralInsight } from '../read-models/consultor-rules';

const CARD_SKELETON = 'rounded-2xl border border-gray-200 dark:border-gray-800 h-[220px] animate-pulse bg-gray-50 dark:bg-gray-800/40';

interface VisaoGeralTabProps {
  onNavigateToTab: (tab: string) => void;
}

export function VisaoGeralTab({ onNavigateToTab }: VisaoGeralTabProps) {
  const { business } = useAuth();
  const { period } = usePeriod();
  const { data: transactions = [], isLoading: loadingTx } = useFinTransactions();
  const { data: bankAccounts = [], isLoading: loadingBa } = useFinBankAccounts();
  const { data: dasRecords = [] } = useFinDasRecords();

  const isLoading = loadingTx || loadingBa;
  const cushionAmount = business?.financial?.cushionAmount ?? 0;

  const disponivel = useMemo(
    () => computeDisponivelRetirada(transactions, bankAccounts, dasRecords, cushionAmount),
    [transactions, bankAccounts, dasRecords, cushionAmount],
  );
  const projecao = useMemo(() => computeProjecaoCaixa(transactions, bankAccounts), [transactions, bankAccounts]);
  const resultado = useMemo(() => computeResultadoDoMes(transactions, period), [transactions, period]);
  const vencimentos = useMemo(() => computeVencimentosProximos(transactions), [transactions]);

  const insight = useMemo(() => pickVisaoGeralInsight({ transactions, projecao }), [transactions, projecao]);
  const consultor = useConsultorInsight(insight);

  const heroRows: DecompositionRow[] = [
    {
      key: 'saldo',
      label: 'No banco e na gaveta hoje',
      value: disponivel.saldoBancario,
      navLabel: 'Bancário →',
      onClick: () => onNavigateToTab('bancario'),
    },
    {
      key: 'compromissos',
      label: 'Já tem dono',
      sublabel: '(15 dias + imposto)',
      value: -disponivel.compromissos15d,
      navLabel: 'E&S →',
      onClick: () => onNavigateToTab('entradas-saidas'),
    },
  ];

  return (
    <div className="space-y-4">
      <section className="grid gap-3.5 lg:grid-cols-[1.7fr_1fr] items-stretch">
        {isLoading ? <div className={CARD_SKELETON} /> : <HeroDecomposition total={disponivel.livre} rows={heroRows} />}
        {isLoading ? (
          <div className={CARD_SKELETON} />
        ) : (
          <ProfitCard overview={resultado} onSeeDetail={() => onNavigateToTab('entradas-saidas')} />
        )}
      </section>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <h2 className="flex items-center justify-between gap-2 flex-wrap px-4.5 pt-3.5 pb-1 text-[13px] font-bold text-gray-900 dark:text-gray-100">
          O caixa nos próximos 30 dias
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500">clique num dia → o que entra/sai nele</span>
        </h2>
        {isLoading ? <div className="h-[190px] m-4 rounded-xl animate-pulse bg-gray-50 dark:bg-gray-800/40" /> : <CashTimeline overview={projecao} />}
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <h2 className="flex items-center justify-between gap-2 flex-wrap px-4.5 pt-3.5 text-[13px] font-bold text-gray-900 dark:text-gray-100">
          Próximos 7 dias
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500">clique num vencimento → a parcela em Entradas &amp; Saídas</span>
        </h2>
        {isLoading ? (
          <div className="h-[92px] m-4 rounded-xl animate-pulse bg-gray-50 dark:bg-gray-800/40" />
        ) : (
          <NextDueStrip items={vencimentos} onSelect={() => onNavigateToTab('entradas-saidas')} />
        )}
      </div>

      <ConsultorLine
        data={consultor}
        facts={insight.facts}
        onCtaClick={consultor.cta ? () => onNavigateToTab(consultor.cta!.targetTab) : undefined}
      />
    </div>
  );
}
