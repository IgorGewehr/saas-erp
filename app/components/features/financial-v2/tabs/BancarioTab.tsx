'use client';

/**
 * BancarioTab — Fase 4 do plano: só o que é REALIZADO e passou pelo banco
 * (PIX/cartão/TED/boleto — nunca previsto, nunca espécie). Port fiel de
 * `scratchpad/mockups/bancario.html` com dados reais do tenant:
 *
 *  · KPIs: saldo por conta (hero+sparkline 6m), entrou/saiu no mês, a conciliar.
 *  · Drill esquerdo (`WeeklyFlowCard`): entrou×saiu por semana ⇄ dias+movimentos.
 *  · Drill direito (`ConciliacaoBaldesCard`): os 3 baldes da conciliação, com
 *    ação de 1 clique (confirma/ignora/lança) — os dois drills são
 *    INDEPENDENTES (`DualDrillPair`, diferente do `DrillPair` compartilhado
 *    usado em Assinaturas).
 *  · Extrato: tabela filtrável por conta (chip do subhead).
 *  · "Importar extrato" reaproveita a `ConciliacaoTab` clássica (motor de
 *    OFX/CSV + regras) — ver `ConciliacaoImportModal`.
 */

import { useCallback, useMemo, useState } from 'react';
import { Building2, Upload } from 'lucide-react';
import { toast } from 'react-toastify';
import { usePeriod } from '../state/PeriodContext';
import { useFinTransactions, useFinBankAccounts, useFinReconciliationItems } from '../hooks/useFinancialData';
import { useConsultorInsight } from '../hooks/useConsultorInsight';
import { StatTile, StatTileGroup } from '../components/StatTile';
import { ConsultorLine } from '../components/ConsultorLine';
import { useDrillState } from '../components/DrillPair';
import { DualDrillPair } from '../components/DualDrillPair';
import { computeSaldoPorConta } from '../read-models/saldo-por-conta';
import { computeFluxoBancario } from '../read-models/fluxo-semanal-bancario';
import { computeConciliacao3Baldes } from '../read-models/conciliacao-3-baldes';
import { pickBancarioInsight } from '../read-models/consultor-rules';
import { WeeklyFlowCard } from './bancario/WeeklyFlowCard';
import { ConciliacaoBaldesCard, type BaldeId } from './bancario/ConciliacaoBaldesCard';
import { ExtratoBancarioTable } from './bancario/ExtratoBancarioTable';
import { ConciliacaoImportModal } from './bancario/ConciliacaoImportModal';
import { formatCurrency } from '@/lib/utils/format';

const CARD_SKELETON = 'rounded-2xl border border-gray-200 dark:border-gray-800 h-[220px] animate-pulse bg-gray-50 dark:bg-gray-800/40';

