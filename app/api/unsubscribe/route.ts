/**
 * GET  /api/unsubscribe?token=xxx — verifica token (não grava — pra preview seguro)
 * POST /api/unsubscribe?token=xxx — grava opt-out (chamado pelo botão da page)
 *
 * Endpoint PÚBLICO (sem auth). Acesso protegido apenas pelo token HMAC assinado
 * com `UNSUBSCRIBE_SECRET`. Não vaza informação sobre tenants — token inválido
 * retorna 400 genérico.
 *
 * Por que GET separado de POST: padrão de email best-practice — link em email
 * abre página (GET), botão grava (POST). Evita que prefetchers de email
 * (Outlook, Gmail) acidentalmente descadastrem o usuário ao "preview" do link.
 *
 * Idempotente: opt-outs duplicados sobrescrevem o mesmo doc (deterministic ID).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyUnsubscribeToken } from '@/lib/utils/unsubscribeToken';
import { checkRateLimit, getClientIp } from '@/lib/utils/rateLimit';
import type { MarketingOptOut } from '@/lib/types';

/** Cria document ID determinístico (limpa caracteres incompatíveis com Firestore). */
function buildDocId(businessId: string, channel: string, identifier: string): string {
  // Firestore doc IDs: <1500 bytes, sem '/'. Substitui caracteres "estranhos".
  const safe = identifier.toLowerCase().replace(/[^a-z0-9._@+-]/g, '_').slice(0, 200);
  return `${businessId}_${channel}_${safe}`;
}

export async function GET(req: NextRequest) {
  const clientIp = getClientIp(req);
  const { allowed } = checkRateLimit(`unsubscribe-get:${clientIp}`, 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const token = new URL(req.url).searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 400 });
  }

  // Retorna apenas o que a UI precisa exibir (não vaza dados sensíveis)
  return NextResponse.json({
    valid: true,
    channel: payload.channel,
    // Mascarar identifier parcialmente para evitar exposição em logs/screenshots
    identifierPreview: maskIdentifier(payload.identifier),
  });
}

export async function POST(req: NextRequest) {
  const clientIp = getClientIp(req);
  // Rate limit mais agressivo no POST: descadastro é ação rara (1-2 cliques por
  // pessoa, no máximo). 10/min é generoso e ainda freia bots.
  const { allowed } = checkRateLimit(`unsubscribe-post:${clientIp}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const token = new URL(req.url).searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Token inválido ou expirado' }, { status: 400 });
  }

  try {
    const docId = buildDocId(payload.businessId, payload.channel, payload.identifier);
    const optOut: MarketingOptOut = {
      id: docId,
      businessId: payload.businessId,
      channel: payload.channel,
      identifier: payload.identifier.toLowerCase(),
      source: 'unsubscribe-link',
      optedOutAt: new Date().toISOString(),
    };

    await adminDb.collection('marketingOptOuts').doc(docId).set(optOut);

    // Best-effort: também marca o CRMContact correspondente como optInMarketing=false
    // (não bloqueia se falhar — opt-out principal é o doc em marketingOptOuts).
    try {
      const fieldName = payload.channel === 'email' ? 'email' : 'whatsapp';
      const contactSnap = await adminDb.collection('crmContacts')
        .where('businessId', '==', payload.businessId)
        .where(fieldName, '==', payload.identifier.toLowerCase())
        .limit(1)
        .get();
      if (!contactSnap.empty) {
        await contactSnap.docs[0].ref.update({
          optInMarketing: false,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (linkErr) {
      console.warn('[unsubscribe] CRM link update failed (non-fatal):', linkErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[unsubscribe] Error saving opt-out:', err);
    return NextResponse.json({ error: 'Erro ao processar descadastro' }, { status: 500 });
  }
}

/** Mascarar para preview seguro: john@x.com → j***@x.com, 5511999998888 → ***998888 */
function maskIdentifier(id: string): string {
  if (id.includes('@')) {
    const [user, domain] = id.split('@');
    if (user.length <= 1) return `*@${domain}`;
    return `${user[0]}***@${domain}`;
  }
  if (id.length <= 4) return '*'.repeat(id.length);
  return `***${id.slice(-4)}`;
}
