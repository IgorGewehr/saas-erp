'use client';

/**
 * Signal global da conversa atualmente aberta no módulo Conversas.
 *
 * Usado pelo `useConversationsAlerts` pra suprimir o beep quando uma msg
 * nova chega numa conversa que o operador já está visualizando — sem isso,
 * o beep tocaria mesmo com a thread aberta na frente do usuário (UX
 * irritante).
 *
 * Module-level state em vez de window object: type-safe, sem polling, sem
 * conflito com TS strict (`window as any` cheira mal). Trade-off conhecido:
 * só funciona dentro da mesma tab — multi-tab dedup já é coberto via
 * localStorage no claimAlertSlot.
 */

let activeConversationId: string | null = null;

export function setActiveConversation(id: string | null): void {
  activeConversationId = id;
}

export function getActiveConversation(): string | null {
  return activeConversationId;
}

/** True se a aba está visível AGORA (foreground). Usado em conjunto com
 *  getActiveConversation pra suprimir beeps redundantes. */
export function isTabVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}
