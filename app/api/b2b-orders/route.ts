import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { CreateOrderBodySchema } from '@/contracts/api/v1/orders';
import { createOrderWithSideEffects, OrderServiceError } from '@/lib/services/order-server';
import { CommercialQuoteError } from '@/lib/services/commercial-quote';

/**
 * Criação autenticada (sessão de usuário) de Order B2B/condicional — M02
 * "tela dedicada" (adiada em M02.6, retomada 10/09/2026). Mirror de
 * app/api/orders/manual/route.ts (DeliveryOrder) e app/api/sales/checkout
 * (Sale). Diferente de POST /api/v1/orders (mesmo schema de corpo,
 * CreateOrderBodySchema), que é Bearer API key — esta rota é pra
 * VendasModule.tsx chamar do browser com o token do usuário logado.
 */

function error(message: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error: message, ...(code ? { code } : {}) }, { status });
}

export async function POST(request: NextRequest) {
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).businessId !== 'string') {
    return error('businessId é obrigatório.', 400);
  }
  const businessId = (raw as { businessId: string }).businessId;

  const parsed = CreateOrderBodySchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para criar pedidos.', 403);
  }

  const isManagerOrAbove = (ROLE_HIERARCHY[auth.role as UserRole] ?? 0) >= ROLE_HIERARCHY.manager;

  try {
    const result = await createOrderWithSideEffects({
      db: adminDb,
      input: {
        ...parsed.data,
        businessId: auth.businessId,
        operatorId: auth.uid,
        operatorName: auth.name,
      },
      context: { canApplyManualDiscount: isManagerOrAbove },
    });
    return NextResponse.json({
      ok: true,
      data: { ...result.order, ...(result.created ? {} : { _idempotent: true }) },
    });
  } catch (cause) {
    // `code` deixa o cliente distinguir STALE_QUOTE (preço mudou → revisar proposta) de falha genérica.
    if (cause instanceof CommercialQuoteError) return error(cause.message, cause.status, cause.code);
    if (cause instanceof OrderServiceError) return error(cause.message, cause.status, cause.code);
    console.error('[b2b-orders] create failed', cause);
    return error('Não foi possível criar o pedido.', 500);
  }
}
