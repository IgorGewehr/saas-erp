/**
 * lib/services/order-server.ts
 *
 * Criação server-side de Order (B2B/condicional, M02.6). SERVER-ONLY.
 *
 * Diferente de Sale/DeliveryOrder, a criação de um Order NÃO tem efeitos
 * colaterais (sem dedução de estoque, sem Transaction, sem NF-e) — o próprio
 * FSM (lib/contracts/fsm/order.ts, ORDER_TRANSITION_EFFECTS) documenta que
 * esses efeitos só acontecem depois, na transição `confirmado→faturado`
 * (ver lib/services/order-transition-admin.ts). Por isso este serviço NÃO
 * usa o coordenador de operação comercial (commercial-operation-admin.ts,
 * pensado para quote+efeitos atômicos na MESMA operação) — reusa só a
 * cotação (quoteCommercialCartAdmin, M02.1), que já é `channel:'b2b'`-aware
 * desde que foi construída. Idempotência própria: ID determinístico
 * derivado do carrinho + `tx.create()` (mesmo padrão de
 * transactionTxGuardAdmin.ts) — CAS nativo do Firestore, sem precisar de
 * checkpoint/replay (não há efeito nenhum pra rebobinar).
 */

import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  CreateOrderWithSideEffectsInputSchema,
  type CreateOrderWithSideEffectsInput,
} from '@/contracts/api/services/order-server';
import { quoteCommercialCartAdmin, centsToReais } from '@/lib/services/commercial-quote';
import { CommercialQuoteError } from '@/lib/services/commercial-quote';
import type { Order, OrderItem } from '@/lib/types';

export class OrderServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'OrderServiceError';
  }
}

export interface OrderExecutionContext {
  /** Gerente+ pode aplicar desconto manual (mesmo mecanismo do PDV/delivery). */
  canApplyManualDiscount?: boolean;
  operatorId?: string;
  operatorName?: string;
  now?: () => Date;
}

