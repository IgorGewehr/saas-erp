'use client';

import { auth } from '@/lib/config/firebase';
import type { ReviewPurchaseNoteRequest } from '@/lib/contracts/api/purchase-note-review';
import type {
  PreparedPurchaseNote,
  PurchaseNoteConfirmationResult,
  PurchaseNoteReversalResult,
} from '@/lib/services/purchase-import-admin';

async function token(): Promise<string> {
  const value = await auth.currentUser?.getIdToken();
  if (!value) throw new Error('Sessão expirada. Entre novamente para importar compras.');
  return value;
}

async function payload<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string; details?: string[] } | null;
  if (!response.ok || !body?.ok || body.data === undefined) {
    throw new Error(body?.details?.join(' ') || body?.error || 'Não foi possível processar a NF-e.');
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
