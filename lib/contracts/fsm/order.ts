/**
 * lib/contracts/fsm/order.ts — máquina de estados de Order (B2B/PDV-orçamento/condicional)
 *
 *  pendente ──► confirmado ──► faturado ──► enviado ──► entregue (terminal)
 *      │           │              │            │
 *      └─── condicional ──► confirmado (mesma rota acima)
 *      │           │
 *      └───────────┴────────────► cancelado (terminal, em qualquer ponto pré-entrega)
 *
 * Order é diferente de DeliveryOrder (ver fsm/deliveryOrder.ts).
 */

import { ORDER_STATUSES, type OrderStatus } from '../domain/order';

export const ORDER_TRANSITIONS: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  pendente:    new Set<OrderStatus>(['confirmado', 'condicional', 'cancelado']),
  condicional: new Set<OrderStatus>(['confirmado', 'cancelado']),
  confirmado:  new Set<OrderStatus>(['faturado', 'cancelado']),
  faturado:    new Set<OrderStatus>(['enviado', 'cancelado']),
  enviado:     new Set<OrderStatus>(['entregue', 'cancelado']),
  entregue:    new Set<OrderStatus>(), // terminal
  cancelado:   new Set<OrderStatus>(), // terminal
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionOrder(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new Error(`Order FSM: transição inválida ${from} → ${to}`);
  }
}

export const ORDER_TRANSITION_EFFECTS: Partial<Record<`${OrderStatus}->${OrderStatus}`, string[]>> = {
  'pendente->confirmado': [
    'Lock de estoque (reserva) — opcional',
  ],
  'confirmado->faturado': [
    'Emitir NF-e (/api/fiscal/emit)',
    'stock.applyStockOperation(saida, items)',
    'Emit event order.invoiced → criar Transaction receita',
  ],
  'faturado->enviado': ['Atualizar logistics tracking'],
  'enviado->entregue': ['Emit event order.delivered'],
  'pendente->cancelado': ['Nenhum side-effect'],
  'condicional->cancelado': ['Nenhum side-effect'],
  'confirmado->cancelado': ['Liberar reserva de estoque'],
  'faturado->cancelado': [
    'stock.applyStockOperation(restauracao, items)',
    'Cancelar NF-e (/api/fiscal/cancel)',
    'Marcar Transaction estornada',
  ],
};

export const ORDER_TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set(['entregue', 'cancelado']);

void ORDER_STATUSES;
