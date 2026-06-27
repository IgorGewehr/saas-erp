/**
 * POST /api/integrations/mercadopago/disconnect
 *
 * Desconecta a conta MP do business autenticado. Exige role admin+ dono do
 * business. Apaga os tokens em private/mpAuth e zera as flags públicas
 * (delegado a disconnectMp). businessId vem da sessão (R1).
 */

import { NextRequest } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { ROLE_HIERARCHY } from '@/lib/types';
import type { UserRole } from '@/lib/types';
import { disconnectMp } from '@/lib/services/mercadopago/auth';
import { ok, fail } from '../_response';

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) {
    return fail('UNAUTHORIZED', 'Autenticação obrigatória', 401);
  }
  const role = (auth.role || 'viewer') as UserRole;
  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY['admin']) {
    return fail('FORBIDDEN', 'Apenas admin pode desconectar o Mercado Pago', 403);
  }

  try {
    await disconnectMp(auth.businessId);
  } catch (err) {
    console.error('[mp/disconnect] falhou:', err instanceof Error ? err.message : err);
    return fail('INTERNAL', 'Falha ao desconectar a conta Mercado Pago', 500);
  }

  return ok({ disconnected: true as const });
}
