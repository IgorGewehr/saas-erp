'use client';

import { auth } from '@/lib/config/firebase';
import type { PurchaseNote, PurchaseNoteStatus } from '@/lib/types';

export interface PurchaseNotePage {
  notes: PurchaseNote[];
  hasMore: boolean;
  nextCursor: string | null;
}

async function token(): Promise<string> {
  const value = await auth.currentUser?.getIdToken();
  if (!value) throw new Error('Sessão expirada. Entre novamente para consultar compras.');
  return value;
}

export async function listPurchaseNotesPage(input: {
  businessId: string;
  status?: PurchaseNoteStatus;
  cursor?: string | null;
  limit?: number;
}): Promise<PurchaseNotePage> {
  const params = new URLSearchParams({
    businessId: input.businessId,
    limit: String(input.limit ?? 50),
  });
  if (input.status) params.set('status', input.status);
  if (input.cursor) params.set('cursor', input.cursor);
  const response = await fetch(`/api/purchase-notes?${params.toString()}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    data?: PurchaseNotePage;
    error?: string;
  } | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.error || 'Não foi possível carregar as notas de compra.');
  }
  return payload.data;
}
