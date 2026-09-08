import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import { parseToolRequest, validateToolResponse, isContractError } from '@/contracts/_runtime/agentToolValidation';
import { createOrderWithSideEffects, OrderServiceError } from '@/lib/services/order-server';
import { CommercialQuoteError } from '@/lib/services/commercial-quote';
import type { Order } from '@/lib/types';

type Action = 'create' | 'get' | 'list_by_client';

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (err) {
    const resp = agentAuthErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  const rawBody = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  let action: Action;
  let params: Record<string, unknown>;
  try {
    const parsed = parseToolRequest('b2b-orders', rawBody);
    action = parsed.action as Action;
    params = parsed.params as Record<string, unknown>;
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: 400 });
    }
    throw err;
  }

  try {
    let data: unknown;
    switch (action) {
      case 'create':
        data = await createB2bOrder(businessId, params);
        break;
      case 'get':
        data = await getOrder(businessId, params.id as string);
        break;
      case 'list_by_client':
        data = await listByClient(businessId, params.clientId as string, (params.limit as number) || 10);
        break;
      default: {
        const exhaustiveCheck: never = action;
        return NextResponse.json({ ok: false, error: `Unknown action: ${exhaustiveCheck}` }, { status: 400 });
      }
    }

    const validated = validateToolResponse('b2b-orders', action, data);
    return NextResponse.json({ ok: true, data: validated });
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: err.code === 'INTERNAL' ? 500 : 400 });
    }
    if (err instanceof CommercialQuoteError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    if (err instanceof OrderServiceError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('[agent/tools/b2b-orders]', action, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ─── Implementations ─────────────────────────────────────────────────────────

interface CreateParams {
  type: 'b2b' | 'condicional';
  clientId?: string;
  clientName?: string;
  clientCpfCnpj?: string;
  items: Array<{ productId?: string; serviceId?: string; variantId?: string; quantity: number; notes?: string }>;
  paymentTerms?: string;
  installments?: number;
  conditionalExpiresAt?: string;
  notes?: string;
  conversationId?: string;
}

async function createB2bOrder(businessId: string, rawParams: Record<string, unknown>) {
  const params = rawParams as unknown as CreateParams;
  const result = await createOrderWithSideEffects({
    db: adminDb,
    input: {
      businessId,
      type: params.type,
      clientId: params.clientId,
      clientName: params.clientName,
      clientCpfCnpj: params.clientCpfCnpj,
      items: params.items,
      paymentTerms: params.paymentTerms,
      installments: params.installments ?? 1,
      conditionalExpiresAt: params.conditionalExpiresAt,
      notes: params.notes,
      operatorId: 'agent',
      operatorName: 'Agente de IA',
      // Escopa a idempotência por conversa — retries do mesmo tool-call na
      // mesma conversa convergem pro mesmo pedido (mesmo espírito do
      // agent-order_ do tool `orders`, sem precisar do wrapper withIdempotency
      // porque createOrderWithSideEffects já é idempotente por conteúdo).
      ...(params.conversationId ? { idempotencyKey: `agent-b2b-order_${params.conversationId}` } : {}),
    },
    context: { canApplyManualDiscount: false },
  });
  return {
    id: result.order.id,
    status: result.order.status,
    subtotal: result.order.subtotal,
    discount: result.order.discount,
    total: result.order.total,
  };
}

async function getOrder(businessId: string, id: string): Promise<Order | null> {
  if (!id) throw new Error('id required');
  const snap = await adminDb.collection('orders').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as Order;
  if (data.businessId !== businessId) return null;
  return { ...data, id: snap.id };
}

async function listByClient(businessId: string, clientId: string, limit: number) {
  if (!clientId) throw new Error('clientId required');
  const snap = await adminDb
    .collection('orders')
    .where('businessId', '==', businessId)
    .where('clientId', '==', clientId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}
