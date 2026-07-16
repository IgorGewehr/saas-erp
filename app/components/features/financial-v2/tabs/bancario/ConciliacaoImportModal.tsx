'use client';

/**
 * ConciliacaoImportModal — abre a `ConciliacaoTab` CLÁSSICA (import OFX/CSV,
 * tolerâncias, regras de auto-categorização, match manual) dentro da moldura
 * `FinModal` do v2. Reuso literal e intencional (plano §0: "herda a lógica,
 * re-skina a UI" / §4: "Nenhum import de financial/ antigo exceto
 * ConciliacaoTab") — reimplementar parser de OFX/CSV e o motor de regras
 * aqui seria retrabalho puro. Ao fechar, invalida `fin2-reconciliationItems`
 * pra a aba Bancário (3 baldes + extrato) refletir o que acabou de ser
 * importado/salvo lá dentro.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/app/components/providers/AuthProvider';
import { FinModal, FinModalButton } from '../../components/FinModal';
// Única exceção documentada de import do módulo clássico (ver comentário acima).
import ConciliacaoTabClassic from '@/app/components/features/financial/ConciliacaoTab';
import type { BankAccount, Transaction } from '@/lib/types';

interface ConciliacaoImportModalProps {
  open: boolean;
  onClose: () => void;
  transactions: Transaction[];
  bankAccounts: BankAccount[];
}

export function ConciliacaoImportModal({ open, onClose, transactions, bankAccounts }: ConciliacaoImportModalProps) {
  const { business } = useAuth();
  const queryClient = useQueryClient();

  function handleClose() {
    if (business?.id) {
      queryClient.invalidateQueries({ queryKey: ['fin2-reconciliationItems', business.id] });
    }
    onClose();
  }

  return (
    <FinModal
      open={open}
      onClose={handleClose}
      eyebrow="Bancário"
      title="Importar extrato"
      description="Importe um arquivo OFX ou CSV do seu banco — o sistema sugere os matches automaticamente por valor e data."
      maxWidthClassName="max-w-[760px]"
      footer={<FinModalButton variant="primary" onClick={handleClose}>Concluído</FinModalButton>}
    >
      {business?.id && (
        <ConciliacaoTabClassic businessId={business.id} transactions={transactions} bankAccounts={bankAccounts} />
      )}
    </FinModal>
  );
}
