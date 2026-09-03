import { NextResponse } from 'next/server';
import { TableSessionError } from '@/lib/services/table-session-admin';
import { DeliveryOrderTransitionError } from '@/lib/services/delivery-order-transition-admin';

export function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Mapeia erros do núcleo de comanda pra HTTP. */
export function mapTableSessionError(cause: unknown): NextResponse {
  if (cause instanceof TableSessionError) {
    const status = cause.code === 'SESSION_NOT_FOUND' ? 404
      : cause.code === 'TENANT_MISMATCH' ? 403
        : cause.code === 'ALREADY_SETTLED' ? 409
          : 400;
    return jsonError(cause.message, status);
  }
  if (cause instanceof DeliveryOrderTransitionError) {
    const status = cause.code === 'ORDER_NOT_FOUND' ? 404
      : cause.code === 'TENANT_MISMATCH' ? 403
        : cause.code === 'ONLINE_UNPAID' ? 409
          : 400;
    return jsonError(cause.message, status);
  }
  if (cause instanceof Error && cause.message.startsWith('TableSession FSM:')) {
    return jsonError('Transição de comanda inválida.', 409);
  }
  console.error('[table-sessions] failed', cause);
  return jsonError('Não foi possível processar a comanda.', 500);
}
