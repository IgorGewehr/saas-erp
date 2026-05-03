/**
 * Operator chat — dashboard-facing conversational interface to the agent.
 *
 * Auth: Firebase Auth session (Bearer idToken). NOT HMAC.
 *   - validates businessId ownership via verifyAuth
 *   - passes user identity through to the Python agent for audit + tool gating
 *
 * Flow:
 *   UI POST /api/agent/operator/chat { message, history, sessionId? }
 *     ↓ verifyAuth (Firebase idToken → uid + businessId + role)
 *     ↓ fetch business for tone/description/settings
 *     ↓ call Python /process with use_case='operator' + operator context
 *     ↓ return { response, runId, actions[] }
 *
 * History is client-managed (passed on every request). The server is stateless
 * except for audit writes. This keeps the endpoint simple and resumable.
 */

import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit } from '@/lib/agent/rate-limit';
import { isCircuitAllowed, recordSuccess, recordFailure } from '@/lib/agent/circuit-breaker';
import type { Business, User } from '@/lib/types';

const AGENT_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8080';
const SECRET = process.env.AGENT_SHARED_SECRET;

interface OperatorChatRequest {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  sessionId?: string;         // optional client-supplied id to group runs
  mode?: 'operator' | 'analyst';  // 'analyst' mode focuses on data queries and insights
}

interface OperatorChatResponse {
  ok: true;
  runId: string;
  response: string | null;
  intent: string | null;
  toolCalls: Array<{ name: string; args?: unknown; error?: string }>;
  durationMs: number;
  costUsd: number;
  autonomous: boolean;
  /** When Python returned status='error' or 'skipped', this carries the reason. */
  agentStatus?: 'success' | 'error' | 'skipped';
  agentError?: string;
}

