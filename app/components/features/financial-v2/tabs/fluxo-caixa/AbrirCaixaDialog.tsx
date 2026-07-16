'use client';

/**
 * AbrirCaixaDialog — abre uma `CashSession` (status 'aberta') pra uma
 * BankAccount tipo caixa: pede o troco inicial (fundo de caixa). Mesmo padrão
 * de escrita direto no Firestore de `LancarSheet`/`BaixaDialog` (addDoc +
 * logAudit + invalidate + toast, R1 businessId sempre presente).
 *
 * Guarda de negócio (gap conhecido, documentado no domínio): só é chamado
 * quando `CaixaAgoraCard` já sabe que a conta não tem sessão 'aberta' no
 * cache local — não há transação Firestore evitando corrida entre 2 abas
 * simultâneas abrindo a mesma gaveta ao mesmo tempo (raro pro volume de um
 * caixa físico único).
 */

import { useEffect, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { logAudit } from '@/lib/services/audit';
import { nowLocalDateTimeIso } from '../../read-models/fluxo-caixa-especie';
import { formatCurrency } from '@/lib/utils/format';
import { FinModal, FinModalButton } from '../../components/FinModal';
import type { BankAccount } from '@/lib/types';

interface AbrirCaixaDialogProps {
  account: BankAccount | null;
  onClose: () => void;
}

export function AbrirCaixaDialog({ account, onClose }: AbrirCaixaDialogProps) {
  const { business, user } = useAuth();
  const queryClient = useQueryClient();
  const [openingAmount, setOpeningAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (account) setOpeningAmount(''); }, [account]);

  const amountValue = Number(openingAmount);
  const canSave = openingAmount.trim().length > 0 && !isNaN(amountValue) && amountValue >= 0;

  function handleClose() {
    if (saving) return;
    onClose();
  }

  async function handleConfirm() {
    if (!account || !business?.id || !user || !canSave) return;
    setSaving(true);
    try {
      const nowIso = nowLocalDateTimeIso();
      const payload: Record<string, unknown> = {
        businessId: business.id,
        bankAccountId: account.id,
        status: 'aberta',
        openedAt: nowIso,
        openedByUid: user.uid,
        openedByName: user.name,
        openingAmount: amountValue,
        withdrawals: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const ref = await addDoc(collection(db, 'cashSessions'), payload);
      await logAudit(db, {
        businessId: business.id,
        entity: 'cashSession',
        entityId: ref.id,
        action: 'create',
        actor: { uid: user.uid, name: user.name },
        after: payload,
        amount: amountValue,
        description: `Abertura de caixa · ${account.name}`,
      });

      queryClient.invalidateQueries({ queryKey: ['fin2-cashSessions', business.id] });
      toast.success(`Caixa "${account.name}" aberto com troco de ${formatCurrency(amountValue)}.`);
      onClose();
    } catch (err) {
      console.error('[AbrirCaixaDialog] erro ao abrir caixa:', err);
      toast.error('Não deu pra abrir o caixa. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <FinModal
      open={!!account}
      onClose={handleClose}
      eyebrow="Abrir caixa"
      title={account?.name ?? '—'}
      description="Informe o troco inicial (fundo de caixa) com que a gaveta está abrindo agora."
      footer={
        <>
          <FinModalButton onClick={handleClose} disabled={saving}>Cancelar</FinModalButton>
          <FinModalButton variant="primary" onClick={handleConfirm} disabled={!canSave || saving}>
            {saving ? 'Abrindo…' : 'Abrir caixa'}
          </FinModalButton>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Troco inicial</span>
        <input
          type="number"
          min="0"
          step="0.01"
          autoFocus
          value={openingAmount}
          onChange={e => setOpeningAmount(e.target.value)}
          placeholder="0"
          className="fin-num w-full rounded-[10px] border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--fin-primary))]"
        />
      </label>
    </FinModal>
  );
}
