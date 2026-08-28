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

import { randomUUID } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Product, StockMovement } from '@/lib/types';
import { applyStockOperationAdmin } from '@/lib/services/stock-core-admin';
import type { ProductCatalogData, ProductCatalogPatch } from '@/lib/contracts/api/product-catalog';
import type { StockLotEntry } from '@/lib/contracts/domain/stockLot';
import {
  archiveProductCatalogAdmin,
  createProductCatalogAdmin,
  ProductCatalogDuplicateIdentifierError,
  updateProductCatalogAdmin,
} from '@/lib/services/product-catalog-admin';

type Action =
  | 'list'
  | 'get'
  | 'search'
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
  trackLots?: boolean;
  trackExpiry?: boolean;
  expiryWarningDays?: number;
  initialLot?: StockLotEntry;
}

interface AdjustStockParams {
  productId: string;
  delta: number;                // positive = entrada, negative = saida
  reason: string;               // required — "Ajuste manual", "Perda", etc.
  operatorId?: string;
  operatorName?: string;
  idempotencyKey?: string;
  lotId?: string;
}

const WRITEABLE: (keyof Product)[] = [
  'name', 'description', 'category', 'unit', 'costPrice', 'salePrice',
  'minStock', 'maxStock', 'sku', 'barcode', 'isActive', 'imageUrl',
  'isDeliverable', 'menuCategory', 'menuDescription', 'preparationTime', 'dietary',
  'trackLots', 'trackExpiry', 'expiryWarningDays',
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
      case 'search':
        return NextResponse.json({ ok: true, data: await searchProducts(businessId, body.params as { query: string; includeInactive?: boolean; limit?: number }) });
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
        return NextResponse.json({
          ok: true,
          data: await setOutOfStock(
            businessId,
            body.params.id as string,
            body.params.idempotencyKey as string | undefined,
          ),
        });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.inventory] error', err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: err instanceof ProductCatalogDuplicateIdentifierError ? 409 : 500 },
    );
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

/** Admin-side fuzzy search over the product catalog. Distinct from
 * catalog_search (customer-facing, deliverable only). Inclui inactive opcional. */
