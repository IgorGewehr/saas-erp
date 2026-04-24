/**
 * Agent tool: Purchase notes (NF-e de compra) listing + import to stock.
 *
 * The agent reads already-parsed NF-e records from `purchaseNotes/{id}`. The
 * XML parsing happens upstream (separate import flow). This tool lets the
 * agent:
 *
 *   - list               list notes with status filter
 *   - get                single note with items
 *   - match_products     fuzzy-match items to existing products by name/SKU
 *   - apply_to_stock     create stockMovements (entrada) for matched items.
 *                        Idempotent: sets `stockImportedAt`, blocks re-apply.
 *   - list_unmatched     notes with unmatched items pending review
 */

import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { PurchaseNote, PurchaseNoteItem, PurchaseNoteStatus, Product, StockMovement } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';

type Action = 'list' | 'get' | 'match_products' | 'apply_to_stock' | 'list_unmatched';

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
        return NextResponse.json({ ok: true, data: await listNotes(businessId, body.params as { status?: PurchaseNoteStatus; supplierId?: string; limit?: number }) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getNote(businessId, body.params.id as string) });
      case 'match_products':
        return NextResponse.json({ ok: true, data: await matchProducts(businessId, body.params.id as string) });
      case 'apply_to_stock':
        return NextResponse.json({ ok: true, data: await applyToStock(businessId, body.params.id as string, body.params.operatorId as string | undefined, body.params.operatorName as string | undefined) });
      case 'list_unmatched':
        return NextResponse.json({ ok: true, data: await listUnmatched(businessId, body.params.limit as number | undefined) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.purchase-notes] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function listNotes(
  businessId: string,
  p: { status?: PurchaseNoteStatus; supplierId?: string; limit?: number },
): Promise<PurchaseNote[]> {
  const limit = Math.min(Math.max(p.limit ?? 30, 1), 100);
  let q: FirebaseFirestore.Query = adminDb.collection('purchaseNotes').where('businessId', '==', businessId);
  if (p.status) q = q.where('status', '==', p.status);
  if (p.supplierId) q = q.where('supplierId', '==', p.supplierId);

  const snap = await q.orderBy('issueDate', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as PurchaseNote), id: d.id }));
}

