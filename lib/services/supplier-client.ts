'use client';

import { auth } from '@/lib/config/firebase';
import type { SupplierCatalogData, SupplierCatalogPatch } from '@/lib/contracts/api/supplier-catalog';
import type { SupplierPage, SupplierRelations } from '@/lib/services/supplier-admin';
import type { Supplier } from '@/lib/types';

async function token(): Promise<string> {
  const value = await auth.currentUser?.getIdToken();
  if (!value) throw new Error('Sessão expirada. Entre novamente para gerenciar fornecedores.');
  return value;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${await token()}`,
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; data?: T; error?: string } | null;
  if (!response.ok || !payload?.ok || payload.data === undefined) {
    throw new Error(payload?.error || 'Não foi possível processar o fornecedor.');
  }
  return payload.data;
}

export function listSuppliersPage(input: {
  businessId: string;
  includeInactive?: boolean;
  cursor?: string | null;
  limit?: number;
}): Promise<SupplierPage> {
  const params = new URLSearchParams({
    businessId: input.businessId,
    includeInactive: String(Boolean(input.includeInactive)),
    limit: String(input.limit ?? 100),
  });
  if (input.cursor) params.set('cursor', input.cursor);
  return request<SupplierPage>(`/api/suppliers?${params.toString()}`);
}

export function getSupplierWithRelations(businessId: string, supplierId: string): Promise<{
  supplier: Supplier;
  relations: SupplierRelations;
}> {
  const params = new URLSearchParams({ businessId, supplierId, relations: 'true' });
  return request(`/api/suppliers?${params.toString()}`);
}

export function createSupplier(input: { businessId: string; data: SupplierCatalogData }): Promise<Supplier> {
  return request('/api/suppliers', { method: 'POST', body: JSON.stringify(input) });
}

export function updateSupplier(input: {
  businessId: string;
  supplierId: string;
  data: SupplierCatalogPatch;
}): Promise<Supplier> {
  return request('/api/suppliers', { method: 'PATCH', body: JSON.stringify(input) });
}

export function archiveSupplier(input: { businessId: string; supplierId: string }): Promise<Supplier> {
  return request('/api/suppliers', { method: 'DELETE', body: JSON.stringify(input) });
}
