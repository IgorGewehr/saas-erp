'use client';

import { auth } from '@/lib/config/firebase';
import type { StockMovement } from '@/lib/types';

export interface StockMovementPage {
  movements: StockMovement[];
  hasMore: boolean;
  nextCursor: string | null;
}

async function token(): Promise<string> {
  const value = await auth.currentUser?.getIdToken();
  if (!value) throw new Error('Sessão expirada. Entre novamente para consultar o estoque.');
  return value;
}

export async function listStockMovementsPage(input: {
  businessId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<StockMovementPage> {
  const params = new URLSearchParams({
    businessId: input.businessId,
    limit: String(input.limit ?? 100),
  });
  if (input.cursor) params.set('cursor', input.cursor);
  const response = await fetch(`/api/stock/movements?${params.toString()}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    data?: StockMovementPage;
    error?: string;
  } | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.error || 'Não foi possível carregar as movimentações.');
  }
  return payload.data;
}
