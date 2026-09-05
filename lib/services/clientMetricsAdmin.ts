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

/**
 * Incrementa Client.relationshipHistory.noShowCount — chamado por
 * appointmentNoShow.ts. Chave dot-path (não objeto aninhado): um objeto
 * `{relationshipHistory: {...}}` faria `.update()` SUBSTITUIR o mapa
 * inteiro, apagando os demais campos de RelationshipHistory. Mesmo padrão
 * de lib/services/birthdayCampaignRunner.ts (incrementCampaignStats).
 *
 * M05.1: `PUT /api/v1/crm/contacts` gravava `relationshipHistory` inteiro
 * por substituição rasa — um caller externo que reenviasse esse objeto
 * parcialmente apagava `noShowCount` sem querer. Corrigido lá (mescla com
 * o valor atual antes de gravar) — não corrigido aqui, que já usa dot-path
 * corretamente desde o início.
 */
export async function bumpClientNoShowCountAdmin(params: {
  db: Firestore;
  clientId: string;
}): Promise<void> {
  const { db, clientId } = params;
  if (!clientId) return;

  await db.collection('clients').doc(clientId).update({
    'relationshipHistory.noShowCount': FieldValue.increment(1),
    updatedAt: new Date().toISOString(),
  });
}
