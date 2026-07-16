'use client';

/**
 * BaixaDialog — "por qual conta isso entrou/saiu?", a ponte previsto→realizado
 * do plano (financial-v2/§4, mitigação do gap g2): obriga `bankAccountId` e
 * atualiza o `balance` da conta via `increment()` atômico — é o primeiro
 * fluxo do módulo que faz isso (o clássico `handleMarkAsPaid` nunca tocava
 * saldo). Recorrências ativas avançam `nextDueDate`/`history` no mesmo
 * update, igual ao `handleMarkRecurringPaid` clássico.
 *
 * Escopo do FSM (`lib/contracts/fsm/transaction.ts`): só validamos a
 * transição pra avulsas. Uma recorrência ativa mantém `status: 'pago'` de
 * ciclo a ciclo (o campo raiz reflete só o último pagamento, nunca "falta de
 * novo" — ver `recurrence-projection.ts`), então o FSM pendente/atrasado→pago
 * não se aplica ciclo-a-ciclo aqui, mesmo comportamento do clássico.
 */

import { useMemo, useState } from 'react';
import { doc, updateDoc, increment, arrayUnion } from 'firebase/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { Landmark, Wallet } from 'lucide-react';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { logAudit } from '@/lib/services/audit';
import { assertTransitionTransaction, type TransactionStatus as FsmTransactionStatus } from '@/lib/contracts/fsm/transaction';
import { advanceRecurrence } from '../read-models/recurrence-projection';
import type { ExtratoRow } from '../read-models/extrato-unificado';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import { FinModal, FinModalButton } from './FinModal';
import type { BankAccount, Transaction } from '@/lib/types';

interface BaixaDialogProps {
  row: ExtratoRow | null;
  transactions: Transaction[];
  bankAccounts: BankAccount[];
  onClose: () => void;
}

export function BaixaDialog({ row, transactions, bankAccounts, onClose }: BaixaDialogProps) {
  const { business, user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeAccounts = useMemo(() => bankAccounts.filter(a => a.isActive), [bankAccounts]);

  const description = useMemo(() => {
    if (!row) return '';
    const amountFmt = formatCurrency(row.amount);
    const dateInfo = row.status === 'atrasado' && row.overdueDays
      ? `atrasado há ${row.overdueDays} dia${row.overdueDays > 1 ? 's' : ''}`
      : `vence em ${formatDate(row.date)}`;
    const direction = row.direction === 'entrada' ? 'entrou' : 'saiu';
    return `${amountFmt} · ${dateInfo}. Confirme por qual conta isso ${direction}.`;
  }, [row]);

  async function handleConfirm() {
    if (!row || !selectedId || !business?.id || !user) return;
    const account = activeAccounts.find(a => a.id === selectedId);
    const tx = transactions.find(t => t.id === row.transactionId);
    if (!account || !tx) return;

    setSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();
      const updates: Record<string, unknown> = {
        status: 'pago',
        paymentDate: today,
        bankAccountId: account.id,
        updatedAt: nowIso,
        updatedBy: user.uid,
        updatedByName: user.name,
      };

      if (row.isRecurringOpenOccurrence && tx.recurrence?.isActive && tx.recurrence.nextDueDate) {
        const rec = tx.recurrence;
        const nextDate = advanceRecurrence(rec.nextDueDate, rec.frequency, rec.dayOfMonth, rec.secondDayOfMonth, rec.holidayAdjust);
        const seriesEnds = !!rec.endDate && nextDate > rec.endDate;
        updates['recurrence.nextDueDate'] = nextDate;
        updates['recurrence.history'] = arrayUnion({ dueDate: rec.nextDueDate, paidDate: today, amount: tx.amount });
        if (seriesEnds) updates['recurrence.isActive'] = false;
      } else {
        assertTransitionTransaction(tx.status as FsmTransactionStatus, 'pago');
      }

      await updateDoc(doc(db, 'transactions', tx.id), updates);
      await updateDoc(doc(db, 'bankAccounts', account.id), {
        balance: increment(row.amountSigned),
        updatedAt: nowIso,
      });

      await logAudit(db, {
        businessId: business.id,
        entity: 'transaction',
        entityId: tx.id,
        action: 'pay',
        actor: { uid: user.uid, name: user.name },
        before: { status: tx.status, bankAccountId: tx.bankAccountId },
        after: { status: 'pago', bankAccountId: account.id },
        amount: tx.amount,
        description: tx.description,
      });

      queryClient.invalidateQueries({ queryKey: ['fin2-transactions', business.id] });
      queryClient.invalidateQueries({ queryKey: ['bankAccounts', business.id] });
      toast.success(`Baixado em ${account.name} — já aparece em ${account.accountType === 'caixa' ? 'Fluxo de Caixa' : 'Bancário'}.`);
      setSelectedId(null);
      onClose();
    } catch (err) {
      console.error('[BaixaDialog] erro ao dar baixa:', err);
      toast.error('Não deu pra confirmar a baixa. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (saving) return;
    setSelectedId(null);
    onClose();
  }

  return (
    <FinModal
      open={!!row}
      onClose={handleClose}
      eyebrow="Dar baixa"
      title={row?.description ?? '—'}
      description={description}
      footer={
        <>
          <FinModalButton onClick={handleClose} disabled={saving}>Cancelar</FinModalButton>
          <FinModalButton variant="primary" onClick={handleConfirm} disabled={!selectedId || saving}>
            {saving ? 'Confirmando…' : 'Confirmar baixa'}
          </FinModalButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {activeAccounts.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma conta bancária cadastrada ainda — cadastre uma em Bancário antes de dar baixa.</p>
        )}
        {activeAccounts.map(account => (
          <button
            key={account.id}
            type="button"
            onClick={() => setSelectedId(account.id)}
            className={cn(
              'flex items-center justify-between gap-2 rounded-xl border-[1.5px] px-3.5 py-2.5 text-left text-[13.5px] font-semibold transition-colors',
              selectedId === account.id
                ? 'border-[hsl(var(--fin-primary))] bg-[hsl(var(--fin-primary-soft))] text-[hsl(var(--fin-primary))]'
                : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-gray-800 dark:text-gray-200 hover:border-[hsl(var(--fin-primary)/0.4)]',
            )}
          >
            <span className="inline-flex items-center gap-2">
              {account.accountType === 'caixa' ? <Wallet className="w-4 h-4" /> : <Landmark className="w-4 h-4" />}
              {account.name}
            </span>
            <span className={cn('text-[11px] font-semibold', selectedId === account.id ? 'text-[hsl(var(--fin-primary))]' : 'text-gray-400 dark:text-gray-500')}>
              {account.accountType === 'caixa' ? 'espécie' : 'banco'}
            </span>
          </button>
        ))}
      </div>
    </FinModal>
  );
}
