import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Business, BusinessSegment } from '@/lib/types';
import { SEGMENT_VOCAB } from '@/lib/types';
import { isBusinessOpenNow } from '@/lib/utils/businessHours';
import { parseToolRequest, validateToolResponse, isContractError } from '@/contracts/_runtime/agentToolValidation';

type Action = 'get_context';

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
    const parsed = parseToolRequest('business', rawBody);
    action = parsed.action as Action;
    params = parsed.params as Record<string, unknown>;
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: 400 });
    }
    throw err;
  }
  void params; // get_context não tem params além de {} (validado acima)

  try {
    let data: unknown;
    switch (action) {
      case 'get_context':
        data = await getContext(businessId);
        break;
      default: {
        const exhaustiveCheck: never = action;
        return NextResponse.json({ ok: false, error: `Unknown action: ${exhaustiveCheck}` }, { status: 400 });
      }
    }

    // SDD: valida shape do response em dev (lança); em prod loga e segue.
    const validated = validateToolResponse('business', action, data);
    return NextResponse.json({ ok: true, data: validated });
  } catch (err) {
    if (isContractError(err)) {
      return NextResponse.json(err.toEnvelope(), { status: err.code === 'INTERNAL' ? 500 : 400 });
    }
    console.error('[agent/tools/business]', action, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

async function getContext(businessId: string) {
  const snap = await adminDb.collection('businesses').doc(businessId).get();
  if (!snap.exists) throw new Error('Business not found');
  const b = snap.data() as Business;
  const now = new Date();
  const tz = b.settings?.timezone || 'America/Sao_Paulo';

  // Compute open/closed state via helper compartilhado (mesma regra do guardrail
  // de pedidos off-hours).
  const hours = b.settings?.openingHours;
  const isOpen = isBusinessOpenNow(hours, tz, now);

  // Achado real: o contrato (BusinessGetContextDataSchema) já promete
  // `segment`/`segmentVocab` — mesmo cálculo usado por lib/agent/dispatch.ts
  // e app/api/booking/chat/route.ts para humanizar o vocabulário do agente
  // por ramo — mas o handler nunca os calculava nem os incluía na resposta.
  const segment: BusinessSegment = b.settings?.aiAgent?.segment || 'generico';
  const segmentVocab = SEGMENT_VOCAB[segment];

  return {
    id: businessId,
    name: b.nomeFantasia || b.razaoSocial,
    useCase: b.settings?.useCase || 'servicos',
    description: b.settings?.aiAgent?.businessDescription || '',
    tone: b.settings?.aiAgent?.tone || 'friendly',
    segment,
    segmentVocab,
    timezone: tz,
    currency: b.settings?.currency || 'BRL',
    address: b.endereco,
    phone: b.phone,
    openingHours: hours || null,
    isOpenNow: isOpen,
    delivery: b.settings?.delivery || null,
    promotions: (b.settings?.promotions || []).filter(p => p.isActive),
  };
}
