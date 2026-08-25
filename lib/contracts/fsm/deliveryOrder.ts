/**
 * lib/contracts/fsm/deliveryOrder.ts — máquina de estados de DeliveryOrder
 *
 *  recebido ──► preparando ──► pronto ──► saiu_entrega ──► entregue (terminal)
 *     │            │             │              │
 *     └────────────┴─────────────┴──────────────┴──────► cancelado (terminal)
 *
 * Stock deduction acontece em recebido→preparando (commit do pedido).
 * Cancelamento após stock deduction restaura stock.
 *
 * INVARIANTE DE PAGAMENTO (gate X1) — entrega de pedido ONLINE exige pago:
 *   Um pedido ONLINE (paymentProvider==='mercadopago' OU paymentMethod
 *   terminando em '_online') só pode transicionar para 'entregue' quando
 *   paymentFsmStatus==='paid'. A entrega lança receita 'pago' (Transaction
 *   determinística transactions/{orderId}_revenue, CAS em order.transactionId);
 *   lançá-la sem pagamento confirmado contabilizaria dinheiro inexistente.
 *   Dinheiro-na-entrega (não-online) está fora do gate e booka 'pago' na entrega.
 *   O restauro de estoque no cancelamento é idempotente via stockRestoredAt
 *   (não só stockDeductedAt) — após restauro automático (cron/webhook), o
 *   caminho manual é no-op.
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
    'stock.applyStockOperation(saida, items) — set stockDeductedAt',
    'Notificar operador via TeamChat',
  ],
  'preparando->pronto': [
    'Notificar entregador (se deliveryType=entrega)',
    'Notificar cliente (snippet "seu pedido está pronto")',
  ],
  'pronto->saiu_entrega': ['Atualizar deliveryPersonId, deliveryPersonName'],
  'saiu_entrega->entregue': [
    'GATE X1: se pedido ONLINE, exige paymentFsmStatus==="paid" (senão bloqueia)',
    'set deliveredAt',
    'Cria Transaction receita idempotente — ID determinístico {orderId}_revenue + CAS order.transactionId, dentro de runTransaction → set transactionId',
    // TODO(auditoria P1.1/R5): promover a dispatchDomainEvent("deliveryOrder.delivered")
    // quando houver 2+ subscribers (atual: criação inline em OrdersModule + agent tools).
  ],
  'pronto->entregue': [
    'GATE X1: se pedido ONLINE, exige paymentFsmStatus==="paid" (senão bloqueia)',
    'set deliveredAt (retirada no balcão)',
    'Cria Transaction receita idempotente — ID determinístico {orderId}_revenue + CAS order.transactionId, dentro de runTransaction → set transactionId',
  ],
  'recebido->cancelado': ['Nenhum side-effect (stock não foi tocado)'],
  'preparando->cancelado': [
    'stock.applyStockOperation(restauracao, itens + insumos) — CAS idempotente por stockRestoredAt',
    'Notificar cliente',
  ],
  'pronto->cancelado': [
    'stock.applyStockOperation(restauracao, itens + insumos) — CAS idempotente por stockRestoredAt',
    'Notificar cliente',
  ],
};

export const DELIVERY_ORDER_TERMINAL_STATUSES: ReadonlySet<DeliveryOrderStatus> = new Set(['entregue', 'cancelado']);

void DELIVERY_ORDER_STATUSES;
