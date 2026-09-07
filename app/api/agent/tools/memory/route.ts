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
import { parseToolRequest, validateToolResponse, isContractError } from '@/contracts/_runtime/agentToolValidation';

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

  const rawBody = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  // R6/SDD: valida request com Zod no boundary (espelha a route de agenda/financial).
  // Shape inválido -> ContractError -> 400 com error envelope estruturado.
  let action: Action;
  let params: Record<string, unknown>;
  try {
    const parsed = parseToolRequest('memory', rawBody);
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
      case 'recall': {
        const contactId = params.contactId as string;
        if (!contactId) throw new Error('contactId required');
        const doc = await getMemory(businessId, contactId);
        data = {
          contactId,
          // Achado real: `MemoryFact` (lib/rag/memory.ts) não carrega
          // `contactId` — o doc só o guarda no nível do documento (o path já
          // isola por contato). O contrato agent-facing promete o campo por
          // fact (auto-descritivo pro agente), então denormaliza aqui.
          facts: (doc?.facts || [])
            .filter((f) => !f.validUntil || f.validUntil > new Date().toISOString())
            .map((f) => ({ ...f, contactId })),
        };
        break;
      }

      case 'remember': {
        const p = params as unknown as RememberParams;
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
        // Mesmo motivo do `recall` acima — addFact() não devolve contactId.
        data = { ...fact, contactId: p.contactId };
        break;
      }

      case 'forget': {
        const contactId = params.contactId as string;
        const factId = params.factId as string;
        if (!contactId || !factId) throw new Error('contactId and factId required');
        const removed = await removeFact(businessId, contactId, factId);
        data = { removed };
        break;
      }

      case 'clear': {
        const contactId = params.contactId as string;
        if (!contactId) throw new Error('contactId required');
        await clearMemory(businessId, contactId);
        data = { cleared: true };
        break;
      }

      default: {
        const exhaustiveCheck: never = action;
        return NextResponse.json({ ok: false, error: `Unknown action: ${exhaustiveCheck}` }, { status: 400 });
      }
    }

    // SDD: valida shape do response em dev (lança); em prod loga e segue.
    const validated = validateToolResponse('memory', action, data);
    return NextResponse.json({ ok: true, data: validated });
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: err.code === 'INTERNAL' ? 500 : 400 });
    }
    console.error('[agent.memory] error', err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
