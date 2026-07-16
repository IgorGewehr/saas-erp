'use client';

/**
 * FecharCaixaDialog — fecha a `CashSession` aberta: mostra o esperado
 * (`session.expectedNow`, já live-computado pelo read-model a partir das
 * Transactions em espécie + sangrias desde a abertura), pede a contagem física
 * e congela `expectedAmount`/`countedAmount`/`difference` no doc (nunca mais
 * recalculados depois — é o "sobra × falta" que alimenta o drill histórico).
 * FSM (`assertTransitionCashSession`) valida a transição antes do write (R4).
 */

import { useEffect, useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { db } from '@/lib/config/firebase';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { logAudit } from '@/lib/services/audit';
import { assertTransitionCashSession } from '@/lib/contracts/fsm/cashSession';
import { nowLocalDateTimeIso } from '../../read-models/fluxo-caixa-especie';
import type { CashSessionRow } from '../../read-models/fluxo-caixa-especie';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import { FinModal, FinModalButton } from '../../components/FinModal';

interface FecharCaixaDialogProps {
  session: CashSessionRow | null;
  onClose: () => void;
}

export function FecharCaixaDialog({ session, onClose }: FecharCaixaDialogProps) {
  const { business, user } = useAuth();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (session) setCounted(''); }, [session?.id]);

  const expected = session?.expectedNow ?? 0;
  const countedValue = Number(counted);
  const hasCounted = counted.trim().length > 0 && !isNaN(countedValue) && countedValue >= 0;
  const difference = useMemo(() => (hasCounted ? countedValue - expected : null), [hasCounted, countedValue, expected]);

  function handleClose() {
    if (saving) return;
    onClose();
  }

  async function handleConfirm() {
    if (!session || !business?.id || !user || !hasCounted || difference === null) return;
    setSaving(true);
    try {
      assertTransitionCashSession(session.status, 'fechada');
      const nowIso = nowLocalDateTimeIso();
      const updates = {
        status: 'fechada' as const,
        closedAt: nowIso,
        closedByUid: user.uid,
        closedByName: user.name,
        countedAmount: countedValue,
        expectedAmount: expected,
        difference,
        updatedAt: nowIso,
      };
      await updateDoc(doc(db, 'cashSessions', session.id), updates);

      await logAudit(db, {
        businessId: business.id,
        entity: 'cashSession',
        entityId: session.id,
        action: 'update',
        actor: { uid: user.uid, name: user.name },
        before: { status: session.status },
        after: updates,
        amount: Math.abs(difference),
        description: `Fechamento de caixa · ${session.accountLabel}`,
      });

      queryClient.invalidateQueries({ queryKey: ['fin2-cashSessions', business.id] });
      const msg = Math.abs(difference) <= 0.01
        ? 'Caixa fechado — bateu certinho.'
        : difference > 0
          ? `Caixa fechado — sobra de ${formatCurrency(difference)}.`
          : `Caixa fechado — falta de ${formatCurrency(Math.abs(difference))}.`;
      toast.success(msg);
      onClose();
    } catch (err) {
      console.error('[FecharCaixaDialog] erro ao fechar caixa:', err);
      toast.error('Não deu pra fechar o caixa. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <FinModal
      open={!!session}
      onClose={handleClose}
      eyebrow="Fechar caixa"
      title={session?.accountLabel ?? '—'}
      description={`Esperado na gaveta: ${formatCurrency(expected)}. Conte o dinheiro físico e informe abaixo.`}
      footer={
        <>
          <FinModalButton onClick={handleClose} disabled={saving}>Cancelar</FinModalButton>
          <FinModalButton variant="primary" onClick={handleConfirm} disabled={!hasCounted || saving}>
            {saving ? 'Fechando…' : 'Confirmar fechamento'}
          </FinModalButton>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Valor contado na gaveta</span>
        <input
          type="number"
          min="0"
          step="0.01"
          autoFocus
          value={counted}
          onChange={e => setCounted(e.target.value)}
          placeholder="0"
          className="fin-num w-full rounded-[10px] border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--fin-primary))]"
        />
      </label>
      {difference !== null && (
        <div
          className={cn(
            'rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 text-[13px] font-semibold',
            Math.abs(difference) <= 0.01
              ? 'bg-[hsl(var(--fin-pos-soft))] text-[hsl(var(--fin-pos))]'
              : difference > 0
                ? 'bg-[hsl(var(--fin-pos-soft))] text-[hsl(var(--fin-pos))]'
                : 'bg-[hsl(var(--fin-crit-soft))] text-[hsl(var(--fin-crit))]',
          )}
        >
          <span>{Math.abs(difference) <= 0.01 ? 'Bateu certinho' : difference > 0 ? 'Sobra' : 'Falta'}</span>
          <span className="fin-num">{formatCurrency(Math.abs(difference))}</span>
        </div>
      )}
    </FinModal>
  );
}
