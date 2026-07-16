/**
 * lib/utils/businessHours.ts
 *
 * Helper PURO e determinístico para "o negócio está aberto AGORA?" conforme a
 * grade de openingHours (7 dias) no timezone do business. Fonte única — extraído
 * de app/api/agent/tools/business/route.ts pra que o tool de status e o
 * guardrail de pedidos off-hours compartilhem o MESMO algoritmo.
 */

import type { BusinessHoursDay } from '@/lib/types';

/**
 * Retorna true/false se o business está aberto no instante `now` segundo a grade
 * semanal `hours` no `timezone` dado. Retorna `null` quando a grade não tem os 7
 * dias (indeterminado — o caller decide o que fazer com a ausência de config).
 */
export function isBusinessOpenNow(
  hours: BusinessHoursDay[] | undefined | null,
  timezone = 'America/Sao_Paulo',
  now: Date = new Date(),
): boolean | null {
  if (!hours || hours.length !== 7) return null;
  // Converte "agora" pro relógio de parede do timezone do business.
  const tzNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const dow = tzNow.getDay();
  const hm = `${String(tzNow.getHours()).padStart(2, '0')}:${String(tzNow.getMinutes()).padStart(2, '0')}`;
  const today = hours[dow];
  if (today?.isOpen && today.openTime && today.closeTime) {
    return hm >= today.openTime && hm < today.closeTime;
  }
  return false;
}
