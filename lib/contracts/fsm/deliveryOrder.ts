/**
 * lib/contracts/fsm/deliveryOrder.ts — máquina de estados de DeliveryOrder
 *
 *  recebido ──► preparando ──► pronto ──► saiu_entrega ──► entregue (terminal)
 *     │            │             │              │
 *     └────────────┴─────────────┴──────────────┴──────► cancelado (terminal)
 *
 * Stock deduction acontece em recebido→preparando (commit do pedido).
 * Cancelamento após stock deduction restaura stock.
 */

import { DELIVERY_ORDER_STATUSES, type DeliveryOrderStatus } from '../domain/deliveryOrder';

export const DELIVERY_ORDER_TRANSITIONS: Record<DeliveryOrderStatus, ReadonlySet<DeliveryOrderStatus>> = {
  recebido:     new Set<DeliveryOrderStatus>(['preparando', 'cancelado']),
  preparando:   new Set<DeliveryOrderStatus>(['pronto', 'cancelado']),
  pronto:       new Set<DeliveryOrderStatus>(['saiu_entrega', 'entregue', 'cancelado']),  // entrega direto se retirada
  saiu_entrega: new Set<DeliveryOrderStatus>(['entregue', 'cancelado']),
  entregue:     new Set<DeliveryOrderStatus>(),
  cancelado:    new Set<DeliveryOrderStatus>(),
};

export function canTransitionDeliveryOrder(from: DeliveryOrderStatus, to: DeliveryOrderStatus): boolean {
  return DELIVERY_ORDER_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionDeliveryOrder(from: DeliveryOrderStatus, to: DeliveryOrderStatus): void {
  if (!canTransitionDeliveryOrder(from, to)) {
    throw new Error(`DeliveryOrder FSM: transição inválida ${from} → ${to}`);
  }
}

export const DELIVERY_ORDER_TRANSITION_EFFECTS: Partial<Record<`${DeliveryOrderStatus}->${DeliveryOrderStatus}`, string[]>> = {
  'recebido->preparando': [
    'stock.deductStock(items) — set stockDeductedAt',
    'Notificar operador via TeamChat',
  ],
  'preparando->pronto': [
    'Notificar entregador (se deliveryType=entrega)',
    'Notificar cliente (snippet "seu pedido está pronto")',
  ],
  'pronto->saiu_entrega': ['Atualizar deliveryPersonId, deliveryPersonName'],
  'saiu_entrega->entregue': [
    'set deliveredAt',
    'Emit event order.delivered → criar Transaction receita',
  ],
  'pronto->entregue': [
    'set deliveredAt (retirada no balcão)',
    'Emit event order.delivered',
  ],
  'recebido->cancelado': ['Nenhum side-effect (stock não foi tocado)'],
  'preparando->cancelado': [
    'stock.restoreStock(items) — clear stockDeductedAt',
    'Notificar cliente',
  ],
  'pronto->cancelado': [
    'stock.restoreStock(items)',
    'Notificar cliente',
  ],
};

export const DELIVERY_ORDER_TERMINAL_STATUSES: ReadonlySet<DeliveryOrderStatus> = new Set(['entregue', 'cancelado']);

void DELIVERY_ORDER_STATUSES;
