/**
 * lib/services/mercadopago/webhookSignature.ts
 *
 * Verificação de assinatura `x-signature` do Mercado Pago (Webhooks v2) —
 * extraído de app/api/webhooks/mercadopago/route.ts pra ser reaproveitado
 * também por app/api/webhooks/mercadopago-platform/route.ts (M12). Mesmo
 * algoritmo, secret diferente por rota (cada uma configurada num contexto
 * de app/conta MP distinto no painel).
 */

import crypto from 'node:crypto';

/** Janela anti-replay: o ts assinado pelo MP não pode divergir > 5min do relógio. */
export const MP_WEBHOOK_MAX_TS_SKEW_MS = 5 * 60 * 1000;

export interface ParsedMpSignature {
  /** epoch em segundos (string original do header). */
  ts: string;
  /** HMAC-SHA256 hex (parte v1). */
  v1: string;
}

/**
 * Parseia o header `x-signature` no formato `ts=<epoch>,v1=<hash hex>`.
 * Retorna null se faltar `ts` ou `v1`.
 */
export function parseMpXSignature(header: string | null): ParsedMpSignature | null {
  if (!header) return null;
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'v1') v1 = value;
  }
  if (!ts || !v1) return null;
  return { ts, v1 };
}

/**
 * Verifica a assinatura do MP (FAIL-CLOSED).
 *
 * Manifest assinado (dinâmico — só inclui segmentos presentes), na ordem:
 *   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 * `data.id` alfanumérico vai em minúsculas (regra do MP). HMAC-SHA256 hex
 * comparado em tempo constante com o `v1` do header.
 */
export function verifyMpSignature(opts: {
  secret: string;
  sig: ParsedMpSignature;
  dataId: string | null;
  requestId: string | null;
}): boolean {
  const { secret, sig, dataId, requestId } = opts;

  const segments: string[] = [];
  if (dataId) segments.push(`id:${dataId.toLowerCase()};`);
  if (requestId) segments.push(`request-id:${requestId};`);
  segments.push(`ts:${sig.ts};`);
  const manifest = segments.join('');

  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig.v1, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** true se `ts` (epoch em segundos, string) ainda está dentro da janela anti-replay. */
export function isWithinMpReplayWindow(ts: string): boolean {
  const tsMs = Number(ts) * 1000;
  return Number.isFinite(tsMs) && Math.abs(Date.now() - tsMs) <= MP_WEBHOOK_MAX_TS_SKEW_MS;
}
