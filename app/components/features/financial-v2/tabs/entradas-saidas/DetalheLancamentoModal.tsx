'use client';

/**
 * DetalheLancamentoModal — o modal read-only "Lançamento realizado" do
 * mockup: revela categoria/conta/origem de uma linha já paga. Diferente do
 * mockup, NÃO mostra um chip de conciliação fixo ("✓ Conciliado") — a
 * conciliação de verdade (`ReconciliationItem`) é a Fase 4 do plano (Bancário)
 * e fabricar esse status aqui violaria "dados reais, não mock".
 */

import { formatCurrency, formatDate } from '@/lib/utils/format';
import { FinModal, FinModalButton } from '../../components/FinModal';
import type { ExtratoRow } from '../../read-models/extrato-unificado';

interface DetalheLancamentoModalProps {
  row: ExtratoRow | null;
  onClose: () => void;
}

export function DetalheLancamentoModal({ row, onClose }: DetalheLancamentoModalProps) {
  const amountLabel = row ? `${row.direction === 'entrada' ? '+' : '−'}${formatCurrency(row.amount)}` : '';

  return (
    <FinModal
      open={!!row}
      onClose={onClose}
      eyebrow="Lançamento realizado"
      title={row?.description ?? '—'}
      description={row ? `${formatDate(row.date)} · ${amountLabel}` : undefined}
      footer={<FinModalButton variant="primary" onClick={onClose}>Fechar</FinModalButton>}
    >
      <div className="flex flex-col gap-2 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3.5 py-3">
        <DetailRow label="Categoria" value={row?.category ?? '—'} />
        <DetailRow label="Conta" value={row?.accountLabel ?? '—'} />
        <DetailRow label="Origem" value={row?.origem ?? '—'} />
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Conciliação bancária (bateu com o extrato do banco) chega na aba Bancário.
      </p>
    </FinModal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2.5 text-[13.5px]">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-semibold text-gray-800 dark:text-gray-200">{value}</span>
    </div>
  );
}
