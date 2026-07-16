'use client';

/**
 * FluxoCaixaTab — visibilidade condicional (plano §1.1): só entra na lista de
 * abas do shell se existe BankAccount `accountType === 'caixa'`.
 *
 * FOCO (não confundir com a projeção de 30 dias da Visão Geral): dinheiro em
 * espécie na gaveta — abertura/fechamento/troco/sangria, sobra × falta. Fecha
 * o gap g5 do plano de transformação com a entidade `CashSession` (contrato +
 * FSM em `lib/contracts/{domain,fsm}/cashSession.ts`).
 *
 *  · KPIs: saldo em caixa (hero+sparkline 6m), entrou/saiu em espécie no mês,
 *    sobra/falta no último fechamento.
 *  · Drill esquerdo (`SessoesCaixaCard`): sobra×falta por fechamento ⇄ detalhe
 *    da sessão (abertura, sangrias, contagem).
 *  · Drill direito (`CaixaAgoraCard`): status ao vivo de cada gaveta + ações
 *    (abrir/sangria/fechar) — os dois cards são INDEPENDENTES (`DualDrillPair`,
 *    mesmo padrão do Bancário).
 *  · Extrato em espécie do mês (tabela).
 */

import { useCallback, useMemo, useState } from 'react';
import { usePeriod } from '../state/PeriodContext';
import { useFinTransactions, useFinBankAccounts, useFinCashSessions } from '../hooks/useFinancialData';
import { useConsultorInsight } from '../hooks/useConsultorInsight';
import { StatTile, StatTileGroup } from '../components/StatTile';
import { ConsultorLine } from '../components/ConsultorLine';
import { useDrillState } from '../components/DrillPair';
import { DualDrillPair } from '../components/DualDrillPair';
import { computeFluxoCaixaOverview } from '../read-models/fluxo-caixa-especie';
import type { CashSessionRow } from '../read-models/fluxo-caixa-especie';
import { pickFluxoCaixaInsight } from '../read-models/consultor-rules';
import { SessoesCaixaCard } from './fluxo-caixa/SessoesCaixaCard';
import { CaixaAgoraCard } from './fluxo-caixa/CaixaAgoraCard';
import { AbrirCaixaDialog } from './fluxo-caixa/AbrirCaixaDialog';
import { SangriaDialog } from './fluxo-caixa/SangriaDialog';
import { FecharCaixaDialog } from './fluxo-caixa/FecharCaixaDialog';
import { ExtratoEspecieTable } from './fluxo-caixa/ExtratoEspecieTable';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import type { BankAccount } from '@/lib/types';

const CARD_SKELETON = 'rounded-2xl border border-gray-200 dark:border-gray-800 h-[220px] animate-pulse bg-gray-50 dark:bg-gray-800/40';

