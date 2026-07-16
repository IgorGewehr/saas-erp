/**
 * GET /api/integrations/mercadopago/status
 *
 * Devolve a projeção PÚBLICA (PaymentAccountPublic — sem tokens) da conta MP do
 * business autenticado, lendo as flags espelhadas em businesses/{id}. Exige só
 * autenticação (qualquer membro do tenant pode consultar o gate de UI).
 */

import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import type { PaymentAccountPublic } from '@/contracts/domain/paymentAccount';
import { ok, fail } from '../_response';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) {
    return fail('UNAUTHORIZED', 'Autenticação obrigatória', 401);
  }

  const snap = await adminDb.collection('businesses').doc(auth.businessId).get();
  const flags = snap.exists ? snap.data() : undefined;

  // Quando desconectado, mpPublicKey pode estar ausente — a projeção pública
  // representa o estado "não conectado" com string vazia (contrato exige
  // mpPublicKey só quando há conta de fato conectada).
  const data: PaymentAccountPublic = {
    mpConnected: Boolean(flags?.mpConnected),
    mpPublicKey: (flags?.mpPublicKey as string | undefined) ?? '',
    mpNeedsReauth: Boolean(flags?.mpNeedsReauth),
    mpLiveMode: Boolean(flags?.mpLiveMode),
  };

  return ok(data);
}
