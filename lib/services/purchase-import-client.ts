'use client';

import { auth } from '@/lib/config/firebase';
import type { ReviewPurchaseNoteRequest } from '@/lib/contracts/api/purchase-note-review';
import type { LinkPurchaseFinancialRequest } from '@/lib/contracts/api/purchase-note-financial';
import type { PurchaseFinancialResult } from '@/lib/services/purchase-financial-admin';
import type {
  PreparedPurchaseNote,
  PurchaseNoteConfirmationResult,
  PurchaseNoteReversalResult,
} from '@/lib/services/purchase-import-admin';
import type {
  PurchaseFiscalSnapshot,
  PurchaseFiscalSyncResult,
} from '@/lib/services/purchase-fiscal-sync-admin';

async function token(): Promise<string> {
  const value = await auth.currentUser?.getIdToken();
  if (!value) throw new Error('Sessão expirada. Entre novamente para importar compras.');
  return value;
}

async function payload<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string; details?: unknown } | null;
  if (!response.ok || !body?.ok || body.data === undefined) {
    const detailMessage = Array.isArray(body?.details)
      ? body.details.map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object' && typeof (entry as { message?: unknown }).message === 'string') {
          return (entry as { message: string }).message;
        }
        return '';
      }).filter(Boolean).join(' ')
      : '';
    throw new Error(detailMessage || body?.error || 'Não foi possível processar a NF-e.');
  }
  return body.data;
}

export async function preparePurchaseNote(businessId: string, file: File): Promise<PreparedPurchaseNote> {
  const form = new FormData();
  form.set('businessId', businessId);
  form.set('file', file);
  return payload(await fetch('/api/purchase-notes/prepare', {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}` }, body: form,
  }));
}

export async function savePurchaseNoteReview(input: ReviewPurchaseNoteRequest): Promise<PreparedPurchaseNote> {
  return payload(await fetch('/api/purchase-notes/review', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify(input),
  }));
}

export async function confirmPurchaseNote(input: {
  businessId: string;
  noteId: string;
  retryFailed?: boolean;
}): Promise<PurchaseNoteConfirmationResult> {
  return payload(await fetch('/api/purchase-notes/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify(input),
  }));
}

export async function reversePurchaseNote(input: {
  businessId: string;
  noteId: string;
  reason: string;
}): Promise<PurchaseNoteReversalResult> {
  return payload(await fetch('/api/purchase-notes/reverse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify(input),
  }));
}

export async function linkPurchaseFinancial(input: LinkPurchaseFinancialRequest): Promise<PurchaseFinancialResult> {
  return payload(await fetch('/api/purchase-notes/financial', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify(input),
  }));
}

export interface PurchaseFiscalActionResult {
  snapshot: PurchaseFiscalSnapshot;
  operation?: PurchaseFiscalSyncResult | unknown;
  note?: PreparedPurchaseNote;
}

export async function getPurchaseFiscalSnapshot(businessId: string): Promise<PurchaseFiscalSnapshot> {
  return payload(await fetch(`/api/purchase-notes/fiscal-sync?businessId=${encodeURIComponent(businessId)}`, {
    headers: { Authorization: `Bearer ${await token()}` },
    cache: 'no-store',
  }));
}

export async function runPurchaseFiscalAction(input:
  | { businessId: string; action: 'sync'; maxPages?: number }
  | { businessId: string; action: 'hydrate' | 'prepare'; inboxId: string }
): Promise<PurchaseFiscalActionResult> {
  return payload(await fetch('/api/purchase-notes/fiscal-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
    body: JSON.stringify(input),
  }));
}
