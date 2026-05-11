/**
 * lib/contracts/_template/FSM_TEMPLATE.ts
 *
 * Template para declarar máquinas de estado.
 * Copie para lib/contracts/fsm/{entity}.ts.
 *
 * Para cada entidade com `status: string` largo (Sale, Order, Appointment,
 * FiscalDocument, Conversation, Broadcast), declare as transições válidas aqui
 * e use canTransition() antes de updateDoc().
 */

import { ENTITY_STATUSES, type EntityStatus } from '../domain/ENTITY_TEMPLATE';

/**
 * Mapa: status atual → set de status para os quais é VÁLIDO transitar.
 * Estados terminais (sem saída) mapeiam para set vazio.
 */
export const ENTITY_TRANSITIONS: Record<EntityStatus, ReadonlySet<EntityStatus>> = {
  rascunho: new Set(['ativo', 'arquivado']),
  ativo: new Set(['arquivado']),
  arquivado: new Set(), // terminal
};

export function canTransition(from: EntityStatus, to: EntityStatus): boolean {
  return ENTITY_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransition(from: EntityStatus, to: EntityStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Transição inválida: ${from} → ${to}`);
  }
}

/**
 * Side-effects esperados por transição (documentação, não execução).
 * Use isso para identificar quais eventos cross-módulo precisam ser emitidos.
 */
export const ENTITY_TRANSITION_EFFECTS: Partial<Record<`${EntityStatus}->${EntityStatus}`, string[]>> = {
  'rascunho->ativo': [
    'Emitir evento entity.activated',
    'Index para busca',
  ],
  'ativo->arquivado': [
    'Emitir evento entity.archived',
    'Remove de índices de busca',
  ],
};
