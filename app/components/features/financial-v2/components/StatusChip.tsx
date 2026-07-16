'use client';

/**
 * StatusChip — chip com dot (espelha `.chip` do mockup). Variantes cobrem os
 * dois vocabulários do plano: status de Transaction (pago/previsto/atrasado/
 * cancelado) e status de assinatura (ativa/risco/atraso/cancelada) — mesma
 * gramática visual, textos diferentes por contexto de uso.
 */

import { cn } from '@/lib/utils';

export type StatusChipVariant = 'pos' | 'warn' | 'crit' | 'neutral';

const VARIANT_CLASSES: Record<StatusChipVariant, string> = {
  pos: 'text-[hsl(var(--fin-pos))] bg-[hsl(var(--fin-pos-soft))]',
  warn: 'text-[hsl(var(--fin-warn))] bg-[hsl(var(--fin-warn-soft))]',
  crit: 'text-[hsl(var(--fin-crit))] bg-[hsl(var(--fin-crit-soft))]',
  neutral: 'text-[hsl(var(--fin-faint))] bg-[hsl(var(--fin-surface-2))]',
};

interface StatusChipProps {
  label: string;
  variant: StatusChipVariant;
  className?: string;
}

export function StatusChip({ label, variant, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/** Mapeamento pronto pro TransactionStatus canônico (FSM em lib/contracts/fsm/transaction.ts). */
export function statusChipForTransaction(status: 'pendente' | 'pago' | 'atrasado' | 'cancelado') {
  switch (status) {
    case 'pago': return { label: 'Pago', variant: 'pos' as const };
    case 'pendente': return { label: 'Previsto', variant: 'neutral' as const };
    case 'atrasado': return { label: 'Atrasado', variant: 'crit' as const };
    case 'cancelado': return { label: 'Cancelado', variant: 'neutral' as const };
  }
}