const chipClass = (active: boolean) =>
  'px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors whitespace-nowrap ' +
  (active ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400');

export function BancarioTab() {
  const { period } = usePeriod();
  const { data: transactions = [], isLoading: loadingTx } = useFinTransactions();
  const { data: bankAccounts = [], isLoading: loadingBa } = useFinBankAccounts();
  const { data: reconciliationItems = [], isLoading: loadingRi } = useFinReconciliationItems();
  const isLoading = loadingTx || loadingBa || loadingRi;

  const [contaFiltro, setContaFiltro] = useState<string>('todas');
  const [importOpen, setImportOpen] = useState(false);
  const weekDrill = useDrillState<string>();
  const baldeDrill = useDrillState<BaldeId>();

  const contas = useMemo(() => bankAccounts.filter(a => a.isActive && a.accountType !== 'caixa'), [bankAccounts]);
  const saldo = useMemo(() => computeSaldoPorConta(bankAccounts, transactions, period), [bankAccounts, transactions, period]);
  const fluxo = useMemo(() => computeFluxoBancario(transactions, bankAccounts, period), [transactions, bankAccounts, period]);
  const baldes = useMemo(
    () => computeConciliacao3Baldes(reconciliationItems, transactions, bankAccounts, period),
    [reconciliationItems, transactions, bankAccounts, period],
  );
  const linkedTxIds = useMemo(
    () => new Set(reconciliationItems.map(i => i.transactionId).filter((id): id is string => !!id)),
    [reconciliationItems],
  );

  const insight = useMemo(() => pickBancarioInsight(bankAccounts, baldes), [bankAccounts, baldes]);
  const consultor = useConsultorInsight(insight);

  const handleConsultorCta = useCallback(() => {
    if (insight.ruleId !== 'conciliacao-pendente') return;
    baldeDrill.select(baldes.sobrouBanco.length > 0 ? 'banco' : 'sistema');
  }, [insight.ruleId, baldes.sobrouBanco.length, baldeDrill]);

  const handleConnectBank = useCallback(() => {
    toast.info('Conexão automática com banco chega em breve — por enquanto, importe o extrato.');
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex flex-wrap bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[11px] p-0.5 gap-0.5">
          <button onClick={() => setContaFiltro('todas')} className={chipClass(contaFiltro === 'todas')}>Todas</button>
          {contas.map(c => (
            <button key={c.id} onClick={() => setContaFiltro(c.id)} className={chipClass(contaFiltro === c.id)}>{c.name}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" /> Importar extrato
          </button>
          <button
            onClick={handleConnectBank}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <Building2 className="w-3.5 h-3.5" /> Conectar banco
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className={CARD_SKELETON} />)}
        </div>
      ) : (
        <StatTileGroup>
          <StatTile
            hero
            label="Saldo em bancos"
            value={formatCurrency(saldo.total)}
            delta={{
              direction: saldo.deltaMes >= 0 ? 'up' : 'down',
              text: `${formatCurrency(Math.abs(saldo.deltaMes))}${saldo.deltaMesPct !== null ? ` (${Math.abs(saldo.deltaMesPct).toFixed(1)}%)` : ''} no mês`,
            }}
            sparkValues={saldo.sparkline}
            footnote={saldo.rows.length > 0 ? saldo.rows.map(r => `${r.name} ${formatCurrency(r.balance)}`).join(' · ') : 'nenhuma conta cadastrada'}
          />
          <StatTile
            label="Entrou no mês"
            value={formatCurrency(saldo.entrouMes)}
            delta={
              saldo.entrouDeltaPct !== null
                ? { direction: saldo.entrouDeltaPct >= 0 ? 'up' : 'down', text: `${Math.abs(saldo.entrouDeltaPct).toFixed(1)}% vs mês anterior` }
                : undefined
            }
            footnote={`${saldo.entrouCount} movimento${saldo.entrouCount !== 1 ? 's' : ''}`}
          />
          <StatTile
            label="Saiu no mês"
            value={formatCurrency(saldo.saiuMes)}
            delta={
              saldo.saiuDeltaPct !== null
                ? { direction: saldo.saiuDeltaPct <= 0 ? 'up' : 'down', text: `${Math.abs(saldo.saiuDeltaPct).toFixed(1)}% vs mês anterior` }
                : undefined
            }
            footnote={`${saldo.saiuCount} movimento${saldo.saiuCount !== 1 ? 's' : ''}`}
          />
          <StatTile
            label="A conciliar"
            value={baldes.itensPendentes === 0 ? '0' : String(baldes.itensPendentes)}
            delta={{
              direction: baldes.itensPendentes === 0 ? 'up' : 'down',
              text: baldes.itensPendentes === 0 ? 'tudo conciliado' : `${formatCurrency(baldes.valorEmDuvida)} em dúvida`,
            }}
            footnote={baldes.itensPendentes === 0 ? 'nenhuma pendência' : `${baldes.itensPendentes} item${baldes.itensPendentes !== 1 ? 's' : ''} aguardando revisão`}
          />
        </StatTileGroup>
      )}

      <ConsultorLine data={consultor} facts={insight.facts} onCtaClick={consultor.cta ? handleConsultorCta : undefined} />

      <DualDrillPair
        leftKey={weekDrill.selectedId ?? 'week-overview'}
        left={
          <WeeklyFlowCard
            overview={fluxo}
            selectedWeekId={weekDrill.selectedId}
            onSelectWeek={weekDrill.select}
            onBack={() => weekDrill.select(null)}
          />
        }
        rightKey={baldeDrill.selectedId ?? 'balde-overview'}
        right={
          <ConciliacaoBaldesCard
            overview={baldes}
            contas={contas}
            selectedId={baldeDrill.selectedId}
            onSelect={baldeDrill.select}
            onBack={() => baldeDrill.select(null)}
          />
        }
      />

      <ExtratoBancarioTable movimentos={fluxo.movimentos} contas={contas} contaFiltro={contaFiltro} linkedTxIds={linkedTxIds} />

      <ConciliacaoImportModal open={importOpen} onClose={() => setImportOpen(false)} transactions={transactions} bankAccounts={bankAccounts} />
    </div>
  );
}