async function searchProducts(
  businessId: string,
  p: { query: string; includeInactive?: boolean; limit?: number },
): Promise<Array<Product & { _score: number }>> {
  if (!p.query || !p.query.trim()) throw new Error('query required');
  const cap = Math.min(Math.max(p.limit ?? 10, 1), 50);

  let q: FirebaseFirestore.Query = adminDb.collection('products').where('businessId', '==', businessId);
  if (!p.includeInactive) q = q.where('isActive', '==', true);
  const snap = await q.limit(1000).get();

  const norm = (s?: string) =>
    (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const query = norm(p.query);
  const qDigits = p.query.replace(/\D/g, '');

  const scored: Array<Product & { _score: number }> = [];
  for (const d of snap.docs) {
    const prod = { ...(d.data() as Product), id: d.id };
    const nName = norm(prod.name);
    const nDesc = norm(prod.description);
    const nCat = norm(prod.category);
    const nMenuCat = norm(prod.menuCategory);
    const barcode = (prod.barcode || '').replace(/\D/g, '');
    const sku = norm(prod.sku);

    let score = 0;
    if (qDigits && qDigits.length >= 6 && barcode.includes(qDigits)) score = 100;
    else if (sku === query) score = 95;
    else if (nName === query) score = 90;
    else if (nName.startsWith(query)) score = 75;
    else if (nName.includes(query)) score = 60;
    else if (nCat.includes(query) || nMenuCat.includes(query)) score = 35;
    else if (nDesc.includes(query)) score = 20;

    if (score > 0) scored.push({ ...prod, _score: score });
  }

  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, cap);
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

  const unit = p.unit || 'UN';
  const data: ProductCatalogData = {
    name: p.name.slice(0, 200),
    description: p.description?.slice(0, 2000),
    sku: p.sku,
    barcode: p.barcode,
    category: p.category,
    unit,
    purchaseUnit: unit,
    purchaseToStockFactor: 1,
    costMethod: 'moving_average',
    costPrice: round(p.costPrice),
    salePrice: round(p.salePrice),
    minStock: typeof p.minStock === 'number' ? p.minStock : 0,
    isActive: true,
    images: p.imageUrl
      ? [{ id: 'agent-primary', url: p.imageUrl, sortOrder: 0, isPrimary: true }]
      : [],
    variants: [],
    isDeliverable: !!p.isDeliverable,
    menuAvailable: true,
    trackStock: true,
    trackLots: p.trackLots === true,
    trackExpiry: p.trackExpiry === true,
    expiryWarningDays: p.expiryWarningDays ?? 30,
    menuCategory: p.menuCategory,
    menuDescription: p.menuDescription?.slice(0, 400),
    preparationTime: p.preparationTime,
    components: [],
    modifierGroups: [],
  };
  let product = await createProductCatalogAdmin({ db: adminDb, businessId, data });
  const initialStock = typeof p.currentStock === 'number' ? p.currentStock : 0;
  if (initialStock > 0) {
    const operationKey = `agent:product:${product.id}:initial-stock`;
    const stock = await applyStockOperationAdmin(adminDb, {
      businessId,
      type: 'entrada',
      lines: [{
        productId: product.id,
        quantity: initialStock,
        ...(p.initialLot ? { lot: p.initialLot } : {}),
      }],
      operatorId: 'agent',
      operatorName: 'Agente IA',
      reason: 'Estoque inicial via agente',
      sourceType: 'agent',
      sourceId: product.id,
      idempotencyKey: operationKey,
      expandBom: false,
      negativeStockPolicy: 'prevent',
    });
    product = { ...product, currentStock: stock.adjustments[0]?.newStock ?? product.currentStock };
  }
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

  const { imageUrl, ...metadata } = clean;
  const catalogPatch: ProductCatalogPatch = {
    ...metadata,
    ...(imageUrl !== undefined
      ? {
          images: typeof imageUrl === 'string' && imageUrl
            ? [{ id: 'agent-primary', url: imageUrl, sortOrder: 0, isPrimary: true }]
            : [],
        }
      : {}),
  } as ProductCatalogPatch;
  if (catalogPatch.isActive === false) {
    return archiveProductCatalogAdmin({
      db: adminDb,
      businessId,
      productId: id,
      actor: { uid: 'agent', name: 'Agente IA' },
    });
  }
  return updateProductCatalogAdmin({
    db: adminDb,
    businessId,
    productId: id,
    patch: catalogPatch,
  });
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
  const coreKey = p.idempotencyKey ?? `agent:inventory:${randomUUID()}`;
  const result = await applyStockOperationAdmin(adminDb, {
    businessId,
    type: 'ajuste',
    lines: [{ productId: p.productId, quantity: delta, ...(p.lotId ? { lotId: p.lotId } : {}) }],
    operatorId: p.operatorId || 'agent',
    operatorName: p.operatorName || 'Agente IA',
    reason: p.reason.slice(0, 200),
    sourceType: 'agent',
    sourceId: coreKey,
    idempotencyKey: coreKey,
    expandBom: false,
    negativeStockPolicy: 'prevent',
  });
  const adjustment = result.adjustments[0];
  const now = new Date().toISOString();
  const movement: StockMovement = {
    id: adjustment.movementId,
    businessId,
    productId: p.productId,
    productName: product.name,
    type: 'ajuste',
    quantity: delta,
    previousStock: adjustment.previousStock,
    newStock: adjustment.newStock,
    reason: p.reason.slice(0, 200),
    operatorId: p.operatorId || 'agent',
    operatorName: p.operatorName || 'Agente IA',
    createdAt: now,
    ...(adjustment.lotAllocations?.length ? { lotAllocations: adjustment.lotAllocations } : {}),
  };

  return {
    product: { ...product, currentStock: adjustment.newStock, updatedAt: now, id: snap.id },
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

async function setOutOfStock(
  businessId: string,
  id: string,
  idempotencyKey?: string,
): Promise<Product> {
  if (!id) throw new Error('id required');
  const ref = adminDb.collection('products').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Product not found');
  const product = snap.data() as Product;
  if (product.businessId !== businessId) throw new Error('Cross-tenant access denied');

  if ((product.currentStock || 0) === 0) return { ...product, id: snap.id };

  const coreKey = idempotencyKey ?? `agent:out-of-stock:${randomUUID()}`;
  const result = await applyStockOperationAdmin(adminDb, {
    businessId,
    type: 'ajuste',
    lines: [{ productId: id, quantity: 0 }],
    operatorId: 'agent',
    operatorName: 'Agente IA',
    reason: 'Marcado como esgotado pelo agente',
    sourceType: 'agent',
    sourceId: coreKey,
    idempotencyKey: coreKey,
    expandBom: false,
    adjustmentMode: 'absolute',
    negativeStockPolicy: 'prevent',
  });
  const adjustment = result.adjustments[0];
  const now = new Date().toISOString();

  return { ...product, currentStock: adjustment.newStock, updatedAt: now, id: snap.id };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
