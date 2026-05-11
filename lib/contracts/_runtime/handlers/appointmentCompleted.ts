/**
 * lib/contracts/_runtime/handlers/appointmentCompleted.ts
 *
 * Handler PILOTO do sistema de eventos. Reage a `appointment.completed`
 * coordenando os side-effects que antes estavam inline em AgendaModule.tsx:
 *
 *   1. Atualizar métricas do cliente (visitCount, lastVisit, totalSpent)
 *   2. (futuro) Criar Transaction de comissão — atualmente em lib/services/commission.ts
 *   3. (futuro) Adicionar loyalty points — atualmente em lib/services/loyalty.ts
 *   4. (futuro) Push update Google Calendar — atualmente em lib/services/calendarSync.ts
 *
 * V1 deste handler implementa apenas (1). Os demais ficam como TODO até que
 * o caller (AgendaModule) seja migrado para dispatch ao invés de chamadas
 * inline (refactor incremental).
 */

import type { DomainEventOf } from '../../events';
import type { DispatchContext } from '../dispatch';

/**
 * MODO AUDITORIA: o handler atual NÃO toca métricas do cliente porque
 * `AgendaModule.syncClientMetrics` (client SDK) já faz isso inline no
 * caminho de save. Duplicar aqui geraria visitCount inflado.
 *
 * Quando migrarmos commission/loyalty/gcalSync para handlers (substituindo
 * as chamadas inline em AgendaModule), as métricas vêm pra cá também e o
 * caller passa a confiar exclusivamente no dispatch. Por ora, este handler
 * existe para:
 *   1. Validar que o evento foi dispatched com shape correto (auditoria
 *      automática via `domainEvents/{id}`).
 *   2. Servir de exemplo concreto para os próximos handlers.
 */
export async function handleAppointmentCompleted(
  event: DomainEventOf<'appointment.completed'>,
  _ctx: DispatchContext,
): Promise<void> {
  // No-op pré-migração — auditoria já fica em `domainEvents/{id}` pelo dispatch.ts.
  console.info(
    `[handler appointment.completed] AUDIT-ONLY businessId=${event.businessId} ` +
    `appointmentId=${event.appointmentId} amount=${event.amount}. ` +
    `Métricas, commission, loyalty e GCal ainda vêm de AgendaModule inline.`,
  );
}
