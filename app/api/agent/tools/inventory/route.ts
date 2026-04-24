/**
 * Agent tool: Inventory management (products CRUD + stock ops).
 *
 * Complements the read-only `/api/agent/tools/catalog` which exposes the
 * customer-facing menu. This endpoint is the operational side for the
 * operator console.
 *
 * Actions:
 *   - list                   admin view (includes out-of-stock + inactive)
 *   - get                    single product
 *   - create                 new product (minimal schema; fiscal fields optional)
 *   - update                 patch whitelisted fields
 *   - adjust_stock           explicit +/- stock movement with audit row
 *   - list_low_stock         products at or below minStock
 *   - set_active             toggle isActive (soft hide from catalog)
 *   - set_out_of_stock       zero out currentStock (for temporary runout)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Product, StockMovement } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';

type Action =
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'adjust_stock'
  | 'list_low_stock'
  | 'set_active'
  | 'set_out_of_stock';

interface CreateParams {
  name: string;
  category: string;
  unit?: string;                // UN, KG, L — default UN
  costPrice: number;
  salePrice: number;
  currentStock?: number;
  minStock?: number;
  sku?: string;
  barcode?: string;
  description?: string;
  isDeliverable?: boolean;
  menuCategory?: string;
  menuDescription?: string;
  preparationTime?: number;
  imageUrl?: string;
}

interface AdjustStockParams {
  productId: string;
  delta: number;                // positive = entrada, negative = saida
  reason: string;               // required — "Ajuste manual", "Perda", etc.
  operatorId?: string;
  operatorName?: string;
}

const WRITEABLE: (keyof Product)[] = [
  'name', 'description', 'category', 'unit', 'costPrice', 'salePrice',
  'minStock', 'maxStock', 'sku', 'barcode', 'isActive', 'imageUrl',
  'isDeliverable', 'menuCategory', 'menuDescription', 'preparationTime', 'dietary',
];

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await verifyAgentRequest(req);
  } catch (err) {
    const resp = agentAuthErrorResponse(err);
    if (resp) return resp;
    throw err;
  }

  const body = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  try {
    switch (body.action) {
      case 'list':
        return NextResponse.json({ ok: true, data: await listAll(businessId, body.params as { category?: string; isActive?: boolean; onlyDeliverable?: boolean; limit?: number }) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getProduct(businessId, body.params.id as string) });
      case 'create':
        return NextResponse.json({ ok: true, data: await createProduct(businessId, body.params as unknown as CreateParams) });
      case 'update':
        return NextResponse.json({ ok: true, data: await updateProduct(businessId, body.params.id as string, body.params.patch as Partial<Product>) });
      case 'adjust_stock':
        return NextResponse.json({ ok: true, data: await adjustStock(businessId, body.params as unknown as AdjustStockParams) });
      case 'list_low_stock':
        return NextResponse.json({ ok: true, data: await listLowStock(businessId, body.params.limit as number | undefined) });
      case 'set_active':
        return NextResponse.json({ ok: true, data: await updateProduct(businessId, body.params.id as string, { isActive: body.params.isActive as boolean }) });
      case 'set_out_of_stock':
        return NextResponse.json({ ok: true, data: await setOutOfStock(businessId, body.params.id as string) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.inventory] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function listAll(
  businessId: string,
  p: { category?: string; isActive?: boolean; onlyDeliverable?: boolean; limit?: number },
): Promise<Product[]> {
  const limit = Math.min(Math.max(p.limit ?? 100, 1), 500);
  let q: FirebaseFirestore.Query = adminDb.collection('products').where('businessId', '==', businessId);
  if (p.category) q = q.where('category', '==', p.category);
  if (typeof p.isActive === 'boolean') q = q.where('isActive', '==', p.isActive);
  if (p.onlyDeliverable) q = q.where('isDeliverable', '==', true);

  const snap = await q.orderBy('name').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as Product), id: d.id }));
}

async function getProduct(businessId: string, id: string): Promise<Product | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('products').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as Product;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

async function createProduct(businessId: string, p: CreateParams): Promise<Product> {
  if (!p.name) throw new Error('name required');
  if (!p.category) throw new Error('category required');
  if (typeof p.salePrice !== 'number' || p.salePrice < 0) throw new Error('salePrice must be >= 0');
  if (typeof p.costPrice !== 'number' || p.costPrice < 0) throw new Error('costPrice must be >= 0');

  const now = new Date().toISOString();
  const ref = adminDb.collection('products').doc();
  const product: Product = {
    id: ref.id,
    businessId,
    name: p.name.slice(0, 200),
    description: p.description?.slice(0, 2000),
    sku: p.sku,
    barcode: p.barcode,
    category: p.category,
    unit: p.unit || 'UN',
    costPrice: round(p.costPrice),
    salePrice: round(p.salePrice),
    currentStock: typeof p.currentStock === 'number' ? p.currentStock : 0,
    minStock: typeof p.minStock === 'number' ? p.minStock : 0,
    isActive: true,
    imageUrl: p.imageUrl,
    isDeliverable: !!p.isDeliverable,
    menuCategory: p.menuCategory,
    menuDescription: p.menuDescription?.slice(0, 400),
    preparationTime: p.preparationTime,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(product);
  return product;
}

async function updateProduct(businessId: string, id: string, patch: Partial<Product>): Promise<Product> {
  if (!id) throw new Error('id required');
  const ref = adminDb.collection('products').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Product not found');
  const product = snap.data() as Product;
  if (product.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const clean: Record<string, unknown> = {};
  for (const k of WRITEABLE) {
    if (k in patch) clean[k] = (patch as Record<string, unknown>)[k];
  }

  if (typeof clean.name === 'string') clean.name = (clean.name as string).slice(0, 200);
  if (typeof clean.description === 'string') clean.description = (clean.description as string).slice(0, 2000);
  if (typeof clean.menuDescription === 'string') clean.menuDescription = (clean.menuDescription as string).slice(0, 400);
  if (typeof clean.salePrice === 'number') clean.salePrice = round(clean.salePrice as number);
  if (typeof clean.costPrice === 'number') clean.costPrice = round(clean.costPrice as number);

  clean.updatedAt = new Date().toISOString();
  await ref.update(clean);
  return { ...product, ...clean, id: snap.id } as Product;
}

async function adjustStock(businessId: string, p: AdjustStockParams): Promise<{ product: Product; movement: StockMovement }> {
  if (!p.productId) throw new Error('productId required');
  if (typeof p.delta !== 'number' || p.delta === 0) throw new Error('delta must be non-zero number');
  if (!p.reason) throw new Error('reason required');

  const ref = adminDb.collection('products').doc(p.productId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Product not found');
  const product = snap.data() as Product;
  if (product.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const delta = Math.round(p.delta * 1000) / 1000;
  const newStock = (product.currentStock || 0) + delta;
  if (newStock < 0) throw new Error(`Stock would go negative: current=${product.currentStock} delta=${delta}`);

  const now = new Date().toISOString();
  const batch = adminDb.batch();

  batch.update(ref, {
    currentStock: FieldValue.increment(delta),
    updatedAt: now,
  });

  // Audit row in stockMovements (immutable)
  const mvRef = adminDb.collection('stockMovements').doc();
  const movement: StockMovement = {
    id: mvRef.id,
    businessId,
    productId: p.productId,
    productName: product.name,
    type: delta > 0 ? 'entrada' : 'saida',
    quantity: Math.abs(delta),
    previousStock: product.currentStock || 0,
    newStock,
    reason: p.reason.slice(0, 200),
    operatorId: p.operatorId || 'agent',
    operatorName: p.operatorName || 'Agente IA',
    createdAt: now,
  };
  batch.set(mvRef, movement);

  await batch.commit();

  return {
    product: { ...product, currentStock: newStock, updatedAt: now, id: snap.id },
    movement,
  };
}

async function listLowStock(businessId: string, limit?: number): Promise<Product[]> {
  const cap = Math.min(Math.max(limit ?? 50, 1), 200);
  // Firestore can't filter `currentStock <= minStock` (two fields) directly, so
  // we pull active products and filter in memory. Capped for cost.
  const snap = await adminDb
    .collection('products')
    .where('businessId', '==', businessId)
    .where('isActive', '==', true)
    .limit(500)
    .get();

  const low = snap.docs
    .map((d) => ({ ...(d.data() as Product), id: d.id }))
    .filter((p) => (p.minStock ?? 0) > 0 && (p.currentStock ?? 0) <= (p.minStock ?? 0))
    .sort((a, b) => (a.currentStock ?? 0) - (b.currentStock ?? 0))
    .slice(0, cap);

  return low;
}

async function setOutOfStock(businessId: string, id: string): Promise<Product> {
  if (!id) throw new Error('id required');
  const ref = adminDb.collection('products').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Product not found');
  const product = snap.data() as Product;
  if (product.businessId !== businessId) throw new Error('Cross-tenant access denied');

  const now = new Date().toISOString();
  const delta = -(product.currentStock || 0);

  if (delta === 0) return { ...product, id: snap.id };

  // Audit via stockMovements (immutable trail)
  const batch = adminDb.batch();
  batch.update(ref, { currentStock: 0, updatedAt: now });

  const mvRef = adminDb.collection('stockMovements').doc();
  const movement: StockMovement = {
    id: mvRef.id,
    businessId,
    productId: id,
    productName: product.name,
    type: 'ajuste',
    quantity: Math.abs(delta),
    previousStock: product.currentStock || 0,
    newStock: 0,
    reason: 'Marcado como esgotado pelo agente',
    operatorId: 'agent',
    operatorName: 'Agente IA',
    createdAt: now,
  };
  batch.set(mvRef, movement);
  await batch.commit();

  return { ...product, currentStock: 0, updatedAt: now, id: snap.id };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
