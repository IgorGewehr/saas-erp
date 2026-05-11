/**
 * lib/contracts/fsm/conversation.ts — FSM de Conversation.status
 *
 *  open ◄──► waiting ──► resolved (reabre via inbound)
 *
 * - open: aguardando ação do operador OU do agente
 * - waiting: agente/operador respondeu, aguardando cliente
 * - resolved: encerrada (manual ou auto após N dias)
 *
 * Inbound novo numa resolved REABRE para open automaticamente.
 */

import { CONVERSATION_STATUSES, type ConversationStatus } from '../domain/conversation';

export const CONVERSATION_TRANSITIONS: Record<ConversationStatus, ReadonlySet<ConversationStatus>> = {
  open:     new Set<ConversationStatus>(['waiting', 'resolved']),
  waiting:  new Set<ConversationStatus>(['open', 'resolved']),
  resolved: new Set<ConversationStatus>(['open']), // reabertura por inbound
};

export function canTransitionConversation(from: ConversationStatus, to: ConversationStatus): boolean {
  return CONVERSATION_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionConversation(from: ConversationStatus, to: ConversationStatus): void {
  if (!canTransitionConversation(from, to)) {
    throw new Error(`Conversation FSM: transição inválida ${from} → ${to}`);
  }
}

export const CONVERSATION_TRANSITION_EFFECTS: Partial<Record<`${ConversationStatus}->${ConversationStatus}`, string[]>> = {
  'open->waiting': [
    'set firstResponseAt se ainda não setado',
    'Calcular SLA breach se aplicável',
  ],
  'waiting->open': [
    'Inbound message chegou — incrementar unreadCount',
    'Emit event conversation.reopened (opcional, se vinha de operador)',
  ],
  'resolved->open': [
    'Inbound após resolve → reabertura automática',
    'Emit event conversation.reopened',
  ],
  'open->resolved': [
    'Emit event conversation.resolved',
    'Snapshot último estado para retenção LGPD',
  ],
  'waiting->resolved': [
    'Emit event conversation.resolved',
  ],
};

export const CONVERSATION_TERMINAL_STATUSES: ReadonlySet<ConversationStatus> = new Set();
// Nenhum estado é absolutamente terminal — `resolved` pode reabrir via inbound

void CONVERSATION_STATUSES;
