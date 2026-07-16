/**
 * extrato-unificado.ts — read-model da "Linha do tempo" de Entradas & Saídas
 * (financial-v2/§2.3 `ExtratoUnificado(período, lente)`). FUNÇÃO PURA.
 *
 * Mescla realizado (Transaction `pago`, por `paymentDate`) e previsto
 * (`pendente`/`atrasado`, por `dueDate` — ou `recurrence.nextDueDate` pra
 * templates ativos, via `effectiveDueDate`/`isOpenCommitment`) numa única
 * lista ordenada por data decrescente, com o índice do divisor "HOJE".
 *
 * Recorrências ativas geram DUAS classes de linha, nunca duplicadas:
 *  1. uma linha "em aberto" pra próxima ocorrência (`recurrence.nextDueDate`)
 *     — é nela que a ação "dar baixa" atua (avança a recorrência);
 *  2. uma linha "paga" por entrada de `recurrence.history[]` — o passado real
 *     já realizado, capado às últimas `HISTORY_CAP` ocorrências (a linha do
 *     tempo é um extrato recente, não o arquivo morto completo da recorrência
 *     — esse é o RecurrenceDetailDialog, fora do escopo desta tela).
 */

import type { BankAccount, Transaction } from '@/lib/types';
import { effectiveDueDate, isOpenCommitment } from './recurrence-projection';
import { startOfDay, toDateStr } from './date-utils';

const HISTORY_CAP = 18;

export type ExtratoStatus = 'pago' | 'previsto' | 'atrasado';
export type ExtratoDirection = 'entrada' | 'saida';

export interface ExtratoRow {
  /** Chave de render — sintética pra linhas de histórico (`${transactionId}::h${n}`). */
  id: string;
  /** Doc real de `transactions` que a ação (dar baixa) atualiza. */
  transactionId: string;
  date: string;
  description: string;
  sublabel?: string;
  category?: string;
  direction: ExtratoDirection;
  amount: number;
  amountSigned: number;
  status: ExtratoStatus;
  overdueDays?: number;
  accountLabel?: string;
  origem?: string;
  /** true = a linha é a ocorrência corrente de um template recorrente ativo (baixa avança a recorrência). */
  isRecurringOpenOccurrence: boolean;
  /** true = linha de histórico já realizada (read-only, sem ação de baixa). */
  isHistoryEntry: boolean;
}

export interface ExtratoUnificadoResult {
  rows: ExtratoRow[];
  /** Índice (na lista completa, não-filtrada) da primeira linha com data ≤ hoje — null se não há nenhuma. */
  todayDividerIndex: number | null;
  atrasadosCount: number;
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX recebido',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  boleto: 'Boleto',
  creditoLoja: 'Crédito de loja',
  semPagamento: 'Sem pagamento',
  pontos: 'Pontos de fidelidade',
  gift_card: 'Gift card',
  outros: 'Outros',
};

function describeOrigin(t: Transaction): string | undefined {
  if (t.saleId) return 'Venda no PDV';
  if (t.deliveryOrderId) return 'Pedido delivery';
  if (t.appointmentId) return 'Comissão de agendamento';
  if (t.clientMembershipId) return 'Cobrança de assinatura';
  if (t.paymentMethod) return PAYMENT_METHOD_LABEL[t.paymentMethod] ?? t.paymentMethod;
  return undefined;
}

function accountLabelFor(bankAccountId: string | undefined, accounts: Map<string, BankAccount>): string | undefined {
  if (!bankAccountId) return undefined;
  return accounts.get(bankAccountId)?.name;
}

