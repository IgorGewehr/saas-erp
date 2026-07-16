/**
 * lib/contracts/fsm/cashSession.ts — máquina de estados de CashSession (sessão de caixa/gaveta)
 *
 *   aberta ──► fechada   (terminal — v1 não reabre; pra corrigir um fechamento
 *                         errado, abra uma sessão nova e explique na próxima).
 *
 * Só uma transição existe hoje. O ganho de ter FSM mesmo com 1 aresta (R4) é
 * nomear o estado terminal e travar qualquer futuro "fechada → aberta" sem
 * decisão explícita de produto (reabertura mudaria a matemática de sobra/falta
 * já congelada no doc).
 */

import { CASH_SESSION_STATUSES, type CashSessionStatus } from '../domain/cashSession';

export const CASH_SESSION_TRANSITIONS: Record<CashSessionStatus, ReadonlySet<CashSessionStatus>> = {
  aberta: new Set<CashSessionStatus>(['fechada']),
  fechada: new Set<CashSessionStatus>(), // terminal
};

export function canTransitionCashSession(from: CashSessionStatus, to: CashSessionStatus): boolean {
  return CASH_SESSION_TRANSITIONS[from]?.has(to) ?? false;
}

export function assertTransitionCashSession(from: CashSessionStatus, to: CashSessionStatus): void {
  if (!canTransitionCashSession(from, to)) {
    throw new Error(`CashSession FSM: transição inválida ${from} → ${to}`);
  }
}

export const CASH_SESSION_TERMINAL_STATUSES: ReadonlySet<CashSessionStatus> = new Set(['fechada']);

void CASH_SESSION_STATUSES;
