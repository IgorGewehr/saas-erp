import { type NextRequest, NextResponse } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY, type UserRole } from '@/lib/types';
import { SettleTableSessionBodySchema } from '@/lib/contracts/api/tableSession';
import { settleTableSessionAdmin } from '@/lib/services/table-session-admin';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { jsonError, mapTableSessionError } from '../../_shared';

/**
 * Liquida a comanda (fechada → paga). Chamada pelo PDV logo após o checkout da
 * venda consolidada — recebe o `saleId` da Sale criada. Marca todos os pedidos
 * vinculados como `entregue` com `settledViaSaleId` (sem receita própria).
 * Idempotente: mesma Sale liquidando de novo é no-op.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await request.json().catch(() => null);
  const parsed = SettleTableSessionBodySchema.safeParse(raw);
  if (!parsed.success) return jsonError(`Dados inválidos: ${JSON.stringify(parsed.error.flatten())}`, 400);

  const auth = await verifyAuth(request, parsed.data.businessId);
  if (isAuthError(auth)) return auth;
  if ((ROLE_HIERARCHY[auth.role as UserRole] ?? 0) < ROLE_HIERARCHY.operator) {
    return jsonError('Sem permissão para liquidar mesas.', 403);
  }

  try {
    const result = await settleTableSessionAdmin({
      db: adminDb,
      sessionId: id,
      businessId: parsed.data.businessId,
      saleId: parsed.data.saleId,
      actor: { id: auth.uid, name: auth.name, type: 'user' },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (cause) {
    return mapTableSessionError(cause);
  }
}
