import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Product } from '@/lib/types';

type Action = 'list_menu' | 'search' | 'get' | 'list_categories';

// ─── Fuzzy match helpers ─────────────────────────────────────────────────────

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const n = a.length, m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const prev = new Array(m + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= n; i++) {
    let prevRow = prev[0];
    prev[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1]
        ? prevRow
        : 1 + Math.min(prev[j - 1], prev[j], prevRow);
      prevRow = tmp;
    }
  }
  return prev[m];
}

/** Score a product against a query. Higher is better; 0 means no match at all. */
function scoreProduct(query: string, product: Product): number {
  const q = normalize(query);
  if (!q) return 0;
  const name = normalize(product.name);
  const cat = normalize(product.menuCategory || product.category || '');
  const desc = normalize(product.menuDescription || product.description || '');

  // Exact or substring hits (strongest signals)
  if (name === q) return 100;
  if (name.startsWith(q)) return 85;
  if (name.includes(q)) return 70;
  if (cat.includes(q)) return 50;
  if (desc.includes(q)) return 35;

  // Token-level fuzzy — handles typos like "margueritta" → "margherita"
  const qTokens = q.split(' ').filter(t => t.length >= 3);
  const nameTokens = name.split(' ').filter(t => t.length >= 3);
  let fuzzyScore = 0;
  for (const qt of qTokens) {
    for (const nt of nameTokens) {
      const dist = levenshtein(qt, nt);
      // Allow 1 edit per 4 chars; accept up to 2 total
      if (dist <= Math.max(1, Math.floor(Math.min(qt.length, nt.length) / 4)) && dist <= 2) {
        fuzzyScore += 20 / (dist + 1);
      }
    }
  }
  return fuzzyScore > 0 ? Math.min(60, Math.round(fuzzyScore)) : 0;
}

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
        return NextResponse.json({ ok: true, data: await listMenu(
          businessId,
          body.params.category as string | undefined,
          body.params.dietary as string[] | undefined,
        ) });
      case 'search':
        return NextResponse.json({ ok: true, data: await searchMenu(
          businessId,
          body.params.query as string,
          body.params.dietary as string[] | undefined,
        ) });
      case 'get':
        return NextResponse.json({ ok: true, data: await getProduct(businessId, body.params.id as string) });
      case 'list_categories':
        return NextResponse.json({ ok: true, data: await listCategories(businessId) });
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
  dietary?: string[];
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
    dietary: p.dietary,
  };
}

function matchesDietary(product: Product, filters: string[]): boolean {
  if (!filters || filters.length === 0) return true;
  const have = new Set((product.dietary || []).map(d => d.toLowerCase()));
  return filters.every(f => have.has(f.toLowerCase()));
}

async function listMenu(businessId: string, category?: string, dietary?: string[]) {
  let q = adminDb.collection('products')
    .where('businessId', '==', businessId)
    .where('isDeliverable', '==', true)
    .where('isActive', '==', true);
  if (category) q = q.where('menuCategory', '==', category);
  const snap = await q.get();
  const filtered = snap.docs
    .map(d => ({ product: d.data() as Product, id: d.id }))
    .filter(({ product }) => matchesDietary(product, dietary || []));
  const items = filtered.map(({ product, id }) => toMenuItem(product, id));
  items.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
  return { count: items.length, items };
}

async function searchMenu(businessId: string, query: string, dietary?: string[]) {
  const q = (query || '').trim();
  if (!q) return { count: 0, items: [] };
  const snap = await adminDb.collection('products')
    .where('businessId', '==', businessId)
    .where('isDeliverable', '==', true)
    .where('isActive', '==', true)
    .get();
  const scored = snap.docs
    .map(d => {
      const p = d.data() as Product;
      if (!matchesDietary(p, dietary || [])) return null;
      const score = scoreProduct(q, p);
      if (score <= 0) return null;
      return { score, item: toMenuItem(p, d.id) };
    })
    .filter((x): x is { score: number; item: MenuItem } => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  return { count: scored.length, items: scored.map(s => s.item) };
}

async function listCategories(businessId: string) {
  const snap = await adminDb.collection('products')
    .where('businessId', '==', businessId)
    .where('isDeliverable', '==', true)
    .where('isActive', '==', true)
    .get();
  const tally = new Map<string, number>();
  for (const d of snap.docs) {
    const cat = (d.data() as Product).menuCategory;
    if (cat) tally.set(cat, (tally.get(cat) || 0) + 1);
  }
  const categories = Array.from(tally.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return { categories };
}

async function getProduct(businessId: string, id: string) {
  const snap = await adminDb.collection('products').doc(id).get();
  if (!snap.exists) throw new Error('Product not found');
  const p = snap.data() as Product;
  if (p.businessId !== businessId) throw new Error('Cross-tenant access denied');
  return toMenuItem(p, snap.id);
}
