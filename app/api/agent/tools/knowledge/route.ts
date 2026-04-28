/**
 * Agent tool: semantic search over the tenant's knowledge base.
 *
 * Chunks are indexed in `knowledgeChunks/{id}` by the reindex flow (products,
 * services, snippets, business description). The agent uses this when it
 * needs to answer questions that don't have a single-lookup tool:
 *
 *   - "vocês têm alguma comida vegana?"
 *   - "qual política de cancelamento?"
 *   - "me fala sobre o estabelecimento"
 *
 * Returns top-K chunks with similarity score + metadata. The agent picks
 * what to cite/paraphrase.
 *
 * Actions:
 *   - search               query string + optional source filter + k
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import { searchKnowledge, type KnowledgeSource } from '@/lib/rag/store';

type Action = 'search';

interface SearchParams {
  query: string;
  k?: number;
  sources?: KnowledgeSource[];
  minScore?: number;
}

const VALID_SOURCES: KnowledgeSource[] = ['product', 'service', 'snippet', 'faq', 'business_desc', 'policy'];

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
    if (body.action !== 'search') {
      return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }

    const p = body.params as unknown as SearchParams;
    if (!p.query || typeof p.query !== 'string') {
      return NextResponse.json({ ok: false, error: 'query required' }, { status: 400 });
    }

    const sources = Array.isArray(p.sources)
      ? p.sources.filter((s) => VALID_SOURCES.includes(s as KnowledgeSource))
      : undefined;

    const results = await searchKnowledge({
      businessId,
      query: p.query,
      k: p.k,
      sources: sources?.length ? sources : undefined,
      minScore: p.minScore,
    });

    // Return the minimum useful shape — avoid leaking full embedding array
    return NextResponse.json({
      ok: true,
      data: {
        query: p.query,
        count: results.length,
        results: results.map((r) => ({
          source: r.chunk.source,
          sourceId: r.chunk.sourceId,
          text: r.chunk.text,
          metadata: r.chunk.metadata,
          score: Math.round(r.score * 1000) / 1000,
        })),
      },
    });
  } catch (err) {
    console.error('[agent.knowledge] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
