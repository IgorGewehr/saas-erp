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
 *   - reverse_stock      reverse a V2 import with compensating movements
 *   - link_financial     create the deterministic payable/paid transaction
 */

import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { PurchaseNote, PurchaseNoteItem, PurchaseNoteStatus, Product } from '@/lib/types';
import { applyStockOperationAdmin } from '@/lib/services/stock-core-admin';
import {
  confirmPurchaseNoteAdmin,
  PurchaseNoteClaimConflictError,
  PurchaseNoteNotReadyError,
  PurchaseNoteNotReversibleError,
  PurchaseNoteReversalBlockedError,
  PurchaseNoteReversalConflictError,
  reversePurchaseNoteAdmin,
} from '@/lib/services/purchase-import-admin';
import {
  linkPurchaseFinancialAdmin,
  PurchaseFinancialConflictError,
  PurchaseFinancialNotReadyError,
  PurchaseFinancialReferenceError,
} from '@/lib/services/purchase-financial-admin';
import { PurchaseFinancialIntentSchema } from '@/lib/contracts/api/purchase-note-financial';
import { PurchaseNoteExternalListQuerySchema } from '@/lib/contracts/api/purchase-note-external';
import { getPurchaseNoteAdmin, listPurchaseNotesAdmin } from '@/lib/services/purchase-query-admin';

