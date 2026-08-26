'use client';

import { auth } from '@/lib/config/firebase';
import type { ProductCatalogData, ProductCatalogPatch } from '@/lib/contracts/api/product-catalog';
import type { Product, ProductImage } from '@/lib/types';

interface ProductApiResponse {
  ok: boolean;
  data?: Product;
  error?: string;
  code?: string;
}

export interface ProductCatalogPage {
  products: Product[];
  hasMore: boolean;
  nextCursor: string | null;
}

export function createCatalogIdempotencyKey(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`;
}

async function token(): Promise<string> {
  const value = await auth.currentUser?.getIdToken();
  if (!value) throw new Error('Sessão expirada. Entre novamente para gerenciar produtos.');
  return value;
}

async function productRequest(
  method: 'POST' | 'PATCH' | 'DELETE',
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Product> {
  const response = await fetch('/api/products', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await token()}`,
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as ProductApiResponse | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.error || 'Não foi possível salvar o produto.');
  }
  return payload.data;
}

export async function listCatalogProductsPage(input: {
  businessId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<ProductCatalogPage> {
  const params = new URLSearchParams({
    businessId: input.businessId,
    limit: String(input.limit ?? 100),
  });
  if (input.cursor) params.set('cursor', input.cursor);
  const response = await fetch(`/api/products?${params.toString()}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    data?: ProductCatalogPage;
    error?: string;
  } | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.error || 'Não foi possível carregar o catálogo.');
  }
  return payload.data;
}

export async function createCatalogProduct(input: {
  businessId: string;
  data: ProductCatalogData;
  initialStock: number;
  idempotencyKey: string;
}): Promise<Product> {
  return productRequest('POST', input, input.idempotencyKey);
}

export async function updateCatalogProduct(input: {
  businessId: string;
  productId: string;
  data: ProductCatalogPatch;
  targetStock?: number;
  idempotencyKey: string;
}): Promise<Product> {
  return productRequest('PATCH', input, input.idempotencyKey);
}

export async function archiveCatalogProduct(input: {
  businessId: string;
  productId: string;
}): Promise<Product> {
  return productRequest('DELETE', input);
}

export async function replaceCatalogProductImages(input: {
  businessId: string;
  productId: string;
  files: File[];
  existingImages?: ProductImage[];
  mode?: 'append' | 'replace';
}): Promise<Product> {
  if (input.files.length === 0) throw new Error('Selecione ao menos uma imagem.');
  const form = new FormData();
  form.set('businessId', input.businessId);
  form.set('productId', input.productId);
  form.set('mode', input.mode ?? 'replace');
  if (input.existingImages) form.set('existingImages', JSON.stringify(input.existingImages));
  input.files.forEach((file) => form.append('files', file));
  const response = await fetch('/api/products/images', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}` },
    body: form,
  });
  const payload = await response.json().catch(() => null) as ProductApiResponse | null;
  if (!response.ok || !payload?.ok || !payload.data) {
    throw new Error(payload?.error || 'Não foi possível enviar a imagem do produto.');
  }
  return payload.data;
}
