/**
 * lib/services/platformBilling/subscriptionAdmin.ts
 *
 * Cobrança recorrente do PRÓPRIO SaaS (M12) — o dono de cada tenant pagando
 * esta plataforma via Mercado Pago. SERVER-ONLY (Admin SDK).
 *
 * Usa a MESMA conta Mercado Pago da plataforma (MP_PLATFORM_ACCESS_TOKEN,
 * env var global — não OAuth, é a sua própria conta) pra toda business,
 * bem diferente da integração MP per-tenant (cada tenant conecta a PRÓPRIA
 * conta via OAuth pra cobrar os PRÓPRIOS clientes — ver
 * lib/services/mercadopago/auth.ts). Reaproveita o cliente HTTP de baixo
 * nível (mpFetch) trocando só o token.
 *
 * Fluxo de checkout: POST /preapproval SEM card_token_id/status → MP devolve
 * um link de checkout hospedado (init_point). O dono do tenant paga lá —
 * nenhum dado de cartão passa pela nossa infra.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import { mpFetch, MercadoPagoApiError } from '@/lib/services/mercadopago/client';
import { PLATFORM_SUBSCRIPTION_PLAN } from '@/lib/constants/platformBilling';
import {
  assertTransitionPlatformSubscription,
  type PlatformSubscriptionStatus,
} from '@/lib/contracts/fsm/platformSubscription';
import type { PlatformSubscription } from '@/lib/contracts/domain/platformSubscription';

function platformAccessToken(): string {
  const token = process.env.MP_PLATFORM_ACCESS_TOKEN;
  if (!token) throw new Error('MP_PLATFORM_ACCESS_TOKEN não configurada');
  return token;
}

interface MpPreapprovalResponse {
  id: string;
  status: string;
  init_point?: string;
}

export interface CreateSubscriptionCheckoutResult {
  checkoutUrl: string;
  status: PlatformSubscriptionStatus;
  /** true = já existia um checkout/assinatura pendente ou ativa; nada novo
   *  foi criado no MP (evita preapproval duplicado — R3 como invariante de
   *  negócio, não header de idempotência). */
  alreadyExisted: boolean;
}

/**
 * Gera (ou reaproveita) um link de checkout pra um business assinar o plano
 * único da plataforma. Idempotente por construção: se já existe um
 * documento `pending_payment` (checkout ainda não completado) ou `active`,
 * devolve o que já existe em vez de criar um preapproval novo no MP.
 */
export async function createSubscriptionCheckout(businessId: string, backUrl: string): Promise<CreateSubscriptionCheckoutResult> {
  const ref = adminDb.collection('platformSubscriptions').doc(businessId);
  const existing = await ref.get();
  if (existing.exists) {
    const data = existing.data() as PlatformSubscription;
    if ((data.status === 'pending_payment' || data.status === 'active') && data.checkoutUrl) {
      return { checkoutUrl: data.checkoutUrl, status: data.status, alreadyExisted: true };
    }
  }

  const businessSnap = await adminDb.collection('businesses').doc(businessId).get();
  if (!businessSnap.exists) throw new Error(`Business ${businessId} não encontrada`);
  const business = businessSnap.data() as { email?: string; razaoSocial?: string; nomeFantasia?: string };
  const payerEmail = business.email;
  if (!payerEmail) throw new Error(`Business ${businessId} não tem e-mail cadastrado`);

  const plan = PLATFORM_SUBSCRIPTION_PLAN;
  const now = new Date().toISOString();

  const mpResponse = await mpFetch<MpPreapprovalResponse>('/preapproval', {
    method: 'POST',
    accessToken: platformAccessToken(),
    body: {
      reason: plan.reason,
      external_reference: businessId,
      payer_email: payerEmail,
      back_url: backUrl,
      auto_recurring: {
        frequency: plan.frequency,
        frequency_type: plan.frequencyType,
        transaction_amount: plan.amount,
        currency_id: plan.currency,
      },
    },
  });

  if (!mpResponse.init_point) {
    throw new MercadoPagoApiError('[PlatformBilling] MP não devolveu init_point no preapproval', 502, mpResponse);
  }

  const doc: PlatformSubscription = {
    businessId,
    status: 'pending_payment',
    mpPreapprovalId: mpResponse.id,
    payerEmail,
    amount: plan.amount,
    currency: plan.currency,
    frequency: plan.frequency,
    frequencyType: plan.frequencyType,
    checkoutUrl: mpResponse.init_point,
    createdAt: existing.exists ? (existing.data() as PlatformSubscription).createdAt : now,
    updatedAt: now,
  };
  await ref.set(doc, { merge: true });

  return { checkoutUrl: mpResponse.init_point, status: 'pending_payment', alreadyExisted: false };
}

export interface PlatformSubscriptionSummary {
  businessId: string;
  businessName: string;
  subscription: PlatformSubscription | null;
}

/** Lista TODAS as businesses com o status de assinatura de cada uma
 *  (ausente = nunca gerou checkout). Cross-tenant por natureza — só chamado
 *  por rotas gated via verifyPlatformOperator. */
export async function listAllSubscriptions(): Promise<PlatformSubscriptionSummary[]> {
  const [businessesSnap, subscriptionsSnap] = await Promise.all([
    adminDb.collection('businesses').get(),
    adminDb.collection('platformSubscriptions').get(),
  ]);
  const subscriptionsById = new Map<string, PlatformSubscription>();
  for (const doc of subscriptionsSnap.docs) {
    subscriptionsById.set(doc.id, doc.data() as PlatformSubscription);
  }
  return businessesSnap.docs.map((doc) => {
    const data = doc.data() as { razaoSocial?: string; nomeFantasia?: string };
    return {
      businessId: doc.id,
      businessName: data.nomeFantasia || data.razaoSocial || doc.id,
      subscription: subscriptionsById.get(doc.id) ?? null,
    };
  });
}

/**
 * Aplica uma transição de status vinda de um evento (webhook ou cron) —
 * sempre dentro de uma transaction, sempre validando a transição pela FSM
 * antes de gravar (R4). Reaplicar o MESMO status (from === to) é tratado
 * como no-op idempotente, não erro — webhooks e o cron podem reentregar/
 * rodar mais de uma vez pro mesmo evento.
 */
export async function transitionPlatformSubscription(
  businessId: string,
  to: PlatformSubscriptionStatus,
  patch: Partial<Pick<PlatformSubscription, 'mpPreapprovalId' | 'nextBillingDate' | 'lastPaymentAt' | 'lastPaymentStatus'>> = {},
): Promise<void> {
  const ref = adminDb.collection('platformSubscriptions').doc(businessId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error(`[PlatformBilling] platformSubscriptions/${businessId} não existe — checkout nunca foi criado`);
    }
    const current = snap.data() as PlatformSubscription;
    if (current.status === to) return; // no-op idempotente — reentrega de webhook/cron
    assertTransitionPlatformSubscription(current.status, to);
    tx.update(ref, {
      status: to,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  });
}
