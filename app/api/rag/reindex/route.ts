/**
 * Admin endpoint — trigger RAG reindex for the tenant.
 *
 * POST /api/rag/reindex
 * Auth: Firebase session (admin+ only)
 *
 * Walks products/services/snippets/business_desc and upserts chunks to
 * `knowledgeChunks`. Content-hash based dedup — unchanged chunks skip
 * re-embedding. Returns per-source stats.
 *
 * Cost: ~$0.02 per 1M tokens embedded. Typical tenant = $0.01-0.05 per full
 * reindex. Reindex is idempotent and safe to run often (cron every 6h works).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { reindexAll, reindexProducts, reindexServices, reindexSnippets, reindexBusinessDesc, type ReindexStats } from '@/lib/rag/reindex';

const ROLE_HIERARCHY: Record<string, number> = {
  founder: 100, admin: 80, manager: 60, operator: 40, viewer: 20,
};

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;
  const { businessId, role } = auth;

  if ((ROLE_HIERARCHY[role] || 0) < ROLE_HIERARCHY.admin) {
    return NextResponse.json({ ok: false, error: 'Role forbidden — admin or higher required' }, { status: 403 });
  }

  let body: { scope?: 'all' | 'products' | 'services' | 'snippets' | 'business_desc' } = {};
  try {
    body = await req.json();
  } catch { /* allow empty body — defaults to all */ }

  const scope = body.scope || 'all';
  const t0 = Date.now();
  let stats: ReindexStats[] = [];

  try {
    switch (scope) {
      case 'products':       stats = [await reindexProducts(businessId)]; break;
      case 'services':       stats = [await reindexServices(businessId)]; break;
      case 'snippets':       stats = [await reindexSnippets(businessId)]; break;
      case 'business_desc':  stats = [await reindexBusinessDesc(businessId)]; break;
      case 'all':
      default:               stats = await reindexAll(businessId); break;
    }
  } catch (err) {
    console.error('[rag.reindex] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      scope,
      totalDurationMs: Date.now() - t0,
      stats,
      summary: {
        upserted: stats.reduce((n, s) => n + s.upserted, 0),
        skipped: stats.reduce((n, s) => n + s.skipped, 0),
        pruned: stats.reduce((n, s) => n + s.pruned, 0),
        errors: stats.reduce((n, s) => n + s.errors, 0),
      },
    },
  });
}
