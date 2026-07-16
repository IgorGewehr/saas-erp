'use client';

/**
 * ExtratoContaCard — "Extrato por conta" (mockup `relatorios.html`): chips de
 * conta (multi-seleção, "Todas" exclusivo) + período livre (não o
 * PeriodContext global — o contador às vezes quer um recorte diferente do
 * mês corrente) + export do REALIZADO (`status:'pago'`, por `paymentDate`)
 * daquelas contas no intervalo. Inclui contas tipo `caixa` também — ao
 * contrário de Bancário, aqui é "documento pro contador", não operação
 * bancária do dia a dia.
 */

import { useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BankAccount, Transaction } from '@/lib/types';
import { DocCard } from './DocCard';
import { DocActions } from './DocActions';
import { exportTransactionsCSV, exportTransactionsPDF } from '@/lib/utils/financial-export';
import { startOfDay, toDateStr } from '../../read-models/date-utils';

interface ExtratoContaCardProps {
  transactions: Transaction[];
  bankAccounts: BankAccount[];
  period: string;
  businessName: string;
}

function periodBounds(period: string): { first: string; last: string } {
  const [y, m] = period.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = toDateStr(new Date(y, m, 0));
  return { first, last };
}

// Ternary escolhe UMA string completa (base + estado) — nunca concatena
// base+ativo, senão `border-gray-200`/`border-[hsl(...)]` (mesma propriedade
// CSS) disputam por ordem de geração do Tailwind em vez de por intenção.
const CHIP_BASE = 'px-2.5 py-1.5 rounded-full border text-[11.5px] font-semibold transition-colors';
const CHIP_INACTIVE = 'border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700';
const CHIP_ACTIVE = 'bg-[hsl(var(--fin-primary-soft))] border-[hsl(var(--fin-primary)/0.4)] text-[hsl(var(--fin-primary))]';

export function ExtratoContaCard({ transactions, bankAccounts, period, businessName }: ExtratoContaCardProps) {
  const contas = useMemo(() => bankAccounts.filter(a => a.isActive), [bankAccounts]);
  const bounds = useMemo(() => periodBounds(period), [period]);
  const todayStr = useMemo(() => toDateStr(startOfDay(new Date())), []);
  const defaultLast = bounds.last > todayStr ? todayStr : bounds.last;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dtFrom, setDtFrom] = useState(bounds.first);
  const [dtTo, setDtTo] = useState(defaultLast);

  const todas = selected.size === 0;

  const toggleAcct = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(
    () => transactions.filter(t =>
      t.status === 'pago' &&
      !!t.paymentDate && t.paymentDate >= dtFrom && t.paymentDate <= dtTo &&
      (todas || (!!t.bankAccountId && selected.has(t.bankAccountId))),
    ),
    [transactions, dtFrom, dtTo, todas, selected],
  );

  const summary = todas
    ? 'todas as contas'
    : contas.filter(c => selected.has(c.id)).map(c => c.name).join(', ') || 'nenhuma conta selecionada';

  const rangeLabel = `${dtFrom.split('-').reverse().join('/')} a ${dtTo.split('-').reverse().join('/')}`;

  return (
    <DocCard
      icon={Landmark}
      title="Extrato por conta"
      subtitle="Período livre, por conta bancária/caixa"
      footer={
        <DocActions
          onPdf={() => exportTransactionsPDF(filtered, businessName, rangeLabel)}
          onExcel={() => exportTransactionsCSV(filtered, `extrato_${dtFrom}_a_${dtTo}.csv`)}
        />
      }
    >
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button onClick={() => setSelected(new Set())} className={cn(CHIP_BASE, todas ? CHIP_ACTIVE : CHIP_INACTIVE)}>Todas</button>
        {contas.map(c => (
          <button key={c.id} onClick={() => toggleAcct(c.id)} className={cn(CHIP_BASE, selected.has(c.id) ? CHIP_ACTIVE : CHIP_INACTIVE)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 mb-2.5">
        <input
          type="date"
          value={dtFrom}
          max={dtTo}
          onChange={e => setDtFrom(e.target.value)}
          className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-lg px-2 py-1.5 text-[12px] text-gray-700 dark:text-gray-300 w-[126px]"
        />
        <span className="text-xs text-gray-400 dark:text-gray-600">até</span>
        <input
          type="date"
          value={dtTo}
          min={dtFrom}
          onChange={e => setDtTo(e.target.value)}
          className="border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-lg px-2 py-1.5 text-[12px] text-gray-700 dark:text-gray-300 w-[126px]"
        />
      </div>
      <div className="text-[11.5px] text-gray-400 dark:text-gray-500">
        Selecionado: {summary} · {filtered.length} lançamento{filtered.length !== 1 ? 's' : ''}
      </div>
    </DocCard>
  );
}
