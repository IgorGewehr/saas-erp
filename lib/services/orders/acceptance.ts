/**
 * lib/services/orders/acceptance.ts
 *
 * Guard de aceitação de pedidos: "o negócio pode receber um pedido AGORA?".
 * Antes, esta regra só existia no prompt do agente (planner_system_pedidos), de
 * modo que um POST forjado direto em /api/orders/public criava pedido com a loja
 * FECHADA. Aqui centralizamos a decisão no servidor, reusando o MESMO algoritmo
 * de horário (isBusinessOpenNow) do tool de status do agente.
 *
 * Regra:
 *  - Se aiAgent.pedidos.acceptingOrders === false → loja PAUSADA manualmente:
 *    bloqueia SEMPRE, independente do horário (override manual sobrepõe grade).
 *  - Se aiAgent.pedidos.acceptOrdersOffHours === true → sempre aceita.
 *  - Senão, aceita apenas quando isBusinessOpenNow retorna true.
 *  - Quando a grade de horários é indeterminada (null: sem os 7 dias
 *    configurados), NÃO bloqueia — sem grade não há "fechado" a impor.
 */

import type { Business } from '@/lib/types';
import { isBusinessOpenNow } from '@/lib/utils/businessHours';

/** Erro de guard de horário (mesma forma de PublicOrderError: status + message). */
export class OrdersClosedError extends Error {
  readonly status = 409;
  constructor(message = 'Loja fechada no momento. Tente novamente dentro do horário de funcionamento.') {
    super(message);
    this.name = 'OrdersClosedError';
  }
}

/**
 * Lança OrdersClosedError (409) se o negócio não aceita pedidos neste instante.
 * `now` é injetável para testes determinísticos.
 */
export function assertOrdersAcceptedNow(biz: Pick<Business, 'settings'>, now: Date = new Date()): void {
  const settings = biz.settings;

  // Pausa manual sobrepõe tudo: se a loja foi pausada, bloqueia antes do horário.
  if (settings?.aiAgent?.pedidos?.acceptingOrders === false) {
    throw new OrdersClosedError('Loja pausada no momento.');
  }

  if (settings?.aiAgent?.pedidos?.acceptOrdersOffHours === true) return;

  const tz = settings?.timezone || 'America/Sao_Paulo';
  const open = isBusinessOpenNow(settings?.openingHours, tz, now);
  // open === null → grade indeterminada, não impõe fechamento.
  if (open === false) {
    throw new OrdersClosedError();
  }
}
