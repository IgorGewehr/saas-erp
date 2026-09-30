/**
 * lib/contracts/fsm/tableSession.ts — máquina de estados de TableSession
 *
 *   aberta ──► fechada ──► paga        (paga = terminal)
 *     │           │  ▲
 *     │           │  └── reabrir (fechada → aberta) enquanto ninguém pagou
 *     └───────────┴────► cancelada     (cancelada = terminal)
 *
 * `aberta`   — mesa em uso, aceita novos pedidos (`?mesa=` e "+ Pedido").
 * `fechada`  — conta fechada, subtotal congelado, NÃO aceita novos pedidos;
 *              aguardando o checkout no PDV.
 * `paga`     — o PDV finalizou a venda única; todos os pedidos vinculados
 *              viraram `entregue` (com `settledViaSaleId`). Terminal.
 * `cancelada`— mesa abandonada/erro; pedidos ainda abertos foram cancelados.
 *
 * Reabrir (`fechada → aberta`) existe pro caso "esqueci a sobremesa": some o
 * `subtotalSnapshot` congelado e a mesa volta a aceitar pedido. Depois de
 * `paga` não tem volta (a Sale já foi lançada).
 */

import { TABLE_SESSION_STATUSES, type TableSessionStatus } from '../domain/tableSession';

export const TABLE_SESSION_TRANSITIONS: Record<TableSessionStatus, ReadonlySet<TableSessionStatus>> = {
  aberta: new Set<TableSessionStatus>(['fechada', 'cancelada']),
  fechada: new Set<TableSessionStatus>(['paga', 'aberta', 'cancelada']),
  paga: new Set<TableSessionStatus>(), // terminal
  cancelada: new Set<TableSessionStatus>(), // terminal
};

export function canTransitionTableSession(from: TableSessionStatus, to: TableSessionStatus): boolean {
  return TABLE_SESSION_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionTableSession(from: TableSessionStatus, to: TableSessionStatus): void {
  if (!canTransitionTableSession(from, to)) {
    throw new Error(`TableSession FSM: transição inválida ${from} → ${to}`);
  }
}

export const TABLE_SESSION_TERMINAL_STATUSES: ReadonlySet<TableSessionStatus> = new Set(['paga', 'cancelada']);

/** Side-effects esperados por transição (documentação — a execução vive em
 *  `lib/services/table-session-admin.ts`). */
export const TABLE_SESSION_TRANSITION_EFFECTS: Partial<Record<`${TableSessionStatus}->${TableSessionStatus}`, string[]>> = {
  'aberta->fechada': [
    'Congela subtotalSnapshot = Σ total dos deliveryOrders vinculados não-cancelados',
    'A partir daqui ?mesa= e "+ Pedido" recusam novos pedidos nesta sessão',
  ],
  'fechada->aberta': ['Limpa closedAt/closedByUid/closedByName/subtotalSnapshot — volta a aceitar pedidos'],
  'fechada->paga': [
    'Recebe saleId da Sale única criada no checkout do PDV',
    'Para cada orderId não-terminal: transitionDeliveryOrderAdmin(targetStatus="entregue", settleViaSaleId=saleId) — SEM receita própria',
    'set saleId, paidAt, paidByUid',
    // AUDIT-ONLY: emite table.settled em domainEvents/{id}. Sem subscriber no bus.
  ],
  'aberta->cancelada': ['Cancela (transitionDeliveryOrderAdmin "cancelado") cada pedido vinculado ainda não-terminal'],
  'fechada->cancelada': ['Idem — cancela pedidos vinculados não-terminais; a conta congelada é descartada'],
};

void TABLE_SESSION_STATUSES;