type Action = 'list' | 'get' | 'match_products' | 'apply_to_stock' | 'list_unmatched' | 'reverse_stock' | 'link_financial';

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
        return NextResponse.json({ ok: true, data: await listNotesForAgent(businessId, body.params) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getPurchaseNoteAdmin({ db: adminDb, businessId, noteId: body.params.id as string }) });
      case 'match_products':
        return NextResponse.json({ ok: true, data: await matchProducts(businessId, body.params.id as string) });
      case 'apply_to_stock':
        return NextResponse.json({ ok: true, data: await applyToStock(businessId, body.params.id as string, body.params.operatorId as string | undefined, body.params.operatorName as string | undefined) });
      case 'list_unmatched':
        return NextResponse.json({ ok: true, data: await listUnmatched(businessId, body.params.limit as number | undefined) });
      case 'reverse_stock':
        return NextResponse.json({ ok: true, data: await reverseStock(
          businessId,
          body.params.id as string,
          body.params.reason as string,
          body.params.operatorId as string | undefined,
          body.params.operatorName as string | undefined,
        ) });
      case 'link_financial':
        return NextResponse.json({ ok: true, data: await linkFinancial(
          businessId,
          body.params as {
            id?: string;
            mode?: unknown;
            dueDate?: unknown;
            bankAccountId?: unknown;
            paymentDate?: unknown;
            paymentMethod?: unknown;
            operatorId?: string;
            operatorName?: string;
          },
        ) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.purchase-notes] error', err);
    if (err instanceof ZodError) {
      return NextResponse.json({ ok: false, error: 'Invalid purchase note parameters', details: err.flatten() }, { status: 400 });
    }
    if (
      err instanceof PurchaseNoteClaimConflictError ||
      err instanceof PurchaseNoteNotReadyError ||
      err instanceof PurchaseNoteNotReversibleError ||
      err instanceof PurchaseNoteReversalBlockedError ||
      err instanceof PurchaseNoteReversalConflictError ||
      err instanceof PurchaseFinancialConflictError ||
      err instanceof PurchaseFinancialNotReadyError ||
      err instanceof PurchaseFinancialReferenceError
    ) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

// ─── Matching ────────────────────────────────────────────────────────────────

async function matchProducts(businessId: string, id: string): Promise<{
  note: PurchaseNote;
  matched: Array<{ item: PurchaseNoteItem; product: Product; confidence: number }>;
  unmatched: PurchaseNoteItem[];
}> {
  const note = await getPurchaseNoteAdmin({ db: adminDb, businessId, noteId: id });
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
  if (note.schemaVersion === 2) {
    const confirmed = await confirmPurchaseNoteAdmin({
      db: adminDb,
      businessId,
      noteId: id,
      actor: { uid: operatorId || 'agent', name: operatorName || 'Agente IA', type: 'agent' },
      retryFailed: note.status === 'parcial' || note.status === 'falha',
    });
    return {
      note: confirmed.note as unknown as PurchaseNote,
      movementsCreated: confirmed.importedCount,
      unmatchedCount: confirmed.errorCount,
    };
  }
  if (note.stockImportedAt) throw new Error('Already imported to stock — cannot re-apply');

  // Match products
  const { matched, unmatched } = await matchProducts(businessId, id);

  if (matched.length === 0) {
    throw new Error('No products matched — review unmatched items first');
  }

  const now = new Date().toISOString();
  const stockResult = await applyStockOperationAdmin(adminDb, {
    businessId,
    type: 'entrada',
    lines: matched.map(({ item, product }) => ({
      productId: product.id,
      quantity: item.quantity,
      ...(item.cProd ? { sourceLineId: item.cProd } : {}),
    })),
    operatorId: operatorId || 'agent',
    operatorName: operatorName || 'Agente IA',
    reason: `NF ${note.numero}/${note.serie} — ${note.supplierName}`,
    sourceType: 'purchase',
    sourceId: id,
    sourceDocument: { collection: 'purchaseNotes', id, existence: 'required' },
    idempotencyKey: `purchase:${id}:stock-import`,
    expandBom: false,
    negativeStockPolicy: 'prevent',
  });
  const movementIds = stockResult.adjustments.map((item) => item.movementId);

  // Custos + status da nota ficam num batch próprio. Se ele falhar, o retry
  // reaproveita a operação de estoque acima sem duplicar os saldos.
  const batch = adminDb.batch();

  for (const { item, product } of matched) {
    const productRef = adminDb.collection('products').doc(product.id);
    batch.update(productRef, {
      // Update cost price if it moved meaningfully (± 5%)
      costPrice: shouldUpdateCost(product.costPrice, item.unitPrice) ? item.unitPrice : product.costPrice,
      updatedAt: now,
    });
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
    movementsCreated: movementIds.length,
    unmatchedCount: unmatched.length,
  };
}

async function reverseStock(
  businessId: string,
  id: string,
  reason: string,
  operatorId?: string,
  operatorName?: string,
): Promise<{ note: PurchaseNote; movementsReversed: number }> {
  if (!id) throw new Error('id required');
  const snapshot = await adminDb.collection('purchaseNotes').doc(id).get();
  if (!snapshot.exists) throw new Error('Note not found');
  const note = snapshot.data() as PurchaseNote;
  if (note.businessId !== businessId) throw new Error('Cross-tenant access denied');
  if (note.schemaVersion !== 2) throw new Error('Only V2 purchase notes support safe automatic reversal');
  const reversed = await reversePurchaseNoteAdmin({
    db: adminDb,
    businessId,
    noteId: id,
    reason,
    actor: { uid: operatorId || 'agent', name: operatorName || 'Agente IA', type: 'agent' },
  });
  return {
    note: reversed.note as unknown as PurchaseNote,
    movementsReversed: reversed.reversedCount,
  };
}

async function listNotesForAgent(businessId: string, params: Record<string, unknown>): Promise<PurchaseNote[]> {
  const parsed = PurchaseNoteExternalListQuerySchema.parse({
    ...(params.status !== undefined ? { status: params.status } : {}),
    ...(params.supplierId !== undefined ? { supplierId: params.supplierId } : {}),
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
  });
  return (await listPurchaseNotesAdmin({
    db: adminDb,
    businessId,
    status: parsed.status,
    supplierId: parsed.supplierId,
    limit: parsed.limit,
  })).notes;
}

async function linkFinancial(
  businessId: string,
  params: {
    id?: string;
    mode?: unknown;
    dueDate?: unknown;
    bankAccountId?: unknown;
    paymentDate?: unknown;
    paymentMethod?: unknown;
    operatorId?: string;
    operatorName?: string;
  },
) {
  if (!params.id) throw new Error('id required');
  const intent = PurchaseFinancialIntentSchema.parse({
    mode: params.mode,
    ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}),
    ...(params.bankAccountId !== undefined ? { bankAccountId: params.bankAccountId } : {}),
    ...(params.paymentDate !== undefined ? { paymentDate: params.paymentDate } : {}),
    ...(params.paymentMethod !== undefined ? { paymentMethod: params.paymentMethod } : {}),
  });
  return linkPurchaseFinancialAdmin({
    db: adminDb,
    businessId,
    noteId: params.id,
    intent: { businessId, noteId: params.id, ...intent },
    actor: {
      uid: params.operatorId || 'agent',
      name: params.operatorName || 'Agente IA',
      type: 'agent',
    },
  });
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
