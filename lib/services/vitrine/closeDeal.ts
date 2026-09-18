/**
 * lib/services/vitrine/closeDeal.ts
 *
 * "Fechar negócio" na Vitrine = criar o pedido B2B, confirmar e faturar. São 3 chamadas
 * separadas e NÃO atômicas: se a última falha (ex.: sem saldo), o pedido já existe.
 * A retomada é por STATUS — o POST de criação é idempotente (mesma chave ⇒ devolve o
 * pedido existente, com o status de agora), então "tentar de novo" só reexecuta a
 * partir do que o servidor diz, sem recriar nem duplicar recebível.
 *
 * Consequência que a UI respeita: depois que existe pedido (`orderId` no erro) a proposta
 * fica travada — editá-la e reenviar com a MESMA chave devolveria o pedido antigo, com o
 * conteúdo antigo. Pra editar, cancela o pedido (`cancelDeal`) e começa com chave nova.
 */

import { z } from 'zod';
import { OrderStatusSchema } from '@/contracts/domain/order';
import type { StockAlert } from '@/lib/types';
import type { CreateOrderRequestBody } from '@/lib/utils/vitrineProposal';
import type { ApiRequest, ApiResult } from './apiClient';

export type CloseDealStep = 'create' | 'confirm' | 'invoice';

export type CloseDealResult =
  | { status: 'done'; orderId: string; total: number; transactionIds: string[]; stockAlerts: StockAlert[] }
  /** O preço do catálogo mudou desde a negociação — recalcular a proposta; nenhum pedido foi criado. */
  | { status: 'stale'; message: string }
  | { status: 'error'; message: string; orderId?: string; retryable: boolean };

const OrderSnapshotSchema = z.object({
  id: z.string().min(1),
  status: OrderStatusSchema,
  total: z.number(),
  transactionIds: z.array(z.string()).optional(),
});

const InvoiceResponseSchema = z.object({
  transactionIds: z.array(z.string()).default([]),
  stockAlerts: z.array(z.custom<StockAlert>()).default([]),
});

type Failure = Extract<ApiResult, { ok: false }>;

/** Erro que repetir a mesma chamada pode resolver: rede, servidor, limite de taxa e falta de saldo
 *  (o vendedor repõe o estoque e tenta de novo). O resto (permissão, dado inválido) não muda sozinho. */
function isRetryable(failure: Failure): boolean {
  return failure.status === 0
    || failure.status === 429
    || failure.status >= 500
    || failure.code === 'INSUFFICIENT_STOCK';
}

function fail(failure: Failure, orderId?: string): CloseDealResult {
  return {
    status: 'error',
    message: failure.error,
    ...(orderId ? { orderId } : {}),
    retryable: isRetryable(failure),
  };
}

const UNEXPECTED_RESPONSE = 'Resposta inesperada do servidor. Confira o pedido no módulo Vendas.';

async function transition(
  request: ApiRequest,
  businessId: string,
  orderId: string,
  status: 'confirmado' | 'faturado' | 'cancelado',
): Promise<ApiResult> {
  return request(`/api/b2b-orders/${encodeURIComponent(orderId)}/transition`, {
    method: 'PATCH',
    body: { businessId, status },
  });
}

export async function closeDeal(params: {
  businessId: string;
  body: CreateOrderRequestBody;
  request: ApiRequest;
  onStep?: (step: CloseDealStep) => void;
}): Promise<CloseDealResult> {
  const { businessId, body, request, onStep } = params;

  onStep?.('create');
  const created = await request('/api/b2b-orders', { method: 'POST', body });
  if (!created.ok) {
    if (created.code === 'STALE_QUOTE') {
      return { status: 'stale', message: 'O valor do catálogo mudou desde a negociação. Revise a proposta.' };
    }
    return fail(created);
  }

  const order = OrderSnapshotSchema.safeParse(created.data);
  if (!order.success) return { status: 'error', message: UNEXPECTED_RESPONSE, retryable: false };

  const orderId = order.data.id;
  let status = order.data.status;
  let transactionIds = order.data.transactionIds ?? [];
  let stockAlerts: StockAlert[] = [];

  if (status === 'cancelado') {
    return { status: 'error', message: 'Este pedido foi cancelado. Monte uma nova proposta.', orderId, retryable: false };
  }

  if (status === 'pendente') {
    onStep?.('confirm');
    const confirmed = await transition(request, businessId, orderId, 'confirmado');
    if (!confirmed.ok) return fail(confirmed, orderId);
    status = 'confirmado';
  }

  if (status === 'confirmado') {
    onStep?.('invoice');
    const invoiced = await transition(request, businessId, orderId, 'faturado');
    if (!invoiced.ok) return fail(invoiced, orderId);
    const parsed = InvoiceResponseSchema.safeParse(invoiced.data);
    if (!parsed.success) return { status: 'error', message: UNEXPECTED_RESPONSE, orderId, retryable: false };
    transactionIds = parsed.data.transactionIds;
    stockAlerts = parsed.data.stockAlerts;
    status = 'faturado';
  }

  if (status === 'faturado' || status === 'enviado' || status === 'entregue') {
    return { status: 'done', orderId, total: order.data.total, transactionIds, stockAlerts };
  }

  // `condicional` não é criado pela Vitrine; se aparecer, o pedido segue na tela de Vendas.
  return {
    status: 'error',
    message: `O pedido está em "${status}" e não pode ser fechado por aqui. Abra-o no módulo Vendas.`,
    orderId,
    retryable: false,
  };
}

/** Descarta um pedido que ficou a meio caminho (criado/confirmado, não faturado) pra liberar a edição. */
export async function cancelDeal(params: {
  businessId: string;
  orderId: string;
  request: ApiRequest;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await transition(params.request, params.businessId, params.orderId, 'cancelado');
  return result.ok ? { ok: true } : { ok: false, message: result.error };
}

export type SettleResult =
  | { ok: true; alreadySettled: boolean }
  | { ok: false; message: string };

export async function settleReceivable(params: {
  businessId: string;
  transactionId: string;
  paymentMethod: 'dinheiro' | 'pix' | 'credito' | 'debito' | 'boleto' | 'outros';
  /** Data local do tablet (AAAA-MM-DD) — o servidor só sabe a data UTC. */
  paymentDate: string;
  request: ApiRequest;
}): Promise<SettleResult> {
  const result = await params.request(`/api/transactions/${encodeURIComponent(params.transactionId)}/settle`, {
    method: 'POST',
    body: { businessId: params.businessId, paymentMethod: params.paymentMethod, paymentDate: params.paymentDate },
  });
  if (!result.ok) return { ok: false, message: result.error };
  const alreadySettled = (result.data as { alreadySettled?: unknown } | null)?.alreadySettled === true;
  return { ok: true, alreadySettled };
}
