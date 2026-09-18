import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { SettleTransactionBodySchema } from '@/contracts/api/transactions/settle';
import {
  settleReceivableAdmin,
  TransactionNotFoundError,
  TransactionTenantMismatchError,
  TransactionNotReceivableError,
  TransactionInvalidTransitionError,
} from '@/lib/services/transactionTxGuardAdmin';

/**
 * Registra o recebimento de uma receita pendente (ex.: parcela de pedido B2B
 * faturado) — usado pela Vitrine. Manager+, igual às rules de `transactions`.
 * Repetir numa receita já paga é no-op (200, `alreadySettled: true`).
 */

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: transactionId } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = SettleTransactionBodySchema.safeParse(raw);
  if (!parsed.success) {
    return error(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);
  }

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.manager) {
    return error('Sem permissão para registrar recebimentos.', 403);
  }

  try {
    const { transaction, alreadySettled } = await settleReceivableAdmin({
      db: adminDb,
      transactionId,
      businessId: auth.businessId,
      paymentDate: parsed.data.paymentDate ?? new Date().toISOString().split('T')[0],
      paymentMethod: parsed.data.paymentMethod,
    });
    return NextResponse.json({
      ok: true,
      data: {
        id: transaction.id,
        status: 'pago' as const,
        ...(transaction.paymentDate ? { paymentDate: transaction.paymentDate } : {}),
        ...(transaction.paymentMethod ? { paymentMethod: transaction.paymentMethod } : {}),
        alreadySettled,
      },
    });
  } catch (cause) {
    // Tenant divergente responde 404 (não 403) pra não confirmar que o id existe em outro negócio.
    if (cause instanceof TransactionNotFoundError || cause instanceof TransactionTenantMismatchError) {
      return error('Lançamento não encontrado.', 404);
    }
    if (cause instanceof TransactionNotReceivableError) return error(cause.message, 422);
    if (cause instanceof TransactionInvalidTransitionError) {
      return error('Este lançamento não pode mais ser marcado como recebido.', 409);
    }
    console.error('[transactions/settle] failed', cause);
    return error('Não foi possível registrar o recebimento.', 500);
  }
}
