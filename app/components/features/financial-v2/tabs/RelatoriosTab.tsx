'use client';

/**
 * RelatoriosTab — Fase 5 do plano: export pra contador/sócios (DRE, extratos,
 * fechamento, contas em aberto, MRR) + histórico de auditoria. ÚNICA aba sem
 * Super Consultor (plano §1.2: "aqui é papel, não insight") — e a ÚNICA em
 * que o REGIME (competência/caixa) é um toggle explícito e global, só desta
 * tela (as outras já fixam o regime que faz sentido pro que mostram).
 *
 * Port fiel de `scratchpad/mockups/relatorios.html`: 5 `DocCard`s (DRE, o
 * card-estrela Fechamento mensal, Extrato por conta, Contas em aberto,
 * Assinaturas/MRR condicional) + Histórico (reuso de `FinancialAuditLog`,
 * plano §1.1 — "Auditoria → Relatórios › Histórico" é a MESMA coleção, não
 * uma nova).
 */

import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { usePeriod } from '../state/PeriodContext';
import {
  useFinTransactions,
  useFinBankAccounts,
  useFinDasRecords,
  useFinReconciliationItems,
  useFinCashSessions,
  useFinClientMemberships,
  useFinMemberships,
  useFinProjects,
  useFinAuditLog,
} from '../hooks/useFinancialData';
import { computeDreMensal, type DreRegime } from '../read-models/dre-mensal';
import { computeConciliacao3Baldes } from '../read-models/conciliacao-3-baldes';
import { computeAssinaturasOverview } from '../read-models/assinaturas-overview';
import { monthKeyOf } from '../read-models/date-utils';
import { DreCard } from './relatorios/DreCard';
import { FechamentoCard } from './relatorios/FechamentoCard';
import { ExtratoContaCard } from './relatorios/ExtratoContaCard';
import { ContasAbertoCard } from './relatorios/ContasAbertoCard';
import { AssinaturasMrrCard } from './relatorios/AssinaturasMrrCard';
import { HistoricoAuditoriaTable } from './relatorios/HistoricoAuditoriaTable';

const CARD_SKELETON = 'rounded-2xl border border-gray-200 dark:border-gray-800 h-[260px] animate-pulse bg-gray-50 dark:bg-gray-800/40';

const REGIMES: { id: DreRegime; label: string }[] = [
  { id: 'competencia', label: 'Competência' },
  { id: 'caixa', label: 'Caixa' },
];

export function RelatoriosTab() {
  const { business } = useAuth();
  const { period, label: periodLabel } = usePeriod();
  const [regime, setRegime] = useState<DreRegime>('competencia');

  const { data: transactions = [], isLoading: loadingTx } = useFinTransactions();
  const { data: bankAccounts = [], isLoading: loadingBa } = useFinBankAccounts();
  const { data: dasRecords = [] } = useFinDasRecords();
  const { data: reconciliationItems = [] } = useFinReconciliationItems();
  const { data: cashSessions = [] } = useFinCashSessions();
  const { data: clientMemberships = [] } = useFinClientMemberships();
  const { data: memberships = [] } = useFinMemberships();
  const { data: projects = [] } = useFinProjects();
  const { data: auditLog = [], isLoading: loadingAudit } = useFinAuditLog();

  const isLoading = loadingTx || loadingBa;
  const businessName = business?.nomeFantasia || business?.razaoSocial || 'Minha empresa';

  const dre = useMemo(() => computeDreMensal(transactions, dasRecords, period), [transactions, dasRecords, period]);
  const baldes = useMemo(
    () => computeConciliacao3Baldes(reconciliationItems, transactions, bankAccounts, period),
    [reconciliationItems, transactions, bankAccounts, period],
  );
  const assinaturas = useMemo(() => computeAssinaturasOverview({
    clientMemberships,
    memberships,
    transactions,
    projects,
    projectsEnabled: !!business?.settings?.projectsEnabled,
    period,
  }), [clientMemberships, memberships, transactions, projects, business?.settings?.projectsEnabled, period]);

  const caixaAccounts = useMemo(() => bankAccounts.filter(a => a.isActive && a.accountType === 'caixa'), [bankAccounts]);
  const cashSessionsClosedCount = useMemo(
    () => cashSessions.filter(s => s.status === 'fechada' && monthKeyOf(s.closedAt) === period).length,
    [cashSessions, period],
  );

  const regimeLabel = regime === 'competencia' ? 'competência' : 'caixa';
  const regimeResultado = regime === 'competencia' ? dre.competencia : dre.caixa;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-gray-500 dark:text-gray-400">Regime</span>
          <div className="inline-flex bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[11px] p-0.5 gap-0.5">
            {REGIMES.map(r => (
              <button
                key={r.id}
                onClick={() => setRegime(r.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors',
                  regime === r.id ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        <Info className="w-3.5 h-3.5 flex-none mt-0.5 text-[hsl(var(--fin-primary))]" />
        <span>
          No regime de <b className="text-gray-800 dark:text-gray-200 font-semibold">competência</b>, conta quando foi vendido/gasto; no de{' '}
          <b className="text-gray-800 dark:text-gray-200 font-semibold">caixa</b>, quando o dinheiro mudou de mão. Seu contador normalmente pede competência.
        </span>
      </div>

      {isLoading ? (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className={CARD_SKELETON} />)}
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-start-1 lg:row-start-1">
            <DreCard overview={dre} regime={regime} periodLabel={periodLabel} businessName={businessName} />
          </div>
          <div className="sm:col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:row-span-2">
            <FechamentoCard
              regimeLabel={regimeLabel}
              resultado={regimeResultado}
              periodLabel={periodLabel}
              businessName={businessName}
              bankAccounts={bankAccounts}
              transactions={transactions}
              cashSessionsClosedCount={cashSessionsClosedCount}
              hasCaixa={caixaAccounts.length > 0}
              conciliacaoPendentes={baldes.itensPendentes}
            />
          </div>
          <div className="lg:col-start-3 lg:row-start-1">
            <ExtratoContaCard transactions={transactions} bankAccounts={bankAccounts} period={period} businessName={businessName} />
          </div>
          <div className="lg:col-start-1 lg:row-start-2">
            <ContasAbertoCard transactions={transactions} businessName={businessName} />
          </div>
          {assinaturas && (
            <div className="lg:col-start-3 lg:row-start-2">
              <AssinaturasMrrCard overview={assinaturas} periodLabel={periodLabel} businessName={businessName} />
            </div>
          )}
        </div>
      )}

      <HistoricoAuditoriaTable logs={auditLog} isLoading={loadingAudit} />
    </div>
  );
}
