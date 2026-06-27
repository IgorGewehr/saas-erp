/**
 * app/api/integrations/mercadopago/_response.ts
 *
 * Helpers de envelope `{ ok, data, error }` para as rotas de integração MP.
 * Espelha o shape de _envelope (successEnvelope/ErrorEnvelopeSchema). Não é
 * route file (prefixo `_`).
 */

import { NextResponse } from 'next/server';
import type { ErrorCode } from '@/contracts/api/_envelope';

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true as const, data }, { status });
}

export function fail(
  code: ErrorCode,
  message: string,
  status: number,
  extra?: { details?: unknown; retryable?: boolean; retryAfterMs?: number },
): NextResponse {
  return NextResponse.json(
    { ok: false as const, error: { code, message, ...extra } },
    { status },
  );
}
