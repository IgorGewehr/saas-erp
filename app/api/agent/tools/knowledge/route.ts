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
import { parseToolRequest, validateToolResponse, isContractError } from '@/contracts/_runtime/agentToolValidation';

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

  const rawBody = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  // R6/SDD: valida request com Zod no boundary (espelha financial/agenda).
  // Shape inválido -> ContractError -> 400 com error envelope estruturado.
  let action: Action;
  let params: Record<string, unknown>;
  try {
    const parsed = parseToolRequest('knowledge', rawBody);
    action = parsed.action as Action;
    params = parsed.params as Record<string, unknown>;
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: 400 });
    }
    throw err;
  }

  try {
    let data: unknown;
    switch (action) {
      case 'search':
        data = await search(businessId, params as unknown as SearchParams);
        break;
      default: {
        const exhaustiveCheck: never = action;
        return NextResponse.json({ ok: false, error: `Unknown action: ${exhaustiveCheck}` }, { status: 400 });
      }
    }

    // SDD: valida shape do response em dev (lança); em prod loga e segue.
    const validated = validateToolResponse('knowledge', action, data);
    return NextResponse.json({ ok: true, data: validated });
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: err.code === 'INTERNAL' ? 500 : 400 });
    }
    console.error('[agent.knowledge] error', action, err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

async function search(businessId: string, p: SearchParams) {
  if (!p.query || typeof p.query !== 'string') throw new Error('query required');

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
  return {
    query: p.query,
    count: results.length,
    results: results.map((r) => ({
      source: r.chunk.source,
      sourceId: r.chunk.sourceId,
      text: r.chunk.text,
      // Achado: `KnowledgeChunk.metadata` é opcional em lib/rag/store.ts (pode
      // ser `undefined` em chunks sem metadata) mas o contrato exige um objeto
      // (`z.object({}).passthrough()`, não `.optional()`) — sem o fallback,
      // validateToolResponse rejeitava (dev) ou logava diff silencioso (prod)
      // sempre que um chunk indexado sem metadata aparecesse nos resultados.
      metadata: r.chunk.metadata ?? {},
      score: Math.round(r.score * 1000) / 1000,
    })),
  };
}
