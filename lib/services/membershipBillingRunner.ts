/**
 * Membership Billing Runner — executor recorrente de mensalidades (P2.9).
 *
 * Chamado por cron diário (ver /api/membership-billing/run). Cada execução:
 *
 *   1. Carrega todas as `clientMemberships` com `status === 'active'`.
 *   2. Para cada uma cujo `nextBillingDate` <= hoje (no fuso do business) →
 *      tenta cobrar o ciclo corrente.
 *   3. Idempotência por `{clientMembershipId}_{cycle}` via runTransaction no
 *      doc `membershipBillingLogs/{id}` — cron rodando 2x no mesmo dia NÃO
 *      cobra duplicado (mesmo modelo do birthdayCampaignRunner).
 *   4. Em sucesso: avança a janela do ciclo (nextBillingDate += ciclo, cycle++,
 *      usesThisCycle = 0, lastBilledDate = hoje) atomicamente.
 *
 * R1: toda query/write filtra/grava businessId.
 * R3: idempotência por chave de ciclo (parte do contrato).
 * R4: mudança de status usa assertTransitionMembership.
 *
 * Referência de estilo: lib/services/birthdayCampaignRunner.ts.
 *
 * TODO(auditoria P2.9): a COBRANÇA REAL ainda não está plugada. Hoje o runner:
 *   - claim idempotente do log do ciclo,
 *   - cria a Transaction (receita, status 'pendente') do valor do plano,
 *   - avança a janela do ciclo.
 * Falta: integrar gateway de pagamento (PaymentIntent PIX/cartão) e marcar a
 * Transaction como 'pago' via webhook; tratar falha de cobrança → transicionar
 * para 'expired' após N tentativas; notificar cliente. Enquanto não há gateway,
 * a Transaction 'pendente' serve de cobrança manual (operador concilia no caixa).
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import {
  BILLING_CYCLE_DAYS,
  type ClientMembership,
  type Membership,
} from '@/lib/contracts/domain/membership';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

interface BillResult {
  clientMembershipId: string;
  clientName: string;
  cycle: number;
  charged: boolean;
  skippedIdempotent: boolean;
  error?: string;
}

interface RunSummary {
  ranAt: string;
  considered: number;
  billed: number;
  skippedIdempotent: number;
  failed: number;
  results: BillResult[];
}

/** Data atual YYYY-MM-DD no fuso do business. */
function todayInTz(now: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(now); // en-CA → YYYY-MM-DD
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Soma `days` a uma data YYYY-MM-DD e devolve YYYY-MM-DD (UTC, sem DST surprise). */
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Claim idempotente do log de cobrança do ciclo. Retorna `true` se OK pra
 * cobrar; `false` se já cobrado neste ciclo (skip). Transação evita race
 * entre execuções concorrentes do cron.
 */
async function tryClaimBillingLog(params: {
  logId: string;
  businessId: string;
  clientMembershipId: string;
  membershipId: string;
  clientId: string;
  cycle: number;
  amount: number;
}): Promise<boolean> {
  const ref = adminDb.collection('membershipBillingLogs').doc(params.logId);
  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists) return false; // já cobrado neste ciclo
    tx.set(ref, {
      businessId: params.businessId,
      clientMembershipId: params.clientMembershipId,
      membershipId: params.membershipId,
      clientId: params.clientId,
      cycle: params.cycle,
      amount: params.amount,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    return true;
  });
}

/**
 * Cobra um ciclo de uma assinatura: cria a Transaction de receita, avança a
 * janela do ciclo. Idempotente por {clientMembershipId}_{cycle}.
 */
