/**
 * Agent tool: persistent facts per (business, contact).
 *
 * The agent uses this to remember preferences, allergies, special requests —
 * things it should carry across conversations beyond the short-term history:
 *
 *   - recall    → fetch all non-expired facts for a contact
 *   - remember  → add or merge a fact (de-dups by text)
 *   - forget    → remove a specific fact by id
 *   - clear     → wipe all memory for this contact (use with care)
 *
 * Storage path: `businesses/{businessId}/agentMemory/{contactId}`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import { getMemory, addFact, removeFact, clearMemory } from '@/lib/rag/memory';

type Action = 'recall' | 'remember' | 'forget' | 'clear';

interface RememberParams {
  contactId: string;
  text: string;
  evidence?: string;
  confidence?: number;
  validUntil?: string;
  tags?: string[];
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
      case 'recall': {
        const contactId = body.params.contactId as string;
        if (!contactId) throw new Error('contactId required');
        const doc = await getMemory(businessId, contactId);
        return NextResponse.json({
          ok: true,
          data: {
            contactId,
            facts: (doc?.facts || []).filter((f) => !f.validUntil || f.validUntil > new Date().toISOString()),
          },
        });
      }

      case 'remember': {
        const p = body.params as unknown as RememberParams;
        if (!p.contactId) throw new Error('contactId required');
        if (!p.text) throw new Error('text required');
        const fact = await addFact({
          businessId,
          contactId: p.contactId,
          text: p.text,
          evidence: p.evidence,
          confidence: p.confidence,
          validUntil: p.validUntil,
          tags: p.tags,
        });
        return NextResponse.json({ ok: true, data: fact });
      }

      case 'forget': {
        const contactId = body.params.contactId as string;
        const factId = body.params.factId as string;
        if (!contactId || !factId) throw new Error('contactId and factId required');
        const removed = await removeFact(businessId, contactId, factId);
        return NextResponse.json({ ok: true, data: { removed } });
      }

      case 'clear': {
        const contactId = body.params.contactId as string;
        if (!contactId) throw new Error('contactId required');
        await clearMemory(businessId, contactId);
        return NextResponse.json({ ok: true, data: { cleared: true } });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent.memory] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
