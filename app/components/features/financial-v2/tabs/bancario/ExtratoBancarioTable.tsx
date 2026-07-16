'use client';

/**
 * ExtratoBancarioTable — a tabela `Extrato` do mockup bancario.html: data,
 * descrição, forma, conta (dot+nome), valor, conciliação. Só realizado
 * bancário do mês (mesma fonte do card esquerdo `WeeklyFlowCard`) — filtrado
 * pelo chip de conta do subhead. "Conciliação" deriva de `linkedTxIds` (se
 * algum `ReconciliationItem` aponta pra essa Transaction, ela bateu).
 */

import { useMemo } from 'react';
import { FinTable, type FinTableColumn } from '../../components/FinTable';
import { StatusChip } from '../../components/StatusChip';
import type { FluxoBancarioMovimento } from '../../read-models/fluxo-semanal-bancario';
import type { BankAccount } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils/format';

const ACCOUNT_DOT_COLORS = ['bg-gray-700 dark:bg-gray-300', 'bg-gray-500', 'bg-gray-400', 'bg-gray-300 dark:bg-gray-600'];

interface ExtratoBancarioTableProps {
  movimentos: FluxoBancarioMovimento[];
  contas: BankAccount[];
  contaFiltro: string;
  linkedTxIds: ReadonlySet<string>;
}

export function ExtratoBancarioTable({ movimentos, contas, contaFiltro, linkedTxIds }: ExtratoBancarioTableProps) {
  const contaColorById = useMemo(() => {
    const map = new Map<string, string>();
    contas.forEach((c, i) => map.set(c.id, ACCOUNT_DOT_COLORS[i % ACCOUNT_DOT_COLORS.length]));
    return map;
  }, [contas]);

  const filtered = useMemo(
    () => (contaFiltro === 'todas' ? movimentos : movimentos.filter(m => m.contaId === contaFiltro)),
    [movimentos, contaFiltro],
  );

  const columns: FinTableColumn<FluxoBancarioMovimento>[] = [
    { key: 'date', header: 'Data', render: m => <span className="fin-num">{formatDate(m.date)}</span> },
    { key: 'desc', header: 'Descrição', render: m => m.desc },
    { key: 'forma', header: 'Forma', render: m => m.forma },
    {
      key: 'conta',
      header: 'Conta',
      render: m => (
        <span className="inline-flex items-center gap-2 font-semibold">
          <span className={`w-2 h-2 rounded-[3px] flex-none ${contaColorById.get(m.contaId ?? '') ?? 'bg-gray-300 dark:bg-gray-700'}`} />
          {m.contaLabel ?? '—'}
        </span>
      ),
    },
    {
      key: 'valor',
      header: 'Valor',
      align: 'right',
      render: m => (
        <span className={`fin-num font-bold ${m.valorSigned < 0 ? 'text-[hsl(var(--fin-crit))]' : 'text-[hsl(var(--fin-pos))]'}`}>
          {m.valorSigned < 0 ? '−' : '+'}{formatCurrency(Math.abs(m.valorSigned))}
        </span>
      ),
    },
    {
      key: 'conciliacao',
      header: 'Conciliação',
      render: m =>
        linkedTxIds.has(m.id) ? (
          <StatusChip label="Conciliado" variant="pos" />
        ) : (
          <StatusChip label="Sem lançamento" variant="warn" />
        ),
    },
  ];

  return (
    <FinTable
      columns={columns}
      rows={filtered}
      rowKey={m => m.id}
      title="Extrato"
      hint={`${movimentos.length} movimento${movimentos.length !== 1 ? 's' : ''} no período`}
      emptyMessage="Nenhum movimento bancário realizado neste mês ainda."
    />
  );
}
