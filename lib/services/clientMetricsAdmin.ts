/**
 * Admin SDK mirror de `syncClientMetrics` (antes privada em
 * app/components/features/agenda/AgendaModule.tsx). Mantém Client.totalSpent /
 * visitCount / lastVisit em sincronia com o ciclo de conclusão do Appointment,
 * agora chamada por lib/contracts/_runtime/handlers/appointmentCompleted.ts.
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export async function syncClientMetricsAdmin(params: {
  db: Firestore;
  clientId: string;
  visitDelta: number;
  priceDelta: number;
  lastVisitDate?: string;
}): Promise<void> {
  const { db, clientId, visitDelta, priceDelta, lastVisitDate } = params;
  if (!clientId) return;

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (visitDelta !== 0) update.visitCount = FieldValue.increment(visitDelta);
  if (priceDelta !== 0) update.totalSpent = FieldValue.increment(priceDelta);
  if (lastVisitDate) update.lastVisit = lastVisitDate;

  await db.collection('clients').doc(clientId).update(update);
}
