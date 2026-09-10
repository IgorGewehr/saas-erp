import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { returnSaleItemsAdmin, SaleReturnError } from '@/lib/services/sale-return-admin';

/**
 * Devolução parcial autenticada de itens de uma Sale (M02) — mirror de
 * app/api/sales/[id]/cancel/route.ts. Diferente daquele (cancela a venda
 * inteira), aqui `status` nunca muda — a venda continua 'finalizada'.
 */

const BodySchema = z.object({
  businessId: z.string().min(1),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    quantity: z.number().positive(),
  })).min(1, 'Informe ao menos um item pra devolver.'),
  reason: z.string().max(500).optional(),
});

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: saleId } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return error('Sem permissão para devolver itens de venda.', 403);
  }

  const idempotencyKey = request.headers.get('x-idempotency-key') ?? undefined;

  try {
    const result = await returnSaleItemsAdmin({
      db: adminDb,
      saleId,
      businessId: parsed.data.businessId,
      lines: parsed.data.lines,
      reason: parsed.data.reason,
      actor: { id: auth.uid, name: auth.name },
      idempotencyKey,
    });
    return NextResponse.json({
      ok: true,
      data: {
        saleReturn: result.saleReturn,
        stockApplied: result.stockApplied,
        stockAlerts: result.stockAlerts,
        refundTransactionId: result.refundTransactionId,
        replayed: result.replayed,
      },
    });
  } catch (cause) {
    if (cause instanceof SaleReturnError) {
      const status = cause.code === 'TENANT_MISMATCH' ? 403
        : cause.code === 'SALE_NOT_FOUND' || cause.code === 'ITEM_NOT_FOUND' ? 404
          : cause.code === 'FISCAL_DOCUMENT_ISSUED' ? 409
            : cause.code === 'QUANTITY_EXCEEDS_REMAINING' ? 409
              : 400;
      return error(cause.message, status);
    }
    console.error('[sales/return] failed', cause);
    return error('Não foi possível devolver os itens.', 500);
  }
}
