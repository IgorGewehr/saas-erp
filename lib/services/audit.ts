/**
 * Audit-log helper for financial entities.
 *
 * Called from the UI immediately after a successful Firestore mutation.
 * Failure to log is NON-fatal — we never block business operations on
 * audit write errors (the operation already succeeded).
 *
 * Collection: financialAuditLog/{auto-id}
 * Scoped by businessId; rules restrict read to admin+, write via server
 * allowed for any authenticated operator (so they can record their own actions).
 */

import {
  addDoc,
  collection,
  type Firestore,
} from 'firebase/firestore';
import type { AuditAction, FinancialAuditLog } from '@/lib/types';

export interface AuditActor {
  uid: string;
  name: string;
}

export interface AuditPayload {
  businessId: string;
  entity: 'transaction' | 'bankAccount' | 'cashSession';
  entityId: string;
  action: AuditAction;
  actor: AuditActor;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  amount?: number;
  description?: string;
}

function computeChangedFields(
  before?: Record<string, unknown>,
  after?: Record<string, unknown>,
): string[] | undefined {
  if (!before || !after) return undefined;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    // Shallow compare — good enough for flat docs and top-level fields.
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  }
  return changed.length ? changed : undefined;
}

export async function logAudit(db: Firestore, payload: AuditPayload): Promise<void> {
  try {
    const doc: Omit<FinancialAuditLog, 'id'> = {
      businessId: payload.businessId,
      entity: payload.entity,
      entityId: payload.entityId,
      action: payload.action,
      actorUid: payload.actor.uid,
      actorName: payload.actor.name,
      before: payload.before,
      after: payload.after,
      changedFields: computeChangedFields(payload.before, payload.after),
      amount: payload.amount,
      description: payload.description,
      createdAt: new Date().toISOString(),
    };
    // Firestore doesn't accept undefined — strip them.
    const cleaned = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
    await addDoc(collection(db, 'financialAuditLog'), cleaned);
  } catch (err) {
    // Swallow — audit failures should never break the UX.
    console.warn('[audit] log failed:', err);
  }
}
