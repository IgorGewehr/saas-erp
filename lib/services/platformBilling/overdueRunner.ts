/**
 * lib/services/platformBilling/overdueRunner.ts
 *
 * Cron diário (M12) — varre platformSubscriptions ativas e marca como
 * `overdue` as que passaram de nextBillingDate sem pagamento confirmado.
 * SEM enforcement (decisão do usuário, M12 v1): só torna o atraso visível
 * no painel do operador. O próprio Mercado Pago já reretenta a cobrança
 * recorrente e notifica o pagador por conta própria nesse meio-tempo.
 */

import { adminDb } from '@/lib/config/firebaseAdmin';
import { transitionPlatformSubscription } from '@/lib/services/platformBilling/subscriptionAdmin';
import type { PlatformSubscription } from '@/lib/contracts/domain/platformSubscription';

/** Pura — separada do runner pra ser testável sem Firestore. */
export function isSubscriptionOverdue(nextBillingDate: string, now: Date): boolean {
  const due = new Date(nextBillingDate).getTime();
  return Number.isFinite(due) && due < now.getTime();
}

export interface OverdueRunSummary {
  scanned: number;
  markedOverdue: number;
  errors: Array<{ businessId: string; error: string }>;
}

export async function runOverdueCheck(now: Date = new Date()): Promise<OverdueRunSummary> {
  const snap = await adminDb.collection('platformSubscriptions').where('status', '==', 'active').get();

  const summary: OverdueRunSummary = { scanned: snap.docs.length, markedOverdue: 0, errors: [] };

  for (const doc of snap.docs) {
    const sub = doc.data() as PlatformSubscription;
    if (!sub.nextBillingDate || !isSubscriptionOverdue(sub.nextBillingDate, now)) continue;
    try {
      await transitionPlatformSubscription(doc.id, 'overdue');
      summary.markedOverdue++;
    } catch (err) {
      summary.errors.push({ businessId: doc.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}
