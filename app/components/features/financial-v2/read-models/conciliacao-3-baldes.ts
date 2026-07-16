/**
 * conciliacao-3-baldes.ts — read-model do card direito de Bancário: os "3
 * baldes" da conciliação (plano §2.5 e §1.2 "Bancário"). FUNÇÃO PURA.
 *
 *   ✔ Bateu            — ReconciliationItem.status === 'matched'
 *   ⚠ Sobrou no banco   — ReconciliationItem pending/divergent, sem confirmação
 *   ⚠ Sobrou no sistema — Transaction paga (bancária) sem nenhum
 *                          ReconciliationItem apontando pra ela
 *
 * O motor de sugestão de match ("Parece ser X") REAPROVEITA `autoMatch` de
 * `lib/services/reconciliation.ts` — o mesmo motor da ConciliacaoTab clássica
 * (plano §0: "herda a lógica, re-skina a UI") — tratando cada item pendente
 * como se fosse uma linha de extrato recém-importada, contra o pool de
 * Transactions pagas ainda sem nenhum item de conciliação vinculado. Não
 * importa nada nem grava nada — é só uma sugestão pra exibir, a confirmação é
 * ação do usuário (1 clique) na UI.
 */

import type { BankAccount, ReconciliationItem, Transaction } from '@/lib/types';
import { autoMatch } from '@/lib/services/reconciliation';
import { monthKeyOf } from './date-utils';

export interface BaldeBancoItem {
  id: string;
  bankAccountId?: string;
  date: string;
  desc: string;
  /** Sinal do extrato bancário: positivo = crédito, negativo = débito. */
  valor: number;
  sugestao?: { transactionId: string; label: string; confidence: number };
}

export interface BaldeSistemaItem {
  id: string;
  bankAccountId?: string;
  date: string;
  desc: string;
  valor: number;
}

export interface ConciliacaoBaldesOverview {
  bateuCount: number;
  bateuAmostra: { id: string; date: string; desc: string }[];
  sobrouBanco: BaldeBancoItem[];
  sobrouSistema: BaldeSistemaItem[];
  itensPendentes: number;
  valorEmDuvida: number;
}

export function computeConciliacao3Baldes(
  reconciliationItems: ReconciliationItem[],
  transactions: Transaction[],
  bankAccounts: BankAccount[],
  period: string,
): ConciliacaoBaldesOverview {
  const contas = bankAccounts.filter(a => a.isActive && a.accountType !== 'caixa');
  const nonCaixaIds = new Set(contas.map(a => a.id));

  // Itens do import "todas as contas" (bankAccountId null) contam pra cá também.
  const relevantItems = reconciliationItems.filter(i => !i.bankAccountId || nonCaixaIds.has(i.bankAccountId));

  const matched = relevantItems
    .filter(i => i.status === 'matched')
    .sort((a, b) => (a.statementDate < b.statementDate ? 1 : -1));
  const unresolved = relevantItems
    .filter(i => i.status === 'pending' || i.status === 'divergent')
    .sort((a, b) => (a.statementDate < b.statementDate ? 1 : -1));

  const linkedTxIds = new Set(relevantItems.map(i => i.transactionId).filter((id): id is string => !!id));

  const candidatePool = transactions.filter(t => t.status === 'pago' && !linkedTxIds.has(t.id));
  const entries = unresolved.map(i => ({ date: i.statementDate, description: i.statementDescription, amount: i.statementAmount }));
  const suggestions = autoMatch(entries, candidatePool, { amountTolerance: 0.01, dateTolerance: 3 });
  const suggestionByIdx = new Map(suggestions.map(s => [s.statementIdx, s]));
  const txById = new Map(candidatePool.map(t => [t.id, t]));

  const sobrouBanco: BaldeBancoItem[] = unresolved.map((item, idx) => {
    const suggestion = suggestionByIdx.get(idx);
    const tx = suggestion ? txById.get(suggestion.transactionId) : undefined;
    return {
      id: item.id,
      bankAccountId: item.bankAccountId,
      date: item.statementDate,
      desc: item.statementDescription,
      valor: item.statementAmount,
      sugestao: tx && suggestion ? { transactionId: tx.id, label: tx.description, confidence: suggestion.confidence } : undefined,
    };
  });

  // Uma Transaction já sugerida como match de um item "sobrou no banco" não
  // entra aqui também — senão a MESMA pendência apareceria nos dois baldes
  // (o usuário resolve pelo lado do banco, que já tem a sugestão pronta).
  const suggestedTxIds = new Set(sobrouBanco.map(i => i.sugestao?.transactionId).filter((id): id is string => !!id));

  const sobrouSistema: BaldeSistemaItem[] = transactions
    .filter(t =>
      t.status === 'pago' &&
      !!t.bankAccountId &&
      nonCaixaIds.has(t.bankAccountId) &&
      !linkedTxIds.has(t.id) &&
      !suggestedTxIds.has(t.id) &&
      monthKeyOf(t.paymentDate) === period,
    )
    .sort((a, b) => ((a.paymentDate ?? '') < (b.paymentDate ?? '') ? 1 : -1))
    .map(t => ({
      id: t.id,
      bankAccountId: t.bankAccountId,
      date: t.paymentDate ?? '',
      desc: t.description,
      valor: t.type === 'receita' ? t.amount : -t.amount,
    }));

  const valorEmDuvida =
    sobrouBanco.reduce((s, i) => s + Math.abs(i.valor), 0) + sobrouSistema.reduce((s, i) => s + Math.abs(i.valor), 0);

  return {
    bateuCount: matched.length,
    bateuAmostra: matched.slice(0, 5).map(i => ({ id: i.id, date: i.statementDate, desc: i.statementDescription })),
    sobrouBanco,
    sobrouSistema,
    itensPendentes: sobrouBanco.length + sobrouSistema.length,
    valorEmDuvida,
  };
}