export async function POST(req: NextRequest) {
  // 1. Auth — Firebase session
  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;
  const { uid, businessId, role } = auth;

  if (!SECRET) {
    return NextResponse.json({ ok: false, error: 'AGENT_SHARED_SECRET not configured' }, { status: 500 });
  }

  // 2. Parse body
  let body: OperatorChatRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ ok: false, error: 'message required' }, { status: 400 });
  }
  body.message = body.message.trim();
  if (body.message.length > 4000) {
    return NextResponse.json({ ok: false, error: 'message too long (max 4000 chars)' }, { status: 400 });
  }

  // 3. Enforce role — viewer cannot drive the operator agent (read-only)
  const rolePriority: Record<string, number> = { founder: 100, admin: 80, manager: 60, operator: 40, viewer: 20 };
  if ((rolePriority[role] || 0) < rolePriority.operator) {
    return NextResponse.json({ ok: false, error: 'Role forbidden — operator or higher required' }, { status: 403 });
  }

  // Circuit breaker — surface a helpful 503 to the UI when tenant is in cool-down
  const circuitOk = await isCircuitAllowed(businessId);
  if (!circuitOk) {
    return NextResponse.json(
      { ok: false, error: 'Agente temporariamente indisponível — tentativas recentes falharam. Retorne em alguns minutos.' },
      { status: 503 },
    );
  }

  // Rate limit operator surface (separate bucket from inbound messaging)
  const rl = await checkRateLimit(businessId, 'operator');
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: `Muitas requisições, aguarde ${rl.retryAfterSec ?? 60}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 60) } },
    );
  }

  // 4. Fetch business + user
  const [bizDoc, userDoc] = await Promise.all([
    adminDb.collection('businesses').doc(businessId).get(),
    adminDb.collection('users').doc(uid).get(),
  ]);
  if (!bizDoc.exists || !userDoc.exists) {
    return NextResponse.json({ ok: false, error: 'Business or user not found' }, { status: 404 });
  }
  const business = bizDoc.data() as Business;
  const user = userDoc.data() as User;

  const autonomous = !!business.settings?.aiAgent?.operator?.autonomousMode;
  const sessionId = body.sessionId || `${uid}_${Date.now()}`;

  // Compute today's effective opening hours (applies holidays + seasonal overrides)
  const todayIso = new Date().toISOString().slice(0, 10);
  const holidays = business.settings?.aiAgent?.calendar?.holidays || [];
  const isClosedToday = holidays.includes(todayIso);
  const seasonalHours = business.settings?.aiAgent?.calendar?.seasonalHours || [];
  const activeSeason = seasonalHours.find((s) => todayIso >= s.fromDate && todayIso <= s.toDate);
  const effectiveHours = activeSeason?.hours || business.settings?.openingHours || null;

  // 5. Build agent payload
  const payload = {
    message_id: `op_${crypto.randomUUID()}`,
    conversation_id: `operator:${sessionId}`,
    message: body.message,
    contact_name: user.name || 'Operador',
    contact_phone: undefined,
    channel: 'dashboard' as const,
    recipient_id: uid,
    history: (body.history || []).slice(-20),          // client-managed rolling window
    use_case: body.mode === 'analyst' ? 'analyst' as const : 'operator' as const,
    business_name: business.nomeFantasia || business.razaoSocial,
    business_description: business.settings?.aiAgent?.businessDescription,
    tone: business.settings?.aiAgent?.tone || 'friendly',
    pedidos_settings: business.settings?.aiAgent?.pedidos || null,
    agenda_settings: business.settings?.aiAgent?.agenda || null,
    client_memory: null,
    // Business operational context (Wave 7 — policy-aware)
    opening_hours: effectiveHours,
    address: business.endereco || null,
    services_list: null,
    current_date: todayIso,
    policies: business.settings?.aiAgent?.policies || null,
    sla: business.settings?.aiAgent?.sla || null,
    is_closed_today: isClosedToday,
    seasonal_label: activeSeason?.label || null,
    delivery_zones: business.settings?.aiAgent?.deliveryZones || null,
    accepted_payment_methods: business.settings?.aiAgent?.acceptedPaymentMethods || null,
    team_capacity: business.settings?.aiAgent?.teamCapacity || null,
    upsell_rules: (business.settings?.aiAgent?.upsellRules || []).filter((r) => r.isActive),
    // Operator-specific identity fields
    operator_user_id: uid,
    operator_user_name: user.name,
    operator_user_role: role,
    operator_autonomous: autonomous,
  };

  const raw = JSON.stringify(payload);
  const ts = Date.now();
  const message = `${ts}.${businessId}.${raw}`;
  const signature = crypto.createHmac('sha256', SECRET).update(message).digest('hex');

  // 6. Invoke Python agent (synchronous — operator expects reply in-band)
  // Longer timeout than webhook dispatch (60s) — operator commands may run
  // several tool calls in sequence.
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let agentRes: Response | null = null;
  try {
    agentRes = await fetch(`${AGENT_URL.replace(/\/$/, '')}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-signature': signature,
        'x-agent-timestamp': String(ts),
        'x-business-id': businessId,
      },
      body: raw,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = (err as Error).name === 'AbortError';
    console.error('[operator.chat] agent fetch error', err);
    return NextResponse.json(
      { ok: false, error: isAbort ? 'Agent timeout (60s)' : `Agent unreachable: ${String(err)}` },
      { status: 504 },
    );
  }
  clearTimeout(timer);

  if (!agentRes.ok) {
    const errBody = await agentRes.text().catch(() => '');
    console.error('[operator.chat] agent HTTP', agentRes.status, errBody);
    void recordFailure(businessId, `agent HTTP ${agentRes.status}`).catch(() => {});
    return NextResponse.json({ ok: false, error: `O agente retornou erro (${agentRes.status}). Tente novamente.` }, { status: 502 });
  }

  let data: {
    run_id: string;
    final_response: string | null;
    intent: string | null;
    iterations: number;
    status: 'success' | 'error' | 'skipped';
    error?: string;
  };

  try {
    data = await agentRes.json();
  } catch {
    console.error('[operator.chat] agent returned invalid JSON');
    void recordFailure(businessId, 'invalid JSON from agent').catch(() => {});
    return NextResponse.json({ ok: false, error: 'O agente retornou uma resposta inválida. Tente novamente.' }, { status: 502 });
  }

  if (!data.run_id) {
    void recordFailure(businessId, data.error || 'no run_id returned').catch(() => {});
    return NextResponse.json({ ok: false, error: data.error || 'O agente não retornou um resultado. Tente novamente.' }, { status: 502 });
  }

  // Record outcome for circuit breaker
  if (data.status === 'success') {
    void recordSuccess(businessId).catch(() => {});
  } else if (data.status === 'error') {
    void recordFailure(businessId, data.error || 'operator agent error').catch(() => {});
  }

  // 7. Fetch run details for tool calls (persisted by agent)
  const runDoc = await adminDb.collection('agentRuns').doc(data.run_id).get();
  const run = runDoc.exists ? (runDoc.data() as { tools?: Array<{ name: string; arguments?: unknown; error?: string }>; costUsd?: number; totalLatencyMs?: number }) : null;
  const toolCalls = (run?.tools || []).map((t) => ({ name: t.name, args: t.arguments, error: t.error }));

  // 8. Audit: mark the run as operator-driven (appends to the same doc)
  if (runDoc.exists) {
    await runDoc.ref.update({
      operatorUserId: uid,
      operatorUserName: user.name,
      operatorUserRole: role,
      sessionId,
    });
  }

  const durationMs = Date.now() - t0;

  // If Python reported an internal error/skip, surface a human-readable message
  // to the UI rather than letting it see an empty response.
  let displayResponse = data.final_response;
  if (data.status !== 'success' && !displayResponse) {
    if (data.status === 'skipped') {
      displayResponse = 'Execução ignorada (cota diária do agente atingida ou regra de gate). Tente mais tarde.';
    } else {
      displayResponse = `⚠️ O agente encontrou um erro${data.error ? `: ${data.error.slice(0, 200)}` : ''}. Tente reformular ou verifique os logs.`;
    }
  }

  const response: OperatorChatResponse = {
    ok: true,
    runId: data.run_id,
    response: displayResponse,
    intent: data.intent,
    toolCalls,
    durationMs,
    costUsd: run?.costUsd || 0,
    autonomous,
    agentStatus: data.status,
    agentError: data.error,
  };

  return NextResponse.json(response);
}
