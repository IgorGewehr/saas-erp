'use client';

import { auth } from '@/lib/config/firebase';
import type { StockOperationRequest } from '@/lib/contracts/api/stock-operations';
import type { StockOperationResult } from '@/lib/services/stock-core-admin';

interface StockOperationResponse {
  ok: boolean;
  data?: StockOperationResult;
  error?: string;
  code?: string;
}
export function createStockIdempotencyKey(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`;
}

export async function applyStockOperation(
  input: StockOperationRequest,
): Promise<StockOperationResult> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sessão expirada. Entre novamente para movimentar o estoque.');

  const response = await fetch('/api/stock/operations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null) as StockOperationResponse | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.error || 'Não foi possível movimentar o estoque.');
  }
  return payload.data;
}
