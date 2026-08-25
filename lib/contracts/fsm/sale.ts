/**
 * lib/contracts/fsm/sale.ts — máquina de estados de Sale
 *
 *      ┌─────────┐         ┌────────────┐
 *      │ aberta  │────────►│ finalizada │  (terminal — só PDV deve estornar via cancelada)
 *      └────┬────┘         └────┬───────┘
 *           │                   │
 *           ▼                   ▼
 *      ┌─────────────────────────┐
 *      │      cancelada           │  (terminal — sem retorno)
 *      └─────────────────────────┘
 *
 * Estados terminais: finalizada (caminho feliz), cancelada (estorno).
 * Transição finalizada→cancelada existe (estorno) mas requer
 * restauração de stock pelos consumidores — não modelado aqui, é side-effect.
 */

import { SALE_STATUSES, type SaleStatus } from '../domain/sale';

export const SALE_TRANSITIONS: Record<SaleStatus, ReadonlySet<SaleStatus>> = {
  aberta:     new Set<SaleStatus>(['finalizada', 'cancelada']),
  finalizada: new Set<SaleStatus>(['cancelada']), // estorno permitido
  cancelada:  new Set<SaleStatus>(), // terminal
};

export function canTransitionSale(from: SaleStatus, to: SaleStatus): boolean {
  return SALE_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionSale(from: SaleStatus, to: SaleStatus): void {
  if (!canTransitionSale(from, to)) {
    throw new Error(`Sale FSM: transição inválida ${from} → ${to}`);
  }
}

/** Side-effects esperados por transição. Documentação para emitir eventos cross-módulo. */
export const SALE_TRANSITION_EFFECTS: Partial<Record<`${SaleStatus}->${SaleStatus}`, string[]>> = {
  'aberta->finalizada': [
    'stock.applyStockOperation(saida, items)',
    'Emit event sale.finalized → criar Transaction receita',
    'Se fiscalDocId vazio: trigger emissão NFC-e',
    'loyalty.addPoints (se settings.loyalty.isEnabled)',
  ],
  'aberta->cancelada': [
    'Nenhum side-effect (stock ainda não foi tocado em sale=aberta)',
  ],
  'finalizada->cancelada': [
    'stock.applyStockOperation(restauracao, items) — devolver itens ao estoque',
    'Emit event sale.canceled → marcar Transaction estornada',
    'Se fiscalDocId existe: cancelamento NFC-e (/api/fiscal/cancel)',
    'loyalty.removePoints',
  ],
};

export const SALE_TERMINAL_STATUSES: ReadonlySet<SaleStatus> = new Set(['cancelada']);

void SALE_STATUSES; // keep import for type narrowing tooling
