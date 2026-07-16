'use client';

/**
 * SessoesCaixaCard — card esquerdo de Fluxo de Caixa: "sobra × falta por
 * fechamento" (divergente, mesma gramática de "Novos × Churn" da Assinaturas
 * e "entrou×saiu" do Bancário) ⇄ detalhe da sessão selecionada (abertura,
 * sangrias, fechamento). Drill PRÓPRIO (independente do card "Caixa agora" à
 * direita — ver `DualDrillPair`).
 */

import { DrillCardHeader } from '../../components/DrillPair';
import { DivergingChart } from '../../components/charts/DivergingChart';
import { StatusChip } from '../../components/StatusChip';
import type { FluxoCaixaOverview, CashSessionRow } from '../../read-models/fluxo-caixa-especie';
import { shortDayLabel } from '../../read-models/date-utils';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils/format';

const CHART_SESSIONS_CAP = 8;

interface SessoesCaixaCardProps {
  overview: FluxoCaixaOverview;
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onBack: () => void;
}

export function SessoesCaixaCard({ overview, selectedSessionId, onSelectSession, onBack }: SessoesCaixaCardProps) {
  const selected = overview.sessionHistory.find(s => s.id === selectedSessionId) ?? null;
  if (selected) return <SessionDetail session={selected} onBack={onBack} />;

  // sessionHistory vem mais-recente-primeiro; mostra as últimas N em ordem
  // cronológica (esquerda→direita), igual ao eixo de meses do mockup.
  const recentClosed = overview.sessionHistory.slice(0, CHART_SESSIONS_CAP).slice().reverse();

  return (
    <>
      <DrillCardHeader title="Sobra × falta por fechamento" hint="clique num fechamento p/ ver o detalhe →" />
      {recentClosed.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
          Nenhum fechamento de caixa registrado ainda. Abra o caixa e feche no fim do expediente pra começar a acompanhar.
        </div>
      ) : (
        <div className="px-3.5 pb-3">
          <DivergingChart
            data={recentClosed.map(s => ({
              label: shortDayLabel(s.closedAt ?? s.openedAt),
              positive: s.difference !== undefined && s.difference > 0 ? s.difference : 0,
              negative: s.difference !== undefined && s.difference < 0 ? Math.abs(s.difference) : 0,
            }))}
            formatValue={formatCurrency}
            positiveLabel="Sobra"
            negativeLabel="Falta"
            onSelect={(index) => onSelectSession(recentClosed[index].id)}
          />
        </div>
      )}
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 px-2.5 py-2">
      <div className="text-[10.5px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</div>
      <div className="fin-num text-[13px] font-semibold text-gray-800 dark:text-gray-200 mt-0.5">{value}</div>
    </div>
  );
}

function diferencaChip(session: CashSessionRow) {
  if (session.difference === undefined) return null;
  if (Math.abs(session.difference) <= 0.01) return <StatusChip label="Bateu certinho" variant="pos" />;
  return session.difference > 0
    ? <StatusChip label={`Sobra ${formatCurrency(session.difference)}`} variant="pos" />
    : <StatusChip label={`Falta ${formatCurrency(Math.abs(session.difference))}`} variant="crit" />;
}

function SessionDetail({ session, onBack }: { session: CashSessionRow; onBack: () => void }) {
  return (
    <>
      <DrillCardHeader title={session.accountLabel} hint={formatDate(session.closedAt ?? session.openedAt)} onBack={onBack} />
      <div className="px-4.5 pb-4 flex flex-col gap-3">
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="text-gray-500 dark:text-gray-400">Aberto</span>
          <span className="fin-num text-gray-800 dark:text-gray-200 text-right">{formatDateTime(session.openedAt)} · {session.openedByName}</span>
        </div>
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="text-gray-500 dark:text-gray-400">Fechado</span>
          <span className="fin-num text-gray-800 dark:text-gray-200 text-right">
            {session.closedAt ? `${formatDateTime(session.closedAt)} · ${session.closedByName ?? '—'}` : '—'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Troco inicial" value={formatCurrency(session.openingAmount)} />
          <MiniStat label="Entrou" value={formatCurrency(session.entrouSession)} />
          <MiniStat label="Saiu" value={formatCurrency(session.saiuSession)} />
          <MiniStat label="Sangrias" value={formatCurrency(session.sangriaTotal)} />
        </div>

        <div className="flex items-center justify-between rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-xs text-gray-500 dark:text-gray-400">Esperado × contado</div>
            <div className="fin-num text-[13px] font-semibold text-gray-800 dark:text-gray-200 mt-0.5">
              {formatCurrency(session.expectedAmount ?? 0)} × {formatCurrency(session.countedAmount ?? 0)}
            </div>
          </div>
          {diferencaChip(session)}
        </div>

        {session.withdrawals.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Sangrias desta sessão</div>
            <div className="flex flex-col gap-1.5">
              {session.withdrawals.map(w => (
                <div key={w.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="text-gray-600 dark:text-gray-400 truncate min-w-0">{w.reason}</span>
                  <span className="fin-num flex-none font-semibold text-[hsl(var(--fin-crit))]">−{formatCurrency(w.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
