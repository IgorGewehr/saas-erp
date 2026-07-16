'use client';

/**
 * SangriaDialog — registra uma retirada de dinheiro da gaveta durante a
 * sessão aberta (valor + motivo). Anexa ao array `withdrawals` da
 * `CashSession` via `arrayUnion` (nunca reescreve o array inteiro — mesmo
 * padrão de `recurrence.history` em `BaixaDialog`).
 */

import { useEffect, useState } from 'react';
import { arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { logAudit } from '@/lib/services/audit';
import { nowLocalDateTimeIso } from '../../read-models/fluxo-caixa-especie';
import type { CashSessionRow } from '../../read-models/fluxo-caixa-especie';
import { formatCurrency } from '@/lib/utils/format';
import { FinModal, FinModalButton } from '../../components/FinModal';

interface SangriaDialogProps {
  session: CashSessionRow | null;
  onClose: () => void;
}

const inputClass = 'w-full rounded-[10px] border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--fin-primary))]';

export function SangriaDialog({ session, onClose }: SangriaDialogProps) {
  const { business, user } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (session) {
      setAmount('');
      setReason('');
    }
  }, [session?.id]);

  const amountValue = Number(amount);
  const canSave = amountValue > 0 && reason.trim().length > 0;

  function handleClose() {
    if (saving) return;
    onClose();
  }

  async function handleConfirm() {
    if (!session || !business?.id || !user || !canSave) return;
    setSaving(true);
    try {
      const nowIso = nowLocalDateTimeIso();
      const reasonTrimmed = reason.trim();
      const withdrawal = {
        id: crypto.randomUUID(),
        amount: amountValue,
        reason: reasonTrimmed,
        at: nowIso,
        byUid: user.uid,
        byName: user.name,
      };

      await updateDoc(doc(db, 'cashSessions', session.id), {
        withdrawals: arrayUnion(withdrawal),
        updatedAt: nowIso,
      });

      await logAudit(db, {
        businessId: business.id,
        entity: 'cashSession',
        entityId: session.id,
        action: 'update',
        actor: { uid: user.uid, name: user.name },
        after: { withdrawal },
        amount: amountValue,
        description: `Sangria · ${session.accountLabel} · ${reasonTrimmed}`,
      });

      queryClient.invalidateQueries({ queryKey: ['fin2-cashSessions', business.id] });
      toast.success(`Sangria de ${formatCurrency(amountValue)} registrada.`);
      onClose();
    } catch (err) {
      console.error('[SangriaDialog] erro ao registrar sangria:', err);
      toast.error('Não deu pra registrar a sangria. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <FinModal
      open={!!session}
      onClose={handleClose}
      eyebrow="Sangria"
      title={session?.accountLabel ?? '—'}
      description="Retirada de dinheiro da gaveta durante o expediente (depósito, segurança, troco pro outro caixa)."
      footer={
        <>
          <FinModalButton onClick={handleClose} disabled={saving}>Cancelar</FinModalButton>
          <FinModalButton variant="primary" onClick={handleConfirm} disabled={!canSave || saving}>
            {saving ? 'Registrando…' : 'Registrar sangria'}
          </FinModalButton>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Valor</span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          autoFocus
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0"
          className={`fin-num ${inputClass}`}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Motivo</span>
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Ex.: Depósito no banco"
          className={inputClass}
        />
      </label>
    </FinModal>
  );
}
