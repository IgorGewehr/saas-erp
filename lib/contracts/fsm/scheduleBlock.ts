/**
 * lib/contracts/fsm/scheduleBlock.ts — máquina de estados de ScheduleBlock
 *
 *  ativo ──► cancelado (terminal)
 *
 * Sem efeitos colaterais de dinheiro/estoque atrelados à transição — cancelar
 * um bloqueio não reverte nem cancela agendamentos que caiam no intervalo
 * (decisão deliberada, ver docs/agenda/AGENDA_BLOQUEIOS.md). Por isso não há
 * `SCHEDULE_BLOCK_TRANSITION_EFFECTS` como em `fsm/appointment.ts`.
 */

import { type ScheduleBlockStatus } from '../domain/scheduleBlock';

export const SCHEDULE_BLOCK_TRANSITIONS: Record<ScheduleBlockStatus, ReadonlySet<ScheduleBlockStatus>> = {
  ativo: new Set<ScheduleBlockStatus>(['cancelado']),
  cancelado: new Set<ScheduleBlockStatus>(), // terminal
};

export function canTransitionScheduleBlock(from: ScheduleBlockStatus, to: ScheduleBlockStatus): boolean {
  return SCHEDULE_BLOCK_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionScheduleBlock(from: ScheduleBlockStatus, to: ScheduleBlockStatus): void {
  if (!canTransitionScheduleBlock(from, to)) {
    throw new Error(`ScheduleBlock FSM: transição inválida ${from} → ${to}`);
  }
}