export interface CreateOrderResult {
  order: Order;
  /** false = replay idempotente, o doc já existia e nada foi escrito de novo. */
  created: boolean;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

/** Ausente do caller ⇒ deriva do próprio conteúdo do carrinho (mesmo padrão
 *  de delivery-order-server.ts). Retry idêntico deduplica; carrinho mudado
 *  vira um pedido novo. */
function deriveIdempotencyKey(input: CreateOrderWithSideEffectsInput): string {
  return hash(JSON.stringify(stable({
    businessId: input.businessId,
    type: input.type,
    clientId: input.clientId,
    clientCpfCnpj: input.clientCpfCnpj,
    items: input.items,
    discount: input.discount,
    paymentTerms: input.paymentTerms,
    installments: input.installments,
    conditionalExpiresAt: input.conditionalExpiresAt,
  }))).slice(0, 40);
}

function deterministicOrderId(businessId: string, idempotencyKey: string): string {
  return `order_${hash(`${businessId}:${idempotencyKey}`).slice(0, 40)}`;
}

export async function createOrderWithSideEffects(params: {
  db?: Firestore;
  input: unknown;
  context: OrderExecutionContext;
}): Promise<CreateOrderResult> {
  const db = params.db ?? adminDb;
  const now = (params.context.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const input = CreateOrderWithSideEffectsInputSchema.parse(params.input);

  const actorId = input.operatorId;
  const actorName = input.operatorName;
  if (!actorId || !actorName) {
    throw new OrderServiceError('OPERATOR_REQUIRED', 'operatorId/operatorName são obrigatórios (identidade do ator autenticado).');
  }

  if (input.clientId) {
    const snapshot = await db.collection('clients').doc(input.clientId).get();
    if (!snapshot.exists) throw new OrderServiceError('CLIENT_NOT_FOUND', 'Cliente não encontrado.', 404);
    if (snapshot.data()?.businessId !== input.businessId) {
      throw new OrderServiceError('TENANT_MISMATCH', 'Cliente pertence a outro negócio.', 403);
    }
  }

  const idempotencyKey = input.idempotencyKey ?? deriveIdempotencyKey(input);
  const orderId = deterministicOrderId(input.businessId, idempotencyKey);
  const orderRef = db.collection('orders').doc(orderId);

  const existing = await orderRef.get();
  if (existing.exists) {
    return { order: { id: existing.id, ...existing.data() } as Order, created: false };
  }

  // ── Cotação autoritativa (preço, variação, estoque) — sem entrega/frete. ──
  const manualDiscountCents = input.discount ? Math.round(input.discount * 100) : 0;
  let quote;
  try {
    quote = await quoteCommercialCartAdmin({
      db,
      input: {
        schemaVersion: 2,
        businessId: input.businessId,
        channel: 'b2b',
        lines: input.items.map((item, index) => ({
          ...item,
          lineId: item.lineId ?? `order-line-${index + 1}`,
        })),
        ...(manualDiscountCents > 0 ? {
          manualDiscount: {
            kind: 'fixed' as const,
            amountCents: manualDiscountCents,
            reason: input.discountReason?.trim() || 'Desconto manual no pedido',
          },
        } : {}),
      },
      canApplyManualDiscount: params.context.canApplyManualDiscount === true,
      quotedAt: now,
    });
  } catch (err) {
    if (err instanceof CommercialQuoteError) {
      throw new OrderServiceError(err.code, err.message, err.status);
    }
    throw err;
  }

  const items: OrderItem[] = quote.lines.map((line) => ({
    ...(line.productId ? { productId: line.productId } : {}),
    ...(line.serviceId ? { serviceId: line.serviceId } : {}),
    ...(line.variantId ? { variantId: line.variantId } : {}),
    productName: line.variantNameSnapshot ? `${line.nameSnapshot} — ${line.variantNameSnapshot}` : line.nameSnapshot,
    ...(line.skuSnapshot ? { sku: line.skuSnapshot } : {}),
    quantity: line.quantity,
    unitPrice: centsToReais(line.unitAmountCents),
    ...(line.discountCents > 0 ? { discount: centsToReais(line.discountCents) } : {}),
    total: centsToReais(line.totalCents),
  }));

  const order: Omit<Order, 'id'> = {
    businessId: input.businessId,
    type: input.type,
    status: 'pendente',
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.clientName ? { clientName: input.clientName } : {}),
    ...(input.clientCpfCnpj ? { clientCpfCnpj: input.clientCpfCnpj } : {}),
    items,
    subtotal: centsToReais(quote.pricing.subtotalCents),
    discount: centsToReais(quote.pricing.discountCents),
    total: centsToReais(quote.pricing.totalCents),
    ...(input.paymentTerms ? { paymentTerms: input.paymentTerms } : {}),
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
    installments: input.installments,
    ...(input.deliveryDate ? { deliveryDate: input.deliveryDate } : {}),
    // lib/types.Order.deliveryAddress usa o tipo Address compartilhado (com
    // codigoMunicipio obrigatório) — mais estrito que o schema de domínio de
    // Order (todos os campos opcionais, ver domain/order.ts). Mesma divergência
    // pré-existente entre o par Zod/hand-written já documentada em outros
    // pontos do módulo; não é escopo desta fatia reconciliar os dois.
    ...(input.deliveryAddress ? { deliveryAddress: input.deliveryAddress as unknown as Order['deliveryAddress'] } : {}),
    ...(input.conditionalExpiresAt ? { conditionalExpiresAt: input.conditionalExpiresAt } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.internalNotes ? { internalNotes: input.internalNotes } : {}),
    statusHistory: [{ status: 'pendente', timestamp: nowIso, userId: actorId, userName: actorName }],
    operatorId: actorId,
    operatorName: actorName,
    ...(input.sectorId ? { sectorId: input.sectorId } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await orderRef.create(order);

  return { order: { id: orderId, ...order } as Order, created: true };
}
