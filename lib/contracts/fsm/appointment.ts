/**
 * lib/contracts/fsm/appointment.ts — máquina de estados de Appointment
 *
 *  agendado ──► confirmado ──► em_andamento ──► concluido ──► cancelado (reversão)
 *      │            │               │
 *      ├────────────┴───────────────┴──────────► cancelado     (terminal)
 *      └────────────┴───────────────┴──────────► nao_compareceu (terminal)
 *
 * Regra de negócio crítica (P1.9 / P2.16): só `em_andamento → concluido`
 * (ou `confirmado → concluido`, atendimento que pulou o check-in) deve gerar
 * comissão. Permitir `agendado → concluido` sem passar por confirmado/em_andamento
 * abre brecha para comissão indevida — por isso `agendado` NÃO transiciona direto
 * para `concluido` aqui. A criação de comissão atrelada à transição vive como
 * side-effect (ver APPOINTMENT_TRANSITION_EFFECTS), fora desta FSM.
 *
 * `concluido → cancelado` é a ÚNICA saída permitida de `concluido` — reversão de
 * conclusão indevida (operador marcou como feito por engano). Já era o
 * comportamento real de `AgendaModule.tsx` (handleCancelAppointment/
 * handleDeleteAppointment gravavam `cancelado` direto sobre um `concluido`,
 * sem checar FSM); a declaração aqui só reconhece formalmente o que já
 * acontecia, pra `transitionAppointmentAdmin` (M06.2) não bloquear uma
 * capacidade que a Agenda já oferece. Efeitos de conclusão são revertidos via
 * `appointment.canceled` (idempotente por `completionAppliedAt`).
 *
 * Estados terminais de verdade: cancelado, nao_compareceu. `concluido` é
 * quase-terminal — só reverte, nunca segue adiante (não vai a
 * `nao_compareceu`, por exemplo).
 */

import { APPOINTMENT_STATUSES, type AppointmentStatus } from '../domain/appointment';

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, ReadonlySet<AppointmentStatus>> = {
  agendado:       new Set<AppointmentStatus>(['confirmado', 'em_andamento', 'cancelado', 'nao_compareceu']),
  confirmado:     new Set<AppointmentStatus>(['em_andamento', 'concluido', 'cancelado', 'nao_compareceu']),
  em_andamento:   new Set<AppointmentStatus>(['concluido', 'cancelado']),
  concluido:      new Set<AppointmentStatus>(['cancelado']), // só reversão
  cancelado:      new Set<AppointmentStatus>(), // terminal
  nao_compareceu: new Set<AppointmentStatus>(), // terminal
};

export function canTransitionAppointment(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return APPOINTMENT_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionAppointment(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!canTransitionAppointment(from, to)) {
    throw new Error(`Appointment FSM: transição inválida ${from} → ${to}`);
  }
}

/** Side-effects esperados por transição. Documentação para emitir eventos cross-módulo. */
export const APPOINTMENT_TRANSITION_EFFECTS: Partial<Record<`${AppointmentStatus}->${AppointmentStatus}`, string[]>> = {
  'confirmado->concluido': [
    'Emit event appointment.completed → criar Transaction de comissão (idempotente via commissionTransactionId)',
    'loyalty.addPoints (se settings.loyalty.isEnabled)',
    'GCal: marcar como realizado / sync',
  ],
  'em_andamento->concluido': [
    'Emit event appointment.completed → criar Transaction de comissão (idempotente via commissionTransactionId)',
    'loyalty.addPoints (se settings.loyalty.isEnabled)',
    'GCal: marcar como realizado / sync',
  ],
  'agendado->cancelado': ['Liberar slot/vaga da turma (sessionKey)', 'GCal: deletar evento'],
  'confirmado->cancelado': ['Liberar slot/vaga da turma', 'GCal: deletar evento', 'NoShowPolicy se aplicável'],
  'em_andamento->cancelado': ['Liberar slot/vaga', 'Estornar comissão se já criada (commissionTransactionId)'],
  'concluido->cancelado': ['Emit event appointment.canceled → reverter comissão/fidelidade/métricas se completionAppliedAt confirmar que foram aplicados', 'Liberar slot/vaga da turma (sessionKey)'],
  'agendado->nao_compareceu': ['NoShowPolicy: cobrança/penalidade se aplicável'],
  'confirmado->nao_compareceu': ['NoShowPolicy: cobrança/penalidade se aplicável'],
};

export const APPOINTMENT_TERMINAL_STATUSES: ReadonlySet<AppointmentStatus> = new Set([
  'concluido', 'cancelado', 'nao_compareceu',
]);

void APPOINTMENT_STATUSES;