function openRowStatus(date: string, todayStr: string, explicit: Transaction['status']): { status: ExtratoStatus; overdueDays?: number } {
  const late = explicit === 'atrasado' || date < todayStr;
  if (!late) return { status: 'previsto' };
  const days = Math.max(0, Math.round((new Date(`${todayStr}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000));
  return { status: 'atrasado', overdueDays: days };
}

function openRow(t: Transaction, date: string, todayStr: string): ExtratoRow {
  const direction: ExtratoDirection = t.type === 'receita' ? 'entrada' : 'saida';
  const isRecurring = !!t.recurrence?.isActive;
  const { status, overdueDays } = openRowStatus(date, todayStr, t.status);
  const label = isRecurring ? (t.recurrence?.label || t.description) : t.description;
  const sublabel = isRecurring
    ? 'lançamento recorrente'
    : (t.installmentTotal && t.installmentTotal > 1 ? `parcela ${t.installmentNumber ?? 1}/${t.installmentTotal}` : undefined);

  return {
    id: t.id,
    transactionId: t.id,
    date,
    description: label,
    sublabel,
    category: t.category,
    direction,
    amount: t.amount,
    amountSigned: direction === 'entrada' ? t.amount : -t.amount,
    status,
    overdueDays,
    isRecurringOpenOccurrence: isRecurring,
    isHistoryEntry: false,
  };
}

function paidRow(t: Transaction, accounts: Map<string, BankAccount>): ExtratoRow {
  const direction: ExtratoDirection = t.type === 'receita' ? 'entrada' : 'saida';
  const date = t.paymentDate ?? t.dueDate ?? '';
  return {
    id: t.id,
    transactionId: t.id,
    date,
    description: t.description,
    category: t.category,
    direction,
    amount: t.amount,
    amountSigned: direction === 'entrada' ? t.amount : -t.amount,
    status: 'pago',
    accountLabel: accountLabelFor(t.bankAccountId, accounts),
    origem: describeOrigin(t),
    isRecurringOpenOccurrence: false,
    isHistoryEntry: false,
  };
}

function historyRow(t: Transaction, historyIndex: number, direction: ExtratoDirection): ExtratoRow {
  const history = t.recurrence?.history ?? [];
  const h = history[historyIndex];
  return {
    id: `${t.id}::h${historyIndex}`,
    transactionId: t.id,
    date: h.paidDate,
    description: t.recurrence?.label || t.description,
    sublabel: 'recorrente',
    category: t.category,
    direction,
    amount: h.amount,
    amountSigned: direction === 'entrada' ? h.amount : -h.amount,
    status: 'pago',
    isRecurringOpenOccurrence: false,
    isHistoryEntry: true,
  };
}

export function computeExtratoUnificado(
  transactions: Transaction[],
  bankAccounts: BankAccount[],
  now: Date = new Date(),
): ExtratoUnificadoResult {
  const todayStr = toDateStr(startOfDay(now));
  const accounts = new Map(bankAccounts.map(a => [a.id, a]));
  const rows: ExtratoRow[] = [];

  for (const t of transactions) {
    if (t.status === 'cancelado') continue;

    if (isOpenCommitment(t)) {
      const date = effectiveDueDate(t);
      if (date) rows.push(openRow(t, date, todayStr));
    }

    if (t.recurrence) {
      const history = t.recurrence.history ?? [];
      const direction: ExtratoDirection = t.type === 'receita' ? 'entrada' : 'saida';
      const start = Math.max(0, history.length - HISTORY_CAP);
      for (let i = start; i < history.length; i++) rows.push(historyRow(t, i, direction));
    } else if (t.status === 'pago') {
      rows.push(paidRow(t, accounts));
    }
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  let todayDividerIndex: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].date <= todayStr) { todayDividerIndex = i; break; }
  }

  const atrasadosCount = rows.filter(r => r.status === 'atrasado').length;

  return { rows, todayDividerIndex, atrasadosCount };
}

export type ExtratoSegmento = 'tudo' | 'receber' | 'pagar';
export type ExtratoActiveFilter = { type: 'categoria'; value: string; label: string } | { type: 'atrasados'; label: string };

export function rowPassesFilter(row: ExtratoRow, segmento: ExtratoSegmento, activeFilter: ExtratoActiveFilter | null): boolean {
  if (segmento === 'receber' && row.direction !== 'entrada') return false;
  if (segmento === 'pagar' && row.direction !== 'saida') return false;
  if (activeFilter?.type === 'categoria' && row.category !== activeFilter.value) return false;
  if (activeFilter?.type === 'atrasados' && row.status !== 'atrasado') return false;
  return true;
}
