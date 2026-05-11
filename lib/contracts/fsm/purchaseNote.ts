/**
 * lib/contracts/fsm/purchaseNote.ts — máquina de estados de PurchaseNote
 *
 *      ┌──────────┐
 *      │ pendente │ ────► importada  (terminal — set stockImportedAt + stockMovementIds)
 *      └────┬─────┘
 *           │
 *           ▼
 *      ┌─────────────┐
 *      │  cancelada  │  (terminal — sem touch em stock)
 *      └─────────────┘
 *
 * Idempotência: `importada` é terminal. NÃO pode voltar a pendente nem
 * reimportar (vide invariante em domain/purchaseNote.ts).
 */

import { PURCHASE_NOTE_STATUSES, type PurchaseNoteStatus } from '../domain/purchaseNote';

export const PURCHASE_NOTE_TRANSITIONS: Record<PurchaseNoteStatus, ReadonlySet<PurchaseNoteStatus>> = {
  pendente:  new Set<PurchaseNoteStatus>(['importada', 'cancelada']),
  importada: new Set<PurchaseNoteStatus>(), // terminal (idempotência)
  cancelada: new Set<PurchaseNoteStatus>(), // terminal
};

export function canTransitionPurchaseNote(from: PurchaseNoteStatus, to: PurchaseNoteStatus): boolean {
  return PURCHASE_NOTE_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionPurchaseNote(from: PurchaseNoteStatus, to: PurchaseNoteStatus): void {
  if (!canTransitionPurchaseNote(from, to)) {
    throw new Error(`PurchaseNote FSM: transição inválida ${from} → ${to} (importada é terminal por idempotência)`);
  }
}

export const PURCHASE_NOTE_TRANSITION_EFFECTS: Partial<Record<`${PurchaseNoteStatus}->${PurchaseNoteStatus}`, string[]>> = {
  'pendente->importada': [
    'For each matched item: stock.addStock + create StockMovement (mesmo batch)',
    'Update products.costPrice se delta > 5%',
    'set stockImportedAt + stockMovementIds[]',
    'Emit event purchase.imported → criar Transaction despesa (opcional)',
  ],
  'pendente->cancelada': ['Nenhum side-effect (stock não foi tocado)'],
};

export const PURCHASE_NOTE_TERMINAL_STATUSES: ReadonlySet<PurchaseNoteStatus> = new Set(['importada', 'cancelada']);

void PURCHASE_NOTE_STATUSES;
