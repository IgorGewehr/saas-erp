import { createHash } from 'node:crypto';
import type { Firestore, Transaction as FirestoreTransaction } from 'firebase-admin/firestore';
import {
  DomainEventSchema,
  type DomainEventOf,
} from '@/lib/contracts/events';

export type PurchaseAuditEvent =
  | DomainEventOf<'purchase.imported'>
  | DomainEventOf<'purchase.financialLinked'>
  | DomainEventOf<'purchase.reverted'>;

export interface PurchaseEventActor {
  uid: string;
  name: string;
  type?: 'user' | 'api' | 'agent' | 'system';
}

export function purchaseEventActor(actor: PurchaseEventActor): {
  actorType: 'user' | 'api' | 'agent' | 'system';
  actorId: string;
  actorName: string;
} {
  const inferred = actor.uid === 'api' || actor.uid.startsWith('api:')
    ? 'api'
    : actor.uid === 'agent' || actor.uid.startsWith('agent:')
      ? 'agent'
      : 'user';
  return { actorType: actor.type ?? inferred, actorId: actor.uid, actorName: actor.name };
}

export function purchaseDomainEventId(
  businessId: string,
  purchaseNoteId: string,
  type: PurchaseAuditEvent['type'],
): string {
  const digest = createHash('sha256')
    .update(`${businessId}:${purchaseNoteId}:${type}`)
    .digest('hex');
  return `purchase_event_${digest.slice(0, 40)}`;
}

export async function ensurePurchaseAuditEvent(params: {
  db: Firestore;
  tx: FirestoreTransaction;
  event: PurchaseAuditEvent;
}): Promise<{ eventId: string; replayed: boolean }> {
  const parsed = DomainEventSchema.parse(params.event) as PurchaseAuditEvent;
  const eventId = purchaseDomainEventId(parsed.businessId, parsed.purchaseNoteId, parsed.type);
  const eventRef = params.db.collection('domainEvents').doc(eventId);
  const snapshot = await params.tx.get(eventRef);

  if (snapshot.exists) {
    const existing = snapshot.data();
    if (
      existing?.businessId !== parsed.businessId ||
      existing?.purchaseNoteId !== parsed.purchaseNoteId ||
      existing?.type !== parsed.type
    ) {
      throw new Error('O identificador determinístico do evento de compra está ocupado por outro evento.');
    }
    return { eventId, replayed: true };
  }

  const createdAt = new Date().toISOString();
  params.tx.create(eventRef, {
    ...parsed,
    id: eventId,
    idempotencyKey: `purchase:${parsed.purchaseNoteId}:event:${parsed.type}`,
    status: 'processed',
    handlerResults: [],
    createdAt,
    processedAt: createdAt,
  });
  return { eventId, replayed: false };
}
