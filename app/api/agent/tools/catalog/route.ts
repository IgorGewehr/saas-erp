import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Product } from '@/lib/types';

type Action = 'list_menu' | 'search' | 'get';

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
      case 'list_menu':
        return NextResponse.json({ ok: true, data: await listMenu(businessId, body.params.category as string | undefined) });
      case 'search':
        return NextResponse.json({ ok: true, data: await searchMenu(businessId, body.params.query as string) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getProduct(businessId, body.params.id as string) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent/tools/catalog]', body.action, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// Shape returned to the agent — strip internal/fiscal fields, keep what helps the user.
interface MenuItem {
  id: string;
  name: string;
  description?: string;
  category?: string;
  price: number;
  preparationTime?: number;
  imageUrl?: string;
  outOfStock: boolean;
  isKit: boolean;
}

function toMenuItem(p: Product, id: string): MenuItem {
  const isKit = !!(p.components && p.components.length > 0);
  return {
    id,
    name: p.name,
    description: p.menuDescription || p.description,
    category: p.menuCategory,
    price: p.salePrice,
    preparationTime: p.preparationTime,
    imageUrl: p.imageUrl,
    outOfStock: !isKit && p.currentStock <= 0,
    isKit,
  };
}

async function listMenu(businessId: string, category?: string) {
  let q = adminDb.collection('products')
    .where('businessId', '==', businessId)
    .where('isDeliverable', '==', true)
    .where('isActive', '==', true);
  if (category) q = q.where('menuCategory', '==', category);
  const snap = await q.get();
  const items = snap.docs.map(d => toMenuItem(d.data() as Product, d.id));
  items.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
  return { count: items.length, items };
}

async function searchMenu(businessId: string, query: string) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return { count: 0, items: [] };
  // Firestore doesn't support substring — load deliverables and filter in memory.
  const snap = await adminDb.collection('products')
    .where('businessId', '==', businessId)
    .where('isDeliverable', '==', true)
    .where('isActive', '==', true)
    .get();
  const items = snap.docs
    .map(d => toMenuItem(d.data() as Product, d.id))
    .filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q) ||
      (i.description || '').toLowerCase().includes(q),
    )
    .slice(0, 20);
  return { count: items.length, items };
}

async function getProduct(businessId: string, id: string) {
  const snap = await adminDb.collection('products').doc(id).get();
  if (!snap.exists) throw new Error('Product not found');
  const p = snap.data() as Product;
  if (p.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return toMenuItem(p, snap.id);
}
