'use client';

/**
 * Throttle global compartilhado entre todos os hooks de alerta sonoro
 * (`useNotificationAlerts`, `useConversationsAlerts`).
 *
 * Motivação: cada hook tem seu próprio throttle interno (3s entre rajadas),
 * mas eles operam em coleções diferentes (`notifications` vs
 * `conversations`). Cenário: cliente manda mensagem (incrementa unreadCount)
 * E backend cria simultaneamente uma `notification` de
 * `conversation_assigned`. Cada hook beepa, resultado = 2 beeps em <500ms,
 * irritante.
 *
 * Esse helper faz check+set atômico em module scope. 1.2s é janela curta
 * o bastante pra não suprimir alertas legítimos espaçados, e longa o
 * bastante pra colapsar o cenário acima em 1 beep.
 */

const GLOBAL_THROTTLE_MS = 1200;
let lastBeepAt = 0;

/** Tenta reservar permissão pra beepar. Retorna true se passou (e marca o
 *  slot consumido); false se outro hook tocou nos últimos GLOBAL_THROTTLE_MS. */
export function claimGlobalBeepSlot(): boolean {
  const now = Date.now();
  if (now - lastBeepAt < GLOBAL_THROTTLE_MS) return false;
  lastBeepAt = now;
  return true;
}