async function billCycle(
  cm: ClientMembership,
  plan: Membership | null,
  today: string,
): Promise<BillResult> {
  const cycle = cm.cycle ?? 1;
  const result: BillResult = {
    clientMembershipId: cm.id,
    clientName: cm.clientName,
    cycle,
    charged: false,
    skippedIdempotent: false,
  };

  const amount = plan?.price ?? 0;
  const cycleType = plan?.billingCycle ?? 'monthly';
  const logId = `${cm.id}_${cycle}`;

  let claimed = false;
  try {
    claimed = await tryClaimBillingLog({
      logId,
      businessId: cm.businessId,
      clientMembershipId: cm.id,
      membershipId: cm.membershipId,
      clientId: cm.clientId,
      cycle,
      amount,
    });
  } catch (err) {
    result.error = `idempotência: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  if (!claimed) {
    result.skippedIdempotent = true;
    return result;
  }

  const now = new Date().toISOString();
  try {
    // Cobrança como receita pendente do business (R1: businessId no doc).
    // TODO(auditoria P2.9): plugar gateway (PaymentIntent) e marcar 'pago' via
    // webhook. Por ora fica 'pendente' = cobrança manual conciliada no caixa.
    const txRef = await adminDb.collection('transactions').add({
      businessId: cm.businessId,
      type: 'receita',
      category: 'Mensalidades',
      description: `Mensalidade — ${cm.membershipName} — ${cm.clientName} (ciclo ${cycle})`,
      amount,
      dueDate: cm.nextBillingDate ?? today,
      status: 'pendente',
      clientId: cm.clientId,
      clientName: cm.clientName,
      clientMembershipId: cm.id,
      membershipId: cm.membershipId,
      createdAt: now,
      updatedAt: now,
    });

    // Avança a janela do ciclo atomicamente.
    const nextBillingDate = addDaysYmd(cm.nextBillingDate ?? today, BILLING_CYCLE_DAYS[cycleType]);
    await adminDb.collection('clientMemberships').doc(cm.id).update({
      cycle: cycle + 1,
      usesThisCycle: 0,
      nextBillingDate,
      lastBilledDate: today,
      updatedAt: now,
    });

    await adminDb.collection('membershipBillingLogs').doc(logId).update({
      status: 'billed',
      transactionId: txRef.id,
      billedAt: now,
    });

    result.charged = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    await adminDb.collection('membershipBillingLogs').doc(logId).update({
      status: 'failed',
      errorMessage: result.error.slice(0, 500),
      failedAt: now,
    }).catch(() => {/* log pode não existir se claim falhou */});
  }

  return result;
}

/**
 * Entry-point do cron. Carrega assinaturas ativas, agrupa por business (TZ),
 * e cobra as que venceram. Volume tipicamente baixo (assinaturas por tenant).
 */
export async function runMembershipBilling(now: Date = new Date()): Promise<RunSummary> {
  const summary: RunSummary = {
    ranAt: now.toISOString(),
    considered: 0,
    billed: 0,
    skippedIdempotent: 0,
    failed: 0,
    results: [],
  };

  const cmSnap = await adminDb.collection('clientMemberships')
    .where('status', '==', 'active')
    .get();

  if (cmSnap.empty) return summary;

  // Agrupa por businessId pra resolver TZ + planos uma vez por tenant.
  const byBusiness = new Map<string, ClientMembership[]>();
  for (const doc of cmSnap.docs) {
    const cm = { ...(doc.data() as ClientMembership), id: doc.id };
    summary.considered++;
    const list = byBusiness.get(cm.businessId) ?? [];
    list.push(cm);
    byBusiness.set(cm.businessId, list);
  }

  for (const [businessId, memberships] of byBusiness.entries()) {
    // TZ do business
    let tz = DEFAULT_TIMEZONE;
    try {
      const bizSnap = await adminDb.collection('businesses').doc(businessId).get();
      const bizData = bizSnap.data() as { settings?: { timezone?: string } } | undefined;
      if (bizData?.settings?.timezone) tz = bizData.settings.timezone;
    } catch {/* usa default */}

    const today = todayInTz(now, tz);

    // Carrega os planos do business uma vez (R1: filtro businessId).
    const plansById = new Map<string, Membership>();
    try {
      const plansSnap = await adminDb.collection('memberships')
        .where('businessId', '==', businessId)
        .get();
      for (const d of plansSnap.docs) {
        plansById.set(d.id, { ...(d.data() as Membership), id: d.id });
      }
    } catch (err) {
      console.error(`[MembershipBilling] failed to load plans for ${businessId}:`, err);
      continue;
    }

    // Cobra as que venceram (nextBillingDate <= hoje). Sem nextBillingDate →
    // assinatura malformada (invariante do contrato) → pula e loga.
    const due = memberships.filter(cm => cm.nextBillingDate && cm.nextBillingDate <= today);

    for (const cm of due) {
      const plan = plansById.get(cm.membershipId) ?? null;
      const r = await billCycle(cm, plan, today);
      summary.results.push(r);
      if (r.charged) summary.billed++;
      else if (r.skippedIdempotent) summary.skippedIdempotent++;
      else if (r.error) summary.failed++;
    }
  }

  return summary;
}