export function FluxoCaixaTab({ caixaAccounts }: { caixaAccounts: BankAccount[] }) {
  const { period } = usePeriod();
  const { data: transactions = [], isLoading: loadingTx } = useFinTransactions();
  const { data: bankAccounts = [], isLoading: loadingBa } = useFinBankAccounts();
  const { data: cashSessions = [], isLoading: loadingCs } = useFinCashSessions();
  const isLoading = loadingTx || loadingBa || loadingCs;

  const sessionDrill = useDrillState<string>();
  const [abrirAccount, setAbrirAccount] = useState<BankAccount | null>(null);
  const [sangriaSession, setSangriaSession] = useState<CashSessionRow | null>(null);
  const [fecharSession, setFecharSession] = useState<CashSessionRow | null>(null);

  const overview = useMemo(
    () => computeFluxoCaixaOverview(bankAccounts, transactions, cashSessions, period),
    [bankAccounts, transactions, cashSessions, period],
  );

  const insight = useMemo(() => pickFluxoCaixaInsight(overview), [overview]);
  const consultor = useConsultorInsight(insight);

  const handleConsultorCta = useCallback(() => {
    if (insight.ruleId === 'caixa-esquecido') {
      const oldest = overview.openSessions.reduce<CashSessionRow | null>(
        (acc, s) => (!acc || s.openedAt < acc.openedAt ? s : acc),
        null,
      );
      if (oldest) setFecharSession(oldest);
      return;
    }
    if (insight.ruleId === 'falta-no-fechamento' && overview.lastClosed) {
      sessionDrill.select(overview.lastClosed.id);
    }
  }, [insight.ruleId, overview.openSessions, overview.lastClosed, sessionDrill]);

  const ultimoFechamentoDelta = useMemo(() => {
    const last = overview.lastClosed;
    if (!last || last.difference === undefined) {
      return { direction: 'neutral' as const, text: 'nenhum fechamento ainda' };
    }
    if (Math.abs(last.difference) <= 0.01) return { direction: 'up' as const, text: 'bateu certinho' };
    return last.difference > 0
      ? { direction: 'up' as const, text: `sobra em ${formatDate(last.closedAt)}` }
      : { direction: 'down' as const, text: `falta em ${formatDate(last.closedAt)}` };
  }, [overview.lastClosed]);

  if (caixaAccounts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">
        Nenhuma gaveta (conta tipo espécie) cadastrada. Cadastre uma conta com tipo &quot;caixa&quot; em Bancário pra habilitar esta aba.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className={CARD_SKELETON} />)}
        </div>
      ) : (
        <StatTileGroup>
          <StatTile
            hero
            label="Saldo em caixa"
            value={formatCurrency(overview.saldoTotal)}
            delta={{
              direction: overview.deltaMes >= 0 ? 'up' : 'down',
              text: `${formatCurrency(Math.abs(overview.deltaMes))}${overview.deltaMesPct !== null ? ` (${Math.abs(overview.deltaMesPct).toFixed(1)}%)` : ''} no mês`,
            }}
            sparkValues={overview.sparkline}
            footnote={`${overview.caixaAccounts.length} gaveta${overview.caixaAccounts.length !== 1 ? 's' : ''} · ${overview.openSessions.length} aberta${overview.openSessions.length !== 1 ? 's' : ''}`}
          />
          <StatTile
            label="Entrou em espécie"
            value={formatCurrency(overview.entrouMes)}
            delta={
              overview.entrouDeltaPct !== null
                ? { direction: overview.entrouDeltaPct >= 0 ? 'up' : 'down', text: `${Math.abs(overview.entrouDeltaPct).toFixed(1)}% vs mês anterior` }
                : undefined
            }
            footnote={`${overview.entrouCount} movimento${overview.entrouCount !== 1 ? 's' : ''}`}
          />
          <StatTile
            label="Saiu em espécie"
            value={formatCurrency(overview.saiuMes)}
            delta={
              overview.saiuDeltaPct !== null
                ? { direction: overview.saiuDeltaPct <= 0 ? 'up' : 'down', text: `${Math.abs(overview.saiuDeltaPct).toFixed(1)}% vs mês anterior` }
                : undefined
            }
            footnote={`${overview.saiuCount} movimento${overview.saiuCount !== 1 ? 's' : ''}`}
          />
          <StatTile
            label="Sobra/falta no último fechamento"
            value={overview.lastClosed?.difference !== undefined ? formatCurrency(Math.abs(overview.lastClosed.difference)) : '—'}
            delta={ultimoFechamentoDelta}
            footnote={overview.lastClosed ? overview.lastClosed.accountLabel : 'abra e feche um caixa pra começar'}
          />
        </StatTileGroup>
      )}

      <ConsultorLine data={consultor} facts={insight.facts} onCtaClick={consultor.cta ? handleConsultorCta : undefined} />

      <DualDrillPair
        leftKey={sessionDrill.selectedId ?? 'sessoes-overview'}
        left={
          <SessoesCaixaCard
            overview={overview}
            selectedSessionId={sessionDrill.selectedId}
            onSelectSession={sessionDrill.select}
            onBack={() => sessionDrill.select(null)}
          />
        }
        rightKey={`caixa-agora:${overview.openSessions.map(s => s.id).join(',')}`}
        right={
          <CaixaAgoraCard
            overview={overview}
            onAbrir={setAbrirAccount}
            onSangria={setSangriaSession}
            onFechar={setFecharSession}
          />
        }
      />

      <ExtratoEspecieTable movimentos={overview.movimentosPeriodo} showConta={overview.caixaAccounts.length > 1} />

      <AbrirCaixaDialog account={abrirAccount} onClose={() => setAbrirAccount(null)} />
      <SangriaDialog session={sangriaSession} onClose={() => setSangriaSession(null)} />
      <FecharCaixaDialog session={fecharSession} onClose={() => setFecharSession(null)} />
    </div>
  );
}
