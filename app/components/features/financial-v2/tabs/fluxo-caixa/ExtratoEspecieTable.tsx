'use client';

/**
 * ExtratoEspecieTable — movimentos em dinheiro do período (a mesma fonte do
 * KPI "entrou/saiu em espécie"): data, descrição, forma, conta (quando há
 * mais de uma gaveta) e valor. Sem coluna de conciliação — o "bateu" do
 * dinheiro em espécie é o fechamento de sessão (sobra/falta), não os 3 baldes
 * bancários.
 */

import { FinTable, type FinTableColumn } from '../../components/FinTable';
import type { CashMovimento } from '../../read-models/fluxo-caixa-especie';
import { formatCurrency, formatDate } from '@/lib/utils/format';

interface ExtratoEspecieTableProps {
  movimentos: CashMovimento[];
  showConta: boolean;
}

export function ExtratoEspecieTable({ movimentos, showConta }: ExtratoEspecieTableProps) {
  const columns: FinTableColumn<CashMovimento>[] = [
    { key: 'date', header: 'Data', render: m => <span className="fin-num">{formatDate(m.date)}</span> },
    { key: 'desc', header: 'Descrição', render: m => m.desc },
    { key: 'forma', header: 'Forma', render: m => m.forma },
    ...(showConta
      ? [{ key: 'conta', header: 'Gaveta', render: (m: CashMovimento) => m.accountLabel } as FinTableColumn<CashMovimento>]
      : []),
    {
      key: 'valor',
      header: 'Valor',
      align: 'right' as const,
      render: m => (
        <span className={`fin-num font-bold ${m.valorSigned < 0 ? 'text-[hsl(var(--fin-crit))]' : 'text-[hsl(var(--fin-pos))]'}`}>
          {m.valorSigned < 0 ? '−' : '+'}{formatCurrency(Math.abs(m.valorSigned))}
        </span>
      ),
    },
  ];

  return (
    <FinTable
      columns={columns}
      rows={movimentos}
      rowKey={m => m.id}
      title="Extrato em espécie"
      hint={`${movimentos.length} movimento${movimentos.length !== 1 ? 's' : ''} no período`}
      emptyMessage="Nenhum movimento em dinheiro neste mês ainda."
    />
  );
}
