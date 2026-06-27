/**
 * lib/services/mercadopago/client.ts
 *
 * Cliente HTTP base para a API do Mercado Pago. SERVER-ONLY.
 *
 * Centraliza baseUrl, headers (Bearer = access_token do VENDEDOR), parse de erro
 * tipado e timeout. Nenhum segredo é logado: em erro guardamos só status + corpo
 * truncado da resposta do MP (que não contém tokens nossos).
 *
 * Não confunde os dois "tokens":
 *   - Bearer das chamadas /v1/payments etc. = access_token do tenant (vendedor).
 *   - As chamadas /oauth/token usam client_id/client_secret do APP (env), sem Bearer.
 */

import { PaymentFsmStatusSchema, type PaymentFsmStatus } from '@/contracts/fsm/payment';

export const MP_API_BASE = 'https://api.mercadopago.com';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Erro tipado de qualquer chamada à API do MP. Carrega status HTTP + payload. */
export class MercadoPagoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'MercadoPagoApiError';
  }
}

export interface MpFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** access_token do vendedor (Bearer). Omitir para chamadas OAuth. */
  accessToken?: string;
  body?: unknown;
  /** Valor de X-Idempotency-Key — POSTs de pagamento devem mandar um fresco. */
  idempotencyKey?: string;
  timeoutMs?: number;
  /** Headers extras (raros). */
  headers?: Record<string, string>;
}

/**
 * Faz uma chamada à API do MP e devolve o JSON parseado. Lança
 * MercadoPagoApiError em status >= 400 ou timeout.
 */
export async function mpFetch<T = unknown>(path: string, opts: MpFetchOptions = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${MP_API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
    ...(opts.idempotencyKey ? { 'X-Idempotency-Key': opts.idempotencyKey } : {}),
    ...opts.headers,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new MercadoPagoApiError(`[MercadoPago] network/timeout em ${path}: ${reason}`, 0, null);
  }

  const raw = await res.text();
  let parsed: unknown = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  }

  if (!res.ok) {
    const detail =
      (parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message?: unknown }).message)
        : typeof parsed === 'string'
          ? parsed.slice(0, 300)
          : res.statusText) || 'erro';
    throw new MercadoPagoApiError(
      `[MercadoPago] ${opts.method ?? 'GET'} ${path} → HTTP ${res.status}: ${detail}`,
      res.status,
      parsed,
    );
  }

  return parsed as T;
}

/**
 * Mapeia o `status` de um payment do MP para o estado da FSM de dinheiro.
 * Estados intermediários do cartão (pending/in_process) viram 'pending'.
 */
export function mapMpStatusToFsm(mpStatus: string): PaymentFsmStatus {
  switch (mpStatus) {
    case 'approved':
      return 'paid';
    case 'authorized':
      return 'authorized';
    case 'in_process':
    case 'pending':
      return 'pending';
    case 'rejected':
      return 'failed';
    case 'cancelled':
      return 'failed';
    case 'refunded':
    case 'charged_back':
      return 'refunded';
    default:
      // Estado desconhecido: trata como pendente (não decide dinheiro sozinho).
      return PaymentFsmStatusSchema.parse('pending');
  }
}
