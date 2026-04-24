/**
 * Notification service — client-side helpers for creating and managing in-app notifications.
 */

import { collection, addDoc, type Firestore } from 'firebase/firestore';
import type { NotificationType } from '@/lib/types';

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