async function getNote(businessId: string, id: string): Promise<PurchaseNote | null> {
  if (!id) throw new Error('id required');
  const doc = await adminDb.collection('purchaseNotes').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as PurchaseNote;
  if (data.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return { ...data, id: doc.id };
}

// ─── Matching ────────────────────────────────────────────────────────────────

async function matchProducts(businessId: string, id: string): Promise<{
  note: PurchaseNote;
  matched: Array<{ item: PurchaseNoteItem; product: Product; confidence: number }>;
  unmatched: PurchaseNoteItem[];
}> {
  const note = await getNote(businessId, id);
  if (!note) throw new Error('Note not found');

  // Pull tenant's active products (capped)
  const products = await adminDb
    .collection('products')
    .where('businessId', '==', businessId)
    .where('isActive', '==', true)
    .limit(1000)
    .get();
  const index = products.docs.map((d) => ({ ...(d.data() as Product), id: d.id }));

  const matched: Array<{ item: PurchaseNoteItem; product: Product; confidence: number }> = [];
  const unmatched: PurchaseNoteItem[] = [];

  for (const item of note.items) {
    const best = bestMatch(item, index);
    if (best && best.confidence >= 0.6) {
      matched.push({ item, product: best.product, confidence: best.confidence });
    } else {
      unmatched.push(item);
    }
  }

  return { note, matched, unmatched };
}

function bestMatch(item: PurchaseNoteItem, products: Product[]): { product: Product; confidence: number } | null {
  // Normalize helper
  const norm = (s?: string) =>
    (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

  const itemName = norm(item.productName);
  const itemCProd = norm(item.cProd);

  let best: { product: Product; confidence: number } | null = null;
  for (const p of products) {
    // Exact SKU / barcode match — very high confidence
    if (p.sku && norm(p.sku) === itemCProd && itemCProd) {
      return { product: p, confidence: 1.0 };
    }
    if (p.barcode && itemCProd && norm(p.barcode) === itemCProd) {
      return { product: p, confidence: 0.98 };
    }

    // Name-based fuzzy (token overlap)
    const pName = norm(p.name);
    const score = tokenOverlap(itemName, pName);
    if (!best || score > best.confidence) {
      best = { product: p, confidence: score };
    }
  }

  return best;
}

function tokenOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = new Set(a.split(' ').filter((t) => t.length > 2));
  const tb = new Set(b.split(' ').filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits += 1;
  // Jaccard-ish
  return hits / Math.max(ta.size, tb.size);
}

// ─── Apply to stock (idempotent) ─────────────────────────────────────────────

async function applyToStock(
  businessId: string,
  id: string,
  operatorId?: string,
  operatorName?: string,
): Promise<{ note: PurchaseNote; movementsCreated: number; unmatchedCount: number }> {
  const noteRef = adminDb.collection('purchaseNotes').doc(id);
  const noteSnap = await noteRef.get();
  if (!noteSnap.exists) throw new Error('Note not found');
  const note = noteSnap.data() as PurchaseNote;
  if (note.businessId !== businessId) throw new Error('Cross-tenant access denied');
  if (note.stockImportedAt) throw new Error('Already imported to stock — cannot re-apply');

  // Match products
  const { matched, unmatched } = await matchProducts(businessId, id);

  if (matched.length === 0) {
    throw new Error('No products matched — review unmatched items first');
  }

  // Batch: increment stock on each matched product + create stockMovement audit rows
  const now = new Date().toISOString();
  const batch = adminDb.batch();
  const movementIds: string[] = [];

  for (const { item, product } of matched) {
    const productRef = adminDb.collection('products').doc(product.id);
    batch.update(productRef, {
      currentStock: FieldValue.increment(item.quantity),
      // Update cost price if it moved meaningfully (± 5%)
      costPrice: shouldUpdateCost(product.costPrice, item.unitPrice) ? item.unitPrice : product.costPrice,
      updatedAt: now,
    });

    const mvRef = adminDb.collection('stockMovements').doc();
    const movement: StockMovement = {
      id: mvRef.id,
      businessId,
      productId: product.id,
      productName: product.name,
      type: 'entrada',
      quantity: item.quantity,
      previousStock: product.currentStock || 0,
      newStock: (product.currentStock || 0) + item.quantity,
      reason: `NF ${note.numero}/${note.serie} — ${note.supplierName}`,
      purchaseId: id,
      operatorId: operatorId || 'agent',
      operatorName: operatorName || 'Agente IA',
      createdAt: now,
    };
    batch.set(mvRef, movement);
    movementIds.push(mvRef.id);
  }

  // Update note: idempotency stamp + unmatched items snapshot
  batch.update(noteRef, {
    status: 'importada' as PurchaseNoteStatus,
    stockImportedAt: now,
    stockMovementIds: movementIds,
    importedAt: note.importedAt || now,
    unmatchedItems: unmatched.map((u) => ({ productName: u.productName, quantity: u.quantity, cProd: u.cProd })),
    updatedAt: now,
  });

  await batch.commit();

  return {
    note: { ...note, status: 'importada', stockImportedAt: now, stockMovementIds: movementIds, id: noteSnap.id },
    movementsCreated: matched.length,
    unmatchedCount: unmatched.length,
  };
}

async function listUnmatched(businessId: string, limit?: number): Promise<Array<Pick<PurchaseNote, 'id' | 'numero' | 'supplierName' | 'issueDate' | 'unmatchedItems'>>> {
  const cap = Math.min(Math.max(limit ?? 20, 1), 100);
  const snap = await adminDb
    .collection('purchaseNotes')
    .where('businessId', '==', businessId)
    .where('status', '==', 'importada')
    .orderBy('issueDate', 'desc')
    .limit(cap * 2)
    .get();

  return snap.docs
    .map((d) => ({ ...(d.data() as PurchaseNote), id: d.id }))
    .filter((n) => Array.isArray(n.unmatchedItems) && n.unmatchedItems.length > 0)
    .slice(0, cap)
    .map((n) => ({
      id: n.id,
      numero: n.numero,
      supplierName: n.supplierName,
      issueDate: n.issueDate,
      unmatchedItems: n.unmatchedItems,
    }));
}

function shouldUpdateCost(oldCost: number, newCost: number): boolean {
  if (oldCost <= 0) return newCost > 0;
  const diff = Math.abs(newCost - oldCost) / oldCost;
  return diff > 0.05;  // update when price moved >5%
}
