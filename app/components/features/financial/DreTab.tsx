'use client';

/**
 * DreTab — M03.7: DRE (regime competência/caixa) e projeção de caixa de 30
 * dias no Financeiro clássico. Reusa os read-models PUROS do financial-v2
 * (`computeDreMensal`/`computeProjecaoCaixa`) — mesma matemática, sem
 * reimplementar — mas com UI própria em Tailwind (o SVG do V2 depende de
 * variáveis CSS `--fin-*` escopadas só ao módulo V2). Export PDF/CSV do DRE
 * reusa `financial-export.ts`, já compartilhado com o resto do clássico.
 */

import { useMemo, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import { db } from '@/lib/config/firebase';
import { formatCurrency } from '@/lib/utils/format';
import { exportDRECSV, exportDREPDF } from '@/lib/utils/financial-export';
import {
  computeDreMensal, toDREData, type DreRegime,
} from '../financial-v2/read-models/dre-mensal';
import { computeProjecaoCaixa } from '../financial-v2/read-models/projecao-caixa';
import { monthKeyOf, shiftMonthKey, shortMonthLabel, shortDayLabel } from '../financial-v2/read-models/date-utils';
import type { Transaction, BankAccount, DasRecord } from '@/lib/types';
import {
  FileText, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownRight,
  Download, FileSpreadsheet, Info, AlertTriangle, TrendingDown,
} from 'lucide-react';

interface Props {
  businessId: string;
  businessName: string;
  transactions: Transaction[];
  bankAccounts: BankAccount[];
}

function currentPeriod(): string {
  return monthKeyOf(new Date().toISOString().slice(0, 10)) as string;
}

function periodLabel(period: string): string {
  return shortMonthLabel(period) + '/' + period.slice(0, 4).slice(2);
}

export default function DreTab({ businessId, businessName, transactions, bankAccounts }: Props) {
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [regime, setRegime] = useState<DreRegime>('competencia');

  const { data: dasRecords = [] } = useTanstackQuery({
    queryKey: ['dasRecords', businessId],
    queryFn: async () => {
      const q = query(collection(db, 'dasRecords'), where('businessId', '==', businessId));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as DasRecord));
    },
    enabled: !!businessId,
    staleTime: 5 * 60 * 1000,
  });

  const overview = useMemo(
    () => computeDreMensal(transactions, dasRecords, period),
    [transactions, dasRecords, period],
  );
  const projecao = useMemo(
    () => computeProjecaoCaixa(transactions, bankAccounts),
    [transactions, bankAccounts],
  );

  const isCompetencia = regime === 'competencia';
  const active = isCompetencia ? overview.competencia : overview.caixa;
  const regimeLabel = isCompetencia ? 'competência' : 'caixa';

  const deltaValue = isCompetencia
    ? overview.competencia.resultado - overview.competenciaAnterior.resultado
    : -overview.bridgeDiff;
  const deltaPct = isCompetencia && overview.competenciaAnterior.resultado !== 0
    ? (deltaValue / Math.abs(overview.competenciaAnterior.resultado)) * 100
    : null;
  const deltaUp = deltaValue >= 0;

  const bridgeAbs = formatCurrency(Math.abs(overview.bridgeDiff));
  const bridgeText = isCompetencia
    ? `${formatCurrency(overview.competencia.resultado)} de resultado (competência) — mas o caixa só moveu ${formatCurrency(overview.caixa.resultado)} este mês. ${bridgeAbs} ainda não virou dinheiro.`
    : `No regime de competência (o que seu contador normalmente pede), o resultado seria ${formatCurrency(overview.competencia.resultado)} — ${bridgeAbs} ${overview.bridgeDiff >= 0 ? 'ainda não entraram' : 'já saíram'} do caixa.`;

  const { points, todayIndex, crossZeroIndex, crossZeroDate, crossZeroBalance } = projecao;
  const visiblePoints = points.slice(todayIndex, todayIndex + 15); // hoje + 14 dias à frente
  const maxAbs = Math.max(1, ...visiblePoints.map((p) => Math.abs(p.balance)));

  return (
    <div className="space-y-6">
      {/* ===== DRE ===== */}
      <div className="bg-white dark:bg-white/[0.03] border border-gray-100 dark:border-gray-800 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-red-600 dark:text-red-400" />
            <h3 className="font-display font-bold text-gray-900 dark:text-gray-100 text-sm">DRE do mês</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPeriod((p) => shiftMonthKey(p, -1))}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 min-w-[64px] text-center">
              {periodLabel(period)}
            </span>
            <button onClick={() => setPeriod((p) => shiftMonthKey(p, 1))}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden ml-2">
              {(['competencia', 'caixa'] as DreRegime[]).map((r) => (
                <button key={r} onClick={() => setRegime(r)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    regime === r ? 'bg-red-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}>
                  {r === 'competencia' ? 'Competência' : 'Caixa'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-0">
          <DreRow label="Receita bruta" value={active.receitaBruta} />
          <DreRow label={isCompetencia ? '(–) Impostos' : '(–) Impostos pagos'} value={-active.impostos} />
          <DreRow label={isCompetencia ? '(–) Despesas e custos' : '(–) Pago no caixa'} value={-active.despesas} />
          <div className="flex items-center justify-between gap-2 pt-3 mt-1 border-t border-gray-200 dark:border-gray-800">
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {isCompetencia ? 'Resultado do mês' : 'Resultado no caixa'}
            </span>
            <span className="font-mono text-base font-bold text-gray-900 dark:text-gray-100">
              {formatCurrency(active.resultado)}
            </span>
          </div>
          {isCompetencia && deltaPct !== null && (
            <div className={`inline-flex items-center gap-1 text-xs font-semibold mt-2 ${deltaUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {deltaUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
              {Math.abs(deltaPct).toFixed(0)}% vs mês anterior ({formatCurrency(Math.abs(deltaValue))})
            </div>
          )}
          <div className="flex items-start gap-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5 mt-3 text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
            <Info className="w-3.5 h-3.5 flex-none mt-0.5 text-red-500" />
            <span>{bridgeText}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => exportDREPDF(toDREData(active), `${periodLabel(period)} (${regimeLabel})`, businessName)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
          <button
            onClick={() => exportDRECSV(toDREData(active), `${periodLabel(period)} (${regimeLabel})`, businessName)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      {/* ===== Projeção de caixa ===== */}
      <div className="bg-white dark:bg-white/[0.03] border border-gray-100 dark:border-gray-800 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
          <h3 className="font-display font-bold text-gray-900 dark:text-gray-100 text-sm">O caixa nos próximos 14 dias</h3>
        </div>
        <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-4">
          Saldo bancário atual + pendentes/atrasados por vencimento + recorrências projetadas.
        </p>

        {crossZeroIndex !== null && crossZeroDate && crossZeroBalance !== null && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 px-3 py-2.5 mb-4 text-[12px] text-red-700 dark:text-red-400">
            <AlertTriangle className="w-3.5 h-3.5 flex-none mt-0.5" />
            <span>
              Projeção fica negativa em <b>{shortDayLabel(crossZeroDate)}</b> ({formatCurrency(crossZeroBalance)}), se nada mudar.
            </span>
          </div>
        )}

        <div className="flex items-end gap-1 h-32">
          {visiblePoints.map((p) => {
            const heightPct = Math.max(4, (Math.abs(p.balance) / maxAbs) * 100);
            const negative = p.balance < 0;
            return (
              <div key={p.date} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <div
                  className={`w-full rounded-t-sm transition-colors ${
                    negative ? 'bg-red-400 dark:bg-red-500/70' : p.isToday ? 'bg-red-600' : 'bg-emerald-400 dark:bg-emerald-500/70'
                  }`}
                  style={{ height: `${heightPct}%` }}
                  title={`${p.dayLabel}: ${formatCurrency(p.balance)}`}
                />
                <span className={`text-[8px] mt-1 ${p.isToday ? 'font-bold text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                  {p.isToday ? 'hoje' : p.dayLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DreRow({ label, value }: { label: string; value: number }) {
  const negative = value < 0;
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-[13px] border-b border-dashed border-gray-200 dark:border-gray-800">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`font-mono font-semibold ${negative ? 'text-gray-500 dark:text-gray-400 font-medium' : 'text-gray-900 dark:text-gray-100'}`}>
        {formatCurrency(Math.abs(value))}
      </span>
    </div>
  );
}
