'use client';

/**
 * HistoricoAuditoriaTable — "Histórico" de Relatórios (plano §1.1: a aba
 * Auditoria antiga vira esta seção, MESMOS dados — `FinancialAuditLog`, não
 * uma coleção nova de "exports gerados" que o app não grava. Documento/
 * consulta, sempre o último bloco da tela, como no mockup).
 */

import type { AuditAction, FinancialAuditLog } from '@/lib/types';
import { FinTable, type FinTableColumn } from '../../components/FinTable';
import { StatusChip, type StatusChipVariant } from '../../components/StatusChip';
import { formatCurrency, formatDateTime } from '@/lib/utils/format';

const ACTION_UI: Record<AuditAction, { label: string; variant: StatusChipVariant }> = {
  create: { label: 'Criação', variant: 'pos' },
  update: { label: 'Edição', variant: 'neutral' },
  delete: { label: 'Exclusão', variant: 'crit' },
  pay: { label: 'Pagamento', variant: 'pos' },
  cancel: { label: 'Cancelamento', variant: 'warn' },
  restore: { label: 'Restauração', variant: 'neutral' },
};

interface HistoricoAuditoriaTableProps {
  logs: FinancialAuditLog[];
  isLoading: boolean;
}

export function HistoricoAuditoriaTable({ logs, isLoading }: HistoricoAuditoriaTableProps) {
  const columns: FinTableColumn<FinancialAuditLog>[] = [
    { key: 'data', header: 'Data', render: r => <span className="fin-num">{formatDateTime(r.createdAt)}</span> },
    { key: 'acao', header: 'Ação', render: r => { const ui = ACTION_UI[r.action]; return <StatusChip label={ui.label} variant={ui.variant} />; } },
    { key: 'descricao', header: 'Descrição', render: r => <span className="text-gray-700 dark:text-gray-300">{r.description ?? '—'}</span> },
    { key: 'valor', header: 'Valor', align: 'right', render: r => <span className="fin-num">{r.amount != null ? formatCurrency(r.amount) : '—'}</span> },
    { key: 'por', header: 'Por', render: r => <span className="text-gray-500 dark:text-gray-400">{r.actorName}</span> },
  ];

  if (isLoading) {
    return <div className="rounded-2xl border border-gray-200 dark:border-gray-800 h-[220px] animate-pulse bg-gray-50 dark:bg-gray-800/40" />;
  }

  return (
    <FinTable
      title="Histórico"
      hint="auditoria — quem alterou o quê e quando"
      columns={columns}
      rows={logs}
      rowKey={r => r.id}
      emptyMessage="Nenhuma alteração registrada ainda."
    />
  );
}
