/**
 * lib/utils/trackingToken.ts
 *
 * Verificação em tempo constante do trackingToken de um DeliveryOrder.
 *
 * O trackingToken é uma capability URL: quem o possui pode acompanhar e pagar
 * SOMENTE o pedido correspondente (cliente anônimo). A comparação usa
 * `timingSafeEqual` para não vazar o token por análise de tempo, e trata
 * ausência/divergência de tamanho como falha — sem lançar exceção.
 */

import { timingSafeEqual } from 'crypto';

/**
 * Retorna true só se `provided` for não-vazio e bater EXATAMENTE com `stored`.
 * Token ausente no pedido (pedidos legados / criados sem token) → sempre false:
 * sem token gravado não há como autorizar acesso anônimo.
 */
export function verifyTrackingToken(
  stored: string | undefined | null,
  provided: string | undefined | null,
): boolean {
  if (!stored || !provided) return false;
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  // timingSafeEqual exige buffers do mesmo tamanho; tamanhos diferentes já
  // significam token errado (curto-circuita sem comparar byte a byte).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
