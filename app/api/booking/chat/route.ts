/**
 * Public booking chat endpoint — no Firebase Auth required.
 *
 * POST /api/booking/chat
 *
 * Body:
 *   {
 *     slug: string;                           // business slug
 *     message: string;                        // visitor's message
 *     sessionId: string;                      // client-generated UUID (localStorage)
 *     contactName?: string;                   // filled after agent asks
 *     contactPhone?: string;
 *     history: { role: 'user'|'assistant'; content: string }[];  // last ~10 turns
 *   }
 *
 * Returns: { ok: true, response: string } | { ok: false, error: string }
 *
 * Unlike the WhatsApp/FB/IG flow (fire-and-forget), this route awaits the
 * agent synchronously and returns the final_response in the HTTP body.
 * The Python agent skips send_final_message for channel='web'.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import type { Business, BusinessSegment, WeeklySession } from '@/lib/types';
import { SEGMENT_VOCAB } from '@/lib/types';

export const runtime = 'nodejs';

const AGENT_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8080';
const SECRET = process.env.AGENT_SHARED_SECRET;

// Simple in-memory rate limiter: max 30 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  if (entry.count >= 30) return true;
  entry.count++;
  return false;
}

export async function POST(req: NextRequest) {
  // Rate limit by IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ ok: false, error: 'Too many requests' }, { status: 429 });
  }

  let body: {
    slug: string;
    message: string;
    sessionId: string;
    contactName?: string;
    contactPhone?: string;
    history?: { role: string; content: string }[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { slug, message, sessionId, contactName, contactPhone, history = [] } = body;

  if (!slug || !message?.trim() || !sessionId) {
    return NextResponse.json({ ok: false, error: 'slug, message and sessionId are required' }, { status: 400 });
  }

  if (!SECRET) {
    return NextResponse.json({ ok: false, error: 'Agent not configured' }, { status: 503 });
  }

  // Resolve slug → business
  let business: Business;
  try {
    const bizSnap = await adminDb
      .collection('businesses')
      .where('slug', '==', slug)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (bizSnap.empty) {
      return NextResponse.json({ ok: false, error: 'Business not found' }, { status: 404 });
    }
    business = { ...bizSnap.docs[0].data(), id: bizSnap.docs[0].id } as Business;
  } catch (err) {
    console.error('[booking/chat] business lookup failed:', err);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }

  // Check agent is enabled for this business
  if (!business.settings?.aiAgent?.enabled) {
    // Fallback: return a polite message asking them to call
    return NextResponse.json({
      ok: true,
      response: `Olá! Para agendar, entre em contato conosco pelo telefone ${business.phone || ''} ou pelas nossas redes sociais. Aguardamos você!`,
    });
  }

  // Pre-load services list — web visitors frequently ask "what services do you have?"
  // capacity/sessions são aditivos: presentes só quando o serviço é turma (capacity>1),
  // permitindo ao agente contar vagas sem nova tool call. Serviços exclusivos não os enviam.
  type ServiceSnapshot = {
    id: string; name: string; price: number; duration: number;
    category?: string; description?: string;
    capacity?: number; sessions?: WeeklySession[];
  };
  let servicesList: ServiceSnapshot[] = [];
  const useCase = business.settings?.useCase || 'servicos';
  if (useCase === 'servicos') {
    try {
      const servicesSnap = await adminDb.collection('services')
        .where('businessId', '==', business.id)
        .where('isActive', '==', true)
        .get();
      servicesList = servicesSnap.docs.map(d => {
        const s = d.data();
        const capacity = typeof s.capacity === 'number' ? (s.capacity as number) : undefined;
        const sessions = Array.isArray(s.sessions) ? (s.sessions as WeeklySession[]) : undefined;
        return {
          id: d.id,
          name: s.name as string,
          price: (s.price as number) || 0,
          duration: (s.duration as number) || 60,
          ...(s.category ? { category: s.category as string } : {}),
          ...(s.description ? { description: s.description as string } : {}),
          ...(capacity !== undefined ? { capacity } : {}),
          ...(sessions && sessions.length > 0 ? { sessions } : {}),
        };
      });
    } catch { /* non-fatal — agent falls back to agenda_list_services tool */ }
  }

  // Ramo/vertical — humaniza o agente sem viés salão. Ausente → 'generico'.
  const segment: BusinessSegment = business.settings?.aiAgent?.segment || 'generico';
  const segmentVocab = SEGMENT_VOCAB[segment];

  // Compute today's effective opening hours (applies holidays + seasonal overrides)
  const todayIso = new Date().toISOString().slice(0, 10);
  // Rótulo humano com dia da semana no fuso do business — o agente resolve
  // "quinta" pela PRÓXIMA ocorrência em vez de adivinhar o weekday da ISO crua.
  const agentTz = business.settings?.timezone || 'America/Sao_Paulo';
  const currentDateLabel =
    `${new Intl.DateTimeFormat('pt-BR', { timeZone: agentTz, weekday: 'long' }).format(new Date())} ` +
    `${new Intl.DateTimeFormat('pt-BR', { timeZone: agentTz, day: '2-digit', month: '2-digit' }).format(new Date())}`;
  const holidays = business.settings?.aiAgent?.calendar?.holidays || [];
  const isClosedToday = holidays.includes(todayIso);
  const seasonalHours = business.settings?.aiAgent?.calendar?.seasonalHours || [];
  const activeSeason = seasonalHours.find((s) => todayIso >= s.fromDate && todayIso <= s.toDate);
  const effectiveHours = activeSeason?.hours || business.settings?.openingHours || null;

  // Build agent payload — channel='web' so send_final_message is skipped
  const agentPayload = {
    message_id: `web_${sessionId}_${Date.now()}`,
    conversation_id: `web_${business.id}_${sessionId}`,
    message: message.trim(),
    contact_name: contactName || 'Visitante',
    contact_phone: contactPhone || null,
    channel: 'web',
    recipient_id: sessionId, // not used for web, but required by schema
    history: history.slice(-10), // last 10 turns
    use_case: useCase,
    // Ramo/vertical (snake_case no fio) — ajusta vocabulário/persona do /agent.
    segment,
    segment_vocab: segmentVocab,
    business_name: business.nomeFantasia || business.razaoSocial,
    business_description: business.settings?.aiAgent?.businessDescription || null,
    tone: business.settings?.aiAgent?.tone || 'friendly',
    pedidos_settings: business.settings?.aiAgent?.pedidos || null,
    agenda_settings: business.settings?.aiAgent?.agenda || null,
    client_memory: null,
    // Business operational context (Wave 7 — policy-aware)
    opening_hours: effectiveHours,
    address: business.endereco || null,
    services_list: servicesList.length > 0 ? servicesList : null,
    current_date: currentDateLabel,
    policies: business.settings?.aiAgent?.policies || null,
    sla: business.settings?.aiAgent?.sla || null,
    is_closed_today: isClosedToday,
    seasonal_label: activeSeason?.label || null,
    delivery_zones: business.settings?.aiAgent?.deliveryZones || null,
    accepted_payment_methods: business.settings?.aiAgent?.acceptedPaymentMethods || null,
    upsell_rules: (business.settings?.aiAgent?.upsellRules || []).filter((r) => r.isActive),
  };

  const raw = JSON.stringify(agentPayload);
  const ts = Date.now();
  const sigMessage = `${ts}.${business.id}.${raw}`;
  const signature = crypto.createHmac('sha256', SECRET).update(sigMessage).digest('hex');

  // Call agent synchronously — wait up to 30s (agent has its own iteration cap)
  try {
    const agentRes = await fetch(`${AGENT_URL.replace(/\/$/, '')}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-signature': signature,
        'x-agent-timestamp': String(ts),
        'x-business-id': business.id,
      },
      body: raw,
      signal: AbortSignal.timeout(30_000),
    });

    if (!agentRes.ok) {
      const errText = await agentRes.text().catch(() => '');
      console.error('[booking/chat] agent error:', agentRes.status, errText);
      return NextResponse.json(
        { ok: false, error: 'Agent unavailable, please try again' },
        { status: 503 },
      );
    }

    const agentData = await agentRes.json() as {
      final_response?: string | null;
      status: string;
      error?: string | null;
    };

    const response = agentData.final_response
      || 'Desculpe, não consegui processar sua mensagem. Tente novamente.';

    return NextResponse.json({ ok: true, response });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    console.error('[booking/chat] fetch failed:', err);
    return NextResponse.json(
      {
        ok: false,
        error: isTimeout
          ? 'Agent took too long to respond. Please try again.'
          : 'Agent unavailable',
      },
      { status: 503 },
    );
  }
}
