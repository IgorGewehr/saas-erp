import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAgentRequest, agentAuthErrorResponse, parseAgentBody } from '@/lib/agent/auth';
import type { Business } from '@/lib/types';
import { isBusinessOpenNow } from '@/lib/utils/businessHours';

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

  const body = parseAgentBody<{ action: Action; params: Record<string, unknown> }>(ctx.rawBody);
  const { businessId } = ctx;

  try {
    switch (body.action) {
      case 'get_context':
        return NextResponse.json({ ok: true, data: await getContext(businessId) });
      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[agent/tools/business]', body.action, err);
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

  return {
    id: businessId,
    name: b.nomeFantasia || b.razaoSocial,
    useCase: b.settings?.useCase || 'servicos',
    description: b.settings?.aiAgent?.businessDescription || '',
    tone: b.settings?.aiAgent?.tone || 'friendly',
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
