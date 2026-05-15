/**
 * Notification service — client-side helpers for creating and managing in-app notifications.
 */

import { collection, addDoc, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type { NotificationType, StockAlert, User } from '@/lib/types';
import { ROLE_HIERARCHY } from '@/lib/types';

export interface CreateNotificationParams {
  businessId: string;
  userId: string;          // recipient
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  relatedId?: string;
  actorId?: string;
  actorName?: string;
}

/**
 * Create a single in-app notification for a user.
 */
export async function createNotification(
  db: Firestore,
  params: CreateNotificationParams,
): Promise<string> {
  const ref = await addDoc(collection(db, 'notifications'), {
    ...params,
    isRead: false,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

/**
 * Create notifications for multiple users (e.g. all assignees of a card).
 * Skips the actor themselves to avoid self-notifications.
 */
export async function notifyUsers(
  db: Firestore,
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>,
): Promise<void> {
  const targets = userIds.filter(uid => uid !== params.actorId);
  await Promise.all(
    targets.map(userId =>
      createNotification(db, { ...params, userId }),
    ),
  );
}

/**
 * Dispara notificações de estoque baixo pros gestores (admin/manager+) do
 * tenant. Caller (PDV, orders, inventory) passa o array de StockAlerts já
 * filtrado pelos stock helpers — esta função NÃO redetecta cruzamento, só
 * distribui pros destinatários.
 *
 * Best-effort: falha aqui não aborta a operação que originou (a venda já
 * foi gravada). Loga e segue.
 *
 * Agrupamento: se o batch derrubou 5 produtos abaixo do mínimo de uma vez
 * (combo, kit), gera UMA notif com os 5 listados — evita inundar o sino.
 */
export async function notifyLowStock(
  db: Firestore,
  params: {
    businessId: string;
    alerts: StockAlert[];
    actorId: string;
    actorName: string;
    /** Ex: "Venda #123" ou "Pedido #45". Vira contexto no corpo da notif. */
    sourceLabel?: string;
  },
): Promise<void> {
  if (!params.alerts.length) return;
  try {
    // Busca admins/managers do tenant. Operador (actor) não recebe — já viu
    // o toast localmente. Filtra por role >= manager (60).
    const usersSnap = await getDocs(
      query(collection(db, 'users'), where('businessId', '==', params.businessId)),
    );
    const recipientIds: string[] = [];
    usersSnap.docs.forEach(d => {
      const u = d.data() as User;
      if ((ROLE_HIERARCHY[u.role] ?? 0) >= ROLE_HIERARCHY.manager) {
        recipientIds.push(d.id);
      }
    });
    if (!recipientIds.length) return;

    // Resumo no body — 1 produto: nome direto; 2+: lista enxuta.
    const zeroedCount = params.alerts.filter(a => a.severity === 'zeroed').length;
    const minCount = params.alerts.length - zeroedCount;
    const title = zeroedCount > 0
      ? `Estoque zerado: ${zeroedCount} ${zeroedCount === 1 ? 'produto' : 'produtos'}`
      : `Estoque baixo: ${minCount} ${minCount === 1 ? 'produto' : 'produtos'}`;
    const body = params.alerts
      .slice(0, 5)
      .map(a => `• ${a.productName} — ${a.newStock} ${a.newStock === 1 ? 'unidade' : 'unidades'} (mín: ${a.minStock})`)
      .join('\n') + (params.alerts.length > 5 ? `\n+ ${params.alerts.length - 5} outros` : '')
      + (params.sourceLabel ? `\n${params.sourceLabel}` : '');

    await notifyUsers(db, recipientIds, {
      businessId: params.businessId,
      type: 'low_stock',
      title,
      body,
      link: 'Estoque',
      relatedId: params.alerts[0].productId,
      actorId: params.actorId,
      actorName: params.actorName,
    });
  } catch (err) {
    console.warn('[notifyLowStock] failed:', err);
  }
}
