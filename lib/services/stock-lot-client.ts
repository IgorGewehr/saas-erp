'use client';

import { auth } from '@/lib/config/firebase';
import type { StockLot, StockLotSummary } from '@/lib/types';

export interface StockLotListResult {
  lots: StockLot[];
  summary: StockLotSummary;
}

export async function listStockLots(input: {
  businessId: string;
  productId?: string;
  includeDepleted?: boolean;
}): Promise<StockLotListResult> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sessão expirada. Entre novamente para consultar lotes.');
  const params = new URLSearchParams({ businessId: input.businessId });
  if (input.productId) params.set('productId', input.productId);
  if (input.includeDepleted) params.set('includeDepleted', 'true');
  const response = await fetch(`/api/stock/lots?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    data?: StockLotListResult;
    error?: string;
  } | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.error || 'Não foi possível carregar os lotes.');
  }
  return payload.data;
}
