/**
 * Scheduled fallback — helper pra detectar disparos automáticos que
 * perderam seu slot (servidor offline, erro transient, deploy quebrado)
 * e notificar o owner via AppNotification.
 *
 * Filosofia escolhida pelo cliente: NÃO fazer catch-up automático
 * (recovery silencioso). Em vez disso, o usuário é notificado e decide
 * se reagenda manualmente. Trade-off favorável: previsibilidade > magia.
 *
 * Padrão de uso no executor (ex: birthdayCampaignRunner):
 *
 *   for (const c of campaigns) {
 *     await detectAndNotifyMissedRun(adminDb, {
 *       entity: c,
 *       collection: 'birthdayCampaigns',
 *       slotHour: c.sendAtHour,
 *       currentHour,
 *       today,
 *       ownerId: c.createdBy,
 *       title: 'Disparo de aniversário não realizado',
 *       body: `Campanha "${c.name}" agendada pra ${pad(c.sendAtHour)}:00 ...`,
 *       link: 'CRM',
 *     });
 *   }
 *
 *   // ... depois, no path de sucesso:
 *   await markSuccessfulRun(adminDb, 'birthdayCampaigns', c.id, today);
 */

import type { Firestore } from 'firebase-admin/firestore';

interface MissedRunEntity {
  id: string;
  businessId: string;
  isActive?: boolean;
  lastSuccessfulRunDate?: string;
  missedRunNotifiedDate?: string;
}

interface DetectMissedRunOpts<T extends MissedRunEntity> {
  entity: T;
  /** Coleção Firestore onde o entity vive. Ex: 'birthdayCampaigns'. */
  collection: string;
  /** Hora do dia (0-23) em que o slot devia ter rodado. */
  slotHour: number;
  /** Hora atual (no timezone do business). */
  currentHour: number;
  /** Data atual YYYY-MM-DD (no timezone do business). */
  today: string;
  /** UID do owner que recebe a notificação. */
  ownerId: string;
  /** Título curto da notificação. */
  title: string;
  /** Corpo descritivo. */
  body: string;
  /** Link/módulo pra navegar ao clicar (ex: 'CRM', 'Agenda'). */
  link?: string;
}

/** Retorna true se notificou (caller usa pra log/métricas).
 *
 *  Idempotente: se entity.missedRunNotifiedDate === today, skipa.
 *  Side effects:
 *    - addDoc em `notifications`
 *    - update no entity setando missedRunNotifiedDate = today
 *
 *  Ambos são best-effort — falha não interrompe o cron tick. */
export async function detectAndNotifyMissedRun<T extends MissedRunEntity>(
  adminDb: Firestore,
  opts: DetectMissedRunOpts<T>,
): Promise<boolean> {
  const { entity, collection, slotHour, currentHour, today, ownerId, title, body, link } = opts;

  // Skip se entity não está ativo, slot ainda não passou hoje, já rodou
  // hoje, ou já notificou hoje.
  if (entity.isActive === false) return false;
  if (slotHour >= currentHour) return false;
  if (entity.lastSuccessfulRunDate === today) return false;
  if (entity.missedRunNotifiedDate === today) return false;

  try {
    await adminDb.collection('notifications').add({
      businessId: entity.businessId,
      userId: ownerId,
      type: 'campaign_missed',
      title,
      body,
      isRead: false,
      ...(link ? { link } : {}),
      relatedId: entity.id,
      createdAt: new Date().toISOString(),
    });
    await adminDb.collection(collection).doc(entity.id).update({
      missedRunNotifiedDate: today,
    });
    return true;
  } catch (err) {
    console.error(`[scheduledFallback] notify failed for ${collection}/${entity.id}:`, err);
    return false;
  }
}

/** Marca o entity como tendo rodado com sucesso hoje. Chame ao final
 *  do path bem-sucedido do cron tick. Idempotente — pode chamar multiplas
 *  vezes no mesmo dia sem efeito colateral. */
export async function markSuccessfulRun(
  adminDb: Firestore,
  collection: string,
  entityId: string,
  today: string,
): Promise<void> {
  try {
    await adminDb.collection(collection).doc(entityId).update({
      lastSuccessfulRunDate: today,
    });
  } catch (err) {
    // Best-effort. Se falhar, no próximo tick o detector pode disparar
    // uma notificação falsa-positiva — aceitável vs propagar erro do cron.
    console.error(`[scheduledFallback] markSuccessful failed for ${collection}/${entityId}:`, err);
  }
}
