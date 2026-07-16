/**
 * lib/services/mercadopago/gateway.ts
 *
 * Resolve o estado do gateway de pagamento (Mercado Pago) de um tenant para
 * gates de UI e de checkout. SERVER-ONLY (Admin SDK).
 *
 * IMPORTANTE: erro REAL (falha de Firestore, etc.) é RELANÇADO — não degradamos
 * silenciosamente para "desconectado", pois isso esconderia incidentes e faria
 * o checkout sumir sem causa visível. Só doc ausente = desconectado.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import type { PaymentAccount } from '@/contracts/domain/paymentAccount';

export interface PaymentGatewayState {
  connected: boolean;
  mpPublicKey: string | null;
  capabilities: { pix: boolean; card: boolean };
}

export async function resolvePaymentGateway(businessId: string): Promise<PaymentGatewayState> {
  const snap = await adminDb
    .collection('businesses')
    .doc(businessId)
    .collection('private')
    .doc('mpAuth')
    .get();

  if (!snap.exists) {
    return { connected: false, mpPublicKey: null, capabilities: { pix: false, card: false } };
  }

  const account = snap.data() as PaymentAccount;
  const connected = !!account.mpConnected && !account.mpNeedsReauth;

  return {
    connected,
    mpPublicKey: account.mpPublicKey ?? null,
    // MP suporta PIX e cartão; PIX ainda depende de chave na conta do vendedor,
    // o que só se confirma ao criar a cobrança (pix.ts trata QR ausente).
    capabilities: { pix: connected, card: connected },
  };
}
